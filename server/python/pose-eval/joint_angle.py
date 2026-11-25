"""v2 身段比对核心算法（关节角特征 + 带约束 DTW）。

从 `scripts/动作识别/dtw_pose_match.py` 迁移并适配「浏览器端提特征」输入：
- 浏览器端(PoseEvalPage) 已跑 MediaPipe Pose + Hands，把 33+21+21 个关键点
  就地折算成 20 维关节角特征 [身体10 | 左手5 | 右手5]（度），
  手部检测失败的维度为 NaN（JSON 里传 null，服务端还原为 NaN）；
- 本模块只负责服务侧的：标准化 / 带约束 DTW / 多尺度滑窗匹配 / 打分，
  以及内置「云手」合成模板（演示用）。

与 v1（pose_match.py，99 维归一化坐标）的差异：
- 关节角天然平移/尺度/身材不变，学员与镜头距离、身高差异不敏感；
- 手部 10 维显式表达「手型」（兰花指/剑指/掌），贴合越剧身段教学；
- 多段模板 + 自动平均模板，抗单次录制噪声。
"""
from __future__ import annotations

import math
import warnings

import numpy as np

# 调参常数：score = 100 * exp(-K * max(0, d - d0))，d 为标准化特征的路径 RMS
# 代价，d0 为该模板「原样重做」的底噪距离（见 noise_floor）——扣除底噪后
# 只惩罚超出测量噪声的真实偏差，使「和录制一样准」≈ 满分
_SCORE_K = 2.0
_D0_CAP = 0.5  # 底噪扣除上限（防低信噪比模板把一切抬到满分）

# 融合特征维度布局: [身体10 | 左手5 | 右手5]
BODY_DIM = 10
HAND_DIM_PER_HAND = 5
TOTAL_DIM = 20

# 传感器底噪(度)：MediaPipe 关节角实测抖动 ~5-9°、手指角更大。模板自身
# 估计低于此值时（如零噪声的合成模板），按此下限模拟真人的重做
_SENSOR_NOISE = np.array([6.5] * BODY_DIM + [9.0] * (2 * HAND_DIM_PER_HAND))

# 逐维标准化方差下限(度)。动作中接近静止的维度(如云手时的腿部) std 很小，
# 直接除会把 MediaPipe 关节角的测量抖动(实测约 3~8 度)放大成巨大差异。
# 手指弯曲角噪声更大(远距离/侧对手时检测抖动大)，下限放宽到 12 度。
_MIN_STD = 8.0
MIN_STD_BY_DIM = np.array([_MIN_STD] * BODY_DIM
                          + [12.0] * (2 * HAND_DIM_PER_HAND))

# 识别模式（自由跟练）判定阈值：最高分超过该值才认为「识别出」该动作
RECOGNIZE_THRESHOLD = 65.0
# 最高与次高分至少拉开该值才输出类别。两个模板都很像时宁可提示继续完成
# 动作，也不把相近身段强行贴上错误标签。
RECOGNIZE_MARGIN = 8.0

# 身体 10 维的关节名（纠正提示用），顺序与特征前 10 维一一对应
BODY_JOINT_NAMES = ['左肘', '右肘', '左肩', '右肩', '左腕', '右腕',
                    '左髋', '右髋', '左膝', '右膝']
# 手部 10 维：[左手 拇/食/中/无名/小 | 右手 拇/食/中/无名/小]
HAND_JOINT_NAMES = ['左手拇指', '左手食指', '左手中指', '左手无名指', '左手小指',
                    '右手拇指', '右手食指', '右手中指', '右手无名指', '右手小指']
JOINT_NAMES = BODY_JOINT_NAMES + HAND_JOINT_NAMES


