# 越韵智传 · 越剧教学辅助平台

> 面向越剧文化传承的「学习通」式教学平台，融合智能问答、丹青生图、音韵识腔、演唱测评、剧本比对、板式解析等越剧垂类 AI 工具，配套课程管理、作业、考试、签到、讨论、实时聊天、水墨画板等完整教学链路。
>
> 参赛：第十九届"挑战杯"全国大学生课外学术科技作品竞赛 2026 年度"揭榜挂帅"擂台赛 · 榜题 XH-202620 · 面向一流学科建设的学科垂类大模型与创新应用开发（发榜单位：科大讯飞股份有限公司）

---

## 一、技术栈

| 层 | 技术 |
| --- | --- |
| 前端 | React 18 + TypeScript + Vite（SPA，`/app` 前缀，路由切换导航条常驻 + 墨晕过渡动画） |
| 设计系统 | 水墨写意（墨黑·宣纸白·朱砂红·淡青·赭石），毛笔字标题（马善政/站酷小薇/Noto Serif SC） |
| 后端网关 | Node.js (ESM) + Express |
| Python 分析服务 | FastAPI sidecar × 2（仅本机回环）：演唱测评 `127.0.0.1:8765`（librosa/pyworld/scipy）、剧本比对 `127.0.0.1:8766`（rapidfuzz/jieba/opencc） |
| 纯前端解析 | 板式格律解析（pinyin-pro 内置十三辙韵部表，无后端依赖） |
| 数据库 | MySQL 8（utf8mb4） |
| 实时通讯 | WebSocket（`ws` 库，与 HTTP 同端口共享） |
| 认证 | JWT + bcryptjs |
| 文件上传 | multer（视频流式 Range 播放 / 画板 PNG / 剧本 TXT） |
| AI 服务 | 讯飞星辰工作流 Agent（智能问答/生图/多智能体）、本地微调 Qwen2.5-0.5B+LoRA 越剧纠音模型（可选）、阿里云百炼 qwen-omni-turbo（音频识腔） |

---

## 二、目录结构

```
越韵智传-小组内部版/
├── src/                        # React SPA 前端源码
│   ├── app/                    # 页面组件（AppLayout 共享布局：导航常驻）
│   │   ├── main.tsx            # 路由表（/app 前缀）
│   │   ├── ChatPage.tsx        # 智能问答（流式 + 研墨等待动画 + 毛笔渐显）
│   │   ├── SingingEvalPage.tsx # 演唱测评
│   │   ├── ScriptComparePage.tsx # 剧本比对（左右分栏 + 差异高亮）
│   │   ├── BanshiPage.tsx      # 板式格律解析（纯前端）
│   │   └── ...                 # 其余 20+ 页面
│   ├── shared/
│   │   ├── banshi.ts           # 板式解析引擎（规范表/十三辙/分句/押韵）
│   │   ├── navbar.tsx          # 导航 + 页脚
│   │   └── auth.ts / toast.tsx # 鉴权 / 提示组件
│   └── spa.css / polish.css    # SPA 过渡动画 / 体验打磨
├── public/
│   ├── css/                    # 设计令牌 + 水墨基底 + 组件 + 页面样式
│   ├── app/                    # vite build 产物（SPA）
│   ├── virtual-teacher.html    # 越韵先生（iframe 桥接，数字人）
│   ├── virtual-tryon.html      # 虚拟试衣（iframe 桥接，摄像头）
│   └── 3d-stage.html           # 3D 舞台（iframe 桥接，WebGL）
├── server/                     # Node.js 网关
│   ├── server.js               # 入口，挂载路由 + WebSocket + SPA 回退
│   ├── routes/                 # 21 个路由模块（见 API 概览）
│   ├── services/               # 讯飞 Agent / 生图 / ASR / 本地模型
│   ├── python/
│   │   ├── singing-eval/       # Python sidecar：演唱测评（8765）
│   │   └── script-compare/     # Python sidecar：剧本比对（8766，含测试样本）
│   └── sql/init.sql            # 数据库表结构
├── models/yueju_asr_correct/   # 本地微调越剧模型（可选，serve.py）
├── scripts/start-all.ps1       # 一键启动（Node + 双 sidecar + 隧道）
├── .env                        # 环境变量（参照 .env.example）
└── package.json
```

---

## 三、环境准备

### 1. 软件依赖

