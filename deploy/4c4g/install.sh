#!/usr/bin/env bash
# ============================================================
# 越韵智传 · 腾讯云 4核4G 一键部署脚本
# ------------------------------------------------------------
# 适用：Ubuntu 22.04 / 24.04（Debian 12 亦可），单机跑
#       Node 网关 + MySQL + PDF OCR sidecar（可选 cloudflared）
#
# 用法（在解压后的包根目录执行）：
#     sudo bash deploy/4c4g/install.sh
#
# 可选环境变量：
#     APP_DIR=/opt/yueyun           安装目录
#     APP_USER=yueyun               运行账号
#     NODE_MAJOR=20                 安装的 Node 主版本（>=18）
#     SWAP_SIZE=2G                  交换文件大小，设 0 跳过
#     PYPi_MIRROR=1                 使用清华 PyPI 镜像
#     SKIP_SEED=1                   不导入演示数据
#     SKIP_APT=1                    跳过 apt 安装（依赖已就绪时）
# ============================================================
set -Eeuo pipefail

APP_DIR="${APP_DIR:-/opt/yueyun}"
APP_USER="${APP_USER:-yueyun}"
NODE_MAJOR="${NODE_MAJOR:-20}"
SWAP_SIZE="${SWAP_SIZE:-2G}"
PYPi_MIRROR="${PYPi_MIRROR:-1}"
SKIP_SEED="${SKIP_SEED:-0}"
SKIP_APT="${SKIP_APT:-0}"

SRC_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"

c_info()  { printf '\033[36m[信息]\033[0m %s\n' "$*"; }
c_ok()    { printf '\033[32m[完成]\033[0m %s\n' "$*"; }
c_warn()  { printf '\033[33m[注意]\033[0m %s\n' "$*"; }
c_err()   { printf '\033[31m[失败]\033[0m %s\n' "$*" >&2; }

trap 'c_err "第 $LINENO 行执行失败，脚本已中止。修复后可重新执行本脚本（幂等）。"' ERR

if [[ $EUID -ne 0 ]]; then
  c_err "请用 root 执行：sudo bash deploy/4c4g/install.sh"
  exit 1
fi

if [[ ! -f "$SRC_DIR/package.json" || ! -d "$SRC_DIR/server" ]]; then
  c_err "找不到项目文件（$SRC_DIR）。请在解压后的包根目录执行本脚本。"
  exit 1
fi

c_info "项目源目录：$SRC_DIR"
c_info "安装目录  ：$APP_DIR"

# ------------------------------------------------------------
# 0. 环境预检（提前发现会中途失败的问题）
# ------------------------------------------------------------
if [[ -f /etc/os-release ]]; then
  # shellcheck disable=SC1091
  . /etc/os-release
  c_info "系统：${PRETTY_NAME:-未知}"
  case "${ID:-}" in
    ubuntu|debian) ;;
    *) c_warn "本脚本只在 Ubuntu / Debian 上验证过（当前 ID=${ID:-未知}），继续执行但可能出错" ;;
  esac
else
  c_warn "读不到 /etc/os-release，无法确认发行版"
fi

MEM_MB="$(awk '/MemTotal/{print int($2/1024)}' /proc/meminfo 2>/dev/null || echo 0)"
if [[ "$MEM_MB" -gt 0 ]]; then
  c_info "内存：${MEM_MB}MB"
  [[ "$MEM_MB" -lt 3500 ]] && c_warn "内存低于 3.5GB，OCR 可能不够用（本方案按 4GB 预算设计）"
fi

AVAIL_GB="$(df -Pk / | awk 'NR==2{print int($4/1024/1024)}')"
c_info "根分区可用：${AVAIL_GB}GB"
[[ "$AVAIL_GB" -lt 12 ]] && c_warn "磁盘可用空间不足 12GB（依赖 + OCR 模型约占 3~5GB），建议先扩容"

if curl -fsS --max-time 8 -o /dev/null https://mirrors.tuna.tsinghua.edu.cn/ 2>/dev/null; then
  :
