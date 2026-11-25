"""
越剧剧本比对 · 核心比对模块
=====================================================================
【比对策略】三级对齐，符合越剧剧本体例：
  L1 场次 —— 场名相似度 + Needleman-Wunsch 保序对齐（容忍场次改名）；
  L2 段落 —— 场内【唱段】/【念白】序列对齐（类型与角色参与签名）；
  L3 整句 —— 唱词以整句为单位配对；句内字符级 diff（python-Levenshtein）
             仅用于前端高亮，相似度判定一律以整句为单位。

【相似度】rapidfuzz 字面相似度与 jieba 分词后的 token 相似度取大者，
兼顾「同义改写但字面差异较大」的语义近似场景。

【专业约束】所有结果均标注为「参考差异」，不做版本优劣判定，
不使用「错误 / 正确」等绝对化表述。
=====================================================================
"""
from __future__ import annotations

import logging
import time

import jieba
import Levenshtein
from rapidfuzz import fuzz

import tagger
import adapters
import reporter
from preprocessor import Script, strip_punct

# 抑制 jieba 首次加载词典时的 INFO 刷屏
jieba.setLogLevel(logging.WARNING)

MATCH_MIN = 45.0        # 低于此相似度的配对降级为「删除 + 新增」
UNCHANGED_MIN = 95.0    # 高于此相似度视为未改动
GAP_PENALTY = -40.0     # NW 对齐的空位罚分

_token_cache: dict[str, str] = {}


def _tokens(s: str) -> str:
    """jieba 分词结果以空格连接（供 token 级相似度使用），带缓存"""
    if s not in _token_cache:
        _token_cache[s] = ' '.join(jieba.lcut(s))
    return _token_cache[s]


def similarity(a: str, b: str) -> float:
    """综合相似度（0-100）：字面 ratio 与分词 token 相似度取大者。"""
    if not a or not b:
        return 0.0
    return max(fuzz.ratio(a, b), fuzz.token_sort_ratio(_tokens(a), _tokens(b)))


# ---------- Needleman-Wunsch 保序对齐 ----------
def _align(a_items: list, b_items: list, key_fn) -> list:
    """序列保序对齐（Needleman-Wunsch）。返回 op 列表（顺序即展示顺序）：
      ('match', i, j, score) / ('del', i) / ('ins', j)
    弱配对（score < MATCH_MIN）降级为 del + ins，避免误配。"""
    n, m = len(a_items), len(b_items)
    if n == 0 and m == 0:
        return []
    if n == 0:
        return [('ins', j) for j in range(m)]
    if m == 0:
        return [('del', i) for i in range(n)]

    a_keys = [key_fn(x) for x in a_items]
    b_keys = [key_fn(x) for x in b_items]
    S = [[similarity(a_keys[i], b_keys[j]) for j in range(m)] for i in range(n)]

    dp = [[0.0] * (m + 1) for _ in range(n + 1)]
    for i in range(1, n + 1):
        dp[i][0] = dp[i - 1][0] + GAP_PENALTY
    for j in range(1, m + 1):
        dp[0][j] = dp[0][j - 1] + GAP_PENALTY
    for i in range(1, n + 1):
        row, prev = dp[i], dp[i - 1]
        for j in range(1, m + 1):
            row[j] = max(
                prev[j - 1] + S[i - 1][j - 1],
                prev[j] + GAP_PENALTY,
                row[j - 1] + GAP_PENALTY,
            )

    # 回溯
    ops = []
    i, j = n, m
    while i > 0 or j > 0:
        if i > 0 and j > 0 and dp[i][j] == dp[i - 1][j - 1] + S[i - 1][j - 1]:
            ops.append(('match', i - 1, j - 1, S[i - 1][j - 1]))
            i -= 1
            j -= 1
        elif i > 0 and dp[i][j] == dp[i - 1][j] + GAP_PENALTY:
            ops.append(('del', i - 1))
            i -= 1
        else:
            ops.append(('ins', j - 1))
            j -= 1
    ops.reverse()

    # 弱配对降级
    refined = []
    for op in ops:
        if op[0] == 'match' and op[3] < MATCH_MIN:
            refined.append(('del', op[1]))
            refined.append(('ins', op[2]))
        else:
            refined.append(op)
    return refined


