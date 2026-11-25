// 补充越剧相邻剧种绍剧基础数据，让检索有兜底结果
// 使用: node server/importShaoju.mjs
import 'dotenv/config';
import pool from './db.js';
import { getEmbeddings } from './services/aiGrade.js';

function vectorToBuffer(vec) {
  return Buffer.from(new Float32Array(vec).buffer);
}

const entries = [
  {
    source_id: 'sha:play:绍剧',
    source_type: 'play',
    title: '绍剧',
    content: '绍剧，又称绍兴大班、绍兴乱弹，是浙江绍兴地区的传统戏曲剧种，属乱弹腔系。唱腔高亢激越、粗犷豪放，以二凡、三五七等板式为特色，主要伴奏乐器为板胡。经典剧目有《孙悟空三打白骨精》《龙虎斗》《男中王》《相国志》等。注：本系统主要收录越剧内容，绍剧为相邻剧种，仅作基础介绍。',
    keywords: ['绍剧', '绍兴大班', '绍兴乱弹', '越剧相邻剧种'],
  },
  {
    source_id: 'sha:person:六龄童',
    source_type: 'history',
    title: '绍剧猴戏（六龄童）',
    content: '绍剧以猴戏著称，六龄童（章宗义）是绍剧猴戏代表，主演《孙悟空三打白骨精》中的孙悟空一角，表演灵动精湛，1960年该剧搬上银幕。注：绍剧为越剧相邻剧种，本系统以越剧知识为主。',
    keywords: ['绍剧', '六龄童', '猴戏', '孙悟空三打白骨精'],
  },
];

console.log(`准备向量化 ${entries.length} 条绍剧基础条目...`);
// 先清理旧数据（含之前用 dd: 前缀写入的空向量条目）
await pool.query("DELETE FROM knowledge_chunks WHERE source_id LIKE 'sha:%' OR source_id LIKE 'dd:绍%' OR title LIKE '绍剧%'");
const texts = entries.map(e => `${e.title}。${e.content}`);
const vecs = await getEmbeddings(texts);

const insertSql = `INSERT INTO knowledge_chunks (source_id, source_type, title, content, keywords, embedding)
  VALUES (?, ?, ?, ?, ?, ?)`;
for (let i = 0; i < entries.length; i++) {
  const e = entries[i];
  await pool.query(insertSql, [
    e.source_id, e.source_type, e.title, e.content,
    JSON.stringify(e.keywords), vectorToBuffer(vecs[i]),
  ]);
  console.log(`  ✓ 入库 ${e.title}`);
}

// 验证
const { retrieveKnowledge } = await import('./services/ragRetrieval.js');
const hits = await retrieveKnowledge('绍剧的表演风格', { topK: 3, minScore: 0.2 });
console.log(`\n[验证] 查询"绍剧的表演风格"命中 ${hits.length} 条:`);
hits.forEach((h, i) => console.log(`  ${i + 1}. [${h.score.toFixed(3)}] ${h.title} - ${h.content.slice(0, 35)}...`));

await pool.end();
process.exit(0);