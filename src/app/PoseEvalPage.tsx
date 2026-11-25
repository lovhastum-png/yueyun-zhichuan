import { useCallback, useEffect, useRef, useState } from 'react';
import { getToken, getUser } from '../shared/auth';
import { toast } from '../shared/toast';
import { request } from '../shared/api';
import { activateProps } from '../shared/a11y';
import type { ApiResponse } from '../shared/types';
import {
  extractFeatures,
  poseLandmarksValid,
  POSE_BONES,
  HAND_BONES,
  type LmPoint,
  type FeatureRow,
} from '../shared/poseFeatures';
import './pose-eval.css';
import { AiBadge, AiNotice } from '../shared/AiLabel';

// ============================================================
// 身段测评（教学演示辅助工具 · 唱念做打之「做」）
// ------------------------------------------------------------
// 【硬性专业约束 —— 页面强制展示】
// 1. 仅比对关节角度时序（含手型），不评价身段神韵与流派韵味；
// 2. 所有分数均为【参考分】，不能替代专业教师身段指导；
// 3. 问题反馈均为客观描述 + 改进建议，无绝对化评判词汇。
// ============================================================
//
// 数据链路：
//   浏览器 MediaPipe Pose+Hands → 20 维关节角特征（本页就地折算）
//   → WebSocket（本地直连 8767 / 经网关 /pose-ws 代理）
//   → pose-eval sidecar（DTW 滑窗比对，joint_angle.py）
// 模板库管理走 Node 网关 /api/pose-eval（教师视频导入 = 浏览器端
// 逐帧提特征后只上传特征序列，视频本身不出本机）。

interface PoseAction {
  id: string;
  name: string;
  frames: number;
  segments: number;
  owner?: string;
  /** 参考身段骨架关键帧：[[11 关节 [x,y]], ...]（录制/导入保存的真实骨架，或旧模板角度反推） */
  demo?: number[][][];
  /** true=真实骨架录制（精准）；缺省=旧模板角度反推（示意） */
  demo_exact?: boolean;
}

interface FreeScoreRow {
  id: string;
  name: string;
  score: number;
}

interface ScoreMsg {
  type: 'score';
  mode: 'idle' | 'challenge' | 'free' | 'record';
  status: string;
  score: number | null;
  completion: number | null;
  hints: string[];
  recognized?: FreeScoreRow | null;
  scores?: FreeScoreRow[];
  frames?: number;
}

interface ResultMsg {
  type: 'result';
  mode: 'challenge' | 'free' | string;
  best: number | null;
  avg: number | null;
  completion?: number | null;
  frames: number;
  hints: string[];
  actionId?: string;
  actionName?: string;
  recognized?: FreeScoreRow | null;
  scores?: FreeScoreRow[];
}

interface HelloMsg { type: 'hello'; actions?: PoseAction[]; }
interface StartedMsg { type: 'started'; mode: 'challenge' | 'free' | 'record' | 'idle'; }
interface RecordStateMsg { type: 'record_state'; recording: boolean; }
interface RecordDoneMsg { type: 'record_done'; ok: boolean; message?: string; }
interface ErrorMsg { type: 'error'; message?: string; }
type WsMsg = ScoreMsg | ResultMsg | HelloMsg | StartedMsg | RecordStateMsg | RecordDoneMsg | ErrorMsg;

// ---------- MediaPipe 运行库（CDN 按需加载，与虚拟试衣页同源） ----------
const MEDIAPIPE_POSE_ROOT = 'https://cdn.jsdelivr.net/npm/@mediapipe/pose@0.5.1675469404';
const MEDIAPIPE_HANDS_ROOT = 'https://cdn.jsdelivr.net/npm/@mediapipe/hands@0.4.1675469240';

interface MpSolution {
  setOptions(opts: Record<string, unknown>): void;
  onResults(cb: (results: unknown) => void): void;
  send(input: { image: unknown }): Promise<void>;
  close?(): void;
}

interface PoseResults {
  poseLandmarks?: LmPoint[] | null;
}

interface HandsResults {
  multiHandLandmarks?: LmPoint[][] | null;
}

declare global {
  interface Window {
    Pose?: new (cfg: { locateFile: (file: string) => string }) => MpSolution;
    Hands?: new (cfg: { locateFile: (file: string) => string }) => MpSolution;
  }
}

const scriptPromises = new Map<string, Promise<void>>();

function loadScriptOnce(url: string): Promise<void> {
  let p = scriptPromises.get(url);
  if (p) return p;
  p = new Promise<void>((resolve, reject) => {
    const el = document.createElement('script');
    el.src = url;
    el.crossOrigin = 'anonymous';
    el.onload = () => resolve();
    el.onerror = () => reject(new Error(`脚本加载失败: ${url}`));
    document.head.appendChild(el);
  });
  scriptPromises.set(url, p);
  return p;
}

const FRAME_SEND_INTERVAL_MS = 125; // 特征发送节流（与 v1 一致，约 8fps）
const VIDEO_SAMPLE_FPS = 15;        // 视频导入采样率

// ---------- 参考身段小人绘制（与服务端 demo 骨架对应，同虚拟试衣页） ----------
// 关节顺序：[鼻, 左肩, 右肩, 左肘, 右肘, 左腕, 右腕, 左髋, 右髋, 左膝, 右膝]
const REF_BONES: Array<[number, number]> = [
  [1, 2],             // 肩连线
  [1, 3], [3, 5],     // 左臂
  [2, 4], [4, 6],     // 右臂
  [1, 7], [2, 8],     // 躯干
  [7, 8],             // 髋连线
  [7, 9], [8, 10],    // 双腿
];
const REF_UNIT = 0.185;    // 1 肩宽单位在参考画布中的像素比例
const REF_FRAME_MS = 260;  // 每个关键帧的播放时长（循环）

