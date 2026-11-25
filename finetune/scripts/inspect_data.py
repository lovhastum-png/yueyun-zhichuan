"""
越剧微调数据集信息（生成后查看用）
"""
import json
import os

DATA_PATH = r"d:\实验室项目\越韵智传完整demo\finetune\data\yueju_train.json"

if not os.path.exists(DATA_PATH):
    print(f"数据集未生成: {DATA_PATH}")
    print("请先运行: python finetune/scripts/prepare_data.py")
    exit(1)

with open(DATA_PATH, "r", encoding="utf-8") as f:
    data = json.load(f)

print(f"样本总数: {len(data)}")
print(f"文件大小: {os.path.getsize(DATA_PATH)/1024:.1f} KB")
print()

# 统计长度
user_lens = [len(item["conversations"][0]["content"]) for item in data]
asst_lens = [len(item["conversations"][1]["content"]) for item in data]
print(f"用户输入长度: 最短{min(user_lens)} / 最长{max(user_lens)} / 平均{sum(user_lens)//len(user_lens)}")
print(f"回答长度: 最短{min(asst_lens)} / 最长{max(asst_lens)} / 平均{sum(asst_lens)//len(asst_lens)}")
print()

# 展示前 3 条样本
print("=" * 60)
print("前 3 条样本预览:")
print("=" * 60)
for i, item in enumerate(data[:3]):
    print(f"\n--- 样本 {i+1} ---")
    print(f"Q: {item['conversations'][0]['content'][:100]}")
    print(f"A: {item['conversations'][1]['content'][:200]}...")
