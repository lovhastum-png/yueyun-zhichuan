import { buildKnowledgeFallback } from '../server/services/xingchenAgent.js';
import { inferDirectTool } from '../server/services/agentOrchestrator.js';

describe('问答服务离线兜底', () => {
  test('应从高置信度知识片段生成带出处的回答', () => {
    const answer = buildKnowledgeFallback('越剧发源于哪里？', [
      {
        title: '越剧起源',
        content: '越剧发源于浙江嵊州，前身是民间落地唱书。',
        score: 0.92,
        sourceName: '嵊州市人民政府',
      },
      {
        title: '其他资料',
        content: '这条低相关内容不应进入回答。',
        score: 0.35,
        sourceName: '校本语料',
      },
    ]);

    expect(answer).toContain('浙江嵊州');
    expect(answer).toContain('【出处：嵊州市人民政府】');
    expect(answer).not.toContain('低相关内容');
  });

  test('没有可靠片段时不应编造答案', () => {
    expect(buildKnowledgeFallback('未知问题', [])).toBe('');
  });

  test('长检索资料应压缩，避免撑坏问答页面', () => {
    const answer = buildKnowledgeFallback('徐派有什么特点？', [
      { title: '徐派', content: '徐派唱腔高亢明亮。'.repeat(120), score: 0.9, sourceName: '校本资料' },
    ]);
    expect(answer.length).toBeLessThan(700);
    expect(answer).toContain('…');
  });

  test.each([
    ['我有哪些课程？', 'query_courses'],
    ['还有哪些作业没交？', 'query_assignments'],
    ['我的平均分是多少？', 'query_grades'],
    ['最近有考试吗？', 'query_exams'],
    ['我的出勤情况怎么样？', 'query_attendance'],
    ['帮我画一张水墨花旦图', 'generate_image'],
  ])('应把“%s”直接路由到 %s', (question, toolName) => {
    expect(inferDirectTool(question)?.name).toBe(toolName);
  });
});
