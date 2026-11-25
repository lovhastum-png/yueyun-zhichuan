import { useCallback, useEffect, useRef, useState } from 'react';
import { getToken, isLoggedIn } from '../shared/auth';
import { toast } from '../shared/toast';
import { InkGrinding } from '../shared/InkGrinding';
import type { ApiResponse } from '../shared/types';
import { AiBadge, AiNotice } from '../shared/AiLabel';

// 演唱测评页：上传或录音，展示音准、节奏参考分和练习建议。
// 咬字、润腔和气息等专业判断仍由教师完成。

// ---------- 后端报告契约（见 server/python/singing-eval/analyzer.py） ----------
interface ProblemSegment {
  start_time: number;
  end_time: number;
  dim: 'pitch' | 'rhythm';
  problem_desc: string;
}

interface EvalReport {
  disclaimer: string;
  scope: string;
  total_score: number;
  pitch_score: number | null;
  rhythm_score: number | null;
  problem_segments: ProblemSegment[];
  suggestion: string;
  stats: {
    voiced_ratio?: number;
    median_abs_dev_cents?: number;
    within_50_cents_ratio?: number;
    onset_count?: number;
    matched_onsets?: number;
    tempo_ratio?: number;
    note?: string;
  };
  meta: {
    ref_duration: number;
    stu_duration: number;
    elapsed_ms: number;
    version: string;
  };
}

// ---------- AI 测准点评（见 server/services/singingEval/aiFeedback.js） ----------
interface AiFeedback {
  ai_score: number | null;
  summary: string;
  strengths: string[];
  issues: string[];
  suggestions: string[];
}

// ---------- 报告流转结果（见 server/services/singingEval/exportAdapters.js） ----------
// status: ok=下游成功 / degraded=下游降级 / package=无接口，已生成作业包
interface ExportResult {
  target: 'multi-agent' | 'ai-grading' | 'learning-platform';
  status: 'ok' | 'degraded' | 'package';
  received: boolean;
  summary?: string;
  // multi-agent
  context?: string;
  suggestion?: string;
  // ai-grading
  grade?: {
    score: number;
    maxScore: number;
    feedback: string;
    strengths: string[];
    weaknesses: string[];
    suggestions: string[];
    confidence: number;
    grader: string;
  };
  // learning-platform
  package?: unknown;
  packageName?: string;
  retryable?: boolean;
}

// ---------- 音韵识腔兜底核验（复用 /api/audio/recognize，见 AudioPage） ----------
interface RecognizeLyric {
  text: string;
}
interface RecognizeSchool {
  name: string;
  confidence: number;
  reason?: string;
}
interface RecognizeData {
  lyrics?: RecognizeLyric[];
  schools?: RecognizeSchool[];
  text?: string;
}

// 总分达到阈值后再请求识腔核验，核验结果单独展示。
const RECOGNIZE_THRESHOLD = 70;

const MAX_AUDIO_SIZE = 60 * 1024 * 1024; // 与后端上传限制一致
const UPLOAD_CHUNK_SIZE = 256 * 1024; // 小分片便于弱网下重试
const MAX_UPLOAD_ATTEMPTS = 4;

// 测评点评和批改结果共用同一套反馈展示。
function FeedbackDetails({ strengths, issues, suggestions }: {
  strengths: string[];
  issues: string[];
  suggestions: string[];
}) {
  return (
    <>
      <FeedbackTags label="亮点" items={strengths} positive />
      <FeedbackTags label="待改进" items={issues} />
      {suggestions.length > 0 && (
        <div style={{ marginTop: 12, fontSize: 13, lineHeight: 1.9, color: 'var(--ink-soft)' }}>
          <b style={{ color: 'var(--cinnabar)' }}>练习建议</b>
          {suggestions.map((suggestion, index) => (
            <p key={index} style={{ margin: '4px 0 0' }}>· {suggestion}</p>
          ))}
        </div>
      )}
    </>
  );
}

function FeedbackTags({ label, items, positive = false }: {
  label: string;
  items: string[];
  positive?: boolean;
}) {
  if (items.length === 0) return null;

  return (
    <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center', marginTop: positive ? 12 : 8 }}>
      <span style={{ fontSize: 12, color: positive ? '#1e6e40' : '#a93226', fontWeight: 600 }}>{label}</span>
      {items.map((text, index) => (
        <span key={index} className={`tag ${positive ? 'tag-cyan' : 'tag-cinnabar'}`}>{text}</span>
      ))}
    </div>
  );
}

async function getJson<T>(path: string): Promise<ApiResponse<T>> {
  const token = getToken();
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 15000);
  try {
    const resp = await fetch(`/api${path}`, {
      headers: token ? { Authorization: `Bearer ${token}` } : undefined,
      signal: controller.signal,
      cache: 'no-store',
    });
    return (await resp.json().catch(() => ({
      code: resp.status || -1,
      message: '服务器响应异常',
    }))) as ApiResponse<T>;
  } catch {
    return { code: -1, message: '网络异常，请重试', data: null as T };
  } finally {
    clearTimeout(timer);
  }
}

