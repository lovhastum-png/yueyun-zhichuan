// Agent 路由：Function Calling Agent 问答 + 个性化学习路径推荐
import { Router } from 'express';
import pool from '../db.js';
import { authRequired } from '../middleware/auth.js';
import { success, fail, asyncHandler } from '../middleware/error.js';
import { sseHandler, openSse, sseSend, sseFail } from '../utils/sse.js';
import { runAgent } from '../services/agentOrchestrator.js';
import { generateLearningPath } from '../services/learningPath.js';

const router = Router();
router.use(authRequired);

// ============================================================
// Agent 智能问答（SSE 流式，支持工具调用）
// POST /api/agent/chat
// body: { message, sessionId? }
// ============================================================
router.post('/chat', sseHandler(async (req, res) => {
  const { message, sessionId } = req.body || {};
  if (!message || !message.trim()) return fail(res, '请输入消息', 400, 400);

  const userId = req.user.id;
  const session = sessionId || `agent_${Date.now()}_${userId}`;

  // 先读历史 + 落库，再切 SSE：数据库异常时返回可读的 JSON 错误，
  // 避免写死 200 后只能断连、前端表现为「一直没反应」。
  const [history] = await pool.query(
    'SELECT role, message FROM chat_history WHERE user_id = ? AND session_id = ? ORDER BY created_at ASC LIMIT 10',
    [userId, session]
  );
  const contextMessages = [
    ...history.map(h => ({ role: h.role, content: h.message })),
    { role: 'user', content: message },
  ];

  // 存储用户消息
  await pool.query(
    'INSERT INTO chat_history (user_id, session_id, role, message, sources) VALUES (?, ?, ?, ?, ?)',
    [userId, session, 'user', message, JSON.stringify({ type: 'agent' })]
  );

  // SSE 响应头
  openSse(res);

  let fullAnswer = '';
  let toolCalls = [];
  let ragChunks = [];

  try {
    fullAnswer = await runAgent({
      messages: contextMessages,
      userId,
      onToken: (token) => {
        sseSend(res, { type: 'token', content: token });
      },
      onToolStart: (toolName, args) => {
        toolCalls.push({ name: toolName, args });
        sseSend(res, { type: 'tool_start', name: toolName, args });
      },
      onToolEnd: (toolName, result) => {
        sseSend(res, { type: 'tool_end', name: toolName, summary: result.summary, success: result.success });
      },
      onRag: (chunks) => {
        ragChunks = chunks;
        sseSend(res, { type: 'rag', chunks: chunks.map(c => ({ title: c.title, score: c.score })) });
      },
    });
  } catch (err) {
    return sseFail(res, err, 'Agent 服务暂时不可用');
  }

  // 存储 AI 回答（落库失败不影响已生成内容）
  try {
    await pool.query(
      'INSERT INTO chat_history (user_id, session_id, role, message, sources) VALUES (?, ?, ?, ?, ?)',
      [userId, session, 'assistant', fullAnswer, JSON.stringify({ type: 'agent', tools: toolCalls.map(t => t.name), rag: ragChunks.length })]
    );
  } catch (err) {
    console.error('[agent] 回答落库失败：', err?.message || err);
  }

  // 推送完成事件
  sseSend(res, { type: 'done', sessionId: session, toolsUsed: toolCalls.map(t => t.name) });
  if (!res.writableEnded) res.end();
}));

// ============================================================
// 个性化学习路径推荐
// GET /api/agent/learning-path
// ============================================================
router.get('/learning-path', asyncHandler(async (req, res) => {
  const userId = req.user.id;
  // 仅学生可使用学习路径推荐
  if (req.user.role !== 'student') {
    return fail(res, '学习路径推荐仅对学生开放', 403, 403);
  }
  const result = await generateLearningPath(userId);
  return success(res, result, '学习路径已生成');
}));

// ============================================================
// 获取 Agent 会话历史
// GET /api/agent/history/:sessionId
// ============================================================
router.get('/history/:sessionId', asyncHandler(async (req, res) => {
  const { sessionId } = req.params;
  const [rows] = await pool.query(
    'SELECT role, message, sources, created_at FROM chat_history WHERE user_id = ? AND session_id = ? ORDER BY created_at ASC',
    [req.user.id, sessionId]
  );
  return success(res, rows);
}));

// ============================================================
// 获取所有 Agent 会话列表
// GET /api/agent/sessions
// ============================================================
router.get('/sessions', asyncHandler(async (req, res) => {
  const [rows] = await pool.query(
    `SELECT session_id, MIN(message) AS preview, MAX(created_at) AS last_at, COUNT(*) AS msg_count
     FROM chat_history
     WHERE user_id = ? AND session_id LIKE 'agent_%'
     GROUP BY session_id
     ORDER BY last_at DESC`,
    [req.user.id]
  );
  return success(res, rows);
}));

export default router;
