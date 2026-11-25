// 知识图谱抽取脚本：从 knowledge_chunks 表读取知识，用LLM抽取实体关系三元组，写入 kg_entities / kg_relations
// 使用：node server/extractKg.js
import 'dotenv/config';
import pool from './db.js';
import { callAgent } from './services/xingchenWs.js';
import { parseJsonLoose } from './services/aiGrade.js';

// 抽取三元组的系统提示词
const EXTRACT_PROMPT = `你是越剧知识图谱构建助手。请从给定的越剧知识文本中抽取实体和关系三元组。

【实体类型】（必须严格使用以下类型）
- person：人物（演员、创始人、名家，如：袁雪芬、徐玉兰、王文娟）
- school：流派（如：袁派、尹派、范派、傅派、徐派、戚派、王派）
- play：剧目（如：红楼梦、梁山伯与祝英台、祥林嫂、西厢记）
- role：行当（如：小生、花旦、青衣、老生、老旦、小丑）
- segment：唱段/场次（如：宝玉哭灵、黛玉葬花、十八相送）
- concept：概念（如：四工调、尺调腔、水袖、水袖功、非遗）

【关系类型】（必须严格使用以下关系）
- 创立：人物→流派（袁雪芬 创立 袁派）
- 代表作：人物→剧目 或 流派→剧目（袁雪芬 代表作 祥林嫂）
- 属于流派：剧目→流派（红楼梦 属于流派 徐派）
- 演唱流派：人物→流派 或 角色→流派（贾宝玉 演唱流派 徐派）
- 选自：唱段→剧目（宝玉哭灵 选自 红楼梦）
- 师承：人物→人物（戚雅仙 师承 袁雪芬）
- 擅长行当：人物→行当（袁雪芬 擅长行当 正旦）
- 剧目行当：剧目→行当（红楼梦 剧目行当 小生）
- 包含唱段：剧目→唱段（红楼梦 包含唱段 宝玉哭灵）
- 相关概念：剧目/流派/人物→概念（袁派 相关概念 尺调腔）

【抽取规则】
1. 只抽取文本中明确提到的事实，不要臆测。
2. 实体名称用规范简称（如"袁雪芬"而非"袁雪芬先生"）。
3. 剧目名去掉书名号（如"红楼梦"而非"《红楼梦》"）。
4. 每条文本抽取3-15个三元组，宁缺毋滥。
5. 实体描述从文本中提取一句话简介。

【输出格式】
仅输出JSON，不要markdown代码块，不要解释：
{
  "entities": [
    {"name": "袁雪芬", "type": "person", "description": "越剧袁派创始人，越剧改革先驱"}
  ],
  "relations": [
    {"head": "袁雪芬", "relation": "创立", "tail": "袁派"},
    {"head": "袁雪芬", "relation": "代表作", "tail": "祥林嫂"}
  ]
}

【待抽取文本】
标题：`;

// 调用 LLM 抽取三元组
async function extractFromChunk(title, content) {
  const userMsg = `${EXTRACT_PROMPT}${title}\n内容：${content}`;
  try {
    const output = await callAgent(
      [{ role: 'user', content: userMsg }],
      { timeout: 30000, temperature: 0.3, maxTokens: 2048 }
    );
    const data = parseJsonLoose(output);
    if (!data) return null;
    return {
      entities: Array.isArray(data.entities) ? data.entities : [],
      relations: Array.isArray(data.relations) ? data.relations : [],
    };
  } catch (err) {
    console.error(`  LLM抽取失败: ${err.message}`);
    return null;
  }
}

// 实体入库（去重）
async function upsertEntity(name, type, description, sourceId) {
  if (!name || !type) return null;
  const cleanName = name.replace(/《/g, '').replace(/》/g, '').trim();
  if (cleanName.length < 1 || cleanName.length > 50) return null;
  try {
    const [result] = await pool.query(
      `INSERT INTO kg_entities (name, type, description, source_id)
       VALUES (?, ?, ?, ?)
       ON DUPLICATE KEY UPDATE description = COALESCE(VALUES(description), description)`,
      [cleanName, type, description || null, sourceId]
    );
    // 查询获取id（可能是新插入或已存在）
    const [rows] = await pool.query('SELECT id FROM kg_entities WHERE name = ? AND type = ?', [cleanName, type]);
    return rows[0] ? rows[0].id : null;
  } catch (err) {
    return null;
  }
}

// 关系入库（去重）
async function upsertRelation(headId, relation, tailId, sourceId) {
  if (!headId || !tailId || !relation) return false;
  try {
    await pool.query(
      `INSERT INTO kg_relations (head_id, relation, tail_id, source_id)
       VALUES (?, ?, ?, ?)
       ON DUPLICATE KEY UPDATE weight = weight + 0.1`,
      [headId, relation, tailId, sourceId]
    );
    return true;
  } catch (err) {
    return false;
  }
}

