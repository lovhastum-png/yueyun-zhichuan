"""
越剧姿态比对评分服务（FastAPI sidecar · WebSocket）
=====================================================================
【定位】为「虚拟试衣 · 姿态挑战」提供标准动作比对与实时打分。

浏览器端(virtual-tryon.html) 已在本地跑 MediaPipe Pose，把 33 个
归一化关键点按 ~8fps 通过 WebSocket 发来；本服务做：
  关键点 -> 平移+尺度不变特征(99维) -> z-score 标准化
  -> 滑动窗口 DTW 与标准模板比对 -> 0~100 实时分数 + 纠正提示。

标准模板两种来源：
  1. 内置合成「云手」身段（演示用）；
  2. 页面「录制模板」按钮实录的身段（存 templates/*.json）。

【协议】(JSON over ws://127.0.0.1:8767/ws/pose)
  client -> server:
    {type:'start', actionId}          开始一次挑战
    {type:'frame', landmarks, ts}     关键点帧 [[x,y,z,visibility]×33]
    {type:'finish'}                   结束并返回成绩
    {type:'record_start'}             开始录制模板
    {type:'record_stop', name}        结束录制并保存模板
  server -> client:
    {type:'hello', actions:[...]}
    {type:'score', status, score, poseDetected, completion, hints}
    {type:'result', best, avg, completion, frames, hints}
    {type:'record_done', action, actions}
    {type:'error', message}

【协议 v2】(JSON over ws://127.0.0.1:8767/ws/pose-v2)
  —— 身段测评页（SPA /pose-eval）使用：浏览器端 MediaPipe Pose+Hands
     就地折算 20 维关节角特征（手出画面维度为 null），服务端做
     模板库识别 + DTW 打分（见 joint_angle.py / template_store_v2.py）。
  client -> server:
    {type:'start', actionId}          选定身段挑战模式
    {type:'start_free'}               自由跟练识别模式（全库识别）
    {type:'frame', features, ts}      20 维关节角帧（度，null=该维缺失）
    {type:'finish'}                   结束并返回成绩
    {type:'record_start'}             开始录制模板
    {type:'record_stop', name}        结束录制并保存为 v2 模板
  server -> client:
    {type:'hello', actions:[...]}
    {type:'started', actionId, mode}
    {type:'score', mode, status, score, completion, hints, recognized?, scores?}
    {type:'result', mode, best, avg, completion, frames, hints, recognized?, scores?}
    {type:'record_done', ok, action?, message, actions}
    {type:'error', message}

【REST v2】（供 Node 网关转发，模板库管理）
  GET    /actions-v2                身段列表
  POST   /templates-v2              保存一段特征序列为模板（视频导入）
  DELETE /actions-v2/{action_id}    删除自录/导入身段（网关层校验教师权限）

【部署】仅绑定 127.0.0.1:8767，页面直连；不鉴权、不落库（成绩仅本次会话）。
【启动】uvicorn app:app --host 127.0.0.1 --port 8767
=====================================================================
"""
from __future__ import annotations

import json
import re
import time
from collections import deque
from pathlib import Path

import numpy as np
from fastapi import FastAPI, HTTPException, WebSocket, WebSocketDisconnect
from fastapi.middleware.cors import CORSMiddleware

import pose_match as pm
import joint_angle as ja
import template_store_v2 as store_v2

TEMPLATES_DIR = Path(__file__).parent / 'templates'
TEMPLATES_V2_DIR = Path(__file__).parent / 'templates_v2'
MIN_TEMPLATE_FRAMES = 15      # 模板最少帧数（约 2 秒 @8fps）
MAX_TEMPLATE_FRAMES = 240     # 模板最多帧数（约 30 秒）
READY_STABLE_FRAMES = 5       # 连续检测到姿态的帧数达到该值视为 ready
MAX_BUFFER_FRAMES = 200

# 参考身段动画下发的骨架关节（MediaPipe 索引）：鼻 + 肩肘腕 + 髋膝
DEMO_JOINTS = [0, 11, 12, 13, 14, 15, 16, 23, 24, 25, 26]
DEMO_KEYFRAMES = 14           # 降采样关键帧数（供页面循环播放）


def _demo_skeleton(template: np.ndarray, mean: np.ndarray, std: np.ndarray) -> list:
    """从标准化模板反演出参考骨架关键帧，供页面画「参考小人」。

    模板是 z-score 后的特征 (L, 99)；反归一化得到髋中心+肩宽尺度下的
    原始特征，再降采样到 DEMO_KEYFRAMES 帧、只保留骨架关节的 (x, y)。
    """
    safe_std = np.where(std > pm.STD_FLOOR, std, 1.0)
    raw = template * safe_std + mean          # (L, 99) 髋中心/肩宽尺度
    L = raw.shape[0]
    n = min(DEMO_KEYFRAMES, L)
    idx = np.round(np.linspace(0, L - 1, n)).astype(int)
    frames = []
    for f in raw[idx]:
        pts = f.reshape(pm.N_POINTS, 3)
        frames.append([[round(float(pts[j][0]), 3), round(float(pts[j][1]), 3)]
                       for j in DEMO_JOINTS])
    return frames

