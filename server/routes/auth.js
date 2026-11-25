// 认证路由：注册、登录、获取当前用户
import { Router } from 'express';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import pool from '../db.js';
import config from '../config.js';
import { success, fail, asyncHandler } from '../middleware/error.js';
import { authRequired } from '../middleware/auth.js';
import { sanitizeText, sanitizeTitle } from '../middleware/validate.js';

const router = Router();

// 注册
router.post('/register', asyncHandler(async (req, res) => {
  let { username, password, email, role, realName } = req.body || {};
  // 清洗输入
  username = sanitizeTitle(username);
  realName = sanitizeTitle(realName);
  email = sanitizeTitle(email);
  if (!username || typeof password !== 'string' || !password) {
    return fail(res, '用户名和密码不能为空', 400, 400);
  }
  if (username.length < 2 || username.length > 50) {
    return fail(res, '用户名长度需为 2-50 个字符', 400, 400);
  }
  if (password.length < 6 || Buffer.byteLength(password, 'utf8') > 72) {
    return fail(res, '密码至少 6 位，且 UTF-8 编码不超过 72 字节', 400, 400);
  }
  // 角色校验：默认 student，仅允许 teacher / student
  const userRole = (role === 'teacher') ? 'teacher' : 'student';

  // 检查用户名是否已存在
  const [exists] = await pool.query('SELECT id FROM users WHERE username = ?', [username]);
  if (exists.length > 0) {
    return fail(res, '该用户名已被注册', 409, 409);
  }

  const hashed = await bcrypt.hash(password, 10);
  const [result] = await pool.query(
    'INSERT INTO users (username, password, email, role, real_name) VALUES (?, ?, ?, ?, ?)',
    [username, hashed, email || null, userRole, realName || null]
  );

  const token = jwt.sign(
    { id: result.insertId, username, role: userRole },
    config.jwt.secret,
    { expiresIn: config.jwt.expiresIn }
  );
  return success(res, {
    token,
    user: { id: result.insertId, username, email: email || null, role: userRole, realName: realName || null }
  }, '注册成功');
}));

// 登录
router.post('/login', asyncHandler(async (req, res) => {
  const { username, password } = req.body || {};
  if (typeof username !== 'string' || typeof password !== 'string' || !username.trim() || !password) {
    return fail(res, '用户名和密码不能为空', 400, 400);
  }

  const [rows] = await pool.query(
    'SELECT id, username, password, email, role, real_name, avatar, intro FROM users WHERE username = ?',
    [username.trim()]
  );
  if (rows.length === 0) {
    return fail(res, '用户名或密码错误', 401, 401);
  }
  const user = rows[0];
  const valid = await bcrypt.compare(password, user.password);
  if (!valid) {
    return fail(res, '用户名或密码错误', 401, 401);
  }

  const token = jwt.sign(
    { id: user.id, username: user.username, role: user.role },
    config.jwt.secret,
    { expiresIn: config.jwt.expiresIn }
  );
  return success(res, {
    token,
    user: {
      id: user.id, username: user.username, email: user.email,
      role: user.role, realName: user.real_name, avatar: user.avatar, intro: user.intro
    }
  }, '登录成功');
}));

// 获取当前用户
router.get('/me', authRequired, asyncHandler(async (req, res) => {
  const [rows] = await pool.query(
    'SELECT id, username, email, role, real_name, avatar, intro, created_at FROM users WHERE id = ?',
    [req.user.id]
  );
  if (rows.length === 0) {
    return fail(res, '用户不存在', 404, 404);
  }
  return success(res, rows[0]);
}));

// 更新个人资料
router.put('/me', authRequired, asyncHandler(async (req, res) => {
  const { email, realName, avatar, intro } = req.body || {};
  await pool.query(
    'UPDATE users SET email = COALESCE(?, email), real_name = COALESCE(?, real_name), avatar = COALESCE(?, avatar), intro = COALESCE(?, intro) WHERE id = ?',
    [email ?? null, realName ?? null, avatar ?? null, intro ?? null, req.user.id]
  );
  const [rows] = await pool.query(
    'SELECT id, username, email, role, real_name, avatar, intro FROM users WHERE id = ?',
    [req.user.id]
  );
  return success(res, rows[0], '资料已更新');
}));

export default router;