- **Node.js** ≥ 18
- **MySQL** 8.x（字符集 utf8mb4）
- **Python** 3.10+（可选，仅演唱测评 / 剧本比对需要；首次启动自动创建 venv 并安装依赖）

### 2. Python 环境说明（演唱测评 / 剧本比对）

两个分析服务均为**独立 venv**（各自 `server/python/<服务>/.venv`），互不污染、不依赖全局包：

| 服务 | venv 位置 | 端口 | 依赖 |
| --- | --- | --- | --- |
| 演唱测评 | `server/python/singing-eval/.venv` | 127.0.0.1:8765 | librosa、pyworld、numpy、scipy、fastapi、uvicorn、python-multipart |
| 剧本比对 | `server/python/script-compare/.venv` | 127.0.0.1:8766 | rapidfuzz、python-Levenshtein、jieba、opencc-python-reimplemented、fastapi、uvicorn、python-multipart |

安装方式二选一：

```powershell
# 方式 A：start-all.ps1 首次启动时自动创建 venv 并安装（推荐）

# 方式 B：手动预装（国内网络可加清华镜像加速）
cd server/python/singing-eval
python -m venv .venv
.venv\Scripts\pip install -r requirements.txt -i https://pypi.tuna.tsinghua.edu.cn/simple

cd ..\script-compare
python -m venv .venv
.venv\Scripts\pip install -r requirements.txt -i https://pypi.tuna.tsinghua.edu.cn/simple
```

> - `pyworld` 在 Windows 上有预编译 wheel（Python 3.10–3.12）；若 pip 尝试源码编译失败，通常是 Python 版本过新，建议 3.10–3.12。
> - 不用 Python 的功能（板式解析为纯前端、其余均为 Node 实现）时，可不装任何 Python 环境，主服务照常运行——两个 sidecar 启动失败仅告警，不影响其他功能。

### 3. 配置 `.env`

参照根目录 `.env.example` 复制为 `.env`，关键项：

```ini
# MySQL
DB_HOST=localhost / DB_USER=root / DB_PASSWORD=xxx / DB_NAME=yueyun_db
# JWT（留空或仍是占位符时会自动生成随机密钥并写入 data/.jwt-secret，生产建议显式配置）
JWT_SECRET=随机串 / JWT_EXPIRES=7d
# 接口文档开关：生产环境默认关闭，需要在线文档时设为 true
API_DOCS_ENABLE=false
# 讯飞星辰工作流 Agent（智能问答/生图/多智能体）
XINGCHEN_AGENT_API_URL=https://xingchen-api.xf-yun.com/workflow/v1/chat/completions
XINGCHEN_AGENT_FLOW_ID=your_workflow_flow_id
XINGCHEN_AGENT_API_KEY / XINGCHEN_AGENT_API_SECRET
# Qwen-ASR 音频识腔（阿里云百炼）
QWEN_ASR_API_KEY=sk-xxx
# 本地微调越剧模型（可选，未启动时自动降级讯飞 Agent）
YUEJU_LLM_LOCAL_URL=http://127.0.0.1:3456
```

---

## 四、启动步骤

### 方式一：一键启动（推荐，Windows）

```powershell
npm install
npm run build:web            # 构建 SPA（首次或前端有改动时）
powershell -ExecutionPolicy Bypass -File scripts/start-all.ps1
```

脚本会依次启动：演唱测评 sidecar（8765）→ 剧本比对 sidecar（8766，首次自动建 venv 装依赖）→ Node 主服务（3000）。sidecar 失败仅告警不阻断主服务。

### 方式二：手动启动

```bash
# 1. 初始化数据库
mysql -u root -p < server/sql/init.sql        # 或 PowerShell 见下
Get-Content -Path server/sql/init.sql -Raw -Encoding UTF8 | mysql -u root -p

# 2. 演示数据（幂等）
node server/seed.js

# 3. Python sidecar（可选，两个终端）
cd server/python/singing-eval  && python -m venv .venv && .venv/Scripts/pip install -r requirements.txt && .venv/Scripts/python -m uvicorn app:app --host 127.0.0.1 --port 8765
cd server/python/script-compare && python -m venv .venv && .venv/Scripts/pip install -r requirements.txt && .venv/Scripts/python -m uvicorn app:app --host 127.0.0.1 --port 8766

# 4. 主服务
npm start        # 生产；npm run dev 为 nodemon 热重启
```

