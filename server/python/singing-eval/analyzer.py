"""
越剧演唱测评分析器（音准 · 板眼节奏）
=====================================================================
【功能边界 —— 硬性专业约束，必须随报告一并展示】
1. 仅评估「音准」与「节奏板眼」两个维度；
2. 不识别：咬字、润腔、尖团字、气息 —— 本分析器不具备相关能力；
3. 所有输出分数均为【参考分】，仅供教学演示参考，
   不能替代专业越剧教师的听辨评判；
4. 报告措辞均为客观描述 + 改进建议，
   不使用「错误 / 很差 / 不合格」等绝对化评判词汇。

【演示定位】教学演示辅助工具，不是专业戏曲评测。
抗噪能力有限：安静环境清唱效果最佳；带伴奏音频中，
主旋律乐器可能牵引基频判定，结果仅供参考。

【技术栈】librosa（音频 IO / onset / DTW） + pyworld（dio+stonemask 基频提取）
          + numpy / scipy（带通滤波等）
=====================================================================
"""
import time
import numpy as np
import librosa
import pyworld as pw
import soundfile as sf
from numba import njit
from scipy.signal import butter, sosfiltfilt

# ------------------------------------------------------------------
# 可调参数（演示用经验参数，非专业标准）
# ------------------------------------------------------------------
SR = 16000            # 统一重采样率：人声分析足够
FRAME_MS = 10         # f0 帧移（毫秒），对颤音（5-7Hz）友好
FRAME_SEC = FRAME_MS / 1000.0

BAND_LOW, BAND_HIGH = 70, 2000     # 人声带通范围（Hz）：抑制低频轰鸣与高频嘶声

PITCH_TOL_COARSE = 50   # 音准粗判阈值（音分）：约半个半音
PITCH_TOL_FINE = 25     # 音准细判阈值（音分）
PITCH_SEG_MIN = 0.3     # 音准偏差片段最短时长（秒）

RHYTHM_TOL = 0.2        # 板眼偏差阈值（秒）：抢板/拖板判定。
                         # onset 检测噪声约 50-80ms，低于 0.2s 的偏移多为检测抖动，
                         # 达到 0.2s（约半拍级滞后/超前）才作为教学反馈提示
RHYTHM_MATCH_WIN = 1.0  # onset 匹配窗口（秒）
RHYTHM_SEG_MIN = 0.3    # 节奏问题片段最短时长（秒）
RHYTHM_CTX_K = 3        # 局部板眼趋势的外推窗口（前 K 个匹配点）

MIN_DURATION, MAX_DURATION = 3, 120   # 音频时长限制（秒）
MIN_VOICED_RATIO = 0.05               # 最低有声帧占比
MIN_VOICED_PAIR = 20                  # 最少可对齐有声帧

# 打分权重（演示用）：总参考分 = 0.6 × 音准 + 0.4 × 节奏
W_PITCH, W_RHYTHM = 0.6, 0.4


class AnalysisError(Exception):
    """分析失败（用户可读的客观描述，直接透传给前端）"""


# ------------------------------------------------------------------
# 1. 预处理：加载 + 重采样 + 简易降噪（带通滤波）
# ------------------------------------------------------------------
def load_and_preprocess(path):
    """加载音频 → 单声道 16kHz → 70-2000Hz 带通（简易降噪）"""
    try:
        # 先读文件头，避免超长/高采样率文件完整解码后才被拒绝。
        dur = sf.info(path).duration
        if dur < MIN_DURATION or dur > MAX_DURATION:
            raise AnalysisError(f'音频时长 {dur:.1f} 秒，请使用 {MIN_DURATION}-{MAX_DURATION} 秒的片段')
        y, _ = librosa.load(path, sr=SR, mono=True)
    except AnalysisError:
        raise
    except Exception as e:
        raise AnalysisError(f'音频解码失败，请确认是有效的 WAV 文件（{e}）')
    dur = len(y) / SR
    if dur < MIN_DURATION:
        raise AnalysisError(f'音频时长 {dur:.1f} 秒过短，需 {MIN_DURATION}-{MAX_DURATION} 秒')
    if dur > MAX_DURATION:
        raise AnalysisError(f'音频时长 {dur:.1f} 秒过长，请截取 {MAX_DURATION} 秒以内的片段')
    sos = butter(4, [BAND_LOW, BAND_HIGH], btype='band', fs=SR, output='sos')
    # ascontiguousarray：sosfiltfilt 可能返回非连续内存数组，pyworld 要求 C 连续
    y_f = np.ascontiguousarray(sosfiltfilt(sos, y), dtype=np.float64)
    return y_f, dur


