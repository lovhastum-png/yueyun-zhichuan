// 同一资源串行，不同资源并行；失败后释放锁，不阻塞后续重试。
export function createKeyedLock() {
  const pending = new Map();
  return async function withLock(key, work) {
    const previous = pending.get(key) || Promise.resolve();
    let release;
    const current = new Promise((resolve) => { release = resolve; });
    pending.set(key, current);
    await previous;
    try {
      return await work();
    } finally {
      release();
      if (pending.get(key) === current) pending.delete(key);
    }
  };
}
