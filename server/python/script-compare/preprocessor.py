"""
越剧剧本比对 · 文本预处理模块
=====================================================================
【定位】教学辅助工具。把两个版本的剧本文本清洗、统一为可比对的
结构化数据：清洗（标点统一 / 空白折叠）→ 繁简转换（民国手抄本
多为繁体，统一转为简体参与比对与显示）→ 文件名元信息解析 →
按【场次】/【唱段】/【念白】标记结构化解析 → 以整句为单位分句。

【专业约束】
- 唱词以整句（。？！；收尾）为最小比对单位，不拆成单字；
- 解析容错：文本缺少【】标记时退化为「单场全文」，不中断比对；
- 本模块只做规范化，不做任何「对错」判定。
=====================================================================
"""
from __future__ import annotations

import re
from dataclasses import dataclass, field

from opencc import OpenCC

# 繁 → 简 转换器（模块级单例，opencc 初始化有一定开销）
_CC = OpenCC('t2s')

# ---------- 标点统一：半角 → 全角 ----------
# 数字前后的 . 与 , 保留半角，避免破坏 "3.5" / "3,000" 一类数字
_PUNCT_RULES = [
    (re.compile(r'(?<!\d),(?!\d)'), '，'),
    (re.compile(r'(?<!\d)\.(?!\d)'), '。'),
    (re.compile(r'(?<!\d);(?!\d)'), '；'),
    (re.compile(r'(?<![A-Za-z0-9])\?'), '？'),
    (re.compile(r'(?<![A-Za-z0-9])!'), '！'),
]

# 比对用的「净化键」：去掉全部标点与空白，只留实词字符
_KEY_STRIP = re.compile(r'[^\u4e00-\u9fa5A-Za-z0-9]')

# 结构标记：场次 / 段落 / 说话人 / 分句
_SCENE_RE = re.compile(r'^【\s*([^】]*场[^】]*)\s*】\s*(.*)$')
_SEG_RE = re.compile(r'^【\s*(唱段|念白|唱|白)\s*】\s*(.*)$')
_SPEAKER_RE = re.compile(r'^([^\s：:，。！？；（）()]{1,8})(?:[（(][^）)]{0,10}[）)])?\s*[：:]')
_CUE_RE = re.compile(r'^[（(][^）)]{0,10}[）)]\s*')
_SENT_SPLIT = re.compile(r'([^。！？；]+[。！？；]?)')


def strip_punct(s: str) -> str:
    """去掉标点与空白，得到比对用键（场景名等短文本也用它）"""
    return _KEY_STRIP.sub('', s or '')


# ---------- 数据结构 ----------
@dataclass
class Sentence:
    text: str        # 展示用原文（唱词整句，不含角色前缀）
    key: str         # 比对用键（去标点去空白）
    role: str = ''   # 说话角色（无角色前缀的行留空）


@dataclass
class Segment:
    type: str                     # '唱段' | '念白'
    role: str = ''                # 首个说话角色（对唱段取主角色）
    sentences: list = field(default_factory=list)


@dataclass
class Scene:
    title: str
    segments: list = field(default_factory=list)


@dataclass
class Script:
    title: str = ''      # 剧目名（来自文件名）
    version: str = ''    # 版本（来自文件名）
    year: str = ''       # 年代（来自文件名）
    scenes: list = field(default_factory=list)
    roles: set = field(default_factory=set)
    sentence_count: int = 0


# ---------- 清洗与转换 ----------
def clean_text(raw: str) -> str:
    """BOM / 换行符 / 标点 / 空白 规范化"""
    text = (raw or '').replace('\ufeff', '')
    text = text.replace('\r\n', '\n').replace('\r', '\n')
    for rule, repl in _PUNCT_RULES:
        text = rule.sub(repl, text)
    lines = []
    for ln in text.split('\n'):
        ln = re.sub(r'[ \t\u3000]+', ' ', ln).strip()
        lines.append(ln)
    return '\n'.join(lines)


def to_simplified(text: str) -> str:
    """繁体 → 简体（民国手抄本等繁体版本统一转简体后参与比对）"""
    return _CC.convert(text or '')


