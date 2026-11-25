"""
将 sharegpt 格式转换为讯飞星火大模型定制训练平台格式
输入: finetune/data/yueju_train.json (sharegpt)
输出: finetune/data/yueju_xinghuo.json (讯飞格式)
      finetune/data/yueju_xinghuo.xlsx (Excel 格式，讯飞平台也支持)
"""
import json
import os
import sys

# 安装 openpyxl: pip install openpyxl
try:
    from openpyxl import Workbook
except ImportError:
    print("[警告] 未安装 openpyxl，将跳过 Excel 生成")
    print("       安装: pip install openpyxl")
    Workbook = None

IN_PATH = r"d:\实验室项目\越韵智传完整demo\finetune\data\yueju_train.json"
OUT_JSON = r"d:\实验室项目\越韵智传完整demo\finetune\data\yueju_xinghuo.json"
OUT_XLSX = r"d:\实验室项目\越韵智传完整demo\finetune\data\yueju_xinghuo.xlsx"


def sharegpt_to_xinghuo_json(items):
    """
    讯飞平台 JSON 格式（标准单轮问答）:
    [
      {"prompt": "问题", "response": "答案"},
      ...
    ]

    多轮对话格式（如有需要）:
    [
      {"messages": [
        {"role": "user", "content": "..."},
        {"role": "assistant", "content": "..."}
      ]},
      ...
    ]
    """
    out = []
    for item in items:
        convs = item.get("conversations", [])
        if len(convs) < 2:
            continue
        # 单轮问答格式（讯飞最常见）
        user_msg = convs[0].get("content", "").strip()
        asst_msg = convs[1].get("content", "").strip()
        if not user_msg or not asst_msg:
            continue
        out.append({
            "prompt": user_msg,
            "response": asst_msg
        })
    return out


def write_xlsx(items, path):
    """生成 Excel 格式（讯飞平台支持上传 .xlsx）"""
    if not Workbook:
        return False
    wb = Workbook()
    ws = wb.active
    ws.title = "train"
    # 表头
    ws.append(["prompt", "response"])
    for item in items:
        ws.append([item["prompt"], item["response"]])
    wb.save(path)
    return True


def main():
    if not os.path.exists(IN_PATH):
        print(f"输入文件不存在: {IN_PATH}")
        print("请先运行: python finetune/scripts/prepare_data.py")
        sys.exit(1)

    with open(IN_PATH, "r", encoding="utf-8") as f:
        sharegpt_data = json.load(f)

    print(f"读取 sharegpt 数据: {len(sharegpt_data)} 条")

    xinghuo_data = sharegpt_to_xinghuo_json(sharegpt_data)
    print(f"转换为讯飞格式: {len(xinghuo_data)} 条")

    # 保存 JSON
    os.makedirs(os.path.dirname(OUT_JSON), exist_ok=True)
    with open(OUT_JSON, "w", encoding="utf-8") as f:
        json.dump(xinghuo_data, f, ensure_ascii=False, indent=2)
    print(f"✓ JSON 输出: {OUT_JSON} ({os.path.getsize(OUT_JSON)/1024:.1f} KB)")

    # 保存 Excel
    if write_xlsx(xinghuo_data, OUT_XLSX):
        print(f"✓ Excel 输出: {OUT_XLSX} ({os.path.getsize(OUT_XLSX)/1024:.1f} KB)")
        print("\n上传到讯飞平台时优先选 Excel，兼容性最好")

    # 打印前 2 条预览
    print("\n" + "=" * 60)
    print("前 2 条样本预览:")
    print("=" * 60)
    for i, item in enumerate(xinghuo_data[:2]):
        print(f"\n--- 样本 {i+1} ---")
        print(f"prompt:   {item['prompt'][:80]}")
        print(f"response: {item['response'][:200]}...")


if __name__ == "__main__":
    main()
