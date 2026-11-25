// 考试路由：创建考试、出题、答题、自动判分
import { Router } from 'express';
import pool from '../db.js';
import { authRequired, requireRole } from '../middleware/auth.js';
import { success, fail, asyncHandler } from '../middleware/error.js';
import { idempotent } from '../middleware/idempotency.js';

const router = Router();
router.use(authRequired);

async function checkTeacher(courseId, userId) {
  const [rows] = await pool.query('SELECT teacher_id FROM courses WHERE id = ?', [courseId]);
  if (rows.length === 0) return { notFound: true };
  return { isTeacher: rows[0].teacher_id === userId };
}

// 题库里的 answer 字段历史上既有 JSON 字符串也有已解析对象，还可能有脏数据。
// 直接 JSON.parse 遇到脏数据会让整场考试提交报 500，这里统一兜底。
function safeParseJson(value) {
  if (value === null || value === undefined || value === '') return null;
  if (typeof value !== 'string') return value;
  try {
    return JSON.parse(value);
  } catch {
    console.warn('[exam] 题目答案不是合法 JSON，已按原始值处理');
    return value;
  }
}

// 课程下考试列表
router.get('/course/:courseId', asyncHandler(async (req, res) => {
  const { courseId } = req.params;
  const [c] = await pool.query('SELECT teacher_id FROM courses WHERE id = ?', [courseId]);
  if (c.length === 0) return fail(res, '课程不存在', 404, 404);
  const isTeacher = c[0].teacher_id === req.user.id;
  if (!isTeacher) {
    const [m] = await pool.query('SELECT 1 FROM course_members WHERE course_id = ? AND student_id = ?', [courseId, req.user.id]);
    if (m.length === 0) return fail(res, '无权访问', 403, 403);
  }

  if (isTeacher) {
    const [rows] = await pool.query(
      `SELECT e.*,
        (SELECT COUNT(*) FROM exam_questions WHERE exam_id = e.id) AS question_count,
        (SELECT COUNT(*) FROM exam_submissions WHERE exam_id = e.id AND status IN ('submitted','graded')) AS submit_count
       FROM exams e WHERE e.course_id = ? ORDER BY e.created_at DESC`,
      [courseId]
    );
    return success(res, rows);
  } else {
    const [rows] = await pool.query(
      `SELECT e.*, s.id AS submission_id, s.status AS my_status, s.score AS my_score,
        (SELECT COUNT(*) FROM exam_questions WHERE exam_id = e.id) AS question_count
       FROM exams e
       LEFT JOIN exam_submissions s ON s.exam_id = e.id AND s.student_id = ?
       WHERE e.course_id = ? ORDER BY e.created_at DESC`,
      [req.user.id, courseId]
    );
    return success(res, rows);
  }
}));

// 教师创建考试
router.post('/course/:courseId', requireRole('teacher'), asyncHandler(async (req, res) => {
  const { courseId } = req.params;
  const t = await checkTeacher(courseId, req.user.id);
  if (t.notFound) return fail(res, '课程不存在', 404, 404);
  if (!t.isTeacher) return fail(res, '无权操作', 403, 403);
  const { title, description, totalScore, durationMin, startAt, endAt } = req.body || {};
  if (!title) return fail(res, '考试标题不能为空', 400, 400);
  const [r] = await pool.query(
    'INSERT INTO exams (course_id, title, description, total_score, duration_min, start_at, end_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
    [courseId, title, description || null, totalScore || 100, durationMin || 60, startAt || null, endAt || null]
  );
  const [rows] = await pool.query('SELECT * FROM exams WHERE id = ?', [r.insertId]);
  return success(res, rows[0], '考试已创建');
}));

// 考试详情（教师含答案，学生不含答案）
router.get('/:id', asyncHandler(async (req, res) => {
  const { id } = req.params;
  const [rows] = await pool.query(
    `SELECT e.*, c.teacher_id FROM exams e JOIN courses c ON e.course_id = c.id WHERE e.id = ?`,
    [id]
  );
  if (rows.length === 0) return fail(res, '考试不存在', 404, 404);
  const e = rows[0];
  const isTeacher = e.teacher_id === req.user.id;
  if (!isTeacher) {
    const [m] = await pool.query('SELECT 1 FROM course_members WHERE course_id = ? AND student_id = ?', [e.course_id, req.user.id]);
    if (m.length === 0) return fail(res, '无权访问', 403, 403);
  }
  delete e.teacher_id;

  // 查题目
  let [questions] = await pool.query('SELECT * FROM exam_questions WHERE exam_id = ? ORDER BY sort_order ASC, id ASC', [id]);
  if (!isTeacher) {
    // 学生：去掉 answer 字段
    questions = questions.map(q => {
      const { answer, ...rest } = q;
      return rest;
    });
  }
  e.isTeacher = isTeacher;
  e.questions = questions;

  // 学生：附带自己的提交状态
  if (!isTeacher) {
    const [s] = await pool.query('SELECT id, status, score, started_at, submitted_at FROM exam_submissions WHERE exam_id = ? AND student_id = ?', [id, req.user.id]);
    e.my_submission = s[0] || null;
  }
  return success(res, e);
}));