# ---------- 句内字符级差异（仅用于前端高亮展示） ----------
def _char_parts(a: str, b: str):
    """python-Levenshtein 编辑操作码 → 双侧差异分段。
    返回 (old_parts, new_parts)，每段为 (文本, 'same' | 'diff')。"""
    old_parts, new_parts = [], []

    def push(parts, text, kind):
        if parts and parts[-1][1] == kind:
            parts[-1] = (parts[-1][0] + text, kind)
        else:
            parts.append((text, kind))

    for tag, s1, e1, s2, e2 in Levenshtein.opcodes(a, b):
        if tag == 'equal':
            push(old_parts, a[s1:e1], 'same')
            push(new_parts, b[s2:e2], 'same')
        else:
            if e1 > s1:
                push(old_parts, a[s1:e1], 'diff')
            if e2 > s2:
                push(new_parts, b[s2:e2], 'diff')
    return old_parts, new_parts


# ---------- 段落签名 ----------
def _seg_key(seg) -> str:
    """段落比对签名：类型 + 角色 + 全部整句键（角色参与签名，
    降低不同角色段落的误配概率）"""
    return f'{seg.type}|{seg.role}|' + '；'.join(s.key for s in seg.sentences)


# ---------- 三级比对 ----------
def _sentence_rows(old_seg, new_seg, play_title: str, scene_title: str) -> list:
    """整句配对 → 差异行列表（唱词整句为单位，不拆单字）。"""
    rows = []
    for op in _align(old_seg.sentences, new_seg.sentences, key_fn=lambda s: s.key):
        if op[0] == 'match':
            i, j, score = op[1], op[2], op[3]
            so, sn = old_seg.sentences[i], new_seg.sentences[j]
            if score >= UNCHANGED_MIN:
                rows.append({
                    'status': 'unchanged',
                    'old': so.text, 'new': sn.text,
                    'old_role': so.role, 'new_role': sn.role,
                    'similarity': round(score, 1),
                })
            else:
                old_parts, new_parts = _char_parts(so.text, sn.text)
                rows.append({
                    'status': 'modified',
                    'old': so.text, 'new': sn.text,
                    'old_role': so.role, 'new_role': sn.role,
                    'similarity': round(score, 1),
                    'old_parts': old_parts, 'new_parts': new_parts,
                    'note': tagger.sentence_note('modified', score),
                    'tags': tagger.sentence_tags('modified', old_seg.type),
                    'keywords': adapters.get_search_keywords(
                        play_title, scene_title, so.role or sn.role,
                        [so.text, sn.text]),
                })
        elif op[0] == 'del':
            so = old_seg.sentences[op[1]]
            rows.append({
                'status': 'removed',
                'old': so.text, 'new': None,
                'old_role': so.role, 'new_role': '',
                'similarity': None,
                'note': tagger.sentence_note('removed', None),
                'tags': tagger.sentence_tags('removed', old_seg.type),
                'keywords': adapters.get_search_keywords(
                    play_title, scene_title, so.role, [so.text]),
            })
        else:
            sn = new_seg.sentences[op[1]]
            rows.append({
                'status': 'added',
                'old': None, 'new': sn.text,
                'old_role': '', 'new_role': sn.role,
                'similarity': None,
                'note': tagger.sentence_note('added', None),
                'tags': tagger.sentence_tags('added', new_seg.type),
                'keywords': adapters.get_search_keywords(
                    play_title, scene_title, sn.role, [sn.text]),
            })
    return rows


def _sim_from_rows(rows: list, old_count: int, new_count: int):
    """段落/场次相似度 = Σ配对相似度 / max(两侧句数)，参考值。
    （配对相似度已是百分制，直接求和后除以句数即得百分比）"""
    denom = max(old_count, new_count, 1)
    total = sum(r['similarity'] for r in rows if r['similarity'] is not None)
    return round(min(100.0, total / denom), 1)


