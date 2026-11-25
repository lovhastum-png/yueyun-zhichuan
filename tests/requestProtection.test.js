import { jest } from '@jest/globals';
import { EventEmitter } from 'node:events';
import { rateLimit } from '../server/middleware/rateLimit.js';
import { idempotent } from '../server/middleware/idempotency.js';
import { createKeyedLock } from '../server/utils/keyedLock.js';

function response() {
  const res = new EventEmitter();
  res.statusCode = 200;
  res.setHeader = jest.fn();
  res.status = function (code) { this.statusCode = code; return this; };
  res.json = jest.fn(function (body) { this.body = body; this.emit('finish'); return this; });
  return res;
}
const req = (id) => ({ method: 'POST', user: { id }, originalUrl: '/test', body: { answer: 1 } });

test('使用问答不消耗音频接口限额；各自的限流仍然有效', () => {
  const chat = rateLimit({ max: 1 });
  const audio = rateLimit({ max: 1 });
  const next = jest.fn();
  chat(req(801), response(), next);
  audio(req(801), response(), next);
  expect(next).toHaveBeenCalledTimes(2);
  const denied = response();
  chat(req(801), denied, next);
  expect(denied.statusCode).toBe(429);
});

test('处理中超过 TTL 也不会被重复执行', async () => {
  const guard = idempotent({ ttl: 1 });
  const next = jest.fn();
  const first = response();
  guard(req(802), first, next);
  await new Promise(resolve => setTimeout(resolve, 5));
  const second = response();
  guard(req(802), second, next);
  expect(next).toHaveBeenCalledTimes(1);
  expect(second.statusCode).toBe(409);
  first.json({ code: 0, data: true });
});

test('业务失败不缓存，允许修改条件后立即重试', () => {
  const guard = idempotent();
  const next = jest.fn();
  const first = response();
  guard(req(803), first, next);
  first.json({ code: 400, message: '未开放' });
  guard(req(803), response(), next);
  expect(next).toHaveBeenCalledTimes(2);
});

test('成功结果复用，不重复写入', () => {
  const guard = idempotent();
  const next = jest.fn();
  const first = response();
  guard(req(804), first, next);
  first.json({ code: 0, data: { id: 1 } });
  const second = response();
  guard(req(804), second, next);
  expect(next).toHaveBeenCalledTimes(1);
  expect(second.body.data.id).toBe(1);
});

test('响应提前关闭后释放请求键', () => {
  const guard = idempotent();
  const next = jest.fn();
  const first = response();
  guard(req(805), first, next);
  first.emit('close');
  guard(req(805), response(), next);
  expect(next).toHaveBeenCalledTimes(2);
});

test('同一上传的并发完成只建一个任务，不同上传互不阻塞', async () => {
  const lock = createKeyedLock();
  let taskId = null, created = 0;
  const finish = () => lock('upload-a', async () => {
    if (taskId) return taskId;
    await new Promise(resolve => setTimeout(resolve, 5));
    taskId = ++created;
    return taskId;
  });
  expect(await Promise.all([finish(), finish(), finish()])).toEqual([1, 1, 1]);
  expect(created).toBe(1);
  await expect(lock('upload-b', () => 'b')).resolves.toBe('b');
});

test('单个分片写入失败不会阻塞重试', async () => {
  const lock = createKeyedLock();
  await expect(lock('upload-c', () => { throw new Error('disk'); })).rejects.toThrow('disk');
  await expect(lock('upload-c', () => 'retry')).resolves.toBe('retry');
});