# ------------------------------------------------------------------
# 2. 基频（f0）提取：pyworld dio+stonemask + 音分转换 + 间隙填补
# ------------------------------------------------------------------
def extract_cents_contour(y):
    """dio + stonemask 提取 f0 → 转音分（cents，对数刻度）→ 填补无声间隙。

    注：pyworld 0.3.5（Python 3.13 / Windows 构建）的 harvest 算法存在
    检测失效问题（纯净正弦信号 0 帧有声），故改用经典的 dio 提取 +
    stonemask 精化组合，实测该构建下工作正常。

    返回 (cents_contour, voiced_mask)。voiced_mask 为判定有声的帧。
    无声帧的 cents 值为插值/保持结果，仅供 DTW 对齐使用，
    音准统计只取两侧均有声的帧。
    """
    y = np.ascontiguousarray(y, dtype=np.float64)
    f0_raw, t = pw.dio(y, SR, frame_period=FRAME_MS)
    f0 = pw.stonemask(y, f0_raw, t, SR)  # 无声帧 f0=0
    voiced = f0 > 0
    if voiced.sum() < 10:
        raise AnalysisError('未检测到足够的人声片段：请使用更清晰的清唱录音（本工具抗噪能力有限，伴奏可能干扰判定）')

    cents = np.zeros_like(f0)
    cents[voiced] = 1200.0 * np.log2(f0[voiced] / 440.0)

    # 间隙填补：保持前一个有声帧的音高（前值保持）—— 首/尾边界用最近有声值。
    # 不用线性插值：插值会在两个音之间制造出连续过渡的「假音高」帧，
    # 跑调的音符在 DTW 中会躲进这些过渡帧（偏差被算成 ≈0），导致漏检。
    vi = np.where(voiced)[0]
    last_idx = np.maximum.accumulate(np.where(voiced, np.arange(len(f0)), 0))
    last_idx[:vi[0]] = vi[0]  # 首段间隙：指向第一个有声帧
    filled = cents[last_idx]
    return filled, voiced


# ------------------------------------------------------------------
# 3. DTW 对齐 + 音准偏差
# ------------------------------------------------------------------
@njit(cache=True, nogil=True)
def _banded_dtw_path(ref_cents, stu_cents):
    """精确带状 DTW：两行累计代价 + 带内 uint8 回溯方向。

    与 librosa 默认的距离、步长、同分优先级及 25% 约束相同。
    不创建 N×M 的距离/累计代价/整数索引矩阵；保留 10ms 原始帧。
    """
    n, m = len(ref_cents), len(stu_cents)
    radius = max(1, int(np.round(0.25 * min(n, m))))
    lower = radius + max(0, n - m)
    upper = radius + max(0, m - n)
    width = min(m, lower + upper - 1)
    steps = np.zeros((n, width), dtype=np.uint8)
    previous = np.full(m + 1, np.inf)
    current = np.full(m + 1, np.inf)
    previous[0] = 0.0
    for i in range(n):
        current[:] = np.inf
        start = max(0, i - lower + 1)
        stop = min(m, i + upper)
        for j in range(start, stop):
            cost = abs(ref_cents[i] - stu_cents[j])
            best = previous[j] + cost  # 对角优先，再水平、垂直
            direction = 0
            horizontal = current[j] + cost
            vertical = previous[j + 1] + cost
            if horizontal < best:
                best, direction = horizontal, 1
            if vertical < best:
                best, direction = vertical, 2
            current[j + 1] = best
            steps[i, j - start] = direction
        previous, current = current, previous
    if not np.isfinite(previous[m]):
        raise ValueError('No valid alignment path')
    path = np.empty((n + m - 1, 2), dtype=np.int32)
    i, j, count = n - 1, m - 1, 0
    while True:
        path[count, 0], path[count, 1] = i, j
        count += 1
        if i == 0 and j == 0:
            break
        direction = steps[i, j - max(0, i - lower + 1)]
        if direction == 0:
            i, j = i - 1, j - 1
        elif direction == 1:
            j -= 1
        else:
            i -= 1
    return path[:count]


