"""v2 身段模板库（多段录制 + 自动平均模板）。

从 `scripts/动作识别/template_store.py` 迁移适配：
- 存储目录改为本服务目录下的 `templates_v2/`（与 v1 的 templates/ 互不干扰）；
- 段文件名由用户输入的模板名派生（不再强制英文目录名），网关层已做名称清洗；
- 每个动作一个子目录：`seg_XXX.npz`（原始 20 维角度序列）+ `meta.json`。

设计要点（与脚本版一致）：
- MAX_TEMPLATE_LEN：单段模板裁剪上限。模板是 DTW 比对的时间尺度锚点，
  过长的模板会让「做一半」也拿到高分；
- 自动平均模板：每段先时间轴重采样到该动作多段的平均长度再逐维取均值，
  得到一条去噪的「合成标准示范」，与最优分段模板一起参与匹配；
- nanmean 语义：手部出画面的帧不参与均值统计。
"""
from __future__ import annotations

import json
import re
from pathlib import Path

import numpy as np

from joint_angle import TOTAL_DIM, _warp

# 单段模板最长保留 96 帧（约 6 秒 @16fps，自录/导入均适用）
MAX_TEMPLATE_LEN = 96
# 单段最短有效长度（低于视为无效录制/无效导入）
MIN_SEGMENT_LEN = 15
# 每个动作最多保留的模板段数（超过时删除最旧的）
MAX_SEGMENTS = 4
# 参与匹配时每动作最多使用的分段模板数（含平均模板在内）
MAX_TEMPLATES_PER_ACTION = 2


def _safe_dirname(name: str) -> str:
    """模板名 -> 目录名：仅保留安全字符，长度限制 40。"""
    cleaned = re.sub(r'[\\/:*?"<>|\s]+', '_', str(name)).strip('_')
    return cleaned[:40] or '未命名身段'


# 参考骨架关节数（鼻+双肩肘腕髋膝，与前端 DEMO_JOINT_INDICES 对应）
DEMO_JOINT_COUNT = 11


def _warp_demo(d: np.ndarray, target_len: int) -> np.ndarray:
    """(n, 11, 2) 骨架序列时间轴线性重采样。"""
    n = d.shape[0]
    if int(target_len) == n:
        return d.copy()
    src = np.linspace(0.0, n - 1.0, int(target_len))
    i0 = np.floor(src).astype(int)
    i1 = np.minimum(i0 + 1, n - 1)
    frac = (src - i0)[:, None, None]
    return d[i0] * (1.0 - frac) + d[i1] * frac


def segment_paths(action_dir: Path):
    return sorted(action_dir.glob('seg_*.npz'))


def _rebuild_avg(action_dir: Path, owner: str | None = None):
    """根据全部段文件重建 meta.json 中的平均模板。

    owner 仅在 meta 尚无记录时写入（创建者身份不随加段改变）。
    """
    seg_paths = segment_paths(action_dir)
    segs = [np.load(p)['features'] for p in seg_paths]
    if not segs:
        return None
    avg_len = int(round(float(np.mean([len(s) for s in segs]))))
    avg_len = max(MIN_SEGMENT_LEN, min(avg_len, MAX_TEMPLATE_LEN))
    aligned = [_warp(s, avg_len) for s in segs]
    with np.errstate(invalid='ignore'):
        avg = np.nanmean(np.stack(aligned, axis=0), axis=0)
    # 平均参考骨架：各段 demo 重采样到 avg_len 后取均值（段无 demo 时跳过）
    demos = []
    for p in seg_paths:
        try:
            d = np.load(p)['demo']
        except (KeyError, OSError, ValueError):
            continue
        if d.ndim == 3 and d.shape[1] == DEMO_JOINT_COUNT and d.shape[2] == 2:
            demos.append(_warp_demo(d, avg_len))
    meta_path = action_dir / 'meta.json'
    meta = {}
    if meta_path.exists():
        try:
            meta = json.loads(meta_path.read_text(encoding='utf-8'))
        except (json.JSONDecodeError, OSError):
            meta = {}
    meta['name'] = meta.get('name') or action_dir.name
    meta['avg_len'] = avg_len
    if owner and not meta.get('owner'):
        meta['owner'] = owner
    if demos:
        with np.errstate(invalid='ignore'):
            avg_demo = np.nanmean(np.stack(demos, axis=0), axis=0)
        np.savez_compressed(action_dir / 'avg.npz', features=avg, demo=avg_demo)
    else:
        np.savez_compressed(action_dir / 'avg.npz', features=avg)
    meta_path.write_text(json.dumps(meta, ensure_ascii=False, indent=2), encoding='utf-8')
    return avg