def parse_filename(name: str) -> dict:
    """解析「剧目名_版本_年代.txt」命名约定，格式不符时尽力降级。"""
    base = re.sub(r'\.txt$', '', (name or '').strip(), flags=re.I)
    parts = [p.strip() for p in base.split('_') if p.strip()]
    if len(parts) >= 3:
        return {'title': '_'.join(parts[:-2]), 'version': parts[-2], 'year': parts[-1]}
    if len(parts) == 2:
        return {'title': parts[0], 'version': parts[1], 'year': ''}
    return {'title': base, 'version': '', 'year': ''}


# ---------- 结构化解析 ----------
def _split_speaker(line: str):
    """拆出（角色, 台词内容）。兼容两种越剧剧本体例：
    「祝英台（唱）：内容」与「祝公远：（白）内容」。
    无角色前缀的行返回 (None, 原行)。"""
    m = _SPEAKER_RE.match(line)
    if m:
        return m.group(1), line[m.end():].strip()
    return None, line


def _make_sentences(line: str) -> list:
    """一行文本 → 若干整句 Sentence（以 。？！； 切分，绝不拆到字级）。"""
    role, content = _split_speaker(line)
    # 行首舞台提示（（唱）（白）（介）等）不计入比对键
    key_src = _CUE_RE.sub('', content) if role else line
    out = []
    for piece in _SENT_SPLIT.findall(key_src):
        piece = piece.strip()
        key = strip_punct(piece)
        if not key:
            continue  # 纯标点 / 纯舞台提示行，不参与比对
        out.append(Sentence(text=piece, key=key, role=role or ''))
    return out


def parse_script(text: str, filename: str = '') -> Script:
    """清洗 + 繁简转换 + 按【场次】【唱段】【念白】结构化解析。"""
    meta = parse_filename(filename)
    body = to_simplified(clean_text(text))

    script = Script(title=meta['title'], version=meta['version'], year=meta['year'])
    cur_scene: Scene | None = None
    cur_seg: Segment | None = None

    def ensure_scene(default_title: str = '正文') -> Scene:
        nonlocal cur_scene
        if cur_scene is None:
            cur_scene = Scene(title=default_title)
            script.scenes.append(cur_scene)
        return cur_scene

    for line in body.split('\n'):
        line = line.strip()
        if not line:
            continue

        m = _SCENE_RE.match(line)
        if m:
            # 场次标记：标题优先取 】后的文字，为空则用标记内文字
            title = m.group(2).strip() or m.group(1).strip()
            cur_scene = Scene(title=title)
            script.scenes.append(cur_scene)
            cur_seg = None
            continue

        m = _SEG_RE.match(line)
        if m:
            ensure_scene()
            typ = '唱段' if '唱' in m.group(1) else '念白'
            cur_seg = Segment(type=typ)
            rest = m.group(2).strip()
            if rest:  # 【唱段】祝英台（唱）：xxx —— 标记与内容同行
                for s in _make_sentences(rest):
                    cur_seg.sentences.append(s)
            if cur_seg.sentences:
                cur_seg.role = cur_seg.sentences[0].role
            cur_scene.segments.append(cur_seg)
            continue

        # 普通内容行：归属当前段落（无段落则自动开一个念白段）
        if cur_seg is None:
            ensure_scene()
            cur_seg = Segment(type='念白')
            cur_scene.segments.append(cur_seg)
        for s in _make_sentences(line):
            cur_seg.sentences.append(s)
        if not cur_seg.role and cur_seg.sentences:
            cur_seg.role = cur_seg.sentences[0].role

    # 汇总
    for sc in script.scenes:
        for seg in sc.segments:
            for s in seg.sentences:
                script.sentence_count += 1
                if s.role:
                    script.roles.add(s.role)
    return script


def decode_txt_bytes(data: bytes) -> str:
    """文本解码：utf-8（含 BOM）→ gb18030（GBK 超集）→ 宽松替换。
    老剧本转录件常见 GBK 编码，需兼容。"""
    if not data:
        return ''
    for enc in ('utf-8-sig', 'gb18030'):
        try:
            return data.decode(enc)
        except UnicodeDecodeError:
            continue
    return data.decode('utf-8', errors='replace')
