> **竞赛提交包适配说明**：本文件源自团队内部 4 核 4G 部署笔记，已在打包时改写为对外发行版口径。
> 随本竞赛材料（`05—作品代码.zip`）分发的内容**不含** `.env`，也不含任何服务凭证；
> 需要复现时请将根目录 `ENV_TEMPLATE.txt` 复制为 `.env` 并填写自有或经授权的配置。

# 越韵智传 · 4核4G 正式部署（照着做就行）

> 目标机器：腾讯云轻量/CVM，Ubuntu 22.04 或 24.04，**4 核 4GB**，系统盘 ≥ 40GB。
> 本包已包含构建好的前端产物（`public/app/`），服务器上**不需要装 Node 编译前端**（只跑生产依赖）。
>
> 🔓 **对外发行版**：本包**不包含** `.env`，也不包含任何服务凭证；请依据根目录 `ENV_TEMPLATE.txt` 填写自有或经授权的配置。

---

## 0. 部署包内容

| 目录 | 说明 |
| --- | --- |
| `server/` | Node 网关（21 个路由模块）+ PDF OCR sidecar 源码 |
| `public/` | 已构建的 SPA 产物、字体、3D/试衣素材、静态页 |
| `src/` | 前端源码（已构建，改样式时才需要） |
| `deploy/4c4g/` | **部署脚本、systemd 服务、Nginx 模板、备份脚本** |
| `server/sql/init.sql` | 数据库表结构（23 张表，导入后服务会自动补建 `course_import_tasks`） |
| `ENV_TEMPLATE.txt` | 脱敏配置模板（**不含任何服务凭证**）；请复制为 `.env` 并填写自有配置 |

未打包（刻意裁掉，需要时从本地源码仓库单独拷）：

- `models/`、`source/`：本地越剧微调模型与 3D 运行时源码 —— 4G 机器不该跑，也不需要。
- `server/sql/full_dump.sql`：含真实用户与口令哈希，不随包分发。
- 各 sidecar 的 `.venv`：Windows 版本，Linux 上无用；服务器用脚本重建（见第 6 节）。

---

## 1. 上传并解压

```bash
# 本地执行（把包传到服务器）
scp yueyun-4c4g-*.tar.gz root@<服务器IP>:/root/

# 服务器上执行
sudo mkdir -p /opt && cd /opt
sudo tar xzf /root/yueyun-4c4g-*.tar.gz
cd /opt/yueyun-4c4g-*
```

> 校验完整性（可选）：`sha256sum -c yueyun-4c4g-*.tar.gz.sha256`

---

## 2. 一键安装

```bash
# 只装应用（本机跑通，公网访问稍后自己配）
sudo bash deploy/4c4g/install.sh

# 连 Cloudflare Tunnel 一起装好（推荐：给你现有隧道 token 即可全自动）
sudo TUNNEL_TOKEN=eyJhIjoi... bash deploy/4c4g/install.sh
```

脚本会自动完成（**幂等，可重复执行**）：

0. **环境预检**：发行版 / 内存 / 磁盘 / 国内镜像连通性；Node 源不通时自动退回 apt 源并给出手动方案
1. 创建 2GB swap（4G 内存的突发保护）
2. 安装 Node ≥18、MySQL、Python3、rsync、sudo
3. 建运行账号 `yueyun`，把项目同步到 `/opt/yueyun`
4. 写入 `.env`（基于你自有的已授权凭证 + 归一化数据库口令/JWT + 补齐 4G 调优项）
5. 建库 `yueyun_db`、建 `yueyun@127.0.0.1` 账号、导入表结构
6. `npm ci --omit=dev` 安装生产依赖
7. 建 OCR 虚拟环境（`.venv-ocr`）并装依赖
8. 注册并启动 `yueyun-ocr`、`yueyun-web` 两个 systemd 服务
9. 导入演示数据（教师 `teacher/teacher123`、学生 `student1/student123`）
10. 若传了 `TUNNEL_TOKEN`：安装 cloudflared 并注册为服务

**首次约 8~15 分钟**（主要在 pip 装 OCR 依赖）。结束时屏幕上会打印数据库口令，**请复制保存**。

### 「一键」覆盖到哪、还差什么

