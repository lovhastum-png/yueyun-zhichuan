// ============================================================
// 请求日志中间件：记录每个 HTTP 请求的方法/路径/状态/耗时
// 并维护运行时统计（请求数、错误数、平均响应时间）
// ============================================================
import logger from '../utils/logger.js';

const log = logger.module('HTTP');

// 慢请求阈值（ms）
const SLOW_THRESHOLD = 2000;

// 运行时请求统计
const requestStats = {
  total: 0,
  success: 0,        // 2xx/3xx
  clientError: 0,    // 4xx
  serverError: 0,    // 5xx
  totalDuration: 0,
  maxDuration: 0,
  slowRequests: 0,
  // 按路径分组的统计（最近 N 条）
  byPath: new Map(),
};

const MAX_PATH_ENTRIES = 50;

export function requestLogger(req, res, next) {
  const start = Date.now();
  requestStats.total++;

  // 响应完成时记录
  res.on('finish', () => {
    const duration = Date.now() - start;
    const status = res.statusCode;
    const method = req.method;
    const url = req.originalUrl || req.url;
    // 脱敏：去掉查询参数中的 token 等敏感字段
    const safeUrl = url.replace(/([?&])(token|password|key)=[^&]*/gi, '$1$2=***');

    // 分类统计
    if (status >= 500) {
      requestStats.serverError++;
      log.error(`${method} ${safeUrl} → ${status} (${duration}ms)`);
    } else if (status >= 400) {
      requestStats.clientError++;
      log.warn(`${method} ${safeUrl} → ${status} (${duration}ms)`);
    } else {
      requestStats.success++;
      if (duration >= SLOW_THRESHOLD) {
        requestStats.slowRequests++;
        log.warn(`${method} ${safeUrl} → ${status} (${duration}ms) ⚠ 慢请求`);
      } else {
        log.info(`${method} ${safeUrl} → ${status} (${duration}ms)`);
      }
    }

    requestStats.totalDuration += duration;
    if (duration > requestStats.maxDuration) requestStats.maxDuration = duration;

    // 按路径分组统计（取 pathname，不含 query）
    const pathname = safeUrl.split('?')[0];
    let entry = requestStats.byPath.get(pathname);
    if (!entry) {
      if (requestStats.byPath.size >= MAX_PATH_ENTRIES) {
        // 满了删第一个
        const firstKey = requestStats.byPath.keys().next().value;
        requestStats.byPath.delete(firstKey);
      }
      entry = { count: 0, totalDuration: 0, errors: 0 };
      requestStats.byPath.set(pathname, entry);
    }
    entry.count++;
    entry.totalDuration += duration;
    if (status >= 400) entry.errors++;
  });

  next();
}

// 获取请求统计
export function getRequestStats() {
  const avg = requestStats.total > 0 ? Math.round(requestStats.totalDuration / requestStats.total) : 0;
  const topPaths = Array.from(requestStats.byPath.entries())
    .map(([path, e]) => ({
      path,
      count: e.count,
      avgDuration: Math.round(e.totalDuration / e.count),
      errors: e.errors,
    }))
    .sort((a, b) => b.count - a.count)
    .slice(0, 15);

  return {
    total: requestStats.total,
    success: requestStats.success,
    clientError: requestStats.clientError,
    serverError: requestStats.serverError,
    errorRate: requestStats.total > 0
      ? ((requestStats.clientError + requestStats.serverError) / requestStats.total * 100).toFixed(2) + '%'
      : '0%',
    avgDuration: avg,
    maxDuration: requestStats.maxDuration,
    slowRequests: requestStats.slowRequests,
    topPaths,
  };
}

export function resetRequestStats() {
  requestStats.total = 0;
  requestStats.success = 0;
  requestStats.clientError = 0;
  requestStats.serverError = 0;
  requestStats.totalDuration = 0;
  requestStats.maxDuration = 0;
  requestStats.slowRequests = 0;
  requestStats.byPath.clear();
}
