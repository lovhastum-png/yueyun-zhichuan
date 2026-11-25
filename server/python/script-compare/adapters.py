"""
越剧剧本比对 · 溯源关联模块
=====================================================================
【职责】把差异片段转成「史料文献检索关键词」，为后续对接 RAG 史料库
与越剧知识图谱做准备。

【预留接口】query_rag_corpus / query_knowledge_graph —— 仅保留函数
入口与参数契约，不含任何对接实现；对接时替换函数体即可，
上游（报告生成）无需改动。
=====================================================================
"""
from __future__ import annotations

from collections import Counter

import jieba

from preprocessor import strip_punct

# 检索关键词里过滤掉的常见虚词 / 代词（保持列表精简，避免误伤戏曲用语）
_STOP_WORDS = {
    '的', '了', '是', '在', '我', '你', '他', '她', '它', '和', '与', '也',
    '就', '都', '还', '不', '再', '有', '这', '那', '一个', '什么', '怎',
    '哪', '吧', '啊', '呀', '哦', '之', '其', '被', '把', '让', '向', '从',
    '对', '于', '到', '得', '地', '而', '又', '且', '上', '下', '中', '里',
    '去', '来', '说', '个', '为', '以', '及', '或', '但', '却', '便', '才',
    '只', '没', '无', '已', '要', '会', '能', '可', '将', '把', '此', '该',
}


def get_search_keywords(play_title: str, scene_title: str, role: str,
                        texts: list) -> list:
    """差异片段 → 史料文献检索关键词（已实现，供后续 RAG 检索直接使用）。

    生成策略：
      1. 「剧目 + 场次」「剧目 + 角色」组合词（定位史料中的篇章与人物）；
      2. 差异文本经 jieba 分词后取高频实词，与剧目名组合（定位唱段内容）。
    最多返回 6 个关键词。
    """
    kws: list = []
    seen: set = set()

    def add(kw: str):
        kw = (kw or '').strip()
        if kw and kw not in seen:
            seen.add(kw)
            kws.append(kw)

    if play_title:
        if scene_title:
            add(f'{play_title} {scene_title}')
        if role:
            add(f'{play_title} {role}')
        if scene_title and role:
            add(f'{play_title} {scene_title} {role}')

    words = []
    for t in texts or []:
        if not t:
            continue
        for w in jieba.lcut(strip_punct(t)):
            w = w.strip()
            if len(w) >= 2 and w not in _STOP_WORDS:
                words.append(w)
    for w, _cnt in Counter(words).most_common(4):
        add(f'{play_title} {w}' if play_title else w)

    return kws[:6]


# ---------------------------------------------------------------------------
# 以下两个函数为【预留空接口】：对接 RAG 史料库 / 知识图谱时替换函数体。
# 输入即 get_search_keywords 的输出，输出契约建议为检索结果列表。
# ---------------------------------------------------------------------------
def query_rag_corpus(keywords: list, top_k: int = 5):
    """【预留】用关键词检索 RAG 史料库（民国报刊、戏考、手抄本研究文献等）。

    对接示例（伪代码）：
        from rag_client import retrieve
        return retrieve(' '.join(keywords), top_k=top_k)
    """
    return None


def query_knowledge_graph(keywords: list):
    """【预留】把关键词映射到越剧知识图谱节点（剧目 / 场次 / 人物 / 流派）。

    对接示例（伪代码）：
        from kg_client import expand
        return expand(keywords)
    """
    return None
