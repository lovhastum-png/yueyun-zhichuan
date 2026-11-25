"""
越剧知识问答小模型微调脚本
使用 Qwen2.5-Instruct + LoRA + 4-bit 量化，在本地 GPU/CPU 上训练
数据来源：越韵智传-Alpaca微调数据集 + 拒答样本
"""
import os
import json
import argparse
import torch
from datasets import Dataset
from transformers import (
    AutoModelForCausalLM,
    AutoTokenizer,
    TrainingArguments,
    DataCollatorForSeq2Seq,
    BitsAndBytesConfig,
)
from peft import LoraConfig, get_peft_model, TaskType, prepare_model_for_kbit_training

# 默认参数
DEFAULT_MODEL = "Qwen/Qwen2.5-0.5B-Instruct"
DATA_PATH = os.path.join(os.path.dirname(__file__), "data", "train.json")
OUTPUT_DIR = os.path.join(os.path.dirname(__file__), "outputs")

# 默认系统提示词（与 yuejuLlm.js / convert_xlsx_to_json.py 保持一致）
DEFAULT_SYSTEM_PROMPT = "你是「越韵智传」越剧教学辅助系统的专业问答助手，精通越剧历史、流派、剧目、行当、唱腔、表演、名伶及非遗文化。回答专业、准确、结构清晰，超出越剧范畴的问题礼貌引导回越剧话题。"


def build_prompt(instruction: str, input_text: str, system_prompt: str = DEFAULT_SYSTEM_PROMPT) -> str:
    """构造 Qwen2.5-Instruct 的对话格式 prompt（越剧知识问答）"""
    user_content = instruction if not input_text else f"{instruction}\n\n{input_text}"
    return (
        f"<|im_start|>system\n{system_prompt}<|im_end|>\n"
        f"<|im_start|>user\n{user_content}<|im_end|>\n"
        "<|im_start|>assistant\n"
    )


def load_data(path: str):
    with open(path, "r", encoding="utf-8") as f:
        raw = json.load(f)
    examples = []
    for item in raw:
        system = item.get("system") or DEFAULT_SYSTEM_PROMPT
        prompt = build_prompt(item["instruction"], item.get("input", ""), system)
        response = item["output"]
        examples.append({"prompt": prompt, "response": response})
    return Dataset.from_list(examples)


def tokenize_function(examples, tokenizer, max_length=512):
    """将 prompt + response 编码，只对 response 部分计算 loss"""
    prompts = examples["prompt"]
    responses = examples["response"]

    prompt_tokens = tokenizer(
        prompts,
        add_special_tokens=False,
        truncation=False,
    )
    full_texts = [p + r + tokenizer.eos_token for p, r in zip(prompts, responses)]
    full_tokens = tokenizer(
        full_texts,
        max_length=max_length,
        truncation=True,
        padding="max_length",
    )

    labels = []
    for i in range(len(prompts)):
        prompt_len = len(prompt_tokens["input_ids"][i])
        full_label = full_tokens["input_ids"][i].copy()
        for j in range(min(prompt_len, len(full_label))):
            full_label[j] = -100
        labels.append(full_label)

    full_tokens["labels"] = labels
    return full_tokens


