"""DTW 动作比对核心模块（供 realtime_pose_match.py 调用）。

设计要点：
- pose_feature_vector: 33 个 MediaPipe Pose 关键点 -> 10 维关节角特征(度)
- standardize: 逐维 z-score，消除身材/幅度等个体差异
- dtw_distance: Sakoe-Chiba 带约束 DTW，帧代价 = 10 维特征的均方差(MSE)，
  返回最优路径的 RMS 帧代价，使距离与序列长度无关
- sliding_window_match: 在最近帧缓冲上滑动定长窗口找最佳对齐
- score: DTW 平均帧代价 -> 0~100 分
"""

import math

import numpy as np

# 调参常数：score = 100 * exp(-K * d)，d 为标准化特征的路径 RMS 代价
_SCORE_K = 1.3

# MediaPipe Pose 关键点索引
_LM = {
    "left_shoulder": 11, "right_shoulder": 12,
    "left_elbow": 13, "right_elbow": 14,
    "left_wrist": 15, "right_wrist": 16,
    "left_index": 19, "right_index": 21,
    "left_hip": 23, "right_hip": 24,
    "left_knee": 25, "right_knee": 26,
    "left_ankle": 27, "right_ankle": 28,
}

# 10 维关节角：(关节顶点, 端点A, 端点B)，前 6 维手臂、后 4 维腿
_ANGLE_TRIPLES = [
    ("left_elbow", "left_shoulder", "left_wrist"),
    ("right_elbow", "right_shoulder", "right_wrist"),
    ("left_shoulder", "left_elbow", "left_hip"),
    ("right_shoulder", "right_elbow", "right_hip"),
    ("left_wrist", "left_elbow", "left_index"),
    ("right_wrist", "right_elbow", "right_index"),
    ("left_hip", "left_shoulder", "left_knee"),
    ("right_hip", "right_shoulder", "right_knee"),
    ("left_knee", "left_hip", "left_ankle"),
    ("right_knee", "right_hip", "right_ankle"),
]


def _angle_at(vertex, pa, pb):
    """pa-vertex-pb 的夹角(度，0~180)。"""
    u = np.asarray(pa) - np.asarray(vertex)
    v = np.asarray(pb) - np.asarray(vertex)
    nu = float(np.linalg.norm(u))
    nv = float(np.linalg.norm(v))
    if nu < 1e-9 or nv < 1e-9:
        return 0.0
    c = float(np.clip(np.dot(u, v) / (nu * nv), -1.0, 1.0))
    return math.degrees(math.acos(c))


def pose_feature_vector(pts):
    """(33,3) 关键点数组 -> 10 维关节角特征向量(度)。"""
    feats = [
        _angle_at(pts[_LM[j]], pts[_LM[a]], pts[_LM[b]])
        for j, a, b in _ANGLE_TRIPLES
    ]
    return np.asarray(feats, dtype=np.float64)


# 逐维标准化方差下限(度)。动作中接近静止的维度(如云手时的腿部) std 很小，
# 直接除会把 MediaPipe 关节角的测量抖动(实测约 3~8 度)放大成巨大差异，
# 拖垮整体分数。用典型抖动上限做下限后，动态维不受影响、静态维只保留有效信号。
_MIN_STD = 8.0

# 融合特征维度布局: [身体10 | 左手5 | 右手5]
BODY_DIM = 10
HAND_DIM_PER_HAND = 5
TOTAL_DIM = 20
# 手指弯曲角噪声大于身体关节角(远距离/侧对手时检测抖动大)，下限放宽到 12 度
MIN_STD_BY_DIM = np.array([_MIN_STD] * BODY_DIM
                          + [12.0] * (2 * HAND_DIM_PER_HAND))


def hand_finger_angles(pts):
    """21 个手部关键点 -> 5 维手指弯曲角(度)。

    每根手指取 (根, 中, 尖) 三点夹角，伸直约 160~175 度，弯曲变小。
    这是"手型"(兰花指/剑指/掌)的紧凑表达，且与身体关节角同量纲。
    """
    pts = np.asarray(pts)
    triples = [
        (1, 2, 4),     # 拇指: CMC-MCP-TIP
        (5, 6, 8),     # 食指: MCP-PIP-TIP
        (9, 10, 12),   # 中指
        (13, 14, 16),  # 无名指
        (17, 18, 20),  # 小指
    ]
    return np.asarray(
        [_angle_at(pts[t], pts[a], pts[b]) for a, t, b in triples],
        dtype=np.float64,
    )