// 参考骨架采集的 MediaPipe 关节索引（与服务端 demo 关节顺序一致）：
// 鼻 + 双肩肘腕 + 双髋膝
const DEMO_JOINT_INDICES = [0, 11, 12, 13, 14, 15, 16, 23, 24, 25, 26] as const;

const STATUS_LABELS: Record<string, string> = {
  idle: '未开启',
  connecting: '连接评分服务中…',
  ready: '姿态已就绪，点击身段名可开始挑战',
  matching: '身段比对中…',
  free: '自由跟练识别中…',
  recording: '模板录制中…',
  finished: '本次挑战已完成',
  error: '评分服务未连接',
};

export function PoseEvalPage() {
  const user = getUser();
  const isTeacher = user?.role === 'teacher';

  // ---------- 状态 ----------
  const [actions, setActions] = useState<PoseAction[]>([]);
  const [selectedId, setSelectedId] = useState<string>('');
  const [serviceUp, setServiceUp] = useState<boolean | null>(null); // null=检测中
  const [camOn, setCamOn] = useState(false);
  const [camLoading, setCamLoading] = useState(false);
  const [mpLoading, setMpLoading] = useState(false);
  const [wsOnline, setWsOnline] = useState(false);
  const [mode, setMode] = useState<'idle' | 'challenge' | 'free' | 'record'>('idle');
  const [status, setStatus] = useState('idle');
  const [displayScore, setDisplayScore] = useState<number | null>(null);
  const [completion, setCompletion] = useState<number | null>(null);
  const [hints, setHints] = useState<string[]>([]);
  const [freeBoard, setFreeBoard] = useState<FreeScoreRow[]>([]);
  const [recognized, setRecognized] = useState<FreeScoreRow | null>(null);
  const [result, setResult] = useState<ResultMsg | null>(null);

  // 教师视频导入
  const [importName, setImportName] = useState('');
  const [importFile, setImportFile] = useState<File | null>(null);
  const [importStart, setImportStart] = useState('');
  const [importEnd, setImportEnd] = useState('');
  const [importing, setImporting] = useState(false);
  const [importProgress, setImportProgress] = useState(0);

  // ---------- refs（媒体管线与 WS） ----------
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const poseRef = useRef<MpSolution | null>(null);
  const handsRef = useRef<MpSolution | null>(null);
  const lastPoseLm = useRef<LmPoint[] | null>(null);
  const lastHandLms = useRef<LmPoint[][]>([]);
  const wsRef = useRef<WebSocket | null>(null);
  const camActiveRef = useRef(false);
  const importingRef = useRef(false);
  const disposedRef = useRef(false);
  const lastSentAtRef = useRef(0);
  const recentScoresRef = useRef<number[]>([]);
  const reconnectTimerRef = useRef<number | null>(null);
  const camEpochRef = useRef(0);       // 每次开启摄像头 +1，用于「本轮摄像头只提示一次自动识别」
  const autoFreeToastRef = useRef(-1); // 已提示过自动识别的 camEpoch
  const refCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const refAnimRef = useRef<{ frames: number[][][]; startedAt: number }>({ frames: [], startedAt: 0 });
  // WS 回调读取最新模式用；connectWs 绝不能依赖 mode，否则每次模式切换都会拆掉重连（丢会话）
  const modeRef = useRef<'idle' | 'challenge' | 'free' | 'record'>('idle');

  // ---------- 身段库 ----------
  const refreshActions = useCallback(async () => {
    const resp = await request<{ actions: PoseAction[] }>('/pose-eval/actions');
    if (resp.code === 0 && resp.data?.actions) {
      setActions(resp.data.actions);
      setServiceUp(true);
    } else {
      setServiceUp(false);
    }
  }, []);

  useEffect(() => {
    refreshActions();
    return () => {
      disposedRef.current = true;
      camActiveRef.current = false;
      streamRef.current?.getTracks().forEach((t) => t.stop());
      if (reconnectTimerRef.current) window.clearTimeout(reconnectTimerRef.current);
      try { wsRef.current?.close(); } catch { /* 忽略 */ }
    };
  }, [refreshActions]);

  // 默认选中第一个身段
  useEffect(() => {
    if ((!selectedId || !actions.some((a) => a.id === selectedId)) && actions.length > 0) {
      setSelectedId(actions[0].id);
    }
  }, [actions, selectedId]);

  // modeRef 与 state 同步：供 WS 回调读取最新值
  useEffect(() => { modeRef.current = mode; }, [mode]);

  const selected = actions.find((a) => a.id === selectedId) || null;

  // 参考身段小人：关键帧间平滑插值循环播放（缓动 + 发光骨架）
  useEffect(() => {
    let raf = 0;
    const TORSO_BONES: Array<[number, number]> = [[1, 2], [1, 7], [2, 8], [7, 8], [7, 9], [8, 10]];
    const ARM_BONES: Array<[number, number]> = [[1, 3], [3, 5], [2, 4], [4, 6]];
    const loop = () => {
      const canvas = refCanvasRef.current;
      const anim = refAnimRef.current;
      if (canvas && anim.frames.length > 1) {
        const ctx = canvas.getContext('2d');
        if (ctx) {
          const w = canvas.width;
          const h = canvas.height;
          // 关键帧插值（smoothstep 缓动），动画更顺滑
          const len = anim.frames.length;
          const tPos = ((performance.now() - anim.startedAt) / REF_FRAME_MS) % len;
          const i0 = Math.floor(tPos) % len;
          const i1 = (i0 + 1) % len;
          const k = tPos - Math.floor(tPos);
          const e = k * k * (3 - 2 * k);
          const cur = anim.frames[i0];
          const nxt = anim.frames[i1];
          const pts = cur.map((p, idx) => [
            p[0] + (nxt[idx][0] - p[0]) * e,
            p[1] + (nxt[idx][1] - p[1]) * e,
          ]);
          const px = (p: number[]) => ({ x: (0.5 + p[0] * REF_UNIT) * w, y: (0.62 + p[1] * REF_UNIT) * h });
          // 背景：深色渐变
          const bg = ctx.createLinearGradient(0, 0, 0, h);
          bg.addColorStop(0, '#232420');
          bg.addColorStop(1, '#101110');
          ctx.fillStyle = bg;
          ctx.fillRect(0, 0, w, h);
          // 发光骨架：躯干腿粗、手臂略细
          ctx.save();
          ctx.lineCap = 'round';
          ctx.lineJoin = 'round';
          ctx.strokeStyle = '#f0d9a8';
          ctx.shadowColor = 'rgba(240, 217, 168, 0.5)';
          ctx.shadowBlur = 10;
          const strokeBones = (bones: Array<[number, number]>, width: number) => {
            ctx.lineWidth = width;
            ctx.beginPath();
            for (const [a, b] of bones) {
              const pa = px(pts[a]);
              const pb = px(pts[b]);
              ctx.moveTo(pa.x, pa.y);
              ctx.lineTo(pb.x, pb.y);
            }
            ctx.stroke();
          };
          strokeBones(TORSO_BONES, 4);
          strokeBones(ARM_BONES, 3);
          ctx.restore();
          // 关节点
          ctx.fillStyle = '#fff4dc';
          const jointSet = new Set<number>();
          REF_BONES.forEach(([a, b]) => { jointSet.add(a); jointSet.add(b); });
          jointSet.forEach((i) => {
            const p = px(pts[i]);
            ctx.beginPath();
            ctx.arc(p.x, p.y, 3, 0, Math.PI * 2);
            ctx.fill();
          });
          // 头部：以鼻位为圆心的实心圆
          const nose = px(pts[0]);
          ctx.save();
          ctx.shadowColor = 'rgba(240, 217, 168, 0.5)';
          ctx.shadowBlur = 8;
          ctx.fillStyle = '#f0d9a8';
          ctx.beginPath();
          ctx.arc(nose.x, nose.y + 4, 9, 0, Math.PI * 2);
          ctx.fill();
          ctx.restore();
        }
      }
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, []);

  // 选中身段变化时更新参考骨架动画
  useEffect(() => {
    if (selected?.demo?.length) {
      refAnimRef.current = { frames: selected.demo, startedAt: performance.now() };
    } else {
      refAnimRef.current = { frames: [], startedAt: 0 };
    }
  }, [selected]);

  // ---------- WebSocket（本地直连 → 网关代理 兜底） ----------
  const wsSend = useCallback((payload: unknown) => {
    const ws = wsRef.current;
    if (ws && ws.readyState === WebSocket.OPEN) {
      try { ws.send(JSON.stringify(payload)); } catch { /* 忽略单帧失败 */ }
    }
  }, []);

  const handleWsMessage = useCallback((msg: WsMsg) => {
    if (msg.type === 'hello') {
      const list = msg.actions as PoseAction[] | undefined;
      if (Array.isArray(list) && list.length) setActions(list);
    } else if (msg.type === 'started') {
      recentScoresRef.current = [];
      setDisplayScore(null);
      setFreeBoard([]);
      setRecognized(null);
      setStatus(msg.mode === 'free' ? 'free' : 'matching');
    } else if (msg.type === 'score') {
      const s = msg as ScoreMsg;
      if (s.status === 'ready' || s.status === 'waiting') {
        if (modeRef.current === 'idle') setStatus('ready');
        return;
      }
      if (s.status === 'recording') {
        setStatus('recording');
        setCompletion(s.completion ?? null);
        setHints([`模板录制中（${s.frames ?? 0} 帧），完成后自动保存`]);
        return;
      }
      setStatus(s.mode === 'free' ? 'free' : 'matching');
      if (typeof s.score === 'number') {
        recentScoresRef.current.push(s.score);
        if (recentScoresRef.current.length > 5) recentScoresRef.current.shift();
        const sorted = [...recentScoresRef.current].sort((a, b) => a - b);
        setDisplayScore(sorted[Math.floor(sorted.length / 2)]);
      }
      setCompletion(s.completion ?? null);
      setHints(s.hints || []);
      if (s.mode === 'free') {
        setFreeBoard(s.scores || []);
        setRecognized(s.recognized || null);
      }
    } else if (msg.type === 'result') {
      setResult(msg as ResultMsg);
      setMode('idle');
      setStatus('finished');
    } else if (msg.type === 'record_state') {
      setMode('record');
      setStatus('recording');
      setHints(['模板录制中，请完整演示一遍身段']);
    } else if (msg.type === 'record_done') {
      setMode('idle');
      setStatus('ready');
      setDisplayScore(null);
      toast(msg.message || '模板录制结束', msg.ok ? 'ok' : 'err');
      refreshActions();
    } else if (msg.type === 'error') {
      toast(msg.message || '评分服务异常', 'err');
    }
  }, [refreshActions]);

  const connectWs = useCallback(() => {
    if (disposedRef.current) return;
    const token = getToken() || '';
    const host = window.location.hostname;
    const isLocal = host === 'localhost' || host === '127.0.0.1';
    const proto = window.location.protocol === 'https:' ? 'wss' : 'ws';
    // 本地优先直连 sidecar（最快）；公网隧道走网关代理（sidecar 仅绑回环）
    const candidates = isLocal
      ? ['ws://127.0.0.1:8767/ws/pose-v2', `${proto}://${window.location.host}/pose-ws?token=${encodeURIComponent(token)}`]
      : [`${proto}://${window.location.host}/pose-ws?token=${encodeURIComponent(token)}`];
    let idx = 0;

    const tryNext = () => {
      if (disposedRef.current) return;
      if (idx >= candidates.length) {
        setWsOnline(false);
        setStatus('error');
        reconnectTimerRef.current = window.setTimeout(connectWs, 5000);
        return;
      }
      const url = candidates[idx++];
      let sock: WebSocket;
      try {
        sock = new WebSocket(url);
      } catch {
        tryNext();
        return;
      }
      wsRef.current = sock;
      let opened = false;
      sock.onopen = () => {
        opened = true;
        setWsOnline(true);
        setStatus('ready');
      };
      sock.onmessage = (ev) => {
        try { handleWsMessage(JSON.parse(ev.data)); } catch { /* 忽略坏帧 */ }
      };
      sock.onclose = () => {
        if (wsRef.current !== sock) return;
        setWsOnline(false);
        if (modeRef.current !== 'idle') {
          setMode('idle');
          setStatus('error');
        }
        if (!opened) tryNext();
        else if (!disposedRef.current) {
          reconnectTimerRef.current = window.setTimeout(connectWs, 3000);
        }
      };
      sock.onerror = () => { try { sock.close(); } catch { /* 忽略 */ } };
    };
    tryNext();
  }, [handleWsMessage]);

  useEffect(() => {
    connectWs();
    return () => {
      if (reconnectTimerRef.current) window.clearTimeout(reconnectTimerRef.current);
      try { wsRef.current?.close(); } catch { /* 忽略 */ }
    };
  }, [connectWs]);

  // ---------- 摄像头 + MediaPipe 管线 ----------
  const drawOverlay = useCallback((poseLm: LmPoint[] | null, handLms: LmPoint[][]) => {
    const canvas = canvasRef.current;
    const video = videoRef.current;
    if (!canvas || !video) return;
    const w = canvas.width, h = canvas.height;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    ctx.clearRect(0, 0, w, h);
    if (!poseLm) return;
    // 镜像由 CSS 统一处理（video/canvas 同规则 scaleX(-1)），此处按原始关键点坐标绘制
    ctx.lineWidth = 2.5;
    ctx.lineCap = 'round';
    ctx.strokeStyle = 'rgba(232, 201, 141, 0.9)';
    ctx.beginPath();
    for (const [a, b] of POSE_BONES) {
      const pa = poseLm[a], pb = poseLm[b];
      if (!pa || !pb) continue;
      ctx.moveTo(pa.x * w, pa.y * h);
      ctx.lineTo(pb.x * w, pb.y * h);
    }
    ctx.stroke();
    ctx.fillStyle = 'rgba(244, 227, 192, 0.95)';
    for (const [a] of POSE_BONES) {
      const p = poseLm[a];
      if (!p) continue;
      ctx.beginPath();
      ctx.arc(p.x * w, p.y * h, 3, 0, Math.PI * 2);
      ctx.fill();
    }
    // 手部骨架（更细的金线）
    if (handLms.length) {
      ctx.lineWidth = 1.6;
      ctx.strokeStyle = 'rgba(193, 39, 45, 0.85)';
      ctx.beginPath();
      for (const hand of handLms) {
        if (!hand || hand.length < 21) continue;
        for (const [a, b] of HAND_BONES) {
          ctx.moveTo(hand[a].x * w, hand[a].y * h);
          ctx.lineTo(hand[b].x * w, hand[b].y * h);
        }
      }
      ctx.stroke();
    }
  }, []);

  const processLatestFrame = useCallback(() => {
    const poseLm = lastPoseLm.current;
    const handLms = lastHandLms.current;
    drawOverlay(poseLm, handLms);
    const row = extractFeatures({ poseLm, handLms });
    if (!row) return;
    const now = performance.now();
    if (now - lastSentAtRef.current < FRAME_SEND_INTERVAL_MS) return;
    lastSentAtRef.current = now;
    // 录制模板时附带 11 关节归一化坐标（随模板保存，作为参考身段动画数据）
    const payload: Record<string, unknown> = { type: 'frame', features: row, ts: Date.now() };
    if (modeRef.current === 'record' && poseLandmarksValid(poseLm)) {
      payload.demo = DEMO_JOINT_INDICES.map((i) => [poseLm[i].x, poseLm[i].y]);
    }
    wsSend(payload);
  }, [drawOverlay, wsSend]);

  const ensureMediaPipe = useCallback(async () => {
    if (poseRef.current && handsRef.current) return;
    setMpLoading(true);
    try {
      await Promise.all([
        loadScriptOnce(`${MEDIAPIPE_POSE_ROOT}/pose.js`),
        loadScriptOnce(`${MEDIAPIPE_HANDS_ROOT}/hands.js`),
      ]);
      if (!window.Pose || !window.Hands) throw new Error('MediaPipe 运行库不可用');

      const pose = new window.Pose({ locateFile: (f) => `${MEDIAPIPE_POSE_ROOT}/${f}` });
      pose.setOptions({
        modelComplexity: 1, smoothLandmarks: true, enableSegmentation: false,
        minDetectionConfidence: 0.5, minTrackingConfidence: 0.5,
      });
      pose.onResults((r) => {
        const res = r as PoseResults;
        lastPoseLm.current = res.poseLandmarks && res.poseLandmarks.length >= 33
          ? res.poseLandmarks : null;
      });

      const hands = new window.Hands({ locateFile: (f) => `${MEDIAPIPE_HANDS_ROOT}/${f}` });
      hands.setOptions({
        maxNumHands: 2, modelComplexity: 1,
        minDetectionConfidence: 0.6, minTrackingConfidence: 0.5,
      });
      hands.onResults((r) => {
        const res = r as HandsResults;
        lastHandLms.current = res.multiHandLandmarks || [];
      });

      poseRef.current = pose;
      handsRef.current = hands;
    } finally {
      setMpLoading(false);
    }
  }, []);

  const startCamera = useCallback(async () => {
    if (camActiveRef.current) return;
    setCamLoading(true);
    try {
      await ensureMediaPipe();
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { width: 960, height: 720, facingMode: 'user' },
        audio: false,
      });
      if (disposedRef.current) {
        stream.getTracks().forEach((t) => t.stop());
        return;
      }
      streamRef.current = stream;
      const video = videoRef.current;
      if (!video) return;
      video.srcObject = stream;
      await video.play();
      const canvas = canvasRef.current;
      if (canvas && video.videoWidth) {
        canvas.width = video.videoWidth;
        canvas.height = video.videoHeight;
      }
      camActiveRef.current = true;
      camEpochRef.current += 1;
      setCamOn(true);
      setStatus('ready');
      toast('摄像头已开启，请正对镜头站立，保持肩髋可见', 'ok');

      // 处理循环：Pose → Hands → 特征节流上报 + 叠加层绘制
      const loop = async () => {
        while (camActiveRef.current && !disposedRef.current) {
          if (!importingRef.current && video.readyState >= 2) {
            try {
              await poseRef.current?.send({ image: video });
              await handsRef.current?.send({ image: video });
              processLatestFrame();
            } catch { /* 单帧失败跳过 */ }
          }
          await new Promise((r) => setTimeout(r, 50));
        }
      };
      void loop();
    } catch (err) {
      const msg = err instanceof Error ? err.message : '';
      toast(
        msg.includes('脚本加载') || msg.includes('运行库')
          ? '姿态识别运行库加载失败，请检查网络后重试'
          : '无法开启摄像头，请检查浏览器授权',
        'err',
      );
    } finally {
      setCamLoading(false);
    }
  }, [ensureMediaPipe, processLatestFrame]);

  const stopCamera = useCallback(() => {
    camActiveRef.current = false;
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
    lastPoseLm.current = null;
    lastHandLms.current = [];
    drawOverlay(null, []);
    setCamOn(false);
    if (mode === 'idle') setStatus('idle');
  }, [drawOverlay, mode]);

  // ---------- 挑战 / 识别 / 录制 ----------
  const startChallenge = useCallback((actionId: string, actionName: string) => {
    if (!wsOnline) return;
    recentScoresRef.current = [];
    setDisplayScore(null);
    setCompletion(0);
    setFreeBoard([]);
    wsSend({ type: 'start', actionId });
    setMode('challenge');
    toast(`开始挑战「${actionName}」，请重复完整身段`, 'ok');
  }, [wsOnline, wsSend]);

  // ---------- 开摄像头即自动进入自由跟练 ----------
  // 摄像头开启（含评分服务稍后连上）、关闭成绩单回到待机时，自动进入/恢复全库识别，
  // 用户无需手动点「开始」即可被识别当前身段；主动挑战/录制不受影响
  useEffect(() => {
    if (!camOn || !wsOnline || result) return;
    if (mode !== 'idle' && mode !== 'free') return;
    wsSend({ type: 'start_free' });
    if (mode === 'idle') setMode('free');
    if (autoFreeToastRef.current !== camEpochRef.current) {
      autoFreeToastRef.current = camEpochRef.current;
      toast('已自动开始身段识别：随意做任一已入库身段即可', 'ok');
    }
  }, [mode, camOn, wsOnline, result, wsSend]);

  const finishSession = useCallback(() => {
    if (mode === 'idle') return;
    wsSend({ type: 'finish' });
  }, [mode, wsSend]);

  const toggleRecord = useCallback(() => {
    if (mode === 'record') {
      const name = window.prompt('为这段身段命名（1~30 字）', '自录身段');
      if (!name || !name.trim()) return;
      // owner 随录制上报：学生自录的模板由学生本人（及教师）可删
      wsSend({ type: 'record_stop', name: name.trim().slice(0, 30), owner: user?.username || '' });
    } else {
      wsSend({ type: 'record_start' });
      setMode('record');
      toast('开始录制模板：请完整演示一遍身段', 'ok');
    }
  }, [mode, user, wsSend]);

  // ---------- 删除身段（教师可删任意；学生仅限自建） ----------
  const deleteAction = useCallback(async (action: PoseAction) => {
    const confirmText = `确定删除身段「${action.name}」？该操作不可恢复。`;
    if (!window.confirm(confirmText)) return;
    const resp = await request(`/pose-eval/templates/${encodeURIComponent(action.id)}`, { method: 'DELETE' });
    if (resp.code === 0) {
      toast(`已删除「${action.name}」`, 'ok');
      refreshActions();
    } else {
      toast(resp.message || '删除失败', 'err');
    }
  }, [refreshActions]);

  // ---------- 教师视频导入（浏览器端逐帧提特征） ----------
  const importVideo = useCallback(async () => {
    if (!importFile || importing) return;
    const name = (importName || importFile.name.replace(/\.[^.]+$/, '')).trim().slice(0, 30);
    if (!name) {
      toast('请填写身段名称', 'err');
      return;
    }
    importingRef.current = true;
    setImporting(true);
    setImportProgress(0);
    try {
      await ensureMediaPipe();
      const video = document.createElement('video');
      video.muted = true;
      video.playsInline = true;
      const url = URL.createObjectURL(importFile);
      video.src = url;
      await new Promise<void>((resolve, reject) => {
        video.onloadedmetadata = () => resolve();
        video.onerror = () => reject(new Error('无法读取视频文件'));
        setTimeout(() => reject(new Error('视频加载超时')), 15000);
      });
      const duration = Number.isFinite(video.duration) ? video.duration : 0;
      if (!duration) throw new Error('视频时长信息无效');
      const t0 = Math.max(0, parseFloat(importStart) || 0);
      const t1 = Math.min(parseFloat(importEnd) > 0 ? parseFloat(importEnd) : duration, duration, 120);
      if (t1 - t0 < 1) throw new Error('时间范围无效（至少 1 秒）');

      const seekTo = (t: number) => new Promise<void>((resolve) => {
        const onSeeked = () => { video.removeEventListener('seeked', onSeeked); resolve(); };
        video.addEventListener('seeked', onSeeked);
        video.currentTime = t;
        setTimeout(() => { video.removeEventListener('seeked', onSeeked); resolve(); }, 2000);
      });

      const step = 1 / VIDEO_SAMPLE_FPS;
      const rows: FeatureRow[] = [];
      const demoRows: Array<number[][] | null> = []; // 与 rows 对齐的骨架坐标（参考身段动画）
      const total = Math.max(1, Math.ceil((t1 - t0) / step));
      let processed = 0;
      for (let t = t0; t < t1; t += step) {
        await seekTo(t);
        await poseRef.current?.send({ image: video });
        await handsRef.current?.send({ image: video });
        const row = extractFeatures({
          poseLm: lastPoseLm.current,
          handLms: lastHandLms.current,
        });
        if (row) {
          rows.push(row);
          const lm = lastPoseLm.current;
          demoRows.push(poseLandmarksValid(lm)
            ? DEMO_JOINT_INDICES.map((i) => [lm[i].x, lm[i].y])
            : null);
        }
        processed += 1;
        setImportProgress(Math.round((processed / total) * 100));
        if (rows.length >= 600) break;
      }
      URL.revokeObjectURL(url);
      if (rows.length < 15) {
        throw new Error('未从视频中检测到足够的舞蹈姿态（需至少 15 个有效帧），请确认画面中有完整人体');
      }

      // 骨架帧与特征帧完全对齐才上传（保证参考动画时序一致）
      const demoOk = demoRows.length === rows.length && demoRows.every(Boolean);
      const resp = await request<{ action: PoseAction }>('/pose-eval/templates', {
        method: 'POST',
        body: { name, features: rows, ...(demoOk ? { demo: demoRows } : {}) },
        timeout: 30000,
      }) as ApiResponse<{ action: PoseAction }>;
      if (resp.code !== 0) {
        throw new Error(resp.message || '模板保存失败');
      }
      toast(`身段「${name}」已导入模板库（${rows.length} 帧）`, 'ok');
      setImportFile(null);
      setImportName('');
      setImportStart('');
      setImportEnd('');
      await refreshActions();
      if (resp.data?.action?.id) setSelectedId(resp.data.action.id);
    } catch (err) {
      toast(err instanceof Error ? err.message : '视频导入失败', 'err', 5000);
    } finally {
      importingRef.current = false;
      setImporting(false);
      setImportProgress(0);
    }
  }, [importFile, importName, importStart, importEnd, importing, ensureMediaPipe, refreshActions]);

  // ---------- 渲染 ----------
  const serviceBadge = serviceUp === null
    ? { text: '检测中…', cls: 'tag' }
    : serviceUp
      ? { text: wsOnline ? '评分服务已连接' : '评分服务运行中', cls: 'tag tag-cinnabar' }
      : { text: '评分服务未启动', cls: 'tag' };

  return (
    <main className="main">
      <div className="container" style={{ paddingTop: 8 }}>
        <section className="page-hero">
          <div className="ink-wash ink-wash-1" style={{ background: 'var(--cyan)', left: '12%' }} />
          <div className="ink-wash ink-wash-2" style={{ background: 'var(--ochre)', right: '12%', opacity: 0.15 }} />
          <div className="hero-seal">
            <span className="seal seal-vertical">身段</span>
          </div>
          <h1 className="title">身段测评 <AiBadge style={{ fontSize: 12, padding: '2px 10px' }} /></h1>
        </section>
        <AiNotice text="本页身段评分由人工智能姿态估计与特征比对算法自动生成，受拍摄角度、清晰度影响较大，仅作练习参考。" />

        <div className="se-disclaimer" role="note">
          <span className="se-disclaimer-icon">鉴</span>
          <span>
            本工具仅比对<b>关节角度时序</b>（含手指手型），用于辅助身段练习的自我对照；
            <strong> 不评价身段神韵、劲力与流派韵味</strong>，所有分数均为参考分，
            身段差异的判定请以专业教师现场指导为准。
          </span>
        </div>

        <div className="pe-layout">
          {/* ---------- 左列：身段库 ---------- */}
          <aside className="pe-lib">
            <div className="section-title" style={{ marginTop: 4 }}>
              <span className="st-text">身段库</span>
              <span className="st-line" />
              <span className={serviceBadge.cls}>{serviceBadge.text}</span>
            </div>
            {actions.length === 0 && (
              <div className="pe-note">
                {serviceUp === false
                  ? '评分服务未启动，模板库暂不可用。请通过「启动服务.bat」启动后再试。'
                  : '模板库为空：可由教师在右侧「视频导入」添加名家示范身段。'}
              </div>
            )}
            {actions.map((a) => {
              // 键鼠一致：点击与 Enter/Space 走同一条路径（选中 + 直接开挑战）
              const activate = () => {
                setSelectedId(a.id);
                if (camOn && wsOnline && mode !== 'record' && !importingRef.current) {
                  startChallenge(a.id, a.name);
                }
              };
              return (
                <div
                  key={a.id}
                  className={`pe-lib-item ${a.id === selectedId ? 'active' : ''}`}
                  onClick={activate}
                  {...activateProps(activate)}
                >
                  <div className="pe-lib-main">
                    <div className="pe-lib-name">{a.name}</div>
                    <div className="pe-lib-meta">
                      {`${a.owner ? `${a.owner} · ` : ''}自录/导入 · ${a.segments} 段`} · {a.frames} 帧
                    </div>
                  </div>
                  {(isTeacher || a.owner === user?.username) && (
                    <button
                      type="button"
                      className="pe-lib-del"
                      title="删除该身段"
                      onClick={(e) => { e.stopPropagation(); deleteAction(a); }}
                    >
                      ✕
                    </button>
                  )}
                </div>
              );
            })}
          </aside>

          {/* ---------- 中列：摄像头跟练 + 参考身段 ---------- */}
          <section>
            <div className="pe-main-row">
              <div className="pe-stage">
              <div className="pe-video-wrap">
                <video ref={videoRef} playsInline muted style={{ display: camOn ? 'block' : 'none' }} />
                <canvas ref={canvasRef} style={{ display: camOn ? 'block' : 'none' }} />
                {!camOn && (
                  <div className="pe-cam-off">
                    <div className="pe-cam-icon">影</div>
                    <span>开启摄像头，自动识别您当前的身段</span>
                    <span className="pe-note">视频仅在本机浏览器内做姿态识别，不会被上传</span>
                  </div>
                )}
                <div className={`pe-hud ${mode === 'record' ? 'recording' : ''}`} style={{ visibility: camOn ? 'visible' : 'hidden' }}>
                  <div className="pe-hud-status">
                    {mode === 'challenge' && selected ? `挑战 · ${selected.name}` : null}
                    {mode === 'free' ? '自由跟练 · 全库识别' : null}
                    {mode === 'record' ? '● 模板录制' : null}
                    {mode === 'idle' ? STATUS_LABELS[status] || status : null}
                  </div>
                  <div className="pe-hud-score">
                    <div className="pe-hud-num">{displayScore === null ? '--' : Math.round(displayScore)}</div>
                    <div className="pe-hud-cap">参考分</div>
                  </div>
                </div>
                {camOn && (
                  <div className="pe-hint-bar">
                    {hints[0]
                      || (completion !== null && completion > 0 && completion < 1
                        ? `已完成动作的 ${Math.round(completion * 100)}%，请继续跟完整段身段`
                        : (mode === 'free' ? '随意做任一已入库身段，系统自动识别' : '保持节奏，重复完整身段'))}
                  </div>
                )}
              </div>

              <div className="pe-controls">
                {!camOn ? (
                  <button type="button" className="btn btn-primary" onClick={startCamera} disabled={camLoading || mpLoading}>
                    {camLoading || mpLoading ? '正在开启…' : '开启摄像头'}
                  </button>
                ) : (
                  <button type="button" className="btn btn-ghost" onClick={stopCamera}>关闭摄像头</button>
                )}
                {(mode === 'idle' || mode === 'free') && (
                  <button type="button" className="btn btn-ghost" onClick={toggleRecord} disabled={!camOn || !wsOnline}>
                    录制模板
                  </button>
                )}
                {mode !== 'idle' && (
                  <button
                    type="button"
                    className={mode === 'free' ? 'btn btn-ghost' : 'btn btn-primary'}
                    onClick={mode === 'record' ? toggleRecord : finishSession}
                  >
                    {mode === 'record' ? '完成录制' : '结束并查看成绩'}
                  </button>
                )}
                {importing && (
                  <div className="pe-progress show">
                    <i style={{ width: `${importProgress}%` }} />
                  </div>
                )}
              </div>
              </div>

              {/* 参考身段小人（摄像头旁，方便照做） */}
              <div className="pe-ref">
                <div className="pe-ref-title">
                  <span>参考身段</span>
                  {selected && <span className="tag tag-cinnabar" style={{ fontSize: 11 }}>{selected.name}</span>}
                </div>
                <canvas ref={refCanvasRef} width={150} height={190} aria-label="参考身段动画" />
                <div className="pe-ref-note">
                  {selected?.demo?.length
                    ? selected.demo_exact
                      ? '按此范本跟随练习（真人骨架 · 循环播放）'
                      : '规范圆手示意（旧模板）· 重新录制该身段可获得真人骨架动画'
                    : '暂无参考身段（录制/导入模板后自动生成）'}
                </div>
              </div>
            </div>

            {/* 自由跟练实时榜 */}
            <div className={`pe-free-board ${mode === 'free' && freeBoard.length ? 'show' : ''}`}>
              <div className="pe-free-title">
                识别结果
                {recognized ? (
                  <span className="tag tag-cinnabar">识别为「{recognized.name}」</span>
                ) : (
                  <span className="tag">暂未达到识别阈值，请完整做一遍已入库身段</span>
                )}
              </div>
              {freeBoard.map((row, i) => (
                <div key={row.id} className={`pe-free-row ${i === 0 ? 'top' : ''}`}>
                  <span className="pe-free-name">{row.name}</span>
                  <span className="pe-free-bar"><i style={{ width: `${Math.min(100, row.score)}%` }} /></span>
                  <span className="pe-free-score">{Math.round(row.score)}</span>
                </div>
              ))}
            </div>
          </section>

          {/* ---------- 右列：模板管理（教师） ---------- */}
          <aside className="pe-manage">
            {isTeacher && (
            <div className="pe-card">
              <div className="pe-card-title">
                视频导入模板
                <span className="tag tag-cinnabar">教师</span>
              </div>
              <div className="pe-field">
                <label>身段名称（1~30 字）</label>
                <input
                  className="pe-input"
                  value={importName}
                  onChange={(e) => setImportName(e.target.value)}
                  placeholder="如：水袖抛收 · 袁派"
                  maxLength={30}
                  disabled={importing}
                />
              </div>
              <div className="pe-field pe-file">
                <label>示范视频（mp4/webm，建议单个完整身段 ≤ 40 秒）</label>
                <input
                  type="file"
                  accept="video/*"
                  disabled={importing}
                  onChange={(e) => setImportFile(e.target.files?.[0] || null)}
                />
              </div>
              <div className="pe-row2">
                <div className="pe-field">
                  <label>起始秒（可空）</label>
                  <input className="pe-input" value={importStart} onChange={(e) => setImportStart(e.target.value)} placeholder="0" disabled={importing} />
                </div>
                <div className="pe-field">
                  <label>结束秒（可空）</label>
                  <input className="pe-input" value={importEnd} onChange={(e) => setImportEnd(e.target.value)} placeholder="结尾" disabled={importing} />
                </div>
              </div>
              <button
                type="button"
                className="btn btn-primary"
                style={{ width: '100%' }}
                onClick={importVideo}
                disabled={!importFile || importing}
              >
                {importing ? `提取姿态中 ${importProgress}%` : '导入为模板'}
              </button>
              <p className="pe-note" style={{ marginTop: 10 }}>
                视频在您的浏览器内逐帧识别（MediaPipe），仅上传关节角特征序列，
                视频文件本身不会离开本机。同名身段会累积多段示范，系统自动平均出「合成标准示范」。
              </p>
            </div>
            )}

            {!isTeacher && (
              <div className="pe-card">
                <div className="pe-card-title">学生使用指南</div>
                <p className="pe-note">
                  1. 开启摄像头，正对镜头站立，保持肩部与髋部可见；<br />
                  2. 开启后即自动识别身段：随意做任一已入库身段，系统实时判断并打分；<br />
                  3. 要专攻某个身段，直接点击左侧身段名即开始该身段的挑战；<br />
                  4. 也可用「录制模板」把自己或老师的示范加入身段库。<br />
                  手型（兰花指/剑指）参与评分，练习时注意手部完整入画。
                </p>
              </div>
            )}

            <div className="pe-card">
              <div className="pe-card-title">能力边界</div>
              <p className="pe-note">
                比对维度：躯干与四肢 10 个关节角 + 双手 10 个手指弯曲角；
                对身高、站位、镜头远近不敏感。不评价神韵、劲力、身段衔接的
                流畅性与流派风格 —— 这些请以教师现场指导为准。
              </p>
            </div>
          </aside>
        </div>
      </div>

      {/* ---------- 结果弹层 ---------- */}
      <div className="pe-result-mask" hidden={!result} onClick={() => setResult(null)}>
        <div className="pe-result" onClick={(e) => e.stopPropagation()}>
          <div className="pe-result-head">
            <span className="seal seal-vertical" style={{ fontSize: 15 }}>鉴</span>
            <div>
              <div className="pe-result-title">
                {result?.mode === 'free'
                  ? (result?.recognized ? `识别为「${result.recognized.name}」` : '自由跟练成绩')
                  : '身段挑战成绩'}
              </div>
              <div className="pe-result-sub">参考分 · 教学演示 · 成绩仅保留在本次会话</div>
            </div>
          </div>
          <div className="pe-result-scores">
            <div className="pe-stat">
              <div className="pe-stat-num">{result?.best ?? '--'}</div>
              <div className="pe-stat-cap">最高分</div>
            </div>
            <div className="pe-stat">
              <div className="pe-stat-num">{result?.avg ?? '--'}</div>
              <div className="pe-stat-cap">平均分</div>
            </div>
            <div className="pe-stat">
              <div className="pe-stat-num">
                {result?.completion != null ? `${Math.round(result.completion)}%` : `${result?.frames ?? 0}帧`}
              </div>
              <div className="pe-stat-cap">{result?.completion != null ? '完成度' : '采集帧数'}</div>
            </div>
          </div>
          {result?.mode === 'free' && result.scores && result.scores.length > 0 && (
            <div style={{ marginBottom: 12 }}>
              {result.scores.slice(0, 3).map((row) => (
                <div key={row.id} className="pe-free-row">
                  <span className="pe-free-name">{row.name}</span>
                  <span className="pe-free-bar"><i style={{ width: `${Math.min(100, row.score)}%` }} /></span>
                  <span className="pe-free-score">{Math.round(row.score)}</span>
                </div>
              ))}
            </div>
          )}
          <div className="pe-result-hint">
            {(result?.hints || []).map((h, i) => <div key={i}>{h}</div>)}
          </div>
          <div className="pe-result-actions">
            <button type="button" className="btn btn-ghost" onClick={() => setResult(null)}>关闭</button>
            <button
              type="button"
              className="btn btn-primary"
              onClick={() => {
                const rid = result?.actionId;
                const rname = result?.actionName || '';
                setResult(null);
                recentScoresRef.current = [];
                setDisplayScore(null);
                if (result?.mode === 'challenge' && rid && camOn && wsOnline) {
                  // 挑战成绩 → 直接重开同一身段
                  startChallenge(rid, rname);
                } else {
                  setStatus('ready'); // 其余情况回到自动识别
                }
              }}
            >
              再练一次
            </button>
          </div>
        </div>
      </div>
    </main>
  );
}