def dtw_align(ref_cents, stu_cents):
    """返回学生帧 → 范本帧映射，不降低音准或片段定位精度。"""
    n, m = len(ref_cents), len(stu_cents)
    if not n or not m or not np.isfinite(ref_cents).all() or not np.isfinite(stu_cents).all():
        raise AnalysisError('音高数据无效，无法进行比对')
    wp = _banded_dtw_path(np.asarray(ref_cents, dtype=np.float64),
                          np.asarray(stu_cents, dtype=np.float64))
    band = max(5, int(0.25 * max(n, m)))
    stu_to_ref = [[] for _ in range(m)]
    for i, j in zip(wp[:, 0], wp[:, 1]):
        # wp[:, 0] 索引 X（范本），wp[:, 1] 索引 Y（学生）
        stu_to_ref[int(j)].append(int(i))
    return stu_to_ref, band


def pitch_analysis(ref_cents, ref_voiced, stu_cents, stu_voiced):
    """DTW 对齐后逐帧音分偏差 → 偏差片段标记 + 音准参考分"""
    stu_to_ref, _ = dtw_align(ref_cents, stu_cents)

    devs = np.full(len(stu_cents), np.nan)
    for j, ref_idx in enumerate(stu_to_ref):
        if not ref_idx or not stu_voiced[j]:
            continue
        # 只统计「学生有声 且 匹配到的范本帧也有声」的帧 —— 双方都真实发声
        ref_voiced_idx = [i for i in ref_idx if ref_voiced[i]]
        if not ref_voiced_idx:
            continue
        devs[j] = stu_cents[j] - float(np.median(ref_cents[ref_voiced_idx]))

    valid = ~np.isnan(devs)
    if valid.sum() < MIN_VOICED_PAIR:
        raise AnalysisError('可对齐的人声片段过少，无法进行可靠的音准比对，请尽量完整演唱范本唱段')

    abs_dev = np.abs(devs[valid])
    p_coarse = float(np.mean(abs_dev <= PITCH_TOL_COARSE))
    p_fine = float(np.mean(abs_dev <= PITCH_TOL_FINE))
    pitch_score = int(round(np.clip(60 * p_coarse + 40 * p_fine, 0, 100)))

    # 偏差片段：|Δ音分| > 50 且持续 ≥ 0.3s，容忍 ≤3 帧的抖动
    bad = valid & (np.abs(devs) > PITCH_TOL_COARSE)
    segs = _merge_flags(bad, FRAME_SEC, PITCH_SEG_MIN, allow_gap=3)
    segments = []
    for s, e in segs:
        # allow_gap 会把区间内未被标记的帧一并并入，其中可能包含无效帧
        # （devs 为 NaN，如「学生有声但匹配到的范本帧无声」）。
        # 必须用 nanmean 并且对「整段无有效帧」兜底，否则 NaN 会让
        # int(round(...)) 抛 ValueError（历史上实测触发过 500）。
        seg_valid = valid[s:e + 1]
        if not seg_valid.any():
            continue
        seg_dev = float(np.mean(devs[s:e + 1][seg_valid]))
        if not np.isfinite(seg_dev):
            continue
        direction = '偏高' if seg_dev > 0 else '偏低'
        mag = abs(int(round(seg_dev)))
        t0, t1 = s * FRAME_SEC, (e + 1) * FRAME_SEC
        segments.append({
            'start_time': round(t0, 2),
            'end_time': round(t1, 2),
            'dim': 'pitch',
            'problem_desc': (
                f'该片段较范本{direction}约 {mag} 音分，持续 {t1 - t0:.1f} 秒；'
                f'建议放慢速度，对照范本逐句模唱这一句'
            ),
        })

    stats = {
        'voiced_ratio': round(float(np.mean(stu_voiced)), 3),
        'median_abs_dev_cents': int(round(float(np.median(abs_dev)))),
        'within_50_cents_ratio': round(p_coarse, 3),
    }
    return pitch_score, segments, stats, devs, valid


