import { extractWorkflowContent, formatWorkflowInput } from '../server/services/xingchenWs.js';

describe('星辰 HTTP 工作流协议适配', () => {
  test('应把多轮消息整理为工作流输入', () => {
    const input = formatWorkflowInput([
      { role: 'system', content: '请用中文回答' },
      { role: 'user', content: '越剧发源于哪里？' },
    ]);
    expect(input).toContain('系统要求：请用中文回答');
    expect(input).toContain('用户：越剧发源于哪里？');
  });

  test('应读取官方工作流 choices.delta.content', () => {
    expect(extractWorkflowContent({
      choices: [{ delta: { role: 'assistant', content: '浙江嵊州' } }],
    })).toBe('浙江嵊州');
  });
});
