// ragRetrieval 服务单元测试
// 仅测试纯函数，不测依赖 DB/API 的函数
import { buildRagContext } from '../server/services/ragRetrieval.js';

describe('ragRetrieval · RAG 上下文构造 buildRagContext', () => {
  test('空数组应返回空字符串', () => {
    expect(buildRagContext([])).toBe('');
    expect(buildRagContext(null)).toBe('');
    expect(buildRagContext(undefined)).toBe('');
  });

  test('单条知识应正确拼接', () => {
    const chunks = [
      { title: '越剧起源', content: '越剧起源于浙江嵊州，是中国第二大剧种。' },
    ];
    const result = buildRagContext(chunks);
    expect(result).toContain('越剧起源');
    expect(result).toContain('越剧起源于浙江嵊州');
    expect(result).toContain('[知识1]');
    expect(result).toContain('【出处：越剧起源】');
  });

  test('多条知识应正确编号', () => {
    const chunks = [
      { title: '越剧流派', content: '越剧有袁派、尹派、范派等多个流派。' },
      { title: '越剧行当', content: '越剧行当包括生、旦、净、丑。' },
      { title: '越剧剧目', content: '《红楼梦》《梁祝》是越剧经典剧目。' },
    ];
    const result = buildRagContext(chunks);
    expect(result).toContain('[知识1] 越剧流派');
    expect(result).toContain('[知识2] 越剧行当');
    expect(result).toContain('[知识3] 越剧剧目');
    expect(result).toContain('【出处：越剧流派 / 越剧行当 / 越剧剧目】');
  });

  test('应包含指令文本（让 LLM 引用来源）', () => {
    const result = buildRagContext([{ title: '测试', content: '内容' }]);
    expect(result).toContain('请结合这些资料回答用户问题');
    expect(result).toContain('【出处');
  });

  test('应包含分隔符', () => {
    const result = buildRagContext([
      { title: 'A', content: '内容A' },
      { title: 'B', content: '内容B' },
    ]);
    expect(result).toContain('---');
  });
});

describe('ragRetrieval · 向量序列化逻辑', () => {
  // 间接测试：通过 buildRagContext 不报错验证导入链正常
  test('模块应能正常导入', () => {
    expect(typeof buildRagContext).toBe('function');
  });
});
