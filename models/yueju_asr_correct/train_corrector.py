"""Qwen2.5-0.5B 越剧术语纠错 LoRA 微调脚本。"""

from __future__ import annotations

import argparse
import json
import os
from pathlib import Path

import torch
from datasets import Dataset
from peft import LoraConfig, PeftModel, TaskType, get_peft_model, prepare_model_for_kbit_training
from transformers import (
    AutoModelForCausalLM,
    AutoTokenizer,
    BitsAndBytesConfig,
    Trainer,
    TrainingArguments,
    default_data_collator,
)


ROOT = Path(__file__).resolve().parent
DEFAULT_MODEL = "Qwen/Qwen2.5-0.5B-Instruct"
DEFAULT_DATA = ROOT / "data" / "correction_train.json"
DEFAULT_OUTPUT = ROOT / "outputs" / "corrector"
SYSTEM_PROMPT = (
    "你是越剧语音识别文本纠错助手。只纠正越剧专有名词、同音字、错别字和明显的断句错误，"
    "不得改写原意，不得补充原文没有的信息。只输出纠正后的完整文本。"
)


def build_prompt(instruction: str, input_text: str, system: str) -> str:
    user_content = f"{instruction}\n\n{input_text}" if input_text else instruction
    return (
        f"<|im_start|>system\n{system}<|im_end|>\n"
        f"<|im_start|>user\n{user_content}<|im_end|>\n"
        "<|im_start|>assistant\n"
    )


def load_data(path: Path) -> Dataset:
    raw = json.loads(path.read_text(encoding="utf-8"))
    examples = []
    for item in raw:
        examples.append({
            "prompt": build_prompt(item["instruction"], item.get("input", ""), item.get("system") or SYSTEM_PROMPT),
            "response": item["output"],
        })
    return Dataset.from_list(examples)


def tokenize_batch(examples, tokenizer, max_length: int):
    prompts = examples["prompt"]
    responses = examples["response"]
    prompt_tokens = tokenizer(prompts, add_special_tokens=False, truncation=False)
    full_texts = [prompt + response + "<|im_end|>" for prompt, response in zip(prompts, responses)]
    encoded = tokenizer(full_texts, max_length=max_length, truncation=True, padding="max_length")

    labels = []
    for index, input_ids in enumerate(encoded["input_ids"]):
        prompt_length = min(len(prompt_tokens["input_ids"][index]), len(input_ids))
        label = input_ids.copy()
        label[:prompt_length] = [-100] * prompt_length
        label = [
            token if mask else -100
            for token, mask in zip(label, encoded["attention_mask"][index])
        ]
        labels.append(label)
    encoded["labels"] = labels
    return encoded