// 教师添加题目
router.post('/:id/question', requireRole('teacher'), asyncHandler(async (req, res) => {
  const { id } = req.params;
  const [rows] = await pool.query(
    `SELECT e.id, c.teacher_id FROM exams e JOIN courses c ON e.course_id = c.id WHERE e.id = ?`,
    [id]
  );
  if (rows.length === 0) return fail(res, '考试不存在', 404, 404);
  if (rows[0].teacher_id !== req.user.id) return fail(res, '无权操作', 403, 403);
  const { type, content, options, answer, score, sortOrder } = req.body || {};
  if (!type || !content) return fail(res, '题型和题目内容不能为空', 400, 400);
  if (!['single', 'multiple', 'judge', 'short'].includes(type)) return fail(res, '题型不合法', 400, 400);
  const [r] = await pool.query(
    'INSERT INTO exam_questions (exam_id, type, content, options, answer, score, sort_order) VALUES (?, ?, ?, ?, ?, ?, ?)',
    [id, type, content, options ? JSON.stringify(options) : null, answer !== undefined ? JSON.stringify(answer) : null, score || 5, sortOrder || 0]
  );
  const [q] = await pool.query('SELECT * FROM exam_questions WHERE id = ?', [r.insertId]);
  return success(res, q[0], '题目已添加');
}));

// 教师批量添加题目
router.post('/:id/questions', requireRole('teacher'), asyncHandler(async (req, res) => {
  const { id } = req.params;
  const [rows] = await pool.query(
    `SELECT e.id, c.teacher_id FROM exams e JOIN courses c ON e.course_id = c.id WHERE e.id = ?`,
    [id]
  );
  if (rows.length === 0) return fail(res, '考试不存在', 404, 404);
  if (rows[0].teacher_id !== req.user.id) return fail(res, '无权操作', 403, 403);
  const { questions } = req.body || {};
  if (!Array.isArray(questions) || questions.length === 0) return fail(res, '题目列表不能为空', 400, 400);
  let count = 0;
  for (let i = 0; i < questions.length; i++) {
    const q = questions[i];
    if (!q.type || !q.content) continue;
    await pool.query(
      'INSERT INTO exam_questions (exam_id, type, content, options, answer, score, sort_order) VALUES (?, ?, ?, ?, ?, ?, ?)',
      [id, q.type, q.content, q.options ? JSON.stringify(q.options) : null, q.answer !== undefined ? JSON.stringify(q.answer) : null, q.score || 5, q.sortOrder || i]
    );
    count++;
  }
  return success(res, { count }, `已添加 ${count} 道题目`);
}));

// 教师删除题目
router.delete('/question/:qid', requireRole('teacher'), asyncHandler(async (req, res) => {
  const { qid } = req.params;
  const [rows] = await pool.query(
    `SELECT q.id, c.teacher_id FROM exam_questions q JOIN exams e ON q.exam_id = e.id JOIN courses c ON e.course_id = c.id WHERE q.id = ?`,
    [qid]
  );
  if (rows.length === 0) return fail(res, '题目不存在', 404, 404);
  if (rows[0].teacher_id !== req.user.id) return fail(res, '无权操作', 403, 403);
  await pool.query('DELETE FROM exam_questions WHERE id = ?', [qid]);
  return success(res, null, '题目已删除');
}));

// 学生开始考试（创建提交记录）
router.post('/:id/start', requireRole('student'), asyncHandler(async (req, res) => {
  const { id } = req.params;
  const [rows] = await pool.query(
    `SELECT e.*, c.teacher_id FROM exams e JOIN courses c ON e.course_id = c.id WHERE e.id = ?`,
    [id]
  );
  if (rows.length === 0) return fail(res, '考试不存在', 404, 404);
  const e = rows[0];
  const [m] = await pool.query('SELECT 1 FROM course_members WHERE course_id = ? AND student_id = ?', [e.course_id, req.user.id]);
  if (m.length === 0) return fail(res, '未加入该课程', 403, 403);
  // 时间校验
  const now = new Date();
  if (e.start_at && now < new Date(e.start_at)) return fail(res, '考试尚未开始', 400, 400);
  if (e.end_at && now > new Date(e.end_at)) return fail(res, '考试已结束', 400, 400);

  // upsert 提交记录
  try {
    await pool.query('INSERT INTO exam_submissions (exam_id, student_id, status) VALUES (?, ?, \'in_progress\')', [id, req.user.id]);
  } catch (err) {
    if (err.code === 'ER_DUP_ENTRY') {
      const [s] = await pool.query('SELECT * FROM exam_submissions WHERE exam_id = ? AND student_id = ?', [id, req.user.id]);
      if (s[0].status === 'submitted' || s[0].status === 'graded') return fail(res, '您已提交过此考试', 400, 400);
    } else throw err;
  }
  const [s] = await pool.query('SELECT * FROM exam_submissions WHERE exam_id = ? AND student_id = ?', [id, req.user.id]);
  return success(res, s[0], '考试已开始');
}));

