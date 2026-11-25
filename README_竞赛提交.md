# 越韵智传 作品代码与复现说明

## 1. 作品与线上入口

- 作品名称：越韵智传——面向艺术学（戏剧与影视学）一流学科建设的越剧多模态垂类大模型与教学科研数智化创新应用开发
- 作品编码：603412
- 线上 Demo（**推荐先用它体验，无需本地部署**）：https://yueyun.xiaoqingyalove.online:8443/app/
- 技术栈：React 18、TypeScript、Vite、Node.js、Express、MySQL 8、Python 评测侧车、RAG、LoRA。

## 2. 源码包范围

本压缩包提供**已构建的前端产物**、前端源代码、Node 服务端、Python 评测脚本、部署文件、测试脚本、依赖锁定文件、公开演示所需的静态资源与 LoRA 适配器。为保护系统安全与用户隐私，未包含生产数据库、真实用户数据、上传文件、运行日志、`.env`、密钥、ServiceID、AppID、API Key 或 API Secret。

## 3. 目录说明

- `public/app/`：**已构建的前端单页应用（SPA）产物**，由 Node 网关以 `/app/` 前缀直接托管；凭此无需任何前端编译即可运行完整界面。
- `public/assets/`、`public/fonts/`、`public/css/`、`public/js/`、`public/vendor/`：演示静态资源、字体、3D 与试衣素材。
- `src/`：React 前端源代码（仅在需要修改界面时使用）。
- `server/`：Node.js API、数据库初始化与 RAG 评测脚本；Python 虚拟环境已排除。
- `models/`：本地 LoRA 适配器与模型说明，不含第三方生产凭证。
- `data/`：可公开的最小演示音频引用数据；课程 PDF 与运行密钥不随包发送。
- `deploy/`：4 核 4G 部署说明与脚本。
- `tests/`、`scripts/`：回归和验证脚本。
- `ENV_TEMPLATE.txt`：脱敏环境变量模板（**不含任何真实凭证**）。

## 4. 本地复现

1. 安装 Node.js 18、MySQL 8 与 Python 3.10 或兼容版本。
2. 执行 `npm ci` 安装依赖。
3. 复制 `ENV_TEMPLATE.txt` 为 `.env`，填写本地数据库与已授权模型服务的配置。（未填写第三方凭证时，依赖外部模型的页面不可用，但课程精读、知识图谱、教师工作台等本地功能仍可正常浏览。）
4. 建库：先导入 `server/sql/init.sql`（建表结构，23 张表），再运行 `node server/seed.js` 写入基础数据（含演示账号：教师 `teacher/teacher123`、学生 `student1/student123`）。**本包不提供生产库全量导出**，以保证不携带任何真实用户数据与口令哈希。
5. 启动：`npm run dev`（即 `node server/server.js`，**直接托管 `public/app/` 中已构建的前端**），浏览器访问 `http://localhost:3000/app/`。
   - 需要前端热更新时改用 `npm run dev:web`（Vite，端口 5173，`/api` 自动代理到 3000）；
   - 如需重新构建前端，运行 `npm run build:web`，产物输出到 `public/app/`。
6. 演唱测评 / 剧本比对属于可选 Python 侧车，如需现场演示，按 `deploy/` 说明单独启动。

## 5. 模型与接口说明

- RAG：将权威越剧资料整理为可检索片段；A/B 评测使用 2,128 条清洗后的核心片段。
- LoRA：Qwen2.5-0.5B 适配器存放于 `models/yueju_asr_correct/outputs/adapter/`。
- 演唱测评：Python 服务负责音高、节奏和片段偏差分析。
- 识腔、图像生成与部分大模型能力：通过环境变量配置经授权的外部模型服务。生产 ServiceID、AppID 和密钥不得公开；评审复现请使用自有或获授权的凭证。

## 6. 安全提示

请勿将本包中的 `ENV_TEMPLATE.txt` 直接作为生产配置使用；请勿将真实用户数据、生产数据库备份、访问令牌或上传文件加入竞赛材料。
