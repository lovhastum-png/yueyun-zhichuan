// 剧本版本比对路由（Node 网关层）
// ============================================================
// 真正的文本比对由 Python FastAPI sidecar 完成（server/python/script-compare，
// rapidfuzz + jieba + python-Levenshtein，三级对齐：场次 → 唱段念白 → 整句），
// 本层只负责：JWT 鉴权 / 上传校验（扩展名 + 大小）/ 限流 / 转发 / 降级提示。
//
// 【合规约束】该功能为教学辅助工具：
//   比对结果均为「参考差异」，不构成版本优劣判定；
//   差异判定请以专业教师为准；措辞不使用「错误 / 正确」等绝对化表述。
//
// 【预留接口】/keywords —— 差异片段 → 史料检索关键词，
//   供后续 RAG 史料库 / 知识图谱 / 作业批改模块调用。
// ============================================================
import { Router } from 'express';
import path from 'path';
import multer from 'multer';
import { authRequired } from '../middleware/auth.js';
import { success, fail, asyncHandler } from '../middleware/error.js';
import { rateLimit } from '../middleware/rateLimit.js';
import { createGate } from '../middleware/concurrency.js';
import logger from '../utils/logger.js';

const log = logger.module('SCRIPT_COMPARE');

// Python 分析服务地址：仅本机回环，不经公网隧道
const PYTHON_URL = process.env.SCRIPT_COMPARE_URL || 'http://127.0.0.1:8766';
const PYTHON_TIMEOUT_MS = 60000;

const router = Router();
router.use(authRequired);

// 修复 multipart 中文文件名乱码：busboy 按 latin-1 解码文件名，UTF-8 的
// 中文文件名会变成「æ°å½…」式乱码（版本元信息解析依赖文件名，必须还原）。
// 仅当原字符串不含中文、而 latin-1 → UTF-8 还原后出现合法中文时才采用，
// 避免二次破坏本来正确的文件名。
function repairFilename(name) {
  if (!name || /[\u4e00-\u9fff]/.test(name)) return name || '';
  try {
    const restored = Buffer.from(name, 'latin1').toString('utf8');
    if (restored !== name && !restored.includes('\uFFFD') && /[\u4e00-\u9fff]/.test(restored)) {
      return restored;
    }
  } catch {
    /* 还原失败则原样使用 */
  }
  return name || '';
}

// 比对限流：每用户每分钟 10 次（文本比对本身较快，宽松一些）
const compareLimiter = rateLimit({ windowMs: 60000, max: 10, message: '剧本比对请求过于频繁，请稍后再试' });

// 并闸：下游 Python sidecar 为单 worker（jieba + rapidfuzz 吃 CPU），
// 4 核机器上放太多并发会让 Node 自身的事件循环也被拖慢。
const scriptGate = createGate({ name: 'script-compare', max: 3, queueLimit: 8 });

// multer：内存存储，双文件字段，限制 2MB，仅 TXT
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 2 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase();
    if (ext === '.txt') return cb(null, true);
    cb(new Error('仅支持 TXT 格式剧本文本'));
  },
});

// 统一的 Python 服务转发（错误统一降级为可展示的提示）
async function forwardToPython(res, pathName, init) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), PYTHON_TIMEOUT_MS);
  let resp;
  try {
    resp = await fetch(`${PYTHON_URL}${pathName}`, { ...init, signal: controller.signal });
  } catch (err) {
    clearTimeout(timer);
    log.warn(`Python 比对服务不可达: ${err.message}`);
    return fail(res, '剧本比对服务未启动：请通过「启动服务.bat」启动（会自动拉起 Python 比对服务），或手动运行 uvicorn', 503, 503);
  }
  clearTimeout(timer);

  let payload;
  try {
    payload = await resp.json();
  } catch {
    return fail(res, '比对服务返回了无法解析的结果', 502, 502);
  }

  if (!resp.ok) {
    // 400：分析器给出的客观描述（如未解析到唱词念白），直接透传；
    // 422（FastAPI 校验错误）的 detail 是数组，给出通用提示
    const msg = typeof payload?.detail === 'string'
      ? payload.detail
      : '剧本比对失败，请确认两个 TXT 文件完整可用';
    return fail(res, msg, resp.status, resp.status >= 500 ? 502 : 400);
  }
  return payload;
}

// POST /api/script-compare/compare —— 剧本版本比对主接口
router.post(
  '/compare',
  compareLimiter,
  scriptGate,
  upload.fields([
    { name: 'oldScript', maxCount: 1 },
    { name: 'newScript', maxCount: 1 },
  ]),
  asyncHandler(async (req, res) => {
    const oldFile = req.files?.oldScript?.[0];
    const newFile = req.files?.newScript?.[0];
    if (!oldFile || !newFile) {
      return fail(res, '请同时上传「旧版本」与「新版本」两个 TXT 剧本文件', 400, 400);
    }
    if (!oldFile.buffer.length || !newFile.buffer.length) {
      return fail(res, '剧本文件内容为空', 400, 400);
    }

    // 转发 Python 比对服务（multipart 直传，保留原始文件名供版本信息解析）
    const fd = new FormData();
    fd.append('oldScript', new Blob([oldFile.buffer], { type: 'text/plain' }), repairFilename(oldFile.originalname));
    fd.append('newScript', new Blob([newFile.buffer], { type: 'text/plain' }), repairFilename(newFile.originalname));

    const payload = await forwardToPython(res, '/compare', { method: 'POST', body: fd });
    if (payload) return success(res, payload, '比对完成（结果为参考差异，仅供教学演示）');
  }),
);

// GET /api/script-compare/demo —— 演示样本比对（梁祝 民国手抄本 ↔ 80年代舞台版）
router.get('/demo', compareLimiter, asyncHandler(async (req, res) => {
  const payload = await forwardToPython(res, '/demo', { method: 'GET' });
  if (payload) return success(res, payload, '演示样本比对完成（结果为参考差异，仅供教学演示）');
}));

// POST /api/script-compare/keywords —— 溯源关键词预留接口
// 传入差异片段上下文，返回史料文献检索关键词（RAG 检索本体尚未对接）
router.post('/keywords', asyncHandler(async (req, res) => {
  const { playTitle, sceneTitle, role, oldText, newText } = req.body || {};
  const payload = await forwardToPython(res, '/keywords', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ playTitle, sceneTitle, role, oldText, newText }),
  });
  if (payload) return success(res, payload, '溯源关键词已生成（RAG 史料库对接为预留接口）');
}));

export default router;
