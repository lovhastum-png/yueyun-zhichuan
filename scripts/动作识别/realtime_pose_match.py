"""实时动作识别：摄像头采集 -> 模板库多模板 DTW 匹配。

用法:
  python realtime_pose_match.py --record 云手    # 录制模式：示范动作存入模板库
  python realtime_pose_match.py                  # 识别模式：加载 templates/ 全部动作实时识别
  python realtime_pose_match.py --mock           # 合成数据自测(无摄像头)
"""

import argparse
import math
import os
from collections import deque

import numpy as np

from dtw_pose_match import (
    pose_feature_vector,
    hand_finger_angles,
    standardize,
    score,
    best_match,
    TOTAL_DIM,
    HAND_DIM_PER_HAND,
    _make_cloud_hand,
    _warp,
)
from template_store import save_segment, load_templates, MIN_SEGMENT_LEN

TEMPLATE_DIR = os.path.join(os.path.dirname(os.path.abspath(__file__)), "templates")
RECOGNIZE_INTERVAL = 3     # 每 N 帧做一轮全库识别(保证 FPS)
RECOGNIZE_THRESHOLD = 65   # 分数超过该值才认为"识别出"该动作


def _score_color(s):
    if s is None:
        return (128, 128, 128)
    if s >= 70:
        return (0, 255, 0)
    if s >= 45:
        return (0, 220, 255)
    return (0, 0, 255)


def _window_closed(cv2, win_name):
    """用户是否点了窗口右上角 X。

    OpenCV 的 waitKey 收不到关闭事件：点 X 后窗口销毁，但下一轮 imshow
    又会重建窗口，表现为"关不掉"。用 WND_PROP_VISIBLE 检测到不可见即退出。
    """
    try:
        return cv2.getWindowProperty(win_name, cv2.WND_PROP_VISIBLE) < 1
    except cv2.error:
        return True


# ---------------------------------------------------------------------------
# 画面文字绘制（cv2.putText 不支持中文，用 PIL 渲染）
# ---------------------------------------------------------------------------

_FONT_CACHE = {}


def _get_font(px):
    if px not in _FONT_CACHE:
        font = None
        try:
            from PIL import ImageFont
            for p in (r"C:\Windows\Fonts\msyh.ttc", r"C:\Windows\Fonts\simhei.ttf"):
                if os.path.exists(p):
                    font = ImageFont.truetype(p, px)
                    break
        except Exception:
            font = None
        _FONT_CACHE[px] = font
    return _FONT_CACHE[px]


def draw_texts(frame, items):
    """一次性绘制多行文字(支持中文)。

    items: [(text, (x, y), scale, color_bgr), ...]
    """
    import cv2

    try:
        from PIL import Image, ImageDraw
    except ImportError:  # 无 PIL 时退化为 cv2 纯 ASCII
        for text, (x, y), scale, color in items:
            cv2.putText(frame, text, (x, y), cv2.FONT_HERSHEY_SIMPLEX,
                        scale, color, 2, cv2.LINE_AA)
        return

    img = Image.fromarray(cv2.cvtColor(frame, cv2.COLOR_BGR2RGB))
    d = ImageDraw.Draw(img)
    for text, (x, y), scale, color in items:
        font = _get_font(max(16, int(round(scale * 32))))
        if font is None:
            d.text((x, y), text, fill=color[::-1])
        else:
            d.text((x, y), text, font=font, fill=color[::-1])
    frame[:] = cv2.cvtColor(np.asarray(img), cv2.COLOR_RGB2BGR)


# ---------------------------------------------------------------------------
# 摄像头模式
# ---------------------------------------------------------------------------

def _init_camera(cap_index):
    import cv2
    import mediapipe as mp

    mp_pose = mp.solutions.pose
    mp_hands = mp.solutions.hands
    mp_draw = mp.solutions.drawing_utils
    mp_styles = mp.solutions.drawing_styles

    pose = mp_pose.Pose(min_detection_confidence=0.5, min_tracking_confidence=0.5)
    hands = mp_hands.Hands(
        static_image_mode=False,
        max_num_hands=2,
        min_detection_confidence=0.5,
        min_tracking_confidence=0.5,
    )
    cap = cv2.VideoCapture(cap_index)
    if not cap.isOpened():
        print(f"无法打开摄像头 (index={cap_index})")
        raise SystemExit(1)
    return cv2, mp_pose, mp_hands, mp_draw, mp_styles, pose, hands, cap