def standardize(raw, mean=None, std=None, min_std=None):
    """逐维 z-score 标准化(带方差下限 + NaN 中性填充)。

    只传 raw 时计算模板统计量；同时传 mean/std 时按模板统计量变换新数据。
    min_std: None 时按维度自动选择(20 维融合特征用逐维数组，其余用标量 8)。

    NaN 语义: 手部检测失败的帧该维度为 NaN(姿态缺失而非错误)。统计量用
    nan 版本(只统计有效帧)，标准化后的 NaN 置 0 —— 即"处于模板均值"的
    中性值，不奖不罚，身体维度的打分不受手出画面的影响。
    """
    raw = np.asarray(raw, dtype=np.float64)
    if mean is None:
        with np.errstate(invalid="ignore"):
            mean = np.nanmean(raw, axis=0)
    if std is None:
        with np.errstate(invalid="ignore"):
            std = np.nanstd(raw, axis=0)
    if min_std is None:
        min_std = MIN_STD_BY_DIM if raw.shape[-1] == TOTAL_DIM else _MIN_STD
    min_std = np.broadcast_to(np.asarray(min_std, dtype=np.float64), std.shape)
    safe_std = np.maximum(np.nan_to_num(std, nan=0.0), min_std)
    out = np.nan_to_num((raw - mean) / safe_std, nan=0.0)
    return out, mean, safe_std


def dtw_distance(a, b, band=None):
    """Sakoe-Chiba 带约束 DTW，返回最优路径的 RMS 帧代价。

    帧代价 = 10 维特征的均方差(MSE)。取路径 RMS 而非平均绝对差，
    是为了压制零均值抖动噪声、放大系统性姿态偏差，提高区分度。
    DP 内循环用纯 Python 标量运算（numpy 标量索引开销远大于纯 Python 浮点），
    多模板实时比对时这里是热点路径。
    """
    a = np.asarray(a, dtype=np.float64)
    b = np.asarray(b, dtype=np.float64)
    n, m = len(a), len(b)
    if n == 0 or m == 0:
        return math.inf
    if band is None:
        band = max(n, m)
    band = max(int(band), abs(n - m))  # 带宽必须覆盖长度差，否则终点不可达

    # 帧间代价矩阵 (n, m)：10 维特征的均方差
    cost = ((a[:, None, :] - b[None, :, :]) ** 2).mean(axis=2).tolist()

    inf = math.inf
    prev_d = [inf] * (m + 1)
    prev_d[0] = 0.0  # D[0][0]
    prev_l = [0] * (m + 1)
    for i in range(1, n + 1):
        cur_d = [inf] * (m + 1)
        cur_l = [0] * (m + 1)
        crow = cost[i - 1]
        j_lo = max(1, i - band)
        j_hi = min(m, i + band)
        left_d, left_l = inf, 0
        for j in range(j_lo, j_hi + 1):
            dd = prev_d[j - 1]
            du = prev_d[j]
            if dd <= du and dd <= left_d:
                best, blen = dd, prev_l[j - 1]
            elif du <= left_d:
                best, blen = du, prev_l[j]
            else:
                best, blen = left_d, left_l
            best += crow[j - 1]
            cur_d[j] = best
            cur_l[j] = blen + 1
            left_d, left_l = best, cur_l[j]
        prev_d, prev_l = cur_d, cur_l
    total = prev_d[m]
    if not math.isfinite(total):
        return inf
    return float(math.sqrt(total / max(prev_l[m], 1)))