else
  c_warn "国内镜像连通性异常，pip / apt 可能较慢；如失败可考虑配置代理后重试"
fi

if curl -fsS --max-time 8 -o /dev/null https://deb.nodesource.com/ 2>/dev/null; then
  NODESOURCE_OK=1
else
  NODESOURCE_OK=0
  c_warn "访问 deb.nodesource.com 不通，将改用 apt 自带的 nodejs 安装（Ubuntu 24.04 为 Node 18，22.04 仅 12 会不满足要求）"
fi

# ------------------------------------------------------------
# 1. 交换文件（4GB 内存的突发保护）
# ------------------------------------------------------------
if [[ "$SWAP_SIZE" != "0" && ! -f /swapfile ]]; then
  c_info "创建 ${SWAP_SIZE} 交换文件…"
  fallocate -l "$SWAP_SIZE" /swapfile 2>/dev/null || dd if=/dev/zero of=/swapfile bs=1M count=2048 status=none
  chmod 600 /swapfile
  mkswap /swapfile >/dev/null
  swapon /swapfile
  grep -q '^/swapfile' /etc/fstab || echo '/swapfile none swap sw 0 0' >> /etc/fstab
  sysctl -w vm.swappiness=10 >/dev/null
  grep -q '^vm.swappiness' /etc/sysctl.conf || echo 'vm.swappiness=10' >> /etc/sysctl.conf
  c_ok "交换文件已启用"
else
  c_info "跳过交换文件（已存在或 SWAP_SIZE=0）"
fi

# ------------------------------------------------------------
# 2. 系统依赖
# ------------------------------------------------------------
if [[ "$SKIP_APT" != "1" ]]; then
  c_info "安装系统依赖（curl / python3 / mysql-server / rsync / sudo）…"
  export DEBIAN_FRONTEND=noninteractive
  apt-get update -qq
  apt-get install -y -qq curl ca-certificates gnupg rsync sudo python3 python3-venv python3-pip mysql-server >/dev/null
  c_ok "系统依赖就绪"
fi

# ------------------------------------------------------------
# 3. Node.js（>=18）
#   优先 NodeSource；不通则退回 apt 源；仍不达标就明确报错而不是硬着头皮继续
# ------------------------------------------------------------
node_major() { node -v 2>/dev/null | sed 's/^v//' | cut -d. -f1; }

if command -v node >/dev/null 2>&1 && [[ "$(node_major)" -ge 18 ]]; then
  c_info "已存在满足要求的 Node.js，跳过安装"
else
  if [[ "${NODESOURCE_OK:-0}" == "1" ]]; then
    c_info "安装 Node.js ${NODE_MAJOR}.x（NodeSource）…"
    if curl -fsSL "https://deb.nodesource.com/setup_${NODE_MAJOR}.x" | bash - >/dev/null 2>&1; then
      apt-get install -y -qq nodejs >/dev/null 2>&1 || true
    else
      c_warn "NodeSource 安装脚本执行失败，改用 apt 源"
    fi
  fi
  if ! command -v node >/dev/null 2>&1 || [[ "$(node_major)" -lt 18 ]]; then
    c_info "尝试 apt 源安装 nodejs…"
    apt-get install -y -qq nodejs >/dev/null 2>&1 || true
  fi
  if ! command -v node >/dev/null 2>&1 || [[ "$(node_major)" -lt 18 ]]; then
    c_err "Node.js 版本仍低于 18（当前：$(node -v 2>/dev/null || echo '未安装')）"
    cat >&2 <<'NODEHELP'
可选处理（任选其一，然后重跑本脚本）：
  1) 换 Ubuntu 24.04 镜像（apt 源自带 Node 18）
  2) 用国内镜像手动装：
       curl -fsSL https://mirrors.tuna.tsinghua.edu.cn/nodesource/deb/setup_20.x | bash -
       apt-get install -y nodejs
  3) 用 nvm 装：curl -o- https://gitee.com/mirrors/nvm/raw/v0.39.7/install.sh | bash
       source ~/.nvm/nvm.sh && nvm install 20
