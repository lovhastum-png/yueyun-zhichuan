// 演唱测评路由（Node 网关层）
// ============================================================
// 真正的音频分析由 Python FastAPI sidecar 完成（server/python/singing-eval，
// librosa + pyworld + DTW），本层只负责：
//   JWT 鉴权 / 上传校验（扩展名 + RIFF 魔数 + 大小）/ 限流 / 转发 / 降级提示。
//
// 【合规约束】该功能为教学演示辅助工具：
//   仅评估音准与节奏板眼，不识别咬字、润腔、尖团字、气息；
//   所有分数均为【参考分】，不能替代专业老师听辨打分。
// ============================================================
import { Router } from 'express';
import path from 'path';
import fs from 'fs';
import fsp from 'fs/promises';
import { randomUUID, createHash } from 'crypto';
import multer from 'multer';
import { authRequired } from '../middleware/auth.js';
import { success, fail, asyncHandler } from '../middleware/error.js';
import { rateLimit } from '../middleware/rateLimit.js';
import { createGate } from '../middleware/concurrency.js';
import logger from '../utils/logger.js';
import {
  sendReportToMultiAgent,
  submitToAiGrading,
  pushToLearningPlatform,
} from '../services/singingEval/exportAdapters.js';
import { assessSingingAccuracy } from '../services/singingEval/aiFeedback.js';

const log = logger.module('SINGING_EVAL');

// Python 分析服务地址：仅本机回环，不经公网隧道
const PYTHON_URL = process.env.SINGING_EVAL_URL || 'http://127.0.0.1:8765';
const PYTHON_TIMEOUT_MS = 120000;

// ---------- 分片上传 + 异步分析（长音频友好）----------
// 背景：公网链路（Cloudflare 免费版）对单个 HTTP 请求有 100s 硬超时，
// 长音频"一次 multipart 上传 + 同步等分析"必然被掐断。
// 因此提供：init → 分片追加(每片 ≤4MB) → complete(立即返回) → 轮询 task 取结果。
const CHUNK_TASK_DIR = path.resolve('data/singing-tasks');
const REF_CACHE_DIR = path.resolve('data/singing-refs');   // 范本秒传缓存（按 SHA-256）
const CHUNK_LIMIT_PER_FILE = 60 * 1024 * 1024;   // 单文件上限 60MB（约 10 分钟 48kHz 单声道）
const ASYNC_PYTHON_TIMEOUT_MS = 15 * 60 * 1000;  // 长音频分析给足 15 分钟
const TASK_TTL_MS = 30 * 60 * 1000;              // 任务记录 30 分钟后回收

/** taskId -> { status, dir, studentPath, refPath, report, error, createdAt, size:{student,ref} } */
const chunkTasks = new Map();
/** 串行执行队列：Python sidecar 单 worker，排队即可，避免并发打满 4 核 */
let analysisChain = Promise.resolve();

async function cleanupTask(id) {
  const t = chunkTasks.get(id);
  if (!t) return;
  chunkTasks.delete(id);
  try { await fsp.rm(t.dir, { recursive: true, force: true }); } catch { /* 忽略 */ }
}

/** RIFF/WAVE 魔数校验（文件版）：读前 12 字节 */
async function isRiffWavFile(p) {
  const fd = await fsp.open(p, 'r');
  try {
    const buf = Buffer.alloc(12);
    await fd.read(buf, 0, 12, 0);
    return buf.toString('ascii', 0, 4) === 'RIFF' && buf.toString('ascii', 8, 12) === 'WAVE';
  } finally {
    await fd.close();
  }
}

/** 已有文件的字节数；文件不存在返回 0（分片续传用） */
async function statSize(p) {
  try {
    return (await fsp.stat(p)).size;
  } catch {
    return 0;
  }
}

/** 后台执行一次分析：流式读文件 → 转发 Python → 写回任务状态 */
async function runAnalysis(id) {
  const t = chunkTasks.get(id);
  if (!t) return;
  t.status = 'running';
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), ASYNC_PYTHON_TIMEOUT_MS);
  try {
    const fd = new FormData();
    // Node 22：openAsBlob 流式转 Blob，不占堆内存（4G 机器红线）
    fd.append('studentAudio', await fs.openAsBlob(t.studentPath, { type: 'audio/wav' }), 'student.wav');
    fd.append('refAudio', await fs.openAsBlob(t.refPath, { type: 'audio/wav' }), 'reference.wav');
    const resp = await fetch(`${PYTHON_URL}/analyze`, { method: 'POST', body: fd, signal: controller.signal });
    const payload = await resp.json().catch(() => null);
    if (!resp.ok || !payload) {
      t.error = typeof payload?.detail === 'string' ? payload.detail : '音频分析失败，请确认两个 WAV 文件完整可用';
      t.status = 'error';
      log.warn(`异步分析失败 task=${id}: ${t.error}`);
    } else {
      t.report = payload;
      t.status = 'done';
      log.info(`异步分析完成 task=${id}`);
    }
  } catch (err) {
    t.error = err.name === 'AbortError'
      ? '演唱计算超时，请使用 3–120 秒的唱段重试；若持续超时，请管理员检查分析服务资源与日志'
      : '演唱分析服务连接中断或未启动，请稍后重试；若持续失败，请管理员检查分析服务';
    t.status = 'error';
    log.warn(`异步分析异常 task=${id}: ${t.error}`);
  } finally {
    clearTimeout(timer);
    // 文件计算后即可释放；报告保留 30 分钟，避免响应在公网丢失后无法重取。
    try { await fsp.rm(t.dir, { recursive: true, force: true }); } catch { /* 忽略 */ }
    setTimeout(() => cleanupTask(id), TASK_TTL_MS).unref?.();
  }
}


