#!/usr/bin/env bash
# ============================================================
# 可选 sidecar 安装（演唱测评 8765 / 剧本比对 8766）
# ------------------------------------------------------------
# 说明：这两个服务只服务「演唱测评」「剧本比对」两个页面。
#      不装不影响其他功能（对应页面会提示服务离线）。
#      4核4G 上它们与 OCR/MySQL 争 CPU，建议演示完就停：
#         sudo systemctl stop yueyun-singing yueyun-script
#
# 用法：sudo bash deploy/4c4g/install-sidecars.sh
# ============================================================
set -Eeuo pipefail

APP_DIR="${APP_DIR:-/opt/yueyun}"
APP_USER="${APP_USER:-yueyun}"
PIP_ARGS=(-i https://pypi.tuna.tsinghua.edu.cn/simple)

if [[ $EUID -ne 0 ]]; then echo "请用 root 执行" >&2; exit 1; fi

echo "[1/3] 安装编译依赖（pyworld 等需要）…"
export DEBIAN_FRONTEND=noninteractive
apt-get update -qq
apt-get install -y -qq build-essential python3-dev >/dev/null

install_one() {
  local name="$1" port="$2"
  local dir="$APP_DIR/server/python/$name"
  [[ -f "$dir/requirements.txt" ]] || { echo "跳过 $name（无 requirements.txt）"; return; }
  if [[ -x "$dir/.venv/bin/python" ]]; then echo "  $name 虚拟环境已存在，跳过安装"; return; fi
  echo "  安装 $name 依赖（8765/8766 类服务首次约 3~8 分钟）…"
  sudo -u "$APP_USER" -H python3 -m venv "$dir/.venv"
  sudo -u "$APP_USER" -H "$dir/.venv/bin/pip" install --upgrade pip >/dev/null
  sudo -u "$APP_USER" -H "$dir/.venv/bin/pip" install -r "$dir/requirements.txt" "${PIP_ARGS[@]}"
  echo "  $name 完成"
}

echo "[2/3] 创建虚拟环境并安装依赖…"
install_one singing-eval 8765
install_one script-compare 8766

echo "[3/3] 注册 systemd 服务…"
for u in yueyun-singing yueyun-script; do
  if [[ -f "$APP_DIR/deploy/4c4g/$u.service" ]]; then
    sed -e "s|/opt/yueyun|$APP_DIR|g" \
        -e "s|^User=yueyun|User=$APP_USER|" \
        -e "s|^Group=yueyun|Group=$APP_USER|" \
        "$APP_DIR/deploy/4c4g/$u.service" > "/etc/systemd/system/$u.service"
  fi
done
systemctl daemon-reload
systemctl enable --now yueyun-singing yueyun-script >/dev/null 2>&1 || true
chown -R "$APP_USER:$APP_USER" "$APP_DIR/server/python"

sleep 3
for p in 8765 8766; do
  if curl -fsS "http://127.0.0.1:$p/health" >/dev/null 2>&1; then
    echo "  端口 $p 健康检查通过"
  else
    echo "  端口 $p 未就绪，检查：journalctl -u yueyun-singing -u yueyun-script -n 60 --no-pager"
  fi
done
echo "可选 sidecar 安装结束"
