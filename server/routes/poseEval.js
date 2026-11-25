// 身段测评路由（Node 网关层）
// ============================================================
// 摄像头实时比对走 WebSocket（页面直连本机 pose-eval 8767，或经
// /pose-ws 网关代理）；本层只负责模板库管理的 HTTP 转发：
//   JWT 鉴权 / 名称与特征校验 / 限流 / 转发 / 降级提示。
//
// 视频导入管线的特征提取在教师浏览器端完成（MediaPipe Pose+Hands），
// 本层只转发 20 维特征序列，不接触视频文件本身。
//
// 【合规约束】该功能为教学演示辅助工具：
//   仅比对关节角度时序，不评价身段神韵与流派韵味；
//   所有分数均为【参考分】，不能替代专业教师身段指导。
// ============================================================
import { Router } from 'express';
import { authRequired, requireRole } from '../middleware/auth.js';
import { success, fail, asyncHandler } from '../middleware/error.js';
import { rateLimit } from '../middleware/rateLimit.js';
import logger from '../utils/logger.js';

const log = logger.module('POSE_EVAL');

// Python 身段比对服务地址：仅本机回环，不经公网隧道
const PYTHON_URL = process.env.POSE_EVAL_URL || 'http://127.0.0.1:8767';
const PYTHON_TIMEOUT_MS = 20000;

// 特征序列校验：每帧 20 维（数字或 null=该维缺失），15~600 帧
const TOTAL_DIM = 20;
const MIN_ROWS = 15;
const MAX_ROWS = 600;

const router = Router();
router.use(authRequired);

// 模板写入限流：每用户每分钟 10 次
const writeLimiter = rateLimit({ windowMs: 60000, max: 10, message: '模板操作过于频繁，请稍后再试' });

function isValidFeatureRow(row) {
  return Array.isArray(row) && row.length === TOTAL_DIM
    && row.every((v) => v === null || typeof v === 'number' && Number.isFinite(v));
}

function isValidFeatures(features) {
  return Array.isArray(features)
    && features.length >= MIN_ROWS && features.length <= MAX_ROWS
    && features.every(isValidFeatureRow);
}

// 参考骨架帧校验：11 个 [x, y] 归一化坐标（与特征帧一一对应，可选）
function isValidDemoFrame(frame) {
  return Array.isArray(frame) && frame.length === 11
    && frame.every((p) => Array.isArray(p) && p.length === 2
      && p.every((v) => typeof v === 'number' && Number.isFinite(v)));
}

async function proxyJson(res, method, path, body) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), PYTHON_TIMEOUT_MS);
  let resp;
  try {
    resp = await fetch(`${PYTHON_URL}${path}`, {
      method,
      headers: body ? { 'Content-Type': 'application/json' } : undefined,
      body: body ? JSON.stringify(body) : undefined,
      signal: controller.signal,
    });
  } catch (err) {
    clearTimeout(timer);
    log.warn(`Python 身段比对服务不可达: ${err.message}`);
    return fail(res, '身段比对服务未启动：请通过「启动服务.bat」启动（会自动拉起 Python 身段比对服务）', 503, 503);
  }
  clearTimeout(timer);

  let payload;
  try {
    payload = await resp.json();
  } catch {
    return fail(res, '身段比对服务返回了无法解析的结果', 502, 502);
  }
  if (!resp.ok) {
    const msg = typeof payload?.detail === 'string'
      ? payload.detail
      : '身段模板操作失败';
    return fail(res, msg, resp.status >= 500 ? 502 : 400, resp.status >= 500 ? 502 : 400);
  }
  return success(res, payload);
}

// GET /api/pose-eval/actions —— 身段模板列表
router.get('/actions', asyncHandler(async (req, res) => {
  await proxyJson(res, 'GET', '/actions-v2');
}));

// POST /api/pose-eval/templates —— 保存一段特征序列为模板（视频导入，仅教师）
router.post('/templates', writeLimiter, requireRole('teacher'), asyncHandler(async (req, res) => {
  const { name, features, demo } = req.body || {};
  const cleanName = typeof name === 'string' ? name.trim() : '';
  if (!cleanName || cleanName.length > 30) {
    return fail(res, '请填写 1~30 字的身段名称', 400, 400);
  }
  if (!isValidFeatures(features)) {
    return fail(res, `特征序列无效：需 ${MIN_ROWS}~${MAX_ROWS} 帧、每帧 ${TOTAL_DIM} 维（数字或 null）`, 400, 400);
  }
  // 可选参考骨架：与特征帧数对齐且全部合法才透传（供页面画「参考身段」动画）
  const demoOk = Array.isArray(demo) && demo.length === features.length && demo.every(isValidDemoFrame);
  // 服务端注入创建者身份（用户不可伪造）
  await proxyJson(res, 'POST', '/templates-v2', {
    name: cleanName, features, owner: req.user.username,
    ...(demoOk ? { demo } : {}),
  });
}));

// 向 sidecar 查询单个模板（含 owner）
// 返回 {reachable, action}：action 为 null 表示不存在
async function fetchAction(id) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), PYTHON_TIMEOUT_MS);
  try {
    const resp = await fetch(`${PYTHON_URL}/actions-v2`, { signal: controller.signal });
    if (!resp.ok) return { reachable: false, action: null };
    const payload = await resp.json();
    const action = (payload.actions || []).find((a) => a.id === id) || null;
    return { reachable: true, action };
  } catch {
    return { reachable: false, action: null };
  } finally {
    clearTimeout(timer);
  }
}

// DELETE /api/pose-eval/templates/:id —— 删除身段模板
// 权限：教师可删任意模板；学生只能删自己创建的
router.delete(
  '/templates/:id',
  writeLimiter,
  asyncHandler(async (req, res) => {
    const id = String(req.params.id || '');
    if (!id || /[/\\]/.test(id) || id.length > 60) {
      return fail(res, '无效的身段 ID', 400, 400);
    }
    const isTeacher = req.user.role === 'teacher';
    const { reachable, action } = await fetchAction(id);
    if (!reachable) {
      return fail(res, '身段比对服务未启动：请通过「启动服务.bat」启动（会自动拉起 Python 身段比对服务）', 503, 503);
    }
    if (!action) {
      return fail(res, '未找到该身段模板', 404, 404);
    }
    if (!isTeacher && action.owner !== req.user.username) {
      return fail(res, '只能删除自己创建的身段模板', 403, 403);
    }
    await proxyJson(res, 'DELETE', `/actions-v2/${encodeURIComponent(id)}`);
  }),
);

export default router;
