"""模板库存储：多段模板 + 自动平均模板 + 读取。

目录结构:
  templates/
    云手/
      meta.json     # {"name", "num_segments", "avg_len"}
      avg.npz       # 平均模板(全部片段时间对齐后的逐帧均值)
      seg_001.npz   # 原始片段(20 维融合角度特征, 度)
      seg_002.npz
"""

import json
import os
import re

import numpy as np

from dtw_pose_match import standardize, _warp

MAX_TEMPLATE_LEN = 96   # 模板帧数上限(超过则重采样)，约束实时识别计算量
MIN_SEGMENT_LEN = 15    # 片段最少帧数


def _seg_pattern():
    return re.compile(r"seg_\d{3}\.npz$")


def segment_paths(action_dir):
    """动作目录下全部片段文件路径(升序)。"""
    if not os.path.isdir(action_dir):
        return []
    return sorted(
        os.path.join(action_dir, f) for f in os.listdir(action_dir)
        if _seg_pattern().match(f)
    )


def save_segment(name, raw, root):
    """保存一个片段并重建平均模板，返回片段路径。"""
    action_dir = os.path.join(root, name)
    os.makedirs(action_dir, exist_ok=True)
    idx = 1
    while os.path.exists(os.path.join(action_dir, f"seg_{idx:03d}.npz")):
        idx += 1
    path = os.path.join(action_dir, f"seg_{idx:03d}.npz")
    raw = np.asarray(raw, dtype=np.float64)
    np.savez(path, raw=raw, name=np.asarray(name))
    _rebuild_avg(name, root)
    return path


def delete_action(name, root):
    """删除整个动作目录。"""
    import shutil

    action_dir = os.path.join(root, name)
    if os.path.isdir(action_dir):
        shutil.rmtree(action_dir)
        return True
    return False


def _rebuild_avg(name, root):
    """用全部片段重建平均模板 avg.npz 与 meta.json。

    手部维度可能 NaN(检测失败帧)，用 nanmean；某维全程缺失回退 170 度(伸直)。
    """
    action_dir = os.path.join(root, name)
    paths = segment_paths(action_dir)
    if not paths:
        return
    segs = [np.asarray(np.load(p)["raw"], dtype=np.float64) for p in paths]
    target = min(int(np.median([len(s) for s in segs])), MAX_TEMPLATE_LEN)
    stacked = np.stack([_warp(s, target) for s in segs])
    with np.errstate(invalid="ignore"):
        avg = np.nanmean(stacked, axis=0)
    avg = np.nan_to_num(avg, nan=170.0)
    np.savez(os.path.join(action_dir, "avg.npz"), raw=avg, name=np.asarray(name))
    with open(os.path.join(action_dir, "meta.json"), "w", encoding="utf-8") as f:
        json.dump(
            {"name": name, "num_segments": len(segs), "avg_len": target},
            f, ensure_ascii=False, indent=2,
        )


def load_templates(root, max_per_action=2):
    """加载模板库供实时识别。

    每动作取至多 max_per_action 个模板(平均模板优先)，约束每轮识别耗时。
    返回 [{"name", "templates_s": [...], "means": [...], "stds": [...], "T"}]
    """
    out = []
    if not os.path.isdir(root):
        return out
    for name in sorted(os.listdir(root)):
        action_dir = os.path.join(root, name)
        if not os.path.isdir(action_dir):
            continue
        files = [os.path.join(action_dir, "avg.npz")] + segment_paths(action_dir)
        temps = []
        for p in files:
            if not os.path.exists(p):
                continue
            raw = np.asarray(np.load(p, allow_pickle=False)["raw"], dtype=np.float64)
            if raw.ndim != 2 or raw.shape[0] < MIN_SEGMENT_LEN:
                continue
            ts, mean, std = standardize(raw)
            temps.append((ts, mean, std, raw.shape[0]))
            if len(temps) >= max_per_action:
                break
        if temps:
            out.append({
                "name": name,
                "templates_s": [t[0] for t in temps],
                "means": [t[1] for t in temps],
                "stds": [t[2] for t in temps],
                "T": max(t[3] for t in temps),
            })
    return out


def load_segments(root):
    """加载全部原始片段: [(动作名, raw (N,20)), ...]。"""
    out = []
    if not os.path.isdir(root):
        return out
    for name in sorted(os.listdir(root)):
        for p in segment_paths(os.path.join(root, name)):
            raw = np.asarray(np.load(p, allow_pickle=False)["raw"], dtype=np.float64)
            if raw.ndim == 2 and raw.shape[0] >= MIN_SEGMENT_LEN:
                out.append((name, raw))
    return out
