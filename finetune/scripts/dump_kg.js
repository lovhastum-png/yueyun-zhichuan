// 从 MySQL 导出知识图谱实体到 finetune/scripts/kg_dump.json
// 供 prepare_data.py 读取生成训练样本
// 运行: node finetune/scripts/dump_kg.js
import 'dotenv/config';
import pool from '../../server/db.js';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

async function main() {
  console.log('正在导出知识图谱数据...');
  console.log('数据库:', (await pool.query('SELECT DATABASE() AS db'))[0][0].db);

  // 查询所有实体
  const [entities] = await pool.query(
    'SELECT id, name, type, description FROM kg_entities ORDER BY id'
  );
  console.log(`实体: ${entities.length} 条`);

  // 查询所有关系（实际字段是 head_id / tail_id）
  const [relations] = await pool.query(`
    SELECT r.head_id, r.relation, r.tail_id,
           h.name AS head_name, t.name AS tail_name
    FROM kg_relations r
    JOIN kg_entities h ON r.head_id = h.id
    JOIN kg_entities t ON r.tail_id = t.id
  `);
  console.log(`关系: ${relations.length} 条`);

  // 组装：每个实体带 relations 数组
  const entMap = new Map();
  for (const e of entities) {
    entMap.set(e.id, {
      id: e.id,
      name: e.name,
      type: e.type,
      description: e.description || '',
      relations: []
    });
  }
  for (const r of relations) {
    if (entMap.has(r.head_id)) {
      entMap.get(r.head_id).relations.push({
        relation: r.relation,
        target: r.tail_name
      });
    }
  }

  const out = Array.from(entMap.values());
  const outPath = path.join(__dirname, 'kg_dump.json');
  fs.writeFileSync(outPath, JSON.stringify(out, null, 2), 'utf-8');
  console.log(`\n✓ 已导出 ${out.length} 个实体到: ${outPath}`);

  // 打印类型分布
  const typeStat = {};
  for (const e of out) {
    typeStat[e.type] = (typeStat[e.type] || 0) + 1;
  }
  console.log('类型分布:', typeStat);

  await pool.end();
}

main().catch(err => {
  console.error('导出失败:', err.message);
  console.error('请确认: 1) MySQL 已启动 2) .env 中数据库配置正确 3) kg_entities 表已填充');
  process.exit(1);
});