// 学生提交考试（自动判分客观题）
router.post('/:id/submit', requireRole('student'), idempotent({ ttl: 15000 }), asyncHandler(async (req, res) => {
  const { id } = req.params;
  const { answers } = req.body || {};
  if (!answers) return fail(res, '答案不能为空', 400, 400);

  const [subRows] = await pool.query('SELECT * FROM exam_submissions WHERE exam_id = ? AND student_id = ?', [id, req.user.id]);
  if (subRows.length === 0) return fail(res, '请先开始考试', 400, 400);
  if (subRows[0].status === 'submitted' || subRows[0].status === 'graded') return fail(res, '您已提交过', 400, 400);

  // 交卷时限校验：原本只有"开始考试"校验时间，学生可在考试结束后继续交卷。
  // 留 60 秒宽限期，避免在截止瞬间点提交的学生被误伤。
  const [examRows] = await pool.query('SELECT id, end_at FROM exams WHERE id = ?', [id]);
  if (examRows.length === 0) return fail(res, '考试不存在', 404, 404);
  if (examRows[0].end_at) {
    const deadline = new Date(examRows[0].end_at).getTime() + 60_000;
    if (Date.now() > deadline) return fail(res, '考试已结束，无法提交', 400, 400);
  }

  const [questions] = await pool.query('SELECT * FROM exam_questions WHERE exam_id = ?', [id]);

  // 自动判分：single / multiple / judge 为客观题，short 为简答（不计分，待教师批改）
  let totalScore = 0;
  let autoScore = 0;
  let hasShort = false;
  for (const q of questions) {
    if (q.type === 'short') { hasShort = true; continue; }
    const userAns = answers[String(q.id)] ?? answers[q.id];
    const correctAns = safeParseJson(q.answer);
    let correct = false;
    if (correctAns && Array.isArray(correctAns)) {
      const ua = Array.isArray(userAns) ? userAns.slice().sort() : (userAns !== undefined && userAns !== null ? [userAns] : []);
      const ca = correctAns.slice().sort();
      if (q.type === 'multiple') {
        correct = ua.length === ca.length && ua.every((v, i) => String(v) === String(ca[i]));
      } else {
        correct = ua.length === 1 && String(ua[0]) === String(ca[0]);
      }
    }
    if (correct) autoScore += q.score;
    totalScore += q.score;
  }

  const finalScore = hasShort ? null : autoScore; // 有简答题则等教师批改后给分
  const status = hasShort ? 'submitted' : 'graded';

  await pool.query(
    'UPDATE exam_submissions SET answers = ?, score = ?, status = ?, submitted_at = NOW() WHERE id = ?',
    [JSON.stringify(answers), finalScore, status, subRows[0].id]
  );

  const [s] = await pool.query('SELECT * FROM exam_submissions WHERE id = ?', [subRows[0].id]);
  return success(res, s[0], hasShort ? '考试已提交，简答题待教师批改' : `考试已提交，得分 ${autoScore}/${totalScore}`);
}));

// 教师查看所有提交
router.get('/:id/submissions', requireRole('teacher'), asyncHandler(async (req, res) => {
  const { id } = req.params;
  const [rows] = await pool.query(
    `SELECT e.id, c.teacher_id FROM exams e JOIN courses c ON e.course_id = c.id WHERE e.id = ?`,
    [id]
  );
  if (rows.length === 0) return fail(res, '考试不存在', 404, 404);
  if (rows[0].teacher_id !== req.user.id) return fail(res, '无权操作', 403, 403);
  const [subs] = await pool.query(
    `SELECT s.*, u.username, u.real_name FROM exam_submissions s
     JOIN users u ON s.student_id = u.id WHERE s.exam_id = ? ORDER BY s.submitted_at DESC`,
    [id]
  );
  return success(res, subs);
}));

// 教师批改简答题/调整分数
router.put('/submission/:sid/grade', requireRole('teacher'), asyncHandler(async (req, res) => {
  const { sid } = req.params;
  const { score } = req.body || {};
  const [rows] = await pool.query(
    `SELECT s.id, c.teacher_id FROM exam_submissions s JOIN exams e ON s.exam_id = e.id JOIN courses c ON e.course_id = c.id WHERE s.id = ?`,
    [sid]
  );
  if (rows.length === 0) return fail(res, '提交记录不存在', 404, 404);
  if (rows[0].teacher_id !== req.user.id) return fail(res, '无权操作', 403, 403);
  await pool.query('UPDATE exam_submissions SET score = ?, status = \'graded\' WHERE id = ?', [score, sid]);
  const [s] = await pool.query('SELECT * FROM exam_submissions WHERE id = ?', [sid]);
  return success(res, s[0], '批改完成');
}));

export default router;
