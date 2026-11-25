// 越韵智传 · 服务入口
import express from 'express';
import cors from 'cors';
import compression from 'compression';
import path from 'path';
import { existsSync } from 'fs';
import http from 'http';
import { fileURLToPath } from 'url';
import config from './config.js';
import pool, { testDbConnection, getDbStatus } from './db.js';
import { notFound, errorHandler } from './middleware/error.js';
import { requestLogger } from './middleware/requestLogger.js';
import { initWebSocket } from './ws.js';
import logger from './utils/logger.js';

import authRoutes from './routes/auth.js';
import chatRoutes from './routes/chat.js';
import imageRoutes from './routes/image.js';
import audioRoutes from './routes/audio.js';
import ttsRoutes from './routes/tts.js';
import favoriteRoutes from './routes/favorite.js';
import courseRoutes from './routes/course.js';
import courseContentRoutes from './routes/courseContent.js';
import courseImportRoutes from './routes/courseImport.js';
import assignmentRoutes from './routes/assignment.js';
import attendanceRoutes from './routes/attendance.js';
import videoRoutes from './routes/video.js';
import examRoutes from './routes/exam.js';
import discussionRoutes from './routes/discussion.js';
import drawRoutes from './routes/draw.js';
import aiAssistRoutes from './routes/aiAssist.js';
import agentRoutes from './routes/agent.js';
import multiAgentRoutes from './routes/multiAgent.js';
import kgRoutes from './routes/kg.js';
import knowledgeReviewRoutes from './routes/knowledgeReview.js';
import singingEvalRoutes from './routes/singingEval.js';
import scriptCompareRoutes from './routes/scriptCompare.js';
import poseEvalRoutes from './routes/poseEval.js';
import systemRoutes from './routes/system.js';
import apiDocsRoutes from './openapi.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const log = logger.module('APP');

const app = express();
const publicRoot = path.join(__dirname, '..', 'public');

// gzip 压缩：SPA 的 JS/CSS 与字体分片走公网隧道时显著提速
app.use(compression({
  // SSE（text/event-stream）不做压缩：zlib 会把流式 token 攒成大包再吐出，
  // 破坏逐字输出体验，这里显式豁免
  filter: (req, res) => {
    const ct = String(res.getHeader('Content-Type') || '');
    if (ct.startsWith('text/event-stream')) return false;
    return compression.filter(req, res);
  },
}));

// CORS 跨域：生产环境严格按白名单校验，开发环境放开便于本地跨端口联调
// 注意：字体/CSS/JS/图片等静态资源必须无条件放行（返回 false 而不是 Error）。
// 浏览器加载 @font-face 会带 Origin 头，若这里抛错会变成 500，
// 表现为页面字体全部加载失败、3D 页长时间卡在加载（历史上踩过：
// 用 IP 或未登记域名访问时，588 个字体分片全部 500）。
const STATIC_ASSET_RE = /\.(?:js|css|woff2?|ttf|otf|png|jpe?g|gif|svg|webp|ico|map|vrm|glb|gltf|bin|mp3|wav|mp4|webm)$/i;
app.use(cors({
  origin: (origin, cb) => {
    // 无 Origin（同源请求/非浏览器客户端）直接放行
    if (!origin) return cb(null, true);
    // 白名单内来源放行
    if (config.corsOrigins.includes(origin)) return cb(null, true);
    // 开发环境放开（便于本地调试）
    if (config.nodeEnv !== 'production') return cb(null, true);
    // 生产环境非白名单来源：静态资源只“不附加 CORS 头”，不能报错中断
    return cb(null, false);
  },
  credentials: true,
}));

// 安全响应头（中危加固）：防点击劫持、MIME 嗅探、信息泄露；生产/HTTPS 下启用 HSTS
app.use((req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'SAMEORIGIN');
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  res.setHeader('X-XSS-Protection', '1; mode=block');
  res.setHeader('X-Permitted-Cross-Domain-Policies', 'none');
  // 体感跟演仅允许当前站点调用摄像头；麦克风允许当前站点使用（语音提问/唱腔识别用）；定位保持关闭。
  res.setHeader('Permissions-Policy', 'camera=(self), microphone=(self), geolocation=()');
  // 通过 HTTPS 访问时启用 HSTS（Cloudflare 隧道下 X-Forwarded-Proto 为 https）
  if (
    config.nodeEnv === 'production' ||
    req.secure ||
    req.headers['x-forwarded-proto'] === 'https'
  ) {
    res.setHeader('Strict-Transport-Security', 'max-age=15552000; includeSubDomains');
  }
  // 基础 CSP：放行本站及 3D/试衣/知识图谱所需 CDN，避免破坏页面功能
  res.setHeader(
    'Content-Security-Policy',
    "default-src 'self'; " +
      "script-src 'self' 'unsafe-inline' 'unsafe-eval' https://cdn.jsdelivr.net https://unpkg.com; " +
      "style-src 'self' 'unsafe-inline' https://cdn.jsdelivr.net https://unpkg.com; " +
      "img-src 'self' data: blob: https:; " +
      "font-src 'self' data:; " +
      "connect-src 'self' blob: data: ws: wss: https:; " +
      "media-src 'self' blob: data:; " +
      "worker-src blob:; " +
      "object-src 'none'; " +
      "base-uri 'self'; " +
      "frame-ancestors 'self'"
  );
  next();
});