const router = Router();
router.use(authRequired);

// 测评限流：每用户每分钟 6 次（DTW 计算有一定开销）
const evalLimiter = rateLimit({ windowMs: 60000, max: 6, message: '演唱测评请求过于频繁，请稍后再试' });

// 报告流转限流：与测评分开计数。用户点「多智能体/AI批改/学习通」不该消耗测评配额，
// 但 AI 批改会调 LLM，仍需要单独的限流保护下游。
const exportLimiter = rateLimit({ windowMs: 60000, max: 12, message: '报告流转请求过于频繁，请稍后再试' });

// 并闸：每个测评请求持有 2×25MB 音频 Buffer，且下游 Python sidecar 是单 worker。
// 不设限的话一个班级同时上传会把 Node 堆和 Python 进程一起打满。
const singingGate = createGate({ name: 'singing-eval', max: 2, queueLimit: 6 });

// multer：内存存储，双文件字段，限制 25MB，仅 WAV
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 25 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase();
    if (ext === '.wav') return cb(null, true);
    cb(new Error('仅支持 WAV 格式音频'));
  },
});

// RIFF/WAVE 魔数校验：防止改后缀的假 WAV 进入 Python 服务
function isRiffWav(buf) {
  return buf.length > 12
    && buf.toString('ascii', 0, 4) === 'RIFF'
    && buf.toString('ascii', 8, 12) === 'WAVE';
}

// POST /api/singing-eval/analyze —— 演唱测评主接口
router.post(
  '/analyze',
  evalLimiter,
  singingGate,
  upload.fields([
    { name: 'studentAudio', maxCount: 1 },
    { name: 'refAudio', maxCount: 1 },
  ]),
  asyncHandler(async (req, res) => {
    const stu = req.files?.studentAudio?.[0];
    const ref = req.files?.refAudio?.[0];
    if (!stu || !ref) {
      return fail(res, '请同时上传「学生演唱」与「标准范本」两个 WAV 文件', 400, 400);
    }
    if (!isRiffWav(stu.buffer) || !isRiffWav(ref.buffer)) {
      return fail(res, '音频文件不是有效的 WAV 格式（RIFF 头校验未通过）', 400, 400);
    }

    // 转发 Python 分析服务（multipart 直传）
    const fd = new FormData();
    fd.append('studentAudio', new Blob([stu.buffer], { type: 'audio/wav' }), 'student.wav');
    fd.append('refAudio', new Blob([ref.buffer], { type: 'audio/wav' }), 'reference.wav');

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), PYTHON_TIMEOUT_MS);
    let resp;
    try {
      resp = await fetch(`${PYTHON_URL}/analyze`, {
        method: 'POST',
        body: fd,
        signal: controller.signal,
      });
    } catch (err) {
      clearTimeout(timer);
      log.warn(`Python 分析服务不可达: ${err.message}`);
      return fail(res, err.name === 'AbortError'
        ? '演唱分析超时，请刷新页面后使用分片测评重试'
        : '演唱分析服务未启动或连接中断，请管理员检查分析服务', 503, 503);
    }
    clearTimeout(timer);

    let payload;
    try {
      payload = await resp.json();
    } catch {
      return fail(res, '分析服务返回了无法解析的结果', 502, 502);
    }

    if (!resp.ok) {
      // 400：分析器给出的客观描述（如时长不足 / 未检测到人声），直接透传；
      // 422（FastAPI 校验错误）的 detail 是数组，给出通用提示
      const msg = typeof payload?.detail === 'string'
        ? payload.detail
        : '音频分析失败，请确认两个 WAV 文件完整可用';
      return fail(res, msg, resp.status, resp.status >= 500 ? 502 : 400);
    }

    return success(res, payload, '测评完成（分数为参考分，仅供教学演示）');
  }),
);

// ---------- 分片上传 + 异步分析（长音频友好）----------

