#!/usr/bin/env bash
# ============================================================
# 越韵智传 · 生成 4核4G 部署包
# ------------------------------------------------------------
# 用法（在项目根目录执行）：
#     bash deploy/4c4g/build-release.sh
#
# 产出：release/yueyun-4c4g-<时间戳>.tar.gz（含 SHA256 校验文件）
# 说明：先跑类型检查与前端构建，再按「生产必需」清单裁剪打包。
#
# 注意：全程不使用 rm -rf —— 需要清空目录时改为 mv 到 .tmp 归档，
#      这样在带「安全删除钩子」的环境里也能正常构建。
# ============================================================
set -Eeuo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
cd "$ROOT"

STAMP="$(date +%Y%m%d-%H%M)"
PKG_NAME="yueyun-4c4g-$STAMP"
OUT="$ROOT/release/$PKG_NAME.tar.gz"
TMP="$ROOT/.tmp"

NODE_BIN="${NODE_BIN:-node}"

# 内部发行版默认把 .env（含真实 AI 密钥）一并打包，服务器上装完即用。
# 需要打「不含密钥」的外发版本时：WITH_ENV=0 bash deploy/4c4g/build-release.sh
WITH_ENV="${WITH_ENV:-1}"
ENV_EXCLUDES=()
if [[ "$WITH_ENV" == "1" ]]; then
  [[ -f "$ROOT/.env" ]] || { echo "错误：找不到 .env，无法打包密钥" >&2; exit 1; }
else
  ENV_EXCLUDES=(--exclude='./.env')
fi

mkdir -p "$ROOT/release" "$TMP"

echo "==> 1/5 前端类型检查"
"$NODE_BIN" node_modules/typescript/bin/tsc --noEmit

echo "==> 2/5 构建 SPA（产物写入 public/app）"
if [[ -d "$ROOT/public/app" ]]; then
  mv "$ROOT/public/app" "$TMP/app-prev-$STAMP"
  echo "    旧产物已归档到 .tmp/app-prev-$STAMP"
fi
"$NODE_BIN" node_modules/vite/bin/vite.js build

echo "==> 3/5 刷新静态资源版本号"
"$NODE_BIN" scripts/bump-static-version.mjs || true

echo "==> 4/5 打包（排除开发依赖、密钥、用户数据与可选大模型）"
EXTRA="$TMP/pkg-extra-$STAMP"
mkdir -p "$EXTRA"
cp "$ROOT/deploy/4c4g/INSTALL.md" "$EXTRA/INSTALL.md"

PKG_TAR="$TMP/$PKG_NAME.tar"
# --transform：让包内根目录就是 $PKG_NAME，解压到 /opt 后即为 /opt/$PKG_NAME
TRANSFORM="s,^\\./,$PKG_NAME/,"
tar -cf "$PKG_TAR" \
  --transform="$TRANSFORM" \
  "${ENV_EXCLUDES[@]}" \
  --exclude='./node_modules' \
  --exclude='./.git' \
  --exclude='./.tmp' \
  --exclude='./.tools' \
  --exclude='./.idea' \
  --exclude='./.cloudflared' \
  --exclude='./release' \
  --exclude='./dev' \
  --exclude='./finetune' \
  --exclude='./models' \
  --exclude='./source' \
  --exclude='./data' \
  --exclude='./uploads' \
  --exclude='./public/uploads' \
  --exclude='./越韵智传-Alpaca微调数据集' \
  --exclude='./server/sql/full_dump.sql' \
  --exclude='./vite.config.ts.timestamp-*.mjs' \
  --exclude='./*.bat' \
  --exclude='*.log' \
  --exclude='__pycache__' \
  --exclude='.venv' \
  --exclude='*.pyc' \
  -C "$ROOT" ./

# 部署说明放到包根，方便解压后第一眼看到
tar -rf "$PKG_TAR" --transform="$TRANSFORM" -C "$EXTRA" ./INSTALL.md

echo "==> 5/5 压缩并校验"
gzip -6 "$PKG_TAR"
mv "$PKG_TAR.gz" "$OUT"
( cd "$ROOT/release" && sha256sum "$PKG_NAME.tar.gz" > "$PKG_NAME.tar.gz.sha256" )

# 自检：密钥/说明文件是否按预期进包
# 注意：不要写成 `tar -tzf x | grep -q y` —— grep -q 命中即退出，
# 会让 tar 收到 SIGPIPE(141)，在 set -o pipefail 下被误判为失败。
PKG_LIST="$(tar -tzf "$OUT")"
if [[ "$WITH_ENV" == "1" ]]; then
  grep -q "^$PKG_NAME/\.env$" <<< "$PKG_LIST" \
    || { echo "错误：包里没有 .env，打包失败" >&2; exit 1; }
  echo "   自检：.env 已入包"
fi
grep -q "^$PKG_NAME/INSTALL\.md$" <<< "$PKG_LIST" \
  || { echo "错误：包里没有 INSTALL.md" >&2; exit 1; }

SIZE="$(du -h "$OUT" | cut -f1)"
echo
echo "============================================================"
echo " 部署包已生成"
echo "   文件：$OUT"
echo "   大小：$SIZE"
echo "   校验：$PKG_NAME.tar.gz.sha256"
if [[ "$WITH_ENV" == "1" ]]; then
  echo "   密钥：已打包 .env（内部发行版，请勿外传）"
else
  echo "   密钥：未打包（服务器上需手动填写 AI 密钥）"
fi
echo
echo " 上传到服务器"
echo "   scp $OUT root@<服务器IP>:/root/"
echo
echo " 服务器上执行"
echo "   mkdir -p /opt && sudo tar xzf /root/$(basename "$OUT") -C /opt"
echo "   cd /opt/$PKG_NAME && sudo bash deploy/4c4g/install.sh"
echo "============================================================"
