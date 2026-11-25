# -*- coding: utf-8 -*-
"""
导出越剧大典 xlsx 为 JSON，供 Node 端向量化入库。
输出: finetune/scripts/dadian_dump.json
包含: 名人篇 / 名剧篇 / 名曲篇 / 课本剧 / 名曲名剧演员
"""
import openpyxl, glob, os, json

BASE = r"d:\实验室项目\越韵智传完整demo\越韵智传-Alpaca微调数据集\原始语料\越剧大典数据"
OUT = r"d:\实验室项目\越韵智传完整demo\finetune\scripts\dadian_dump.json"

def clean(v):
    if v is None:
        return ""
    s = str(v).strip()
    if s in ("None", "nan", "NaN"):
        return ""
    return s

def parse_person(f):
    """名人篇：col0姓名 col1简介 col2性别 col3职称 col4籍贯 col5出生 col6师承 ... col8流派 col9奖项 col10代表剧目 col11剧团"""
    wb = openpyxl.load_workbook(f, read_only=True)
    ws = wb.active
    rows = []
    for r in ws.iter_rows(values_only=True):
        if not r or not r[0]:
            continue
        name = clean(r[0])
        intro = clean(r[1]) if len(r) > 1 else ""
        if not name:
            continue
        gender = clean(r[2]) if len(r) > 2 else ""
        title = clean(r[3]) if len(r) > 3 else ""
        hometown = clean(r[4]) if len(r) > 4 else ""
        born = clean(r[5]) if len(r) > 5 else ""
        teacher = clean(r[6]) if len(r) > 6 else ""
        school = clean(r[8]) if len(r) > 8 else ""
        awards = clean(r[9]) if len(r) > 9 else ""
        plays = clean(r[10]) if len(r) > 10 else ""
        troupe = clean(r[11]) if len(r) > 11 else ""

        parts = [intro]
        extras = []
        if gender: extras.append(f"性别：{gender}")
        if title: extras.append(f"职称：{title}")
        if hometown: extras.append(f"籍贯：{hometown}")
        if born: extras.append(f"出生：{born}")
        if school: extras.append(f"所属流派：{school}")
        if plays: extras.append(f"代表剧目：{plays}")
        if troupe: extras.append(f"所属剧团：{troupe}")
        if teacher: extras.append(f"师承：{teacher}")
        if awards: extras.append(f"主要奖项：{awards}")
        if extras:
            parts.append("；".join(extras))
        desc = "。".join(p for p in parts if p)
        rows.append({"name": name, "desc": desc, "type": "person"})
    wb.close()
    return rows

def parse_play(f):
    """名剧篇/课本剧：col0剧名 col1简介 col2剧情 ... col4类型 col5编剧 col6首演 col7人物 col8演员"""
    wb = openpyxl.load_workbook(f, read_only=True)
    ws = wb.active
    rows = []
    for r in ws.iter_rows(values_only=True):
        if not r or not r[0]:
            continue
        name = clean(r[0])
        if not name:
            continue
        intro = clean(r[1]) if len(r) > 1 else ""
        plot = clean(r[2]) if len(r) > 2 else ""
        info = clean(r[3]) if len(r) > 3 else ""
        ptype = clean(r[4]) if len(r) > 4 else ""
        writer = clean(r[5]) if len(r) > 5 else ""
        year = clean(r[6]) if len(r) > 6 else ""
        chars = clean(r[7]) if len(r) > 7 else ""
        actors = clean(r[8]) if len(r) > 8 else ""

        parts = []
        if intro: parts.append(intro)
        if plot: parts.append(f"剧情简介：{plot}")
        if info: parts.append(f"演出信息：{info}")
        if ptype: parts.append(f"类型：{ptype}")
        if writer: parts.append(f"编剧：{writer}")
        if year: parts.append(f"首演年份：{year}")
        if chars: parts.append(f"剧中人物：{chars}")
        if actors: parts.append(f"主要演员：{actors}")
        desc = "。".join(parts) if parts else ""
        rows.append({"name": name, "desc": desc, "type": "play"})
    wb.close()
    return rows

def parse_qu(f):
    """名曲篇：col0曲目 col1剧目 col2录制时间 col3内容 col4职员表"""
    wb = openpyxl.load_workbook(f, read_only=True)
    ws = wb.active
    rows = []
    for r in ws.iter_rows(values_only=True):
        if not r or not r[0]:
            continue
        name = clean(r[0])
        if not name:
            continue
        play = clean(r[1]) if len(r) > 1 else ""
        time = clean(r[2]) if len(r) > 2 else ""
        content = clean(r[3]) if len(r) > 3 else ""
        staff = clean(r[4]) if len(r) > 4 else ""
        parts = []
        if play: parts.append(f"选自剧目：{play}")
        if time: parts.append(f"录制时间：{time}")
        if content: parts.append(f"唱词内容：{content}")
        if staff: parts.append(f"演唱职员：{staff}")
        desc = "。".join(parts) if parts else ""
        rows.append({"name": name, "desc": desc, "type": "qu", "play": play})
    wb.close()
    return rows

def parse_actor(f):
    """名曲名剧演员：col0曲目 col1剧目 col2+演员-角色"""
    wb = openpyxl.load_workbook(f, read_only=True)
    ws = wb.active
    rows = []
    for r in ws.iter_rows(values_only=True):
        if not r or not r[0]:
            continue
        name = clean(r[0])
        if not name:
            continue
        play = clean(r[1]) if len(r) > 1 else ""
        casts = []
        for c in r[2:]:
            cc = clean(c)
            if cc:
                casts.append(cc)
        desc = []
        if play: desc.append(f"选自剧目：{play}")
        if casts: desc.append(f"演唱人员：{'；'.join(casts)}")
        rows.append({"name": name, "desc": "。".join(desc), "type": "qu", "play": play})
    wb.close()
    return rows

all_rows = []
for f in sorted(glob.glob(os.path.join(BASE, "*.xlsx"))):
    fname = os.path.basename(f)
    try:
        if "名人篇" in fname:
            rows = parse_person(f)
        elif "名剧篇" in fname or "课本剧" in fname:
            rows = parse_play(f)
        elif "名曲篇" in fname:
            rows = parse_qu(f)
        elif "名曲名剧演员" in fname:
            rows = parse_actor(f)
        else:
            continue
        print(f"{fname}: {len(rows)} 条")
        all_rows.extend(rows)
    except Exception as e:
        print(f"{fname}: 读取失败 {e}")

with open(OUT, "w", encoding="utf-8") as fp:
    json.dump(all_rows, fp, ensure_ascii=False, indent=1)
print(f"\n共导出 {len(all_rows)} 条 -> {OUT}")