def _seg_single(seg, status: str, play_title: str, scene_title: str) -> dict:
    """整段新增 / 删除 → 段内句子逐句标注"""
    rows = []
    for s in seg.sentences:
        rows.append({
            'status': 'removed' if status == 'old_only' else 'added',
            'old': s.text if status == 'old_only' else None,
            'new': s.text if status == 'new_only' else None,
            'old_role': s.role if status == 'old_only' else '',
            'new_role': s.role if status == 'new_only' else '',
            'similarity': None,
            'note': tagger.sentence_note('removed' if status == 'old_only' else 'added', None),
            'tags': tagger.sentence_tags('removed' if status == 'old_only' else 'added', seg.type),
            'keywords': adapters.get_search_keywords(play_title, scene_title, s.role, [s.text]),
        })
    return {
        'type': seg.type, 'role': seg.role, 'status': status,
        'similarity': None,
        'tags': sorted({t for r in rows for t in r.get('tags', [])}),
        'sentences': rows,
    }


def _seg_matched(old_seg, new_seg, play_title: str, scene_title: str) -> dict:
    rows = _sentence_rows(old_seg, new_seg, play_title, scene_title)
    return {
        'type': new_seg.type or old_seg.type,
        'role': new_seg.role or old_seg.role,
        'status': 'matched',
        'similarity': _sim_from_rows(rows, len(old_seg.sentences), len(new_seg.sentences)),
        'tags': sorted({t for r in rows for t in r.get('tags', [])}),
        'sentences': rows,
    }


def _scene_single(scene, status: str, play_title: str, is_last: bool) -> dict:
    segs = [_seg_single(seg, status, play_title, scene.title) for seg in scene.segments]
    rec = {
        'status': status,
        'old_title': scene.title if status == 'old_only' else None,
        'new_title': scene.title if status == 'new_only' else None,
        'similarity': None,
        'segments': segs,
    }
    rec['tags'] = tagger.scene_tags(rec, is_last=is_last, title_changed=False, has_role_change=False)
    rec['note'] = tagger.scene_note(rec, old_ver='', new_ver='')
    return rec


def _scene_matched(old_scene, new_scene, play_title: str, is_last: bool,
                   role_changes: dict, old_ver: str, new_ver: str) -> dict:
    segs = []
    for op in _align(old_scene.segments, new_scene.segments, key_fn=_seg_key):
        if op[0] == 'match':
            segs.append(_seg_matched(old_scene.segments[op[1]], new_scene.segments[op[2]],
                                     play_title, old_scene.title))
        elif op[0] == 'del':
            segs.append(_seg_single(old_scene.segments[op[1]], 'old_only',
                                    play_title, old_scene.title))
        else:
            segs.append(_seg_single(new_scene.segments[op[1]], 'new_only',
                                    play_title, old_scene.title))

    old_cnt = sum(len(g.sentences) for g in old_scene.segments)
    new_cnt = sum(len(g.sentences) for g in new_scene.segments)
    all_rows = [r for g in segs for r in g['sentences']]
    rec = {
        'status': 'matched',
        'old_title': old_scene.title,
        'new_title': new_scene.title,
        'similarity': _sim_from_rows(all_rows, old_cnt, new_cnt),
        'segments': segs,
    }
    # 场内出现新增/消失角色的句子 → 人物增减标签
    changed_roles = set(role_changes['added_roles']) | set(role_changes['removed_roles'])
    has_role_change = any(
        r.get('old_role') in changed_roles or r.get('new_role') in changed_roles
        for r in all_rows
    )
    title_changed = old_scene.title != new_scene.title
    rec['tags'] = tagger.scene_tags(rec, is_last=is_last, title_changed=title_changed,
                                    has_role_change=has_role_change)
    rec['note'] = tagger.scene_note(rec, old_ver=old_ver, new_ver=new_ver)
    return rec