app = FastAPI(
    title='越剧姿态比对评分服务',
    description='浏览器关键点流 -> DTW 滑窗比对 -> 实时打分（教学演示）',
    version='1.0.0',
)

# 页面从 localhost:3000 直连本服务，跨域放开（仅本机回环，无公网暴露）
app.add_middleware(
    CORSMiddleware,
    allow_origins=['*'],
    allow_methods=['*'],
    allow_headers=['*'],
)

_actions: dict[str, dict] = {}


def _action_entry(action_id: str, name: str, frames: int, template: np.ndarray,
                  mean: np.ndarray, std: np.ndarray, builtin: bool) -> dict:
    return {
        'id': action_id, 'name': name, 'frames': int(frames), 'builtin': builtin,
        'template': template, 'mean': mean, 'std': std,
        'demo': _demo_skeleton(template, mean, std),
    }


def _load_builtin() -> None:
    landmarks = pm.make_cloud_hand_landmarks(60)
    feats = [pm.pose_feature_vector(f) for f in landmarks]
    raw = np.stack([f for f in feats if f is not None])
    template_s, mean, std = pm.standardize(raw)
    _actions['yunshou'] = _action_entry(
        'yunshou', '云手 · 基础身段（内置演示）', raw.shape[0], template_s, mean, std, True)


def _load_recorded() -> None:
    if not TEMPLATES_DIR.is_dir():
        return
    for path in sorted(TEMPLATES_DIR.glob('*.json')):
        try:
            data = json.loads(path.read_text(encoding='utf-8'))
            template = np.asarray(data['template'], dtype=np.float64)
            mean = np.asarray(data['mean'], dtype=np.float64)
            std = np.asarray(data['std'], dtype=np.float64)
            if template.ndim != 2 or template.shape[0] < MIN_TEMPLATE_FRAMES:
                continue
            _actions[data['id']] = _action_entry(
                data['id'], data['name'], template.shape[0], template, mean, std, False)
        except Exception as exc:  # 单个模板损坏不影响其余
            print(f'[pose-eval] 模板加载失败 {path.name}: {exc}')


def _action_list() -> list[dict]:
    return [
        {'id': a['id'], 'name': a['name'], 'frames': a['frames'], 'builtin': a['builtin'],
         'demo': a['demo']}
        for a in _actions.values()
    ]


# ============================================================
# v2 身段模板库（关节角特征，见 joint_angle.py / template_store_v2.py）
# ============================================================
_actions_v2: dict[str, dict] = {}

# 识别模式每动作只用代表模板（平均模板优先），控制全库比对开销
MAX_IMPORT_ROWS = 600        # 视频导入特征序列行数上限（约 40 秒 @15fps）
SCORE_EVERY_N_FRAMES = 2     # 挑战模式每 N 帧打分一次
FREE_EVERY_N_FRAMES = 4      # 识别模式每 N 帧全库识别一次
FREE_STABLE_ROUNDS = 2       # 连续两轮一致后才给出识别结果，抑制单次误判


def _load_v2() -> None:
    _actions_v2.clear()
    _actions_v2.update(store_v2.load_templates(TEMPLATES_V2_DIR))


def _parse_demo_joints(val):
    """前端帧消息/导入请求里的 demo 字段：11 个 [x,y] 归一化坐标，非法返回 None。"""
    if not isinstance(val, list) or len(val) != 11:
        return None
    out = []
    for p in val:
        if not isinstance(p, (list, tuple)) or len(p) != 2:
            return None
        try:
            x, y = float(p[0]), float(p[1])
        except (TypeError, ValueError):
            return None
        import math as _m
        if not (_m.isfinite(x) and _m.isfinite(y)):
            return None
        out.append([x, y])
    return out


def _demo_from_raw(demo_raw, keyframes=20):
    """存储的 MediaPipe 归一化骨架 -> 绘图单位（髋中心原点、满肩宽=1、镜像 x）。

    返回降采样后的关键帧列表；数据非法返回 None。
    """
    d = np.asarray(demo_raw, dtype=np.float64)
    if d.ndim != 3 or d.shape[1] != 11 or d.shape[2] != 2 or len(d) < 2:
        return None
    n = min(keyframes, len(d))
    idx = np.round(np.linspace(0, len(d) - 1, n)).astype(int)
    frames = []
    for f in d[idx]:
        ls, rs, lh, rh = f[1], f[2], f[7], f[8]
        cx = (lh[0] + rh[0]) / 2.0
        cy = (lh[1] + rh[1]) / 2.0
        sw = max(float(np.hypot(ls[0] - rs[0], ls[1] - rs[1])), 1e-6)
        # x 取负 = 镜像视角（与学员看到的镜像自拍画面同向，便于照做）
        frames.append([[round(-(p[0] - cx) / sw, 3), round((p[1] - cy) / sw, 3)]
                       for p in f])
    return frames


