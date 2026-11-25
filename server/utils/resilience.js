// 弹性工具：超时、重试、熔断、安全调用
// 用于增强第三方 AI 服务和内部关键路径的容错能力

/**
 * 包装 Promise，超时后自动 reject
 * @param {Promise} promise
 * @param {number} ms 超时毫秒
 * @param {string} label 错误标签
 */
export function withTimeout(promise, ms, label = '操作') {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(Object.assign(new Error(`${label} 超时（${ms}ms）`), { status: 504, expose: true }));
    }, ms);
    promise.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (err) => {
        clearTimeout(timer);
        reject(err);
      }
    );
  });
}

/**
 * 失败重试
 * @param {Function} fn 返回 Promise 的函数
 * @param {object} opts { retries=2, delay=500, label='操作', onRetry }
 */
export async function withRetry(fn, opts = {}) {
  const { retries = 2, delay = 500, label = '操作', onRetry } = opts;
  let lastErr;
  for (let i = 0; i <= retries; i++) {
    try {
      return await fn();
    } catch (err) {
      lastErr = err;
      if (i < retries) {
        const wait = delay * (i + 1);
        console.warn(`[resilience] ${label} 第 ${i + 1} 次失败，${wait}ms 后重试:`, err.message);
        if (onRetry) onRetry(err, i + 1);
        await sleep(wait);
      }
    }
  }
  throw lastErr;
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * 安全调用：失败时返回 fallback 而不是抛错
 * @param {Function} fn
 * @param {*} fallback
 * @param {string} label
 */
export async function safeCall(fn, fallback, label = '操作') {
  try {
    return await fn();
  } catch (err) {
    console.warn(`[resilience] ${label} 失败，使用兜底结果:`, err.message);
    return fallback;
  }
}

/**
 * 简易熔断器
 * 当连续失败次数超过阈值后，一段时间内直接返回 fallback
 */
export function createCircuitBreaker(opts = {}) {
  const { failureThreshold = 5, resetTimeoutMs = 30000, label = '服务' } = opts;
  let failures = 0;
  let lastFailureTime = null;
  let state = 'CLOSED'; // CLOSED / OPEN

  return async function call(fn, fallback) {
    if (state === 'OPEN') {
      if (Date.now() - lastFailureTime > resetTimeoutMs) {
        state = 'HALF_OPEN';
        console.log(`[resilience] ${label} 熔断器进入半开状态，尝试恢复`);
      } else {
        console.warn(`[resilience] ${label} 熔断器开启，直接返回兜底结果`);
        return fallback;
      }
    }

    try {
      const result = await fn();
      if (state === 'HALF_OPEN') {
        state = 'CLOSED';
        failures = 0;
        console.log(`[resilience] ${label} 熔断器关闭，服务恢复`);
      }
      return result;
    } catch (err) {
      failures++;
      lastFailureTime = Date.now();
      if (failures >= failureThreshold) {
        state = 'OPEN';
        console.error(`[resilience] ${label} 连续失败 ${failures} 次，熔断器开启`);
      }
      return fallback;
    }
  };
}

/**
 * 异步函数包装器：捕获异常并返回 {ok, data, error}
 */
export async function resultify(fn) {
  try {
    const data = await fn();
    return { ok: true, data, error: null };
  } catch (err) {
    return { ok: false, data: null, error: err };
  }
}
