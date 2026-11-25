import {
  buildYuejuImagePrompt,
  normalizeYuejuImageOptions,
} from '../server/services/yuejuImagePrompt.js';

describe('越剧生图提示词编排', () => {
  test('范派小生应保留女扮男装、流派和褶子特征', () => {
    const result = buildYuejuImagePrompt({
      prompt: '梁山伯在书院执扇远望',
      role: 'xiaosheng',
      school: 'fan',
      costume: 'zhezi',
      play: 'liangzhu',
    });

    expect(result.finalPrompt).toContain('traditionally portrayed by a female performer');
    expect(result.finalPrompt).toContain('Fan school xiaosheng');
    expect(result.finalPrompt).toContain('moon-white Yueju scholar zhezi robe');
    expect(result.finalPrompt).toContain('The Butterfly Lovers');
    expect(result.finalPrompt).not.toContain('long soft water sleeves');
  });

  test('傅派花旦水袖衣只在明确选择后加入', () => {
    const result = buildYuejuImagePrompt({ role: 'huadan', school: 'fu', costume: 'shuixiu' });
    expect(result.finalPrompt).toContain('Fu school huadan');
    expect(result.finalPrompt).toContain('long soft water sleeves');
  });

  test('自动排除京剧、昆曲与常见肢体错误', () => {
    const result = buildYuejuImagePrompt({ role: 'chou', costume: 'duanda' });
    expect(result.negativePrompt).toContain('Peking Opera');
    expect(result.negativePrompt).toContain('Kunqu headdress');
    expect(result.negativePrompt).toContain('extra hands');
    expect(result.negativePrompt).toContain('incomplete lower body');
  });

  test('不兼容的流派和服装应回退为行当自动配置', () => {
    const result = normalizeYuejuImageOptions({
      role: 'huadan',
      school: 'xu',
      costume: 'mangpao',
    });
    expect(result.school).toBe('auto');
    expect(result.costume).toBe('auto');
  });

  test('兼容旧版生旦参数并支持锁定构图编号', () => {
    const sheng = normalizeYuejuImageOptions({ role: 'sheng', seed: 12345, aspectRatio: 'portrait' });
    const dan = normalizeYuejuImageOptions({ role: 'dan' });
    expect(sheng.role).toBe('xiaosheng');
    expect(sheng.seed).toBe(12345);
    expect(sheng.width).toBe(768);
    expect(sheng.height).toBe(1024);
    expect(dan.role).toBe('huadan');
  });

  test('用户描述应清理控制字符并限制长度', () => {
    const result = normalizeYuejuImageOptions({ prompt: `越剧\u0000  场景 ${'花'.repeat(600)}` });
    expect(result.prompt).not.toContain('\u0000');
    expect(result.prompt.length).toBeLessThanOrEqual(500);
  });
});
