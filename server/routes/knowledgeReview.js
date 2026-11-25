// 数据飞轮路由：高频问题沉淀 → 教师审核 → 自动入库 RAG
import { Router } from 'express';
import crypto from 'crypto';
import pool from '../db.js';
import { authRequired, requireRole } from '../middleware/auth.js';
import { success, fail, asyncHandler } from '../middleware/error.js';
import { indexKnowledgeChunk } from '../services/ragRetrieval.js';

const router = Router();

// 所有接口均需登录
router.use(authRequired);

// ========== 工具：问题归一化（去标点/空格/转小写，便于去重） ==========
function normalizeQuestion(q) {
  return String(q || '')
    .replace(/[？?！!。，,\s]+/g, '')
    .toLowerCase()
    .trim();
}

function hashQuestion(q) {
  return crypto.createHash('sha256').update(normalizeQuestion(q)).digest('hex');
}

// ========== 1. 高频问题沉淀（chat 流式问答结束时调用） ==========
// 内部接口：由 chat.js 在保存 assistant 消息后调用，无需前端请求
export async function feedQuestion(question, answer, sources, sessionId, userId) {
  try {
    if (!question || !answer) return;
    const hash = hashQuestion(question);
    // 归一化问题（保留语义但去除多余空白）
    const cleanQuestion = String(question).trim().replace(/\s+/g, ' ');
    const sourcesJson = sources ? JSON.stringify(sources) : null;

    // 已存在则 ask_count+1 并刷新最佳回答；不存在则新增 pending 记录
    await pool.query(
      `INSERT INTO knowledge_review
        (question_hash, question, ask_count, best_answer, best_sources, sample_session_id, sample_user_id, status)
       VALUES (?, ?, 1, ?, ?, ?, ?, 'pending')
       ON DUPLICATE KEY UPDATE
         ask_count = ask_count + 1,
         best_answer = VALUES(best_answer),
         best_sources = VALUES(best_sources),
         sample_session_id = VALUES(sample_session_id),
         sample_user_id = VALUES(sample_user_id),
         updated_at = CURRENT_TIMESTAMP`,
      [hash, cleanQuestion, answer, sourcesJson, sessionId || null, userId || null]
    );
  } catch (err) {
    // 飞轮失败不影响主流程
    console.error('[飞轮] 沉淀失败:', err.message);
  }
}

// ========== 2. 教师审核：获取待审核高频问题列表 ==========
router.get('/pending', requireRole('teacher'), asyncHandler(async (req, res) => {
  const { limit = 20, offset = 0, minAsk = 1 } = req.query;
  const [rows] = await pool.query(
    `SELECT id, question, ask_count, best_answer, best_sources,
            sample_session_id, status, created_at, updated_at
     FROM knowledge_review
     WHERE status = 'pending' AND ask_count >= ?
     ORDER BY ask_count DESC, updated_at DESC
     LIMIT ? OFFSET ?`,
    [Number(minAsk), Number(limit), Number(offset)]
  );
  // 统计
  const [stat] = await pool.query(
    `SELECT
       SUM(status = 'pending') AS pending_count,
       SUM(status = 'approved') AS approved_count,
       SUM(status = 'rejected') AS rejected_count,
       MAX(ask_count) AS max_ask,
       COUNT(*) AS total
     FROM knowledge_review`
  );
  return success(res, {
    list: rows.map(r => ({
      id: r.id,
      question: r.question,
      askCount: r.ask_count,
      bestAnswer: r.best_answer,
      bestSources: typeof r.best_sources === 'string' ? JSON.parse(r.best_sources || '[]') : (r.best_sources || []),
      sampleSessionId: r.sample_session_id,
      status: r.status,
      createdAt: r.created_at,
      updatedAt: r.updated_at,
    })),
    stats: stat[0] || { pending_count: 0, approved_count: 0, rejected_count: 0, max_ask: 0, total: 0 },
  });
}));

