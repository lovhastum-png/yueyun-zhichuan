// 生图路由：生成图片、历史查询、妙笔润色（提示词增强）
import { Router } from 'express';
import pool from '../db.js';
import { authRequired } from '../middleware/auth.js';
import { success, fail, asyncHandler } from '../middleware/error.js';
import { rateLimit } from '../middleware/rateLimit.js';
import { createGate } from '../middleware/concurrency.js';
import { generateImage } from '../services/xunfeiImage.js';
import { enhanceImagePrompt } from '../services/promptEnhancer.js';

const router = Router();

router.use(authRequired);

// 生图与润色都要调用外部付费接口，且响应体可能含大图。
// 之前这两个接口没有任何限流，单个用户循环调用既烧配额也能把 4GB 机器拖慢。
const imageLimiter = rateLimit({ windowMs: 60000, max: 8, message: '生图请求过于频繁，请稍后再试' });
const promptLimiter = rateLimit({ windowMs: 60000, max: 15, message: '润色请求过于频繁，请稍后再试' });
const imageGate = createGate({ name: 'image-gen', max: 3, queueLimit: 10 });
const promptGate = createGate({ name: 'image-prompt', max: 3, queueLimit: 10 });

// 妙笔润色：把用户的简短创意扩写成可直接作画的画面描述，并返回结构化建议
// body: { prompt, current?: { role, school, costume, play, scene, composition } }
router.post('/enhance-prompt', promptLimiter, promptGate, asyncHandler(async (req, res) => {
  const { prompt, current } = req.body || {};
  const text = typeof prompt === 'string' ? prompt.trim() : '';
  if (!text) return fail(res, '请输入要润色的描述', 400, 400);

  const result = await enhanceImagePrompt({ prompt: text, current: current || {} });
  // fallback=true 表示文字模型未生效（关闭/未配置/超时），enhanced 退回原文；前端仍可用
  return success(res, {
    enhanced: result.enhanced,
    original: result.original,
    suggestions: result.suggestions || {},
    knowledgeSources: result.knowledgeSources || [],
    fallback: !!result.fallback,
    reason: result.reason || '',
  }, result.fallback ? '已沿用原描述' : '润色完成');
}));

// 生成图片
router.post('/generate', imageLimiter, imageGate, asyncHandler(async (req, res) => {
  const { prompt, style, role, school, costume, play, scene, composition, aspectRatio, seed } = req.body || {};
  if (!prompt || !prompt.trim()) {
    return fail(res, '生图描述不能为空', 400, 400);
  }

  let result;
  try {
    result = await generateImage({
      prompt: prompt.trim(),
      style: style || 'ink',
      role: role || '',
      school, costume, play, scene, composition, aspectRatio, seed,
    });
  } catch (err) {
    return fail(res, err.expose ? err.message : '生图服务暂时不可用', err.status || 502, err.status || 502);
  }

  // 入库
  const [insert] = await pool.query(
    'INSERT INTO image_history (user_id, prompt, image_url, style, role) VALUES (?, ?, ?, ?, ?)',
    [req.user.id, prompt, result.imageUrl, style || 'ink', role || null]
  );

  return success(res, {
    id: insert.insertId,
    imageUrl: result.imageUrl,
    prompt,
    finalPrompt: result.finalPrompt,
    negativePrompt: result.negativePrompt,
    provider: result.provider,
    fallback: result.fallback,
    fallbackReason: result.fallbackReason || '',
  }, result.fallback ? '已用兜底模型生成' : '生成成功');
}));

// 生图历史
router.get('/history', asyncHandler(async (req, res) => {
  const [rows] = await pool.query(
    'SELECT id, prompt, image_url, style, role, created_at FROM image_history WHERE user_id = ? ORDER BY created_at DESC LIMIT 100',
    [req.user.id]
  );
  return success(res, rows.map(r => ({
    id: r.id,
    prompt: r.prompt,
    imageUrl: r.image_url,
    style: r.style,
    role: r.role,
    createdAt: r.created_at,
  })));
}));

// 删除某条生图记录
router.delete('/:id', asyncHandler(async (req, res) => {
  await pool.query('DELETE FROM image_history WHERE id = ? AND user_id = ?', [req.params.id, req.user.id]);
  return success(res, null, '已删除');
}));

export default router;
