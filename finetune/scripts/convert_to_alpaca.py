"""
将 sharegpt 格式转换为 Alpaca 格式，输出单个 xlsx 文件
格式要求：
  - instruction: 人类指令（必填）
  - input: 人类输入（选填，这里留空）
  - output: 模型回答（必填）
  - system: 系统提示词（选填）
  - history: 历史对话（选填，这里留空）

输入: finetune/data/yueju_train.json (sharegpt)
输出: finetune/data/yueju_alpaca.xlsx
"""
import json
import os
import sys

try:
    from openpyxl import Workbook
except ImportError:
    print("[错误] 未安装 openpyxl，请先运行: pip install openpyxl")
    sys.exit(1)

IN_PATH = r"d:\实验室项目\越韵智传完整demo\finetune\data\yueju_train.json"
OUT_XLSX = r"d:\实验室项目\越韵智传完整demo\finetune\data\yueju_alpaca.xlsx"

# 越剧垂类大模型系统提示词
SYSTEM_PROMPT = """你是「越韵智传」越剧教学辅助系统的专业问答助手，精通越剧历史、流派、剧目、行当、唱腔、表演、名伶及非遗文化。
回答要求：
1. 用专业且易懂的中文作答，内容准确、结构清晰。
2. 涉及典籍、剧目、流派、名段时，在相关内容后用【出处：《剧目名》/流派/典籍名】的形式标注来源，便于学者查证。
3. 若问题超出越剧范畴，礼貌引导回越剧话题。
4. 对于流派（如袁派、尹派、范派、傅派、徐派、戚派等）需准确区分其代表人物与唱腔特点。
5. 回答控制在合理篇幅，重点突出。"""


def main():
    if not os.path.exists(IN_PATH):
        print(f"输入文件不存在: {IN_PATH}")
        print("请先运行: python finetune/scripts/prepare_data.py")
        sys.exit(1)

    with open(IN_PATH, "r", encoding="utf-8") as f:
        sharegpt_data = json.load(f)

    print(f"读取 sharegpt 数据: {len(sharegpt_data)} 条")

    wb = Workbook()
    ws = wb.active
    ws.title = "train"
    # 表头
    ws.append(["instruction", "input", "output", "system", "history"])

    count = 0
    for item in sharegpt_data:
        convs = item.get("conversations", [])
        if len(convs) < 2:
            continue
        instruction = convs[0].get("content", "").strip()
        output = convs[1].get("content", "").strip()
        if not instruction or not output:
            continue
        ws.append([instruction, "", output, SYSTEM_PROMPT, ""])
        count += 1

    os.makedirs(os.path.dirname(OUT_XLSX), exist_ok=True)
    wb.save(OUT_XLSX)
    print(f"✓ 共转换 {count} 条样本")
    print(f"✓ 输出: {OUT_XLSX}")
    print(f"✓ 文件大小: {os.path.getsize(OUT_XLSX)/1024:.1f} KB")

    # 预览前 2 条
    print("\n" + "=" * 60)
    print("前 2 条样本预览:")
    print("=" * 60)
    for i, item in enumerate(sharegpt_data[:2]):
        print(f"\n--- 样本 {i+1} ---")
        print(f"instruction: {item['conversations'][0]['content'][:80]}")
        print(f"output:      {item['conversations'][1]['content'][:200]}...")


if __name__ == "__main__":
    main()
