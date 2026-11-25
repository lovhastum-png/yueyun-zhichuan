// 统一错误处理与响应工具
import config from '../config.js';

// 统一成功响应
export function success(res, data = null, message = '操作成功') {
  return res.json({ code: 0, message, data });
}

// 统一失败响应
// 注意：默认 HTTP 状态码必须是 5xx，否则新增调用一旦漏传 status 就会出现
// 「业务失败但 HTTP 200」的情况，前端统一拦截会失效。所有调用点请显式传 status。
export function fail(res, message = '操作失败', code = 500, status = 500) {
  return res.status(status).json({ code, message, data: null });
}

// 404 处理
export function notFound(req, res) {
  return res.status(404).json({ code: 404, message: '接口不存在', data: null });
}

// 全局错误捕获中间件（必须放最后，4 个参数）
// eslint-disable-next-line no-unused-vars
export function errorHandler(err, req, res, next) {
  if (res.headersSent) return next(err);
  console.error('[ERROR]', err.message || err);
  if (config.isDev) {
    console.error(err.stack);
  }
  const status = err.code === 'LIMIT_FILE_SIZE' ? 413 : (err.status || 500);
  const message = status === 413 ? '文件或请求内容过大，请缩小后重试'
    : err.type === 'entity.parse.failed' ? '请求格式无效，请刷新页面后重试'
    : err.expose ? err.message : (status === 500 ? '服务器内部错误' : err.message);
  return res.status(status).json({
    code: status,
    message,
    data: null,
  });
}

// 包装异步路由，自动捕获异常抛到错误中间件
export function asyncHandler(fn) {
  return (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);
}
