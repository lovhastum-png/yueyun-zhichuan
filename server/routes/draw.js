// 画板路由：保存、查看、列表
import { Router } from 'express';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';
import multer from 'multer';
import pool from '../db.js';
import { authRequired } from '../middleware/auth.js';
import { success, fail, asyncHandler } from '../middleware/error.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const drawDir = path.join(__dirname, '..', '..', 'uploads', 'drawings');
fs.mkdirSync(drawDir, { recursive: true });

// multer：接收 PNG 图片
const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, drawDir),
  filename: (req, file, cb) => {
    cb(null, `draw_${Date.now()}_${Math.random().toString(36).slice(2, 8)}.png`);
  },
});
const upload = multer({
  storage,
  limits: { fileSize: 10 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    if (file.mimetype === 'image/png') cb(null, true);
    else cb(new Error('仅支持 PNG 格式'));
  },
});

const router = Router();
router.use(authRequired);

// 我的画板作品
router.get('/', asyncHandler(async (req, res) => {
  const [rows] = await pool.query(
    'SELECT id, title, file_path, created_at FROM drawings WHERE user_id = ? ORDER BY created_at DESC',
    [req.user.id]
  );
  return success(res, rows);
}));

// 保存画板
router.post('/', upload.single('image'), asyncHandler(async (req, res) => {
  if (!req.file) return fail(res, '请上传图片', 400, 400);
  const { title } = req.body || {};
  const [r] = await pool.query(
    'INSERT INTO drawings (user_id, title, file_path) VALUES (?, ?, ?)',
    [req.user.id, title || '未题名', req.file.filename]
  );
  const [rows] = await pool.query('SELECT id, title, file_path, created_at FROM drawings WHERE id = ?', [r.insertId]);
  return success(res, rows[0], '画作已保存');
}));

// 查看画板图片
router.get('/:id/image', asyncHandler(async (req, res) => {
  const { id } = req.params;
  const [rows] = await pool.query('SELECT file_path, user_id FROM drawings WHERE id = ?', [id]);
  if (rows.length === 0) return fail(res, '画作不存在', 404, 404);
  // 仅本人可查看（也可放宽为登录可见）
  if (rows[0].user_id !== req.user.id) return fail(res, '无权查看', 403, 403);
  const filePath = path.join(drawDir, rows[0].file_path);
  if (!fs.existsSync(filePath)) return fail(res, '文件丢失', 404, 404);
  res.sendFile(filePath);
}));

// 删除画板
router.delete('/:id', asyncHandler(async (req, res) => {
  const { id } = req.params;
  const [rows] = await pool.query('SELECT file_path, user_id FROM drawings WHERE id = ?', [id]);
  if (rows.length === 0) return fail(res, '画作不存在', 404, 404);
  if (rows[0].user_id !== req.user.id) return fail(res, '无权操作', 403, 403);
  try { fs.unlinkSync(path.join(drawDir, rows[0].file_path)); } catch {}
  await pool.query('DELETE FROM drawings WHERE id = ?', [id]);
  return success(res, null, '已删除');
}));

export default router;
