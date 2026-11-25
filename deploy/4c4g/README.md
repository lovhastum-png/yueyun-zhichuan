# 4 核 4GB 单机部署

本方案面向 Ubuntu/Debian 单机：Node、MySQL、PDF OCR 和 cloudflared 同机运行。AI 问答与课程资源生成继续调用云端接口，不在本机加载 Qwen 模型。

> **快速通道**：已生成部署包的情况下，直接看 [`INSTALL.md`](./INSTALL.md) —— 上传解压后一条命令
> `sudo bash deploy/4c4g/install.sh` 即可完成全部安装（建账号、建库、装依赖、注册服务、导演示数据）。
> 下面这份文档是**手动逐步部署**与参数说明，用于排查和定制。

## 0. 部署相关的三个坑（务必先看）

| 坑 | 现象 | 处理 |
| --- | --- | --- |
| Nginx 默认 `client_max_body_size` 只有 1MB | 大文件上传返回 **413**，前端若没兜底就表现为「按钮点了没反应」 | 用 [`nginx-yueyun.conf`](./nginx-yueyun.conf)（已内置 1024m），或手动加 `client_max_body_size` |
| Cloudflare Tunnel 会中断 2MB 以上的原始请求 | PDF 导入传到一半断流 | PDF 导入已改为 **256KB 分片**上传（`UPLOAD_CHUNK_SIZE`），每个分片都是小 JSON，可断点续传 |
| 4GB 内存被并发打满 | 进程被 OOM 杀掉、服务重启 | 任务/OCR 单并发 + systemd `MemoryMax` + 2GB swap，见下节 |

2026-09 起 PDF 导入不再走「整体二进制 POST」，改为：

```
POST /api/course/import/upload/init        → 建会话（返回 uploadId）
POST /api/course/import/upload/:id/chunk/:index   → 256KB 分片（8 并发、失败重试）
POST /api/course/import/upload/:id/complete       → 落盘成 PDF 并建任务
DELETE /api/course/import/upload/:id              → 取消上传，清理临时文件
GET  /api/course/import/task/:id                  → 轮询进度
POST /api/course/import/task/:id/resume           → 服务重启后继续导入
```

任务状态持久化在 `course_import_tasks` 表（服务启动时自动建表，`init.sql` 无需改动），
进程重启后未完成任务会标记为 `interrupted`，由教师手动「继续导入」，避免盲目续跑。


## 建议内存预算

| 进程 | 常态 | 峰值/上限 |
| --- | ---: | ---: |
| Node Web/API | 100~250MB | 800MB |
| PDF OCR（单任务） | 500~900MB | 1.5GB |
| MySQL | 500~700MB | 约 800MB |
| cloudflared | 40~80MB | 约 120MB |
| 系统与磁盘缓存 | 700MB+ | 剩余内存 |

建议额外配置 2GB swap 作为突发保护，但不能用 swap 代替 OCR 单并发限制。

## 1. 安装与构建

```bash
sudo apt update
sudo apt install -y nodejs npm python3 python3-venv mysql-server

# 项目要求 Node.js >= 18；生产环境推荐安装当前受支持的 Node.js LTS。
node --version

sudo useradd --system --create-home --shell /usr/sbin/nologin yueyun || true
sudo mkdir -p /opt/yueyun
sudo chown -R yueyun:yueyun /opt/yueyun
# 将项目文件上传或同步到 /opt/yueyun 后：
cd /opt/yueyun
sudo -u yueyun npm ci
sudo -u yueyun npm run build:web
sudo -u yueyun npm prune --omit=dev

sudo -u yueyun python3 -m venv .venv-ocr
sudo -u yueyun .venv-ocr/bin/pip install --upgrade pip
sudo -u yueyun .venv-ocr/bin/pip install -r server/python/pdf-import/requirements.txt
sudo chown -R yueyun:yueyun /opt/yueyun
```

如果上面的版本低于 18，请先通过 Node.js 官方发行渠道安装较新的 LTS 版本，再继续构建。

## 2. 配置

```bash
cd /opt/yueyun
cp deploy/4c4g/.env.production.example .env
chmod 600 .env
```

编辑 `.env`，至少替换数据库密码、JWT_SECRET、域名和各 AI 密钥。4GB 机器保留以下值：

> 注：**内部发行部署包里已自带 `.env`（含真实 AI 密钥）**，一键安装（`install.sh`）会直接使用它，
> 并把数据库账号/口令与占位 JWT 归一化为生产取值。只有在你放的是源码目录（无 `.env`）时，
> 才需要按上面这步从模板复制一份并手填密钥。

```ini
DB_POOL_SIZE=6
PDF_IMPORT_CONCURRENCY=1
PDF_IMPORT_MAX_MB=100
PDF_OCR_CONCURRENCY=1
PDF_OCR_DPI=180
PDF_OCR_THREADS=2
TEXT_LLM_USE_LOCAL_YUEJU=false
```

初始化数据库后，可选安装保守的 MySQL 配置：