NODEHELP
    exit 1
  fi
fi
NODE_BIN="$(command -v node)"
c_ok "Node.js $(node -v)  ($NODE_BIN)"

# ------------------------------------------------------------
# 4. 运行账号与目录
# ------------------------------------------------------------
if ! id -u "$APP_USER" >/dev/null 2>&1; then
  useradd --system --create-home --shell /usr/sbin/nologin "$APP_USER"
fi
mkdir -p "$APP_DIR"
c_info "同步项目文件到 $APP_DIR …"
rsync -a --delete \
  --exclude 'node_modules' \
  --exclude '.env' \
  --exclude 'data' \
  --exclude 'uploads' \
  --exclude '.venv-ocr' \
  --exclude '.tmp' \
  --exclude '.tools' \
  --exclude '.git' \
  --exclude '.cloudflared' \
  "$SRC_DIR"/ "$APP_DIR"/
mkdir -p "$APP_DIR/data/course-pdf" "$APP_DIR/data/course-import-tmp" "$APP_DIR/uploads/drawings" "$APP_DIR/uploads/videos" "$APP_DIR/public/uploads"
chown -R "$APP_USER:$APP_USER" "$APP_DIR"
c_ok "文件同步完成"

# ------------------------------------------------------------
# 5. .env
#    优先使用「部署包内自带的 .env」——内部发行版里带着真实 AI 密钥，
#    这样服务器上一装即可用，不需要再手填 key。
#    但下面几项必须按生产环境归一化：
#      · 数据库连接改为本机的 yueyun 专用账号（包内可能是开发机的 root/123456）
#      · 数据库口令与占位 JWT_SECRET 统一换成随机强口令
#      · 补齐 4GB 机器专用的调优项（缺省时由代码默认值兜底）
# ------------------------------------------------------------
ENV_FILE="$APP_DIR/.env"
PACKAGE_ENV="$SRC_DIR/.env"

ensure_env() {  # 键不存在时才追加，避免覆盖已配置的值
  local key="$1" val="$2"
  grep -qE "^[[:space:]]*${key}=" "$ENV_FILE" 2>/dev/null || echo "${key}=${val}" >> "$ENV_FILE"
}

if [[ ! -f "$ENV_FILE" ]]; then
  if [[ -f "$PACKAGE_ENV" ]]; then
    cp "$PACKAGE_ENV" "$ENV_FILE"
    ENV_SOURCE="部署包内 .env（含真实 AI 密钥）"
  else
    cp "$APP_DIR/deploy/4c4g/.env.production.example" "$ENV_FILE"
    ENV_SOURCE="生产模板（AI 密钥为占位符，需手动填写）"
  fi
  c_info "写入配置：$ENV_SOURCE"

  sed -i 's/\r$//' "$ENV_FILE"   # 统一换行，避免 Windows 编辑残留 \r

  # 数据库连接归一化为本机专用账号
  sed -i "s|^[[:space:]]*DB_HOST=.*|DB_HOST=127.0.0.1|" "$ENV_FILE"
  sed -i "s|^[[:space:]]*DB_PORT=.*|DB_PORT=3306|" "$ENV_FILE"
  sed -i "s|^[[:space:]]*DB_USER=.*|DB_USER=yueyun|" "$ENV_FILE"
  sed -i "s|^[[:space:]]*DB_NAME=.*|DB_NAME=yueyun_db|" "$ENV_FILE"
  sed -i "s|^[[:space:]]*NODE_ENV=.*|NODE_ENV=production|" "$ENV_FILE"
  sed -i "s|^[[:space:]]*PORT=.*|PORT=3000|" "$ENV_FILE"

  # 数据库口令：开发机的弱口令不带进生产
  DB_PASSWORD="$(head -c 24 /dev/urandom | base64 | tr -d '/+=' | head -c 24)"
  if grep -qE '^[[:space:]]*DB_PASSWORD=' "$ENV_FILE"; then
    sed -i "s|^[[:space:]]*DB_PASSWORD=.*|DB_PASSWORD=${DB_PASSWORD}|" "$ENV_FILE"
  else
    echo "DB_PASSWORD=${DB_PASSWORD}" >> "$ENV_FILE"
  fi

  # JWT：仍是占位符才替换
  if grep -qE '^[[:space:]]*JWT_SECRET=(please_change|replace_with|your_|$)' "$ENV_FILE"; then
    JWT_SECRET="$(head -c 48 /dev/urandom | base64 | tr -d '/+=' | head -c 48)"
    sed -i "s|^[[:space:]]*JWT_SECRET=.*|JWT_SECRET=${JWT_SECRET}|" "$ENV_FILE"
    JWT_REPLACED=1
  fi

  # 4GB 机器的调优项（包内 .env 缺这些键时补上）
  ensure_env DB_POOL_SIZE 6
  ensure_env PDF_IMPORT_OCR_URL http://127.0.0.1:8768
  ensure_env PDF_IMPORT_CONCURRENCY 1
  ensure_env PDF_IMPORT_MAX_MB 100
  ensure_env PDF_IMPORT_OCR_TIMEOUT_MS 2700000
  ensure_env PDF_OCR_CONCURRENCY 1
  ensure_env PDF_OCR_DPI 180
  ensure_env PDF_OCR_THREADS 2
  ensure_env TEXT_LLM_USE_LOCAL_YUEJU false
  ensure_env YUEJU_LOW_MEM 1
  ensure_env API_DOCS_ENABLE false
  ensure_env LOG_LEVEL info

  chmod 600 "$ENV_FILE"
  chown "$APP_USER:$APP_USER" "$ENV_FILE"
  NEW_DB_PASSWORD="$DB_PASSWORD"
  c_ok ".env 已就绪（数据库账号 yueyun + 随机口令；文件权限 600）"