def _action_list_v2() -> list[dict]:
    from joint_angle import demo_skeleton_frames
    out = []
    for aid, a in _actions_v2.items():
        item = {'id': aid, 'name': a['name'], 'frames': int(a['frames']),
                'segments': int(a.get('segments', 0)),
                'owner': str(a.get('owner') or '')}
        # 优先用录制/导入时保存的真实骨架；旧模板回退到角度反推（示意）
        demo = _demo_from_raw(a.get('demo_raw'))
        if demo:
            item['demo'] = demo
            item['demo_exact'] = True
        else:
            raw = a.get('raw_seq')
            if raw is not None and len(raw) >= 2:
                item['demo'] = demo_skeleton_frames(raw)
        out.append(item)
    return out


def _clean_name(raw) -> str:
    name = str(raw or '').strip()
    if not name:
        raise ValueError('身段名称不能为空')
    if len(name) > 30:
        name = name[:30]
    return name


def _features_matrix(rows) -> np.ndarray:
    """请求体特征行 [[20]...] -> (n, 20) ndarray，null/非法值还原为 NaN。"""
    if not isinstance(rows, (list, tuple)) or not rows:
        raise ValueError('特征序列不能为空')
    if len(rows) > MAX_IMPORT_ROWS:
        raise ValueError(f'特征序列过长（最多 {MAX_IMPORT_ROWS} 帧）')
    out = np.full((len(rows), ja.TOTAL_DIM), np.nan, dtype=np.float64)
    for i, row in enumerate(rows):
        if not isinstance(row, (list, tuple)) or len(row) != ja.TOTAL_DIM:
            raise ValueError(f'第 {i + 1} 帧必须是 {ja.TOTAL_DIM} 维特征')
        for j, v in enumerate(row):
            if v is None:
                continue
            try:
                out[i, j] = float(v)
            except (TypeError, ValueError):
                pass  # 非数值按缺失处理
    return out


@app.on_event('startup')
def _startup() -> None:
    _load_builtin()
    _load_recorded()
    _load_v2()
    print(f"[pose-eval] 已加载 {len(_actions)} 个标准动作模板 (v1)")
    print(f"[pose-eval] 已加载 {len(_actions_v2)} 个身段模板 (v2)")


@app.get('/health')
def health():
    return {'status': 'ok', 'service': 'pose-eval', 'version': '2.0.0',
            'actions': len(_actions), 'actions_v2': len(_actions_v2)}


@app.get('/actions')
def actions():
    return {'actions': _action_list()}


@app.get('/actions-v2')
def actions_v2():
    return {'actions': _action_list_v2()}


@app.post('/templates-v2')
def save_template_v2(body: dict):
    """保存一段 20 维特征序列为模板（浏览器视频导入管线调用，经网关转发）。"""
    try:
        name = _clean_name(body.get('name'))
        raw = _features_matrix(body.get('features'))
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    if len(raw) < store_v2.MIN_SEGMENT_LEN:
        raise HTTPException(
            status_code=400,
            detail=f'有效帧数不足（至少 {store_v2.MIN_SEGMENT_LEN} 帧）')
    owner = str(body.get('owner') or '').strip()[:40]
    # 可选：浏览器逐帧采样的 11 关节归一化坐标（参考身段动画数据）
    demo = None
    demo_rows = body.get('demo')
    if isinstance(demo_rows, list) and len(demo_rows) == len(raw):
        parsed = [_parse_demo_joints(f) for f in demo_rows]
        if all(p is not None for p in parsed):
            demo = parsed
    try:
        action_id, segments = store_v2.save_segment(name, raw, TEMPLATES_V2_DIR, owner=owner, demo=demo)
    except (OSError, ValueError) as exc:
        raise HTTPException(status_code=500, detail=f'模板保存失败: {exc}') from exc
    _load_v2()
    frames = min(len(raw), store_v2.MAX_TEMPLATE_LEN)
    return {'ok': True, 'action': {'id': action_id, 'name': name,
                                   'frames': frames, 'segments': segments},
            'actions': _action_list_v2()}


@app.delete('/actions-v2/{action_id}')
def delete_action_v2(action_id: str):
    # 权限判定在网关层完成（教师 / 创建者）；sidecar 只做存在性检查
    ok = store_v2.delete_action(action_id, TEMPLATES_V2_DIR)
    if not ok:
        raise HTTPException(status_code=404, detail='未找到该身段模板')
    _load_v2()
    return {'ok': True, 'actions': _action_list_v2()}


