import { buildRuleBasedPath } from '../server/services/learningPath.js';

describe('学习路径本地兜底', () => {
  test('应根据成绩、错题和出勤生成量化建议', () => {
    const path = buildRuleBasedPath({
      courses: [{ title: '越剧流派赏析' }],
      assignments: [{ status: 'graded', score: 60, total_score: 100 }],
      exams: [{ status: 'graded', score: 70, total_score: 100 }],
      wrongQuestions: [{ content: '徐派特点' }, { content: '袁派代表作' }],
      attendance: { present: 3, late: 1, absent: 1 },
      activity: { chat_count: 2, draw_count: 0, img_count: 0 },
    });

    expect(path.overall_assessment).toContain('65%');
    expect(path.weaknesses.join(' ')).toContain('2 道');
    expect(path.weaknesses.join(' ')).toContain('2 次');
    expect(path.recommendations.length).toBeGreaterThanOrEqual(2);
  });

  test('缺少成绩时也应返回至少两条可执行建议', () => {
    const path = buildRuleBasedPath({
      courses: [], assignments: [], exams: [], wrongQuestions: [], attendance: {}, activity: {},
    });
    expect(path.overall_assessment).toContain('尚缺少足够');
    expect(path.recommendations.length).toBeGreaterThanOrEqual(2);
  });
});