# ------------------------------------------------------------------
# 4. 板眼节奏比对：onset × DTW 时间映射
# ------------------------------------------------------------------
def _onset_times(y, voiced):
    """onset 检测 + 静音区伪峰过滤。

    onset 包络在音符收尾/静音段可能出现伪峰（实测会在结尾静音里
    检出假 onset，被误判成拖板），这里只保留落在有声区
    （或其后 0.1s 内进入有声区）的 onset。
    """
    env = librosa.onset.onset_strength(y=y, sr=SR, hop_length=int(SR * FRAME_SEC))
    on = librosa.onset.onset_detect(
        onset_envelope=env, sr=SR, hop_length=int(SR * FRAME_SEC), units='time'
    )
    keep = []
    for t in on:
        f = int(t / FRAME_SEC)
        if f < len(voiced) and (voiced[f] or voiced[f:f + 10].any()):
            keep.append(float(t))
    return np.array(keep)


def _match_onsets(ref_on, stu_on, scale):
    """顺序单调匹配：范本 onset → 窗口内最近的未匹配学生 onset。

    两指针保证匹配保持先后顺序（板眼次序不乱）；窗口随时长放宽，
    容忍整体速度差异。返回 [(范本时刻, 学生时刻), ...]。
    """
    pairs = []
    j = 0
    for tr in ref_on:
        expected = scale * tr
        win = max(RHYTHM_MATCH_WIN, 0.3 * expected)
        best_k, best_d = -1, float('inf')
        for k in range(j, len(stu_on)):
            d = stu_on[k] - expected
            if d > win:
                break  # 学生 onset 已在窗口右侧，后面的更远
            if abs(d) < best_d:
                best_k, best_d = k, abs(d)
        if best_k >= 0:
            pairs.append((float(tr), float(stu_on[best_k])))
            j = best_k + 1
    return pairs


