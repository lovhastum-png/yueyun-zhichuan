// multiAgent 服务单元测试
import { parseRouting, parseToolCall, EXPERTS, inferExperts } from '../server/services/multiAgent.js';

describe('multiAgent · 路由解析 parseRouting', () => {
  test('标准 JSON 应正确解析', () => {
    const text = '{"experts":["professor","advisor"],"analysis":"涉及越剧历史和成绩查询"}';
    const result = parseRouting(text);
    expect(result).not.toBeNull();
    expect(result.experts).toEqual(['professor', 'advisor']);
    expect(result.analysis).toContain('越剧');
  });

  test('带 markdown 代码块应解析', () => {
    const text = '```json\n{"experts":["professor"],"analysis":"越剧知识"}\n```';
    const result = parseRouting(text);
    expect(result).not.toBeNull();
    expect(result.experts).toEqual(['professor']);
  });

  test('带前后说明文字应提取 JSON', () => {
    const text = '好的，我来分析：{"experts":["mentor"],"analysis":"签到问题"}以上就是路由';
    const result = parseRouting(text);
    expect(result).not.toBeNull();
    expect(result.experts).toEqual(['mentor']);
  });

  test('空 experts 数组应正常返回', () => {
    const text = '{"experts":[],"analysis":"普通问候，无需专家"}';
    const result = parseRouting(text);
    expect(result).not.toBeNull();
    expect(result.experts).toEqual([]);
  });

  test('空字符串应返回 null', () => {
    expect(parseRouting('')).toBeNull();
    expect(parseRouting(null)).toBeNull();
  });

  test('非 JSON 文本应返回 null', () => {
    expect(parseRouting('这是普通文字没有JSON')).toBeNull();
  });

  test('缺少 experts 字段应返回 null', () => {
    expect(parseRouting('{"analysis":"缺少experts"}')).toBeNull();
  });

  test('experts 不是数组应返回 null', () => {
    expect(parseRouting('{"experts":"professor","analysis":"错误格式"}')).toBeNull();
  });
});

describe('multiAgent · 工具调用解析 parseToolCall', () => {
  test('标准工具调用应正确解析', () => {
    const text = '{"tool_call":{"name":"query_knowledge","args":{"keyword":"越剧流派"}}}';
    const result = parseToolCall(text);
    expect(result).not.toBeNull();
    expect(result.name).toBe('query_knowledge');
    expect(result.args.keyword).toBe('越剧流派');
  });

  test('带 markdown 代码块应解析', () => {
    const text = '```json\n{"tool_call":{"name":"query_courses","args":{}}}\n```';
    const result = parseToolCall(text);
    expect(result).not.toBeNull();
    expect(result.name).toBe('query_courses');
  });

  test('带前后说明文字应提取', () => {
    const text = '我需要查询课程：{"tool_call":{"name":"query_courses","args":{"courseId":1}}} 查询完毕';
    const result = parseToolCall(text);
    expect(result).not.toBeNull();
    expect(result.name).toBe('query_courses');
    expect(result.args.courseId).toBe(1);
  });

  test('空字符串应返回 null', () => {
    expect(parseToolCall('')).toBeNull();
    expect(parseToolCall(null)).toBeNull();
  });

  test('无 tool_call 字段应返回 null', () => {
    expect(parseToolCall('{"name":"query_knowledge"}')).toBeNull();
  });

  test('tool_call 缺少 name 应返回 null', () => {
    expect(parseToolCall('{"tool_call":{"args":{}}}')).toBeNull();
  });

  test('普通回答（非工具调用）应返回 null', () => {
    expect(parseToolCall('越剧起源于浙江嵊州，是中国第二大剧种。')).toBeNull();
  });
});

describe('multiAgent · 专家配置 EXPERTS', () => {
  test('应包含 4 个专家', () => {
    expect(Object.keys(EXPERTS)).toHaveLength(4);
  });

  test('每个专家应有完整字段', () => {
    for (const [key, expert] of Object.entries(EXPERTS)) {
      expect(expert.name).toBeTruthy();
      expect(expert.avatar).toBeTruthy();
      expect(expert.color).toBeTruthy();
      expect(expert.desc).toBeTruthy();
      expect(Array.isArray(expert.tools)).toBe(true);
      expect(expert.tools.length).toBeGreaterThan(0);
    }
  });

  test('professor 应有 query_knowledge 工具', () => {
    expect(EXPERTS.professor.tools).toContain('query_knowledge');
  });

  test('advisor 应有学业相关工具', () => {
    expect(EXPERTS.advisor.tools).toContain('query_courses');
    expect(EXPERTS.advisor.tools).toContain('query_assignments');
    expect(EXPERTS.advisor.tools).toContain('query_exams');
    expect(EXPERTS.advisor.tools).toContain('query_grades');
  });

  test('artist 应有生图工具', () => {
    expect(EXPERTS.artist.tools).toContain('generate_image');
  });

  test('mentor 应有出勤工具', () => {
    expect(EXPERTS.mentor.tools).toContain('query_attendance');
  });

  test('专家颜色应正确分类', () => {
    expect(EXPERTS.professor.color).toBe('cinnabar');
    expect(EXPERTS.advisor.color).toBe('cyan');
    expect(EXPERTS.artist.color).toBe('ochre');
    expect(EXPERTS.mentor.color).toBe('ink');
  });
});

describe('multiAgent · 本地路由兜底', () => {
  test('复合问题应同时分配学业顾问和越剧教授', () => {
    expect(inferExperts('我的成绩怎么样，徐派唱腔还需要加强什么？')).toEqual(
      expect.arrayContaining(['advisor', 'professor'])
    );
  });

  test('生图问题应分配艺术指导', () => {
    expect(inferExperts('帮我画一张工笔花旦图')).toContain('artist');
  });

  test('问候不应误派专家', () => {
    expect(inferExperts('你好')).toEqual([]);
  });
});
