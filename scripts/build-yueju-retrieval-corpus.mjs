import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.join(__dirname, '..');
const dataDir = path.join(rootDir, 'models', 'yueju_asr_correct', 'data');
const rawPath = path.join(dataDir, 'train.json');
const factsPath = path.join(dataDir, 'authoritative_facts.json');
const outputPath = path.join(dataDir, 'retrieval_corpus.json');
const reportPath = path.join(dataDir, 'retrieval_corpus_report.json');

const raw = JSON.parse(fs.readFileSync(rawPath, 'utf8'));
const authoritative = JSON.parse(fs.readFileSync(factsPath, 'utf8'));

const DOMAIN_TITLE = /越剧|袁雪芬|尹桂芳|范瑞娟|傅全香|徐玉兰|戚雅仙|王文娟|梁山伯|祝英台|红楼梦|西厢记|祥林嫂|小歌班|的笃班|唱腔|流派|行当|小生|花旦|老生|剧团|剧目|人物|师承|名伶|水袖|非遗|嵊州|嵊县|五女拜寿/;

const TOPIC_RULES = [
  ['heritage', /非物质文化遗产|非遗|传承人|保护单位/],
  ['origin', /发源|起源|诞生|形成|落地唱书|小歌班|的笃班|绍兴文戏|进入上海|历史名称/],
  ['vocal', /唱腔|四工|尺调|弦下|板腔|曲调|演唱/],
  ['school', /流派|袁派|尹派|范派|傅派|徐派|戚派|王派|毕派|陆派|吕派|金派|张派/],
  ['role', /行当|小生|花旦|老生|老旦|丑行|净行|女扮男装/],
  ['organization', /剧团|越剧院|小百花|成立|建团/],
  ['play', /剧目|梁山伯与祝英台|梁祝|红楼梦|西厢记|祥林嫂|五女拜寿|何文秀|追鱼|情探/],
  ['person', /人物|演员|艺术家|师承|出生|创始人/],
];

const ENTITY_TERMS = [
  '越剧', '嵊县', '嵊州', '东王村', '落地唱书', '小歌班', '的笃班', '绍兴文戏', '女子绍兴文戏',
  '国家级非物质文化遗产', '非遗', '四工腔', '尺调腔', '弦下腔',
  '袁派', '袁雪芬', '尹派', '尹桂芳', '范派', '范瑞娟', '傅派', '傅全香', '徐派', '徐玉兰',
  '戚派', '戚雅仙', '王派', '王文娟', '小生', '花旦', '老生', '老旦', '丑行',
  '梁山伯与祝英台', '梁祝', '梁山伯', '祝英台', '十八相送', '楼台会', '化蝶',
  '红楼梦', '贾宝玉', '林黛玉', '西厢记', '祥林嫂', '五女拜寿', '浙江小百花越剧团', '浙江小百花',
];

function cleanText(value) {
  return String(value || '').replace(/\s+/g, ' ').trim();
}

function inferTopics(text) {
  return TOPIC_RULES.filter(([, pattern]) => pattern.test(text)).map(([topic]) => topic);
}

function inferEntities(text) {
  return ENTITY_TERMS.filter((entity) => text.includes(entity));
}

const excluded = [];
const seen = new Set();
const schoolDocs = [];

raw.forEach((item, index) => {
  const title = cleanText(item.instruction);
  const content = cleanText(item.output);
  if (!title || !content) {
    excluded.push({ index, title, reason: 'empty' });
    return;
  }
  if (!DOMAIN_TITLE.test(title)) {
    excluded.push({ index, title, reason: 'out_of_domain' });
    return;
  }
  const dedupeKey = `${title}\n${content}`;
  if (seen.has(dedupeKey)) {
    excluded.push({ index, title, reason: 'exact_duplicate' });
    return;
  }
  seen.add(dedupeKey);
  const combined = `${title}\n${content}`;
  schoolDocs.push({
    id: `school-${index}`,
    title,
    content,
    topics: inferTopics(combined),
    entities: inferEntities(combined),
    keywords: [],
    source: {
      name: '越韵智传校本越剧语料',
      url: '',
      type: 'school_corpus',
      level: 1,
    },
    review_status: 'unverified',
  });
});

const officialDocs = authoritative.map((item) => ({
  ...item,
  topics: [item.topic],
  review_status: item.source.level >= 3 ? 'official_verified' : 'school_reviewed',
}));

const corpus = [...officialDocs, ...schoolDocs];
fs.writeFileSync(outputPath, `${JSON.stringify(corpus, null, 2)}\n`, 'utf8');

const byReason = Object.fromEntries(
  [...new Set(excluded.map((item) => item.reason))].map((reason) => [reason, excluded.filter((item) => item.reason === reason).length]),
);
const report = {
  generated_at: new Date().toISOString(),
  raw_count: raw.length,
  authoritative_count: officialDocs.length,
  school_kept_count: schoolDocs.length,
  output_count: corpus.length,
  excluded_count: excluded.length,
  excluded_by_reason: byReason,
  excluded,
  source_levels: {
    '3': '政府、国家级非遗数字平台或官方机构',
    '2': '校本教师复核资料',
    '1': '原始校本训练语料，尚未逐条复核',
  },
};
fs.writeFileSync(reportPath, `${JSON.stringify(report, null, 2)}\n`, 'utf8');

console.log(JSON.stringify({ outputPath, reportPath, ...report, excluded: undefined }, null, 2));
