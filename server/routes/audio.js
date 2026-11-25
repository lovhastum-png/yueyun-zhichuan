// 音频识别路由
import { Router } from 'express';
import path from 'path';
import pool from '../db.js';
import { authRequired } from '../middleware/auth.js';
import { success, fail, asyncHandler } from '../middleware/error.js';
import { recognizeAudio } from '../services/qwenAsr.js';
import { correctYuejuTerms } from '../services/yuejuAsrCorrect.js';
import { rateLimit } from '../middleware/rateLimit.js';
import { createGate } from '../middleware/concurrency.js';

const router = Router();

router.use(authRequired);

// 音频识别限流：每用户每分钟最多 5 次（音频识别成本高）
const audioLimiter = rateLimit({ windowMs: 60000, max: 5, message: '音频识别请求过于频繁' });

// 并闸：每个音频请求要在堆里持有 20MB Buffer + 约 27MB base64 字符串，
// 4GB 机器上（Node 堆上限 512MB）同时跑 3 个以上就会明显 GC 抖动。
// 闸门放在 multer 之前，排队期间不会先把上传内容读进内存。
const asrGate = createGate({ name: 'asr', max: 2, queueLimit: 8 });

// multer 配置：内存存储，限制 20MB，仅音频
import multer from 'multer';
const storage = multer.memoryStorage();
const upload = multer({
  storage,
  limits: { fileSize: 20 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase();
    if (['.mp3', '.wav', '.m4a', '.flac', '.ogg', '.webm'].includes(ext)) {
      cb(null, true);
    } else {
      cb(new Error('仅支持 mp3/wav/m4a/flac/ogg/webm 格式音频'));
    }
  },
});

// 识别音频
router.post('/recognize', audioLimiter, asrGate, upload.single('audio'), asyncHandler(async (req, res) => {
  if (!req.file) {
    return fail(res, '请上传音频文件', 400, 400);
  }

  let result;
  try {
    result = await recognizeAudio(req.file.buffer, req.file.originalname);
  } catch (err) {
    return fail(res, err.expose ? err.message : '音频识别服务暂时不可用', err.status || 502, err.status || 502);
  }

  // 使用本地微调模型对越剧术语进行纠错（recognizeAudio 返回 fullText 字段）
  if (result && result.fullText) {
    const corrected = await correctYuejuTerms(result.fullText);
    result.originalText = result.fullText;
    result.text = corrected;
    result.corrected = corrected !== result.originalText;
  }

  return success(res, result, '识别完成');
}));

// 纯文本越剧术语纠错（前端语音识别结果二次校正，离线本地模型，无需外部 API）
router.post('/correct', asyncHandler(async (req, res) => {
  const { text } = req.body || {};
  if (!text || !text.trim()) return fail(res, '文本不能为空', 400, 400);
  const corrected = await correctYuejuTerms(text);
  return success(res, { original: text, corrected, changed: corrected !== text }, '纠错完成');
}));

export default router;
