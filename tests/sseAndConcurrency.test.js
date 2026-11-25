// SSE 工具与并发闸门的回归测试
//
// 背景（真实故障）：
//  1. 流式问答接口先写 SSE 响应头再查数据库/调模型，一旦抛错，全局 errorHandler
//     因 headersSent 只能 next(err) → socket 被销毁，前端读到的是「连接中断」，
//     用户侧表现为「点发送后一直没反应」。
//  2. 4 核 4GB 单机下 Node 堆被限制在 512MB，音频/测评这类单请求就要占用
//     20~50MB 堆内存的接口同时来几个就会把进程打爆（OOM Killer 干掉服务）。
import { jest } from '@jest/globals';
import { EventEmitter } from 'node:events';
import { sseHandler, openSse, sseSend, sseFail } from '../server/utils/sse.js';
import { limitConcurrency, createGate } from '../server/middleware/concurrency.js';

function mockRes({ openHeaders = true } = {}) {
  const res = new EventEmitter();
  res.headers = {};
  res.chunks = [];
  res.statusCode = 200;
  res.writableEnded = false;
  res.destroyed = false;
  res.setHeader = (k, v) => { res.headers[k] = v; };
  res.flushHeaders = () => { res.headersSent = openHeaders; };
  res.write = (s) => { res.chunks.push(s); return true; };
  res.end = () => { res.writableEnded = true; res.emit('finish'); };
  res.status = function (code) { this.statusCode = code; return this; };
  res.json = function (body) { this.body = body; this.writableEnded = true; this.emit('finish'); return this; };
  return res;
}

describe('SSE 工具（server/utils/sse.js）', () => {
  test('正常流程：写响应头 → 逐条事件 → 收尾', async () => {
    const res = mockRes();
    const handler = sseHandler(async (req, r) => {
      openSse(r);
      sseSend(r, { type: 'token', content: '越' });
      sseSend(r, { type: 'done' });
      r.end();
    });
    await handler({}, res);

    expect(String(res.headers['Content-Type'])).toContain('text/event-stream');
    expect(res.headers['X-Accel-Buffering']).toBe('no');
    expect(res.chunks).toHaveLength(2);
    expect(res.writableEnded).toBe(true);
  });

  test('已发头之后抛错：补发 error 事件并正常关闭，而不是断连', async () => {
    const res = mockRes();
    const handler = sseHandler(async (req, r) => {
      openSse(r);
      sseSend(r, { type: 'token', content: '半句' });
      throw new Error('downstream 500');
    });
    await handler({}, res);

    const last = res.chunks[res.chunks.length - 1] || '';
    expect(last).toContain('"type":"error"');
    expect(res.writableEnded).toBe(true);
    // 不把原始英文错误暴露给用户
    expect(last).not.toContain('downstream 500');
  });

  test('尚未发头就抛错：退回 JSON 错误与对应状态码', async () => {
    const res = mockRes();
    const handler = sseHandler(async () => {
      const err = new Error('db down');
      err.status = 503;
      throw err;
    });
    await handler({}, res);

    expect(res.statusCode).toBe(503);
    expect(res.body).toMatchObject({ code: 503 });
    expect(res.chunks).toHaveLength(0);
  });

  test('连接已结束时 sseSend 返回 false 而不抛错', () => {
    const res = mockRes();
    res.end();
    expect(sseSend(res, { type: 'done' })).toBe(false);
    expect(() => sseFail(res, new Error('x'))).not.toThrow();
  });
});

