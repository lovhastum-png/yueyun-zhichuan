// 越剧内容审查：越剧专有词库打分，判定某文档是否为越剧内容
// 用于「PDF 导入课程」的入口校验：命中不足则拒绝导入

// 越剧专属关键词（词库，可按需扩充）。分体系便于统计与提示。
const LEXICON = {
  school: ['袁派', '尹派', '徐派', '范派', '傅派', '戚派', '陆派', '张派', '王派', '吕派', '金派', '毕派', '朱派',
    '越剧流派', '绍兴文戏', '女子越剧', '草台班', '小歌班', '四工唱书', '落地唱书', '呤嗄调', '弦下调', '尺调'],
  hangdang: ['小生', '花旦', '老生', '小丑', '老旦', '大面', '越剧行当', '旦角', '生角'],
  play: ['梁山伯与祝英台', '红楼梦', '西厢记', '祥林嫂', '追鱼', '红楼梦', '盘妻索妻', '碧玉簪', '珍珠塔',
    '打金枝', '情探', '追鱼', '玉蜻蜓', '王老虎抢亲', '陆游与唐琬', '五女拜寿'],
  person: ['袁雪芬', '尹桂芳', '徐玉兰', '范瑞娟', '傅全香', '戚雅仙', '王文娟', '金采风', '吕瑞英', '张桂凤',
    '陆锦花', '毕春芳', '钱惠丽', '方亚芬', '吴凤花', '章瑞虹', '马樟花', '施银花', '姚水娟', '筱丹桂'],
  term: ['越剧', '水袖', '唱腔', '板式', '念白', '身段', '流派', '剧目', '越剧改革', '越剧史',
    '绍兴', '嵊县', '施家岙', '越剧皇后', '越剧十姐妹', '新越剧'],
};

const FLAT = Object.values(LEXICON).flat();
const LABELS = Object.keys(LEXICON);

// 匹配已含在别的词里的最大子串，避免“越剧”“越剧史”重复计数造成虚高
function countHits(text) {
  const hits = [];
  for (const kw of FLAT) {
    const idx = text.indexOf(kw);
    if (idx >= 0) hits.push({ kw, label: LABELS.find((l) => LEXICON[l].includes(kw)) });
  }
  return hits;
}

/**
 * 越剧内容审查
 * @param {string} fullText 全文
 * @returns {{isYueju:boolean,score:number,distinct:number,hits:Array,reason:string}}
 */
export function classifyYueju(fullText) {
  const text = (fullText || '').trim();
  if (!text) return { isYueju: false, score: 0, distinct: 0, hits: [], reason: '文本为空' };

  const hits = countHits(text);
  const unique = new Set(hits.map((h) => h.kw));
  const distinct = unique.size;
  // 命中总数按去重词计算，避免“越剧”在同一词多次出现虚增
  const total = unique.size;
  const density = (total / text.length) * 1000;
  // 原文长度差异大，用「不同越剧词总数」为主判，density 仅防「通篇零星越剧词」的泛文
  const score = Math.round(Math.min(100, 40 + total * 3 + density * 8));
  // total>=10 判为越剧；或 词数>=6 且每千字命中密度>=0.8 也判为越剧（适配较短文档）
  const isYueju = total >= 10 || (total >= 6 && density >= 0.8);

  const reason = isYueju
    ? `识别到 ${total} 个越剧相关词（流派/行当/剧目/人物/术语），判定为越剧内容`
    : `仅识别到 ${total} 个越剧相关词，未达阈值，判定为非越剧内容`;
  return { isYueju, score, distinct: total, hits, reason };
}