| 环节 | 是否自动 | 说明 |
| --- | --- | --- |
| 上传包到服务器 | ❌ | `scp`（或腾讯云控制台的「上传文件」） |
| 系统/依赖/数据库/服务/密钥 | ✅ | 全自动 |
| 公网访问 | ⚠️ | 给 `TUNNEL_TOKEN` 就自动；否则自己配 Nginx + 域名证书 |
| AI 密钥 | ⚠️ | 需自行填写（本包不含密钥，见 `ENV_TEMPLATE.txt`） |
| 域名解析 / DNS | ❌ | 在你自己的域名控制台操作，脚本无法代劳 |
| 可选的演唱测评 / 剧本比对 | ❌ | 单独跑 `install-sidecars.sh`（不装只影响这两个页面） |

---

## 3. 密钥配置（本包不含任何服务凭证）

> 🔓 **本包为对外发行版，不包含 `.env`，也不包含任何服务凭证。**
> 请将根目录 `ENV_TEMPLATE.txt` 复制为 `.env`，填入自有或经授权的 ServiceID / AppID / API Key。

安装脚本会把你的 `.env` 放到 `/opt/yueyun/.env`，并自动做两件生产必需的事：

1. **数据库连接归一化**：安装时统一改为本机专用账号
   `yueyun@127.0.0.1`，口令重新生成随机串（绝不去改 MySQL 的 root 账号）。
2. **补齐 4G 调优项**：`PDF_IMPORT_*`、`PDF_OCR_*`、`DB_POOL_SIZE` 等包内没写的键自动补上。

`JWT_SECRET` 若仍是占位符也会替换为随机串。安装结束会把新口令打印出来。

装完核验（可选）：

```bash
grep -E 'API_KEY|API_SECRET|FLOW_ID' /opt/yueyun/.env
sudo systemctl restart yueyun-web
```

| 服务 | 状态 | 说明 |
| --- | --- | --- |
| 讯飞星辰（问答 / 多智能体 / 妙笔润色） | 需自行配置 | `XINGCHEN_AGENT_*` 与 `TEXT_LLM_*` |
| 阿里云百炼 qwen-omni（音韵识腔） | 需自行配置 | `QWEN_ASR_API_KEY` |
| 硅基流动 Kolors（丹青生图） | 需自行配置 | `IMAGE_GENERATION_API_KEY` |

密钥失效时直接改 `.env` 对应行，再 `systemctl restart yueyun-web`。

**不要改大**这些 4G 专用取值：

```ini
DB_POOL_SIZE=6
PDF_IMPORT_CONCURRENCY=1
PDF_IMPORT_MAX_MB=100
PDF_OCR_CONCURRENCY=1
PDF_OCR_DPI=180
PDF_OCR_THREADS=2
TEXT_LLM_USE_LOCAL_YUEJU=false
```

---

## 4. 对外访问（二选一）

### 方案 A：Cloudflare Tunnel（推荐，不用开放端口、自带 HTTPS）

装的时候直接带上 token 就省掉这一步：

```bash
sudo TUNNEL_TOKEN=<你的TUNNEL_TOKEN> bash deploy/4c4g/install.sh
```

已经装完了再补也可以：

```bash
sudo cloudflared service install <你的TUNNEL_TOKEN>
sudo systemctl status cloudflared --no-pager
```

在 Cloudflare 控制台把域名的 Tunnel 服务指向 `http://127.0.0.1:3000`。

### 方案 B：Nginx 反向代理

```bash
sudo apt install -y nginx
sudo cp /opt/yueyun/deploy/4c4g/nginx-yueyun.conf /etc/nginx/sites-available/yueyun
sudo ln -sf /etc/nginx/sites-available/yueyun /etc/nginx/sites-enabled/yueyun
sudo nano /etc/nginx/sites-available/yueyun      # 改 server_name 为你的域名
sudo nginx -t && sudo systemctl reload nginx
```

> ⚠️ **模板里的 `client_max_body_size 1024m;` 不要删。** Nginx 默认只允许 1MB 请求体，
> 大文件上传会返回 413，而前端如果没做错误处理就表现为「按钮点了没反应」。

---

## 5. 验收清单（部署完逐条打勾）

```bash
# 1) 两个服务都在跑
systemctl status yueyun-web yueyun-ocr --no-pager

# 2) 健康检查
curl -fsS http://127.0.0.1:3000/api/system/health && echo
curl -fsS http://127.0.0.1:8768/health && echo

# 3) 并发闸门状态（需教师登录后带 token 访问）
#    GET /api/system/status  看 concurrency 字段
```

