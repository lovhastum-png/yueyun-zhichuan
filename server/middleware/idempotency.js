// 幂等性中间件：防止重复提交
// 原理：基于 用户ID + 路由路径 + 请求体哈希 生成幂等键
// 在 TTL 时间窗口内，相同请求只处理一次，后续直接返回首次结果

const TTL_MS = 10000; // 10 秒窗口
const store = new Map(); // 内存存储（单实例足够，多实例需换 Redis）

// 简易字符串哈希（djb2）
function hashStr(str) {
  let h = 5381;
  for (let i = 0; i < str.length; i++) {
    h = ((h << 5) + h) + str.charCodeAt(i);
    h = h & h; // 转 32 位
  }
  return h.toString(36);
}

// 定期清理过期项，避免内存泄漏
setInterval(() => {
  const now = Date.now();
  for (const [key, entry] of store.entries()) {
    if (!entry.processing && now - entry.ts > (entry.ttl || TTL_MS)) store.delete(key);
  }
}, 60000).unref?.();

/**
 * 幂等中间件工厂
 * @param {object} opts { ttl=10000, keyFn }
 */
export function idempotent(opts = {}) {
  const ttl = opts.ttl || TTL_MS;
  const keyFn = opts.keyFn || defaultKeyFn;

  return function (req, res, next) {
    // 仅对写操作生效
    const method = req.method.toUpperCase();
    if (method !== 'POST' && method !== 'PUT' && method !== 'DELETE') return next();

    const key = keyFn(req);
    if (!key) return next();

    const now = Date.now();
    const entry = store.get(key);

    // 命中缓存且未过期
    if (entry && (entry.processing || now - entry.ts < ttl)) {
      // 正在处理中：返回 409 避免重复写入
      if (entry.processing) {
        return res.status(409).json({
          code: 409,
          message: '请求正在处理中，请勿重复提交',
          data: null,
        });
      }
      // 已完成：返回首次结果
      if (entry.result) {
        return res.status(entry.result.status).json(entry.result.body);
      }
    }

    // 标记为处理中
    const current = { ts: now, processing: true, result: null, ttl };
    store.set(key, current);
    // 非 JSON 响应或中断连接不能永久占用“正在处理”的键。
    const cleanup = () => { if (store.get(key) === current) store.delete(key); };
    res.once('finish', cleanup);
    res.once('close', cleanup);

    // 拦截 res.json 记录结果
    const originalJson = res.json.bind(res);
    res.json = function (body) {
      if (res.statusCode < 400 && body?.code === 0) {
        store.set(key, {
          ts: Date.now(),
          ttl,
          processing: false,
          result: { status: res.statusCode, body },
        });
      } else {
        // 服务端错误不缓存，允许重试
        store.delete(key);
      }
      return originalJson(body);
    };

    next();
  };
}

// 默认幂等键生成：userId + method + path + bodyHash
function defaultKeyFn(req) {
  const userId = req.user?.id || 'anonymous';
  const path = req.originalUrl || req.url;
  const bodyStr = req.body ? JSON.stringify(req.body) : '';
  return `${userId}:${req.method}:${path}:${hashStr(bodyStr)}`;
}
