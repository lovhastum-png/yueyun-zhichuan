"""视频批量导入模板库：从动作示范视频提取特征片段。

用法:
  python video_to_template.py --action 云手 v1.mp4 v2.mp4 v3.mp4
      # 每个视频整体作为该动作的一个片段(适合一段一个动作的短视频)
  python video_to_template.py --segment 长视频.mp4
      # 交互式切分: 播放视频, 按 i 标动作开始, 按 o 标结束并在控制台输入动作名
      # 适合一段视频里连续多个动作的长视频

网络视频注意:
  - MediaPipe 只追踪置信度最高的一人，多人群像会跟丢主目标，优先单人画面
  - 水印/字幕一般不影响关键点检测
"""

import argparse
import os

import cv2
import mediapipe as mp
import numpy as np

from dtw_pose_match import (
    pose_feature_vector,
    hand_finger_angles,
    HAND_DIM_PER_HAND,
)
from template_store import save_segment, MIN_SEGMENT_LEN

TEMPLATE_DIR = os.path.join(os.path.dirname(os.path.abspath(__file__)), "templates")


def _make_models():
    """Pose + Hands 双模型(与摄像头录制管线一致，特征同为 20 维融合)。"""
    pose = mp.solutions.pose.Pose(
        min_detection_confidence=0.5, min_tracking_confidence=0.5
    )
    hands = mp.solutions.hands.Hands(
        static_image_mode=False,
        max_num_hands=2,
        min_detection_confidence=0.5,
        min_tracking_confidence=0.5,
    )
    return pose, hands


def _frame_features(pose_res, hands_res):
    """一帧 -> 20 维融合特征 [身体10 | 左手5 | 右手5]，手缺失填 NaN。"""
    if not pose_res.pose_landmarks:
        return None
    pts = np.array(
        [[lm.x, lm.y, lm.z] for lm in pose_res.pose_landmarks.landmark],
        dtype=np.float64,
    )
    body = pose_feature_vector(pts)
    left = np.full(HAND_DIM_PER_HAND, np.nan)
    right = np.full(HAND_DIM_PER_HAND, np.nan)
    if hands_res.multi_hand_landmarks:
        for lm, hd in zip(hands_res.multi_hand_landmarks, hands_res.multi_handedness):
            hpts = np.array(
                [[p.x, p.y, p.z] for p in lm.landmark], dtype=np.float64
            )
            ang = hand_finger_angles(hpts)
            if hd.classification[0].label == "Left":
                left = ang
            else:
                right = ang
    return np.concatenate([body, left, right])


def extract_video_features(video_path):
    """逐帧提取 20 维融合特征。返回 (总帧数, 特征列表)。

    检测不到人的帧直接跳过(DTW 对时间伸缩鲁棒，少量丢帧可接受)。
    """
    cap = cv2.VideoCapture(video_path)
    if not cap.isOpened():
        raise SystemExit(f"无法打开视频: {video_path}")
    pose, hands = _make_models()
    feats = []
    total = 0
    while True:
        ok, frame = cap.read()
        if not ok:
            break
        total += 1
        rgb = cv2.cvtColor(frame, cv2.COLOR_BGR2RGB)
        feat = _frame_features(pose.process(rgb), hands.process(rgb))
        if feat is not None:
            feats.append(feat)
    cap.release()
    pose.close()
    hands.close()
    return total, feats


def import_whole_videos(name, video_paths, template_dir):
    """每个视频整体作为一个片段导入该动作。"""
    for vp in video_paths:
        total, feats = extract_video_features(vp)
        if len(feats) < MIN_SEGMENT_LEN:
            print(f"  跳过 {os.path.basename(vp)}: 仅 {len(feats)}/{total} 帧检测到人体")
            continue
        path = save_segment(name, np.stack(feats), template_dir)
        print(f"  已导入 {os.path.basename(vp)}: {len(feats)}/{total} 帧 -> {path}")
    print(f"动作「{name}」导入完成")


