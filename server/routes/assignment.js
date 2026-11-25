// 作业路由：布置、提交、批改
import { Router } from 'express';
import pool from '../db.js';
import { authRequired, requireRole } from '../middleware/auth.js';
import { success, fail, asyncHandler } from '../middleware/error.js';
import { broadcastNotice } from '../ws.js';
import { idempotent } from '../middleware/idempotency.js';

const router = Router();
router.use(authRequired);

// 检查课程权限：返回 { course, isTeacher, hasAccess }
async function checkCourseAccess(courseId, userId) {
  const [rows] = await pool.query('SELECT * FROM courses WHERE id = ?', [courseId]);
  if (rows.length === 0) return { notFound: true };
  const course = rows[0];
  const isTeacher = course.teacher_id === userId;
  let joined = false;
  if (!isTeacher) {
    const [m] = await pool.query('SELECT 1 FROM course_members WHERE course_id = ? AND student_id = ?', [courseId, userId]);
    joined = m.length > 0;
  }
  return { course, isTeacher, hasAccess: isTeacher || joined };
}

// 课程下作业列表
router.get('/course/:courseId', asyncHandler(async (req, res) => {
  const { courseId } = req.params;
  const access = await checkCourseAccess(courseId, req.user.id);
  if (access.notFound) return fail(res, '课程不存在', 404, 404);
  if (!access.hasAccess) return fail(res, '无权访问', 403, 403);

  if (access.isTeacher) {
    const [rows] = await pool.query(
      `SELECT a.*,
        (SELECT COUNT(*) FROM assignment_submissions WHERE assignment_id = a.id) AS submit_count,
        (SELECT COUNT(*) FROM assignment_submissions WHERE assignment_id = a.id AND status = 'submitted') AS pending_count
       FROM assignments a WHERE a.course_id = ? ORDER BY a.created_at DESC`,
      [courseId]
    );
    return success(res, rows);
  } else {
    // 学生：附带自己的提交状态
    const [rows] = await pool.query(
      `SELECT a.*, s.id AS submission_id, s.status AS my_status, s.score AS my_score, s.feedback AS my_feedback
       FROM assignments a
       LEFT JOIN assignment_submissions s ON s.assignment_id = a.id AND s.student_id = ?
       WHERE a.course_id = ? ORDER BY a.created_at DESC`,
      [req.user.id, courseId]
    );
    return success(res, rows);
  }
}));

// 教师布置作业
router.post('/course/:courseId', requireRole('teacher'), asyncHandler(async (req, res) => {
  const { courseId } = req.params;
  const access = await checkCourseAccess(courseId, req.user.id);
  if (access.notFound) return fail(res, '课程不存在', 404, 404);
  if (!access.isTeacher) return fail(res, '无权操作', 403, 403);
  const { title, description, totalScore, dueAt } = req.body || {};
  if (!title) return fail(res, '作业标题不能为空', 400, 400);
  const [r] = await pool.query(
    'INSERT INTO assignments (course_id, title, description, total_score, due_at) VALUES (?, ?, ?, ?, ?)',
    [courseId, title, description || null, totalScore || 100, dueAt || null]
  );
  broadcastNotice({ scope: 'course', courseId, message: `新作业：${title}` });
  const [rows] = await pool.query('SELECT * FROM assignments WHERE id = ?', [r.insertId]);
  return success(res, rows[0], '作业已发布');
}));

