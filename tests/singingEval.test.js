import { jest } from '@jest/globals';
import express from 'express';

jest.unstable_mockModule('../server/middleware/auth.js', () => ({
  authRequired: (req, res, next) => { req.user = { id: 1 }; next(); },
}));
jest.unstable_mockModule('../server/services/singingEval/aiFeedback.js', () => ({
  assessSingingAccuracy: jest.fn(),
}));
jest.unstable_mockModule('../server/utils/logger.js', () => ({
  default: { module: () => ({ info: jest.fn(), warn: jest.fn() }) },
}));

const { default: router } = await import('../server/routes/singingEval.js');
const { assessSingingAccuracy } = await import('../server/services/singingEval/aiFeedback.js');
const nativeFetch = global.fetch;
let server;
let base;
let analyzeFetch;

beforeAll(async () => {
  const app = express();
  app.use(express.json());
  app.use(router);
  server = await new Promise(resolve => {
    const listener = app.listen(0, '127.0.0.1', () => resolve(listener));
  });
  base = `http://127.0.0.1:${server.address().port}`;
});
beforeEach(() => {
  analyzeFetch = jest.fn();
  global.fetch = analyzeFetch;
});
afterEach(() => { global.fetch = nativeFetch; });
afterAll(async () => {
  server.closeAllConnections();
  await new Promise(resolve => server.close(resolve));
});

async function json(path, body) {
  const response = await nativeFetch(base + path, body === undefined ? {} : {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
  });
  return response.json();
}

async function uploadTask() {
  const wav = Buffer.alloc(44);
  wav.write('RIFF');
  wav.write('WAVE', 8);
  const init = await json('/chunk/init', { studentSize: wav.length, refSize: wav.length });
  expect(init.code).toBe(0);
  const id = init.data.taskId;
  for (const target of ['student', 'ref']) {
    const body = new FormData();
    body.append('chunk', new Blob([wav]), 'audio.bin');
    body.append('target', target);
    body.append('index', '0');
    const response = await nativeFetch(`${base}/chunk/${id}`, { method: 'POST', body });
    expect((await response.json()).code).toBe(0);
  }
  return id;
}

async function terminal(id) {
  for (let i = 0; i < 100; i++) {
    const result = await json(`/task/${id}`);
    if (result.code !== 0 || result.data.total_score !== undefined) return result;
    await new Promise(resolve => setTimeout(resolve, 10));
  }
  throw new Error('Task did not complete');
}

test('重复提交不会重复计算；公网丢失响应后可重新获取报告', async () => {
  let finish;
  analyzeFetch.mockImplementation(() => new Promise(resolve => { finish = resolve; }));
  const id = await uploadTask();
  const submitted = await Promise.all([
    json(`/chunk/${id}/complete`, {}), json(`/chunk/${id}/complete`, {}),
  ]);
  expect(submitted.every(r => r.code === 0)).toBe(true);
  for (let i = 0; i < 100 && !finish; i++) await new Promise(resolve => setTimeout(resolve, 10));
  expect(analyzeFetch).toHaveBeenCalledTimes(1);
  expect((await json(`/task/${id}`)).data.status).toBe('running');
  const report = { total_score: 88, pitch_score: 90 };
  finish(new Response(JSON.stringify(report)));
  expect((await terminal(id)).data).toEqual(report);
  const retry = await nativeFetch(`${base}/task/${id}`);
  expect(retry.headers.get('cache-control')).toBe('no-store');
  expect((await retry.json()).data).toEqual(report);
  await json(`/chunk/${id}/complete`, {});
  expect(analyzeFetch).toHaveBeenCalledTimes(1);
});

test('计算失败成为可重复读取的错误，不会永久停在分析中', async () => {
  analyzeFetch.mockRejectedValue(new DOMException('Timed out', 'AbortError'));
  const id = await uploadTask();
  await json(`/chunk/${id}/complete`, {});
  const result = await terminal(id);
  expect(result.code).not.toBe(0);
  expect(result.message).toContain('计算超时');
  expect(await json(`/task/${id}`)).toEqual(result);
});

// ---------- 报告流转（三个下游都必须给出可用产出，不能只回「已预留」）----------
const SAMPLE_REPORT = {
  total_score: 82,
  pitch_score: 85,
  rhythm_score: 78,
  problem_segments: [
    { dim: 'pitch', start_time: 1.2, end_time: 1.8, problem_desc: '该片段较范本偏高约 40 音分' },
    { dim: 'rhythm', start_time: 3.0, end_time: 3.6, problem_desc: '该片段演唱进度较范本滞后约 0.3 秒（拖板）' },
  ],
  stats: { median_abs_dev_cents: 22, within_50_cents_ratio: 0.82, tempo_ratio: 1.05 },
  meta: { ref_duration: 30, stu_duration: 31.5 },
  suggestion: '建议放慢速度逐句模唱。',
};

test('多智能体：返回可注入的专家上下文而非空回执', async () => {
  const res = await json('/export/multi-agent', { report: SAMPLE_REPORT });
  expect(res.code).toBe(0);
  expect(res.data.status).toBe('ok');
  expect(res.data.context).toContain('演唱测评报告');
  expect(res.data.context).toContain('总参考分：82');
  expect(res.data.context).toContain('偏高约 40 音分');
  expect(res.data.suggestion).toBeTruthy();
});

