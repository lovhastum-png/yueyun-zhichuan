"""
越剧知识问答模型推理脚本
支持两种模式：
1. 合并后的完整模型（models/yueju_asr_correct/outputs/merged）
2. LoRA adapter（models/yueju_asr_correct/outputs/adapter），自动读取 base_model.txt 加载基座模型
"""
import os
import argparse
import torch
from transformers import AutoModelForCausalLM, AutoTokenizer, BitsAndBytesConfig
from peft import PeftModel

DEFAULT_MERGED = os.path.join(os.path.dirname(__file__), "outputs", "merged")
DEFAULT_ADAPTER = os.path.join(os.path.dirname(__file__), "outputs", "adapter")

DEFAULT_SYSTEM_PROMPT = "你是「越韵智传」越剧教学辅助系统的专业问答助手，精通越剧历史、流派、剧目、行当、唱腔、表演、名伶及非遗文化。回答专业、准确、结构清晰，超出越剧范畴的问题礼貌引导回越剧话题。"


def find_model_path():
    """自动寻找可用模型：优先 merged，其次 adapter"""
    if os.path.exists(os.path.join(DEFAULT_MERGED, "config.json")):
        return DEFAULT_MERGED, "merged"
    if os.path.exists(os.path.join(DEFAULT_ADAPTER, "adapter_config.json")):
        return DEFAULT_ADAPTER, "adapter"
    return None, None


def load_model(model_path: str = None, use_4bit: bool = None, use_fp16: bool = False):
    if model_path is None:
        model_path, mode = find_model_path()
        if model_path is None:
            raise FileNotFoundError("未找到训练好的模型，请先运行 train.py")
        print(f"自动使用模型: {model_path} ({mode})")
    else:
        mode = "adapter" if os.path.exists(os.path.join(model_path, "adapter_config.json")) else "merged"

    device = "cuda" if torch.cuda.is_available() else "cpu"
    print(f"使用设备: {device}")

    tokenizer = AutoTokenizer.from_pretrained(model_path, trust_remote_code=True)
    if tokenizer.pad_token is None:
        tokenizer.pad_token = tokenizer.eos_token
        tokenizer.pad_token_id = tokenizer.eos_token_id

    load_kwargs = {
        "trust_remote_code": True,
        "device_map": "auto" if device == "cuda" else None,
        "low_cpu_mem_usage": True,
    }

    # 自动判断是否需要 4-bit：adapter 模式默认 4-bit， merged 模式看显存
    if use_4bit is None:
        if mode == "adapter":
            use_4bit = True
        elif device == "cuda":
            total_vram = torch.cuda.get_device_properties(0).total_memory / 1024**3
            use_4bit = total_vram < 8
        else:
            use_4bit = False

    if use_4bit and device == "cuda":
        print("使用 4-bit 量化加载")
        load_kwargs["quantization_config"] = BitsAndBytesConfig(
            load_in_4bit=True,
            bnb_4bit_compute_dtype=torch.float16,
            bnb_4bit_use_double_quant=True,
            bnb_4bit_quant_type="nf4",
        )
        load_kwargs["torch_dtype"] = torch.float16
    elif use_fp16:
        # 低内存模式（适合 4G 内存服务器）：fp16 半精度加载，权重内存减半
        print("使用 fp16 半精度加载（低内存模式）")
        load_kwargs["torch_dtype"] = torch.float16
    else:
        load_kwargs["torch_dtype"] = torch.float16 if device == "cuda" else torch.float32

    if mode == "adapter":
        # 读取基座模型名称
        base_model_file = os.path.join(model_path, "base_model.txt")
        if os.path.exists(base_model_file):
            with open(base_model_file, "r", encoding="utf-8") as f:
                base_model = f.read().strip()
        else:
            raise FileNotFoundError(f"未找到 {base_model_file}，无法确定基座模型")
        print(f"加载基座模型: {base_model}")
        base = AutoModelForCausalLM.from_pretrained(base_model, **load_kwargs)
        model = PeftModel.from_pretrained(base, model_path)
    else:
        model = AutoModelForCausalLM.from_pretrained(model_path, **load_kwargs)

    if device == "cpu":
        model = model.to("cpu")
    model.eval()
    return model, tokenizer, device


def build_prompt(question: str, system_prompt: str = DEFAULT_SYSTEM_PROMPT) -> str:
    """构造越剧知识问答 prompt"""
    return (
        f"<|im_start|>system\n{system_prompt}<|im_end|>\n"
        f"<|im_start|>user\n{question}<|im_end|>\n"
        "<|im_start|>assistant\n"
    )


def answer_question(model, tokenizer, device, question: str, max_new_tokens: int = 512, system_prompt: str = None) -> str:
    """对用户问题生成越剧专业回答"""
    prompt = build_prompt(question, system_prompt or DEFAULT_SYSTEM_PROMPT)
    inputs = tokenizer(prompt, return_tensors="pt").to(device)

    with torch.no_grad():
        outputs = model.generate(
            **inputs,
            max_new_tokens=max_new_tokens,
            do_sample=False,
            temperature=0.7,
            top_p=0.9,
            eos_token_id=tokenizer.eos_token_id,
            pad_token_id=tokenizer.pad_token_id,
        )

    generated = tokenizer.decode(outputs[0], skip_special_tokens=False)
    assistant_marker = "<|im_start|>assistant\n"
    if assistant_marker in generated:
        result = generated.split(assistant_marker)[-1]
    else:
        result = generated[len(prompt):]
    result = result.replace(tokenizer.eos_token, "").replace("<|im_end|>", "").strip()
    return result


def main():
    parser = argparse.ArgumentParser(description="越剧知识问答推理")
    parser.add_argument("--model", type=str, default=None, help="模型路径（adapter 或 merged）")
    parser.add_argument("--text", type=str, default=None, help="要提问的问题")
    parser.add_argument("--interactive", action="store_true", help="交互式测试")
    parser.add_argument("--use_4bit", action="store_true", help="强制使用 4-bit 量化")
    args = parser.parse_args()

    print("加载模型...")
    model, tokenizer, device = load_model(args.model, use_4bit=args.use_4bit)

    if args.text:
        result = answer_question(model, tokenizer, device, args.text)
        print("问题:", args.text)
        print("回答:", result)
        return

    print("\n示例测试:")
    test_cases = [
        "请介绍越剧袁派的艺术特色和代表人物。",
        "《梁山伯与祝英台》的剧情梗概是什么？",
        "越剧有哪些主要行当？",
        "如何做红烧肉？",  # 测试拒答
    ]
    for case in test_cases:
        result = answer_question(model, tokenizer, device, case)
        print(f"  问题: {case}")
        print(f"  回答: {result}\n")

    while args.interactive:
        user_input = input("请输入问题: ").strip()
        if user_input.lower() in ("quit", "exit", "q"):
            break
        result = answer_question(model, tokenizer, device, user_input)
        print(f"回答: {result}\n")


if __name__ == "__main__":
    main()