class _Session:
    """一条 WebSocket 连接对应一个会话状态。"""

    def __init__(self) -> None:
        self.action: dict | None = None
        self.started = False
        self.buffer: deque = deque(maxlen=MAX_BUFFER_FRAMES)   # [(feat_s, wscale), ...]
        self.scores: list[float] = []
        self.detected_streak = 0
        self.frames_seen = 0
        self.recording: list[np.ndarray] = []
        self.is_recording = False
        self.smoothed: np.ndarray | None = None  # 上一帧平滑关键点

    def reset_matching(self) -> None:
        self.buffer.clear()
        self.scores.clear()
        self.detected_streak = 0
        self.frames_seen = 0
        self.smoothed = None


def _wrist_hints(feat: np.ndarray, template_mean: np.ndarray) -> list[str]:
    """对比当前特征与模板均值的腕部位置，生成最多两条纠正提示。"""
    hints = []
    for side, idx in (('左', pm.LEFT_WRIST), ('右', pm.RIGHT_WRIST)):
        cur_y = float(feat[idx * 3 + 1])
        ref_y = float(template_mean[idx * 3 + 1])
        diff = cur_y - ref_y
        if diff > 0.18:
            hints.append(f'{side}手可再抬高一些')
        elif diff < -0.18:
            hints.append(f'{side}手位置偏高，可稍下压')
        cur_x = float(feat[idx * 3])
        ref_x = float(template_mean[idx * 3])
        if abs(cur_x - ref_x) > 0.22:
            hints.append(f'{side}手位置偏移，请回到身前')
        if len(hints) >= 2:
            break
    return hints


async def _send(ws: WebSocket, payload: dict) -> None:
    try:
        await ws.send_json(payload)
    except Exception:
        pass


async def _handle_frame(session: _Session, msg: dict, ws: WebSocket) -> None:
    landmarks = msg.get('landmarks')
    if not isinstance(landmarks, list) or len(landmarks) < 25:
        return

    try:
        arr = np.asarray(landmarks, dtype=np.float64)
    except (TypeError, ValueError):
        return
    if arr.ndim != 2 or arr.shape[0] < 25:
        return

    visibility = arr[:, 3] if arr.shape[1] >= 4 else None
    detected = pm.landmarks_valid(visibility)
    # 指数平滑：抑制 MediaPipe 逐帧抖动，抖动会直接抬高 DTW 距离
    arr = pm.smooth_landmarks(session.smoothed, arr[:, :3])
    session.smoothed = arr
    feat = pm.pose_feature_vector(arr) if detected else None

    # 状态：未检测到人 / 待稳定 / 就绪
    if feat is None:
        session.detected_streak = 0
        session.smoothed = None  # 丢人后重置平滑器，避免跳变残留
        if session.started or session.is_recording:
            session.buffer.clear()
        await _send(ws, {
            'type': 'score', 'status': 'waiting', 'score': None,
            'poseDetected': False, 'completion': 0.0, 'hints': ['请站到镜头前，保持肩部与髋部可见'],
        })
        return

    session.detected_streak += 1
    session.frames_seen += 1

    # 录制模板：只收集特征，不打分
    if session.is_recording:
        session.recording.append(feat)
        await _send(ws, {
            'type': 'score', 'status': 'recording', 'score': None,
            'poseDetected': True, 'completion': min(1.0, len(session.recording) / 45.0),
            'hints': [f'模板录制中（{len(session.recording)} 帧）'],
        })
        return

    # 未开始挑战：只回报就绪状态
    if not session.started:
        await _send(ws, {
            'type': 'score',
            'status': 'ready' if session.detected_streak >= READY_STABLE_FRAMES else 'waiting',
            'score': None, 'poseDetected': True, 'completion': 0.0, 'hints': [],
        })
        return

    # 挑战中：遮挡关节补偿 -> 标准化 -> 滑窗 DTW
    action = session.action
    if action is None:
        return
    template_len = action['template'].shape[0]
    feat, wscale = pm.mask_low_visibility(feat, visibility, action['mean'])
    feat_s = pm.standardize_apply(feat, action['mean'], action['std'])
    session.buffer.append((feat_s, wscale))

    completion = min(1.0, len(session.buffer) / template_len)
    buf_feats = np.stack([f for f, _ in session.buffer])
    buf_w = np.stack([w for _, w in session.buffer])
    best_d, best_s = pm.best_match(buf_feats, action['template'], buf_w)
    if best_s is not None:
        session.scores.append(best_s)

    hints = _wrist_hints(feat, action['mean'])
    await _send(ws, {
        'type': 'score', 'status': 'matching', 'score': best_s,
        'poseDetected': True, 'completion': completion, 'hints': hints,
    })


