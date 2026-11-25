"""
越剧微调数据集生成脚本
将三类原始语料转换为 LLaMA-Factory 的 sharegpt 格式
输出: finetune/data/yueju_train.json
"""
import os
import json
import re
import glob
from docx import Document

try:
    from openpyxl import load_workbook
except ImportError:
    print("[警告] 未安装 openpyxl，将跳过 xlsx 数据")
    load_workbook = None

# ============ 配置 ============
# 原始语料根目录（按你实际路径调整）
CORPUS_ROOT = r"d:\实验室项目\揭榜挂帅项目\越剧数据"
# 项目里的知识图谱数据（从 init.sql 或 seed 数据中导出）
KG_DUMP_PATH = r"d:\实验室项目\越韵智传完整demo\finetune\scripts\kg_dump.json"

# 输出
OUT_PATH = r"d:\实验室项目\越韵智传完整demo\finetune\data\yueju_train.json"

DATASET = []


def add(user, assistant):
    """添加一条样本"""
    user = user.strip()
    assistant = assistant.strip()
    if len(user) < 5 or len(assistant) < 20:
        return
    DATASET.append({
        "conversations": [
            {"from": "user", "content": user},
            {"from": "assistant", "content": assistant}
        ]
    })


def read_docx(path):
    """读取 docx 全部段落文本"""
    doc = Document(path)
    paragraphs = []
    for p in doc.paragraphs:
        t = p.text.strip()
        if t:
            paragraphs.append(t)
    return paragraphs


# ============ 1. 非遗传承人素材 → 流派问答 ============
def gen_school_qa():
    """6 个流派 docx → 流派特色问答"""
    school_dir = os.path.join(CORPUS_ROOT, "非遗传承人素材")
    if not os.path.exists(school_dir):
        print(f"[跳过] 找不到流派目录: {school_dir}")
        return

    school_files = {
        "袁派": "袁派（袁雪芬）.docx",
        "尹派": "尹派（尹桂芳）.docx",
        "徐派": "徐派（徐玉兰）.docx",
        "范派": "范派（范瑞娟）.docx",
        "傅派": "傅派（傅全香）.docx",
        "戚派": "戚派（戚雅仙）.docx",
    }

    for school, fname in school_files.items():
        path = os.path.join(school_dir, fname)
        if not os.path.exists(path):
            print(f"[跳过] {fname} 不存在")
            continue
        paragraphs = read_docx(path)
        if not paragraphs:
            continue

        full_text = "\n".join(paragraphs)
        # 切分成长度 200-400 的片段
        chunks = []
        current = ""
        for p in paragraphs:
            if len(current) + len(p) < 400:
                current += "\n" + p if current else p
            else:
                if current:
                    chunks.append(current)
                current = p
        if current:
            chunks.append(current)

        # 为每个流派生成多条 QA
        add(
            f"请详细介绍越剧{school}的艺术特色、代表人物和代表剧目。",
            full_text[:1500] if len(full_text) > 1500 else full_text
        )
        add(
            f"越剧{school}是谁创立的？她的演唱风格有什么特点？",
            f"{school}由{school[0]}派创始人创立。" + ("\n".join(paragraphs[:3]))[:800]
        )
        # 对每个内容片段生成一条问答
        for i, chunk in enumerate(chunks[:5]):
            add(
                f"请讲述越剧{school}的传承与发展（第{i+1}部分）",
                chunk
            )
        print(f"[流派] {school}: 生成 {len(chunks[:5])+2} 条")


