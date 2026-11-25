// 点名路由：开签到、学生签到、查看记录
import { Router } from 'express';
import pool from '../db.js';
import { authRequired, requireRole } from '../middleware/auth.js';
import { success, fail, asyncHandler } from '../middleware/error.js';
import { broadcastNotice } from '../ws.js';
import { idempotent } from '../middleware/idempotency.js';

const router = Router();
router.use(authRequired);

// 生成 4 位数字签到码
function genCode() {
  return String(Math.floor(1000 + Math.random() * 9000));
}

async function checkTeacher(courseId, userId) {
  const [rows] = await pool.query('SELECT teacher_id FROM courses WHERE id = ?', [courseId]);
  if (rows.length === 0) return { notFound: true };
  return { isTeacher: rows[0].teacher_id === userId };
}

// 课程下签到会话列表
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
      `SELECT a.*,
        (SELECT COUNT(*) FROM attendance_records WHERE attendance_id = a.id AND status = 'present') AS present_count,
        (SELECT COUNT(*) FROM attendance_records WHERE attendance_id = a.id AND status = 'late') AS late_count,
        (SELECT COUNT(*) FROM course_members WHERE course_id = a.course_id) AS total_count
       FROM attendances a WHERE a.course_id = ? ORDER BY a.start_at DESC`,
      [courseId]
    );
    return success(res, rows);
  } else {
    // 学生：看自己签到状态
    const [rows] = await pool.query(
      `SELECT a.*, r.status AS my_status, r.signed_at AS my_signed_at
       FROM attendances a
       LEFT JOIN attendance_records r ON r.attendance_id = a.id AND r.student_id = ?
       WHERE a.course_id = ? ORDER BY a.start_at DESC`,
      [req.user.id, courseId]
    );
    return success(res, rows);
  }
}));

// 教师开签到
router.post('/course/:courseId', requireRole('teacher'), asyncHandler(async (req, res) => {
  const { courseId } = req.params;
  const t = await checkTeacher(courseId, req.user.id);
  if (t.notFound) return fail(res, '课程不存在', 404, 404);
  if (!t.isTeacher) return fail(res, '无权操作', 403, 403);
  const { title, durationMin } = req.body || {};
  const code = genCode();
  const endAt = new Date(Date.now() + (durationMin || 5) * 60 * 1000);
  const [r] = await pool.query(
    'INSERT INTO attendances (course_id, teacher_id, code, title, start_at, end_at, status) VALUES (?, ?, ?, ?, NOW(), ?, \'active\')',
    [courseId, req.user.id, code, title || '课堂签到', endAt]
  );
  broadcastNotice({ scope: 'course', courseId, message: `签到开始，签到码：${code}` });
  const [rows] = await pool.query('SELECT * FROM attendances WHERE id = ?', [r.insertId]);
  return success(res, rows[0], '签到已开启');
}));

// 教师关闭签到
router.put('/:id/close', requireRole('teacher'), asyncHandler(async (req, res) => {
  const { id } = req.params;
  const [rows] = await pool.query(
    `SELECT a.*, c.teacher_id FROM attendances a JOIN courses c ON a.course_id = c.id WHERE a.id = ?`,
    [id]
  );
  if (rows.length === 0) return fail(res, '签到会话不存在', 404, 404);
  if (rows[0].teacher_id !== req.user.id) return fail(res, '无权操作', 403, 403);
  // 关闭会话，未签到学生标记 absent
  await pool.query(
    `INSERT INTO attendance_records (attendance_id, student_id, status)
     SELECT a.id, cm.student_id, 'absent'
     FROM attendances a JOIN course_members cm ON cm.course_id = a.course_id
     LEFT JOIN attendance_records r ON r.attendance_id = a.id AND r.student_id = cm.student_id
     WHERE a.id = ? AND r.id IS NULL`,
    [id]
  );
  await pool.query('UPDATE attendances SET status = \'closed\' WHERE id = ?', [id]);
  return success(res, null, '签到已关闭');
}));

// 学生签到
router.post('/sign', requireRole('student'), idempotent({ ttl: 8000 }), asyncHandler(async (req, res) => {
  const { code } = req.body || {};
  if (!code) return fail(res, '请输入签到码', 400, 400);
  const [rows] = await pool.query(
    `SELECT a.*, c.teacher_id FROM attendances a JOIN courses c ON a.course_id = c.id WHERE a.code = ? AND a.status = 'active'`,
    [String(code).trim()]
  );
  if (rows.length === 0) return fail(res, '签到码无效或签到已结束', 400, 400);
  const att = rows[0];
  // 必须是课程成员
  const [m] = await pool.query('SELECT 1 FROM course_members WHERE course_id = ? AND student_id = ?', [att.course_id, req.user.id]);
  if (m.length === 0) return fail(res, '您未加入该课程', 403, 403);
  // 判断是否迟到
  const now = new Date();
  const isLate = now > new Date(att.end_at);
  const status = isLate ? 'late' : 'present';
  try {
    await pool.query(
      'INSERT INTO attendance_records (attendance_id, student_id, status, signed_at) VALUES (?, ?, ?, NOW())',
      [att.id, req.user.id, status]
    );
  } catch (e) {
    if (e.code === 'ER_DUP_ENTRY') return fail(res, '您已签到', 409, 409);
    throw e;
  }
  return success(res, { status }, isLate ? '签到成功（迟到）' : '签到成功');
}));

// 签到记录详情（教师）
router.get('/:id/records', requireRole('teacher'), asyncHandler(async (req, res) => {
  const { id } = req.params;
  const [rows] = await pool.query(
    `SELECT a.course_id, c.teacher_id FROM attendances a JOIN courses c ON a.course_id = c.id WHERE a.id = ?`,
    [id]
  );
  if (rows.length === 0) return fail(res, '签到会话不存在', 404, 404);
  if (rows[0].teacher_id !== req.user.id) return fail(res, '无权操作', 403, 403);
  const [records] = await pool.query(
    `SELECT r.*, u.username, u.real_name FROM attendance_records r
     JOIN users u ON r.student_id = u.id WHERE r.attendance_id = ? ORDER BY r.signed_at ASC`,
    [id]
  );
  return success(res, records);
}));

export default router;