def _extract_feat(cv2, mp_pose, mp_hands, mp_draw, mp_styles, pose_res, hands_res, frame):
    """提取 20 维融合特征 [身体10 | 左手5 | 右手5]，无姿态返回 None。

    手部缺失的维度填 NaN —— 标准化后为中性值 0，不影响身体部分打分。
    返回 (特征, 手部状态文本)。
    """
    if not pose_res.pose_landmarks:
        return None, "无"
    mp_draw.draw_landmarks(
        frame,
        pose_res.pose_landmarks,
        mp_pose.POSE_CONNECTIONS,
        mp_styles.get_default_pose_landmarks_style(),
    )
    pts = np.array(
        [[lm.x, lm.y, lm.z] for lm in pose_res.pose_landmarks.landmark],
        dtype=np.float64,
    )
    body = pose_feature_vector(pts)

    nan_hand = np.full(HAND_DIM_PER_HAND, np.nan)
    left, right = nan_hand.copy(), nan_hand.copy()
    n_hands = 0
    if hands_res.multi_hand_landmarks:
        for lm, hd in zip(hands_res.multi_hand_landmarks, hands_res.multi_handedness):
            label = hd.classification[0].label
            mp_draw.draw_landmarks(
                frame, lm, mp_hands.HAND_CONNECTIONS,
                mp_styles.get_default_hand_landmarks_style(),
                mp_styles.get_default_hand_connections_style(),
            )
            hpts = np.array(
                [[p.x, p.y, p.z] for p in lm.landmark], dtype=np.float64
            )
            ang = hand_finger_angles(hpts)
            # 镜像画面下 handedness 标签与模板录制时自洽，直接按标签分边
            if label == "Left":
                left = ang
            else:
                right = ang
            n_hands += 1

    hand_status = {0: "无手", 1: "单手", 2: "双手"}.get(n_hands, "无手")
    feat = np.concatenate([body, left, right])
    assert feat.shape == (TOTAL_DIM,)
    return feat, hand_status


def main_record(cap_index, name):
    """录制模式：把一个完整动作示范录成片段存入模板库。"""
    cv2, mp_pose, mp_hands, mp_draw, mp_styles, pose, hands, cap = _init_camera(cap_index)

    recording = []
    is_recording = False
    saved_frames = 0
    print(f"[录制模式] 预设动作: {name}")
    print("按键: r=开始/停止录制(停止时自动保存)  c=作废本次  q/esc=退出")

    prev_tick = cv2.getTickCount()
    while True:
        ok, frame = cap.read()
        if not ok:
            break
        frame = cv2.flip(frame, 1)
        rgb = cv2.cvtColor(frame, cv2.COLOR_BGR2RGB)
        pose_res = pose.process(rgb)
        hands_res = hands.process(rgb)

        feat, hand_status = _extract_feat(
            cv2, mp_pose, mp_hands, mp_draw, mp_styles, pose_res, hands_res, frame
        )
        if is_recording and feat is not None:
            recording.append(feat)

        cur_tick = cv2.getTickCount()
        fps = cv2.getTickFrequency() / max(cur_tick - prev_tick, 1e-9)
        prev_tick = cur_tick

        if is_recording:
            lines = [
                (f"录制 {name}: {len(recording)} 帧, 再按 r 停止并保存", (10, 30), 0.8, (0, 0, 255)),
                (f"[{hand_status}] fps={fps:.1f}", (10, 62), 0.6, (255, 255, 0)),
            ]
        elif saved_frames:
            lines = [
                (f"已保存 {name} ({saved_frames} 帧), 按 r 再录一段", (10, 30), 0.8, (0, 200, 0)),
                (f"[{hand_status}] fps={fps:.1f}", (10, 62), 0.6, (255, 255, 0)),
            ]
        else:
            lines = [
                (f"预设动作 {name}: 按 r 开始录制", (10, 30), 0.8, (255, 255, 0)),
                (f"[{hand_status}] fps={fps:.1f}", (10, 62), 0.6, (255, 255, 0)),
            ]
        draw_texts(frame, lines)

        cv2.imshow("Template Recording", frame)
        key = cv2.waitKey(1) & 0xFF
        if key in (ord("q"), 27) or _window_closed(cv2, "Template Recording"):
            break
        if key == ord("r"):
            if not is_recording:
                is_recording = True
                recording = []
                print("开始录制...")
            else:
                is_recording = False
                if len(recording) < MIN_SEGMENT_LEN:
                    print(f"录制太短({len(recording)}帧)，已作废，请重录")
                    recording = []
                else:
                    raw = np.stack(recording)
                    path = save_segment(name, raw, TEMPLATE_DIR)
                    saved_frames = raw.shape[0]
                    recording = []
                    print(f"已保存片段: {path} ({saved_frames} 帧)")
        if key == ord("c"):
            is_recording = False
            recording = []
            print("已作废本次录制")

    cap.release()
    cv2.destroyAllWindows()


