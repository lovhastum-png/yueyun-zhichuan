"""越剧姿态比对核心算法（DTW）。

从 `新建文件夹/dtw_pose_match.py` 迁移并适配「浏览器端 MediaPipe 关键点」输入：
- 浏览器端(virtual-tryon.html) 已经在跑 MediaPipe Pose，直接产出 33 个归一化关键点；
- 本模块把关键点转成「平移+尺度不变」的 99 维特征，再做滑窗 DTW 比对打分；
- 另提供合成「云手」身段序列，作为内置标准模板与离线自测数据。
"""
from __future__ import annotations

import math

import numpy as np

# MediaPipe Pose 关键点常用索引
LEFT_SHOULDER = 11
RIGHT_SHOULDER = 12
LEFT_HIP = 23
RIGHT_HIP = 24
LEFT_WRIST = 15
RIGHT_WRIST = 16

N_POINTS = 33
N_FEATURES = N_POINTS * 3

# 标准差低于该值（肩宽单位）的特征列视为「静止列」：置 0 而不做 z-score。
# 否则模板中几乎不动的部位（头、腿）会被微小抖动放大成巨大的 z 值，
# 淹没真正的动作差异。真实身段动作列的 std 通常远大于 0.05。
STD_FLOOR = 0.05

# 关节权重（按 MediaPipe Pose 33 点顺序）。越剧身段的表现力集中在
# 腕/肘/肩（水袖、云手、指法），这些关节给高权重；面部与腿脚多为
# 静止支撑位、识别噪声也大，低权重避免噪声淹没真实动作差异。
JOINT_WEIGHTS = np.array([
    0.15,                                   # 0  鼻
    0.10, 0.10, 0.10, 0.10,                 # 1-4  眼
    0.10, 0.10, 0.10, 0.10,                 # 5-8  耳
    0.15, 0.15,                             # 9-10 嘴
    1.2, 1.2,                               # 11-12 肩
    1.8, 1.8,                               # 13-14 肘
    2.6, 2.6,                               # 15-16 腕（核心）
    1.5, 1.5, 1.5, 1.5, 1.5, 1.5,           # 17-22 手
    1.0, 1.0,                               # 23-24 髋
    0.6, 0.6,                               # 25-26 膝
    0.4, 0.4,                               # 27-28 踝
    0.2, 0.2, 0.2, 0.2,                     # 29-32 脚
], dtype=np.float64)
FEATURE_WEIGHTS = np.repeat(JOINT_WEIGHTS, 3)  # x/y/z 同权重

# 被遮挡（低可见度）关节的替换阈值：低于该值的关节在比对前用模板均值填充，
# 避免遮挡的手腕被当作「动作错误」扣分。
VISIBILITY_FLOOR = 0.4


def pose_feature_vector(pts: np.ndarray) -> np.ndarray | None:
    """把 33 个姿态关键点转成平移+尺度归一化的 99 维特征向量。

    pts 形状 (33, 3+)，坐标为 MediaPipe 归一化坐标 (x, y ∈ [0,1], z 相对深度)。
    以髋部中点为原点、肩宽为尺度，消除站位远近与画面偏移的影响。
    无效输入返回 None。
    """
    pts = np.asarray(pts, dtype=np.float64)
    if pts.ndim != 2 or pts.shape[0] < 25 or pts.shape[1] < 3:
        return None
    if not np.isfinite(pts[:, :3]).all():
        return None
    s_l, s_r = pts[LEFT_SHOULDER, :3], pts[RIGHT_SHOULDER, :3]
    h_l, h_r = pts[LEFT_HIP, :3], pts[RIGHT_HIP, :3]
    center = (h_l + h_r) / 2.0
    scale = float(np.linalg.norm(s_l[:3] - s_r[:3]))
    if scale < 1e-6:
        return None
    return ((pts[:, :3] - center) / scale).ravel()


def landmarks_valid(visibility: np.ndarray | None) -> bool:
    """肩/髋核心关键点可见度校验：不满足时判为「未检测到人物」。"""
    if visibility is None or len(visibility) < 25:
        return False
    core = [LEFT_SHOULDER, RIGHT_SHOULDER, LEFT_HIP, RIGHT_HIP]
    return float(np.mean([visibility[i] for i in core])) > 0.25


def standardize(x: np.ndarray, mean=None, std=None):
    """逐列 z-score 标准化。mean/std 为空时由 x 计算，返回 (z, mean, std)。"""
    x = np.asarray(x, dtype=np.float64)
    if mean is None:
        mean = x.mean(axis=0)
    if std is None:
        std = x.std(axis=0)
    mean = np.asarray(mean, dtype=np.float64)
    std = np.asarray(std, dtype=np.float64)
    moving = std > STD_FLOOR
    safe_std = np.where(moving, std, 1.0)
    z = (x - mean) / safe_std
    z = np.where(moving, z, 0.0)
    return z, mean, std