def main():
    parser = argparse.ArgumentParser(description="微调越剧知识问答模型")
    parser.add_argument("--model", type=str, default=DEFAULT_MODEL, help="基座模型名称或路径")
    parser.add_argument("--data", type=str, default=DATA_PATH, help="训练数据路径")
    parser.add_argument("--output_dir", type=str, default=OUTPUT_DIR, help="输出目录")
    parser.add_argument("--epochs", type=int, default=6, help="训练轮数")
    parser.add_argument("--batch_size", type=int, default=1, help="训练 batch size")
    parser.add_argument("--lr", type=float, default=2e-4, help="学习率")
    parser.add_argument("--lora_r", type=int, default=16, help="LoRA rank")
    parser.add_argument("--lora_alpha", type=int, default=32, help="LoRA alpha")
    parser.add_argument("--max_length", type=int, default=768, help="最大序列长度（问答回答较长）")
    parser.add_argument("--device", type=str, default="auto", help="cuda/cpu/auto")
    parser.add_argument("--use_4bit", action="store_true", help="使用 4-bit 量化（推荐 3B 以上模型）")
    args = parser.parse_args()

    if args.device == "auto":
        device = "cuda" if torch.cuda.is_available() else "cpu"
    else:
        device = args.device
    print(f"使用设备: {device}")
    if device == "cuda":
        print(f"GPU: {torch.cuda.get_device_name(0)}")
        print(f"可用显存: {torch.cuda.get_device_properties(0).total_memory / 1024**3:.1f} GB")

    # 4-bit 量化配置（GPU + 大模型时自动启用，除非显存 >= 8GB）
    use_4bit = args.use_4bit
    if device == "cuda" and not use_4bit:
        total_vram = torch.cuda.get_device_properties(0).total_memory / 1024**3
        if total_vram < 8:
            print(f"检测到显存 {total_vram:.1f}GB < 8GB，自动启用 4-bit 量化")
            use_4bit = True

    print(f"加载模型: {args.model}")
    tokenizer = AutoTokenizer.from_pretrained(args.model, trust_remote_code=True)
    if tokenizer.pad_token is None:
        tokenizer.pad_token = tokenizer.eos_token
        tokenizer.pad_token_id = tokenizer.eos_token_id

    load_kwargs = {
        "trust_remote_code": True,
        "device_map": "auto" if device == "cuda" else None,
        "low_cpu_mem_usage": True,
    }
    if use_4bit:
        load_kwargs["quantization_config"] = BitsAndBytesConfig(
            load_in_4bit=True,
            bnb_4bit_compute_dtype=torch.float16,
            bnb_4bit_use_double_quant=True,
            bnb_4bit_quant_type="nf4",
        )
        load_kwargs["torch_dtype"] = torch.float16
    else:
        load_kwargs["torch_dtype"] = torch.float16 if device == "cuda" else torch.float32

    model = AutoModelForCausalLM.from_pretrained(args.model, **load_kwargs)
    if use_4bit:
        model = prepare_model_for_kbit_training(model)
        model.gradient_checkpointing_enable()
    if device == "cpu":
        model = model.to("cpu")

    # LoRA 配置
    lora_config = LoraConfig(
        task_type=TaskType.CAUSAL_LM,
        r=args.lora_r,
        lora_alpha=args.lora_alpha,
        lora_dropout=0.05,
        bias="none",
        target_modules=["q_proj", "k_proj", "v_proj", "o_proj", "gate_proj", "up_proj", "down_proj"],
    )
    model = get_peft_model(model, lora_config)
    model.print_trainable_parameters()

    dataset = load_data(args.data)
    print(f"训练样本数: {len(dataset)}")

    tokenized_dataset = dataset.map(
        lambda x: tokenize_function(x, tokenizer, args.max_length),
        batched=True,
        remove_columns=dataset.column_names,
    )

    # 训练参数
    training_args = TrainingArguments(
        output_dir=args.output_dir,
        num_train_epochs=args.epochs,
        per_device_train_batch_size=args.batch_size,
        gradient_accumulation_steps=4,
        learning_rate=args.lr,
        warmup_steps=10,
        logging_steps=5,
        save_strategy="epoch",
        save_total_limit=2,
        fp16=device == "cuda" and not use_4bit,
        bf16=False,
        optim="paged_adamw_8bit" if use_4bit else "adamw_torch",
        report_to="none",
        remove_unused_columns=False,
        dataloader_pin_memory=device == "cuda",
    )

    data_collator = DataCollatorForSeq2Seq(
        tokenizer,
        model=model,
        label_pad_token_id=-100,
        padding=True,
    )

    trainer = Trainer(
        model=model,
        args=training_args,
        train_dataset=tokenized_dataset,
        data_collator=data_collator,
    )

    trainer.train()

    # 保存 LoRA adapter（不合并，避免 3B 模型占用过大显存）
    adapter_dir = os.path.join(args.output_dir, "adapter")
    model.save_pretrained(adapter_dir)
    tokenizer.save_pretrained(adapter_dir)
    # 记录基座模型名称，方便推理时加载
    with open(os.path.join(adapter_dir, "base_model.txt"), "w", encoding="utf-8") as f:
        f.write(args.model)
    print(f"LoRA adapter 已保存到: {adapter_dir}")
    if use_4bit:
        print("注意：使用了 4-bit 量化，未保存合并后的完整模型。推理时请用 serve.py 加载 adapter。")


if __name__ == "__main__":
    try:
        from transformers import Trainer
    except ImportError:
        from transformers.trainer import Trainer
    main()