// ========== 3. 教师审核：通过 → 自动入库 RAG ==========
router.post('/approve', requireRole('teacher'), asyncHandler(async (req, res) => {
  const { id } = req.body || {};
  if (!id) return fail(res, '缺少问题ID', 400, 400);

  const [rows] = await pool.query(
    'SELECT id, question, best_answer, status FROM knowledge_review WHERE id = ?',
    [id]
  );
  if (rows.length === 0) return fail(res, '问题不存在', 404, 404);
  const item = rows[0];
  if (item.status === 'approved') return fail(res, '该问题已审核通过，请勿重复操作', 400, 400);

  // 原子占位：只有把 pending 改成 approved 的那一次请求才拿到写入权。
  // 原实现用 SELECT ... FOR UPDATE，但连接池是自动提交、语句结束锁就释放了，
  // 两位教师同时点「通过」会各自入库一次，RAG 里出现重复 chunk。
  // 这里改用带条件的 UPDATE，靠 affectedRows 判定胜负，不依赖事务。
  const [claim] = await pool.query(
    "UPDATE knowledge_review SET status = 'approved', reviewed_by = ?, reviewed_at = NOW() WHERE id = ? AND status = 'pending'",
    [req.user.id, id]
  );
  if (claim.affectedRows === 0) {
    return fail(res, '该问题已被其他教师处理，请刷新后查看', 409, 409);
  }

  // 入库 RAG：source_id 用 qa_<id>，source_type 用 qa（需确保 ENUM 已扩展）
  const sourceId = `qa_${item.id}`;
  const title = item.question;
  const content = item.best_answer || '（暂无标准答案，请教师补充）';
  let chunkId = null;

  try {
    await indexKnowledgeChunk({
      source_id: sourceId,
      source_type: 'qa',
      title,
      content,
      keywords: ['用户高频', '问答沉淀'],
    });
    // 取回刚写入的 chunk id
    const [ch] = await pool.query(
      'SELECT id FROM knowledge_chunks WHERE source_id = ? ORDER BY id DESC LIMIT 1',
      [sourceId]
    );
    chunkId = ch[0]?.id || null;
  } catch (err) {
    // 如果是 ENUM 不支持 'qa'，降级用 'document'
    if (err.code === 'ER_WARN_DATA_OUT_OF_RANGE' || /enum/i.test(err.message)) {
      console.warn('[飞轮] source_type ENUM 不支持 qa，降级为 document');
      try {
        await indexKnowledgeChunk({
          source_id: sourceId,
          source_type: 'document',
          title,
          content,
          keywords: ['用户高频', '问答沉淀'],
        });
        const [ch] = await pool.query(
          'SELECT id FROM knowledge_chunks WHERE source_id = ? ORDER BY id DESC LIMIT 1',
          [sourceId]
        );
        chunkId = ch[0]?.id || null;
      } catch (fallbackErr) {
        // 入库彻底失败：把状态退回 pending，让教师可以重试，而不是留一条假的"已通过"
        await pool.query("UPDATE knowledge_review SET status = 'pending', reviewed_by = NULL, reviewed_at = NULL WHERE id = ?", [id]);
        console.error('[飞轮] 降级入库失败：', fallbackErr?.message || fallbackErr);
        return fail(res, '入库 RAG 失败，已回退为待审核，请稍后重试', 500, 500);
      }
    } else {
      await pool.query("UPDATE knowledge_review SET status = 'pending', reviewed_by = NULL, reviewed_at = NULL WHERE id = ?", [id]);
      throw err;
    }
  }

  // 更新审核状态
  await pool.query(
    `UPDATE knowledge_review SET status = 'approved', reviewed_by = ?, reviewed_at = NOW(), chunk_id = ? WHERE id = ?`,
    [req.user.id, chunkId, id]
  );

  return success(res, { id, chunkId }, '已审核通过并入库 RAG 知识库');
}));

// ========== 4. 教师审核：拒绝 ==========
router.post('/reject', requireRole('teacher'), asyncHandler(async (req, res) => {
  const { id, reason } = req.body || {};
  if (!id) return fail(res, '缺少问题ID', 400, 400);

  const [rows] = await pool.query('SELECT id, status FROM knowledge_review WHERE id = ?', [id]);
  if (rows.length === 0) return fail(res, '问题不存在', 404, 404);

  await pool.query(
    `UPDATE knowledge_review SET status = 'rejected', reviewed_by = ?, reviewed_at = NOW(), reject_reason = ? WHERE id = ?`,
    [req.user.id, reason || '', id]
  );
  return success(res, null, '已拒绝');
}));