async def _handle_start(session: _Session, msg: dict, ws: WebSocket) -> None:
    action_id = str(msg.get('actionId', ''))
    action = _actions.get(action_id)
    if action is None:
        await _send(ws, {'type': 'error', 'message': f'未知动作: {action_id}'})
        return
    session.action = action
    session.is_recording = False
    session.reset_matching()
    session.started = True
    await _send(ws, {'type': 'started', 'actionId': action_id, 'frames': action['frames']})


async def _handle_finish(session: _Session, ws: WebSocket) -> None:
    scores = session.scores
    best = round(max(scores), 1) if scores else None
    avg = round(float(np.mean(scores)), 1) if scores else None
    action = session.action
    template_len = action['template'].shape[0] if action else 1
    completion_ratio = min(1.0, len(session.buffer) / template_len)
    completion = round(completion_ratio * 100, 1)
    # 实时滑窗会记录动作起势阶段的局部最高分。结算时将其与完成度绑定，
    # 避免只摆出一两个相似姿势就获得接近满分的结果。
    completion_factor = 0.35 + 0.65 * completion_ratio
    if best is not None:
        best = round(best * completion_factor, 1)
    if avg is not None:
        avg = round(avg * completion_factor, 1)
    hints: list[str] = []
    if best is not None:
        if best >= 80:
            hints = ['身段与标准动作贴合度很高，继续保持']
        elif best >= 55:
            hints = ['整体方向正确，注意手腕轨迹与重心稳定']
        else:
            hints = ['建议放慢速度，对照参考动作再练一次']
    result = {
        'type': 'result', 'status': 'finished', 'best': best, 'avg': avg,
        'completion': completion, 'frames': len(session.buffer), 'hints': hints,
    }
    session.started = False
    session.reset_matching()
    await _send(ws, result)


async def _handle_record(session: _Session, msg: dict, ws: WebSocket) -> None:
    if msg['type'] == 'record_start':
        session.is_recording = True
        session.recording = []
        session.started = False
        session.reset_matching()
        await _send(ws, {'type': 'record_state', 'recording': True})
        return

    # record_stop
    session.is_recording = False
    name = str(msg.get('name') or '').strip()[:30] or time.strftime('自录身段-%m%d%H%M')
    frames = len(session.recording)
    if frames < MIN_TEMPLATE_FRAMES:
        session.recording = []
        await _send(ws, {
            'type': 'record_done', 'ok': False,
            'message': f'录制太短（{frames} 帧，至少 {MIN_TEMPLATE_FRAMES} 帧），已放弃',
            'actions': _action_list(),
        })
        return
    if frames > MAX_TEMPLATE_FRAMES:
        session.recording = session.recording[:MAX_TEMPLATE_FRAMES]
        frames = MAX_TEMPLATE_FRAMES

    raw = np.stack(session.recording)
    session.recording = []
    template_s, mean, std = pm.standardize(raw)
    action_id = 'custom-' + time.strftime('%m%d%H%M%S')
    TEMPLATES_DIR.mkdir(parents=True, exist_ok=True)
    safe = re.sub(r'[\s/\\:*?"<>|]', '', action_id)
    payload = {
        'id': action_id, 'name': name, 'created': time.strftime('%Y-%m-%d %H:%M'),
        'template': template_s.tolist(), 'mean': mean.tolist(), 'std': std.tolist(),
    }
    try:
        (TEMPLATES_DIR / f'{safe}.json').write_text(
            json.dumps(payload, ensure_ascii=False), encoding='utf-8')
    except OSError as exc:
        await _send(ws, {'type': 'record_done', 'ok': False,
                         'message': f'模板保存失败: {exc}', 'actions': _action_list()})
        return
    _actions[action_id] = _action_entry(action_id, name, frames, template_s, mean, std, False)
    await _send(ws, {
        'type': 'record_done', 'ok': True, 'action': {'id': action_id, 'name': name, 'frames': frames},
        'message': f'模板「{name}」已保存（{frames} 帧）', 'actions': _action_list(),
    })


@app.websocket('/ws/pose')
async def ws_pose(ws: WebSocket) -> None:
    await ws.accept()
    session = _Session()
    await _send(ws, {'type': 'hello', 'actions': _action_list()})
    try:
        while True:
            msg = await ws.receive_json()
            msg_type = msg.get('type')
            if msg_type == 'frame':
                await _handle_frame(session, msg, ws)
            elif msg_type == 'start':
                await _handle_start(session, msg, ws)
            elif msg_type == 'finish':
                await _handle_finish(session, ws)
            elif msg_type in ('record_start', 'record_stop'):
                await _handle_record(session, msg, ws)
    except WebSocketDisconnect:
        pass
    except Exception:
        import traceback
        print('[pose-eval] 连接异常:')
        traceback.print_exc()
        try:
            await ws.close()
        except Exception:
            pass