else
  DB_PASSWORD="$(grep -E '^[[:space:]]*DB_PASSWORD=' "$ENV_FILE" | head -1 | cut -d= -f2- | tr -d '\r' || true)"
  NEW_DB_PASSWORD=""
  c_warn ".env 已存在，保留原配置（不覆盖你已改好的密钥）"
fi
# shellcheck disable=SC1090
DB_NAME="$(grep -E '^[[:space:]]*DB_NAME=' "$ENV_FILE" | head -1 | cut -d= -f2- | tr -d '\r')"
DB_USER_CFG="$(grep -E '^[[:space:]]*DB_USER=' "$ENV_FILE" | head -1 | cut -d= -f2- | tr -d '\r')"
DB_NAME="${DB_NAME:-yueyun_db}"
DB_USER_CFG="${DB_USER_CFG:-yueyun}"

# ------------------------------------------------------------
# 6. MySQL：建库、建账号、导表结构
# ------------------------------------------------------------
c_info "初始化 MySQL…"
systemctl enable --now mysql >/dev/null 2>&1 || true
for _ in $(seq 1 30); do mysqladmin ping --silent >/dev/null 2>&1 && break; sleep 1; done

if [[ -f "$APP_DIR/deploy/4c4g/mysql-4gb.cnf" && ! -f /etc/mysql/mysql.conf.d/yueyun-4gb.cnf ]]; then
  cp "$APP_DIR/deploy/4c4g/mysql-4gb.cnf" /etc/mysql/mysql.conf.d/yueyun-4gb.cnf
  systemctl restart mysql
  for _ in $(seq 1 30); do mysqladmin ping --silent >/dev/null 2>&1 && break; sleep 1; done
  c_ok "已应用 4GB 保守 MySQL 参数"
fi

