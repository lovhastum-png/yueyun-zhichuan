// 视频路由：上传、播放、列表
import { Router } from 'express';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';
import multer from 'multer';
import pool from '../db.js';
import { authRequired, requireRole } from '../middleware/auth.js';
import { success, fail, asyncHandler } from '../middleware/error.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// 视频存储目录
const videoDir = path.join(__dirname, '..', '..', 'uploads', 'videos');
fs.mkdirSync(videoDir, { recursive: true });

// multer 配置：磁盘存储，限制 200MB
const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, videoDir),
  filename: (req, file, cb) => {
    const ext = path.extname(file.originalname) || '.mp4';
    cb(null, `vid_${Date.now()}_${Math.random().toString(36).slice(2, 8)}${ext}`);
  },
});
const upload = multer({
  storage,
  limits: { fileSize: 200 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase();
    if (['.mp4', '.webm', '.ogg', '.mov', '.mkv'].includes(ext)) cb(null, true);
    else cb(new Error('仅支持 mp4/webm/ogg/mov/mkv 格式视频'));
  },
});

const router = Router();
router.use(authRequired);

async function checkTeacher(courseId, userId) {
  const [rows] = await pool.query('SELECT teacher_id FROM courses WHERE id = ?', [courseId]);
  if (rows.length === 0) return { notFound: true };
  return { isTeacher: rows[0].teacher_id === userId };
}

// 课程视频列表
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
    'SELECT id, title, description, duration, size, sort_order, created_at FROM videos WHERE course_id = ? ORDER BY sort_order ASC, created_at ASC',
    [courseId]
  );
  return success(res, rows);
}));

// 教师上传视频
router.post('/course/:courseId', requireRole('teacher'), upload.single('video'), asyncHandler(async (req, res) => {
  const { courseId } = req.params;
  const t = await checkTeacher(courseId, req.user.id);
  if (t.notFound) return fail(res, '课程不存在', 404, 404);
  if (!t.isTeacher) return fail(res, '无权操作', 403, 403);
  if (!req.file) return fail(res, '请上传视频文件', 400, 400);
  const { title, description, sortOrder } = req.body || {};
  const [r] = await pool.query(
    'INSERT INTO videos (course_id, title, description, file_path, size, sort_order) VALUES (?, ?, ?, ?, ?, ?)',
    [courseId, title || req.file.originalname, description || null, req.file.filename, req.file.size, sortOrder || 0]
  );
  const [rows] = await pool.query('SELECT id, title, description, size, sort_order, created_at FROM videos WHERE id = ?', [r.insertId]);
  return success(res, rows[0], '视频已上传');
}));

// 视频流播放（支持 Range 分段请求）
router.get('/:id/play', asyncHandler(async (req, res) => {
  const { id } = req.params;
  const [rows] = await pool.query(
    `SELECT v.*, c.teacher_id FROM videos v JOIN courses c ON v.course_id = c.id WHERE v.id = ?`,
    [id]
  );
  if (rows.length === 0) return fail(res, '视频不存在', 404, 404);
  const v = rows[0];
  const isTeacher = v.teacher_id === req.user.id;
  if (!isTeacher) {
    const [m] = await pool.query('SELECT 1 FROM course_members WHERE course_id = ? AND student_id = ?', [v.course_id, req.user.id]);
    if (m.length === 0) return fail(res, '无权访问', 403, 403);
  }
  const filePath = path.join(videoDir, v.file_path);
  if (!fs.existsSync(filePath)) return fail(res, '视频文件丢失', 404, 404);

  const stat = fs.statSync(filePath);
  const fileSize = stat.size;
  const range = req.headers.range;
  if (range) {
    const parts = range.replace(/bytes=/, '').split('-');
    const start = parseInt(parts[0], 10);
    const end = parts[1] ? parseInt(parts[1], 10) : fileSize - 1;
    const chunkSize = end - start + 1;
    const stream = fs.createReadStream(filePath, { start, end });
    res.writeHead(206, {
      'Content-Range': `bytes ${start}-${end}/${fileSize}`,
      'Accept-Ranges': 'bytes',
      'Content-Length': chunkSize,
      'Content-Type': 'video/mp4',
    });
    stream.pipe(res);
  } else {
    res.writeHead(200, { 'Content-Length': fileSize, 'Content-Type': 'video/mp4' });
    fs.createReadStream(filePath).pipe(res);
  }
}));

// 删除视频（教师）
router.delete('/:id', requireRole('teacher'), asyncHandler(async (req, res) => {
  const { id } = req.params;
  const [rows] = await pool.query(
    `SELECT v.file_path, c.teacher_id FROM videos v JOIN courses c ON v.course_id = c.id WHERE v.id = ?`,
    [id]
  );
  if (rows.length === 0) return fail(res, '视频不存在', 404, 404);
  if (rows[0].teacher_id !== req.user.id) return fail(res, '无权操作', 403, 403);
  // 删除文件
  try { fs.unlinkSync(path.join(videoDir, rows[0].file_path)); } catch {}
  await pool.query('DELETE FROM videos WHERE id = ?', [id]);
  return success(res, null, '视频已删除');
}));

export default router;