# ============================================================
# v2 会话：20 维关节角特征流（身段测评页）
# ============================================================
class _SessionV2:
    """一条 v2 WebSocket 连接对应一个会话状态。

    mode: idle(未开始) / challenge(选定身段挑战) / free(全库识别) / record(录制模板)
    """

    def __init__(self) -> None:
        self.mode = 'idle'
        self.action: dict | None = None
        self.buffer: deque = deque()   # 原始 20 维角度帧（手部缺失维为 NaN）
        self.scores: list[float] = []
        self.frames_seen = 0
        self.recording: list[np.ndarray] = []
        self.recording_demo: list[list] = []  # 录制时逐帧携带的 11 关节骨架（与 recording 对齐）
        self.is_recording = False
        self.free_scores: list[dict] | None = None  # 识别模式最近一轮各身段得分
        self.free_candidate_id: str | None = None
        self.free_candidate_rounds = 0
        self.progress_max = 0.0  # 挑战模式：前缀匹配得到的最高完成度(0~1)
        self.attempt: list[np.ndarray] = []  # 挑战模式：自开始起全部帧（完成度评估用）

    def reset_matching(self) -> None:
        self.buffer.clear()
        self.scores.clear()
        self.frames_seen = 0
        self.free_scores = None
        self.free_candidate_id = None
        self.free_candidate_rounds = 0
        self.progress_max = 0.0
        self.attempt = []

    def buffer_cap(self) -> int:
        if self.mode == 'challenge' and self.action:
            t_len = max(t.shape[0] for t in self.action['templates'])
        else:
            t_len = max((max(t.shape[0] for t in a['templates'])
                         for a in _actions_v2.values()), default=60)
        return int(t_len * 1.5) + 5


def _final_hint(best: float | None) -> list[str]:
    if best is None:
        return ['未采集到足够的动作帧，请正对镜头完整做一遍身段']
    if best >= 80:
        return ['身段与范本贴合度很高，注意保持手型细节（兰花指/剑指）']
    if best >= 55:
        return ['整体骨架正确，重点打磨手臂弧线与手腕轨迹']
    return ['建议放慢速度，对照范本逐段练习后再完整做一遍']


