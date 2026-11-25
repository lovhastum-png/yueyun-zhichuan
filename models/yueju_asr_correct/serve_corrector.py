"""越剧 ASR 文本纠错模型服务，默认监听 127.0.0.1:3457。"""

from __future__ import annotations

import argparse
import json
from http.server import BaseHTTPRequestHandler, HTTPServer
from pathlib import Path

import torch

from inference import load_model
from prepare_correction_data import TERM_GROUPS


ROOT = Path(__file__).resolve().parent
DEFAULT_MODEL = ROOT / "outputs" / "corrector" / "adapter"
SYSTEM_PROMPT = (
    "你是越剧语音识别文本纠错助手。只纠正越剧专有名词、同音字、错别字和明显的断句错误，"
    "不得改写原意，不得补充原文没有的信息。只输出纠正后的完整文本。"
)

model = None
tokenizer = None
device = None
model_path = None

# 高置信越剧专名先做词典归一化，再交给微调模型处理上下文、断句和保守输出。
# 这能避免 0.5B 小模型在全新句式中漏掉极短同音词，同时模型仍负责最终文本生成。
TERM_CORRECTIONS = sorted(
    (
        (variant, correct)
        for terms in TERM_GROUPS.values()
        for correct, variants in terms.items()
        for variant in variants
    ),
    key=lambda item: len(item[0]),
    reverse=True,
)


def normalize_terms(text: str) -> str:
    normalized = text
    for variant, correct in TERM_CORRECTIONS:
        normalized = normalized.replace(variant, correct)
    return normalized


def build_prompt(text: str) -> str:
    instruction = "纠正下面这段越剧语音识别文本，只输出纠正结果。"
    return (
        f"<|im_start|>system\n{SYSTEM_PROMPT}<|im_end|>\n"
        f"<|im_start|>user\n{instruction}\n\n{text}<|im_end|>\n"
        "<|im_start|>assistant\n"
    )


def correct_text(text: str, max_new_tokens: int = 192) -> str:
    prompt = build_prompt(normalize_terms(text))
    inputs = tokenizer(prompt, return_tensors="pt").to(device)
    with torch.no_grad():
        outputs = model.generate(
            **inputs,
            max_new_tokens=max_new_tokens,
            do_sample=False,
            repetition_penalty=1.03,
            eos_token_id=tokenizer.convert_tokens_to_ids("<|im_end|>"),
            pad_token_id=tokenizer.pad_token_id,
        )
    generated = tokenizer.decode(outputs[0][inputs["input_ids"].shape[1]:], skip_special_tokens=False)
    return generated.replace("<|im_end|>", "").replace(tokenizer.eos_token or "", "").strip()


class CorrectHandler(BaseHTTPRequestHandler):
    def log_message(self, fmt, *args):
        print(f"[corrector] {args[0]}")

    def send_json(self, status: int, payload: dict) -> None:
        body = json.dumps(payload, ensure_ascii=False).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def do_GET(self):
        if self.path == "/health":
            self.send_json(200, {
                "status": "ok",
                "model_loaded": model is not None,
                "task": "yueju_asr_correction",
                "model_path": str(model_path) if model_path else None,
                "device": device,
                "term_rules": len(TERM_CORRECTIONS),
            })
            return
        self.send_json(404, {"error": "not found"})

    def do_POST(self):
        if self.path != "/correct":
            self.send_json(404, {"error": "not found"})
            return
        try:
            length = int(self.headers.get("Content-Length", 0))
            payload = json.loads(self.rfile.read(length).decode("utf-8"))
            text = str(payload.get("text", "")).strip()
            if not text:
                self.send_json(400, {"error": "text is required"})
                return
            corrected = correct_text(text, int(payload.get("max_new_tokens", 192)))
            self.send_json(200, {"original": text, "corrected": corrected})
        except Exception as exc:
            self.send_json(500, {"error": str(exc)})


def main() -> None:
    parser = argparse.ArgumentParser(description="越剧 ASR 文本纠错模型服务")
    parser.add_argument("--model", type=Path, default=DEFAULT_MODEL)
    parser.add_argument("--host", default="127.0.0.1")
    parser.add_argument("--port", type=int, default=3457)
    args = parser.parse_args()

    global model, tokenizer, device, model_path
    model_path = args.model.resolve()
    print(f"加载纠错模型: {model_path}")
    model, tokenizer, device = load_model(str(model_path))
    print(f"模型加载完成，设备: {device}")
    server = HTTPServer((args.host, args.port), CorrectHandler)
    print(f"纠错服务已启动: http://{args.host}:{args.port}")
    server.serve_forever()


if __name__ == "__main__":
    main()
