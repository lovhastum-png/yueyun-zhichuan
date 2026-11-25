// 课程讨论路由：发帖、回复、列表
import { Router } from 'express';
import pool from '../db.js';
import { authRequired } from '../middleware/auth.js';
import { success, fail, asyncHandler } from '../middleware/error.js';
import { sanitizeBody, validateBody } from '../middleware/validate.js';

const router = Router();
router.use(authRequired);

// 课程讨论列表（扁平 + parent_id，前端可组装树）
router.get('/course/:courseId', asyncHandler(async (req, res) => {
  const { courseId } = req.params;
  const [c] = await pool.query('SELECT teacher_id FROM courses WHERE id = ?', [courseId]);
  if (c.length === 0) return fail(res, '课程不存在', 404, 404);
  const isTeacher = c[0].teacher_id === req.user.id;
  if (!isTeacher) {
    const [m] = await pool.query('SELECT 1 FROM course_members WHERE course_id = ? AND student_id = ?', [courseId, req.user.id]);
    if (m.length === 0) return fail(res, '无权访问', 403, 403);
  }
  const [rows] = await pool.query(
    `SELECT p.id, p.course_id, p.user_id, p.parent_id, p.content, p.created_at,
            u.username, u.real_name, u.role AS user_role, u.avatar
     FROM course_posts p JOIN users u ON p.user_id = u.id
     WHERE p.course_id = ? ORDER BY p.created_at ASC`,
    [courseId]
  );
  return success(res, rows);
}));

// 发帖 / 回复
router.post('/course/:courseId', sanitizeBody(['content']), validateBody({
  content: { required: true, maxLen: 5000, message: '帖子内容不能为空且不超过 5000 字' },
}), asyncHandler(async (req, res) => {
  const { courseId } = req.params;
  const { content, parentId } = req.body || {};
  if (!content || !content.trim()) return fail(res, '内容不能为空', 400, 400);
  const [c] = await pool.query('SELECT teacher_id FROM courses WHERE id = ?', [courseId]);
  if (c.length === 0) return fail(res, '课程不存在', 404, 404);
  const isTeacher = c[0].teacher_id === req.user.id;
  if (!isTeacher) {
    const [m] = await pool.query('SELECT 1 FROM course_members WHERE course_id = ? AND student_id = ?', [courseId, req.user.id]);
    if (m.length === 0) return fail(res, '无权操作', 403, 403);
  }
  const [r] = await pool.query(
    'INSERT INTO course_posts (course_id, user_id, parent_id, content) VALUES (?, ?, ?, ?)',
    [courseId, req.user.id, parentId || null, content.trim()]
  );
  const [rows] = await pool.query(
    `SELECT p.id, p.course_id, p.user_id, p.parent_id, p.content, p.created_at,
            u.username, u.real_name, u.role AS user_role
     FROM course_posts p JOIN users u ON p.user_id = u.id WHERE p.id = ?`,
    [r.insertId]
  );
  return success(res, rows[0], '已发布');
}));

// 删除帖子（本人或教师）
router.delete('/:id', asyncHandler(async (req, res) => {
  const { id } = req.params;
  const [rows] = await pool.query(
    `SELECT p.user_id, c.teacher_id FROM course_posts p JOIN courses c ON p.course_id = c.id WHERE p.id = ?`,
    [id]
  );
  if (rows.length === 0) return fail(res, '帖子不存在', 404, 404);
  const canDelete = rows[0].user_id === req.user.id || rows[0].teacher_id === req.user.id;
  if (!canDelete) return fail(res, '无权删除', 403, 403);
  await pool.query('DELETE FROM course_posts WHERE id = ?', [id]);
  return success(res, null, '已删除');
}));

export default router;