async def _handle_frame_v2(session: _SessionV2, msg: dict, ws: WebSocket) -> None:
    try:
        row = _features_matrix([msg.get('features')])[0]
    except ValueError:
        return
    session.frames_seen += 1
    # 诊断日志：首帧 + 每 40 帧 + 录制结束前，定位「录制太短」类问题
    if session.frames_seen == 1 or session.frames_seen % 40 == 0:
        print(f'[diag] frame session={id(session):#x} seen={session.frames_seen} '
              f'mode={session.mode} recording={session.is_recording} rec={len(session.recording)}')

    # 录制模式：只收集原始帧（可选携带参考骨架坐标）
    if session.is_recording:
        session.recording.append(row)
        session.recording_demo.append(_parse_demo_joints(msg.get('demo')))
        await _send(ws, {
            'type': 'score', 'mode': 'record', 'status': 'recording',
            'score': None, 'completion': min(1.0, len(session.recording) / 45.0),
            'frames': len(session.recording), 'hints': [],
        })
        return

    # 未开始：只低频回报就绪状态，不积累缓冲
    if session.mode == 'idle':
        if session.frames_seen % 4 == 0:
            await _send(ws, {'type': 'score', 'mode': 'idle', 'status': 'ready',
                             'score': None, 'completion': 0.0, 'hints': []})
        return

    session.buffer.append(row)  # deque(maxlen=cap) 自动淘汰旧帧

    # 挑战模式：每 N 帧对该身段的全部模板打分；完成度 = 前缀匹配进度（内容对齐）
    if session.mode == 'challenge':
        action = session.action
        # 尝试序列逐帧累积（完成度评估需要自起势起的完整历史，不随评分窗口淘汰）
        session.attempt.append(row)
        if len(session.attempt) > 1200:
            del session.attempt[:200]
        if session.frames_seen % SCORE_EVERY_N_FRAMES != 0:
            return
        buf_raw = np.stack(session.buffer)
        buf_s, _, _ = ja.standardize(buf_raw, mean=action['mean'], std=action['std'])
        att_s, _, _ = ja.standardize(np.stack(session.attempt),
                                     mean=action['mean'], std=action['std'])
        best_s = None
        best_prog = 0.0
        # 完成度阈值相对化：以本轮实时最高分为基准（完成度衡量进度而非质量）
        ref = max(session.scores) if session.scores else 0.0
        d0 = float(action.get('d0') or 0.0)
        for template in action['templates']:
            _, s = ja.best_match(buf_s, template, d0=d0)
            if s is not None and (best_s is None or s > best_s):
                best_s = s
            prog = ja.prefix_progress(att_s, template, prev=session.progress_max,
                                      ref_score=ref, d0=d0)
            if prog > best_prog:
                best_prog = prog
        if best_s is not None:
            session.scores.append(best_s)
        session.progress_max = max(session.progress_max, best_prog)
        hints = ja.angle_hints(row, action['mean'])
        await _send(ws, {
            'type': 'score', 'mode': 'challenge', 'status': 'matching',
            'score': None if best_s is None else round(best_s, 1),
            'completion': round(session.progress_max, 2), 'hints': hints,
        })
        return

    # 识别模式：每 N 帧对全部身段的代表模板打分
    if session.mode == 'free' and session.frames_seen % FREE_EVERY_N_FRAMES == 0:
        scores = []
        buf_raw = np.stack(session.buffer)
        for aid, a in _actions_v2.items():
            rep = a['templates'][0]
            # 识别只看最近一段完整动作；旧缓冲中的一次高分不应在用户已
            # 放下手后持续“粘住”。同时禁止把 2~3 帧强行拉伸成整段模板，
            # 这是此前静止姿势被误识别为任意身段的主要原因。
            min_frames = max(15, int(np.ceil(rep.shape[0] * 0.7)))
            if len(buf_raw) < min_frames:
                continue
            recent = buf_raw[-int(np.ceil(rep.shape[0] * 1.35)):]
            buf_s, _, _ = ja.standardize(recent, mean=a['mean'], std=a['std'])
            _, s = ja.best_match(buf_s, rep, d0=float(a.get('d0') or 0.0),
                                 allow_partial=False)
            if s is not None:
                scores.append({'id': aid, 'name': a['name'], 'score': round(s, 1)})
        if not scores:
            return
        scores.sort(key=lambda x: x['score'], reverse=True)
        session.free_scores = scores
        best = scores[0]
        runner_up = scores[1]['score'] if len(scores) > 1 else 0.0
        confident = best['score'] >= ja.RECOGNIZE_THRESHOLD \
            and best['score'] - runner_up >= ja.RECOGNIZE_MARGIN
        if confident and session.free_candidate_id == best['id']:
            session.free_candidate_rounds += 1
        elif confident:
            session.free_candidate_id = best['id']
            session.free_candidate_rounds = 1
        else:
            session.free_candidate_id = None
            session.free_candidate_rounds = 0
        recognized = best if confident and session.free_candidate_rounds >= FREE_STABLE_ROUNDS else None
        await _send(ws, {
            'type': 'score', 'mode': 'free', 'status': 'matching',
            'score': best['score'], 'recognized': recognized,
            'scores': scores[:5], 'completion': None, 'hints': [],
        })


async def _handle_start_v2(session: _SessionV2, msg: dict, ws: WebSocket) -> None:
    # 防御：切换会话模式时终止未完成的录制（录制数据作废，保存必须走 record_stop 命名流程）
    session.is_recording = False
    session.recording = []
    session.recording_demo = []
    free = msg.get('type') == 'start_free'
    print(f'[diag] {"start_free" if free else "start"} session={id(session):#x} action={msg.get("actionId")!r}')
    if free:
        session.action = None
        session.mode = 'free'
        session.reset_matching()
        session.buffer = deque(maxlen=session.buffer_cap())
        await _send(ws, {'type': 'started', 'mode': 'free',
                         'actions': _action_list_v2()})
        return
    action_id = str(msg.get('actionId', ''))
    action = _actions_v2.get(action_id)
    if action is None:
        await _send(ws, {'type': 'error', 'message': f'未知身段: {action_id}'})
        return
    session.action = action
    session.mode = 'challenge'
    session.reset_matching()
    session.buffer = deque(maxlen=session.buffer_cap())
    await _send(ws, {'type': 'started', 'mode': 'challenge', 'actionId': action_id,
                     'frames': action['frames']})