def main() -> None:
    parser = argparse.ArgumentParser(description="微调 Qwen2.5-0.5B 越剧术语纠错模型")
    parser.add_argument("--model", default=DEFAULT_MODEL)
    parser.add_argument("--data", type=Path, default=DEFAULT_DATA)
    parser.add_argument("--output_dir", type=Path, default=DEFAULT_OUTPUT)
    parser.add_argument("--adapter", type=Path, default=None, help="从已有纠错 LoRA adapter 继续训练")
    parser.add_argument("--epochs", type=int, default=4)
    parser.add_argument("--batch_size", type=int, default=2)
    parser.add_argument("--gradient_accumulation", type=int, default=8)
    parser.add_argument("--max_length", type=int, default=192)
    parser.add_argument("--learning_rate", type=float, default=1e-4)
    parser.add_argument("--allow_download", action="store_true")
    args = parser.parse_args()

    if not args.data.exists():
        raise FileNotFoundError(f"训练数据不存在: {args.data}，请先运行 prepare_correction_data.py")

    device = "cuda" if torch.cuda.is_available() else "cpu"
    use_4bit = device == "cuda"
    print(f"设备: {device}")
    if device == "cuda":
        props = torch.cuda.get_device_properties(0)
        print(f"GPU: {props.name}，显存: {props.total_memory / 1024**3:.1f} GB")
    base_model_name = args.model
    if args.adapter:
        base_model_file = args.adapter / "base_model.txt"
        if not base_model_file.exists():
            raise FileNotFoundError(f"已有 adapter 缺少 base_model.txt: {args.adapter}")
        base_model_name = base_model_file.read_text(encoding="utf-8").strip()
        print(f"继续训练 adapter: {args.adapter}")
    print(f"基座模型: {base_model_name}")

    tokenizer = AutoTokenizer.from_pretrained(
        str(args.adapter) if args.adapter else base_model_name,
        trust_remote_code=True,
        local_files_only=not args.allow_download,
    )
    if tokenizer.pad_token is None:
        tokenizer.pad_token = tokenizer.eos_token
        tokenizer.pad_token_id = tokenizer.eos_token_id

    load_kwargs = {
        "trust_remote_code": True,
        "local_files_only": not args.allow_download,
        "low_cpu_mem_usage": True,
        "device_map": "auto" if device == "cuda" else None,
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
        load_kwargs["torch_dtype"] = torch.float32

    base_model = AutoModelForCausalLM.from_pretrained(base_model_name, **load_kwargs)
    base_model.config.use_cache = False
    if use_4bit:
        base_model = prepare_model_for_kbit_training(base_model)
        base_model.gradient_checkpointing_enable()
    elif device == "cpu":
        base_model = base_model.to("cpu")

    if args.adapter:
        model = PeftModel.from_pretrained(base_model, str(args.adapter), is_trainable=True)
    else:
        lora_config = LoraConfig(
            task_type=TaskType.CAUSAL_LM,
            r=16,
            lora_alpha=32,
            lora_dropout=0.05,
            bias="none",
            target_modules=["q_proj", "k_proj", "v_proj", "o_proj", "gate_proj", "up_proj", "down_proj"],
        )
        model = get_peft_model(base_model, lora_config)
    model.print_trainable_parameters()

    dataset = load_data(args.data)
    print(f"训练样本: {len(dataset)}")
    tokenized = dataset.map(
        lambda batch: tokenize_batch(batch, tokenizer, args.max_length),
        batched=True,
        remove_columns=dataset.column_names,
        desc="编码纠错数据",
    )

    args.output_dir.mkdir(parents=True, exist_ok=True)
    training_args = TrainingArguments(
        output_dir=str(args.output_dir),
        num_train_epochs=args.epochs,
        per_device_train_batch_size=args.batch_size,
        gradient_accumulation_steps=args.gradient_accumulation,
        learning_rate=args.learning_rate,
        warmup_ratio=0.05,
        logging_steps=5,
        save_strategy="epoch",
        save_total_limit=2,
        fp16=device == "cuda" and not use_4bit,
        optim="paged_adamw_8bit" if use_4bit else "adamw_torch",
        report_to="none",
        remove_unused_columns=False,
        dataloader_pin_memory=device == "cuda",
        seed=20260802,
    )
    # 所有样本已经固定填充到 max_length；直接堆叠可避免继续训练 LoRA 时
    # DataCollatorForSeq2Seq 对 labels 二次裁剪造成 logits/labels 长度不一致。
    trainer = Trainer(model=model, args=training_args, train_dataset=tokenized, data_collator=default_data_collator)
    trainer.train()

    adapter_dir = args.output_dir / "adapter"
    model.save_pretrained(adapter_dir)
    tokenizer.save_pretrained(adapter_dir)
    (adapter_dir / "base_model.txt").write_text(base_model_name, encoding="utf-8")
    (adapter_dir / "task.txt").write_text("yueju_asr_correction", encoding="utf-8")
    print(f"纠错 LoRA adapter 已保存: {adapter_dir}")


if __name__ == "__main__":
    main()
