"""
越剧剧本比对 · 差异标签与备注模块
=====================================================================
【标签体系】（每条差异可命中多个标签，全部为「参考」性质）
  情节改动 —— 整场新增 / 删除，或念白类段落的增删改；
  唱词修改 —— 唱段类段落内的句子增删改；
  人物增减 —— 两版本角色集合的差集（或场内出现新增 / 消失角色）；
  结局调整 —— 末场（任一版本的最后一个场次）中存在差异。

【措辞约束】不使用「错误 / 正确 / 很差」等绝对化评判，
一律采用客观描述 +「参考差异」标注。
=====================================================================
"""
from __future__ import annotations

TAG_PLOT = '情节改动'
TAG_LYRIC = '唱词修改'
TAG_ROLE = '人物增减'
TAG_ENDING = '结局调整'


def sentence_tags(status: str, seg_type: str) -> list:
    """句子级标签：唱段差异 → 唱词修改；念白差异 → 情节改动。"""
    if status == 'unchanged':
        return []
    return [TAG_LYRIC if seg_type == '唱段' else TAG_PLOT]


def sentence_note(status: str, similarity) -> str:
    """句子级备注（客观描述，无绝对化措辞）"""
    if status == 'modified':
        return f'该句在两个版本中表述不同（参考相似度 {similarity:.0f}%），属参考差异'
    if status == 'removed':
        return '该句仅见于旧版本，新版本中未出现（参考差异）'
    if status == 'added':
        return '该句为新版本新增内容（参考差异）'
    return ''


def scene_tags(scene_rec: dict, is_last: bool, title_changed: bool,
               has_role_change: bool) -> list:
    """场次级标签：汇聚场内差异性质 + 结构性变化。"""
    tags: set = set()
    if scene_rec['status'] != 'matched':
        tags.add(TAG_PLOT)  # 整场新增 / 删除
    else:
        # 场内任意句子级差异的标签上浮
        for seg in scene_rec['segments']:
            for row in seg['sentences']:
                tags.update(row.get('tags', []))
        if title_changed:
            tags.add(TAG_PLOT)
    if has_role_change:
        tags.add(TAG_ROLE)

    # 结局调整：末场存在任意差异
    has_diff = scene_rec['status'] != 'matched' or any(
        row['status'] != 'unchanged'
        for seg in scene_rec['segments'] for row in seg['sentences']
    )
    if is_last and has_diff:
        tags.add(TAG_ENDING)

    order = [TAG_PLOT, TAG_LYRIC, TAG_ROLE, TAG_ENDING]
    return [t for t in order if t in tags]


def scene_note(scene_rec: dict, old_ver: str, new_ver: str) -> str:
    """场次级备注"""
    status = scene_rec['status']
    if status == 'old_only':
        return f'本场次仅见于{old_ver or "旧版本"}，新版本未收录（参考差异）'
    if status == 'new_only':
        return f'本场次为新版本新增（参考差异）'
    if scene_rec.get('old_title') and scene_rec.get('new_title') \
            and scene_rec['old_title'] != scene_rec['new_title']:
        return (f'场次名称有调整：{scene_rec["old_title"]} → '
                f'{scene_rec["new_title"]}（参考差异）')
    return ''
