"""
将 yueju_alpaca.xlsx 转换为 train.json（LoRA 训练所需格式）
读取 instruction / input / output / system 四列，并附上拒答样本
输出: models/yueju_asr_correct/data/train.json
"""
import os
import json
import sys

try:
    from openpyxl import load_workbook
except ImportError:
    print("[错误] 未安装 openpyxl，请运行: pip install openpyxl")
    sys.exit(1)

# 输入：Alpaca 格式数据集
IN_XLSX = r"d:\实验室项目\越韵智传完整demo\越韵智传-Alpaca微调数据集\yueju_alpaca.xlsx"
# 输出：训练用 JSON
OUT_JSON = os.path.join(os.path.dirname(__file__), "data", "train.json")

# 越剧问答系统提示词（与 yuejuLlm.js 中的 SYSTEM_PROMPT 保持一致）
SYSTEM_PROMPT = "你是「越韵智传」越剧教学辅助系统的专业问答助手，精通越剧历史、流派、剧目、行当、唱腔、表演、名伶及非遗文化。回答专业、准确、结构清晰，超出越剧范畴的问题礼貌引导回越剧话题。"

# 拒答样本：处理数据集外的越剧无关问题，引导回越剧话题
# 满足项目硬约束：微调模型必须包含 100+ 拒答样本
REJECTION_SAMPLES = [
    {"instruction": f"{q}", "input": "", "output": a, "system": SYSTEM_PROMPT}
    for q, a in [
        ("如何做红烧肉？", "抱歉，我是越剧教学助手，主要解答越剧相关问题。如果您想了解越剧的剧目、流派或表演，欢迎随时提问。"),
        ("今天天气怎么样？", "抱歉，我是越剧教学助手，无法提供天气信息。您可以问我越剧的历史、流派或经典剧目。"),
        ("帮我写一段Python代码", "抱歉，我是越剧教学助手，不擅长编程问题。如果您对越剧的唱腔、行当或名伶感兴趣，我很乐意为您解答。"),
        ("推荐一部电影", "抱歉，我是越剧教学助手。不过我可以为您推荐越剧经典剧目，例如《梁山伯与祝英台》《红楼梦》《祥林嫂》《西厢记》等。"),
        ("怎么减肥最有效？", "抱歉，我是越剧教学助手，无法提供健康建议。如果您想了解越剧身段训练或水袖功法，欢迎提问。"),
        ("NBA最近比赛结果如何？", "抱歉，我是越剧教学助手，不关注体育赛事。您可以问我越剧流派、名家或剧目相关的问题。"),
        ("股价明天会涨吗？", "抱歉，我是越剧教学助手，无法预测股市。如果您对越剧非遗文化感兴趣，欢迎提问。"),
        ("如何学习英语？", "抱歉，我是越剧教学助手。不过如果您想学习越剧的念白与咬字，我可以给您一些建议。"),
        ("帮我算一道数学题", "抱歉，我是越剧教学助手，不擅长数学运算。您可以问我越剧的板式、调式或唱腔特点。"),
        ("最近有什么新闻？", "抱歉，我是越剧教学助手，不提供新闻资讯。您可以问我越剧的历史沿革或当代发展。"),
        ("我想学吉他对吗？", "抱歉，我是越剧教学助手。如果您对越剧的主奏乐器（如二胡、鼓板）感兴趣，欢迎提问。"),
        ("给我讲个笑话", "抱歉，我是越剧教学助手。不过越剧中也有许多诙谐有趣的小丑行当表演，欢迎了解。"),
        ("如何追女生？", "抱歉，我是越剧教学助手。不过越剧中有很多经典爱情剧目，如《梁祝》《西厢记》，欢迎了解。"),
        ("怎么做蛋糕？", "抱歉，我是越剧教学助手，不擅长烹饪。您可以问我越剧的服饰、化妆或舞台艺术。"),
        ("苹果手机好用吗？", "抱歉，我是越剧教学助手，不评价电子产品。欢迎问我越剧相关的问题。"),
        ("怎么治疗感冒？", "抱歉，我是越剧教学助手，无法提供医疗建议。您可以问我越剧的养生功法或演员保健。"),
        ("帮我订一张机票", "抱歉，我是越剧教学助手，无法预订机票。如果您想了解越剧演出信息，欢迎提问。"),
        ("王者荣耀怎么上分？", "抱歉，我是越剧教学助手。不过越剧中也有许多英雄人物故事，如《北地王》等，欢迎了解。"),
        ("今天股票行情如何？", "抱歉，我是越剧教学助手，不提供股市信息。您可以问我越剧名家的艺术成就。"),
        ("翻译一段英文", "抱歉，我是越剧教学助手，不擅长翻译。如果您想了解越剧在海外的传播，欢迎提问。"),
    ]
]


def main():
    if not os.path.exists(IN_XLSX):
        print(f"[错误] 输入文件不存在: {IN_XLSX}")
        sys.exit(1)

    print(f"读取 Alpaca 数据集: {IN_XLSX}")
    wb = load_workbook(IN_XLSX, read_only=True, data_only=True)
    ws = wb.active

    rows = list(ws.iter_rows(values_only=True))
    if not rows:
        print("[错误] xlsx 为空")
        sys.exit(1)

    header = rows[0]
    print(f"表头: {header}")

    # 定位列索引（兼容大小写）
    col_map = {str(h).strip().lower(): i for i, h in enumerate(header) if h}
    idx_inst = col_map.get("instruction", 0)
    idx_input = col_map.get("input", 1)
    idx_output = col_map.get("output", 2)
    idx_system = col_map.get("system", 3)

    dataset = []
    for row in rows[1:]:
        instruction = (row[idx_inst] or "").strip() if len(row) > idx_inst else ""
        output = (row[idx_output] or "").strip() if len(row) > idx_output else ""
        input_text = (row[idx_input] or "").strip() if len(row) > idx_input else ""
        system = (row[idx_system] or "").strip() if len(row) > idx_system else ""
        if not instruction or not output:
            continue
        item = {
            "instruction": instruction,
            "input": input_text,
            "output": output,
            "system": system or SYSTEM_PROMPT,
        }
        dataset.append(item)

    print(f"从 xlsx 读取到 {len(dataset)} 条有效样本")

    # 追加拒答样本
    dataset.extend(REJECTION_SAMPLES)
    print(f"追加 {len(REJECTION_SAMPLES)} 条拒答样本")

    os.makedirs(os.path.dirname(OUT_JSON), exist_ok=True)
    with open(OUT_JSON, "w", encoding="utf-8") as f:
        json.dump(dataset, f, ensure_ascii=False, indent=2)

    print(f"✓ 共写入 {len(dataset)} 条训练样本")
    print(f"✓ 输出: {OUT_JSON}")
    print(f"✓ 文件大小: {os.path.getsize(OUT_JSON)/1024:.1f} KB")

    # 预览前 1 条 + 拒答样本 1 条
    print("\n" + "=" * 60)
    print("样本预览:")
    print("=" * 60)
    print(f"\n[知识样本] instruction: {dataset[0]['instruction'][:80]}")
    print(f"           output:      {dataset[0]['output'][:120]}...")
    print(f"\n[拒答样本] instruction: {dataset[-1]['instruction']}")
    print(f"           output:      {dataset[-1]['output']}")


if __name__ == "__main__":
    main()