async def _handle_finish_v2(session: _SessionV2, ws: WebSocket) -> None:
    # 防御：录制中收到 finish 时终止录制态（数据作废），否则后续帧会一直被吞进录制缓冲
    if session.is_recording:
        session.is_recording = False
        session.recording = []
        session.recording_demo = []
    scores = session.scores
    best = round(max(scores), 1) if scores else None
    avg = round(float(np.mean(scores)), 1) if scores else None
    result: dict = {
        'type': 'result', 'mode': session.mode, 'best': best, 'avg': avg,
        'frames': session.frames_seen, 'hints': _final_hint(best),
    }
    if session.mode == 'challenge' and session.action:
        result['actionId'] = session.action.get('id')
        result['actionName'] = session.action['name']
        # 完成度 = 本轮尝试中前缀匹配达到的最高进度（内容对齐，非时长比例）
        completion = session.progress_max
        # “历史最高分”会把起势阶段偶然贴近范本的一帧当作最终成绩。最终分
        # 必须与实际完成度绑定，未做完整动作只能得到有限参考分。
        if best is not None:
            best = round(best * (0.35 + 0.65 * completion), 1)
            result['best'] = best
        if avg is not None:
            avg = round(avg * (0.35 + 0.65 * completion), 1)
            result['avg'] = avg
        result['completion'] = round(completion * 100, 1)
    elif session.mode == 'free':
        fs = session.free_scores or []
        result['scores'] = fs[:5]
        top = fs[0] if fs else None
        runner_up = fs[1]['score'] if len(fs) > 1 else 0.0
        result['recognized'] = top if top and top['score'] >= ja.RECOGNIZE_THRESHOLD \
            and top['score'] - runner_up >= ja.RECOGNIZE_MARGIN \
            and session.free_candidate_rounds >= FREE_STABLE_ROUNDS else None
        result['completion'] = None
    session.mode = 'idle'
    session.action = None
    session.reset_matching()
    await _send(ws, result)


async def _handle_record_v2(session: _SessionV2, msg: dict, ws: WebSocket) -> None:
    if msg['type'] == 'record_start':
        print(f'[diag] record_start session={id(session):#x} (seen={session.frames_seen}, mode={session.mode})')
        session.is_recording = True
        session.recording = []
        session.recording_demo = []
        session.mode = 'record'
        session.reset_matching()
        await _send(ws, {'type': 'record_state', 'recording': True})
        return

    # record_stop
    print(f'[diag] record_stop session={id(session):#x} frames={len(session.recording)} '
          f'recording={session.is_recording} mode={session.mode} name={msg.get("name")!r}')
    session.is_recording = False
    session.mode = 'idle'
    try:
        name = _clean_name(msg.get('name'))
    except ValueError as exc:
        session.recording = []
        session.recording_demo = []
        await _send(ws, {'type': 'record_done', 'ok': False,
                         'message': str(exc), 'actions': _action_list_v2()})
        return
    frames = len(session.recording)
    if frames < store_v2.MIN_SEGMENT_LEN:
        session.recording = []
        session.recording_demo = []
        await _send(ws, {
            'type': 'record_done', 'ok': False,
            'message': f'录制太短（{frames} 帧，至少 {store_v2.MIN_SEGMENT_LEN} 帧），已放弃',
            'actions': _action_list_v2(),
        })
        return
    raw = np.stack(session.recording)
    session.recording = []
    # 参考骨架：与特征帧数完全对齐时采用（任一帧缺失则放弃，保证时序一致）
    demo = session.recording_demo if len(session.recording_demo) == frames \
        and all(d is not None for d in session.recording_demo) else None
    session.recording_demo = []
    # 创建者身份由客户端声明（内部工具信任模型：删除权限在网关按 JWT 判定）
    owner = str(msg.get('owner') or '').strip()[:40]
    try:
        action_id, segments = store_v2.save_segment(name, raw, TEMPLATES_V2_DIR, owner=owner, demo=demo)
    except (OSError, ValueError) as exc:
        await _send(ws, {'type': 'record_done', 'ok': False,
                         'message': f'模板保存失败: {exc}', 'actions': _action_list_v2()})
        return
    _load_v2()
    frames_saved = min(frames, store_v2.MAX_TEMPLATE_LEN)
    await _send(ws, {
        'type': 'record_done', 'ok': True,
        'action': {'id': action_id, 'name': name, 'frames': frames_saved,
                   'segments': segments},
        'message': f'模板「{name}」已保存（{frames_saved} 帧）',
        'actions': _action_list_v2(),
    })


@app.websocket('/ws/pose-v2')
async def ws_pose_v2(ws: WebSocket) -> None:
    await ws.accept()
    session = _SessionV2()
    print(f'[diag] ws open session={id(session):#x}')
    await _send(ws, {'type': 'hello', 'actions': _action_list_v2()})
    try:
        while True:
            msg = await ws.receive_json()
            msg_type = msg.get('type')
            if msg_type == 'frame':
                await _handle_frame_v2(session, msg, ws)
            elif msg_type in ('start', 'start_free'):
                await _handle_start_v2(session, msg, ws)
            elif msg_type == 'finish':
                await _handle_finish_v2(session, ws)
            elif msg_type in ('record_start', 'record_stop'):
                await _handle_record_v2(session, msg, ws)
    except WebSocketDisconnect:
        print(f'[diag] ws close session={id(session):#x} seen={session.frames_seen} '
              f'rec_frames={len(session.recording)}')
    except Exception:
        import traceback
        print('[pose-eval] v2 连接异常:')
        traceback.print_exc()
        try:
            await ws.close()
        except Exception:
            pass