# ============ 2. 四大经典剧本 → 剧情问答 ============
def gen_play_qa():
    """四大经典 docx → 剧情问答"""
    play_dir = os.path.join(CORPUS_ROOT, "四大经典")
    if not os.path.exists(play_dir):
        print(f"[跳过] 找不到剧本目录: {play_dir}")
        return

    play_map = {
        "《梁山伯与祝英台》（梁祝）范傅派标杆": "梁祝",
        "《祥林嫂》袁派现代改革里程碑": "祥林嫂",
        "《红楼梦》徐派、王派巅峰剧目": "红楼梦",
        "《西厢记》袁派、徐派经典": "西厢记",
    }

    for dirname, short_name in play_map.items():
        dir_path = os.path.join(play_dir, dirname)
        if not os.path.exists(dir_path):
            print(f"[跳过] {dirname} 不存在")
            continue

        # 读取简介和原文
        intro_path = os.path.join(dir_path, "简介.docx")
        origin_path = os.path.join(dir_path, "原文.docx")

        intro = ""
        if os.path.exists(intro_path):
            intro = "\n".join(read_docx(intro_path))

        origin = ""
        if os.path.exists(origin_path):
            origin = "\n".join(read_docx(origin_path))

        if not intro and not origin:
            continue

        # 生成 QA
        add(
            f"请介绍越剧《{short_name}》的剧情梗概和艺术价值。",
            intro[:1500] if intro else origin[:1500]
        )
        add(
            f"越剧《{short_name}》有哪些经典唱段？",
            f"《{short_name}》的经典唱段主要体现在以下段落：\n" + origin[:1200]
        )
        # 切分原文做续写式问答
        if origin:
            chunks = [origin[i:i+500] for i in range(0, min(len(origin), 5000), 500)]
            for i, chunk in enumerate(chunks[:5]):
                if len(chunk) > 100:
                    add(
                        f"请讲述越剧《{short_name}》第{i+1}段的剧情内容。",
                        chunk
                    )
        print(f"[剧本] {short_name}: 已处理")


# ============ 3. 知识图谱实体 → 实体问答 ============
def gen_kg_qa():
    """从知识图谱 dump 生成实体问答"""
    if not os.path.exists(KG_DUMP_PATH):
        print(f"[跳过] KG dump 不存在: {KG_DUMP_PATH}")
        print("      请先运行 dump_kg.py 生成 KG 数据")
        return

    with open(KG_DUMP_PATH, "r", encoding="utf-8") as f:
        entities = json.load(f)

    type_map = {
        "person": ("人物", "请介绍越剧人物"),
        "school": ("流派", "请介绍越剧流派"),
        "play": ("剧目", "请介绍越剧剧目"),
        "role": ("行当", "请介绍越剧行当"),
        "segment": ("唱段", "请介绍越剧唱段"),
        "concept": ("概念", "请介绍越剧相关概念"),
    }

    for ent in entities:
        name = ent.get("name", "").strip()
        etype = ent.get("type", "")
        desc = ent.get("description", "").strip()
        if not name or not desc:
            continue

        zh_type, prefix = type_map.get(etype, ("实体", "请介绍越剧相关内容"))
        add(
            f"{prefix} {name}",
            f"{name}是越剧{zh_type}。{desc}"
        )

        # 如果有关系，再生成一条
        rels = ent.get("relations", [])
        if rels:
            rel_text = "\n".join([f"- 与「{r['target']}」存在「{r['relation']}」关系" for r in rels[:5]])
            add(
                f"{name}在越剧里和哪些人/事物有关系？",
                f"{name}的主要关系包括：\n{rel_text}"
            )
    print(f"[知识图谱] 处理 {len(entities)} 个实体")


# ============ 3.5 越剧大典 xlsx → 结构化问答 ============
def gen_dadian_qa():
    """从越剧大典数据 xlsx 生成结构化问答样本"""
    if load_workbook is None:
        print("[跳过] 未安装 openpyxl")
        return

    dadian_dir = os.path.join(CORPUS_ROOT, "越剧大典数据")
    if not os.path.exists(dadian_dir):
        print(f"[跳过] 找不到越剧大典目录: {dadian_dir}")
        return

    # 文件名到问题模板的映射
    file_templates = {
        "名人篇": ("人物", "请介绍越剧人物 {name}", "{name}是越剧{type}。{desc}"),
        "名剧篇": ("剧目", "请介绍越剧剧目《{name}》", "《{name}》是越剧{type}。{desc}"),
        "名曲篇": ("唱段", "请介绍越剧唱段《{name}》", "《{name}》是越剧{type}。{desc}"),
    }

    total = 0
    for fname in sorted(os.listdir(dadian_dir)):
        if not fname.endswith(".xlsx"):
            continue

        fpath = os.path.join(dadian_dir, fname)
        # 匹配文件名前缀确定类型
        qa_type = None
        for prefix, (zh_type, q_tpl, a_tpl) in file_templates.items():
            if prefix in fname:
                qa_type = (zh_type, q_tpl, a_tpl)
                break

        if qa_type is None:
            # 课本剧等未知类型，按通用模板
            qa_type = ("作品", "请介绍越剧相关内容：{name}", "{name}是越剧{type}。{desc}")

        zh_type, q_tpl, a_tpl = qa_type

        try:
            wb = load_workbook(fpath, read_only=True)
            ws = wb.active
            count = 0
            for row in ws.iter_rows(min_row=2, values_only=True):
                if not row or not row[0]:
                    continue
                name = str(row[0]).strip()
                desc = str(row[1]).strip() if len(row) > 1 and row[1] else ""
                if not name or not desc or len(desc) < 20:
                    continue
                # 清理描述中的 None
                desc = desc.replace("None", "").strip()
                if len(desc) < 20:
                    continue

                q = q_tpl.format(name=name, type=zh_type)
                a = a_tpl.format(name=name, type=zh_type, desc=desc[:800])
                add(q, a)
                count += 1

                # 如果有师承/关系字段（第8列），再生成一条关系问答
                if len(row) > 7 and row[7] and str(row[7]).strip() not in ("None", ""):
                    rel = str(row[7]).strip()
                    add(
                        f"{name}的师承关系是什么？",
                        f"{name}的师承关系：{rel}。{desc[:300]}"
                    )
                    count += 1

            wb.close()
            total += count
            print(f"[大典] {fname}: {count} 条")
        except Exception as e:
            print(f"[大典] {fname} 读取失败: {e}")

    print(f"[大典] 共生成 {total} 条")


