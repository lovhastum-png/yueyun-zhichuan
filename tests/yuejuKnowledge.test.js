import {
  buildKnowledgeContext,
  getKnowledgeBaseStats,
  retrieveYuejuKnowledge,
} from '../server/services/yuejuKnowledge.js';

describe('yuejuKnowledge · 净化语料与来源等级', () => {
  test('应载入净化语料和结构化权威事实', () => {
    const stats = getKnowledgeBaseStats();
    expect(stats.loaded).toBe(true);
    expect(stats.count).toBe(2128);
    expect(stats.authoritativeFacts).toBe(9);
    expect(stats.bySourceLevel['3']).toBeGreaterThan(0);
  });

  test.each([
    '今天天气怎么样？',
    '今天股票行情如何？',
    '帮我写一段 Python 代码',
    '怎么做红烧肉？',
  ])('域外问题不应注入知识：%s', (query) => {
    expect(retrieveYuejuKnowledge(query)).toEqual([]);
  });
});

describe('yuejuKnowledge · 混合召回与权威重排', () => {
  test('发源地问题应优先权威来源且包含核心事实', () => {
    const chunks = retrieveYuejuKnowledge('越剧发源于我国哪个省份、今天的哪个地方？');
    expect(chunks.length).toBeGreaterThan(0);
    expect(chunks[0].sourceLevel).toBe(3);
    expect(chunks[0].reviewStatus).toBe('official_verified');
    expect(chunks[0].content).toContain('浙江');
    expect(chunks[0].content).toMatch(/嵊县|嵊州/);
    expect(chunks.map((chunk) => chunk.title).join(' ')).not.toMatch(/天气|股票/);
  });

  test('形成问题应召回 1906、小歌班和落地唱书', () => {
    const chunks = retrieveYuejuKnowledge('越剧形成于哪一年？落地唱书搬上舞台后最初叫什么？');
    const text = chunks.map((chunk) => `${chunk.title}${chunk.content}`).join('');
    expect(text).toContain('1906');
    expect(text).toContain('落地唱书');
    expect(text).toMatch(/小歌班|的笃班/);
    expect(chunks[0].criticalCoverage).toBeGreaterThanOrEqual(0.8);
  });

  test('非遗精确事实应由官方结构化事实回答', () => {
    const chunks = retrieveYuejuKnowledge('越剧哪一年列入国家级非遗，属于第几批？');
    expect(chunks[0].id).toBe('official-heritage-2006');
    expect(chunks[0].content).toContain('2006');
    expect(chunks[0].content).toContain('第一批');
  });

  test('同义表达仍应通过领域语义召回命中', () => {
    const chunks = retrieveYuejuKnowledge('这个剧种从嵊县发展起来时，最早的舞台形式叫什么？');
    expect(chunks.length).toBeGreaterThan(0);
    expect(chunks[0].content).toMatch(/小歌班|的笃班/);
    expect(chunks[0].semanticScore).toBeGreaterThan(0);
  });

  test('流派问题应优先教师复核的结构化事实', () => {
    const chunks = retrieveYuejuKnowledge('请列举六个主要越剧流派和创始人');
    expect(chunks[0].id).toBe('reviewed-six-schools');
    expect(chunks[0].sourceLevel).toBe(2);
    expect(chunks[0].content).toContain('袁雪芬');
    expect(chunks[0].content).toContain('戚雅仙');
  });
});

describe('yuejuKnowledge · 置信度门控与上下文', () => {
  test('缺少具体意图的宽泛输入不应注入资料', () => {
    expect(retrieveYuejuKnowledge('越剧相关内容')).toEqual([]);
  });

  test('上下文应显示来源且要求避免猜测', () => {
    const chunks = retrieveYuejuKnowledge('越剧是哪一年列入第一批国家级非遗的？');
    const context = buildKnowledgeContext(chunks);
    expect(context).toContain('来源：中国非物质文化遗产网');
    expect(context).toContain('资料未覆盖的精确年份或人物不要猜测');
    expect(context).toContain('2006');
  });
});