def standardize(raw, mean=None, std=None, min_std=None):
    """逐维 z-score 标准化(带方差下限 + NaN 中性填充)。

    只传 raw 时计算模板统计量；同时传 mean/std 时按模板统计量变换新数据。
    NaN 语义: 手部检测失败的帧该维度为 NaN(姿态缺失而非错误)。统计量用
    nan 版本(只统计有效帧)，标准化后的 NaN 置 0 —— 即「处于模板均值」的
    中性值，不奖不罚，身体维度的打分不受手出画面的影响。
    """
    raw = np.asarray(raw, dtype=np.float64)
    if mean is None:
        # 某些模板全程未检测到手部时，该手指维会全为 NaN。它表示“未采集”，
        # 不是异常；后续会以中性值处理，因此不应在每次加载模板时刷出警告。
        with warnings.catch_warnings(), np.errstate(invalid='ignore'):
            warnings.simplefilter('ignore', RuntimeWarning)
            mean = np.nanmean(raw, axis=0)
    if std is None:
        with warnings.catch_warnings(), np.errstate(invalid='ignore'):
            warnings.simplefilter('ignore', RuntimeWarning)
            std = np.nanstd(raw, axis=0)
    if min_std is None:
        min_std = MIN_STD_BY_DIM if raw.shape[-1] == TOTAL_DIM else _MIN_STD
    min_std = np.broadcast_to(np.asarray(min_std, dtype=np.float64), std.shape)
    safe_std = np.maximum(np.nan_to_num(std, nan=0.0), min_std)
    out = np.nan_to_num((raw - mean) / safe_std, nan=0.0)
    return out, mean, safe_std


def dtw_distance(a, b, band=None):
    """Sakoe-Chiba 带约束 DTW，返回最优路径的 RMS 帧代价。

    帧代价 = 20 维特征的均方差(MSE)。取路径 RMS 而非平均绝对差，
    是为了压制零均值抖动噪声、放大系统性姿态偏差，提高区分度。
    DP 内循环用纯 Python 标量运算（numpy 标量索引开销远大于纯 Python
    浮点），多模板实时比对时这里是热点路径。
    """
    a = np.asarray(a, dtype=np.float64)
    b = np.asarray(b, dtype=np.float64)
    n, m = len(a), len(b)
    if n == 0 or m == 0:
        return math.inf
    if band is None:
        band = max(n, m)
    band = max(int(band), abs(n - m))  # 带宽必须覆盖长度差，否则终点不可达

    # 帧间代价矩阵 (n, m)：20 维特征的均方差
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


def _warp(seq, target_len):
    """时间轴线性重采样到 target_len。"""
    seq = np.asarray(seq, dtype=np.float64)
    n = seq.shape[0]
    if int(target_len) == n:
        return seq.copy()
    src = np.linspace(0.0, n - 1.0, int(target_len))
    i0 = np.floor(src).astype(int)
    i1 = np.minimum(i0 + 1, n - 1)
    frac = (src - i0)[:, None]
    return seq[i0] * (1.0 - frac) + seq[i1] * frac


# 完成度评估（前缀匹配）：学员已实际跟做到的模板进度
_PREFIX_STEPS = (0.25, 0.4, 0.55, 0.7, 0.85, 1.0)  # 评估的模板前缀比例
_PREFIX_SPEEDS = (1.0, 1.15, 1.3)                  # 学员窗口时长/前缀时长 候选（≥1：
                                                   # 不给「部分内容压缩冒充更长前缀」留窗口，
                                                   # 做得快由 DTW 带内时间伸缩吸收）
_PREFIX_MIN_SCORE = 22.0                           # 跟做成立的绝对分数下限（完成度衡量进度
                                                   # 而非质量，低幅度完整跟做也应走满）
_PREFIX_REL_RATIO = 0.7                            # 阈值相对本轮实时最高分的比例
_PREFIX_REL_CAP = 70.0                             # 相对阈值上限（防瞬时高分拉爆阈值）
_PREFIX_DECAY = 10.0                               # 档位分数相对历史最高允许的衰减
                                                   # （持续跟做判定：定格/静止借 DTW 对齐
                                                   # 蒙混时，分数随档位加深而崩塌）
_PREFIX_TAIL_DROP = 25.0                           # 窗口后半得分相对整窗分允许的落差：
                                                   # 后半内容缺失（定格/静止）时整窗分被
                                                   # 前半稀释，尾段检验将其甄别
_PREFIX_STARTS = 3                                 # 窗口起点滑动候选数（容忍开头预备/站立帧）


