// aiGrade 服务单元测试
import { cosineSimilarity, parseJsonLoose } from '../server/services/aiGrade.js';

describe('aiGrade · 余弦相似度 cosineSimilarity', () => {
  test('完全相同的向量应返回 1', () => {
    const v = [1, 2, 3, 4];
    expect(cosineSimilarity(v, v)).toBeCloseTo(1, 5);
  });

  test('正交向量应返回 0', () => {
    const a = [1, 0];
    const b = [0, 1];
    expect(cosineSimilarity(a, b)).toBeCloseTo(0, 5);
  });

  test('方向相反应返回 -1', () => {
    const a = [1, 2, 3];
    const b = [-1, -2, -3];
    expect(cosineSimilarity(a, b)).toBeCloseTo(-1, 5);
  });

  test('相似向量应返回 0~1 之间', () => {
    const a = [1, 2, 3];
    const b = [1.1, 2.1, 2.9];
    const sim = cosineSimilarity(a, b);
    expect(sim).toBeGreaterThan(0.99);
    expect(sim).toBeLessThan(1);
  });

  test('长度不一致应返回 0', () => {
    expect(cosineSimilarity([1, 2], [1, 2, 3])).toBe(0);
  });

  test('空向量应返回 0', () => {
    expect(cosineSimilarity([], [])).toBe(0);
    expect(cosineSimilarity(null, [1])).toBe(0);
  });

  test('零向量应返回 0（避免 NaN）', () => {
    expect(cosineSimilarity([0, 0, 0], [1, 2, 3])).toBe(0);
  });
});

describe('aiGrade · 宽松 JSON 解析 parseJsonLoose', () => {
  test('标准 JSON 应正常解析', () => {
    const result = parseJsonLoose('{"name":"越剧","score":0.85}');
    expect(result).toEqual({ name: '越剧', score: 0.85 });
  });

  test('带 markdown 代码块应解析', () => {
    const result = parseJsonLoose('```json\n{"key":"value"}\n```');
    expect(result).toEqual({ key: 'value' });
  });

  test('带前后多余文本应提取 JSON', () => {
    const result = parseJsonLoose('好的，这是结果：{"score":90}\n以上是评分');
    expect(result).toEqual({ score: 90 });
  });

  test('被截断的 JSON 应尝试闭合', () => {
    // 模拟 max_tokens 截断场景
    const truncated = '{"feedback":"越剧起源于浙江嵊州","score":85,"items":["流派","行当"';
    const result = parseJsonLoose(truncated);
    expect(result).not.toBeNull();
    expect(result.feedback).toBe('越剧起源于浙江嵊州');
    expect(result.score).toBe(85);
  });

  test('空字符串应返回 null', () => {
    expect(parseJsonLoose('')).toBeNull();
    expect(parseJsonLoose(null)).toBeNull();
    expect(parseJsonLoose(undefined)).toBeNull();
  });

  test('无 JSON 内容应返回 null', () => {
    expect(parseJsonLoose('这是一段普通文字，没有JSON')).toBeNull();
  });

  test('字符串内的 { 不应误判为对象边界', () => {
    const result = parseJsonLoose('{"text":"包含{特殊}字符"}');
    expect(result).toEqual({ text: '包含{特殊}字符' });
  });
});