def standardize_apply(feat: np.ndarray, mean: np.ndarray, std: np.ndarray) -> np.ndarray:
    """用模板的 mean/std 标准化单帧实时特征。

    静止列（std <= STD_FLOOR，如头部、腿）置 0，与 standardize() 一致，
    避免微小抖动被放大成 inf 级别的 z 值。
    """
    feat = np.asarray(feat, dtype=np.float64)
    mean = np.asarray(mean, dtype=np.float64)
    std = np.asarray(std, dtype=np.float64)
    moving = std > STD_FLOOR
    safe_std = np.where(moving, std, 1.0)
    z = (feat - mean) / safe_std
    return np.where(moving, z, 0.0)


def mask_low_visibility(feat: np.ndarray, visibility: np.ndarray | None,
                        mean: np.ndarray) -> tuple[np.ndarray, np.ndarray]:
    """低可见度（被遮挡）关节：坐标用模板均值填充 + 比对权重归零。

    返回 (填充后的特征, 逐维权重缩放 ws)。ws 中被遮挡关节的 x/y/z 置 0，
    DTW 代价中这些维度完全不参与——遮挡的腕部若按原坐标计算会得到巨大的
    z 偏差，被误判为动作错误；只替换均值而不降权重仍会引入轨迹缺失惩罚。
    只处理动作关节（权重 >= 1.0 的肩/肘/腕/手/髋）。
    """
    ws = np.ones(N_FEATURES, dtype=np.float64)
    if visibility is None:
        return feat, ws
    feat = np.asarray(feat, dtype=np.float64).copy()
    mean = np.asarray(mean, dtype=np.float64)
    for j in range(N_POINTS):
        if JOINT_WEIGHTS[j] < 1.0:
            continue
        vis = visibility[j] if j < len(visibility) else 1.0
        if vis is not None and vis < VISIBILITY_FLOOR:
            feat[j * 3 : j * 3 + 3] = mean[j * 3 : j * 3 + 3]
            ws[j * 3 : j * 3 + 3] = 0.0
    return feat, ws


def smooth_landmarks(prev: np.ndarray | None, cur: np.ndarray, alpha: float = 0.55) -> np.ndarray:
    """指数平滑关键点，抑制 MediaPipe 逐帧抖动（抖动会直接抬高 DTW 距离）。

    prev 为上一帧平滑结果；alpha 越大越跟随当前帧。
    """
    cur = np.asarray(cur, dtype=np.float64)
    if prev is None or prev.shape != cur.shape:
        return cur.copy()
    return alpha * cur + (1.0 - alpha) * prev


def _dtw_cost(a: np.ndarray, b: np.ndarray, band: int | None,
              w_rows: np.ndarray | None = None) -> float:
    """带 Sakoe-Chiba 带宽的加权 DTW 代价。

    每帧代价 = Σ w_id*(a_id-b_id)²，按全部帧的权重和归一，即关节加权
    平均平方代价（腕部偏差比面部偏差影响更大）。w_rows 形状 (na, D)，
    为 None 时用全局 FEATURE_WEIGHTS；被遮挡帧的对应维度权重为 0，
    该帧这些维度不参与比对。
    """
    na, nb = len(a), len(b)
    if na == 0 or nb == 0:
        return float("inf")
    band = 10_000_000 if band is None else max(0, band)
    if w_rows is None:
        w_rows = np.broadcast_to(FEATURE_WEIGHTS[: a.shape[1]], (na, a.shape[1]))
    else:
        w_rows = np.asarray(w_rows, dtype=np.float64)[:na, : a.shape[1]]
    w_sum = float(w_rows.sum())
    if w_sum < 1e-6:
        return float("inf")
    inf = float("inf")
    prev = np.full(nb + 1, inf, dtype=np.float64)
    cur = np.full(nb + 1, inf, dtype=np.float64)
    prev[0] = 0.0
    for i in range(1, na + 1):
        cur[0] = inf
        ai = a[i - 1]
        wi = w_rows[i - 1]
        j_start = max(1, i - band)
        j_end = min(nb, i + band)
        for j in range(1, nb + 1):
            if j < j_start or j > j_end:
                cur[j] = inf
                continue
            diff = ai - b[j - 1]
            cost = float(np.sum(wi * diff * diff))
            cur[j] = cost + min(prev[j], cur[j - 1], prev[j - 1])
        prev, cur = cur, prev
    total = prev[nb]
    if not np.isfinite(total):
        return float("inf")
    return total / w_sum