def _window_closed(win_name):
    """用户是否点了窗口右上角 X(waitKey 收不到该事件，用可见性检测)。"""
    try:
        return cv2.getWindowProperty(win_name, cv2.WND_PROP_VISIBLE) < 1
    except cv2.error:
        return True


def segment_interactive(video_path, template_dir):
    """交互式切分长视频：i=开始标记 o=结束并命名 空格=暂停 q=退出。"""
    cap = cv2.VideoCapture(video_path)
    if not cap.isOpened():
        raise SystemExit(f"无法打开视频: {video_path}")
    fps = cap.get(cv2.CAP_PROP_FPS) or 25.0
    pose, hands = _make_models()

    seg = []
    marking = False
    paused = False
    frame = None
    res = None
    saved = 0

    print("交互式切分: 空格=暂停/继续  i=标记动作开始  o=结束并保存  q=退出")

    def draw_hud(img):
        lines = [
            f"{'>> 标记中 ' + str(len(seg)) + ' 帧' if marking else '未标记'}",
            f"saved={saved}  {'[暂停]' if paused else ''}",
        ]
        for i, t in enumerate(lines):
            cv2.putText(img, t, (10, 30 + 28 * i), cv2.FONT_HERSHEY_SIMPLEX,
                        0.7, (0, 255, 255) if marking else (255, 255, 0), 2, cv2.LINE_AA)

    while True:
        if not paused:
            ok, frame = cap.read()
            if not ok:
                break
            rgb = cv2.cvtColor(frame, cv2.COLOR_BGR2RGB)
            pose_res = pose.process(rgb)
            hands_res = hands.process(rgb)
            if pose_res.pose_landmarks:
                mp.solutions.drawing_utils.draw_landmarks(
                    frame, pose_res.pose_landmarks,
                    mp.solutions.pose.POSE_CONNECTIONS,
                )
                if hands_res.multi_hand_landmarks:
                    for lm in hands_res.multi_hand_landmarks:
                        mp.solutions.drawing_utils.draw_landmarks(
                            frame, lm, mp.solutions.hands.HAND_CONNECTIONS,
                        )
                if marking:
                    feat = _frame_features(pose_res, hands_res)
                    if feat is not None:
                        seg.append(feat)
        if frame is not None:
            disp = frame.copy()
            draw_hud(disp)
            cv2.imshow("Segment Video (i/o/space/q)", disp)

        key = cv2.waitKey(30 if paused else max(1, int(1000 / fps)) - 20) & 0xFF
        if key in (ord("q"), 27) or _window_closed("Segment Video (i/o/space/q)"):
            break
        if key == ord(" "):
            paused = not paused
        if key == ord("i"):
            marking = True
            seg = []
            print("开始标记...")
        if key == ord("o"):
            marking = False
            if len(seg) < MIN_SEGMENT_LEN:
                print(f"片段太短({len(seg)}帧)，丢弃")
            else:
                cv2.destroyAllWindows()
                name = input("动作名(直接回车丢弃本段): ").strip()
                if name:
                    path = save_segment(name, np.stack(seg), template_dir)
                    saved += 1
                    print(f"已保存 {len(seg)} 帧 -> {path}")
                else:
                    print("已丢弃")
            seg = []

    cap.release()
    cv2.destroyAllWindows()
    print(f"切分结束，共保存 {saved} 段")


if __name__ == "__main__":
    p = argparse.ArgumentParser(description="视频导入模板库")
    p.add_argument("--action", metavar="NAME", help="动作名(整视频导入模式)")
    p.add_argument("--segment", action="store_true", help="交互式切分长视频")
    p.add_argument("--templates", default=TEMPLATE_DIR, help="模板库目录")
    p.add_argument("videos", nargs="+", help="视频文件路径")
    args = p.parse_args()

    if args.segment:
        segment_interactive(args.videos[0], args.templates)
    elif args.action:
        name = args.action.strip()
        if not name:
            raise SystemExit("--action 需要一个非空的动作名")
        import_whole_videos(name, args.videos, args.templates)
    else:
        raise SystemExit("需要 --action NAME 或 --segment 之一")