def main_recognize(cap_index=0):
    """识别模式：加载模板库全部动作，实时滑窗 DTW 匹配。"""
    cv2, mp_pose, mp_hands, mp_draw, mp_styles, pose, hands, cap = _init_camera(cap_index)

    templates = load_templates(TEMPLATE_DIR)
    if not templates:
        print(f"模板库为空 ({TEMPLATE_DIR})")
        print("请先运行: python realtime_pose_match.py --record <动作名>")
        print("  或:   python video_to_template.py --action <动作名> <视频...>")
    else:
        print(f"已加载 {len(templates)} 个动作:")
        for t in templates:
            print(f"  - {t['name']} ({t['T']} 帧, {len(t['templates_s'])} 模板)")
    print("识别模式: 按键 q/esc=退出")

    max_T = max((t["T"] for t in templates), default=0)
    buffer = deque(maxlen=int(max_T * 1.5) + 5)  # 存原始特征，逐模板用各自统计量标准化
    results = []   # 最近一轮识别: [(name, score), ...]
    best = ("", 0.0)
    frame_idx = 0
    prev_tick = cv2.getTickCount()

    while True:
        ok, frame = cap.read()
        if not ok:
            break
        frame = cv2.flip(frame, 1)
        rgb = cv2.cvtColor(frame, cv2.COLOR_BGR2RGB)
        pose_res = pose.process(rgb)
        hands_res = hands.process(rgb)

        feat, hand_status = _extract_feat(
            cv2, mp_pose, mp_hands, mp_draw, mp_styles, pose_res, hands_res, frame
        )
        if feat is not None:
            buffer.append(feat)
        elif buffer:
            buffer.clear()  # 丢失追踪则清空，避免拼接不连续动作

        # 全库识别(每 RECOGNIZE_INTERVAL 帧一轮，且缓冲至少覆盖最长模板)
        if (templates and feat is not None and len(buffer) >= max_T
                and frame_idx % RECOGNIZE_INTERVAL == 0):
            buf = np.stack(list(buffer))
            results = []
            for t in templates:
                sc_best = 0.0
                d_best = math.inf
                for ts, mean, std in zip(t["templates_s"], t["means"], t["stds"]):
                    buf_s, _, _ = standardize(buf, mean, std)
                    d, sc = best_match(buf_s, ts)
                    if d is not None and d < d_best:
                        d_best, sc_best = d, sc
                results.append((t["name"], sc_best))
            best = max(results, key=lambda r: r[1])
        frame_idx += 1

        cur_tick = cv2.getTickCount()
        fps = cv2.getTickFrequency() / max(cur_tick - prev_tick, 1e-9)
        prev_tick = cur_tick

        # 顶部状态
        if not templates:
            lines = [
                ("无模板: 请先 --record 或 video_to_template.py 导入", (10, 30), 0.8, (0, 0, 255)),
                (f"[{hand_status}] fps={fps:.1f}", (10, 62), 0.6, (255, 255, 0)),
            ]
        elif not results:
            lines = [
                (f"采集中 {len(buffer)}/{max_T} 帧...", (10, 30), 0.8, (255, 255, 0)),
                (f"[{hand_status}] fps={fps:.1f}", (10, 62), 0.6, (255, 255, 0)),
            ]
        else:
            name, sc = best
            if sc >= RECOGNIZE_THRESHOLD:
                lines = [
                    (f"识别为: {name}  {sc:.0f} 分", (10, 30), 0.9, (0, 255, 0)),
                    (f"[{hand_status}] fps={fps:.1f}", (10, 64), 0.6, (255, 255, 0)),
                ]
            else:
                lines = [
                    (f"未识别出动作 (最高 {name} {sc:.0f})", (10, 30), 0.9, (0, 0, 255)),
                    (f"[{hand_status}] fps={fps:.1f}", (10, 64), 0.6, (255, 255, 0)),
                ]
            lines.append((" | ".join(f"{n}:{s:.0f}" for n, s in results),
                          (10, 92), 0.55, (255, 255, 0)))
        draw_texts(frame, lines)

        # 底部最高分进度条
        h, w = frame.shape[:2]
        bar_x0, bar_x1, bar_y, bar_h = 20, w - 20, h - 44, 18
        cv2.rectangle(frame, (bar_x0, bar_y), (bar_x1, bar_y + bar_h), (60, 60, 60), -1)
        if best[1] > 0:
            sc = max(0.0, min(best[1], 100.0))
            fill_w = int((bar_x1 - bar_x0) * sc / 100.0)
            cv2.rectangle(frame, (bar_x0, bar_y), (bar_x0 + fill_w, bar_y + bar_h),
                          _score_color(best[1]), -1)

        cv2.imshow("Realtime Action Recognition (DTW)", frame)
        key = cv2.waitKey(1) & 0xFF
        if key in (ord("q"), 27) or _window_closed(cv2, "Realtime Action Recognition (DTW)"):
            break

    cap.release()
    cv2.destroyAllWindows()