// 逐片上传；网络失败重试当前片，偏移不一致时按服务端位置续传。
async function uploadChunks(
  file: File,
  target: 'student' | 'ref',
  taskId: string,
  onProgress: (pct: number) => void,
): Promise<ApiResponse<unknown>> {
  const label = target === 'ref' ? '标准范本' : '我的演唱';
  let offset = 0;
  let attempt = 0;
  let resync = 0;
  while (offset < file.size) {
    const end = Math.min(offset + UPLOAD_CHUNK_SIZE, file.size);
    const form = new FormData();
    form.append('chunk', file.slice(offset, end), `${target}-${offset}.bin`);
    form.append('target', target);
    form.append('offset', String(offset));
    const res = await postForm<{
      nextOffset?: number;
      needResync?: boolean;
      serverOffset?: number;
    }>(`/singing-eval/chunk/${taskId}`, form, 120000);

    // 网络中断 / 超时 / CDN 5xx（含 524）：退避后重试同一片
    if (res.code === -1 || res.code >= 500) {
      if (++attempt >= MAX_UPLOAD_ATTEMPTS) {
        return { code: -1, message: `「${label}」上传中断，请检查网络后重试`, data: null };
      }
      await sleep(Math.min(1000 * 2 ** attempt, 8000));
      continue;
    }
    if (res.code !== 0) return res;

    const d = res.data as { nextOffset?: number; needResync?: boolean; serverOffset?: number } | null;
    if (d?.needResync) {
      if (++resync > 5) {
        return { code: -1, message: `「${label}」上传进度异常，请重新开始`, data: null };
      }
      offset = Number(d.serverOffset) || 0; // 以服务端实际写入位置为准续传
      attempt = 0;
      continue;
    }
    offset = typeof d?.nextOffset === 'number' ? d.nextOffset : end;
    attempt = 0;
    onProgress(Math.min(100, Math.round((offset / file.size) * 100)));
  }
  return { code: 0, message: 'ok', data: null };
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

// 上传前转成16kHz单声道WAV，与分析器采样率一致；重采样会改变音频。
async function compressTo16kMono(file: File): Promise<File> {
  try {
    const AC = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    const tmp = new AC();
    const buf = await tmp.decodeAudioData(await file.arrayBuffer());
    await tmp.close();
    const frames = Math.max(1, Math.ceil(buf.duration * 16000));
    const offline = new OfflineAudioContext(1, frames, 16000);
    const src = offline.createBufferSource();
    src.buffer = buf;
    src.connect(offline.destination);
    src.start();
    const rendered = await offline.startRendering();
    const wav = encodeWav([rendered.getChannelData(0)], 16000);
    const name = file.name.replace(/\.wav$/i, '') + '-16k.wav';
    return new File([wav], name, { type: 'audio/wav' });
  } catch {
    return file; // 解码失败（损坏文件等）退回原文件，交给后端报错
  }
}

/** 范本 SHA-256（用于服务端秒传缓存）；非安全上下文返回 null 走普通上传 */
async function sha256Hex(file: File): Promise<string | null> {
  try {
    if (!crypto?.subtle) return null;
    const digest = await crypto.subtle.digest('SHA-256', await file.arrayBuffer());
    return Array.from(new Uint8Array(digest)).map((b) => b.toString(16).padStart(2, '0')).join('');
  } catch {
    return null;
  }
}

// FormData 上传不能走共享 request()（会把 body JSON 化）；
// 分析耗时较长（DTW 计算），超时放宽到 150s
async function postForm<T>(
  path: string,
  form: FormData,
  timeoutMs = 150000,
): Promise<ApiResponse<T>> {
  const token = getToken();
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const resp = await fetch(`/api${path}`, {
      method: 'POST',
      headers: token ? { Authorization: `Bearer ${token}` } : undefined,
      body: form,
      signal: controller.signal,
    });
    return (await resp.json().catch(() => ({
      code: resp.status || -1,
      message: '服务器响应异常',
    }))) as ApiResponse<T>;
  } catch (err) {
    if (err instanceof Error && err.name === 'AbortError') {
      return { code: -1, message: path.startsWith('/singing-eval/chunk/')
        ? '音频上传超时，请检查网络后重试'
        : '音频识别请求超时，请稍后重试', data: null as T };
    }
    return { code: -1, message: '网络异常，请重试', data: null as T };
  } finally {
    clearTimeout(timer);
  }
}