// 主流程
async function main() {
  console.log('========================================');
  console.log('  越韵智传 · 知识图谱抽取');
  console.log('========================================\n');

  // 1. 建表
  console.log('[1/4] 建表...');
  await pool.query(`
    CREATE TABLE IF NOT EXISTS kg_entities (
      id INT AUTO_INCREMENT PRIMARY KEY,
      name VARCHAR(100) NOT NULL,
      type ENUM('person','school','play','role','segment','concept') NOT NULL DEFAULT 'concept',
      description TEXT DEFAULT NULL,
      source_id VARCHAR(64) DEFAULT NULL,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      UNIQUE KEY uk_name_type (name, type),
      INDEX idx_type (type),
      INDEX idx_name (name)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  `);
  await pool.query(`
    CREATE TABLE IF NOT EXISTS kg_relations (
      id INT AUTO_INCREMENT PRIMARY KEY,
      head_id INT NOT NULL,
      relation VARCHAR(50) NOT NULL,
      tail_id INT NOT NULL,
      weight FLOAT DEFAULT 1.0,
      source_id VARCHAR(64) DEFAULT NULL,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      UNIQUE KEY uk_rel (head_id, relation, tail_id),
      INDEX idx_head (head_id),
      INDEX idx_tail (tail_id),
      INDEX idx_relation (relation),
      CONSTRAINT fk_kgrel_head FOREIGN KEY (head_id) REFERENCES kg_entities(id) ON DELETE CASCADE,
      CONSTRAINT fk_kgrel_tail FOREIGN KEY (tail_id) REFERENCES kg_entities(id) ON DELETE CASCADE
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  `);
  console.log('  ✓ 表已就绪');

  // 2. 读取所有知识块
  console.log('\n[2/4] 读取知识块...');
  const [chunks] = await pool.query(
    'SELECT source_id, source_type, title, content FROM knowledge_chunks WHERE embedding IS NOT NULL ORDER BY source_type, id'
  );
  console.log(`  ✓ 共 ${chunks.length} 条知识块`);

  // 3. 逐条抽取
  console.log('\n[3/4] LLM抽取三元组...');
  let totalEntities = 0, totalRelations = 0;
  const batchSize = 5; // 每5条打印一次进度
  for (let i = 0; i < chunks.length; i++) {
    const chunk = chunks[i];
    process.stdout.write(`  [${i + 1}/${chunks.length}] ${chunk.title.slice(0, 25)}... `);

    const result = await extractFromChunk(chunk.title, chunk.content);
    if (!result) {
      console.log('跳过（解析失败）');
      continue;
    }

    let entCount = 0, relCount = 0;
    // 实体入库
    const entityCache = new Map();
    for (const ent of result.entities) {
      const eid = await upsertEntity(ent.name, ent.type, ent.description, chunk.source_id);
      if (eid) {
        entityCache.set(`${ent.name}|${ent.type}`, eid);
        entCount++;
      }
    }
    // 关系入库
    for (const rel of result.relations) {
      // 尝试匹配实体（按名字查找，不严格匹配type）
      const headKey = Object.keys(result.entities).find(k => result.entities[k].name === rel.head);
      let headId = null, tailId = null;
      // 通过name查id
      const [headRows] = await pool.query(
        'SELECT id FROM kg_entities WHERE name = ? ORDER BY id LIMIT 1', [rel.head]
      );
      const [tailRows] = await pool.query(
        'SELECT id FROM kg_entities WHERE name = ? ORDER BY id LIMIT 1', [rel.tail]
      );
      if (headRows[0]) headId = headRows[0].id;
      if (tailRows[0]) tailId = tailRows[0].id;
      if (headId && tailId) {
        const ok = await upsertRelation(headId, rel.relation, tailId, chunk.source_id);
        if (ok) relCount++;
      }
    }

    totalEntities += entCount;
    totalRelations += relCount;
    console.log(`${entCount}实体 ${relCount}关系`);

    // 每10条小憩避免限流
    if ((i + 1) % 10 === 0) await new Promise(r => setTimeout(r, 1000));
  }

  console.log(`\n  抽取完成：共 ${totalEntities} 实体次，${totalRelations} 关系次`);

  // 4. 统计
  console.log('\n[4/4] 统计...');
  const [entStats] = await pool.query('SELECT type, COUNT(*) as cnt FROM kg_entities GROUP BY type ORDER BY cnt DESC');
  const [relStats] = await pool.query('SELECT relation, COUNT(*) as cnt FROM kg_relations GROUP BY relation ORDER BY cnt DESC');
  const [[{ entityTotal }]] = await pool.query('SELECT COUNT(*) as entityTotal FROM kg_entities');
  const [[{ relTotal }]] = await pool.query('SELECT COUNT(*) as relTotal FROM kg_relations');

  console.log(`\n========================================`);
  console.log(`  知识图谱构建完成`);
  console.log(`  实体总数：${entityTotal}`);
  for (const s of entStats) {
    console.log(`    - ${s.type}: ${s.cnt}`);
  }
  console.log(`  关系总数：${relTotal}`);
  for (const s of relStats) {
    console.log(`    - ${s.relation}: ${s.cnt}`);
  }
  console.log(`========================================`);

  process.exit(0);
}

main().catch(err => {
  console.error('\n✗ 执行失败:', err);
  process.exit(1);
});
