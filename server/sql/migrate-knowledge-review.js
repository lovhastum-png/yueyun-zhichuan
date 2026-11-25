// 临时迁移脚本：创建 knowledge_review 表 + 扩展 knowledge_chunks.source_type ENUM
// 用法：node server/sql/migrate-knowledge-review.js
import mysql from 'mysql2/promise';
import dotenv from 'dotenv';
import { fileURLToPath } from 'url';
import path from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
dotenv.config({ path: path.resolve(__dirname, '../../.env') });

async function main() {
  const pool = mysql.createPool({
    host: process.env.DB_HOST || 'localhost',
    port: Number(process.env.DB_PORT || 3306),
    user: process.env.DB_USER || 'root',
    password: process.env.DB_PASSWORD || '',
    database: process.env.DB_NAME || 'yueyun_db',
    multipleStatements: true,
  });

  console.log('[迁移] 开始创建 knowledge_review 表...');
  await pool.query(`
    CREATE TABLE IF NOT EXISTS knowledge_review (
      id INT AUTO_INCREMENT PRIMARY KEY,
      question_hash CHAR(64) NOT NULL COMMENT '问题归一化后的 SHA256，去重用',
      question TEXT NOT NULL COMMENT '用户原始问题',
      ask_count INT NOT NULL DEFAULT 1 COMMENT '累计被问次数',
      best_answer TEXT COMMENT '最佳 AI 回答',
      best_sources JSON COMMENT 'AI 回答的来源标注',
      sample_session_id VARCHAR(64) COMMENT '采样会话ID',
      sample_user_id INT COMMENT '采样用户ID',
      status ENUM('pending','approved','rejected') NOT NULL DEFAULT 'pending',
      reviewed_by INT DEFAULT NULL,
      reviewed_at DATETIME DEFAULT NULL,
      reject_reason VARCHAR(200) DEFAULT NULL,
      chunk_id INT DEFAULT NULL,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      UNIQUE KEY uk_qhash (question_hash),
      INDEX idx_status (status),
      INDEX idx_ask_count (ask_count),
      INDEX idx_reviewed (reviewed_by)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='高频问题审核入库（数据飞轮）';
  `);
  console.log('[迁移] knowledge_review 表创建完成');

  // 扩展 knowledge_chunks.source_type ENUM，新增 qa 类型
  console.log('[迁移] 扩展 knowledge_chunks.source_type ENUM...');
  try {
    await pool.query(`
      ALTER TABLE knowledge_chunks
      MODIFY COLUMN source_type ENUM('card','course','play','document','school','role','makeup','heritage','history','qa')
      NOT NULL DEFAULT 'card';
    `);
    console.log('[迁移] source_type ENUM 扩展完成（新增 qa 类型）');
  } catch (err) {
    if (err.code === 'ER_PARSE_ERROR' || /Duplicate/i.test(err.message)) {
      console.log('[迁移] source_type 已包含 qa 类型，跳过');
    } else {
      console.warn('[迁移] ENUM 扩展失败（不影响主功能，可稍后手动执行 ALTER）:', err.message);
    }
  }

  console.log('[迁移] ✅ 数据飞轮数据库初始化完成');
  await pool.end();
}

main().catch(err => {
  console.error('[迁移] 失败:', err);
  process.exit(1);
});
