# 微调前 vs 微调后 准确率对比评测
# 加载"微调前"基座模型（Qwen2.5-0.5B-Instruct，不带 LoRA），对固定越剧 QA 集打分
# 微调后结果由 eval_rag_ab.js（调用 3456 HTTP 服务）提供，两者使用相同的 prompt 与打分逻辑
# 用法: python models/yueju_asr_correct/eval_finetune_pre.py
import os, sys, json
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from inference import load_model, answer_question

# 与 eval_rag_ab.js 完全一致的评测集与打分逻辑
QA = [
  {"q": '越剧发源于哪个省份的哪个县？', "points": ['浙江', '嵊']},
  {"q": '越剧早期"小歌班"是哪一年形成的？', "points": ['1906']},
  {"q": '越剧的原始唱书形式叫什么？', "points": ['落地唱书']},
  {"q": '越剧1916年进入上海时称为什么？', "points": ['绍兴文戏']},
  {"q": '越剧是哪一年列入国家级非物质文化遗产名录的？', "points": ['2006']},
  {"q": '越剧列入非遗时属于什么类别？', "points": ['传统戏剧']},
  {"q": '越剧的主要唱腔体系包括哪些？', "points": ['四工', '尺调', '弦下']},
  {"q": '袁派是由谁创立的？', "points": ['袁雪芬']},
  {"q": '尹派是由谁创立的？', "points": ['尹桂芳']},
  {"q": '徐派是由谁创立的？', "points": ['徐玉兰']},
  {"q": '越剧的主要行当有哪些？', "points": ['小生', '花旦']},
  {"q": '浙江小百花越剧团是哪一年成立的？', "points": ['1984']},
]

def score(answer, points):
    hits = [p for p in points if p in answer]
    return hits, len(points)

def main():
    # 微调前 = 基座模型本身（不带 LoRA）
    base = "Qwen/Qwen2.5-0.5B-Instruct"
    print(f"加载微调前基座模型: {base}")
    model, tokenizer, device = load_model(base)
    print(f"加载完成，设备: {device}\n")

    total_hits = 0
    total_pts = 0
    for item in QA:
        q, points = item["q"], item["points"]
        ans = answer_question(model, tokenizer, device, q, max_new_tokens=256)
        hits, n = score(ans, points)
        total_hits += len(hits)
        total_pts += n
        print(f"▸ {q}")
        print(f"  微调前: {ans.replace(chr(10),' ').strip()[:80]}")
        print(f"  命中 {len(hits)}/{n} | 命中点: {hits}\n")

    print("========================================")
    print(f"[微调前] 平均事实命中率: {total_hits}/{total_pts} = {total_hits/total_pts*100:.1f}%")
    print("========================================")

if __name__ == "__main__":
    main()