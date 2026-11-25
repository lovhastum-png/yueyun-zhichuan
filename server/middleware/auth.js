// JWT 鉴权中间件
import jwt from 'jsonwebtoken';
import config from '../config.js';

// 从请求头解析 token，验证后将 user 挂载到 req.user
export function authRequired(req, res, next) {
  const authHeader = req.headers.authorization || '';
  const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : null;

  if (!token) {
    return res.status(401).json({ code: 401, message: '未提供认证令牌，请先登录' });
  }

  try {
    const payload = jwt.verify(token, config.jwt.secret);
    req.user = { id: payload.id, username: payload.username, role: payload.role };
    next();
  } catch (err) {
    return res.status(401).json({ code: 401, message: '认证令牌无效或已过期，请重新登录' });
  }
}

// 可选鉴权：有 token 则解析，无 token 也放行
export function authOptional(req, res, next) {
  const authHeader = req.headers.authorization || '';
  const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : null;
  if (token) {
    try {
      const payload = jwt.verify(token, config.jwt.secret);
      req.user = { id: payload.id, username: payload.username, role: payload.role };
    } catch {
      // token 无效时忽略，按未登录处理
    }
  }
  next();
}

// 角色校验：requireRole('teacher') / requireRole('student') / requireRole('teacher','student')
export function requireRole(...roles) {
  return (req, res, next) => {
    if (!req.user) {
      return res.status(401).json({ code: 401, message: '请先登录' });
    }
    if (!roles.includes(req.user.role)) {
      return res.status(403).json({ code: 403, message: '权限不足，无法执行此操作' });
    }
    next();
  };
}