test('AI 批改：下游成功时返回分数与评语', async () => {
  assessSingingAccuracy.mockResolvedValue({
    ai_score: 90,
    summary: '演唱整体稳健，板眼偶有抢拍。',
    strengths: ['音准稳定'],
    issues: ['个别乐句拖板'],
    suggestions: ['用节拍器分段练习'],
  });
  const res = await json('/export/ai-grading', { report: SAMPLE_REPORT });
  expect(res.code).toBe(0);
  expect(res.data.status).toBe('ok');
  expect(res.data.grade.score).toBe(90);
  expect(res.data.grade.maxScore).toBe(100);
  expect(res.data.grade.feedback).toContain('板眼');
  expect(res.data.grade.weaknesses).toContain('个别乐句拖板');
  expect(res.data.grade.suggestions).toContain('用节拍器分段练习');
});

test('AI 批改：下游不可用时降级为算法侧结论，不伪装成功也不报错', async () => {
  assessSingingAccuracy.mockRejectedValue(new Error('星辰服务超时'));
  const res = await json('/export/ai-grading', { report: SAMPLE_REPORT });
  expect(res.code).toBe(0);
  expect(res.data.status).toBe('degraded');
  expect(res.data.grade.score).toBe(82);          // 回退到算法总分
  expect(res.data.grade.feedback).toContain('暂不可用');
  expect(res.data.grade.weaknesses.length).toBeGreaterThan(0); // 仍带上算法发现的问题
});

test('学习通：未配置开放接口时生成可下载作业包', async () => {
  const res = await json('/export/learning-platform', { report: SAMPLE_REPORT, homeworkId: 'HW-9' });
  expect(res.code).toBe(0);
  expect(res.data.status).toBe('package');
  expect(res.data.package.totalScore).toBeUndefined();   // 字段名为 camelCase
  expect(res.data.package.score).toBe(82);
  expect(res.data.package.homeworkId).toBe('HW-9');
  expect(res.data.package.segments.length).toBe(2);
  expect(res.data.packageName).toMatch(/\.json$/);
});

test('报告流转：未知目标与缺报告都返回 400', async () => {
  expect((await json('/export/nope', { report: SAMPLE_REPORT })).code).toBe(400);
  expect((await json('/export/ai-grading', {})).code).toBe(400);
});

test('多智能体：字段别名也能生成可读摘要，不出现 undefined', async () => {
  // 下游/人工构造的报告可能用 start/end/issue/detail 等别名
  const alias = {
    total_score: 76,
    problem_segments: [{ start: 2.5, end: 3.1, issue: '板眼抢拍', detail: '较范本提前约 0.2 秒' }],
  };
  const res = await json('/export/multi-agent', { report: alias });
  expect(res.code).toBe(0);
  expect(res.data.context).toContain('总参考分：76');
  expect(res.data.context).toContain('2.5-3.1秒');
  // dim 缺失时归一化为中性标签「偏差」（无法从句意推断音准/板眼），
  // 关键是描述文本要取到，且整体不出现 undefined
  expect(res.data.context).toContain('较范本提前约 0.2 秒');
  expect(res.data.context).not.toContain('undefined');
});

test('多智能体：完全畸形片段也不能崩，退化为占位文案', async () => {
  const broken = { total_score: 70, problem_segments: [{}, null, { start_time: 1 }] };
  const res = await json('/export/multi-agent', { report: broken });
  expect(res.code).toBe(0);
  expect(res.data.context).not.toContain('undefined');
  expect(res.data.context).toContain('未描述');
});

test('学习通：推送失败时仍产出可下载作业包，不留下死路', async () => {
  const savedApi = process.env.LEARNING_PLATFORM_API;
  const savedKey = process.env.LEARNING_PLATFORM_KEY;
  process.env.LEARNING_PLATFORM_API = 'http://127.0.0.1:1';
  process.env.LEARNING_PLATFORM_KEY = 'fake-key';
  try {
    // mock fetch 抛错模拟下游不可达
    analyzeFetch.mockRejectedValue(new Error('connect ECONNREFUSED'));
    const res = await json('/export/learning-platform', { report: SAMPLE_REPORT });
    expect(res.code).toBe(0);
    expect(res.data.status).toBe('degraded');
    expect(res.data.retryable).toBe(true);
    expect(res.data.package).toBeTruthy();
    expect(res.data.package.score).toBe(82);
    expect(res.data.package.segments.length).toBe(2);
    expect(res.data.packageName).toMatch(/\.json$/);
  } finally {
    if (savedApi === undefined) delete process.env.LEARNING_PLATFORM_API;
    else process.env.LEARNING_PLATFORM_API = savedApi;
    if (savedKey === undefined) delete process.env.LEARNING_PLATFORM_KEY;
    else process.env.LEARNING_PLATFORM_KEY = savedKey;
  }
});

test('报告流转与测评使用各自独立的限流桶', async () => {
  // 测评限流很紧（6 次/分，因为要跑 DTW）。若流转共用同一个桶，
  // 用户点几个按钮就会把测评配额吃掉、或反过来被测评请求挤掉。
  // 注意：流转桶上限 12/分，本文件前面已消耗若干次，这里只再补 2 次，
  // 保证既不触发流转桶上限，又能验证测评桶未被抽干。
  const codes = [];
  for (let i = 0; i < 2; i++) {
    codes.push((await json('/export/multi-agent', { report: SAMPLE_REPORT })).code);
  }
  expect(codes.every((c) => c === 0)).toBe(true);
  // 此时测评桶应仍是满的（未被流转消耗）：随后的测评类请求不应返回 429
  const init = await json('/chunk/init', { studentSize: 44, refSize: 44 });
  expect(init.code).toBe(0);
});