// 关闭框架版本泄露（X-Powered-By）
app.disable('x-powered-by');

// 解析 JSON 与静态文件
// 4 核 4GB 单机下 Node 堆被限制在 512MB（见 deploy/4c4g/yueyun-web.service），
// 50MB 的 JSON 请求体解析后常会膨胀数倍，足以触发 GC 抖动甚至被 OOM Killer 干掉。
// 实际业务里最大的 JSON 也只有课程正文级别，8MB 有充足余量；
// 大文件（视频、PDF、音频）一律走 multipart 流式落盘，不进堆。
app.use(express.json({ limit: '8mb' }));
app.use(express.urlencoded({ extended: true, limit: '8mb' }));

// 请求日志中间件（在路由之前）
app.use(requestLogger);

// 注意：这里原本有一条兼容逻辑，允许 /api/course/*/pdf?token=<JWT> 把查询串里的
// token 提升为 Authorization 头（因为 iframe / 新标签页无法自定义请求头）。
// 但 JWT 一旦进入 URL，就会残留到浏览器历史、Referer 以及 Nginx/Cloudflare 访问日志，
// 被窃取后可直接复用登录态。前端已改为「带 Authorization 头 fetch → blob URL」，
// 因此该兼容通道整体移除，PDF 接口只接受标准的 Authorization 头。

// API 文档（Swagger UI）
// 生产环境默认关闭：它会公开完整接口结构与参数，对 4C4G 这类公网小机器是多余的信息暴露面。
// 需要演示/联调时在 .env 里设 API_DOCS_ENABLE=true 即可恢复。
const apiDocsEnabled = config.nodeEnv !== 'production' || process.env.API_DOCS_ENABLE === 'true';
if (apiDocsEnabled) {
  app.use('/api-docs', apiDocsRoutes);
}

// 虚拟试衣素材文件名固定分辨率版本，允许浏览器长期缓存，减少重复进入时的等待。
app.use('/assets/virtual-tryon', express.static(
  path.join(__dirname, '..', 'public', 'assets', 'virtual-tryon'),
  { maxAge: '30d', immutable: true }
));

// 优先发送构建时生成的 Brotli 版本，显著减少大型 VRM/GLB 与运行库的传输量。
app.use((req, res, next) => {
  if (!['GET', 'HEAD'].includes(req.method) || !/\.(?:js|vrm|glb)$/i.test(req.path)) return next();
  if (!/\bbr\b/.test(req.headers['accept-encoding'] || '')) return next();
  const requestedFile = path.resolve(publicRoot, `.${req.path}`);
  if (!requestedFile.startsWith(`${publicRoot}${path.sep}`)) return next();
  const compressedFile = `${requestedFile}.br`;
  if (!existsSync(compressedFile)) return next();
  res.setHeader('Content-Encoding', 'br');
  res.setHeader('Vary', 'Accept-Encoding');
  res.setHeader('Cache-Control', 'public, max-age=2592000, immutable');
  // 注意：res.type() 遇到含 "/" 的字符串会原样当作 MIME 类型，绝不能传绝对路径；
  // 用扩展名推断（.vrm/.glb → model/gltf-binary，其余 js → application/javascript）。
  res.type(/\.(?:vrm|glb)$/i.test(requestedFile) ? 'model/gltf-binary' : 'application/javascript');
  res.sendFile(compressedFile);
});

// 3D 大资源允许长期缓存（资源更新时需在引用处带 ?v= 版本号，并重跑 precompress 脚本）；
// HTML 等界面文件保持可即时更新。
app.use('/assets/3d-stage', express.static(path.join(publicRoot, 'assets', '3d-stage'), { maxAge: '30d', immutable: true }));