def save_segment(name: str, raw: np.ndarray, root: Path, owner: str = '',
                 demo: list | np.ndarray | None = None):
    """保存一段录制/导入的原始特征，并重建平均模板。

    返回 (动作目录名, 段数)。新段名使用毫秒时间戳保证递增有序。
    owner（创建者用户名）仅在该动作首次创建时写入 meta.json，后续加段不覆盖。
    demo：与 raw 等长的 (n, 11, 2) 骨架归一化坐标（参考身段动画数据，可选）。
    """
    raw = np.asarray(raw, dtype=np.float64)
    if raw.ndim != 2 or raw.shape[1] != TOTAL_DIM:
        raise ValueError(f'特征序列必须是 (n, {TOTAL_DIM})')
    if len(raw) < MIN_SEGMENT_LEN:
        raise ValueError(f'有效帧数不足（至少 {MIN_SEGMENT_LEN} 帧）')

    # 可选骨架数据：形状校验失败时静默丢弃（不阻断模板保存）
    demo_arr = None
    if demo is not None:
        try:
            d = np.asarray(demo, dtype=np.float64)
        except (TypeError, ValueError):
            d = None
        if d is not None and d.ndim == 3 and d.shape[0] == len(raw) \
                and d.shape[1] == DEMO_JOINT_COUNT and d.shape[2] == 2:
            demo_arr = d

    dirname = _safe_dirname(name)
    action_dir = root / dirname
    action_dir.mkdir(parents=True, exist_ok=True)

    if len(raw) > MAX_TEMPLATE_LEN:
        raw = raw[-MAX_TEMPLATE_LEN:]
        if demo_arr is not None:
            demo_arr = demo_arr[-MAX_TEMPLATE_LEN:]

    import time
    seg_path = action_dir / f'seg_{int(time.time() * 1000):013d}.npz'
    if demo_arr is not None:
        np.savez_compressed(seg_path, features=raw, demo=demo_arr)
    else:
        np.savez_compressed(seg_path, features=raw)
    # 超出保留上限时删除最旧的段
    segs = segment_paths(action_dir)
    while len(segs) > MAX_SEGMENTS:
        segs[0].unlink()
        segs.pop(0)
    _rebuild_avg(action_dir, owner=str(owner or '').strip()[:40] or None)
    return dirname, len(segs)


def delete_action(action_id: str, root: Path):
    """删除一个动作目录（内置模板由调用方拦截，不走这里）。"""
    dirname = _safe_dirname(action_id)
    action_dir = root / dirname
    if not action_dir.is_dir():
        return False
    import shutil
    shutil.rmtree(action_dir, ignore_errors=True)
    return True


def load_templates(root: Path, max_per_action: int = MAX_TEMPLATES_PER_ACTION):
    """加载全部 v2 模板。

    返回 {action_id: {name, frames, templates: [标准化后的模板序列...],
                      mean, std, d0}}。
    - 每动作：平均模板(若有) + 最新的 1~2 段分段模板，共不超过 max_per_action；
    - 长度裁剪：段/平均模板统一重采样到 [MIN_SEGMENT_LEN, MAX_TEMPLATE_LEN]；
    - NaN 语义：录制时手部出画面的维保持 NaN，标准化时置 0（中性）——
      与学员尝试帧的缺失语义一致，缺失不奖不罚。不做插值回填：对 99%
      缺失的维插值会制造假信号，反而在打分时被当成真实手指动作。
    - d0：模板「原样重做」的底噪距离（joint_angle.noise_floor），打分扣除。
    """
    actions = {}
    if not root.is_dir():
        return actions
    for action_dir in sorted(p for p in root.iterdir() if p.is_dir()):
        segs = segment_paths(action_dir)
        if not segs:
            continue
        meta = {}
        try:
            meta = json.loads((action_dir / 'meta.json').read_text(encoding='utf-8'))
        except (OSError, json.JSONDecodeError):
            pass
        name = str(meta.get('name') or action_dir.name)

        from joint_angle import noise_floor, standardize
        raw_templates = []
        # 平均模板优先，其次最新分段
        avg_path = action_dir / 'avg.npz'
        if avg_path.exists():
            segs = [avg_path] + segs[-(max_per_action - 1):]
        else:
            segs = segs[-max_per_action:]
        for p in segs:
            try:
                seg = np.load(p)['features'].astype(np.float64)
            except (OSError, ValueError, KeyError):
                continue
            if seg.ndim != 2 or seg.shape[1] != TOTAL_DIM or len(seg) < MIN_SEGMENT_LEN:
                continue
            if len(seg) > MAX_TEMPLATE_LEN:
                seg = _warp(seg, MAX_TEMPLATE_LEN)
            raw_templates.append(seg)

        if not raw_templates:
            continue
        T = max(t.shape[0] for t in raw_templates)
        # 统计量以平均模板（或最新段）为基准。此前每一段都按各自的
        # mean/std 标准化，而实时输入却只按第一段的 mean/std 标准化；
        # 同一动作的不同录制段落在不同坐标系中比较，会直接造成识别和
        # 分数漂移。现在全部模板与实时输入共用同一把标尺。
        ref = np.load(segs[0])['features'].astype(np.float64)
        if len(ref) > MAX_TEMPLATE_LEN:
            ref = _warp(ref, MAX_TEMPLATE_LEN)
        _, mean, std = standardize(ref)
        templates = [standardize(seg, mean=mean, std=std)[0] for seg in raw_templates]
        d0 = noise_floor(ref, mean, std, templates[0])
        # 参考骨架（平均模板优先，缺失时回退最新分段；都没有则无）
        demo_raw = None
        for p in segs:
            try:
                d = np.load(p)['demo']
            except (KeyError, OSError, ValueError):
                continue
            if d.ndim == 3 and d.shape[1] == DEMO_JOINT_COUNT and d.shape[2] == 2:
                demo_raw = d
                break
        actions[action_dir.name] = {
            'name': name,
            'frames': T,
            'segments': len(segment_paths(action_dir)),
            'owner': str(meta.get('owner') or ''),
            'templates': templates,
            'mean': mean,
            'std': std,
            'd0': d0,
            # 原始角度序列（参考段）：供服务端生成「参考身段小人」关键帧
            'raw_seq': ref,
            # 录制/导入时保存的真实骨架坐标（MediaPipe 归一化）：参考身段动画优先数据源
            'demo_raw': demo_raw,
        }
    return actions
