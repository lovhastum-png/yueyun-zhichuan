// 越剧知识库规模扩展脚本（方案 C）
// 将 468 个 KG 实体 + 2398 条越剧大典数据 向量化并写入 knowledge_chunks
// 使用: node server/importKnowledge.js
import 'dotenv/config';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import pool from './db.js';
import { getEmbeddings } from './services/aiGrade.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// 向量序列化
function vectorToBuffer(vec) {
  return Buffer.from(new Float32Array(vec).buffer);
}

// 实体类型 → source_type 映射
const ENTITY_TYPE_MAP = {
  person: 'history',
  school: 'school',
  play: 'play',
  role: 'role',
  segment: 'document',
  concept: 'document',
};

// 大典类型 → source_type 映射
const DADIAN_TYPE_MAP = {
  person: 'history',
  play: 'play',
  qu: 'document',
};

// 批量向量化（分批调用 embedding API，接口限制每批不超过 10 条）
async function batchEmbed(texts, batchSize = 8) {
  const all = new Array(texts.length);
  for (let i = 0; i < texts.length; i += batchSize) {
    const batch = texts.slice(i, i + batchSize);
    let vecs;
    try {
      vecs = await getEmbeddings(batch);
    } catch (err) {
      console.error(`  [embed] 批次 ${i} 失败:`, err.message);
      for (let j = 0; j < batch.length; j++) all[i + j] = null;
      continue;
    }
    for (let j = 0; j < vecs.length; j++) all[i + j] = vecs[j];
    console.log(`  [embed] ${Math.min(i + batchSize, texts.length)}/${texts.length}`);
  }
  return all;
}

async function main() {
  console.log('========================================');
  console.log('  越韵智传 · 知识库规模扩展');
  console.log('========================================\n');

  // 1. 读取 KG 实体
  console.log('[1/4] 读取知识图谱实体...');
  const [entities] = await pool.query('SELECT id, name, type, description FROM kg_entities ORDER BY id');
  console.log(`  ✓ ${entities.length} 个实体`);

  // 2. 读取大典数据
  console.log('[2/4] 读取越剧大典数据...');
  const dumpPath = path.join(__dirname, '..', 'finetune', 'scripts', 'dadian_dump.json');
  if (!fs.existsSync(dumpPath)) {
    console.error('  ✗ 未找到 dadian_dump.json，请先运行: py finetune/scripts/dump_dadian.py');
    process.exit(1);
  }
  const dadian = JSON.parse(fs.readFileSync(dumpPath, 'utf-8'));
  console.log(`  ✓ ${dadian.length} 条大典数据`);

  // 3. 组装知识分块
  console.log('[3/4] 组装知识分块...');
  const chunks = [];

  // KG 实体 → 知识分块
  for (const e of entities) {
    if (!e.name || !e.description) continue;
    const stype = ENTITY_TYPE_MAP[e.type] || 'document';
    chunks.push({
      source_id: `kg:${e.type}:${e.id}`,
      source_type: stype,
      title: e.name,
      content: e.description,
      keywords: [e.name],
    });
  }

  // 大典数据 → 知识分块（超长内容截断到合理长度）
  for (const d of dadian) {
    if (!d.name || !d.desc) continue;
    const stype = DADIAN_TYPE_MAP[d.type] || 'document';
    const content = d.desc.length > 1200 ? d.desc.slice(0, 1200) : d.desc;
    chunks.push({
      source_id: `dd:${d.type}:${d.name}`,
      source_type: stype,
      title: d.name,
      content,
      keywords: [d.name, d.play || ''],
    });
  }

  console.log(`  ✓ 共 ${chunks.length} 条待向量化知识块`);

  // 4. 向量化并入库
  console.log(`\n[4/4] 向量化并入库（分批调用 embedding API，约需 2-5 分钟）...`);
  const texts = chunks.map(c => `${c.title}。${c.content}`);
  const vectors = await batchEmbed(texts, 8);

  // 先清空大典类旧数据（若之前导入过），再批量插入
  console.log('  清理旧的大典/图谱知识块...');
  await pool.query("DELETE FROM knowledge_chunks WHERE source_id LIKE 'dd:%'");
  await pool.query("DELETE FROM knowledge_chunks WHERE source_id LIKE 'kg:%'");

  console.log('  写入知识块...');
  let ok = 0, fail = 0;
  const insertSql = `INSERT INTO knowledge_chunks (source_id, source_type, title, content, keywords, embedding)
    VALUES (?, ?, ?, ?, ?, ?)`;
  for (let i = 0; i < chunks.length; i++) {
    try {
      const c = chunks[i];
      await pool.query(insertSql, [
        c.source_id,
        c.source_type,
        c.title,
        c.content,
        JSON.stringify(c.keywords || []),
        vectors[i] ? vectorToBuffer(vectors[i]) : null,
      ]);
      ok++;
    } catch (err) {
      fail++;
      console.error(`  ✗ 入库失败 ${c.source_id}:`, err.message);
    }
  }
  console.log(`  ✓ 入库完成：成功 ${ok}，失败 ${fail}`);

  // 5. 统计
  const [stats] = await pool.query(
    `SELECT source_type, COUNT(*) AS cnt FROM knowledge_chunks WHERE embedding IS NOT NULL GROUP BY source_type`
  );
  const total = stats.reduce((s, r) => s + r.cnt, 0);
  console.log(`\n========================================`);
  console.log(`  知识库统计：共 ${total} 条已向量化知识`);
  for (const t of stats) console.log(`    - ${t.source_type}: ${t.cnt} 条`);
  console.log(`========================================`);

  // 6. 检索测试
  console.log('\n[检索测试] 查询："徐派有什么特点？"');
  const { retrieveKnowledge } = await import('./services/ragRetrieval.js');
  const hits = await retrieveKnowledge('徐派有什么特点？', { topK: 3, minScore: 0.2 });
  console.log(`  命中 ${hits.length} 条：`);
  hits.forEach((h, i) => {
    console.log(`    ${i + 1}. [${h.score.toFixed(3)}] ${h.title} - ${h.content.slice(0, 40)}...`);
  });

  console.log('\n✓ 知识库扩展完成！');
  await pool.end();
  process.exit(0);
}

main().catch(async err => {
  console.error('\n✗ 导入失败:', err);
  try { await pool.end(); } catch {}
  process.exit(1);
});