// 带版本号（?v=）的静态资源：浏览器可长期缓存（immutable），版本号变更即视为新 URL 自动失效。
// 放在 express.static 之前，手动发送并附加长缓存头，避免被 maxAge:0 覆盖。
app.use((req, res, next) => {
  if (req.method !== 'GET' && req.method !== 'HEAD') return next();
  if (!req.query.v) return next();
  if (!/\.(?:js|css|png|jpg|jpeg|gif|svg|webp|ico|woff2?|ttf|glb|vrm)$/i.test(req.path)) return next();
  const filePath = path.join(publicRoot, req.path);
  if (!filePath.startsWith(`${publicRoot}${path.sep}`) || !existsSync(filePath)) return next();
  res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
  return res.sendFile(filePath);
});

// 根路径引导到 React SPA（须在 express.static 之前，否则静态 index.html 会先命中）
app.get('/', (req, res) => res.redirect(302, '/app/'));

// 已删除的旧版页面 URL → SPA 对应路由（老书签/外链不 404）
const LEGACY_PAGE_MAP = {
  '/index.html': '/app/chat',
  '/login.html': '/app/login',
  '/dashboard.html': '/app/dashboard',
  '/course-list.html': '/app/courses',
  '/course-detail.html': '/app/course-detail',
  '/exam.html': '/app/exam',
  '/assignment.html': '/app/assignment',
  '/profile.html': '/app/profile',
  '/chatroom.html': '/app/chatroom',
  '/learning-path.html': '/app/learning-path',
  '/knowledge-review.html': '/app/knowledge-review',
  '/admin.html': '/app/admin',
  '/agent.html': '/app/agent',
  '/multi-agent.html': '/app/multi-agent',
  '/kg.html': '/app/kg',
  '/image.html': '/app/image',
  '/audio.html': '/app/audio',
  '/draw.html': '/app/draw',
};
app.use((req, res, next) => {
  const target = LEGACY_PAGE_MAP[req.path];
  if (target) return res.redirect(302, target);
  next();
});

app.use(express.static(publicRoot, { maxAge: 0 }));
// 说明：用户上传的视频/画板**不再**通过静态目录对外裸露。
// 原先这里挂了 app.use('/uploads', express.static(<项目根>/uploads))，
// 而 /api/video/:id/play 与 /api/drawing/:id/image 已经各自做了课程成员/本人校验，
// 静态目录等于给了一条绕过鉴权的旁路（拿到文件名即可读他人视频与画作）。
// 前端也统一走上面两个带鉴权的接口（fetch + blob），删除该挂载不影响功能。
//
// 注：AI 生成图存放在 public/uploads 下，由上面的 express.static(publicRoot) 正常提供。

// API 路由
app.use('/api/auth', authRoutes);
app.use('/api/chat', chatRoutes);
app.use('/api/image', imageRoutes);
app.use('/api/audio', audioRoutes);
app.use('/api/tts', ttsRoutes);
app.use('/api/favorite', favoriteRoutes);
app.use('/api/course', courseRoutes);
app.use('/api/course', courseContentRoutes);
app.use('/api/course', courseImportRoutes);
app.use('/api/assignment', assignmentRoutes);
app.use('/api/attendance', attendanceRoutes);
app.use('/api/video', videoRoutes);
app.use('/api/exam', examRoutes);
app.use('/api/discussion', discussionRoutes);
app.use('/api/drawing', drawRoutes);
app.use('/api/ai-assist', aiAssistRoutes);
app.use('/api/agent', agentRoutes);
app.use('/api/multi-agent', multiAgentRoutes);
app.use('/api/kg', kgRoutes);
app.use('/api/knowledge-review', knowledgeReviewRoutes);
app.use('/api/singing-eval', singingEvalRoutes);
app.use('/api/script-compare', scriptCompareRoutes);
app.use('/api/pose-eval', poseEvalRoutes);
app.use('/api/system', systemRoutes);

// 健康检查：包含数据库状态与关键配置完整性
// 必须自带 try/catch：健康检查常被探针高频调用，一旦抛错会让探针判定服务已死并触发重启风暴。
app.get('/api/health', async (req, res) => {
  try {
    const dbStatus = await getDbStatus();
    const aiConfigOk = Boolean(
      (config.xingchenAgent.httpUrl && config.xingchenAgent.flowId && config.xingchenAgent.apiKey && config.xingchenAgent.apiSecret)
      || (config.xingchenAgent.wsUrl && config.xingchenAgent.apiKey && config.xingchenAgent.appId)
    );
    const asrConfigOk = Boolean(config.qwenAsr.apiKey);
    const statusCode = dbStatus.connected ? 200 : 503;
    res.status(statusCode).json({
      code: dbStatus.connected ? 0 : 500,
      message: dbStatus.connected ? 'ok' : '数据库连接异常',
      data: {
        status: dbStatus.connected ? 'running' : 'degraded',
        db: dbStatus,
        ai: { configured: aiConfigOk },
        asr: { configured: asrConfigOk },
        docs: '/api/system/status',
      },
    });
  } catch (err) {
    log.error(`健康检查失败：${err?.message || err}`);
    res.status(503).json({ code: 500, message: '健康检查失败', data: { status: 'degraded' } });
  }
});