```bash
sudo cp deploy/4c4g/mysql-4gb.cnf /etc/mysql/mysql.conf.d/yueyun-4gb.cnf
sudo systemctl restart mysql
mysql -u root -p < server/sql/init.sql
```

## 2.1 防止 4GB 内存被打满（应用层保护）

除了 systemd 的 `MemoryHigh/MemoryMax`，应用侧还有几道闸门，避免突发并发把进程拖到 OOM：

| 机制 | 位置 | 默认值 | 作用 |
| --- | --- | --- | --- |
| JSON 请求体上限 | `server/server.js` | 8MB | 单请求堆内存占用封顶（大文件走 multipart 流式落盘） |
| 音频识别并发 | `limitConcurrency('asr')` | 2 并发 / 8 排队 | 每个 ASR 请求需持有 20MB Buffer + base64 字符串 |
| 演唱测评并发 | `limitConcurrency('singing-eval')` | 2 并发 / 6 排队 | 单请求双 25MB 音频，下游 Python 为单 worker |
| 剧本比对并发 | `limitConcurrency('script-compare')` | 3 并发 / 8 排队 | jieba + rapidfuzz 吃 CPU |
| 生图 / 润色并发 | `limitConcurrency('image-gen')` | 3 并发 / 10 排队 | 外部付费接口，同时保护配额 |
| 身段测评在线数 | `POSE_EVAL_MAX_SESSIONS` | 3 | WebSocket 侧硬上限，超出直接告知「人数已满」 |

超出额度的请求不会把服务拖垮：先进入有界队列等待，队列也满时返回
`503 {"code":503,"message":"当前使用人数较多，请稍后重试"}`。

运行时可访问 `GET /api/system/status`（需教师登录）查看
`concurrency` 字段，观察各闸门当前的 `active / waiting` 占用。

另外：**生产环境默认关闭 `/api-docs`**（避免公开完整接口结构），
需要演示时在 `.env` 里设 `API_DOCS_ENABLE=true` 即可。

## 3. 注册 systemd 服务

确认 `which node` 是 `/usr/bin/node`；若不是，请修改 `yueyun-web.service` 的 `ExecStart`。

```bash
sudo cp deploy/4c4g/yueyun-web.service /etc/systemd/system/
sudo cp deploy/4c4g/yueyun-ocr.service /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable --now yueyun-ocr yueyun-web
```

检查：

```bash
systemctl status yueyun-web yueyun-ocr --no-pager
curl -fsS http://127.0.0.1:3000/api/system/health
curl -fsS http://127.0.0.1:8768/health
journalctl -u yueyun-web -u yueyun-ocr -f
```

## 4. Cloudflare Tunnel

在 Cloudflare 控制台创建 Tunnel 后，按控制台给出的 token 安装为系统服务：

```bash
sudo cloudflared service install YOUR_TUNNEL_TOKEN
sudo systemctl status cloudflared --no-pager
```

将公网域名的 Tunnel 服务地址指向 `http://127.0.0.1:3000`。服务器防火墙需要允许 cloudflared 出站访问 TCP/UDP 7844；若 UDP 不稳定，可在 cloudflared 配置中固定 `protocol: http2`。

## 可选功能

演唱测评、剧本比对、姿态评分可以各自作为单 worker sidecar 按需启动。不要在 4GB 机器启动 `models/yueju_asr_correct/serve.py`：即使半精度也会显著压缩 OCR 与 MySQL 的可用内存。需要本地模型时建议单独使用至少 8GB 的计算节点。

## 可选组件：越剧 ASR 纠错微调模型（睡眠态 sidecar）

4G 内存跑不驻留模型，设计为「平时睡眠、故障兜底」：

- **第 1 层（常驻）**：规则纠错 `server/services/yuejuRuleCorrect.js`，词表
  `server/data/yueju-rule-vocab.json`（131 术语 / 396 同音变体，来自微调训练数据）。
  ASR 文本先进规则层，命中即返回，零内存开销。
- **第 2 层（按需）**：本地微调模型 Qwen2.5-0.5B + LoRA（`127.0.0.1:3456`，fp16 低内存模式）。
  仅当云端文字 LLM 连续失败（`server/services/apiHealth.js`，10 分钟窗口 ≥2 次）且规则层
  未命中时，由 yueyun-web 自动 `systemctl start yueju-correct.service` 拉起；
  systemd `RuntimeMaxSec=1800` 保证用完 30 分钟自动睡眠。`MemoryMax=1800M`护栏。

安装（模型文件不在发布包内，需单独传输）：

    # 本机: 把 models/yueju_asr_correct 上传到服务器 ~/yueju-upload/yueju_asr_correct
    scp -r models/yueju_asr_correct ubuntu@<ip>:~/yueju-upload/
    # 服务器:
    sudo bash deploy/4c4g/install-yueju-correct.sh

验证: `sudo systemctl start yueju-correct.service` 后 `curl -s http://127.0.0.1:3456/health`
应返回 `{"model_loaded": true, ...}`；`sudo systemctl stop yueju-correct` 收回内存。
观测: 云端 API 健康状态见 `server/services/apiHealth.js`（可并入 /api/system/status）。