def rhythm_analysis(ref_y, stu_y, ref_voiced, stu_voiced):
    """板眼节奏比对：onset 顺序匹配 + 稳健仿射时间模型 + 残差标记。

    时间模型：t_学生 ≈ a·t_范本 + b
      a（斜率）= 整体速度比（Theil-Sen 稳健估计），
      b（截距）= 整体进唱偏移（残差中位数）。
    整体偏快/偏慢/晚进唱被模型吸收，通过 stats.tempo_ratio 反馈；
    抢板 = 学生比模型预期更早（残差为负），拖板 = 更晚（残差为正）。
    板眼参考分只衡量局部落点一致性，不给整体速度差异扣分。
    onset 少于 3 个时无法分析，节奏分返回 None（前端显示「—」）。
    """
    ref_on = _onset_times(ref_y, ref_voiced)
    stu_on = _onset_times(stu_y, stu_voiced)

    if len(ref_on) < 3 or len(stu_on) < 3:
        return None, [], {'onset_count': int(len(stu_on)), 'note': '检测到的板眼点不足，未进行节奏分析'}

    # 初始速度估计（有声时长比）→ 顺序匹配 → 稳健仿射拟合
    scale0 = float(np.clip(
        float(stu_voiced.sum()) / max(float(ref_voiced.sum()), 1.0), 0.25, 4.0))
    pairs = _match_onsets(ref_on, stu_on, scale0)
    if len(pairs) < 3:
        return None, [], {'onset_count': int(len(stu_on)), 'note': '可对齐的板眼点不足，未进行节奏分析'}

    tr_arr = np.array([p[0] for p in pairs])
    ts_arr = np.array([p[1] for p in pairs])

    # 整体速度比：全部匹配点的 Theil-Sen 斜率（供 stats.tempo_ratio 反馈，
    # 不参与抢/拖板判定 —— 整体偏快偏慢不算局部板眼问题）
    slopes = []
    for a in range(len(pairs)):
        for b in range(a + 1, len(pairs)):
            dr = tr_arr[b] - tr_arr[a]
            if dr > 0.05:
                slopes.append((ts_arr[b] - ts_arr[a]) / dr)
    tempo = float(np.clip(np.median(slopes), 0.5, 2.0)) if slopes else 1.0

    # 局部板眼残差：用前 K 个匹配点做局部线性外推，得到该板眼的「预期时刻」，
    # 残差 = 实际 - 预期。整体速度差被局部斜率吸收（不误报），
    # 阶跃式的抢板/拖板则会在发生点被暴露（后续点重新建立趋势，不再重复报）。
    devs = np.zeros(len(pairs))
    for i in range(len(pairs)):
        lo = max(0, i - RHYTHM_CTX_K)
        if i - lo < 2:
            continue  # 前置上下文不足 2 个点，不判定
        x = tr_arr[lo:i]
        y = ts_arr[lo:i]
        A = np.vstack([x, np.ones(len(x))]).T
        (a_, b_), *_ = np.linalg.lstsq(A, y, rcond=None)
        devs[i] = ts_arr[i] - (a_ * tr_arr[i] + b_)  # 秒：正=滞后(拖板)，负=超前(抢板)

    # 片段化：从问题 onset 到下一个匹配 onset（或 +0.8s）
    segs = []
    for idx in range(len(pairs)):
        d = float(devs[idx])
        if abs(d) <= RHYTHM_TOL:
            continue
        kind = '拖板' if d > 0 else '抢板'
        t0 = float(ts_arr[idx])
        t1 = float(ts_arr[idx + 1]) if idx + 1 < len(pairs) else t0 + 0.8
        segs.append({'kind': kind, 'start': t0, 'end': t1, 'dev': d})

    # 合并相邻同类片段
    merged = []
    for s in sorted(segs, key=lambda x: x['start']):
        if merged and s['kind'] == merged[-1]['kind'] and s['start'] - merged[-1]['end'] < RHYTHM_SEG_MIN:
            merged[-1]['end'] = max(merged[-1]['end'], s['end'])
        else:
            merged.append(s)

    segments = []
    bad_time = 0.0
    for s in merged:
        dur = s['end'] - s['start']
        if dur < RHYTHM_SEG_MIN:
            continue
        bad_time += dur
        direction = '滞后' if s['dev'] > 0 else '超前'
        segments.append({
            'start_time': round(s['start'], 2),
            'end_time': round(s['end'], 2),
            'dim': 'rhythm',
            'problem_desc': (
                f'该片段演唱进度较范本{direction}约 {abs(s["dev"]):.1f} 秒（{s["kind"]}），'
                f'建议用节拍器由慢至快分段练习，注意板眼的落点'
            ),
        })

    voiced_sec = max(float(stu_voiced.sum()) * FRAME_SEC, 1.0)
    rhythm_score = int(round(np.clip(100 * max(0.0, 1 - 1.2 * bad_time / voiced_sec), 0, 100)))

    stats = {
        'onset_count': int(len(stu_on)),
        'matched_onsets': len(pairs),
        'tempo_ratio': round(tempo, 3),  # >1 = 整体偏慢（学生时间轴被拉长）
    }
    return rhythm_score, segments, stats


# ------------------------------------------------------------------
# 5. 打分汇总 + 报告生成
# ------------------------------------------------------------------
def _merge_flags(flags, unit_sec, min_sec, allow_gap=0):
    """把布尔帧序列合并为 (起帧, 止帧) 片段，容忍 allow_gap 帧抖动，过滤过短片段"""
    flags = np.asarray(flags, dtype=bool)
    # 游程合并（allow_gap > 0 时，短暂中断不切断片段）
    segs = []
    start = None
    gap = 0
    for i, f in enumerate(flags):
        if f:
            if start is None:
                start = i
            gap = 0
        else:
            if start is not None:
                gap += 1
                if gap > allow_gap:
                    if (i - gap - start) * unit_sec >= min_sec:
                        segs.append((start, i - gap - 1))
                    start = None
    if start is not None and (len(flags) - start) * unit_sec >= min_sec:
        segs.append((start, len(flags) - 1))
    return segs


