// 课程路由：建课、选课、课程详情
import { Router } from 'express';
import crypto from 'crypto';
import pool from '../db.js';
import { authRequired, requireRole } from '../middleware/auth.js';
import { success, fail, asyncHandler } from '../middleware/error.js';
import { broadcastNotice } from '../ws.js';

const router = Router();
router.use(authRequired);

// 我的课程（教师=所建课程，学生=所选课程）
router.get('/', asyncHandler(async (req, res) => {
  let rows;
  if (req.user.role === 'teacher') {
    [rows] = await pool.query(
      `SELECT c.*, u.username AS teacher_name, u.real_name AS teacher_real_name,
              (SELECT COUNT(*) FROM course_members WHERE course_id = c.id) AS member_count
       FROM courses c JOIN users u ON c.teacher_id = u.id
       WHERE c.teacher_id = ? ORDER BY c.created_at DESC`,
      [req.user.id]
    );
  } else {
    [rows] = await pool.query(
      `SELECT c.*, u.username AS teacher_name, u.real_name AS teacher_real_name,
              (SELECT COUNT(*) FROM course_members WHERE course_id = c.id) AS member_count
       FROM courses c
       JOIN course_members cm ON cm.course_id = c.id
       JOIN users u ON c.teacher_id = u.id
       WHERE cm.student_id = ? ORDER BY cm.joined_at DESC`,
      [req.user.id]
    );
  }
  return success(res, rows);
}));

// 所有开放课程（学生选课用）
router.get('/all', asyncHandler(async (req, res) => {
  const [rows] = await pool.query(
    `SELECT c.*, u.username AS teacher_name, u.real_name AS teacher_real_name,
            (SELECT COUNT(*) FROM course_members WHERE course_id = c.id) AS member_count,
            EXISTS(SELECT 1 FROM course_members WHERE course_id = c.id AND student_id = ?) AS joined
     FROM courses c JOIN users u ON c.teacher_id = u.id
     WHERE c.status = 'open' ORDER BY c.created_at DESC`,
    [req.user.id]
  );
  return success(res, rows);
}));

// 课程详情
router.get('/:id', asyncHandler(async (req, res) => {
  const { id } = req.params;
  const [rows] = await pool.query(
    `SELECT c.*, u.username AS teacher_name, u.real_name AS teacher_real_name, u.avatar AS teacher_avatar, u.intro AS teacher_intro,
            (SELECT COUNT(*) FROM course_members WHERE course_id = c.id) AS member_count
     FROM courses c JOIN users u ON c.teacher_id = u.id WHERE c.id = ?`,
    [id]
  );
  if (rows.length === 0) return fail(res, '课程不存在', 404, 404);
  const course = rows[0];
  // 权限：教师本人 或 已选课学生
  const isTeacher = course.teacher_id === req.user.id;
  let joined = false;
  if (!isTeacher) {
    const [m] = await pool.query('SELECT 1 FROM course_members WHERE course_id = ? AND student_id = ?', [id, req.user.id]);
    joined = m.length > 0;
    if (!joined) return fail(res, '请先加入该课程', 403, 403);
  }
  course.isTeacher = isTeacher;
  course.joined = joined || isTeacher;
  return success(res, course);
}));

// 建课（教师）
router.post('/', requireRole('teacher'), asyncHandler(async (req, res) => {
  const { title, subtitle, description, cover, category } = req.body || {};
  if (!title) return fail(res, '课程标题不能为空', 400, 400);
  const code = crypto.randomBytes(3).toString('hex').toUpperCase();
  const [r] = await pool.query(
    'INSERT INTO courses (teacher_id, title, subtitle, description, cover, category, code) VALUES (?, ?, ?, ?, ?, ?, ?)',
    [req.user.id, title, subtitle || null, description || null, cover || null, category || null, code]
  );
  const [rows] = await pool.query('SELECT * FROM courses WHERE id = ?', [r.insertId]);
  return success(res, rows[0], '课程已创建');
}));

// 编辑课程（教师本人）
router.put('/:id', requireRole('teacher'), asyncHandler(async (req, res) => {
  const { id } = req.params;
  const [rows] = await pool.query('SELECT * FROM courses WHERE id = ? AND teacher_id = ?', [id, req.user.id]);
  if (rows.length === 0) return fail(res, '课程不存在或无权操作', 404, 404);
  const { title, subtitle, description, cover, category, status } = req.body || {};
  await pool.query(
    `UPDATE courses SET title = COALESCE(?, title), subtitle = COALESCE(?, subtitle),
     description = COALESCE(?, description), cover = COALESCE(?, cover),
     category = COALESCE(?, category), status = COALESCE(?, status) WHERE id = ?`,
    [title ?? null, subtitle ?? null, description ?? null, cover ?? null, category ?? null, status ?? null, id]
  );
  const [updated] = await pool.query('SELECT * FROM courses WHERE id = ?', [id]);
  return success(res, updated[0], '课程已更新');
}));

// 删除课程（教师本人）
router.delete('/:id', requireRole('teacher'), asyncHandler(async (req, res) => {
  const { id } = req.params;
  const [rows] = await pool.query('SELECT id FROM courses WHERE id = ? AND teacher_id = ?', [id, req.user.id]);
  if (rows.length === 0) return fail(res, '课程不存在或无权操作', 404, 404);
  await pool.query('DELETE FROM courses WHERE id = ?', [id]);
  return success(res, null, '课程已删除');
}));

// 学生选课
router.post('/:id/join', requireRole('student'), asyncHandler(async (req, res) => {
  const { id } = req.params;
  const [c] = await pool.query('SELECT id, status FROM courses WHERE id = ?', [id]);
  if (c.length === 0) return fail(res, '课程不存在', 404, 404);
  if (c[0].status !== 'open') return fail(res, '该课程已关闭选课', 400, 400);
  try {
    await pool.query('INSERT INTO course_members (course_id, student_id) VALUES (?, ?)', [id, req.user.id]);
  } catch (e) {
    if (e.code === 'ER_DUP_ENTRY') return fail(res, '您已加入该课程', 409, 409);
    throw e;
  }
  broadcastNotice({ scope: 'course', courseId: id, message: `新同学加入了课程` });
  return success(res, null, '选课成功');
}));

// 课程成员列表（教师本人）
router.get('/:id/members', asyncHandler(async (req, res) => {
  const { id } = req.params;
  const [c] = await pool.query('SELECT teacher_id FROM courses WHERE id = ?', [id]);
  if (c.length === 0) return fail(res, '课程不存在', 404, 404);
  const isTeacher = c[0].teacher_id === req.user.id;
  let joined = false;
  if (!isTeacher) {
    const [m] = await pool.query('SELECT 1 FROM course_members WHERE course_id = ? AND student_id = ?', [id, req.user.id]);
    joined = m.length > 0;
    if (!joined) return fail(res, '无权查看', 403, 403);
  }
  const [rows] = await pool.query(
    `SELECT u.id, u.username, u.real_name, u.avatar, cm.joined_at
     FROM course_members cm JOIN users u ON cm.student_id = u.id
     WHERE cm.course_id = ? ORDER BY cm.joined_at ASC`,
    [id]
  );
  return success(res, rows);
}));

export default router;