// SPA 回退：非 /api 开头的请求返回对应 html 或 index.html
app.get(/^\/(?!api|uploads).*/, (req, res, next) => {
  const reqPath = req.path;
  // 已有 .html 后缀或静态资源交给 express.static 处理
  if (/\.\w+$/.test(reqPath)) return next();
  // React SPA（/app/*）：无后缀路径回退到 React 入口，路由由前端接管
  if (reqPath === '/app' || reqPath.startsWith('/app/')) {
    // 入口 HTML 禁用启发式缓存：发版后引用的 bundle 文件名变化需立即生效
    res.setHeader('Cache-Control', 'no-cache');
    return res.sendFile(path.join(publicRoot, 'app', 'index.html'));
  }
  // 其余无后缀路径（含 /）统一引导到 React SPA
  res.redirect(302, '/app/');
});

// 404
app.use('/api', notFound);

// 全局错误处理（必须最后）
app.use(errorHandler);

// 创建 HTTP server 并挂载 WebSocket
const server = http.createServer(app);
const { wss, poseWss } = initWebSocket(server);

// 启动
const PORT = config.port;
testDbConnection().then(() => {
  server.listen(PORT, () => {
    log.success('========================================');
    log.success('  越韵智传 · 越剧教学平台已启动');
    log.success(`  地址: http://localhost:${PORT}`);
    log.success(`  WebSocket: ws://localhost:${PORT}/ws`);
    log.success(`  环境: ${config.nodeEnv}`);
    log.success(`  健康检查(公开): http://localhost:${PORT}/api/system/health`);
    log.success(`  系统状态(需登录教师): http://localhost:${PORT}/api/system/status`);
    log.success(`  API 文档: ${apiDocsEnabled ? `http://localhost:${PORT}/api-docs` : '生产环境已关闭（设 API_DOCS_ENABLE=true 开启）'}`);
    log.success('========================================');
  });
});

// 进程级兜底：避免一个未捕获异常直接让服务静默退出（4C4G 上没有多余的进程可以顶上来）
// 注意：这两个 handler 只记录错误，不改变进程状态。
process.on('unhandledRejection', (reason) => {
  log.error(`未处理的 Promise 拒绝：${reason?.stack || reason?.message || reason}`);
});

// systemd/容器停止时不再直接掐断正在响应的 HTTP 请求。
let shuttingDown = false;
async function shutdown(signal, exitCode = 0) {
  if (shuttingDown) return;
  shuttingDown = true;
  log.info(`收到 ${signal}，正在停止接收新请求…`);
  const forceTimer = setTimeout(() => {
    log.error('优雅退出超时，强制结束进程');
    // 兜底才强断：正常路径下应已自然结束
    server.closeAllConnections?.();
    process.exit(exitCode || 1);
  }, 15_000);
  forceTimer.unref();

  // 先关 WebSocket：否则长连接会一直占着 server.close() 的回调，只能等 15s 被强杀
  try {
    for (const client of [...(wss?.clients || []), ...(poseWss?.clients || [])]) {
      try { client.close(1001, '服务正在重启'); } catch { /* 忽略单个连接关闭异常 */ }
    }
    wss?.close();
    poseWss?.close();
  } catch (err) {
    log.error(`关闭 WebSocket 失败：${err?.message || err}`);
  }

  server.close(async () => {
    try {
      await pool.end();
      log.info('HTTP 与数据库连接已安全关闭');
      process.exit(exitCode);
    } catch (err) {
      log.error(`关闭数据库连接失败：${err?.message || err}`);
      process.exit(exitCode || 1);
    }
  });

  // 只关闭「空闲的」keep-alive 连接：它们没有正在处理的请求，留着只会让
  // server.close() 的回调一直等不到。正在响应的请求会继续跑完（这才是优雅退出）。
  // 注意不要在这里用 closeAllConnections()——那会把进行中的请求一起掐断。
  server.closeIdleConnections?.();
}

// uncaughtException 放在 shutdown 定义之后注册，避免任何时序上的疑虑。
// 同步异常通常意味着进程状态已不可信，交给 systemd 重启比带病运行更安全；
// 退出码必须非 0，否则 Restart=on-failure 不会触发重启
// （例如端口被占用时进程会当作正常退出，服务就再也起不来了）。
process.on('uncaughtException', (err) => {
  log.error(`未捕获异常：${err?.stack || err?.message || err}`);
  shutdown('uncaughtException', 1);
});

process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));

export default app;