def _build_suggestion(pitch_score, pitch_segs, rhythm_score, rhythm_segs, stats):
    """规则化生成练习建议 —— 全部为客观描述 + 改进建议，无绝对化评判词汇"""
    tips = []

    if pitch_score is None:
        tips.append('音准维度未生成参考分（可对齐人声片段不足）。')
    elif pitch_score >= 85:
        tips.append('整体音准与范本贴合度较好，继续保持现有的音高习惯。')
    else:
        n = len(pitch_segs)
        hi = sum(1 for s in pitch_segs if '偏高' in s['problem_desc'])
        lo = n - hi
        part = []
        if hi:
            part.append(f'{hi} 处偏高')
        if lo:
            part.append(f'{lo} 处偏低')
        tips.append(
            f'音准方面有 {n} 处片段与范本偏差较大（{"、".join(part) if part else ""}），'
            f'建议对照波形中标记的片段，放慢速度逐句模唱，先求准再求连。'
        )

    if rhythm_score is None:
        tips.append('节奏板眼维度未生成参考分（检测到的板眼点不足）。')
    elif rhythm_score >= 85:
        tips.append('板眼节奏整体平稳，与范本速度基本一致。')
    else:
        n = len(rhythm_segs)
        qian = sum(1 for s in rhythm_segs if '抢板' in s['problem_desc'])
        tuo = n - qian
        part = []
        if qian:
            part.append(f'{qian} 处抢板')
        if tuo:
            part.append(f'{tuo} 处拖板')
        tips.append(
            f'节奏方面有 {n} 处片段板眼落点与范本不一致（{"、".join(part) if part else ""}），'
            f'建议用节拍器由慢至快分段练习，稳定后再回到原速。'
        )

    tempo = stats.get('tempo_ratio')
    if tempo is not None:
        if tempo > 1.12:
            tips.append(f'整体演唱速度较范本偏慢（约 {tempo:.2f} 倍时长），可先熟悉唱词再逐步提速。')
        elif tempo < 0.88:
            tips.append(f'整体演唱速度较范本偏快（约 {tempo:.2f} 倍时长），建议放慢下来把字头字尾交代清楚。')

    tips.append('以上反馈仅覆盖音准与板眼节奏两个维度，供练习时参考；咬字、润腔等请以专业老师课堂指导为准。')
    return ' '.join(tips)


def analyze(stu_path, ref_path):
    """主入口：学生演唱 + 范本 → 结构化测评报告（JSON 可序列化 dict）"""
    t0 = time.time()
    stu_y, stu_dur = load_and_preprocess(stu_path)
    ref_y, ref_dur = load_and_preprocess(ref_path)

    stu_cents, stu_voiced = extract_cents_contour(stu_y)
    ref_cents, ref_voiced = extract_cents_contour(ref_y)

    if float(np.mean(stu_voiced)) < MIN_VOICED_RATIO:
        raise AnalysisError('学生音频中有效人声占比过低，请尽量使用安静环境的清唱录音')

    pitch_score, pitch_segs, pitch_stats, _, _ = pitch_analysis(
        ref_cents, ref_voiced, stu_cents, stu_voiced)
    rhythm_score, rhythm_segs, rhythm_stats = rhythm_analysis(
        ref_y, stu_y, ref_voiced, stu_voiced)

    # 总参考分：节奏分缺失时按音准分折算（权重归一），并在建议中说明
    if rhythm_score is None:
        total = pitch_score
    else:
        total = int(round(W_PITCH * pitch_score + W_RHYTHM * rhythm_score))

    problem_segments = pitch_segs + rhythm_segs
    problem_segments.sort(key=lambda s: s['start_time'])

    stats = {**pitch_stats, **rhythm_stats}
    suggestion = _build_suggestion(pitch_score, pitch_segs, rhythm_score, rhythm_segs, stats)

    return {
        # 硬性合规字段：报告自包含限制声明
        'disclaimer': '本音频测评仅为教学演示参考，不能替代专业老师听辨打分',
        'scope': '仅评估音准与节奏板眼，不识别咬字、润腔、尖团字、气息',
        'total_score': total,
        'pitch_score': pitch_score,
        'rhythm_score': rhythm_score,   # 可能为 null（板眼点不足）
        'problem_segments': problem_segments,
        'suggestion': suggestion,
        'stats': stats,
        'meta': {
            'ref_duration': round(ref_dur, 2),
            'stu_duration': round(stu_dur, 2),
            'elapsed_ms': int((time.time() - t0) * 1000),
            'version': '1.1.0',
        },
    }