# ============ 4. 通用越剧常识（兜底） ============
def gen_common_qa():
    commons = [
        ("越剧主要有哪些行当？",
         "越剧行当主要分为生、旦、净、丑四大类。生行包括小生（青年男性）、老生（中老年男性）、武生；旦行包括花旦（年轻女性）、青衣（端庄女性）、老旦（老年女性）、武旦；净行较少；丑行包括小丑、老丑等。越剧早期以全女班为主，小生多由女性反串。"),
        ("越剧有多少个流派？",
         "越剧有十三大流派，包括袁派（袁雪芬）、尹派（尹桂芳）、徐派（徐玉兰）、范派（范瑞娟）、傅派（傅全香）、戚派（戚雅仙）、王派（王文娟）、张派（张云霞）、吕派（吕瑞英）、金派（金采风）、毕派（毕春芳）、张派（张桂凤）、陆派（陆锦花）。各流派在唱腔、表演、剧目上各有特色。"),
        ("越剧的发源地是哪里？",
         "越剧发源于浙江省嵊县（今嵊州市），1906年由当地民间说唱艺术「落地唱书」演变而来。最初称为「小歌班」或「的笃班」，1925年首次在上海《申报》上被称为「越剧」。"),
        ("越剧和京剧有什么区别？",
         "越剧与京剧的区别主要体现在：1）发源地不同：越剧源自浙江嵊县，京剧源自北京；2）唱腔不同：越剧柔婉细腻，京剧高亢激昂；3）行当不同：越剧以生旦为主，早期全女班，京剧生旦净丑齐全；4）语言不同：越剧使用嵊州方言为基础的中州韵，京剧使用湖广音中州韵；5）伴奏不同：越剧以二胡为主弦，京剧以京胡为主弦。"),
        ("越剧《红楼梦》有什么艺术成就？",
         "越剧《红楼梦》是徐派和王派的巅峰之作，1958年由上海越剧院首演，徐玉兰饰贾宝玉、王文娟饰林黛玉。该剧将百万字小说浓缩为3小时舞台演出，唱词优美、表演细腻，特别是「宝玉哭灵」「黛玉焚稿」等折子戏广为流传。1962年拍摄的电影版影响深远，是中国戏曲电影的经典之作。"),
    ]
    for q, a in commons:
        add(q, a)
    print(f"[常识] 生成 {len(commons)} 条")


# ============ 主流程 ============
if __name__ == "__main__":
    print("=" * 60)
    print("越剧微调数据集生成")
    print("=" * 60)

    gen_school_qa()
    gen_play_qa()
    gen_kg_qa()
    gen_dadian_qa()
    gen_common_qa()

    # 去重
    seen = set()
    unique = []
    for item in DATASET:
        key = item["conversations"][0]["content"][:50]
        if key not in seen:
            seen.add(key)
            unique.append(item)

    # 保存
    os.makedirs(os.path.dirname(OUT_PATH), exist_ok=True)
    with open(OUT_PATH, "w", encoding="utf-8") as f:
        json.dump(unique, f, ensure_ascii=False, indent=2)

    print("=" * 60)
    print(f"✓ 共生成 {len(unique)} 条样本（去重前 {len(DATASET)} 条）")
    print(f"✓ 输出到: {OUT_PATH}")
    print("=" * 60)