// 作业详情
router.get('/:id', asyncHandler(async (req, res) => {
  const { id } = req.params;
  const [rows] = await pool.query(
    `SELECT a.*, c.teacher_id FROM assignments a JOIN courses c ON a.course_id = c.id WHERE a.id = ?`,
    [id]
  );
  if (rows.length === 0) return fail(res, '作业不存在', 404, 404);
  const a = rows[0];
  const isTeacher = a.teacher_id === req.user.id;
  if (!isTeacher) {
    const [m] = await pool.query('SELECT 1 FROM course_members WHERE course_id = ? AND student_id = ?', [a.course_id, req.user.id]);
    if (m.length === 0) return fail(res, '无权访问', 403, 403);
  }
  delete a.teacher_id;
  a.isTeacher = isTeacher;
  // 学生附带自己的提交
  if (!isTeacher) {
    const [s] = await pool.query('SELECT * FROM assignment_submissions WHERE assignment_id = ? AND student_id = ?', [id, req.user.id]);
    a.my_submission = s[0] || null;
  }
  return success(res, a);
}));

// 学生提交作业
router.post('/:id/submit', requireRole('student'), idempotent({ ttl: 15000 }), asyncHandler(async (req, res) => {
  const { id } = req.params;
  const { content, attachment } = req.body || {};
  if (!content && !attachment) return fail(res, '提交内容不能为空', 400, 400);
  const [rows] = await pool.query(
    `SELECT a.id, c.teacher_id FROM assignments a JOIN courses c ON a.course_id = c.id WHERE a.id = ?`,
    [id]
  );
  if (rows.length === 0) return fail(res, '作业不存在', 404, 404);
  const [m] = await pool.query('SELECT 1 FROM course_members WHERE course_id = (SELECT course_id FROM assignments WHERE id = ?) AND student_id = ?', [id, req.user.id]);
  if (m.length === 0) return fail(res, '未加入该课程', 403, 403);

  // upsert 提交
  await pool.query(
    `INSERT INTO assignment_submissions (assignment_id, student_id, content, attachment, status, submitted_at)
     VALUES (?, ?, ?, ?, 'submitted', NOW())
     ON DUPLICATE KEY UPDATE content = VALUES(content), attachment = VALUES(attachment), status = 'submitted', submitted_at = NOW()`,
    [id, req.user.id, content || null, attachment || null]
  );
  const [s] = await pool.query('SELECT * FROM assignment_submissions WHERE assignment_id = ? AND student_id = ?', [id, req.user.id]);
  return success(res, s[0], '作业已提交');
}));

// 教师查看作业所有提交
router.get('/:id/submissions', requireRole('teacher'), asyncHandler(async (req, res) => {
  const { id } = req.params;
  const [rows] = await pool.query(
    `SELECT a.course_id, c.teacher_id FROM assignments a JOIN courses c ON a.course_id = c.id WHERE a.id = ?`,
    [id]
  );
  if (rows.length === 0) return fail(res, '作业不存在', 404, 404);
  if (rows[0].teacher_id !== req.user.id) return fail(res, '无权操作', 403, 403);
  const [subs] = await pool.query(
    `SELECT s.*, u.username, u.real_name FROM assignment_submissions s
     JOIN users u ON s.student_id = u.id WHERE s.assignment_id = ? ORDER BY s.submitted_at DESC`,
    [id]
  );
  return success(res, subs);
}));

// 教师批改
router.put('/submission/:id/grade', requireRole('teacher'), asyncHandler(async (req, res) => {
  const { id } = req.params;
  const { score, feedback } = req.body || {};
  const [rows] = await pool.query(
    `SELECT s.id, a.course_id, c.teacher_id FROM assignment_submissions s
     JOIN assignments a ON s.assignment_id = a.id JOIN courses c ON a.course_id = c.id WHERE s.id = ?`,
    [id]
  );
  if (rows.length === 0) return fail(res, '提交记录不存在', 404, 404);
  if (rows[0].teacher_id !== req.user.id) return fail(res, '无权操作', 403, 403);
  await pool.query(
    `UPDATE assignment_submissions SET score = ?, feedback = ?, status = 'graded', graded_at = NOW() WHERE id = ?`,
    [score, feedback || null, id]
  );
  const [s] = await pool.query('SELECT * FROM assignment_submissions WHERE id = ?', [id]);
  return success(res, s[0], '批改完成');
}));

export default router;
