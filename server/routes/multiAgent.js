// 多智能体协作路由：SSE 流式推送协作全过程
import { Router } from 'express';
import pool from '../db.js';
import { authRequired } from '../middleware/auth.js';
import { success, fail, asyncHandler } from '../middleware/error.js';
import { sseHandler, openSse, sseSend, sseFail } from '../utils/sse.js';
import { runMultiAgent, EXPERTS } from '../services/multiAgent.js';

const router = Router();
router.use(authRequired);

// ============================================================
// 多智能体协作问答（SSE 流式）
// POST /api/multi-agent/chat
// body: { message }
// ============================================================
router.post('/chat', sseHandler(async (req, res) => {
  const { message } = req.body || {};
  if (!message || !message.trim()) return fail(res, '请输入消息', 400, 400);

  const userId = req.user.id;
  const session = `multi_${Date.now()}_${userId}`;

  // 先落库再切 SSE：数据库异常时能返回可读的 JSON 错误，避免只断连
  await pool.query(
    'INSERT INTO chat_history (user_id, session_id, role, message, sources) VALUES (?, ?, ?, ?, ?)',
    [userId, session, 'user', message, JSON.stringify({ type: 'multi_agent' })]
  );

  // SSE 响应头
  openSse(res);

  let finalAnswer = '';
  const collaborators = [];
  const toolCalls = [];
  // 协作统计：每个专家的耗时/字数/工具数
  const expertStats = {};
  let routingStartTime = Date.now();
  let summarizerStartTime = 0;

  try {
    finalAnswer = await runMultiAgent({
      question: message,
      userId,
      onRouting: (routing) => {
        routingStartTime = Date.now();
        sseSend(res, { type: 'routing', experts: routing.experts, analysis: routing.analysis, timestamp: Date.now() });
      },
      onExpertStart: (expertKey) => {
        const e = EXPERTS[expertKey];
        collaborators.push(expertKey);
        expertStats[expertKey] = { start: Date.now(), duration: 0, tools: 0, chars: 0 };
        sseSend(res, { type: 'expert_start', expert: expertKey, name: e.name, avatar: e.avatar, color: e.color, timestamp: Date.now() });
      },
      onExpertEnd: (expertKey, answer) => {
        if (expertStats[expertKey]) {
          expertStats[expertKey].duration = Date.now() - expertStats[expertKey].start;
          expertStats[expertKey].chars = answer.length;
        }
        sseSend(res, {
          type: 'expert_end',
          expert: expertKey,
          name: EXPERTS[expertKey].name,
          answer,
          duration_ms: expertStats[expertKey]?.duration || 0,
          chars: answer.length,
        });
      },
      onToolStart: (expertKey, toolName, args, round) => {
        toolCalls.push({ expert: expertKey, tool: toolName, round: round || 0 });
        if (expertStats[expertKey]) expertStats[expertKey].tools++;
        sseSend(res, { type: 'tool_start', expert: expertKey, name: toolName, args, round: round || 0, timestamp: Date.now() });
      },
      onToolEnd: (expertKey, toolName, result, round) => {
        sseSend(res, {
          type: 'tool_end',
          expert: expertKey,
          name: toolName,
          summary: result.summary,
          success: result.success,
          round: round || 0,
          timestamp: Date.now(),
        });
      },
      onRag: (expertKey, chunks) => {
        // 完整返回 chunks 内容（含 content），前端可折叠展示引用原文
        sseSend(res, { type: 'rag', expert: expertKey, chunks: chunks.map(c => ({ title: c.title, content: c.content, score: c.score, source_type: c.source_type })) });
      },
      onSummarizerStart: () => {
        summarizerStartTime = Date.now();
        sseSend(res, { type: 'summarizer_start', timestamp: Date.now(), input_experts: collaborators.slice() });
      },
      onSummarizerEnd: (durationMs) => {
        sseSend(res, { type: 'summarizer_end', duration_ms: durationMs, timestamp: Date.now() });
      },
      onToken: (token) => {
        sseSend(res, { type: 'token', content: token });
      },
    });
  } catch (err) {
    return sseFail(res, err, '多智能体协作服务暂时不可用');
  }

  // 存储 AI 回答（落库失败不影响已生成内容）
  try {
    await pool.query(
      'INSERT INTO chat_history (user_id, session_id, role, message, sources) VALUES (?, ?, ?, ?, ?)',
      [userId, session, 'assistant', finalAnswer, JSON.stringify({ type: 'multi_agent', collaborators, tools: toolCalls })]
    );
  } catch (err) {
    console.error('[multi-agent] 回答落库失败：', err?.message || err);
  }

  sseSend(res, {
    type: 'done',
    sessionId: session,
    collaborators,
    toolCount: toolCalls.length,
    expertStats: Object.fromEntries(
      Object.entries(expertStats).map(([k, v]) => [k, { duration: v.duration, tools: v.tools, chars: v.chars }])
    ),
    summarizerDuration: summarizerStartTime ? (Date.now() - summarizerStartTime) : 0,
    totalDuration: Date.now() - routingStartTime,
  });
  if (!res.writableEnded) res.end();
}));

// ============================================================
// 获取可用专家列表
// GET /api/multi-agent/experts
// ============================================================
router.get('/experts', (req, res) => {
  const list = Object.values(EXPERTS).map(e => ({
    key: e.key,
    name: e.name,
    avatar: e.avatar,
    color: e.color,
    desc: e.desc,
    tools: e.tools,
  }));
  return success(res, list);
});

export default router;
