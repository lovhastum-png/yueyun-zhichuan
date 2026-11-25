// 简易限流中间件：按用户/IP 限制请求频率
// 用于保护 AI 接口等高价资源被滥用

const buckets = new Map();
let limiterSequence = 0;

// 定期清理过期桶
setInterval(() => {
  const now = Date.now();
  for (const [key, bucket] of buckets.entries()) {
    if (now - bucket.resetAt > 60000) buckets.delete(key);
  }
}, 120000).unref?.();

/**
 * 限流中间件工厂
 * @param {object} opts { windowMs=60000, max=20, keyFn, message }
 */
export function rateLimit(opts = {}) {
  const namespace = ++limiterSequence;
  const windowMs = opts.windowMs || 60000;
  const max = opts.max || 20;
  const keyFn = opts.keyFn || defaultKeyFn;
  const message = opts.message || '请求过于频繁，请稍后再试';

  return function (req, res, next) {
    const key = `${namespace}:${keyFn(req)}`;
    const now = Date.now();

    let bucket = buckets.get(key);
    if (!bucket || now > bucket.resetAt) {
      bucket = { count: 0, resetAt: now + windowMs };
      buckets.set(key, bucket);
    }

    bucket.count++;

    // 设置标准限流响应头
    res.setHeader('X-RateLimit-Limit', max);
    res.setHeader('X-RateLimit-Remaining', Math.max(0, max - bucket.count));
    res.setHeader('X-RateLimit-Reset', Math.floor(bucket.resetAt / 1000));

    if (bucket.count > max) {
      const retryAfter = Math.ceil((bucket.resetAt - now) / 1000);
      res.setHeader('Retry-After', retryAfter);
      return res.status(429).json({
        code: 429,
        message: `${message}（${retryAfter}秒后重试）`,
        data: null,
      });
    }

    next();
  };
}

function defaultKeyFn(req) {
  return req.user?.id ? `u:${req.user.id}` : `ip:${req.ip}`;
}
