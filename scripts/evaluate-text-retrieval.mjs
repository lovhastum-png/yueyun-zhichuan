import fs from 'node:fs';
import path from 'node:path';
import { performance } from 'node:perf_hooks';
import { fileURLToPath } from 'node:url';

import { retrieveYuejuKnowledge } from '../server/services/yuejuKnowledge.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const outputPath = path.join(__dirname, '..', 'docs', 'roadshow', 'text_retrieval_results.json');

// 与既有 0.5B A/B 实验采用相同的“关键事实覆盖率”口径，便于横向比较。
// 每组同义词命中任意一个即计 1 个关键事实命中。
const questions = [
  { id: 'B1', tier: 'basic', q: '越剧发源于我国哪个省份、今天的哪个地方？', facts: [['浙江'], ['嵊县', '嵊州']] },
  { id: 'B2', tier: 'basic', q: '越剧形成于哪一年？“落地唱书”搬上舞台后最初叫什么？', facts: [['1906'], ['落地唱书'], ['小歌班', '的笃班']] },
  { id: 'B3', tier: 'basic', q: '越剧是哪一年列入国家级非物质文化遗产名录的，属于第几批？', facts: [['2006'], ['第一批', '首批'], ['非物质文化遗产', '非遗']] },
  { id: 'B4', tier: 'basic', q: '越剧进入上海后使用过哪些名称？请说明“小歌班”“绍兴文戏”和“女子绍兴文戏”的关系。', facts: [['小歌班', '的笃班'], ['绍兴文戏'], ['女子绍兴文戏']] },
  { id: 'B5', tier: 'basic', q: '越剧在什么时候进入上海，当时通常称为什么？', facts: [['1916'], ['上海'], ['绍兴文戏']] },
  { id: 'B6', tier: 'basic', q: '请用三到四个要点概括越剧的主要艺术特征。', facts: [['抒情'], ['唱'], ['优美', '唯美', '典雅'], ['才子佳人']] },
  { id: 'M1', tier: 'mid', q: '越剧唱腔体系中的四工腔、尺调腔和弦下腔分别是什么关系？', facts: [['四工'], ['尺调'], ['弦下']] },
  { id: 'M2', tier: 'mid', q: '请列举六个越剧主要流派，并说出各自的创始人。', facts: [['袁派', '袁雪芬'], ['尹派', '尹桂芳'], ['范派', '范瑞娟'], ['傅派', '傅全香'], ['徐派', '徐玉兰'], ['戚派', '戚雅仙']] },
  { id: 'M3', tier: 'mid', q: '越剧主要有哪些行当？小生和花旦在越剧表演中有什么地位？', facts: [['小生'], ['花旦'], ['老生'], ['丑']] },
  { id: 'M4', tier: 'mid', q: '《梁山伯与祝英台》有哪些重要情节和经典折子？结局是什么？', facts: [['同窗', '共读'], ['十八相送'], ['楼台会'], ['化蝶']] },
  { id: 'H1', tier: 'hard', q: '浙江小百花越剧团成立于哪一年？请列举一部代表剧目。', facts: [['1984'], ['五女拜寿', '西厢记', '陆游与唐琬', '梁祝']] },
  { id: 'H2', tier: 'hard', q: '越剧《红楼梦》中，徐玉兰和王文娟分别塑造了什么角色？', facts: [['徐玉兰', '贾宝玉'], ['王文娟', '林黛玉']] },
];

function scoreCoverage(text, facts) {
  const normalized = String(text || '').replace(/\s+/g, '');
  const detail = facts.map((alternatives) => ({
    alternatives,
    ok: alternatives.some((term) => normalized.includes(term)),
  }));
  const hit = detail.filter((item) => item.ok).length;
  return { hit, total: facts.length, score: hit / facts.length, detail };
}

function percentile(values, p) {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const index = Math.min(sorted.length - 1, Math.ceil(sorted.length * p) - 1);
  return sorted[index];
}

const rows = questions.map((item) => {
  const started = performance.now();
  const chunks = retrieveYuejuKnowledge(item.q, { topK: 3, minScore: 1.5 });
  const elapsedMs = performance.now() - started;
  const top1Text = chunks[0] ? `${chunks[0].title}\n${chunks[0].content}` : '';
  const top3Text = chunks.map((chunk) => `${chunk.title}\n${chunk.content}`).join('\n');
  return {
    ...item,
    elapsed_ms: Number(elapsedMs.toFixed(3)),
    chunks,
    top1: scoreCoverage(top1Text, item.facts),
    top3: scoreCoverage(top3Text, item.facts),
  };
});

function summarize(items, key) {
  const totalFacts = items.reduce((sum, row) => sum + row[key].total, 0);
  const hitFacts = items.reduce((sum, row) => sum + row[key].hit, 0);
  const macro = items.reduce((sum, row) => sum + row[key].score, 0) / items.length;
  return {
    macro_percent: Number((macro * 100).toFixed(1)),
    micro_percent: Number((hitFacts / totalFacts * 100).toFixed(1)),
    hit_facts: hitFacts,
    total_facts: totalFacts,
  };
}

const tiers = Object.fromEntries(
  ['basic', 'mid', 'hard'].map((tier) => {
    const subset = rows.filter((row) => row.tier === tier);
    return [tier, { top1: summarize(subset, 'top1'), top3: summarize(subset, 'top3') }];
  }),
);

const times = rows.map((row) => row.elapsed_ms);
const result = {
  generated_at: new Date().toISOString(),
  methodology: {
    corpus_size: 2139,
    question_count: rows.length,
    metric: '关键事实覆盖率：每组同义词命中任意一个计 1 分',
    retrieval: '字符级 2-gram + IDF，topK=3，注入片段每条最多 260 字',
  },
  summary: {
    top1: summarize(rows, 'top1'),
    top3: summarize(rows, 'top3'),
    by_tier: tiers,
    latency_ms: {
      average: Number((times.reduce((sum, value) => sum + value, 0) / times.length).toFixed(3)),
      p50: Number(percentile(times, 0.5).toFixed(3)),
      p95: Number(percentile(times, 0.95).toFixed(3)),
      max: Number(Math.max(...times).toFixed(3)),
    },
  },
  rows,
};

fs.writeFileSync(outputPath, `${JSON.stringify(result, null, 2)}\n`, 'utf8');
console.log(JSON.stringify(result.summary, null, 2));
console.log(`结果已写入：${outputPath}`);
