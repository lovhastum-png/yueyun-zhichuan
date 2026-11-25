// 聊天路由：流式问答、历史查询
import { Router } from 'express';
import crypto from 'crypto';
import pool from '../db.js';
import { authRequired } from '../middleware/auth.js';
import { success, fail, asyncHandler } from '../middleware/error.js';
import { sseHandler, openSse, sseSend, sseFail } from '../utils/sse.js';
import { streamChat, extractSources, buildKnowledgeCards } from '../services/xingchenAgent.js';
import { feedQuestion } from './knowledgeReview.js';
import { rateLimit } from '../middleware/rateLimit.js';

const router = Router();

// 所有聊天接口均需登录
router.use(authRequired);

// AI 问答限流：每用户每分钟最多 20 次
const aiLimiter = rateLimit({ windowMs: 60000, max: 20, message: 'AI 问答请求过于频繁' });

// 流式问答（SSE）
router.post('/stream', aiLimiter, sseHandler(async (req, res) => {
  const { message, sessionId } = req.body || {};
  if (!message || !message.trim()) {
    return fail(res, '问题内容不能为空', 400, 400);
  }

  const userId = req.user.id;
  const session = sessionId || crypto.randomUUID();

  // 先完成所有前置数据库读写，再切换成 SSE 流。
  // 这样数据库异常时还能返回正常的 JSON 错误（前端可提示 + 重试），
  // 而不是先写死 200 之后只能断连。
  const [history] = await pool.query(
    'SELECT role, message FROM chat_history WHERE user_id = ? AND session_id = ? ORDER BY created_at ASC LIMIT 20',
    [userId, session]
  );
  const contextMessages = history.map(h => ({ role: h.role, content: h.message }));
  contextMessages.push({ role: 'user', content: message });

  // 存储用户提问
  await pool.query(
    'INSERT INTO chat_history (user_id, session_id, role, message) VALUES (?, ?, ?, ?)',
    [userId, session, 'user', message]
  );

  // 设置 SSE 响应头
  openSse(res);

  let fullAnswer = '';
  let ragChunks = [];
  let pluginTexts = [];
  try {
    // 流式调用星辰 Agent（含 RAG 检索增强 + 联网搜索）
    fullAnswer = await streamChat({
      messages: contextMessages,
      onToken: (token) => {
        sseSend(res, { type: 'token', content: token });
      },
      onRag: (chunks) => {
        ragChunks = chunks;
        sseSend(res, { type: 'rag', chunks: chunks.map(c => ({ title: c.title, content: c.content, score: c.score, source_type: c.source_type })) });
      },
      onPlugin: (pluginText) => {
        pluginTexts.push(pluginText);
        sseSend(res, { type: 'plugin', content: pluginText });
      },
    });
  } catch (err) {
    return sseFail(res, err, '问答服务暂时不可用');
  }

  // 提取出处（LLM 回答中标注的【出处：...】）
  const sources = extractSources(fullAnswer);
  // 合并 RAG 检索到的知识来源（去重）
  const ragSources = ragChunks.map(c => ({ title: c.title, type: c.source_type === 'card' ? '知识库' : c.source_type, score: c.score }));
  const allSources = [...sources];
  for (const rs of ragSources) {
    if (!allSources.some(s => s.title === rs.title)) allSources.push(rs);
  }
  if (allSources.length > 0) {
    sseSend(res, { type: 'sources', sources: allSources });
  }

  // 生成知识卡片
  const cards = buildKnowledgeCards(message, fullAnswer);
  if (cards.length > 0) {
    sseSend(res, { type: 'cards', cards });
  }

  // 存储 AI 回答（含 RAG 来源与联网来源）
  // 落库失败不应影响已经生成完的回答，所以单独 try 兜底并记日志。
  try {
    await pool.query(
      'INSERT INTO chat_history (user_id, session_id, role, message, sources) VALUES (?, ?, ?, ?, ?)',
      [userId, session, 'assistant', fullAnswer, JSON.stringify({ sources: allSources, ragChunks: ragChunks.map(c => ({ title: c.title, score: c.score })), plugins: pluginTexts.length })]
    );
  } catch (err) {
    console.error('[chat] 回答落库失败：', err?.message || err);
  }

  // 数据飞轮：将高频问题沉淀到 knowledge_review 表，供教师审核入库
  // 纯后台副作用，失败不影响本次回答（feedQuestion 内部已有 try 兜底，这里再保一层）
  try {
    await feedQuestion(message, fullAnswer, allSources, session, userId);
  } catch (err) {
    console.error('[chat] 沉淀高频问题失败：', err?.message || err);
  }

  // 结束
  sseSend(res, { type: 'done', sessionId: session });
  if (!res.writableEnded) res.end();
}));

// 聊天历史列表（按会话分组）
router.get('/history', asyncHandler(async (req, res) => {
  const userId = req.user.id;
  const [rows] = await pool.query(
    `SELECT session_id,
            MAX(created_at) AS last_time,
            (SELECT message FROM chat_history ch2
             WHERE ch2.user_id = ch.user_id AND ch2.session_id = ch.session_id
             ORDER BY created_at ASC LIMIT 1) AS first_message,
            (SELECT message FROM chat_history ch3
             WHERE ch3.user_id = ch.user_id AND ch3.session_id = ch.session_id
             ORDER BY created_at DESC LIMIT 1) AS last_message
     FROM chat_history ch
     WHERE user_id = ?
     GROUP BY session_id
     ORDER BY last_time DESC
     LIMIT 100`,
    [userId]
  );
  return success(res, rows.map(r => ({
    sessionId: r.session_id,
    firstMessage: r.first_message,
    lastMessage: r.last_message,
    createdAt: r.last_time,
  })));
}));

// 某会话详情
router.get('/history/:sessionId', asyncHandler(async (req, res) => {
  const userId = req.user.id;
  const { sessionId } = req.params;
  const [rows] = await pool.query(
    'SELECT role, message, sources, created_at FROM chat_history WHERE user_id = ? AND session_id = ? ORDER BY created_at ASC',
    [userId, sessionId]
  );
  return success(res, {
    sessionId,
    messages: rows.map(r => ({
      role: r.role,
      content: r.message,
      sources: typeof r.sources === 'string' ? JSON.parse(r.sources) : (r.sources || []),
      createdAt: r.created_at,
    })),
  });
}));

// 删除某会话
router.delete('/history/:sessionId', asyncHandler(async (req, res) => {
  const userId = req.user.id;
  const { sessionId } = req.params;
  await pool.query('DELETE FROM chat_history WHERE user_id = ? AND session_id = ?', [userId, sessionId]);
  return success(res, null, '已删除该会话');
}));

export default router;