// 分片 multer：单片 ≤4MB，内存暂存后立刻追加落盘
const chunkUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 4 * 1024 * 1024 },
});

// POST /api/singing-eval/chunk/init —— 建任务，返回 taskId
// body: { studentSize, refSize, refHash? } —— refHash 命中缓存则范本免传（秒传）
router.post('/chunk/init', evalLimiter, asyncHandler(async (req, res) => {
  const { studentSize, refSize, refHash } = req.body || {};
  const s = Number(studentSize), r = Number(refSize);
  if (!Number.isFinite(s) || !Number.isFinite(r) || s <= 0 || r <= 0) {
    return fail(res, '请携带两个音频文件的字节数（studentSize / refSize）', 400, 400);
  }
  if (s > CHUNK_LIMIT_PER_FILE || r > CHUNK_LIMIT_PER_FILE) {
    return fail(res, '单个 WAV 文件不能超过 60MB，唱段时长须为 3–120 秒', 400, 400);
  }
  // 范本秒传：SHA-256 命中缓存（且大小一致）则直接复制，前端跳过 ref 分片
  let refCached = false;
  if (typeof refHash === 'string' && /^[a-f0-9]{64}$/.test(refHash)) {
    const cachePath = path.join(REF_CACHE_DIR, `${refHash}.wav`);
    try {
      if ((await fsp.stat(cachePath)).size === r) refCached = true;
    } catch { /* 未缓存 */ }
    if (refCached) await fsp.copyFile(cachePath, path.join(CHUNK_TASK_DIR, 'pending-ref'));
  }
  const id = randomUUID();
  const dir = path.join(CHUNK_TASK_DIR, id);
  await fsp.mkdir(dir, { recursive: true });
  if (refCached) {
    await fsp.rename(path.join(CHUNK_TASK_DIR, 'pending-ref'), path.join(dir, 'reference.wav'));
  }
  chunkTasks.set(id, {
    status: 'uploading',
    dir,
    studentPath: path.join(dir, 'student.wav'),
    refPath: path.join(dir, 'reference.wav'),
    report: null,
    error: null,
    createdAt: Date.now(),
    size: { student: s, ref: r },
    refCached,
    refHash: refCached ? refHash : null,
  });
  setTimeout(() => {
    if (chunkTasks.get(id)?.status === 'uploading') cleanupTask(id);
  }, TASK_TTL_MS).unref?.();
  log.info(`分片测评任务创建 task=${id} student=${s}B ref=${refCached ? '秒传' : r + 'B'}`);
  return success(res, { taskId: id, refCached });
}));

// POST /api/singing-eval/chunk/:taskId —— 追加一片（字段：chunk / target / offset）
// 按 offset 定位写入：CDN 超时（524）后客户端重试同一片是完全幂等的，不会写坏文件；
// 偏移不一致时返回服务端真实位置，客户端从该处续传。
router.post(
  '/chunk/:taskId',
  chunkUpload.single('chunk'),
  asyncHandler(async (req, res) => {
    const t = chunkTasks.get(req.params.taskId);
    if (!t) return fail(res, '任务不存在或已过期，请重新上传', 404, 404);
    if (t.status !== 'uploading') return fail(res, '任务已提交分析，不能继续上传', 409, 409);
    if (!req.file) return fail(res, '缺少分片数据（chunk 字段）', 400, 400);
    const target = req.body?.target === 'ref' ? 'ref' : 'student';
    const p = target === 'ref' ? t.refPath : t.studentPath;
    const size = req.file.size;
    const cur = await statSize(p);
    const raw = Number(req.body?.offset);
    // 未带 offset：兼容旧客户端，退化为顺序追加
    if (!Number.isFinite(raw) || raw < 0) {
      await fsp.appendFile(p, req.file.buffer);
      return success(res, { received: size, nextOffset: await statSize(p), target });
    }
    const offset = Math.floor(raw);
    if (cur === offset + size) {
      // 该片服务端已写入（上次响应丢失/被 CDN 掐断后重试）→ 幂等跳过
      return success(res, { received: 0, skipped: true, nextOffset: cur, target });
    }
    if (cur !== offset) {
      // 偏移不一致 → 交回服务端真实位置，客户端从该处重新开始
      return success(res, { received: 0, needResync: true, serverOffset: cur, target });
    }
    await fsp.appendFile(p, req.file.buffer);
    return success(res, { received: size, nextOffset: offset + size, target });
  }),
);

