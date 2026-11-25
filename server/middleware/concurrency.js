// 并发闸门中间件：限制同时进入重任务链路的请求数，超出的按有界队列排队，队列满返回 503。
// 只管理 HTTP 请求名额；客户端断开后，下游已开始的计算任务仍需自行取消。
// 挂载位置须在最前面，即放在 multer 解析上传之前。

function respondBusy(res) {
  return res.status(503).json({
    code: 503,
    message: '当前使用人数较多，请稍后重试',
    data: null,
  });
}

export function limitConcurrency({ max = 2, queueLimit = 8, name = 'heavy' } = {}) {
  if (!Number.isSafeInteger(max) || max < 1) {
    throw new RangeError('max 必须为正整数');
  }
  if (!Number.isSafeInteger(queueLimit) || queueLimit < 0) {
    throw new RangeError('queueLimit 必须为非负整数');
  }
  let active = 0;
  const waiting = [];
  const isClosed = (req, res) => req.aborted || res.writableEnded || res.destroyed;

  const run = (req, res, next) => {
    let released = false;
    const release = () => {
      if (released) return;
      released = true;
      res.removeListener('finish', release);
      res.removeListener('close', release);
      active -= 1;
      pump();
    };
    // finish：正常响应完；close：客户端中途断开（也要释放名额，否则名额会被永久占死）
    res.on('finish', release);
    res.on('close', release);
    next();
  };

  const pump = () => {
    while (active < max && waiting.length) {
      const job = waiting.shift();
      job.detach();
      if (isClosed(job.req, job.res)) continue;
      active += 1;
      run(job.req, job.res, job.next);
    }
  };

  const gate = (req, res, next) => {
    if (isClosed(req, res)) return undefined;
    if (active < max) {
      active += 1;
      return run(req, res, next);
    }
    if (waiting.length >= queueLimit) {
      return respondBusy(res);
    }
    // 等待时断连立即移出队列，避免关闭的页面占用排队容量。
    const cancel = () => {
      const index = waiting.indexOf(job);
      if (index !== -1) waiting.splice(index, 1);
      job.detach();
    };
    const job = {
      req, res, next,
      detach() {
        req.removeListener?.('aborted', cancel);
        res.removeListener('close', cancel);
        res.removeListener('finish', cancel);
      },
    };
    waiting.push(job);
    req.once?.('aborted', cancel);
    res.once('close', cancel);
    res.once('finish', cancel);
    return undefined;
  };

  // 便于运维观察当前占用情况
  gate.stats = () => ({ name, active, waiting: waiting.length, max });
  return gate;
}

// 全局限额总览（供 /api/system/status 之类的诊断接口使用）
const registry = new Set();

export function getConcurrencyStats() {
  return [...registry].map((gate) => gate.stats());
}

export function createGate(options) {
  const gate = limitConcurrency(options);
  registry.add(gate);
  return gate;
}
