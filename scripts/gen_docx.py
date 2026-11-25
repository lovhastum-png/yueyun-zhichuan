# -*- coding: utf-8 -*-
"""将越韵智传 EI 论文 md 转换为带加粗标题与重点的 Word 文档。"""
from docx import Document
from docx.shared import Pt, RGBColor
from docx.enum.text import WD_ALIGN_PARAGRAPH, WD_LINE_SPACING
from docx.oxml.ns import qn

SRC = r"d:\实验室项目\越韵智传完整demo\docs\论文_EI_越韵智传_越剧非遗数字化教学系统.md"
OUT = r"d:\实验室项目\越韵智传完整demo\docs\论文_EI_越韵智传_越剧非遗数字化教学系统.docx"

INK = RGBColor(0x2B, 0x2B, 0x2B)
CINNABAR = RGBColor(0xC1, 0x27, 0x2D)  # 朱砂红，用于大标题
TEAL = RGBColor(0x3A, 0x7D, 0x7B)      # 青绿，用于小节标题

def set_font(run, size=12, bold=False, color=INK, name="宋体"):
    run.font.name = name
    run.font.size = Pt(size)
    run.bold = bold
    run.font.color.rgb = color
    r = run._element.rPr.rFonts
    r.set(qn("w:eastAsia"), name)

def add_para(doc, text, size=12, bold=False, color=INK, align=None, space_after=6, indent=False):
    p = doc.add_paragraph()
    if indent:
        p.paragraph_format.first_line_indent = Pt(24)
    p.paragraph_format.space_after = Pt(space_after)
    p.paragraph_format.line_spacing = 1.35
    if align:
        p.alignment = align
    run = p.add_run(text)
    set_font(run, size=size, bold=bold, color=color)
    return p

def add_rich(doc, text, size=12, bold_header=False):
    """支持 **加粗** 标记的段落；bold_header 用于整段强调（如表格表头）。"""
    p = doc.add_paragraph()
    p.paragraph_format.space_after = Pt(6)
    p.paragraph_format.line_spacing = 1.35
    parts = text.split("**")
    for i, seg in enumerate(parts):
        if not seg:
            continue
        run = p.add_run(seg)
        set_font(run, size=size, bold=(bold_header or i % 2 == 1))
    return p

doc = Document()
# 页面边距
sec = doc.sections[0]
sec.top_margin, sec.bottom_margin = Pt(72), Pt(72)
sec.left_margin, sec.right_margin = Pt(85), Pt(85)

title = "面向非物质文化遗产传承的越剧数字化智能教学系统：\u201c越韵智传\u201d"
add_para(doc, title, size=18, bold=True, color=CINNABAR, align=WD_ALIGN_PARAGRAPH.CENTER, space_after=4)
add_para(doc, "（面向 EI 会议的中文投稿篇，6-8 页）", size=10.5, color=TEAL, align=WD_ALIGN_PARAGRAPH.CENTER, space_after=2)
add_para(doc, "作者信息待填写（单位 / 姓名 / E-mail）", size=10.5, align=WD_ALIGN_PARAGRAPH.CENTER, space_after=12)

with open(SRC, encoding="utf-8") as f:
    lines = f.read().splitlines()

i = 0
while i < len(lines):
    raw = lines[i].strip()
    # 跳过水平分隔线
    if raw in ("---", "===", "***"):
        i += 1
        continue
    # 一级标题 #
    if raw.startswith("# "):
        add_para(doc, raw[2:].strip(), size=16, bold=True, color=CINNABAR, space_after=8)
        i += 1
        continue
    # 二级标题 ##
    if raw.startswith("## "):
        add_para(doc, raw[3:].strip(), size=14, bold=True, color=INK, space_after=6)
        i += 1
        continue
    # 三级标题 ###
    if raw.startswith("### "):
        add_para(doc, raw[4:].strip(), size=12.5, bold=True, color=TEAL, space_after=4)
        i += 1
        continue
    # 表格：收集连续 | 行，渲染为文本行（表头加粗）
    if raw.startswith("|"):
        rows = []
        while i < len(lines) and lines[i].strip().startswith("|"):
            rows.append(lines[i].strip())
            i += 1
        # rows[1] 为分隔行，跳过
        for ri, row in enumerate(rows):
            if ri == 1:
                continue
            cells = [c.strip() for c in row.strip().strip("|").split("|")]
            line = "　|　".join(cells)
            add_rich(doc, line, size=11, bold_header=(ri == 0))
        continue
    # 引用块
    if raw.startswith(">"):
        add_para(doc, raw.lstrip("> ").strip(), size=10.5, color=TEAL, space_after=6)
        i += 1
        continue
    # 列表项
    if raw.startswith("- "):
        add_rich(doc, "· " + raw[2:].strip(), size=12)
        i += 1
        continue
    # 空行
    if raw == "":
        i += 1
        continue
    # 普通段落（支持 **加粗**）
    add_rich(doc, raw, size=12)
    i += 1

doc.save(OUT)
print("已生成:", OUT)