# ---------------------------------------------------------------------------
# mock 自测
# ---------------------------------------------------------------------------

def demo_mock():
    """合成数据自测：单模板回归 + 多模板库识别。"""
    import shutil
    import tempfile

    from template_store import load_segments

    template_raw = _make_cloud_hand(60)
    template_s, mean, std = standardize(template_raw)

    # 模拟实时流: Neutral(40) + 变速动作(75) + Neutral(40)
    # 噪声取原始角度 3 度抖动，接近真实 MediaPipe 关节角测量噪声
    neutral = np.full((40, template_raw.shape[1]), 170.0)
    neutral[:, 6:10] = 0.0  # 腿部角静止
    neutral_s, _, _ = standardize(neutral, mean, std)

    learner = _warp(template_raw, target_len=75, noise=0.0)
    learner = learner + np.random.default_rng(2).normal(0.0, 3.0, learner.shape)
    learner_s, _, _ = standardize(learner, mean, std)

    stream = np.concatenate([neutral_s, learner_s, neutral_s], axis=0)
    true_action = (neutral_s.shape[0], neutral_s.shape[0] + learner_s.shape[0])

    buffer = deque(maxlen=int(template_s.shape[0] * 1.5) + 5)
    peak = (math.inf, None)
    print("=" * 60)
    print("实时滑窗比对自测 (mock)")
    print(f"真实动作区间帧 = {true_action}")
    print("=" * 60)
    for i in range(stream.shape[0]):
        buffer.append(stream[i])
        if len(buffer) >= template_s.shape[0]:
            d, sc = best_match(np.stack(list(buffer)), template_s)
            if d is not None and d < peak[0]:
                peak = (d, i)
            if i % 10 == 0:
                print(f"  frame {i:3d}  DTW={d:.3f}  score={sc:.0f}")
    print("-" * 60)
    print(f"峰值: frame={peak[1]}  DTW={peak[0]:.3f}  score={score(peak[0]):.0f}")
    inside = true_action[0] <= peak[1] <= true_action[1]
    print(f"峰值落在真实动作区间内: {'OK' if inside else '偏差'}")

    # 对照组: 拿一段「错误动作」来比，分数应明显更低
    wrong = _warp(template_raw, target_len=70, noise=0.0)
    wrong[:, 0:2] = wrong[:, 0:2] + 60.0    # 手臂角度整体偏移 -> 错误姿态
    wrong[:, 10:] = wrong[:, 10:] - 45.0    # 手指弯曲(如兰花指没做出来)
    wrong_s, _, _ = standardize(wrong, mean, std)
    d_wrong, sc_wrong = best_match(wrong_s, template_s)
    print(f"错误动作 vs 模板: DTW={d_wrong:.3f}  score={sc_wrong:.0f} (应远低于峰值 score)")

    # 手部缺失容错: 学员手出画面(手部维度 NaN)，身体部分仍应得到可观分数
    no_hand = learner.copy()
    no_hand[:, 10:] = np.nan
    no_hand_s, _, _ = standardize(no_hand, mean, std)
    d_nh, sc_nh = best_match(no_hand_s, template_s)
    print(f"手出画面 vs 模板: DTW={d_nh:.3f}  score={sc_nh:.0f} (应明显低于峰值但可接受)")

    # ---- 多模板库识别自测: 与实时识别相同的代码路径 ----
    print()
    print("=" * 60)
    print("多模板库识别自测 (mock)")
    tmp_dir = tempfile.mkdtemp()
    try:
        # 动作1: 云手(手臂一个弯伸周期, 手指慢切)
        # 动作2: 快圆(手臂两个弯伸周期, 手指快张合)
        t = np.linspace(0.0, 1.0, 60, endpoint=False)
        cols = []
        for i in range(6):
            phase = i * math.pi / 3.0
            bend = 0.5 - 0.5 * np.cos(4.0 * math.pi * t + phase)
            cols.append(170.0 - 110.0 * bend)
        for i in range(4):
            cols.append(10.0 * np.sin(4.0 * math.pi * t + i * math.pi / 2.0))
        for i in range(10):
            phase = i * math.pi / 5.0
            curl = 0.5 - 0.5 * np.cos(4.0 * math.pi * t + phase)
            cols.append(170.0 - 60.0 * curl)
        quick_raw = np.stack(cols, axis=1)

        # 每类 4 段模板片段(变速+噪声)
        rng = np.random.default_rng(7)
        for rep in range(4):
            for name, src in (("云手", template_raw), ("快圆", quick_raw)):
                L = int(rng.integers(50, 90))
                seg = _warp(src, L) + rng.normal(0.0, 3.0, (L, src.shape[1]))
                save_segment(name, seg, tmp_dir)

        segments = load_segments(tmp_dir)
        print(f"模板库: {[n for n, _ in segments]}")

        # 加载模板(与 main_recognize 相同) -> 识别新的带噪声测试片段
        templates = load_templates(tmp_dir)
        correct = 0
        trials = []
        for rep in range(3):
            for name, src in (("云手", template_raw), ("快圆", quick_raw)):
                L = int(rng.integers(55, 85))
                test = _warp(src, L) + rng.normal(0.0, 4.0, (L, src.shape[1]))
                scores = {}
                for tpl in templates:
                    sc_best = 0.0
                    d_best = math.inf
                    for ts, mean, std in zip(tpl["templates_s"], tpl["means"], tpl["stds"]):
                        test_s, _, _ = standardize(test, mean, std)
                        d, sc = best_match(test_s, ts)
                        if d is not None and d < d_best:
                            d_best, sc_best = d, sc
                    scores[tpl["name"]] = sc_best
                pred = max(scores, key=scores.get)
                ok = pred == name
                correct += ok
                trials.append((name, pred, scores[pred], ok))
        for name, pred, sc, ok in trials:
            mark = "OK" if ok else "!!"
            print(f"  [{mark}] 真实={name}  识别={pred}  分数={sc:.0f}")
        print(f"多模板识别正确率: {correct}/{len(trials)} = {correct / len(trials):.0%}")
    finally:
        shutil.rmtree(tmp_dir, ignore_errors=True)


if __name__ == "__main__":
    p = argparse.ArgumentParser()
    p.add_argument("--mock", action="store_true", help="合成数据自测，不启动摄像头")
    p.add_argument("--record", metavar="NAME", help="录制模式：录制预设动作 NAME 存入模板库")
    p.add_argument("--cam", type=int, default=0, help="摄像头索引")
    args = p.parse_args()
    if args.mock:
        demo_mock()
    elif args.record:
        name = args.record.strip()
        if not name:
            raise SystemExit("--record 需要一个非空的动作名")
        main_record(args.cam, name)
    else:
        main_recognize(args.cam)