def prefix_progress(attempt_s, template_s, prev=0.0, ref_score=0.0, d0=0.0):
    """从「自挑战开始累积的尝试序列」估算已跟做的模板进度(0~1)。

    对递增的前缀比例 p：在尝试序列的多个起点处取 ≥p·T 帧的窗口，
    与模板前 p·T 帧做带约束 DTW，得到该档位最高分 s(p)
    （打分扣除该模板底噪 d0）。
    档位达成需同时满足：
    1. s(p) ≥ threshold = clamp(0.7×本轮实时最高分, 22, 70)——完成度
       衡量「进度」而非「质量」，低幅度/不标准但完整跟做也应走满；
    2. 窗口尾段检验：得分最高且「窗口后半 vs 前缀后半」没有大幅劣化
       的窗口才算数——整窗 RMS 会被前半段稀释，定格/静止借 DTW 对齐
       蒙混的窗口正是「前半真做、后半缺失」；
    3. s(p) ≥ 历史最高档位分 - 10（持续跟做判定）。真跟做的分数随
       前缀延长保持平坦；缺内容的分数会随档位提高而崩塌。
    - 窗口时长候选均 ≥ 前缀时长：杜绝「40% 内容经 DTW 压缩冒充更长
      前缀」；学员做得偏快由 DTW 带内时间伸缩吸收；
    - 起点滑动：容忍点击身段后的预备姿势/站位调整等开头无关帧；
    - prev 传上一轮已确认的进度，≤prev 的档位直接跳过（进度单调）。
    """
    T = template_s.shape[0]
    B = attempt_s.shape[0]
    if B < 8 or T < 6:
        return 0.0
    threshold = min(max(_PREFIX_MIN_SCORE, _PREFIX_REL_RATIO * float(ref_score)),
                    _PREFIX_REL_CAP)
    best_p = 0.0
    peak_s = None  # 已达成档位中的最高分（衰减基准）
    for p in _PREFIX_STEPS:
        if p <= prev + 1e-9:
            best_p = p  # 已确认的档位无需重验
            continue
        P = min(T, max(6, int(round(T * p))))
        prefix = template_s[:P]
        cands = []
        for start in _start_candidates(B, P):
            for speed in _PREFIX_SPEEDS:
                L = int(round(P * speed))
                window = attempt_s[start:start + L]
                W = window.shape[0]
                if W < max(6, int(P * 0.75)):
                    continue  # 帧数不足以覆盖该前缀，尚未做到这一进度
                # 带宽须覆盖窗口与前缀的长度差（时间偏移）+ 伸缩余量
                band = max(3, abs(W - P) + min(W, P) // 3)
                d = dtw_distance(window, prefix, band=band)
                if math.isfinite(d):
                    cands.append((score(d, d0), window, prefix))
        # 尾段检验：整窗分降序取首个「后半内容确实在做」的窗口
        s_p = None
        for s, window, pref in sorted(cands, key=lambda c: -c[0]):
            if _tail_follows(window, pref, s, d0):
                s_p = s
                break
        if s_p is None or s_p < threshold:
            break  # 帧数不足或绝对分数不过线
        if peak_s is not None and s_p < peak_s - _PREFIX_DECAY:
            break  # 分数崩塌：不是持续跟做（静止/定格借 DTW 蒙混的特征）
        best_p = p
        peak_s = s_p if peak_s is None else max(peak_s, s_p)
    return best_p


def _tail_follows(window, prefix, s, d0):
    """窗口后半 vs 前缀后半的 DTW 得分不能比整窗差太多（防定格蒙混）。"""
    W, P = window.shape[0], prefix.shape[0]
    wt = window[max(3, W // 2):]
    pt = prefix[max(3, P // 2):]
    if len(wt) < 4 or len(pt) < 4:
        return True
    band = max(3, abs(len(wt) - len(pt)) + min(len(wt), len(pt)) // 3)
    d = dtw_distance(wt, pt, band=band)
    return math.isfinite(d) and score(d, d0) >= s - _PREFIX_TAIL_DROP


def _start_candidates(B, P):
    """窗口起点候选：0 ~ B-P 之间等距取 _PREFIX_STARTS 个（含首尾）。"""
    max_start = max(0, B - P)
    if max_start == 0:
        return (0,)
    step = max_start / (_PREFIX_STARTS - 1)
    return tuple(int(round(i * step)) for i in range(_PREFIX_STARTS))


def best_match(buffer_arr, template_s, d0=0.0, allow_partial=True):
    """多尺度滑窗匹配，返回 (最优 DTW 距离, 分数)。

    学员通常做得比模板慢：除等长滑窗外，再用「以缓冲区末尾为终点」的
    多长度窗口(重采样回模板长度)覆盖 1.05~1.5 倍时长的动作；做得稍快的
    由 DTW 带内时间伸缩吸收。

    缓冲比模板短(动作进行到一半)时，把整段缓冲重采样到模板长度比对，
    给出部分匹配分数。d0 为该模板的底噪距离（noise_floor），打分时扣除。
    """
    template_len = template_s.shape[0]
    step = max(1, template_len // 6)
    band = max(3, template_len // 4)
    B = buffer_arr.shape[0]
    best_d = math.inf
    if B < template_len:
        if not allow_partial:
            return None, None
        # 动作进行中：整段缓冲拉伸到模板长度
        d = dtw_distance(_warp(buffer_arr, template_len), template_s, band=band)
        return d, score(d, d0)
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
    return best_d, score(best_d, d0)


def score(d, d0=0.0):
    """DTW 平均帧代价(扣除底噪 d0) -> 0~100 分。"""
    if d is None or not math.isfinite(d):
        return 0.0
    excess = max(0.0, float(d) - min(float(d0), _D0_CAP))
    return 100.0 * math.exp(-_SCORE_K * excess)


def noise_std(raw):
    """二阶差分估计逐维测量噪声(度)。

    平滑运动的一阶差分仍含速度、二阶差分≈0，而白噪声被隔离：
    Var(Δ²x) = 6σ² → σ = std(Δ²x)/√6。NaN(手部缺失帧)不计入。
    """
    a = np.asarray(raw, dtype=np.float64)
    if a.ndim != 2 or len(a) < 4:
        return np.zeros(a.shape[1] if a.ndim == 2 else 0)
    d2 = np.diff(a, n=2, axis=0)
    with warnings.catch_warnings(), np.errstate(invalid='ignore'):
        warnings.simplefilter('ignore', RuntimeWarning)
        s = np.nanstd(d2, axis=0)
    return np.nan_to_num(np.maximum(s, 0.0), nan=0.0) / math.sqrt(6.0)


def noise_floor(ref_raw, mean, std, ref_s, trials=3):
    """模拟「原样重做一遍」的 DTW 距离底噪 d0。

    对参考段叠加 max(模板自身噪声估计, 传感器底噪) 的逐维抖动，与
    标准化模板做完整匹配，取多次模拟的中位数。真实重做不可能比这
    更接近模板；打分时在 score() 中扣除 d0，使「和录制一样准」≈ 满分。
    ref_raw 保留 NaN（手部缺失），与真人重做时的缺失语义一致。
    """
    a = np.asarray(ref_raw, dtype=np.float64)
    if a.ndim != 2 or len(a) == 0 or ref_s is None or len(ref_s) == 0:
        return 0.0
    noise = np.maximum(noise_std(a), _SENSOR_NOISE[:a.shape[1]])
    rng = np.random.default_rng(11)
    ds = []
    for _ in range(trials):
        pert = rng.normal(0.0, 1.0, a.shape) * noise
        pert[np.isnan(a)] = 0.0  # 缺失维保持缺失（中性语义）
        sim_s, _, _ = standardize(a + pert, mean=mean, std=std)
        d, _ = best_match(sim_s, ref_s)
        if d is not None and math.isfinite(d):
            ds.append(d)
    return float(np.median(ds)) if ds else 0.0


def angle_hints(cur_raw, mean_raw, top=2, z_threshold=1.15):
    """对比当前帧原始角度与模板均值，生成关节级纠正提示。

    用 MIN_STD_BY_DIM 做分母（与打分一致的噪声下限），
    只取 |z| 最大且超过阈值的 top 条，避免提示刷屏。
    角度大 = 伸展/伸直，角度小 = 弯曲/收拢。
    """
    cur = np.asarray(cur_raw, dtype=np.float64)
    mean = np.asarray(mean_raw, dtype=np.float64)
    if cur.shape[0] != TOTAL_DIM or mean.shape[0] != TOTAL_DIM:
        return []
    diff = cur - mean
    with np.errstate(invalid='ignore'):
        z = np.abs(np.nan_to_num(diff / MIN_STD_BY_DIM, nan=0.0))
    order = np.argsort(z)[::-1]
    hints = []
    for idx in order:
        if len(hints) >= top:
            break
        i = int(idx)
        if z[i] < z_threshold:
            break
        is_hand = i >= BODY_DIM
        larger = diff[i] > 0
        if is_hand:
            side = '左' if i < BODY_DIM + HAND_DIM_PER_HAND else '右'
            hints.append(f'{side}手手型与范本不一致，注意指法（兰花指/剑指）的收放')
        else:
            name = JOINT_NAMES[i]
            hints.append(f'{name}角度偏{"直" if larger else "弯"}，注意{"收一些" if larger else "舒展开"}')
    return hints


def make_cloud_hand_features(n_frames=60):
    """合成「云手」20 维特征模板: 身体10 + 手部10(兰花指轻捏)。

    按传统云手形态合成：双臂保持圆撑（肘角约 120~145 度），肩角随
    双手交替立圆上下起伏（左右相位相反，约 35~75 度），立掌收腕、
    指法为兰花指轻捏缓慢起伏，下肢稳定微沉。
    """
    t = np.linspace(0.0, 1.0, n_frames, endpoint=False)
    ph = 2.0 * math.pi * t
    cols = []
    # 肘角（肩-肘-腕）：云手全程圆臂不直不折，120~146 度小幅起伏
    cols.append(133.0 + 13.0 * np.sin(ph + 0.35))            # 左肘
    cols.append(133.0 + 13.0 * np.sin(ph + math.pi + 0.35))  # 右肘
    # 肩角（肘-肩-髋）：手臂随立圆抬起/回落，左右交替（一手上行另一手下行）
    cols.append(55.0 + 20.0 * np.sin(ph + math.pi))          # 左肩
    cols.append(55.0 + 20.0 * np.sin(ph))                    # 右肩
    # 腕角（肘-腕-指根）：立掌收腕，掌与前臂保持 150~166 度
    cols.append(158.0 + 7.0 * np.sin(ph + math.pi))          # 左腕
    cols.append(158.0 + 7.0 * np.sin(ph))                    # 右腕
    # 腿部角：站姿稳定，仅随呼吸微沉（≈172~177 度）
    for i in range(4):
        cols.append(174.5 + 2.5 * np.sin(ph + i * math.pi / 2.0))
    # 手指弯曲角：兰花指轻捏——拇指/中指相对收拢，食指/小指微伸，
    # 随云手节奏缓慢起伏（伸直约 165，轻捏约 140）
    finger_base = [160.0, 148.0, 155.0, 143.0, 150.0]        # 拇/食/中/无名/小
    for h in range(2):
        for i, base in enumerate(finger_base):
            cols.append(base + 5.0 * np.sin(ph + i * math.pi / 5.0 + h * math.pi))
    return np.stack(cols, axis=1)


# ============================================================
# 参考身段骨架重建（从关节角反推，供页面画「参考小人」）
# ============================================================
# 输出坐标约定与 v1（pose_match.py）一致：
#   髋部中点为原点、满肩宽 = 1.0 单位、y 向下；
# 关节顺序：[鼻, 左肩, 右肩, 左肘, 右肘, 左腕, 右腕, 左髋, 右髋, 左膝, 右膝]
# 与虚拟试衣页 REF_BONES 的索引一一对应。
DEMO_JOINTS = [0, 11, 12, 13, 14, 15, 16, 23, 24, 25, 26]
DEMO_KEYFRAMES = 14

# 固定人体比例（满肩宽 = 1.0 单位）
_HALF_SHOULDER = 0.5
_HALF_HIP = 0.4
_TORSO = 1.3
_UPPER_ARM = 1.15
_FOREARM = 1.05
_THIGH = 1.25
_HEAD_OFFSET = 0.62   # 鼻到肩线中点的距离


def _norm2(v):
    x, y = v
    d = math.hypot(x, y)
    return (x / d, y / d) if d > 1e-9 else (0.0, 0.0)


def _rot2(dirv, deg, flip):
    """把方向向量旋转 ±deg（flip=False 逆时针，True 顺时针），y 向下坐标系。"""
    th = math.radians(deg)
    s, c = math.sin(th), math.cos(th)
    dx, dy = dirv
    if flip:
        s = -s
    return (dx * c - dy * s, dx * s + dy * c)


def _dist2(a, b):
    return math.hypot(a[0] - b[0], a[1] - b[1])


def _solve_arm(shoulder, hip, a_shoulder, a_elbow, prev_elbow, prev_wrist):
    """由肩/肘角度解出 (肘, 腕) 位置（2 分支 × 2 分支，按连续性/姿态偏好选优）。

    a_shoulder: 肩角 = ∠(肘-肩-髋)，0=手臂贴身下垂，90=平举；
    a_elbow: 肘角 = ∠(肩-肘-腕)，~170=伸直，越小越弯。

    分支选择 = 帧间连续性 + 自然姿态先验：肘部圆撑于躯干外侧（戏曲
    「肘不离肋、肘不夹肋」的圆撑要求），避免反推骨架的肘穿越躯干中线
    出现「手臂内折」的怪相。
    """
    to_hip = _norm2((hip[0] - shoulder[0], hip[1] - shoulder[1]))
    cands = []
    for flip_s in (False, True):
        d_ua = _rot2(to_hip, a_shoulder, flip_s)
        elbow = (shoulder[0] + d_ua[0] * _UPPER_ARM, shoulder[1] + d_ua[1] * _UPPER_ARM)
        to_shoulder = _norm2((shoulder[0] - elbow[0], shoulder[1] - elbow[1]))
        for flip_e in (False, True):
            d_fa = _rot2(to_shoulder, a_elbow, flip_e)
            wrist = (elbow[0] + d_fa[0] * _FOREARM, elbow[1] + d_fa[1] * _FOREARM)
            cands.append((elbow, wrist))

    def outward_cost(elbow, wrist):
        """肘/腕穿越躯干中线的程度（x=0 为中线）：越向对侧越罚。"""
        return (max(0.0, -elbow[0] * shoulder[0]) * 0.9
                + max(0.0, -wrist[0] * shoulder[0]) * 0.25)

    if prev_elbow is not None:
        return min(cands, key=lambda c: (
            1.2 * _dist2(c[0], prev_elbow) + 0.8 * _dist2(c[1], prev_wrist)
            + 0.5 * outward_cost(*c)
        ))
    # 首帧偏好：手臂下垂（肘低于肩、腕低于肘）、肘在躯干外侧
    def first_cost(c):
        elbow, wrist = c
        cost = 0.0
        cost += max(0.0, shoulder[1] - elbow[1]) * 2.0      # 肘不低于肩则罚
        cost += max(0.0, elbow[1] - wrist[1]) * 1.2         # 腕不低于肘则罚
        cost += outward_cost(elbow, wrist) * 1.0            # 肘在躯干外侧
        return cost
    return min(cands, key=first_cost)


def _solve_knee(hip, shoulder, a_hip, prev_knee):
    """由髋角解出膝位置：∠(肩-髋-膝)，180=腿自然下垂，越小越抬腿。

    示意动画专用：2D 投影角度在转身类动作会假性偏小（腿看似抬过水平），
    兜底重建时把腿角钳制到 ≥100°（膝不低于髋水平线），避免「腿上翻」怪相。
    真人骨架录制不受此影响。
    """
    a_hip = max(float(a_hip), 100.0)
    to_shoulder = _norm2((shoulder[0] - hip[0], shoulder[1] - hip[1]))
    cands = [
        (hip[0] + d[0] * _THIGH, hip[1] + d[1] * _THIGH)
        for d in (_rot2(to_shoulder, a_hip, False), _rot2(to_shoulder, a_hip, True))
    ]
    if prev_knee is not None:
        return min(cands, key=lambda k: _dist2(k, prev_knee) + 0.4 * max(0.0, hip[1] - k[1]))
    return min(cands, key=lambda k: max(0.0, hip[1] - k[1]))


def _angles_to_pose(a, prev):
    """10 维身体角度(度) -> 11 关节 [x,y] 列表（髋中心原点、满肩宽=1、y 向下）。

    prev: 上一帧解出的 (le,lw,re,rw,lk,rk)，用于分支连续性选择。
    """
    ls = (-_HALF_SHOULDER, -_TORSO)
    rs = (_HALF_SHOULDER, -_TORSO)
    lh = (-_HALF_HIP, 0.0)
    rh = (_HALF_HIP, 0.0)
    prev = prev or {}

    le, lw = _solve_arm(ls, lh, float(a[2]), float(a[0]), prev.get('le'), prev.get('lw'))
    re, rw = _solve_arm(rs, rh, float(a[3]), float(a[1]), prev.get('re'), prev.get('rw'))
    lk = _solve_knee(lh, ls, float(a[6]), prev.get('lk'))
    rk = _solve_knee(rh, rs, float(a[7]), prev.get('rk'))
    nose = ((ls[0] + rs[0]) / 2.0, (ls[1] + rs[1]) / 2.0 - _HEAD_OFFSET)

    pts = [nose, ls, rs, le, re, lw, rw, lh, rh, lk, rk]
    return {
        'pose': [[round(p[0], 3), round(p[1], 3)] for p in pts],
        'le': le, 'lw': lw, 're': re, 'rw': rw, 'lk': lk, 'rk': rk,
    }


def demo_skeleton_frames(raw_angles, keyframes=DEMO_KEYFRAMES):
    """20 维关节角序列 -> 自然、可跟练的参考骨架关键帧。

    关节角只有“夹角”而没有肢体朝向；旧实现试图从单个角度反解完整骨架，
    在 2D 投影/遮挡条件下会随机选到错误分支，出现手臂穿过躯干、腿向外叉开
    等不符合戏曲身段规范的画面。

    旧模板没有保存真人骨架时，改用“规范圆手”映射：只让模板中肩、肘角的
    变化驱动手臂开合，固定肩、胯、腿的自然站姿，保证肘部外圆、腕部顺势、
    双腿稳定。新录制/导入模板仍优先显示其保存的真人骨架，不受本函数影响。
    """
    raw = np.asarray(raw_angles, dtype=np.float64)
    if raw.ndim != 2 or raw.shape[1] != TOTAL_DIM or len(raw) < 2:
        return []

    def clamp(v, lo, hi):
        return min(max(float(v), lo), hi)

    def round_arm(side, shoulder, shoulder_angle, elbow_angle):
        """构造戏曲圆手：肘在身体外侧，腕沿圆弧顺势展开。"""
        # 肩角越小，手臂抬得越开；限幅防止 2D 投影导致的“翻臂”。
        theta = math.radians(clamp(160.0 - shoulder_angle, 28.0, 92.0))
        # 肘角只控制圆臂弯曲，不允许折成锐角或被噪声拉直到僵硬。
        bend = math.radians(clamp(180.0 - elbow_angle, 18.0, 62.0))
        sx, sy = shoulder
        elbow = (
            sx + side * math.sin(theta) * 0.82,
            sy + math.cos(theta) * 0.82,
        )
        wrist_theta = min(math.radians(112.0), theta + bend * 0.72)
        wrist = (
            elbow[0] + side * math.sin(wrist_theta) * 0.73,
            elbow[1] + math.cos(wrist_theta) * 0.73,
        )
        # 越剧圆手可提腕，但腕不得高过头部；这也避免关键点抖动造成怪相。
        wrist = (wrist[0], max(wrist[1], -1.88))
        return elbow, wrist

    n = min(keyframes, len(raw))
    idx = np.round(np.linspace(0, len(raw) - 1, n)).astype(int)
    frames = []
    for i in idx:
        body = np.nan_to_num(raw[i, :BODY_DIM], nan=0.0)
        ls, rs = (-_HALF_SHOULDER, -_TORSO), (_HALF_SHOULDER, -_TORSO)
        lh, rh = (-_HALF_HIP, 0.0), (_HALF_HIP, 0.0)
        le, lw = round_arm(-1.0, ls, body[2], body[0])
        re, rw = round_arm(1.0, rs, body[3], body[1])
        # 参考小人不以 2D 髋/膝角模拟步法：该信息最易受镜头裁切影响，
        # 固定小八字自然站姿能避免“劈叉/抬腿”的错误示范。
        lk, rk = (-0.46, 1.08), (0.46, 1.08)
        nose = (0.0, -1.92)
        pts = [nose, ls, rs, le, re, lw, rw, lh, rh, lk, rk]
        frames.append([[round(x, 3), round(y, 3)] for x, y in pts])
    return frames