async function postJson<T>(path: string, body: unknown): Promise<ApiResponse<T>> {
  const token = getToken();
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 60000);
  try {
    const resp = await fetch(`/api${path}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      body: JSON.stringify(body),
      signal: controller.signal,
    });
    return (await resp.json().catch(() => ({
      code: resp.status || -1,
      message: '服务器响应异常',
    }))) as ApiResponse<T>;
  } catch {
    return { code: -1, message: '网络异常，请重试', data: null as T };
  } finally {
    clearTimeout(timer);
  }
}

function fmtTime(sec: number): string {
  const m = Math.floor(sec / 60);
  const s = Math.floor(sec % 60);
  return `${m}:${String(s).padStart(2, '0')}`;
}

// ---------- 网页录音：PCM 分片 → 16bit 单声道 WAV ----------
function encodeWav(chunks: Float32Array[], sampleRate: number): Blob {
  const total = chunks.reduce((n, c) => n + c.length, 0);
  const buffer = new ArrayBuffer(44 + total * 2);
  const view = new DataView(buffer);
  const writeStr = (off: number, s: string) => {
    for (let i = 0; i < s.length; i++) view.setUint8(off + i, s.charCodeAt(i));
  };
  writeStr(0, 'RIFF');
  view.setUint32(4, 36 + total * 2, true);
  writeStr(8, 'WAVE');
  writeStr(12, 'fmt ');
  view.setUint32(16, 16, true); // fmt 块长度
  view.setUint16(20, 1, true); // PCM
  view.setUint16(22, 1, true); // 单声道
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * 2, true); // 字节率 = 采样率 × 2
  view.setUint16(32, 2, true); // 块对齐
  view.setUint16(34, 16, true); // 位深
  writeStr(36, 'data');
  view.setUint32(40, total * 2, true);
  let off = 44;
  for (const c of chunks) {
    for (let i = 0; i < c.length; i++) {
      const s = Math.max(-1, Math.min(1, c[i]));
      view.setInt16(off, s < 0 ? s * 0x8000 : s * 0x7fff, true);
      off += 2;
    }
  }
  return new Blob([buffer], { type: 'audio/wav' });
}

// ---------- 波形绘制：峰值波形 + 问题片段标色 ----------
interface Overlay {
  start: number;
  end: number;
  dim: 'pitch' | 'rhythm';
}

function drawWaveform(
  canvas: HTMLCanvasElement,
  buffer: AudioBuffer,
  overlays: Overlay[],
): void {
  const dpr = window.devicePixelRatio || 1;
  const cssW = canvas.clientWidth || 600;
  const cssH = canvas.clientHeight || 110;
  canvas.width = Math.round(cssW * dpr);
  canvas.height = Math.round(cssH * dpr);
  const ctx = canvas.getContext('2d');
  if (!ctx) return;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, cssW, cssH);

  const data = buffer.getChannelData(0);
  const dur = buffer.duration || 1;
  const axisH = 14; // 底部时间刻度区
  const waveH = cssH - axisH;
  const mid = waveH / 2;

  // 问题片段底色（音准=朱砂 / 节奏=赭石），先画底层
  for (const ov of overlays) {
    const x0 = Math.max(0, (ov.start / dur) * cssW);
    const x1 = Math.min(cssW, (ov.end / dur) * cssW);
    if (x1 <= x0) continue;
    const isPitch = ov.dim === 'pitch';
    ctx.fillStyle = isPitch ? 'rgba(193,39,45,0.13)' : 'rgba(139,90,60,0.15)';
    ctx.fillRect(x0, 0, x1 - x0, waveH);
    ctx.fillStyle = isPitch ? 'rgba(193,39,45,0.55)' : 'rgba(139,90,60,0.55)';
    ctx.fillRect(x0, 0, 1.5, waveH);
    ctx.fillRect(x1 - 1.5, 0, 1.5, waveH);
  }

  // 中线
  ctx.strokeStyle = 'rgba(26,26,26,0.12)';
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(0, mid);
  ctx.lineTo(cssW, mid);
  ctx.stroke();

  // 峰值波形：每像素一桶 min/max
  const buckets = Math.max(1, Math.floor(cssW));
  const step = Math.max(1, Math.floor(data.length / buckets));
  ctx.strokeStyle = 'rgba(26,26,26,0.55)';
  ctx.beginPath();
  for (let i = 0; i < buckets; i++) {
    const start = i * step;
    let min = 1;
    let max = -1;
    for (let j = 0; j < step && start + j < data.length; j++) {
      const v = data[start + j];
      if (v < min) min = v;
      if (v > max) max = v;
    }
    if (min > max) {
      min = 0;
      max = 0;
    }
    const y0 = mid - max * mid * 0.92;
    const y1 = mid - min * mid * 0.92;
    ctx.moveTo(i + 0.5, y0);
    ctx.lineTo(i + 0.5, Math.max(y1, y0 + 0.5));
  }
  ctx.stroke();

  // 时间刻度
  ctx.fillStyle = 'rgba(90,86,81,0.75)';
  ctx.font = '10px system-ui, sans-serif';
  const labelStep = dur > 60 ? 15 : dur > 30 ? 10 : 5;
  for (let t = 0; t <= dur + 0.01; t += labelStep) {
    const x = (t / dur) * cssW;
    ctx.fillRect(Math.min(x, cssW - 1), waveH, 1, 3);
    if (x < cssW - 26) ctx.fillText(fmtTime(t), x + 3, cssH - 3);
  }
}

// ---------- 分数环 ----------
function ScoreRing({ label, score, hint }: { label: string; score: number | null; hint: string }) {
  const pct = score === null ? 0 : Math.max(0, Math.min(100, score)) / 100;
  const r = 40;
  const c = 2 * Math.PI * r;
  const [animated, setAnimated] = useState(0);
  useEffect(() => {
    setAnimated(0);
    if (pct <= 0) return;
    const t = setTimeout(() => setAnimated(pct), 60);
    return () => clearTimeout(t);
  }, [pct]);
  return (
    <div className="se-score-card">
      <svg width="104" height="104" viewBox="0 0 104 104" aria-hidden="true">
        <circle cx="52" cy="52" r={r} fill="none" stroke="rgba(26,26,26,0.08)" strokeWidth="7" />
        <circle
          cx="52"
          cy="52"
          r={r}
          fill="none"
          stroke="var(--cinnabar)"
          strokeWidth="7"
          strokeLinecap="round"
          strokeDasharray={c}
          strokeDashoffset={c * (1 - animated)}
          transform="rotate(-90 52 52)"
          style={{ transition: 'stroke-dashoffset 0.9s cubic-bezier(0.22,1,0.36,1)' }}
        />
        <text x="52" y="50" textAnchor="middle" className="se-ring-num">
          {score === null ? '—' : score}
        </text>
        <text x="52" y="66" textAnchor="middle" className="se-ring-sub">
          参考分
        </text>
      </svg>
      <div className="se-score-label">{label}</div>
      <div className="se-score-hint">{hint}</div>
    </div>
  );
}

// ---------- 页面 ----------
export function SingingEvalPage() {
  const [stuFile, setStuFile] = useState<File | null>(null);
  const [refFile, setRefFile] = useState<File | null>(null);
  const [stuUrl, setStuUrl] = useState<string | null>(null);
  const [refUrl, setRefUrl] = useState<string | null>(null);
  const [analyzing, setAnalyzing] = useState(false);
  const [progressMsg, setProgressMsg] = useState<string | null>(null);
  const [report, setReport] = useState<EvalReport | null>(null);
  const [exporting, setExporting] = useState<string | null>(null);
  const [exportResult, setExportResult] = useState<ExportResult | null>(null);
  const [recording, setRecording] = useState<'idle' | 'recording' | 'done'>('idle');
  const [recSeconds, setRecSeconds] = useState(0);
  const [aiState, setAiState] = useState<'idle' | 'loading' | 'done' | 'error'>('idle');
  const [aiResult, setAiResult] = useState<AiFeedback | null>(null);
  const [recogState, setRecogState] = useState<'idle' | 'loading' | 'done' | 'error'>('idle');
  const [recogResult, setRecogResult] = useState<RecognizeData | null>(null);
  const recRef = useRef<{
    stream: MediaStream;
    ctx: AudioContext;
    source: MediaStreamAudioSourceNode;
    processor: ScriptProcessorNode;
    chunks: Float32Array[];
    sampleRate: number;
  } | null>(null);
  const recTimerRef = useRef<number | null>(null);

  const stuInputRef = useRef<HTMLInputElement>(null);
  const refInputRef = useRef<HTMLInputElement>(null);
  const stuCanvasRef = useRef<HTMLCanvasElement>(null);
  const refCanvasRef = useRef<HTMLCanvasElement>(null);
  const stuBufferRef = useRef<AudioBuffer | null>(null);
  const refBufferRef = useRef<AudioBuffer | null>(null);
  const audioRef = useRef<HTMLAudioElement>(null);
  const reportRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    document.title = '越韵智传 · 演唱测评';
    document.body.classList.add('page-singing-eval');
    return () => {
      document.body.classList.remove('page-singing-eval');
      if (stuUrl) URL.revokeObjectURL(stuUrl);
      if (refUrl) URL.revokeObjectURL(refUrl);
      // 离开页面时释放麦克风
      if (recTimerRef.current) clearInterval(recTimerRef.current);
      recRef.current?.stream.getTracks().forEach((t) => t.stop());
      recRef.current?.ctx.close().catch(() => {});
      recRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // 音频解码 + 波形绘制（文件或报告变化时重绘：报告到达后叠加问题片段标色）
  const renderWaveforms = useCallback((overlays: Overlay[]) => {
    if (stuBufferRef.current && stuCanvasRef.current) {
      drawWaveform(stuCanvasRef.current, stuBufferRef.current, overlays);
    }
    if (refBufferRef.current && refCanvasRef.current) {
      drawWaveform(refCanvasRef.current, refBufferRef.current, []);
    }
  }, []);

  useEffect(() => {
    if (!report) return;
    renderWaveforms(
      report.problem_segments.map((s) => ({
        start: s.start_time,
        end: s.end_time,
        dim: s.dim,
      })),
    );
    reportRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }, [report, renderWaveforms]);

  async function decodeToWave(file: File): Promise<AudioBuffer | null> {
    try {
      const AC = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
      const ctx = new AC();
      const buf = await ctx.decodeAudioData(await file.arrayBuffer());
      ctx.close();
      return buf;
    } catch {
      return null;
    }
  }

  function handleFile(kind: 'stu' | 'ref', file: File) {
    if (!file.name.toLowerCase().endsWith('.wav')) {
      toast('仅支持 WAV 格式音频', 'err');
      return;
    }
    if (file.size > MAX_AUDIO_SIZE) {
      toast('WAV 文件不能超过 60MB，唱段时长须为 3–120 秒', 'err');
      return;
    }
    setReport(null);
    if (kind === 'stu') {
      if (stuUrl) URL.revokeObjectURL(stuUrl);
      setStuFile(file);
      setStuUrl(URL.createObjectURL(file));
      stuBufferRef.current = null;
      decodeToWave(file).then((buf) => {
        if (buf) {
          stuBufferRef.current = buf;
          renderWaveforms([]);
        }
      });
    } else {
      if (refUrl) URL.revokeObjectURL(refUrl);
      setRefFile(file);
      setRefUrl(URL.createObjectURL(file));
      refBufferRef.current = null;
      decodeToWave(file).then((buf) => {
        if (buf) {
          refBufferRef.current = buf;
          renderWaveforms([]);
        }
      });
    }
  }

  const analyze = async () => {
    if (!stuFile || !refFile) {
      toast('请先上传「我的演唱」与「标准范本」两个 WAV 文件', 'err');
      return;
    }
    if (!isLoggedIn()) {
      toast('请先登录后进行测评', 'err');
      return;
    }
    setAnalyzing(true);
    setProgressMsg('准备上传…');
    setReport(null);
    setAiState('idle');
    setAiResult(null);
    setRecogState('idle');
    setRecogResult(null);

    // 上传前验证时长，与分析器限制保持一致，避免长时间上传后才被拒绝。
    setProgressMsg('检查音频时长…');
    const studentBuffer = await decodeToWave(stuFile);
    const referenceBuffer = await decodeToWave(refFile);
    for (const [label, buffer] of [['我的演唱', studentBuffer], ['标准范本', referenceBuffer]] as const) {
      if (!buffer || buffer.duration < 3 || buffer.duration > 120) {
        setAnalyzing(false);
        setProgressMsg(null);
        toast(!buffer ? `${label}无法解码，请使用有效的 WAV 文件`
          : `${label}为 ${buffer.duration.toFixed(1)} 秒，请截取 3–120 秒的唱段`, 'err', 5000);
        return;
      }
    }

    // ---- 上传前压缩：重采样 16kHz 单声道（分析器统一 16k，上传量约 1/3）----
    setProgressMsg('压缩音频中…');
    const stuUp = await compressTo16kMono(stuFile);
    const refUp = await compressTo16kMono(refFile);

    // ---- 分片上传 + 异步分析 + 轮询（长音频/弱网友好）----
    setProgressMsg('计算范本指纹…');
    const refHash = await sha256Hex(refUp);
    const init = await postJson<{ taskId: string; refCached: boolean }>('/singing-eval/chunk/init', {
      studentSize: stuUp.size,
      refSize: refUp.size,
      refHash: refHash ?? undefined,
    });
    if (init.code !== 0 || !init.data) {
      setAnalyzing(false);
      setProgressMsg(null);
      toast(init.message || '创建上传任务失败', 'err', 5000);
      return;
    }
    const taskId = init.data.taskId;
    const refCached = init.data.refCached === true;

    setProgressMsg('上传「我的演唱」…');
    const upStu = await uploadChunks(stuUp, 'student', taskId, (p) => {
      setProgressMsg(`上传「我的演唱」 ${p}%`);
    });
    if (upStu.code !== 0) {
      setAnalyzing(false);
      setProgressMsg(null);
      toast(upStu.message || '上传中断，请重试', 'err', 5000);
      return;
    }

    if (refCached) {
      setProgressMsg('「标准范本」服务器已有缓存，已秒传 ✓');
    } else {
      setProgressMsg('上传「标准范本」…');
      const upRef = await uploadChunks(refUp, 'ref', taskId, (p) => {
        setProgressMsg(`上传「标准范本」 ${p}%`);
      });
      if (upRef.code !== 0) {
        setAnalyzing(false);
        setProgressMsg(null);
        toast(upRef.message || '上传中断，请重试', 'err', 5000);
        return;
      }
    }

    setProgressMsg('排队分析…');
    const done = await postJson<{ status: string }>(`/singing-eval/chunk/${taskId}/complete`, {});
    if (done.code !== 0) {
      setAnalyzing(false);
      setProgressMsg(null);
      toast(done.message || '提交分析失败', 'err', 5000);
      return;
    }

    // 排队和实际计算分别计时；短暂网络中断可重试读取同一份结果。
    const startedAt = Date.now();
    let runningAt: number | null = null;
    let networkFailures = 0;
    let result: ApiResponse<EvalReport> | null = null;
    while (Date.now() - startedAt < 30 * 60 * 1000
      && (runningAt === null || Date.now() - runningAt < 15 * 60 * 1000 + 30000)) {
      await sleep(3000);
      const st = await getJson<EvalReport | { status: string }>(`/singing-eval/task/${taskId}`);
      if ((st.code === -1 || st.code >= 500) && ++networkFailures <= 3) {
        setProgressMsg('网络连接暂时中断，正在重新获取测评进度…');
        continue;
      }
      if (st.code !== 0) {
        result = st as ApiResponse<EvalReport>;
        break;
      }
      networkFailures = 0;
      if (st.data && 'total_score' in (st.data as EvalReport)) {
        result = { code: 0, message: 'ok', data: st.data as EvalReport };
        break;
      }
      if (st.data && 'status' in st.data) {
        if (st.data.status === 'running' && runningAt === null) runningAt = Date.now();
        const sec = Math.round((Date.now() - (runningAt ?? startedAt)) / 1000);
        setProgressMsg(st.data.status === 'queued'
          ? `等待前面的测评完成… 已排队 ${sec} 秒`
          : `正在比对音准与板眼… 已分析 ${sec} 秒`);
      }
    }
    setAnalyzing(false);
    setProgressMsg(null);
    if (!result) {
      toast(runningAt === null ? '测评排队等待过久，请稍后重试'
        : '演唱计算超时，请使用更短的唱段重试；若持续失败，请联系管理员', 'err', 5000);
      return;
    }
    if (result.code !== 0 || !result.data) {
      toast(result.message || '测评失败', 'err', 5000);
      return;
    }
    setReport(result.data);
    toast('测评完成（分数为参考分）', 'ok');
    // 达到阈值：自动调用识腔 AI 交叉核验（兜底提升可信度）
    if (result.data.total_score >= RECOGNIZE_THRESHOLD) {
      runRecognition();
    }
  };

  // ---------- 网页录音（我的演唱）----------
  const startRecord = async () => {
    if (!navigator.mediaDevices?.getUserMedia) {
      toast('当前浏览器不支持网页录音，请改用上传 WAV', 'err');
      return;
    }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const AC = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
      const ctx = new AC();
      const source = ctx.createMediaStreamSource(stream);
      const processor = ctx.createScriptProcessor(4096, 1, 1);
      const chunks: Float32Array[] = [];
      processor.onaudioprocess = (e) => {
        chunks.push(new Float32Array(e.inputBuffer.getChannelData(0)));
      };
      source.connect(processor);
      processor.connect(ctx.destination);
      recRef.current = { stream, ctx, source, processor, chunks, sampleRate: ctx.sampleRate };
      setRecording('recording');
      setRecSeconds(0);
      recTimerRef.current = window.setInterval(() => setRecSeconds((s) => s + 1), 1000);
      toast('正在录音，请清唱（建议 3 秒 - 2 分钟）', 'ok');
    } catch {
      toast('麦克风授权失败或被拒绝，无法录音', 'err');
    }
  };

  const stopRecord = () => {
    const rec = recRef.current;
    if (!rec) return;
    if (recTimerRef.current) {
      clearInterval(recTimerRef.current);
      recTimerRef.current = null;
    }
    rec.processor.disconnect();
    rec.source.disconnect();
    rec.stream.getTracks().forEach((t) => t.stop());
    rec.ctx.close().catch(() => {});
    const wav = encodeWav(rec.chunks, rec.sampleRate);
    const file = new File([wav], '我的演唱-网页录音.wav', { type: 'audio/wav' });
    recRef.current = null;
    handleFile('stu', file); // 复用上传槽位：波形、播放、测评一条链路
    setRecording('done');
    toast('录音完成，已填入「我的演唱」', 'ok');
  };

  // ---------- AI 测准点评 ----------
  const runAi = async () => {
    if (!report) return;
    setAiState('loading');
    const res = await postJson<AiFeedback>('/singing-eval/ai-feedback', { report });
    if (res.code === 0 && res.data) {
      setAiResult(res.data);
      setAiState('done');
      toast('AI 测准完成（供教学参考）', 'ok');
    } else {
      setAiState('error');
      toast(res.message || 'AI 测准失败', 'err', 5000);
    }
  };

  // ---------- AI 识腔兜底核验（音韵识腔）----------
  const runRecognition = async () => {
    if (!stuFile) return;
    setRecogState('loading');
    const form = new FormData();
    form.append('audio', stuFile);
    const res = await postForm<RecognizeData>('/audio/recognize', form, 120000);
    if (res.code === 0 && res.data) {
      setRecogResult(res.data);
      setRecogState('done');
    } else {
      setRecogState('error');
      toast(res.message || '识腔核验失败，可点击重试', 'err', 5000);
    }
  };

  const exportTo = async (target: string) => {
    if (!report) return;
    setExporting(target);
    setExportResult(null);
    const res = await postJson<ExportResult>('/singing-eval/export/' + target, { report });
    setExporting(null);
    if (res.code !== 0 || !res.data) {
      toast(res.message || '报告流转失败，请稍后重试', 'err', 5000);
      return;
    }
    setExportResult(res.data);
    toast(res.data.summary || '已处理', res.data.status === 'ok' ? 'ok' : 'err', 4500);
  };

  // 下载学习通作业包（无开放接口时的降级产物）
  const downloadPackage = () => {
    const pkg = exportResult?.package;
    if (!pkg) return;
    const blob = new Blob([JSON.stringify(pkg, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = exportResult?.packageName || 'yueyun-singing-eval.json';
    a.click();
    URL.revokeObjectURL(url);
  };

  // 点击问题片段：播放器定位到片段起点试听
  function seekTo(start: number) {
    const audio = audioRef.current;
    if (!audio) return;
    audio.currentTime = start;
    audio.play();
  }

  return (
    <main className="main">
      <div className="container" style={{ paddingTop: 8 }}>
        <section className="page-hero">
          <div className="ink-wash ink-wash-1" style={{ background: 'var(--cyan)', left: '12%' }} />
          <div className="ink-wash ink-wash-2" style={{ background: 'var(--ochre)', right: '12%', opacity: 0.15 }} />
          <div className="hero-seal">
            <span className="seal seal-vertical">测评</span>
          </div>
          <h1>
            演唱测评 <AiBadge style={{ fontSize: 12, padding: '2px 10px' }} />
          </h1>
        </section>
        <AiNotice text="本页测评报告由人工智能音频分析算法自动生成，仅评估音准与节奏板眼两个维度，属教学演示参考分，不能替代专业教师听辨评分。" />

        {/* 合规提示（硬性要求：页面显眼位置强制展示） */}
        <div className="se-disclaimer" role="note">
          <span className="se-disclaimer-icon">鉴</span>
          <div>
            <strong>本音频测评仅为教学演示参考，不能替代专业老师听辨打分。</strong>
            所有分数均为【参考分】：仅评估<b>音准</b>与<b>节奏板眼</b>两个维度，
            <b>不识别咬字、润腔、尖团字、气息</b>；带伴奏音频抗噪能力有限，安静环境清唱效果最佳。
          </div>
        </div>

        {/* 上传区 */}
        <div className="scroll-frame">
          <div className="section-title">
            <span className="st-text">上传音频</span>
            <span className="st-line" />
          </div>

          {/* 网页直接录音（我的演唱） */}
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 14,
              flexWrap: 'wrap',
              marginBottom: 16,
              padding: '12px 16px',
              border: '1px solid rgba(193,39,45,.22)',
              borderRadius: 12,
              background: 'rgba(193,39,45,.04)',
            }}
          >
            <div style={{ flex: 1, minWidth: 220 }}>
              <div style={{ fontWeight: 600, fontSize: 14, color: 'var(--cinnabar)', letterSpacing: '.05em' }}>
                ① 网页直接录音（我的演唱）
              </div>
              <div style={{ fontSize: 12, color: 'var(--ink-light)', marginTop: 4 }}>
                授权麦克风后清唱，停止后自动填入「我的演唱」；也可继续用上传 WAV
              </div>
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
              {recording === 'idle' && (
                <button className="btn btn-primary" onClick={startRecord}>开始录音</button>
              )}
              {recording === 'recording' && (
                <>
                  <span style={{ color: 'var(--cinnabar)', fontWeight: 600, fontSize: 13 }}>
                    ● 录音中 {fmtTime(recSeconds)}
                  </span>
                  <button className="btn btn-primary" onClick={stopRecord}>停止并采用</button>
                </>
              )}
              {recording === 'done' && (
                <>
                  <span className="tag tag-cyan">已录音 {fmtTime(recSeconds)}，已填入「我的演唱」</span>
                  <button className="btn btn-ghost" onClick={startRecord}>重新录音</button>
                </>
              )}
            </div>
          </div>

          <div className="se-upload-grid">
            {(
              [
                {
                  kind: 'stu' as const,
                  icon: '唱',
                  title: '我的演唱',
                  hint: 'WAV 格式，3 秒 - 2 分钟，安静环境清唱',
                  file: stuFile,
                  url: stuUrl,
                  inputRef: stuInputRef,
                  canvasRef: stuCanvasRef,
                  accept: '.wav',
                },
                {
                  kind: 'ref' as const,
                  icon: '范',
                  title: '标准范本',
                  hint: '老师范唱或教学音频，WAV 格式',
                  file: refFile,
                  url: refUrl,
                  inputRef: refInputRef,
                  canvasRef: refCanvasRef,
                  accept: '.wav',
                },
              ]
            ).map((cfg) => (
              <div key={cfg.kind} className="se-upload-card">
                <div
                  className="upload-zone se-upload-zone"
                  onClick={() => cfg.inputRef.current?.click()}
                  onDragOver={(e) => e.preventDefault()}
                  onDrop={(e) => {
                    e.preventDefault();
                    if (e.dataTransfer.files.length) handleFile(cfg.kind, e.dataTransfer.files[0]);
                  }}
                >
                  <div className="up-icon">{cfg.icon}</div>
                  <div className="up-title">{cfg.file ? cfg.file.name : `上传「${cfg.title}」`}</div>
                  <div className="up-hint">{cfg.hint}</div>
                  <input
                    type="file"
                    ref={cfg.inputRef}
                    accept={cfg.accept}
                    hidden
                    onChange={(e) => {
                      if (e.target.files?.length) handleFile(cfg.kind, e.target.files[0]);
                    }}
                  />
                </div>
                {cfg.file && (
                  <div className="se-wave-block">
                    <div className="se-wave-label">
                      {cfg.title}波形
                      {cfg.kind === 'stu' && report ? '（标色处为与范本偏差较大的片段）' : ''}
                    </div>
                    <canvas ref={cfg.canvasRef} className="se-wave-canvas" />
                    <div className="audio-player" style={{ marginTop: 8 }}>
                      <audio
                        controls
                        ref={cfg.kind === 'stu' ? audioRef : undefined}
                        src={cfg.url ?? undefined}
                      />
                      {cfg.kind === 'stu' && (
                        <span className="tag tag-cinnabar" style={{ flexShrink: 0 }}>
                          点击报告片段可定位试听
                        </span>
                      )}
                    </div>
                  </div>
                )}
              </div>
            ))}
          </div>

          <div className="se-analyze-row">
            <button
              className="btn btn-primary btn-lg"
              disabled={analyzing || !stuFile || !refFile}
              onClick={analyze}
            >
              {analyzing ? (
                <>
                  <span className="spinner" style={{ width: 16, height: 16, borderWidth: 2 }} /> 分析中…
                </>
              ) : (
                '开始测评'
              )}
            </button>
            <span className="se-analyze-hint">
              上传后自动开始比对：基频提取 → DTW 对齐 → 音准 / 板眼偏差分析
            </span>
          </div>
        </div>

        {/* 分析等待动画 */}
        {analyzing && (
          <div className="scroll-frame se-analyzing">
            <InkGrinding text={progressMsg || '正在研墨品韵：提取音高、对齐时间轴、比对板眼…'} />
          </div>
        )}

        {/* 测评报告 */}
        {report && (
          <div className="se-report" ref={reportRef}>
            <div className="scroll-frame">
              <div className="section-title">
                <span className="st-text">测评报告</span>
                <span className="st-line" />
                <span className="tag tag-cinnabar">参考分 · 教学演示</span>
                <AiBadge />
              </div>
              <AiNotice text="本报告由人工智能音频分析算法自动计算生成，仅评估音准与节奏板眼两个维度，属教学演示参考分，不能替代专业教师的听辨评分。" />

              {/* 分数 */}
              <div className="se-scores">
                <ScoreRing
                  label="总参考分"
                  score={report.total_score}
                  hint={
                    report.rhythm_score === null
                      ? '板眼点不足，按音准折算'
                      : '音准 60% + 板眼 40%'
                  }
                />
                <ScoreRing
                  label="音准参考分"
                  score={report.pitch_score}
                  hint={
                    report.stats.median_abs_dev_cents !== undefined
                      ? `中位偏差 ${report.stats.median_abs_dev_cents} 音分`
                      : ''
                  }
                />
                <ScoreRing
                  label="节奏板眼参考分"
                  score={report.rhythm_score}
                  hint={
                    report.rhythm_score === null
                      ? (report.stats.note || '板眼点不足，未分析')
                      : report.stats.tempo_ratio !== undefined
                        ? `演唱/范本时长比 ${report.stats.tempo_ratio}`
                        : ''
                  }
                />
              </div>

              {/* 范围声明（随报告再次展示，硬性要求） */}
              <div className="se-scope">{report.scope} · {report.disclaimer}</div>

              {/* 问题片段 */}
              <div className="se-seg-title">
                <span className="se-legend">
                  <i className="se-dot se-dot-pitch" /> 音准偏差
                </span>
                <span className="se-legend">
                  <i className="se-dot se-dot-rhythm" /> 板眼偏差
                </span>
              </div>
              {report.problem_segments.length === 0 ? (
                <div className="knowledge-empty">
                  <div className="empty-icon">佳</div>
                  <div>未发现与范本偏差较大的片段，继续保持</div>
                </div>
              ) : (
                <div className="se-segment-list">
                  {report.problem_segments.map((seg, i) => (
                    <button
                      key={i}
                      className={`se-segment-item se-seg-${seg.dim}`}
                      style={{ animation: `fadeUp 0.4s ${Math.min(i * 0.06, 0.5)}s both` }}
                      onClick={() => seekTo(seg.start_time)}
                      title="点击定位到该片段试听"
                    >
                      <span className="se-seg-time">
                        {fmtTime(seg.start_time)} – {fmtTime(seg.end_time)}
                      </span>
                      <span className={`tag ${seg.dim === 'pitch' ? 'tag-cinnabar' : 'tag-cyan'}`}>
                        {seg.dim === 'pitch' ? '音准' : '板眼'}
                      </span>
                      <span className="se-seg-desc">{seg.problem_desc}</span>
                    </button>
                  ))}
                </div>
              )}

              {/* 练习建议 */}
              <div className="se-suggestion">
                <div className="se-suggestion-title">练习建议</div>
                <p>{report.suggestion}</p>
              </div>

              {/* AI 测准点评 */}
              <div className="se-ai" style={{ marginTop: 20 }}>
                <div className="section-title" style={{ marginBottom: 12 }}>
                  <span className="st-text">AI 测准点评</span>
                  <span className="st-line" />
                  {aiState !== 'loading' && (
                    <button
                      className="btn btn-brush btn-sm"
                      style={{ marginLeft: 'auto' }}
                      onClick={runAi}
                      disabled={aiState === 'done'}
                    >
                      {aiState === 'done' ? '已测准 · 重新点评' : '调用 AI 测评准确度'}
                    </button>
                  )}
                </div>

                {aiState === 'loading' && (
                  <div className="scroll-frame se-analyzing" style={{ padding: '18px 0' }}>
                    <InkGrinding text="AI 正在品鉴音准与板眼，解读测评数据…" />
                  </div>
                )}

                {aiState === 'error' && (
                  <div
                    className="ci-verdict bad"
                    style={{ padding: '12px 16px', borderRadius: 10, fontSize: 13, background: 'rgba(192,57,43,.08)', border: '1px solid rgba(192,57,43,.3)', color: '#a93226' }}
                  >
                    AI 测准服务暂不可用，请稍后重试（也可直接使用上方算法参考分）。
                  </div>
                )}

                {aiState === 'done' && aiResult && (
                  <div style={{ border: '1px solid rgba(196,160,97,.4)', borderRadius: 14, background: '#fbf7ee', padding: '18px 20px' }}>
                    <div style={{ display: 'flex', gap: 22, alignItems: 'center', flexWrap: 'wrap' }}>
                      <ScoreRing label="AI 测准参考分" score={aiResult.ai_score} hint="AI 综合算法数据评定" />
                      <div style={{ flex: 1, minWidth: 240 }}>
                        <div style={{ fontSize: 14, lineHeight: 1.9, color: 'var(--ink-soft)' }}>{aiResult.summary}</div>
                      </div>
                    </div>
                    <FeedbackDetails
                      strengths={aiResult.strengths}
                      issues={aiResult.issues}
                      suggestions={aiResult.suggestions}
                    />
                    <div style={{ marginTop: 12, fontSize: 11, color: 'var(--ink-light)' }}>
                      AI 点评基于算法测评数据生成，分数为参考分，仅供教学演示，不能替代专业老师听辨打分。
                    </div>
                  </div>
                )}
              </div>

              {/* AI 识腔兜底核验：算法总评达标后，识腔 AI 实际听取音频交叉核验 */}
              {report.total_score >= RECOGNIZE_THRESHOLD && (
                <div className="se-ai" style={{ marginTop: 20 }}>
                  <div className="section-title" style={{ marginBottom: 12 }}>
                    <span className="st-text">AI 识腔兜底核验</span>
                    <span className="st-line" />
                    {recogState === 'done' && (
                      <button
                        className="btn btn-brush btn-sm"
                        style={{ marginLeft: 'auto' }}
                        onClick={runRecognition}
                      >
                        重新核验
                      </button>
                    )}
                  </div>

                  {recogState === 'loading' && (
                    <div className="scroll-frame se-analyzing" style={{ padding: '18px 0' }}>
                      <InkGrinding text="识腔 AI 正在听取演唱，识别唱词与流派…" />
                    </div>
                  )}

                  {recogState === 'error' && (
                    <div
                      style={{
                        padding: '12px 16px',
                        borderRadius: 10,
                        fontSize: 13,
                        background: 'rgba(192,57,43,.08)',
                        border: '1px solid rgba(192,57,43,.3)',
                        color: '#a93226',
                      }}
                    >
                      识腔核验失败，可点击上方「重新核验」重试。
                    </div>
                  )}

                  {recogState === 'done' && recogResult && (
                    <div style={{ border: '1px solid rgba(196,160,97,.4)', borderRadius: 14, background: '#fbf7ee', padding: '18px 20px' }}>
                      <div style={{ fontSize: 12, color: 'var(--ink-light)', marginBottom: 10 }}>
                        AI 已实际听取这段演唱音频，识别唱词与流派，用于交叉核验演唱准确度。
                      </div>
                      <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', marginBottom: 12 }}>
                        {(recogResult.schools || []).map((s, i) => {
                          const pct = Math.round(s.confidence * 100);
                          return (
                            <span
                              key={`${s.name}-${i}`}
                              className={`tag ${i === 0 ? 'tag-cinnabar' : ''}`}
                              title={s.reason || ''}
                            >
                              {s.name} · 置信 {pct}%
                            </span>
                          );
                        })}
                        {(recogResult.schools || []).length === 0 && <span className="tag">无法判定流派</span>}
                      </div>
                      <div style={{ fontSize: 13, lineHeight: 2, color: 'var(--ink-soft)' }}>
                        {(recogResult.lyrics || []).length === 0
                          ? '未识别到唱词'
                          : (recogResult.lyrics || []).map((l, i) => (
                              <span key={i}>
                                <b style={{ color: 'var(--cinnabar)', marginRight: 6 }}>{i + 1}</b>
                                {l.text}
                                <br />
                              </span>
                            ))}
                      </div>
                    </div>
                  )}
                </div>
              )}

              {/* 报告流转：展示各目标实际返回的状态 */}
              <div className="se-export-row">
                <span className="se-export-label">报告流转：</span>
                <button
                  className="btn btn-ghost btn-sm"
                  disabled={exporting !== null}
                  onClick={() => exportTo('multi-agent')}
                >
                  {exporting === 'multi-agent' ? '整理中…' : '发送至多智能体'}
                </button>
                <button
                  className="btn btn-ghost btn-sm"
                  disabled={exporting !== null}
                  onClick={() => exportTo('ai-grading')}
                >
                  {exporting === 'ai-grading' ? '批改中…' : '提交 AI 批改'}
                </button>
                <button
                  className="btn btn-ghost btn-sm"
                  disabled={exporting !== null}
                  onClick={() => exportTo('learning-platform')}
                >
                  {exporting === 'learning-platform' ? '推送中…' : '推送学习通作业'}
                </button>
              </div>

              {/* 报告流转结果面板 */}
              {exportResult && (
                <div
                  style={{
                    border: '1px solid rgba(196,160,97,.4)',
                    borderRadius: 14,
                    background: '#fbf7ee',
                    padding: '18px 20px',
                    marginTop: 14,
                  }}
                >
                  <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
                    <b style={{ fontSize: 14, color: 'var(--cinnabar)' }}>
                      {exportResult.target === 'multi-agent' && '多智能体上下文'}
                      {exportResult.target === 'ai-grading' && 'AI 批改结果'}
                      {exportResult.target === 'learning-platform' && '学习通作业提交'}
                    </b>
                    <span
                      className={exportResult.status === 'ok' ? 'tag tag-cyan' : 'tag tag-cinnabar'}
                      style={{ fontSize: 11 }}
                    >
                      {exportResult.status === 'ok' ? '已完成' : exportResult.status === 'package' ? '已生成作业包' : '已降级处理'}
                    </span>
                    <button
                      className="btn btn-ghost btn-sm"
                      style={{ marginLeft: 'auto' }}
                      onClick={() => setExportResult(null)}
                    >
                      收起
                    </button>
                  </div>

                  {exportResult.summary && (
                    <div style={{ marginTop: 10, fontSize: 13, lineHeight: 1.9, color: 'var(--ink-soft)' }}>
                      {exportResult.summary}
                    </div>
                  )}

                  {/* 多智能体：展示可注入的上下文 */}
                  {exportResult.target === 'multi-agent' && exportResult.context && (
                    <div style={{ marginTop: 12 }}>
                      <div style={{ fontSize: 12, color: 'var(--ink-light)', marginBottom: 6 }}>
                        已整理为专家上下文，可直接粘贴到多智能体对话：
                      </div>
                      <pre
                        style={{
                          margin: 0, padding: 12, borderRadius: 10, background: '#fff',
                          border: '1px solid rgba(196,160,97,.3)', fontSize: 12,
                          lineHeight: 1.8, whiteSpace: 'pre-wrap', maxHeight: 220, overflow: 'auto',
                        }}
                      >
                        {exportResult.context}
                      </pre>
                    </div>
                  )}

                  {/* AI 批改：分数 + 评语 + 亮点/不足/建议 */}
                  {exportResult.target === 'ai-grading' && exportResult.grade && (
                    <div>
                      <div style={{ display: 'flex', gap: 22, alignItems: 'center', flexWrap: 'wrap', marginTop: 12 }}>
                        <ScoreRing
                          label="AI 批改得分"
                          score={exportResult.grade.score}
                          hint={exportResult.grade.grader}
                        />
                        <div style={{ flex: 1, minWidth: 240 }}>
                          <div style={{ fontSize: 14, lineHeight: 1.9, color: 'var(--ink-soft)' }}>
                            {exportResult.grade.feedback}
                          </div>
                        </div>
                      </div>
                      <FeedbackDetails
                        strengths={exportResult.grade.strengths}
                        issues={exportResult.grade.weaknesses}
                        suggestions={exportResult.grade.suggestions}
                      />
                    </div>
                  )}

                  {/* 学习通：下载作业包 */}
                  {exportResult.target === 'learning-platform' && exportResult.package != null && (
                    <div style={{ marginTop: 12 }}>
                      <button className="btn btn-ghost btn-sm" onClick={downloadPackage}>
                        下载作业包（{exportResult.packageName}）
                      </button>
                      <div style={{ fontSize: 11, color: 'var(--ink-light)', marginTop: 8, lineHeight: 1.7 }}>
                        作业包为标准 JSON，含总分、音准/节奏分、偏差片段与建议，可直接作为附件提交到学习通。
                      </div>
                    </div>
                  )}

                  <div style={{ marginTop: 12, fontSize: 11, color: 'var(--ink-light)' }}>
                    分数为参考分，仅供教学演示，不能替代专业老师听辨打分。
                  </div>
                </div>
              )}

              <div className="se-meta">
                范本 {fmtTime(report.meta.ref_duration)} · 演唱 {fmtTime(report.meta.stu_duration)} ·
                分析耗时 {(report.meta.elapsed_ms / 1000).toFixed(1)}s · v{report.meta.version}
              </div>
            </div>
          </div>
        )}
      </div>
    </main>
  );
}