mysql --protocol=socket -uroot <<SQL
CREATE DATABASE IF NOT EXISTS \`${DB_NAME}\` DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
CREATE USER IF NOT EXISTS '${DB_USER_CFG}'@'127.0.0.1' IDENTIFIED BY '${DB_PASSWORD}';
ALTER USER '${DB_USER_CFG}'@'127.0.0.1' IDENTIFIED BY '${DB_PASSWORD}';
GRANT ALL PRIVILEGES ON \`${DB_NAME}\`.* TO '${DB_USER_CFG}'@'127.0.0.1';
FLUSH PRIVILEGES;
SQL
mysql --protocol=socket -uroot "$DB_NAME" < "$APP_DIR/server/sql/init.sql"
chown -R "$APP_USER:$APP_USER" "$APP_DIR"
c_ok "数据库 ${DB_NAME} 与表结构就绪（23 张表 + course_import_tasks 由服务自动创建）"

# ------------------------------------------------------------
# 7. Node 依赖（只装生产依赖，包体更小、进程内存更省）
# ------------------------------------------------------------
c_info "安装 Node 生产依赖（npm ci --omit=dev）…"
cd "$APP_DIR"
sudo -u "$APP_USER" -H npm ci --omit=dev --no-audit --no-fund
c_ok "Node 依赖完成"

# ------------------------------------------------------------
# 8. PDF OCR sidecar 虚拟环境
# ------------------------------------------------------------
if [[ ! -x "$APP_DIR/.venv-ocr/bin/python" ]]; then
  c_info "创建 OCR 虚拟环境并安装依赖（首次较慢，约 3~6 分钟）…"
  sudo -u "$APP_USER" -H python3 -m venv "$APP_DIR/.venv-ocr"
  PIP_ARGS=()
  [[ "$PYPi_MIRROR" == "1" ]] && PIP_ARGS=(-i https://pypi.tuna.tsinghua.edu.cn/simple)
  sudo -u "$APP_USER" -H "$APP_DIR/.venv-ocr/bin/pip" install --upgrade pip "${PIP_ARGS[@]}" >/dev/null
  sudo -u "$APP_USER" -H "$APP_DIR/.venv-ocr/bin/pip" install -r "$APP_DIR/server/python/pdf-import/requirements.txt" "${PIP_ARGS[@]}"
  c_ok "OCR 虚拟环境就绪"
else
  c_info "OCR 虚拟环境已存在，跳过"
fi

# ------------------------------------------------------------
# 9. systemd 服务
# ------------------------------------------------------------
c_info "注册 systemd 服务…"
sed "s|^ExecStart=.*|ExecStart=${NODE_BIN} server/server.js|" \
  "$APP_DIR/deploy/4c4g/yueyun-web.service" > /etc/systemd/system/yueyun-web.service
cp "$APP_DIR/deploy/4c4g/yueyun-ocr.service" /etc/systemd/system/yueyun-ocr.service
sed -i "s|/opt/yueyun|${APP_DIR}|g" /etc/systemd/system/yueyun-web.service /etc/systemd/system/yueyun-ocr.service
systemctl daemon-reload
systemctl enable --now yueyun-ocr >/dev/null
systemctl enable --now yueyun-web >/dev/null

c_info "等待服务就绪…"
health_ok=0
for _ in $(seq 1 40); do
  if curl -fsS http://127.0.0.1:3000/api/system/health >/dev/null 2>&1; then health_ok=1; break; fi
  sleep 1
done
if [[ "$health_ok" == "1" ]]; then
  c_ok "Node 网关健康检查通过"
else
  c_warn "健康检查未通过，请看日志：journalctl -u yueyun-web -n 80 --no-pager"
fi
if curl -fsS http://127.0.0.1:8768/health >/dev/null 2>&1; then
  c_ok "OCR 服务健康检查通过"
else
  c_warn "OCR 服务未就绪（PDF 导入会失败）；日志：journalctl -u yueyun-ocr -n 80 --no-pager"
fi

# ------------------------------------------------------------
# 10. 演示数据
# ------------------------------------------------------------
if [[ "$SKIP_SEED" != "1" ]]; then
  c_info "导入演示数据（幂等，可重复执行）…"
  sudo -u "$APP_USER" -H node server/seed.js >/dev/null 2>&1 && c_ok "演示数据完成" || c_warn "演示数据导入失败，可稍后手动执行：cd $APP_DIR && sudo -u $APP_USER node server/seed.js"
fi

# ------------------------------------------------------------
# 10.5 Cloudflare Tunnel（可选：带上 TUNNEL_TOKEN 就自动装好）
#      用法：sudo TUNNEL_TOKEN=eyJh... bash deploy/4c4g/install.sh
# ------------------------------------------------------------
if [[ -n "${TUNNEL_TOKEN:-}" ]]; then
  c_info "安装并配置 Cloudflare Tunnel…"
  if ! command -v cloudflared >/dev/null 2>&1; then
    mkdir -p /usr/share/keyrings
    if curl -fsSL --max-time 30 https://pkg.cloudflare.com/cloudflare-main.gpg \
         -o /usr/share/keyrings/cloudflare-main.gpg 2>/dev/null; then
      echo "deb [signed-by=/usr/share/keyrings/cloudflare-main.gpg] https://pkg.cloudflare.com/cloudflared any main" \
        > /etc/apt/sources.list.d/cloudflared.list
      apt-get update -qq >/dev/null 2>&1 || true
      apt-get install -y -qq cloudflared >/dev/null 2>&1 || true
    fi
  fi
  if command -v cloudflared >/dev/null 2>&1; then
    cloudflared service install "$TUNNEL_TOKEN" >/dev/null 2>&1 || true
    systemctl enable --now cloudflared >/dev/null 2>&1 || true
    sleep 3
    if systemctl is-active --quiet cloudflared; then
      c_ok "cloudflared 已启动（去 Cloudflare 控制台把域名指向 http://127.0.0.1:3000）"
    else
      c_warn "cloudflared 未运行，检查：journalctl -u cloudflared -n 50 --no-pager"
    fi
  else
    c_warn "cloudflared 安装失败（pkg.cloudflare.com 不通？）可稍后手动安装后执行：cloudflared service install <TOKEN>"
  fi
fi

# ------------------------------------------------------------
# 11. 收尾
# ------------------------------------------------------------
PUBLIC_IP="$(curl -fsS --max-time 5 https://api.ipify.org 2>/dev/null || echo '<服务器IP>')"
cat <<EOF

============================================================
 部署完成
============================================================
 本机验证 : curl http://127.0.0.1:3000/api/system/health
 SPA 入口 : http://${PUBLIC_IP}:3000/app
 服务管理 : systemctl status yueyun-web yueyun-ocr
 实时日志 : journalctl -u yueyun-web -f

 演示账号 : teacher / teacher123   （教师）
            student1 / student123 （学生）
EOF

if [[ -n "$NEW_DB_PASSWORD" ]]; then
  cat <<EOF

 安装脚本新生成并写入 $ENV_FILE 的凭据（请一并保存）：
   DB_PASSWORD=${NEW_DB_PASSWORD}
   DB_USER=yueyun    DB_NAME=yueyun_db    DB_HOST=127.0.0.1
EOF
fi
if [[ "${JWT_REPLACED:-0}" == "1" ]]; then
  echo "   JWT_SECRET=已由脚本替换为随机串（原值为占位符）"
fi

cat <<EOF

 还需手动完成：
   1) AI 密钥已随包写入 $APP_DIR/.env（内部发行版），确认后重启即可：
        grep -E 'API_KEY|API_SECRET' $APP_DIR/.env
        systemctl restart yueyun-web
      若密钥过期，直接改 .env 中对应行再 restart。
   2) 对外访问：二选一
      a. Cloudflare Tunnel（推荐，无需开放端口）
         sudo cloudflared service install <你的TUNNEL_TOKEN>
      b. Nginx 反代 + 证书
         sudo apt install -y nginx
         sudo cp $APP_DIR/deploy/4c4g/nginx-yueyun.conf /etc/nginx/sites-available/yueyun
         sudo ln -sf /etc/nginx/sites-available/yueyun /etc/nginx/sites-enabled/yueyun
         sudo nginx -t && sudo systemctl reload nginx
   3) 重要：Nginx 反代必须包含 client_max_body_size（模板已内置 1024m），
      否则大文件上传会被 413 拒绝。
============================================================
EOF
