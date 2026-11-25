#!/usr/bin/env bash
# 越剧 ASR 纠错微调模型 sidecar 安装脚本（可选组件，4G 服务器专用低内存模式）
# 用法：sudo bash deploy/4c4g/install-yueju-correct.sh [模型源目录]
#   模型源目录需包含: serve.py inference.py outputs/adapter/*
#   默认源: ~/yueju-upload/yueju_asr_correct
# 幂等可重复执行。装完后服务默认不启动（睡眠态），由 yueyun-web 在云端 API
# 故障时通过 `sudo systemctl start yueju-correct.service` 按需拉起，
# 30 分钟无活动自动睡眠（RuntimeMaxSec）。
set -euo pipefail

SRC="${1:-$HOME/yueju-upload/yueju_asr_correct}"
DEST="$HOME/yueju-model/yueju_asr_correct"
VENV="$HOME/yueju-model/venv"
HF_CACHE="$HOME/yueju-model/hf-cache"
MIRROR="https://mirrors.cloud.tencent.com/pypi/simple"

[ -d "$SRC/outputs/adapter" ] || { echo "错误: 模型源目录缺 outputs/adapter: $SRC"; exit 1; }
[ -f "$SRC/serve.py" ] || { echo "错误: 模型源目录缺 serve.py"; exit 1; }

echo "==> 1/5 系统依赖"
sudo apt-get install -y -q python3-venv python3-pip >/dev/null

echo "==> 2/5 Python venv + CPU 版推理栈"
if [ ! -x "$VENV/bin/python" ]; then
  python3 -m venv "$VENV"
  "$VENV/bin/pip" install -q -U pip -i "$MIRROR"
  # torch CPU wheel 直链阿里云镜像（实测 14MB/s；pytorch.org 国内极慢，PyPI 整包 900MB 不划算）
  "$VENV/bin/pip" install -q transformers peft accelerate huggingface_hub -i "$MIRROR"
  wget -q "https://mirrors.aliyun.com/pytorch-wheels/cpu/torch-2.5.1%2Bcpu-cp312-cp312-linux_x86_64.whl" \
    -O "$HOME/yueju-model/torch-cpu.whl" \
    && "$VENV/bin/pip" install -q "$HOME/yueju-model/torch-cpu.whl" -i "$MIRROR" \
    || "$VENV/bin/pip" install -q torch -i "$MIRROR"
fi

echo "==> 3/5 模型文件（adapter + 脚本）"
mkdir -p "$DEST/outputs"
cp -r "$SRC/serve.py" "$SRC/inference.py" "$DEST/"
rm -rf "$DEST/outputs/adapter"
cp -r "$SRC/outputs/adapter" "$DEST/outputs/adapter"

echo "==> 4/5 基座模型（优先本地缓存，其次 hf-mirror 下载）"
export HF_HOME="$HF_CACHE"
export HF_ENDPOINT="https://hf-mirror.com"
# 关键：Qwen2.5 的 safetensors 走 Xet/CAS 通道，hf-mirror 无法代理（401），
# 必须禁用 Xet 强制走传统 HTTP 下载。
export HF_HUB_DISABLE_XET=1
if ! "$VENV/bin/python" - <<'PY'
import os, sys
os.environ.setdefault("HF_HUB_OFFLINE", "0")
try:
    from huggingface_hub import snapshot_download
    p = snapshot_download("Qwen/Qwen2.5-0.5B-Instruct",
                          allow_patterns=["*.json", "*.safetensors", "*.txt", "tokenizer*", "merges.txt"])
    print("基座模型就绪:", p)
except Exception as e:
    print("DOWNLOAD_FAIL:", e); sys.exit(1)
PY
then
  echo "    本地无缓存且下载失败，请手动上传 HuggingFace 缓存到 $HF_CACHE"
  exit 1
fi

echo "==> 5/5 systemd 单元 + sudoers（按需启动授权）"
sudo cp "$(dirname "$0")/yueju-correct.service" /etc/systemd/system/yueju-correct.service
echo "ubuntu ALL=(root) NOPASSWD: /usr/bin/systemctl start yueju-correct.service" \
  | sudo tee /etc/sudoers.d/yueju-correct >/dev/null
sudo chmod 440 /etc/sudoers.d/yueju-correct
sudo systemctl daemon-reload

# 服务保持"睡眠态"：不 enable、不 start。验证安装：
sudo systemd-analyze verify yueju-correct.service 2>/dev/null || true
echo "完成。冷启动自检: sudo systemctl start yueju-correct.service && curl -s http://127.0.0.1:3456/health"