启动成功后访问 **<http://localhost:3000/app>**（SPA 入口）。

---

## 五、演示账号

| 角色 | 用户名 | 密码 | 真名 | 说明 |
| --- | --- | --- | --- | --- |
| 教师 | `teacher` | `teacher123` | 王砚秋 | 越剧研究方向副教授，已预置课程《越剧流派赏析》 |
| 学生 | `student1` | `student123` | 林清音 | 已选课，预置讨论帖提问 |
| 学生 | `student2` | `student123` | 苏墨白 | 已选课 |

预置：1 门课程（选课码 `YYZC2026`）、1 个作业、1 套期中测验（5 题）、2 条讨论。

---

## 六、功能矩阵

### 教学平台（学习通式）

| 功能 | 教师 | 学生 |
| --- | --- | --- |
| 注册登录 / 资料编辑 | ✓ | ✓ |
| 课程管理 | 建课 / 删课 / 生成选课码 | 选课大厅 / 输入选课码加入 |
| 课程视频 | 上传 / 删除 / 流播放 | 观看（HTTP Range 分段） |
| 作业 | 布置 / 查看 / 批改打分+评语 | 提交 / 修改 / 查看成绩 |
| 考试 | 创建 / 出题 / 批改简答 | 倒计时答题 / 交卷 / 查成绩 |
| 签到 | 开启（4 位码）/ 记录（出勤/迟到/缺勤） | 输入签到码 |
| 课程讨论 / 实时聊天室 | ✓ | ✓ |
| 学习路径 / 知识飞轮复习 | ✓（知识飞轮） | ✓ |
| 水墨画板 / 个人中心 | ✓ | ✓ |

### 越剧垂类 AI 工具箱

| 工具 | 路由 | 说明 |
| --- | --- | --- |
| 越韵问答 | `/app/chat` | 讯飞星辰 Agent 流式对话，研墨等待动画 + 毛笔渐显，带知识卡片 |
| AI 学习助手 / 多智能体 | `/app/agent` `/app/multi-agent` | 单/多智能体协作，优先本地微调模型 |
| 知识图谱 | `/app/kg` | 越剧知识可视化 |
| 丹青生图 | `/app/image` | 文生越剧主题画作 |
| 音韵识腔 | `/app/audio` | qwen-omni-turbo 听唱腔判 12 大流派（含置信度与依据） |
| 越韵先生 | `/app/virtual-teacher` | 数字人虚拟教师（摄像头/数字人 iframe 桥接） |
| **演唱测评** | `/app/singing-eval` | Python DSP：f0 提取 + DTW 对齐，音准（音分偏差）/ 节奏（时值差）双维评分与逐段报告；预留作业批改导出接口 |
| **剧本比对** | `/app/script-compare` | Python：清洗/繁简转换/三级对齐（场次→唱段念白→整句），左右分栏对照，差异高亮（增绿/删红/改橙），自动标签（情节/唱词/人物/结局），溯源关键词预留 RAG 接口，导出 Markdown 报告 |
| **板式解析** | `/app/banshi` | 纯前端：慢板/中板/嚣板/流水板句式校验（二二三/三三四拆分），中州韵十三辙押韵判定与平仄参考，判定阈值透明可查，RAG 范例检索预留 |
| 虚拟试衣 / 3D 舞台 | `/app/virtual-tryon` `/app/stage` | 摄像头试戏服 / WebGL 舞台（iframe 桥接） |
| 雅集聊天 | `/app/chatroom` | WebSocket 实时聊天 |

> 演唱测评 / 剧本比对 / 板式解析均为**教学辅助参考工具**：结果统一标注「参考差异」，不使用「错误 / 不合格」等判定性措辞，页面显著位置提示「差异判定请以专业教师为准」。

---

## 七、API 概览

所有接口统一返回 `{ code, message, data }`，`code=0` 表示成功。
接口文档：开发环境为 `/api-docs`；生产环境默认关闭（公开接口结构没必要暴露给公网），
确需在线文档时在 `.env` 里设 `API_DOCS_ENABLE=true`。