def sliding_window_match(buffer, template, step=1, band=None):
    """在 buffer 上以 step 为步长滑动与模板等长的窗口，逐窗 DTW。

    返回 [(窗口起点, DTW 距离), ...]，按起点升序。
    """
    template = np.asarray(template, dtype=np.float64)
    buffer = np.asarray(buffer, dtype=np.float64)
    T = template.shape[0]
    B = buffer.shape[0]
    if T <= 0 or B < T:
        return []
    if band is None:
        band = max(3, T // 4)
    out = []
    for start in range(0, B - T + 1, max(1, int(step))):
        d = dtw_distance(buffer[start:start + T], template, band=band)
        out.append((start, d))
    return out


def score(d, k=None):
    """DTW 平均帧代价 -> 0~100 分。"""
    if d is None or not math.isfinite(d):
        return 0.0
    if k is None:
        k = _SCORE_K
    return 100.0 * math.exp(-k * float(d))


# ---------------------------------------------------------------------------
# 合成数据（mock 自测用）
# ---------------------------------------------------------------------------

def best_match(buffer_arr, template_s):
    """多尺度滑窗匹配，返回 (最优 DTW 距离, 分数)。

    学员通常做得比模板慢：除等长滑窗外，再用「以缓冲区末尾为终点」的
    多长度窗口(重采样回模板长度)覆盖 1.05~1.5 倍时长的动作；做得稍快的
    由 DTW 带内时间伸缩吸收。

    缓冲比模板短(动作进行到一半)时，把整段缓冲重采样到模板长度比对，
    给出部分匹配分数。
    """
    template_len = template_s.shape[0]
    step = max(1, template_len // 6)
    band = max(3, template_len // 4)
    B = buffer_arr.shape[0]
    best_d = math.inf
    if B < template_len:
        # 动作进行中：整段缓冲拉伸到模板长度
        d = dtw_distance(_warp(buffer_arr, template_len), template_s, band=band)
        return d, score(d)
    # 等长滑窗：捕捉缓冲区内任意位置的动作
    for start in range(0, B - template_len + 1, step):
        d = dtw_distance(buffer_arr[start:start + template_len], template_s, band=band)
        if d < best_d:
            best_d = d
    # 末端多尺度窗口：捕捉刚完成、偏慢的动作
    for scale in (1.05, 1.15, 1.25, 1.35, 1.5):
        L = int(round(template_len * scale))
        if L > B:
            continue
        window = _warp(buffer_arr[B - L:], template_len)
        d = dtw_distance(window, template_s, band=band)
        if d < best_d:
            best_d = d
    if not math.isfinite(best_d):
        return None, None
    return best_d, score(best_d)


def _make_cloud_hand(n_frames=60):
    """合成"云手"模板: 身体 10 维 + 手部 10 维(手指兰花指慢切)，共 20 维。"""
    t = np.linspace(0.0, 1.0, n_frames, endpoint=False)
    cols = []
    for i in range(6):  # 手臂角：170 -> 60 -> 170
        phase = i * math.pi / 3.0
        bend = 0.5 - 0.5 * np.cos(2.0 * math.pi * t + phase)
        cols.append(170.0 - 110.0 * bend)
    for i in range(4):  # 腿部角：近似静止
        phase = i * math.pi / 2.0
        cols.append(8.0 * np.sin(2.0 * math.pi * t + phase))
    for i in range(10):  # 手指弯曲角：兰花指慢切 170 -> 120 -> 170
        phase = i * math.pi / 5.0
        curl = 0.5 - 0.5 * np.cos(2.0 * math.pi * t + phase)
        cols.append(170.0 - 50.0 * curl)
    return np.stack(cols, axis=1)


def _warp(template, target_len, noise=0.0, seed=None):
    """时间轴线性重采样到 target_len（模拟学员变速），可加高斯噪声。"""
    template = np.asarray(template, dtype=np.float64)
    n = template.shape[0]
    if int(target_len) == n:
        out = template.copy()
    else:
        src = np.linspace(0.0, n - 1.0, int(target_len))
        i0 = np.floor(src).astype(int)
        i1 = np.minimum(i0 + 1, n - 1)
        frac = (src - i0)[:, None]
        out = template[i0] * (1.0 - frac) + template[i1] * frac
    if noise > 0:
        rng = np.random.default_rng(seed)
        out = out + rng.normal(0.0, noise, out.shape)
    return out