def sliding_window_match(buffer: np.ndarray, template: np.ndarray, step: int = 1,
                         band: int | None = None, w_buffer: np.ndarray | None = None):
    """在 buffer(T×D) 中滑动窗口比 template(L×D)，返回 [(start_index, 归一化距离), ...]。

    w_buffer 形状 (T, D)，与 buffer 帧对齐，为各帧各维度提供遮挡权重缩放。
    """
    buffer = np.asarray(buffer, dtype=np.float64)
    template = np.asarray(template, dtype=np.float64)
    L = template.shape[0]
    if buffer.shape[0] < L:
        return []
    results = []
    idx = 0
    while idx + L <= buffer.shape[0]:
        win = buffer[idx : idx + L]
        w_win = None if w_buffer is None else np.asarray(w_buffer, dtype=np.float64)[idx : idx + L]
        d = _dtw_cost(win, template, band, w_win)
        if np.isfinite(d):
            results.append((idx, d))
        idx += max(1, step)
    return results


# 分数映射锚点：DTW 距离在 [SCORE_D_MIN, SCORE_D_MAX] 上做对数线性映射。
# 用对数刻度是因为好/坏动作的距离呈数量级差异（≈0.03 vs ≈1.0），
# 指数曲线 exp(-k·d) 在中段没有梯度（良好 85 分、轻度偏差直接掉到 20 分），
# 对数线性让「大致正确 → 明显错误」之间保留可感知的分数梯度。
SCORE_D_MIN = 0.008   # 完美贴合（平滑后加权距离）→ 100 分
SCORE_D_MAX = 2.0     # 完全不符 → 0 分


def score(dtw_dist: float | None) -> float | None:
    """把加权 DTW 距离映射到 0~100 分（对数线性，中段有梯度）。"""
    if dtw_dist is None or not math.isfinite(dtw_dist):
        return None
    if dtw_dist <= SCORE_D_MIN:
        return 100.0
    if dtw_dist >= SCORE_D_MAX:
        return 0.0
    log_min, log_max = math.log(SCORE_D_MIN), math.log(SCORE_D_MAX)
    t = (log_max - math.log(dtw_dist)) / (log_max - log_min)
    return float(100.0 * t)