浏览器里逐项点一遍：

- [ ] `/app` 能打开，样式与字体正常（不是白屏、不是宋体兜底）
- [ ] 教师账号登录成功（`teacher / teacher123`）
- [ ] 智能问答能流式吐字（不是等很久后一次性出现）
- [ ] **PDF 导入课程**：选一个 PDF → 上传进度条走动 → 生成课程 → 「进入精读」可看
- [ ] 视频播放可拖动进度条
- [ ] 雅集聊天室两个浏览器能互发消息

---

## 6. 可选功能与常用运维

```bash
# 演唱测评 + 剧本比对（可选，装完占 ~700MB 磁盘）
sudo bash deploy/4c4g/install-sidecars.sh
sudo systemctl stop yueyun-singing yueyun-script   # 不演示时停掉，把 CPU 让给 OCR

# 备份（数据库 + 上传文件），建议加 crontab
sudo bash deploy/4c4g/backup.sh

# 看日志
journalctl -u yueyun-web -f
journalctl -u yueyun-ocr -f

# 重启 / 停机
sudo systemctl restart yueyun-web yueyun-ocr
sudo systemctl stop yueyun-web yueyun-ocr

# 内存现状（4G 机器要常看）
free -h && systemctl status yueyun-web --no-pager | grep Memory
```

**升级到新版本**：把新包解压后，用同一套脚本重跑（`rsync` 不会动 `.env` 和 `data/`）：

```bash
sudo bash deploy/4c4g/install.sh      # 会重新同步代码、装依赖、重启服务
```

---

## 7. 内存预算与硬约束（4 核 4GB 能同时跑什么）

| 进程 | 常态 | 上限（systemd 限死） |
| --- | ---: | ---: |
| Node 网关 | 100~250MB | 800MB（`--max-old-space-size=512`） |
| PDF OCR（单任务） | 500~900MB | 1.5GB |
| MySQL | 500~700MB | ~800MB（`mysql-4gb.cnf`） |
| cloudflared | 40~80MB | ~120MB |
| 演唱/剧本 sidecar | 各 100~300MB | 600MB / 800MB |

因此：**PDF 导入同时只跑 1 个任务**（其余排队）、**OCR 只用 1 个 worker**、
**本地 Qwen 微调模型在 4G 机器上永远不要启动**。
超出配额的请求不会拖垮服务，会返回 `503 当前使用人数较多，请稍后重试`。

持久化保护：`Node` 用 `MemoryHigh=650M / MemoryMax=800M`，`OCR` 用 `MemoryHigh=1200M / MemoryMax=1500M`，
再叠加 2GB swap 兜底。

---

## 8. 故障排查

**PDF 导入点了没反应**
1. 浏览器 F12 → Network，看 `/api/course/import/upload/init` 的状态码：
   - `413` → Nginx `client_max_body_size` 没生效（见第 4 节方案 B）
   - `401` → 登录态过期，重新登录
   - `404` → 服务器上的后端代码不是最新（重跑 install.sh）
   - 请求被 Cloudflare 中断（大文件整体上传）→ 已改为 256KB 分片，确认前端产物是最新的
2. 后端日志：`journalctl -u yueyun-web -n 100 --no-pager | grep courseImport`
3. OCR 没起来：`curl http://127.0.0.1:8768/health`；`journalctl -u yueyun-ocr -n 80 --no-pager`

**任务显示「服务刚刚重启，任务已安全暂停」**
设计如此：OCR/AI 中途不盲目续跑，点页面上的「继续导入」即可（`POST /api/course/import/task/:id/resume`）。

**上传大 PDF 超过 100MB 失败**
两条通道各有上限：Cloudflare 侧 100MB（免费版不可调）、应用侧 `PDF_IMPORT_MAX_MB`。
超大资料建议走 Nginx 直连并调大 `PDF_IMPORT_MAX_MB`。

**演唱测评 / 剧本比对 503**
对应 sidecar 未启动：`curl http://127.0.0.1:8765/health`、`curl http://127.0.0.1:8766/health`。

**SPA 白屏 / 还是旧界面**
前端产物带 hash，一般不会命中旧缓存；若前面挂了 Cloudflare，清一次边缘缓存：
`cd /opt/yueyun && npm run deploy:purge`（需 `.env` 配 `CF_ZONE_ID` / `CF_API_TOKEN`）。