// ========== 5. 教师审核：编辑答案后通过（允许教师修正答案） ==========
router.post('/approve-with-edit', requireRole('teacher'), asyncHandler(async (req, res) => {
  const { id, question, answer } = req.body || {};
  if (!id || !question || !answer) return fail(res, '参数不完整', 400, 400);

  // 更新问题和答案
  await pool.query(
    'UPDATE knowledge_review SET question = ?, best_answer = ? WHERE id = ? AND status = ?',
    [question.trim(), answer.trim(), id, 'pending']
  );

  // 复用审核通过逻辑
  req.body = { id };
  // 转发到 approve 处理入库（不直接 next，避免重复响应）
  const [item] = await pool.query('SELECT id, question, best_answer, status FROM knowledge_review WHERE id = ?', [id]);
  if (item.length === 0) return fail(res, '问题不存在', 404, 404);
  if (item[0].status === 'approved') return fail(res, '已审核通过', 400, 400);

  const sourceId = `qa_${id}`;
  await indexKnowledgeChunk({
    source_id: sourceId,
    source_type: 'qa',
    title: item[0].question,
    content: item[0].best_answer,
    keywords: ['用户高频', '问答沉淀', '教师修订'],
  }).catch(async (err) => {
    if (/enum/i.test(err.message)) {
      await indexKnowledgeChunk({
        source_id: sourceId,
        source_type: 'document',
        title: item[0].question,
        content: item[0].best_answer,
        keywords: ['用户高频', '问答沉淀', '教师修订'],
      });
    } else {
      throw err;
    }
  });

  const [ch] = await pool.query('SELECT id FROM knowledge_chunks WHERE source_id = ? ORDER BY id DESC LIMIT 1', [sourceId]);
  const chunkId = ch[0]?.id || null;

  await pool.query(
    `UPDATE knowledge_review SET status = 'approved', reviewed_by = ?, reviewed_at = NOW(), chunk_id = ? WHERE id = ?`,
    [req.user.id, chunkId, id]
  );

  return success(res, { id, chunkId }, '已修订并入库');
}));

// ========== 6. 教师审核：已审核记录（通过+拒绝） ==========
router.get('/history', requireRole('teacher'), asyncHandler(async (req, res) => {
  const { limit = 50, offset = 0, status } = req.query;
  let sql = `SELECT id, question, ask_count, best_answer, status, reviewed_at, reject_reason, chunk_id, updated_at
             FROM knowledge_review WHERE status IN ('approved','rejected')`;
  const params = [];
  if (status && ['approved', 'rejected'].includes(status)) {
    sql += ' AND status = ?';
    params.push(status);
  }
  sql += ' ORDER BY reviewed_at DESC LIMIT ? OFFSET ?';
  params.push(Number(limit), Number(offset));

  const [rows] = await pool.query(sql, params);
  return success(res, rows.map(r => ({
    id: r.id,
    question: r.question,
    askCount: r.ask_count,
    bestAnswer: r.best_answer,
    status: r.status,
    reviewedAt: r.reviewed_at,
    rejectReason: r.reject_reason,
    chunkId: r.chunk_id,
    updatedAt: r.updated_at,
  })));
}));

// ========== 7. 教师审核：撤销已入库的知识 ==========
router.delete('/:id', requireRole('teacher'), asyncHandler(async (req, res) => {
  const { id } = req.params;
  const [rows] = await pool.query('SELECT id, status, chunk_id FROM knowledge_review WHERE id = ?', [id]);
  if (rows.length === 0) return fail(res, '记录不存在', 404, 404);
  const item = rows[0];

  if (item.status === 'approved' && item.chunk_id) {
    // 同步删除 knowledge_chunks 中的记录
    await pool.query('DELETE FROM knowledge_chunks WHERE id = ?', [item.chunk_id]);
  }
  await pool.query('UPDATE knowledge_review SET status = ?, chunk_id = NULL WHERE id = ?', ['rejected', id]);
  return success(res, null, '已撤销入库');
}));

export default router;
