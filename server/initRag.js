// RAG 知识库初始化脚本
// 将 knowledgeBase.js 的 16 张卡片向量化并写入 knowledge_chunks 表
// 使用：node server/initRag.js
import 'dotenv/config';
import pool from './db.js';
import { knowledgeCards } from './services/knowledgeBase.js';
import { indexKnowledgeBatch, getKnowledgeStats } from './services/ragRetrieval.js';

// 把 knowledgeCards 转为入库格式
function cardsToChunks(cards) {
  return cards.map(c => ({
    source_id: c.id,
    source_type: 'card',
    title: c.title,
    content: c.content,
    keywords: c.keywords,
  }));
}

async function main() {
  console.log('========================================');
  console.log('  越韵智传 · RAG 知识库初始化');
  console.log('========================================\n');

  // 1. 检查数据库连接
  console.log('[1/3] 检查数据库连接...');
  try {
    await pool.query('SELECT 1');
    console.log('  ✓ 数据库连接正常');
  } catch (err) {
    console.error('  ✗ 数据库连接失败:', err.message);
    process.exit(1);
  }

  // 2. 确保 knowledge_chunks 表存在（若 init.sql 未执行）
  console.log('\n[2/3] 确保 knowledge_chunks 表存在...');
  try {
    await pool.query(`
      CREATE TABLE IF NOT EXISTS knowledge_chunks (
        id INT AUTO_INCREMENT PRIMARY KEY,
        source_id VARCHAR(64) NOT NULL,
        source_type ENUM('card','course','play','document') NOT NULL DEFAULT 'card',
        title VARCHAR(120) NOT NULL,
        content TEXT NOT NULL,
        keywords JSON DEFAULT NULL,
        embedding LONGBLOB DEFAULT NULL,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        INDEX idx_source (source_type, source_id),
        INDEX idx_title (title)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
    `);
    console.log('  ✓ knowledge_chunks 表已就绪');
  } catch (err) {
    console.error('  ✗ 建表失败:', err.message);
    process.exit(1);
  }

  // 3. 向量化并入库
  console.log(`\n[3/3] 向量化 ${knowledgeCards.length} 张知识卡片并入库...`);
  console.log('  (每张卡片调用一次百炼 embedding API，约需 10-20 秒)\n');
  const chunks = cardsToChunks(knowledgeCards);
  const result = await indexKnowledgeBatch(chunks);
  console.log(`  ✓ 入库完成：成功 ${result.ok}，失败 ${result.fail}`);

  // 4. 打印统计
  const stats = await getKnowledgeStats();
  console.log(`\n========================================`);
  console.log(`  知识库统计：共 ${stats.total} 条已向量化知识`);
  for (const t of stats.byType) {
    console.log(`    - ${t.source_type}: ${t.cnt} 条`);
  }
  console.log(`========================================`);

  // 5. 简单检索测试
  if (result.ok > 0) {
    console.log('\n[检索测试] 查询："徐派有什么特点？"');
    const { retrieveKnowledge } = await import('./services/ragRetrieval.js');
    const hits = await retrieveKnowledge('徐派有什么特点？', { topK: 3, minScore: 0.2 });
    console.log(`  命中 ${hits.length} 条：`);
    hits.forEach((h, i) => {
      console.log(`    ${i + 1}. [${h.score.toFixed(3)}] ${h.title} - ${h.content.slice(0, 40)}...`);
    });
  }

  console.log('\n✓ RAG 知识库初始化完成，现在可以启动服务器测试智能问答了。');
  process.exit(0);
}

main().catch(err => {
  console.error('\n✗ 初始化失败:', err);
  process.exit(1);
});
