"""
越剧知识问答模型本地推理服务
启动后保持模型常驻内存，通过 HTTP /ask 接口提供问答服务
支持 adapter 模式（4-bit）和 merged 模式
"""
import os
import json
import argparse
from http.server import HTTPServer, BaseHTTPRequestHandler
from inference import load_model, answer_question

DEFAULT_MODEL = None  # 让 inference.py 自动寻找

# /correct 纠错专用系统提示词（与问答区分：只输出纠正后的文本）
CORRECTION_SYSTEM_PROMPT = (
    "你是越剧语音识别文本纠错助手。只纠正越剧专有名词（流派、名家、剧目、唱段、唱腔、行当）"
    "的同音字、错别字和明显的断句错误，不得改写原意，不得补充原文没有的信息，"
    "不得回答或解释，只输出纠正后的完整文本。"
)

# 全局模型（启动时加载）
model = None
tokenizer = None
device = None


class AskHandler(BaseHTTPRequestHandler):
    def log_message(self, format, *args):
        print(f"[serve] {args[0]}")

    def _send_json(self, status_code, data):
        self.send_response(status_code)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Access-Control-Allow-Origin", "*")
        self.end_headers()
        self.wfile.write(json.dumps(data, ensure_ascii=False).encode("utf-8"))

    def do_OPTIONS(self):
        self.send_response(200)
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Methods", "POST, OPTIONS")
        self.send_header("Access-Control-Allow-Headers", "Content-Type")
        self.end_headers()

    def do_POST(self):
        global model, tokenizer, device
        # 兼容 /ask（问答）和 /correct（向后兼容旧 ASR 纠错调用）
        if self.path not in ("/ask", "/correct"):
            self._send_json(404, {"error": "not found"})
            return

        try:
            content_length = int(self.headers.get("Content-Length", 0))
            body = self.rfile.read(content_length).decode("utf-8")
            payload = json.loads(body)
            # 问答接口取 question 字段；兼容旧 correct 接口的 text 字段
            question = (payload.get("question") or payload.get("text") or "").strip()
            # 纠错接口用更小的生成长度（纠错文本≈输入长度）
            max_new_tokens = int(payload.get("max_new_tokens", 256 if self.path == "/correct" else 512))
            if not question:
                self._send_json(400, {"error": "question is required"})
                return

            if model is None:
                self._send_json(503, {"error": "model not loaded"})
                return

            answer = answer_question(
                model, tokenizer, device, question,
                max_new_tokens=max_new_tokens,
                # /correct 走纠错专用提示词：只改术语错字，不改写原意（/ask 保持问答提示词）
                system_prompt=CORRECTION_SYSTEM_PROMPT if self.path == "/correct" else None,
            )
            self._send_json(200, {
                "question": question,
                "answer": answer,
                # 向后兼容：旧 correct 接口期望 corrected 字段
                "corrected": answer,
            })
        except Exception as e:
            self._send_json(500, {"error": str(e)})

    def do_GET(self):
        if self.path == "/health":
            self._send_json(200, {
                "status": "ok",
                "model_loaded": model is not None,
                "task": "yueju_qa",
            })
            return
        self._send_json(404, {"error": "not found"})


def main():
    parser = argparse.ArgumentParser(description="越剧知识问答推理服务")
    parser.add_argument("--model", type=str, default=DEFAULT_MODEL, help="模型路径（adapter 或 merged）")
    parser.add_argument("--port", type=int, default=3456, help="服务端口")
    parser.add_argument("--host", type=str, default="127.0.0.1", help="服务地址")
    parser.add_argument("--use_4bit", action="store_true", help="强制使用 4-bit 量化")
    parser.add_argument("--low-mem", action="store_true", help="低内存模式：fp16 半精度加载，内存占用减半（适合 4G 服务器）")
    args = parser.parse_args()

    global model, tokenizer, device
    print("正在加载模型...")
    model, tokenizer, device = load_model(args.model, use_4bit=args.use_4bit, use_fp16=args.low_mem)
    print(f"模型加载完成，使用设备: {device}")

    server = HTTPServer((args.host, args.port), AskHandler)
    print(f"越剧知识问答服务已启动: http://{args.host}:{args.port}")
    print(f"健康检查: http://{args.host}:{args.port}/health")
    print(f"问答接口: POST http://{args.host}:{args.port}/ask")
    print('请求示例: curl -X POST http://127.0.0.1:3456/ask -H "Content-Type: application/json" -d "{\\"question\\": \\"请介绍越剧袁派\\"}"')
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        print("\n服务已停止")


if __name__ == "__main__":
    main()
