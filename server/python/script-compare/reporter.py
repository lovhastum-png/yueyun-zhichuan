"""
越剧剧本比对 · Markdown 报告生成模块
=====================================================================
把结构化比对报告渲染为可导出的 Markdown 文档。
仅输出「参考差异」与客观描述，不含绝对化评判词汇。
=====================================================================
"""
from __future__ import annotations

_STATUS_LABEL = {
    'unchanged': '未变',
    'modified': '修改',
    'removed': '删句',
    'added': '增句',
}
_SEG_STATUS_LABEL = {
    'matched': '',
    'old_only': '（旧版本独有）',
    'new_only': '（新版本新增）',
}
_SCENE_STATUS_LABEL = {
    'matched': '',
    'old_only': '【仅见于旧版本】',
    'new_only': '【新版本新增】',
}


def _clip(text: str, limit: int = 60) -> str:
    text = (text or '').strip()
    return text if len(text) <= limit else text[:limit] + '…'


def to_markdown(report: dict) -> str:
    old, new = report['old'], report['new']
    lines: list[str] = []
    w = lines.append

    title = old['title'] or new['title'] or '剧本'
    w(f'# 《{title}》剧本版本比对报告')
    w('')
    w(f"> {report['disclaimer']}；所有差异均为「参考差异」，不构成版本优劣判定。")
    w('')

    # 基本信息
    w('## 一、基本信息')
    w('')
    w('| | 旧版本 | 新版本 |')
    w('|---|---|---|')
    w(f"| 版本 | {old['label']} | {new['label']} |")
    w(f"| 场次数 | {old['scene_count']} | {new['scene_count']} |")
    w(f"| 唱念总句数 | {old['sentence_count']} | {new['sentence_count']} |")
    w(f"| 登场角色 | {'、'.join(old['roles']) or '—'} | {'、'.join(new['roles']) or '—'} |")
    w('')
    w(f"**总体参考相似度：{report['overall_similarity']}%**（以整句为单位折算，仅供参考）")
    w('')

    # 人物增减
    rc = report['role_changes']
    w('## 二、人物增减')
    w('')
    w(f"- 新增角色：{'、'.join(rc['added_roles']) or '无'}")
    w(f"- 未再出现角色：{'、'.join(rc['removed_roles']) or '无'}")
    if rc.get('role_stats'):
        w('')
        w('| 角色 | 未变句 | 修改句 | 增句 | 删句 |')
        w('|---|---|---|---|---|')
        for role, st in rc['role_stats'].items():
            w(f"| {role} | {st.get('unchanged', 0)} | {st.get('modified', 0)} "
              f"| {st.get('added', 0)} | {st.get('removed', 0)} |")
    w('')

    # 标签统计
    w('## 三、差异标签统计（以句为单位）')
    w('')
    if report['summary']:
        w(' · '.join(f'{k} {v} 处' for k, v in report['summary'].items()))
    else:
        w('未发现明显差异')
    w('')

    # 场次明细
    w('## 四、场次明细')
    w('')
    for idx, scene in enumerate(report['scenes'], 1):
        label = (scene.get('new_title') or scene.get('old_title') or '未命名场次')
        status = _SCENE_STATUS_LABEL.get(scene['status'], '')
        sim = (f"（参考相似度 {scene['similarity']}%）"
               if scene.get('similarity') is not None else '')
        w(f'### {idx}. {label} {status}{sim}')
        if scene.get('tags'):
            w('')
            w('标签：' + '、'.join(scene['tags']))
        if scene.get('note'):
            w('')
            w(f"> {scene['note']}")
        w('')

        unchanged_total = 0
        for seg in scene['segments']:
            head = f"**【{seg['type']}】{seg['role'] or '未署名'}**"
            suffix = _SEG_STATUS_LABEL.get(seg['status'], '')
            seg_sim = (f"（参考相似度 {seg['similarity']}%）"
                       if seg.get('similarity') is not None else '')
            w(f'- {head}{suffix}{seg_sim}')
            for row in seg['sentences']:
                if row['status'] == 'unchanged':
                    unchanged_total += 1
                    continue
                st = _STATUS_LABEL.get(row['status'], row['status'])
                sim = (f"，参考相似度 {row['similarity']:.0f}%"
                       if row.get('similarity') is not None else '')
                role = row.get('old_role') or row.get('new_role') or ''
                role_prefix = f'{role}：' if role else ''
                if row['status'] == 'modified':
                    w(f"  - 【{st}】{role_prefix}「{_clip(row['old'])}」 → "
                      f"「{_clip(row['new'])}」{sim}")
                elif row['status'] == 'removed':
                    w(f"  - 【{st}】{role_prefix}「{_clip(row['old'])}」")
                else:
                    w(f"  - 【{st}】{role_prefix}「{_clip(row['new'])}」")
        if unchanged_total:
            w('')
            w(f'（另有 {unchanged_total} 句未发现明显差异，此处从略）')
        w('')

    # 溯源说明
    w('---')
    w('')
    w('**溯源提示**：各差异句的史料检索关键词已在报告中生成；'
       'RAG 史料库与知识图谱检索接口已预留，待对接后可直接溯源相关文献。')
    w('')
    w(f"_报告生成：越韵智传 · 剧本比对工具 v{report['meta']['version']} · "
      f"耗时 {report['meta']['elapsed_ms']}ms_")
    return '\n'.join(lines)
