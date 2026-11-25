// 临时探针：端到端验证讯飞生图（应报 11201 待开通）与妙笔润色（应走讯飞星火成功）。
import config from '../server/config.js';
import { generateImage } from '../server/services/xunfeiImage.js';
import { enhanceImagePrompt } from '../server/services/promptEnhancer.js';

console.log('=== 生图（讯飞图片生成 tti）===');
try {
  await generateImage({
    prompt: '黛玉葬花', style: 'ink', role: 'huadan', school: 'auto', costume: 'shuixiu',
    play: 'hongloumeng', scene: 'garden', composition: 'full', aspectRatio: 'square', seed: 12345,
  });
  console.log('生图成功');
} catch (e) {
  console.log('生图 -> status:', e.status || '(无)', '|', e.message);
}

console.log('\n=== 妙笔润色（讯飞星火 enhanceImagePrompt）===');
const r = await enhanceImagePrompt({ prompt: '黛玉葬花', current: {} });
console.log('fallback =', r.fallback, '| reason =', r.reason || '(无)');
console.log('enhanced =', (r.enhanced || '').slice(0, 120));
console.log('suggestions =', JSON.stringify(r.suggestions));
console.log('knowledgeSources =', JSON.stringify(r.knowledgeSources));