# ---------- 主入口 ----------
def build_report(old: Script, new: Script) -> dict:
    """两个版本剧本 → 完整比对报告（含标签、溯源关键词、Markdown 导出）。"""
    t0 = time.time()

    # 人物增减（先算：场次标签依赖）
    added_roles = sorted(new.roles - old.roles)
    removed_roles = sorted(old.roles - new.roles)
    role_changes = {'added_roles': added_roles, 'removed_roles': removed_roles}

    play_title = old.title or new.title
    old_ver = f'{old.version}{old.year and "（" + old.year + "）" or ""}'.strip()
    new_ver = f'{new.version}{new.year and "（" + new.year + "）" or ""}'.strip()

    scenes_out = []
    for op in _align(old.scenes, new.scenes, key_fn=lambda sc: strip_punct(sc.title)):
        if op[0] == 'match':
            oi, ni = op[1], op[2]
            is_last = oi == len(old.scenes) - 1 or ni == len(new.scenes) - 1
            scenes_out.append(_scene_matched(
                old.scenes[oi], new.scenes[ni], play_title, is_last,
                role_changes, old_ver, new_ver))
        elif op[0] == 'del':
            is_last = op[1] == len(old.scenes) - 1
            scenes_out.append(_scene_single(old.scenes[op[1]], 'old_only', play_title, is_last))
        else:
            is_last = op[1] == len(new.scenes) - 1
            scenes_out.append(_scene_single(new.scenes[op[1]], 'new_only', play_title, is_last))

    # 角色维度统计（按句计数）
    role_stats: dict[str, dict[str, int]] = {}
    for scene in scenes_out:
        for seg in scene['segments']:
            for r in seg['sentences']:
                role = r.get('old_role') or r.get('new_role')
                if not role:
                    continue
                st = role_stats.setdefault(role, {'unchanged': 0, 'modified': 0,
                                                  'added': 0, 'removed': 0})
                st[r['status']] = st.get(r['status'], 0) + 1
    role_changes['role_stats'] = role_stats

    # 总体相似度（参考值）
    all_rows = [r for sc in scenes_out for g in sc['segments'] for r in g['sentences']]
    overall = _sim_from_rows(all_rows, old.sentence_count, new.sentence_count)

    # 标签统计（以句为单位；整场增删另计情节改动）
    summary = {t: 0 for t in (tagger.TAG_PLOT, tagger.TAG_LYRIC,
                              tagger.TAG_ROLE, tagger.TAG_ENDING)}
    for r in all_rows:
        for t in r.get('tags', []):
            summary[t] = summary.get(t, 0) + 1
    for sc in scenes_out:
        if sc['status'] != 'matched':
            summary[tagger.TAG_PLOT] += 1
    # 结局调整为场次级标签（末场存在差异），按命中场次计数
    summary[tagger.TAG_ENDING] += sum(
        1 for sc in scenes_out if tagger.TAG_ENDING in sc['tags'])
    summary[tagger.TAG_ROLE] += len(added_roles) + len(removed_roles)

    report = {
        'disclaimer': '本工具为教学辅助工具，差异判定请以专业教师为准',
        'scope': ('所有比对结果均为「参考差异」，不构成对版本优劣的判定；'
                  '唱词以整句为单位比对，场次按越剧剧本体例先对场次、再对场内唱段念白'),
        'old': _version_info(old, old_ver),
        'new': _version_info(new, new_ver),
        'overall_similarity': overall,
        'summary': {k: v for k, v in summary.items() if v > 0},
        'role_changes': role_changes,
        'scenes': scenes_out,
        'meta': {
            'elapsed_ms': int((time.time() - t0) * 1000),
            'version': '1.0.0',
            'match_min': MATCH_MIN,
            'unchanged_min': UNCHANGED_MIN,
        },
    }
    report['markdown'] = reporter.to_markdown(report)
    return report


def _version_info(script: Script, label: str) -> dict:
    return {
        'title': script.title,
        'version': script.version,
        'year': script.year,
        'label': label or '未知版本',
        'scene_count': len(script.scenes),
        'sentence_count': script.sentence_count,
        'roles': sorted(script.roles),
    }