describe('并发闸门（server/middleware/concurrency.js）', () => {
  function mockReqRes() {
    const res = mockRes();
    res.req = {};
    return res;
  }

  test('并发未超限时全部放行', async () => {
    const gate = limitConcurrency({ max: 2, queueLimit: 2 });
    const next = jest.fn();
    gate({}, mockReqRes(), next);
    gate({}, mockReqRes(), next);
    expect(next).toHaveBeenCalledTimes(2);
    expect(gate.stats().active).toBe(2);
  });

  test('超出并发上限的请求进入队列等待，而不是直接失败', () => {
    const gate = limitConcurrency({ max: 1, queueLimit: 5 });
    const r1 = mockReqRes();
    gate({}, r1, jest.fn());
    const r2 = mockReqRes();
    const next2 = jest.fn();
    gate({}, r2, next2);

    // 第二个请求被排队：还没调用 next、也还没返回错误
    expect(next2).not.toHaveBeenCalled();
    expect(r2.body).toBeUndefined();
    expect(gate.stats()).toMatchObject({ active: 1, waiting: 1 });

    // 第一个请求结束后，排队的请求被放行
    r1.emit('finish');
    expect(next2).toHaveBeenCalledTimes(1);
  });

  test('队列也满时返回 503 与中文提示', () => {
    const gate = limitConcurrency({ max: 1, queueLimit: 1 });
    gate({}, mockReqRes(), jest.fn());
    gate({}, mockReqRes(), jest.fn());
    const overflow = mockReqRes();
    gate({}, overflow, jest.fn());

    expect(overflow.statusCode).toBe(503);
    expect(overflow.body.message).toContain('稍后重试');
  });

  test('客户端中途断开也要释放名额，否则名额会被永久占死', () => {
    const gate = limitConcurrency({ max: 1, queueLimit: 1 });
    const r1 = mockReqRes();
    gate({}, r1, jest.fn());
    expect(gate.stats().active).toBe(1);

    // 客户端断开（未走 finish）
    r1.emit('close');
    expect(gate.stats().active).toBe(0);
  });

  test('createGate 注册后可被全局统计（供 /api/system/status 观测）', () => {
    const gate = createGate({ name: 'unit-test-gate', max: 1, queueLimit: 0 });
    expect(typeof gate.stats).toBe('function');
    expect(gate.stats().name).toBe('unit-test-gate');
  });

  test.each(['close', 'finish', 'aborted'])('排队请求 %s 后腾出队列容量且不再执行', (event) => {
    const gate = limitConcurrency({ max: 1, queueLimit: 1 });
    const running = mockReqRes();
    gate({}, running, jest.fn());
    const req = new EventEmitter();
    const cancelled = mockReqRes();
    const nextCancelled = jest.fn();
    gate(req, cancelled, nextCancelled);
    (event === 'aborted' ? req : cancelled).emit(event);
    expect(gate.stats()).toMatchObject({ active: 1, waiting: 0 });
    expect(req.listenerCount('aborted')).toBe(0);
    expect(cancelled.listenerCount('close')).toBe(0);
    const next = jest.fn();
    gate({}, mockReqRes(), next);
    running.emit('finish');
    expect(nextCancelled).not.toHaveBeenCalled();
    expect(next).toHaveBeenCalledTimes(1);
  });

  test('响应先 finish 后 close 只释放一次，不突破并发上限', () => {
    const gate = limitConcurrency({ max: 1, queueLimit: 2 });
    const running = mockReqRes();
    gate({}, running, jest.fn());
    const next2 = jest.fn();
    const next3 = jest.fn();
    gate({}, mockReqRes(), next2);
    gate({}, mockReqRes(), next3);
    running.emit('finish');
    running.emit('close');
    expect(next2).toHaveBeenCalledTimes(1);
    expect(next3).not.toHaveBeenCalled();
    expect(gate.stats()).toMatchObject({ active: 1, waiting: 1 });
    expect(running.listenerCount('close')).toBe(0);
  });

  test('已关闭的排队响应即使未触发事件也会在出队时跳过', () => {
    const gate = limitConcurrency({ max: 1, queueLimit: 2 });
    const running = mockReqRes();
    gate({}, running, jest.fn());
    const closed = mockReqRes();
    const nextClosed = jest.fn();
    gate({}, closed, nextClosed);
    closed.destroyed = true;
    const next = jest.fn();
    gate({}, mockReqRes(), next);
    running.emit('finish');
    expect(nextClosed).not.toHaveBeenCalled();
    expect(next).toHaveBeenCalledTimes(1);
    expect(gate.stats()).toMatchObject({ active: 1, waiting: 0 });
  });

  test.each([{ max: 0 }, { max: 1.5 }, { max: NaN }, { queueLimit: -1 }, { queueLimit: Infinity }])(
    '拒绝无效配置 %p', (options) => {
      expect(() => limitConcurrency(options)).toThrow(RangeError);
    },
  );
});