// POST /api/singing-eval/chunk/:taskId/complete —— 校验并排队分析，立即返回
router.post('/chunk/:taskId/complete', asyncHandler(async (req, res) => {
  const id = req.params.taskId;
  const t = chunkTasks.get(id);
  if (!t) return fail(res, '任务不存在或已过期，请重新上传', 404, 404);
  if (t.status !== 'uploading') return success(res, { status: t.status, taskId: id });
  for (const [label, p, expect] of [['学生演唱', t.studentPath, t.size.student], ['标准范本', t.refPath, t.size.ref]]) {
    let actual = 0;
    try { actual = (await fsp.stat(p)).size; } catch { /* missing */ }
    if (!actual) return fail(res, `${label}音频分片缺失，请重新上传`, 400, 400);
    if (actual !== expect) return fail(res, `${label}音频分片不完整（${actual}/${expect} 字节），请重新上传`, 400, 400);
    if (!(await isRiffWavFile(p))) return fail(res, `${label}不是有效的 WAV 格式（RIFF 头校验未通过）`, 400, 400);
  }
  // 文件检查有异步等待，再次检查以免重试请求重复加入串行队列。
  if (t.status !== 'uploading') return success(res, { status: t.status, taskId: id });
  t.status = 'queued';
  analysisChain = analysisChain.then(() => runAnalysis(id)).catch(() => {});
  log.info(`分片收齐，排队分析 task=${id}`);
  // 范本入缓存（异步不阻塞）：同内容范本下次秒传
  cacheRefFile(t).catch(() => {});
  return success(res, { status: 'queued', taskId: id });
}));

/** 流式计算范本 SHA-256 并缓存到 data/singing-refs/<hash>.wav */
async function cacheRefFile(t) {
  if (t.refCached) return;
  const hash = createHash('sha256');
  const stream = fs.createReadStream(t.refPath);
  for await (const chunk of stream) hash.update(chunk);
  await fsp.mkdir(REF_CACHE_DIR, { recursive: true });
  const dest = path.join(REF_CACHE_DIR, `${hash.digest('hex')}.wav`);
  try {
    await fsp.access(dest);   // 已有同内容缓存
  } catch {
    await fsp.copyFile(t.refPath, dest);
    log.info(`范本已入秒传缓存: ${path.basename(dest).slice(0, 12)}…`);
  }
}

// GET /api/singing-eval/task/:taskId —— 轮询状态，终态可重复读取
router.get('/task/:taskId', asyncHandler(async (req, res) => {
  res.set('Cache-Control', 'no-store');
  const id = req.params.taskId;
  const t = chunkTasks.get(id);
  if (!t) return fail(res, '任务不存在或已过期（结果请在获取后 30 分钟内保存）', 404, 404);
  if (t.status === 'error') {
    const msg = t.error;
    return fail(res, msg, 400, 400);
  }
  if (t.status === 'done' && t.report) {
    const report = t.report;
    return success(res, report, '测评完成（分数为参考分，仅供教学演示）');
  }
  return success(res, { status: t.status });
}));

// POST /api/singing-eval/ai-feedback —— AI 准确度点评
// 解读算法生成的测评报告，由星辰大模型输出拟人化的"测准"点评
router.post('/ai-feedback', evalLimiter, asyncHandler(async (req, res) => {
  const { report } = req.body || {};
  if (!report || typeof report !== 'object' || typeof report.total_score !== 'number') {
    return fail(res, '请携带完整的测评报告（report 字段）', 400, 400);
  }
  try {
    const result = await assessSingingAccuracy(report);
    return success(res, result, 'AI 测评完成（供教学参考）');
  } catch (err) {
    log.warn(`AI 测准调用失败: ${err.message}`);
    return fail(res, 'AI 测准服务暂不可用，请稍后重试', 502, 502);
  }
}));

// POST /api/singing-eval/export/:target —— 报告流转到下游系统
// 三个下游：多智能体（生成专家上下文）/ AI 批改（LLM 评语）/ 学习通（推送或作业包）
const EXPORT_TARGETS = {
  'multi-agent': { fn: sendReportToMultiAgent, label: '多智能体' },
  'ai-grading': { fn: submitToAiGrading, label: 'AI 批改' },
  'learning-platform': { fn: pushToLearningPlatform, label: '学习通作业' },
};

router.post('/export/:target', exportLimiter, asyncHandler(async (req, res) => {
  const { target } = req.params;
  const entry = EXPORT_TARGETS[target];
  if (!entry) {
    return fail(res, '未知的导出目标', 400, 400);
  }
  const { report, ...ctx } = req.body || {};
  if (!report || typeof report !== 'object') {
    return fail(res, '请携带完整的测评报告（report 字段）', 400, 400);
  }
  try {
    const result = await entry.fn(report, ctx);
    log.info(`报告流转: target=${target} status=${result.status}`);
    return success(res, result, result.summary || `${entry.label}已处理`);
  } catch (err) {
    // 下游异常不得穿透成 500：一律转成用户可读的失败提示
    log.warn(`报告流转失败 target=${target}: ${err.message}`);
    return fail(res, `${entry.label}处理失败：${err.message}`, 502, 502);
  }
}));

export default router;