def best_match(buffer_arr: np.ndarray, template_s: np.ndarray,
               w_buffer: np.ndarray | None = None):
    """滑窗匹配取最优，返回 (最优 DTW 距离, 分数)。"""
    template_len = template_s.shape[0]
    step = max(1, template_len // 6)
    band = max(3, template_len // 4)
    wins = sliding_window_match(buffer_arr, template_s, step=step, band=band, w_buffer=w_buffer)
    if not wins:
        return None, None
    _, best_d = min(wins, key=lambda w: w[1])
    return best_d, score(best_d)


# ----------------------------------------------------------------------
# 合成「云手」身段：用于内置标准模板与离线自测
# ----------------------------------------------------------------------
def make_cloud_hand_landmarks(frames: int = 60) -> np.ndarray:
    """合成「云手」动作的关键点序列，返回 (frames, 33, 3)，坐标为归一化画面坐标。

    按传统云手形态合成（正面视角）：双手在胸前各划一个立圆、左右相位
    相反——一手上行时另一手下行，双腕在体前交替交叉；肘部始终圆撑于
    腕外下方，肩随动作微微沉浮（呼吸感），下肢保持站姿稳定。
    """
    t = np.linspace(0.0, 2.0 * math.pi, frames)
    pts = np.zeros((frames, N_POINTS, 3), dtype=np.float64)

    # 躯干微沉浮：肩/髋/头随呼吸轻轻起伏（幅度远小于手部，保持下半身稳定）
    body_bob = 0.006 * np.sin(t)
    body_sway = 0.004 * np.sin(t + math.pi / 2)

    # 头部（随躯干轻微沉浮）
    pts[:, 0] = np.stack([0.50 + body_sway, 0.18 + body_bob, np.zeros(frames)], axis=1)
    pts[:, 2] = np.stack([0.465 + body_sway, 0.16 + body_bob, np.zeros(frames)], axis=1)   # 左眼
    pts[:, 5] = np.stack([0.535 + body_sway, 0.16 + body_bob, np.zeros(frames)], axis=1)   # 右眼
    pts[:, 7] = np.stack([0.44 + body_sway, 0.18 + body_bob, np.zeros(frames)], axis=1)    # 左耳
    pts[:, 8] = np.stack([0.56 + body_sway, 0.18 + body_bob, np.zeros(frames)], axis=1)    # 右耳
    pts[:, 9] = np.stack([0.47 + body_sway, 0.20 + body_bob, np.zeros(frames)], axis=1)    # 左嘴角
    pts[:, 10] = np.stack([0.53 + body_sway, 0.20 + body_bob, np.zeros(frames)], axis=1)   # 右嘴角

    # 肩（随躯干沉浮）
    pts[:, LEFT_SHOULDER] = np.stack([0.42 + body_sway, 0.30 + body_bob, np.zeros(frames)], axis=1)
    pts[:, RIGHT_SHOULDER] = np.stack([0.58 + body_sway, 0.30 + body_bob, np.zeros(frames)], axis=1)

    # 髋以下（站姿稳定）
    pts[:, LEFT_HIP] = np.stack([0.46 + 0.5 * body_sway, 0.55 + 0.3 * body_bob, np.zeros(frames)], axis=1)
    pts[:, RIGHT_HIP] = np.stack([0.54 + 0.5 * body_sway, 0.55 + 0.3 * body_bob, np.zeros(frames)], axis=1)
    pts[:, 25] = np.stack([np.full(frames, 0.465), np.full(frames, 0.75), np.zeros(frames)], axis=1)   # 左膝
    pts[:, 26] = np.stack([np.full(frames, 0.535), np.full(frames, 0.75), np.zeros(frames)], axis=1)   # 右膝
    pts[:, 27] = np.stack([np.full(frames, 0.47), np.full(frames, 0.92), np.zeros(frames)], axis=1)    # 左踝
    pts[:, 28] = np.stack([np.full(frames, 0.53), np.full(frames, 0.92), np.zeros(frames)], axis=1)    # 右踝

    # 云手：双腕在胸前各划一个立圆（左右相位相反）。
    # 右腕圆心 (0.56, 0.40)：上行时向内收、下行时向外展；左腕镜像。
    # 两腕最近时几乎在体前中心交汇（云手「合」），最远时各到体侧（云手「开」）。
    lw_x = 0.44 - 0.050 * np.cos(t)
    lw_y = 0.40 - 0.095 * np.sin(t)
    rw_x = 0.56 + 0.050 * np.cos(t)
    rw_y = 0.40 + 0.095 * np.sin(t)
    # 深度：手行至体前高点时更靠近镜头（z 越小越近），回落时稍远
    lw_z = 0.08 + 0.025 * np.sin(t)
    rw_z = 0.08 - 0.025 * np.sin(t)
    pts[:, LEFT_WRIST] = np.stack([lw_x, lw_y, lw_z], axis=1)
    pts[:, RIGHT_WRIST] = np.stack([rw_x, rw_y, rw_z], axis=1)

    # 肘：肩与腕之间偏外下方圆撑（肘不低于腕所在弧线太多、不夹肋）
    pts[:, 13] = np.stack([
        (pts[:, LEFT_SHOULDER, 0] + lw_x) / 2.0 - 0.030,
        (pts[:, LEFT_SHOULDER, 1] + lw_y) / 2.0 + 0.048,
        (pts[:, LEFT_SHOULDER, 2] + lw_z) / 2.0,
    ], axis=1)
    pts[:, 14] = np.stack([
        (pts[:, RIGHT_SHOULDER, 0] + rw_x) / 2.0 + 0.030,
        (pts[:, RIGHT_SHOULDER, 1] + rw_y) / 2.0 + 0.048,
        (pts[:, RIGHT_SHOULDER, 2] + rw_z) / 2.0,
    ], axis=1)

    # 手指关键点跟随腕部
    for idx in (17, 19, 21):
        pts[:, idx] = pts[:, LEFT_WRIST] + np.array([0.0, 0.012, 0.0])
    for idx in (18, 20, 22):
        pts[:, idx] = pts[:, RIGHT_WRIST] + np.array([0.0, 0.012, 0.0])
    for idx in (29, 31):
        pts[:, idx] = pts[:, 27]
    for idx in (30, 32):
        pts[:, idx] = pts[:, 28]
    return pts


def make_learner_landmarks(frames: int, noise: float = 0.0, speed_jitter: float = 0.0,
                           arm_offset: float = 0.0, rng_seed: int = 0) -> np.ndarray:
    """生成学习者版本：可调噪声 / 速度抖动 / 手臂整体偏移（模拟错误动作）。"""
    base = make_cloud_hand_landmarks(frames)
    rng = np.random.default_rng(rng_seed)
    out = base.copy()
    if arm_offset != 0.0:
        for idx in (LEFT_WRIST, RIGHT_WRIST, 13, 14):
            out[:, idx, 0] += arm_offset
            out[:, idx, 1] -= arm_offset * 0.6
    if speed_jitter > 0.0:
        for i in range(frames):
            jitter = rng.normal(0.0, speed_jitter)
            out[i, :, :2] = (1.0 + jitter) * (out[i, :, :2] - 0.5) + 0.5
    if noise > 0.0:
        out[:, :, :2] += rng.normal(0.0, noise, (frames, N_POINTS, 2))
    return out