| 模块 | 前缀 | 关键端点 |
| --- | --- | --- |
| 认证 | `/api/auth` | `POST /register` `POST /login` `GET /me` `PUT /me` |
| 课程/作业/考试/签到/视频/讨论 | `/api/course` 等 | 见 Swagger（需开启 `API_DOCS_ENABLE`） |
| 智能问答 | `/api/chat` | 会话历史 / 收藏（SSE 流式） |
| AI 助手 | `/api/agent` `/api/ai-assist` `/api/multi-agent` | 单智能体 / 辅助 / 多智能体协作 |
| 知识图谱 | `/api/kg` | 节点/关系查询 |
| 知识飞轮 | `/api/knowledge-review` | 复习计划 |
| **演唱测评** | `/api/singing-eval` | `POST /analyze`（音频+参考→评分报告）、导出预留 `/export/*` |
| **剧本比对** | `/api/script-compare` | `POST /compare`（双 TXT 上传）、`GET /demo`（内置样本）、`POST /keywords`（RAG 溯源预留） |
| 生图/音频/TTS/收藏/画板 | `/api/image` 等 | 详见 Swagger |
| 系统 | `/api/system` | 健康检查 |
| WebSocket | `/ws?token=xxx` | 实时聊天室 |

---

## 八、关键设计说明

- **SPA 架构**：React Router + 共享 `AppLayout`，导航条/页脚常驻不重挂，路由切换播放「墨晕扩散」过渡（mask 径向晕开 + 湿墨收干），消除整页刷新观感；重命令式页面（摄像头/数字人/WebGL）以 iframe 桥接挂载在 SPA 内。
- **sidecar 网关**：Node 网关将音频/文本分析转发至本机回环的 Python FastAPI 服务，文件直传 multipart；SSE 响应已豁免 compression 中间件，保证流式不粘包。
- **演唱测评**：重采样/降噪/人声预处理 → pyworld f0 → DTW 对齐 → 音分偏差与节奏时值差双维评分，容差参数在 `analyzer.py` 可调。
- **剧本比对**：三级对齐（场次 Needleman-Wunsch → 唱段/念白签名 → 整句 rapidfuzz+jieba 语义相似度），差异自动打标签并生成溯源检索词（RAG 接口预留）。
- **板式解析**：规范表与十三辙韵部表内置前端，判定阈值（符合/变体/疑似）页面透明展示供教师核对。
- **视频流播放**：HTTP Range 分段（206），可拖动进度条。
- **WebSocket 鉴权**：URL `?token=xxx` 验证 JWT；消息持久化 `chat_messages`。
- **幂等 seed**：`seed.js` 可重复执行。

---

## 九、常用命令

```bash
npm run dev          # nodemon 后端热重启
npm run dev:web      # vite 前端开发服务器
npm run build:web    # 构建 SPA 到 public/app/
npm run typecheck    # TS 类型检查
npm test             # 后端 Jest 测试
```

---

## 十、常见问题

**Q: 启动报 `EADDRINUSE`？**
A: `Stop-Process -Name node,python -Force`（Windows）清理旧进程后重启。

**Q: 演唱测评 / 剧本比对返回 503 或提示服务离线？**
A: 对应 Python sidecar 未启动。手动检查 `http://127.0.0.1:8765/health`、`http://127.0.0.1:8766/health`；首次启动需联网安装依赖（rapidfuzz/librosa 等），详见 `.tools/runtime-logs/` 下日志。

**Q: Python 依赖装不上（pip 超时 / pyworld 编译失败）？**
A: ① 国内网络加镜像：`pip install -r requirements.txt -i https://pypi.tuna.tsinghua.edu.cn/simple`；② pyworld 编译失败多为 Python 版本过新（无预编译 wheel），改用 3.10–3.12；③ 依赖只装进 sidecar 自己的 `.venv`，与全局 Python 无关，装错可删掉 `.venv` 目录重来。

**Q: 剧本比对上传后版本名显示乱码？**
A: 已在网关修复 multipart 中文文件名（latin-1→UTF-8 还原）；若仍异常，确认文件名为「剧目名_版本_年代.txt」格式。

**Q: 音频识腔判定不出流派？**
A: 确认 `.env` 中 `QWEN_ASR_API_KEY` 有效且模型为 `qwen-omni-turbo`。

**Q: SPA 页面白屏或样式异常？**
A: 前端有改动需 `npm run build:web` 后 Ctrl+F5 强刷；确认访问的是 `/app` 入口。

---

## 十一、License

本项目用于第十九届"挑战杯"全国大学生课外学术科技作品竞赛 2026 年度"揭榜挂帅"擂台赛参赛演示。
