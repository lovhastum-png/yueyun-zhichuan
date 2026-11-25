// RAG 检索服务：向量入库 + 语义检索
// 复用 aiGrade.js 的 getEmbeddings() / cosineSimilarity()
import pool from '../db.js';
import { getEmbeddings, cosineSimilarity } from './aiGrade.js';
import { safeCall } from '../utils/resilience.js';

// 向量序列化：Float32Array → Buffer（存入 LONGBLOB）
function vectorToBuffer(vec) {
  return Buffer.from(new Float32Array(vec).buffer);
}

// 向量反序列化：Buffer → Float32Array
function bufferToVector(buf) {
  if (!buf) return null;
  // 复制一份避免 Buffer 对齐问题
  const arrayBuffer = buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength);
  return new Float32Array(arrayBuffer);
}

/**
 * 对单条知识分块做 embedding 并写入数据库
 * @param {object} chunk { source_id, source_type, title, content, keywords }
 */
export async function indexKnowledgeChunk(chunk) {
  const text = `${chunk.title}。${chunk.content}`;
  const [emb] = await getEmbeddings([text]);
  await pool.query(
    `INSERT INTO knowledge_chunks (source_id, source_type, title, content, keywords, embedding)
     VALUES (?, ?, ?, ?, ?, ?)
     ON DUPLICATE KEY UPDATE title=VALUES(title), content=VALUES(content), keywords=VALUES(keywords), embedding=VALUES(embedding)`,
    [chunk.source_id, chunk.source_type, chunk.title, chunk.content, JSON.stringify(chunk.keywords || []), vectorToBuffer(emb)]
  );
  // ON DUPLICATE KEY 需要 source_id 有唯一索引；这里用先删后插更稳妥
  return true;
}

/**
 * 批量向量化知识并入库（如初始化 16 张卡片）
 * @param {Array} chunks
 */
export async function indexKnowledgeBatch(chunks) {
  let ok = 0, fail = 0;
  for (const c of chunks) {
    try {
      // 先删旧（按 source_id）再插新，避免重复
      await pool.query('DELETE FROM knowledge_chunks WHERE source_id = ?', [c.source_id]);
      const text = `${c.title}。${c.content}`;
      const [emb] = await getEmbeddings([text]);
      await pool.query(
        `INSERT INTO knowledge_chunks (source_id, source_type, title, content, keywords, embedding)
         VALUES (?, ?, ?, ?, ?, ?)`,
        [c.source_id, c.source_type, c.title, c.content, JSON.stringify(c.keywords || []), vectorToBuffer(emb)]
      );
      ok++;
    } catch (err) {
      console.error(`[RAG] 入库失败 ${c.source_id}:`, err.message);
      fail++;
    }
  }
  console.log(`[RAG] 批量入库完成：成功 ${ok}，失败 ${fail}`);
  return { ok, fail };
}

/**
 * 语义检索：根据查询文本，返回最相关的 Top-K 知识片段
 * @param {string} query 用户问题
 * @param {object} opts { topK, minScore, sourceType }
 * @returns {Promise<Array<{id, title, content, score, source_id, source_type}>>}
 */
export async function retrieveKnowledge(query, opts = {}) {
  const { topK = 3, minScore = 0.3, sourceType = null } = opts;

  try {
    // 1. 查询向量（embedding 服务不可用时降级为空检索）
    let qEmb = null;
    try {
      [qEmb] = await getEmbeddings([query]);
    } catch (err) {
      console.warn('[RAG] embedding 服务失败，降级为空检索:', err.message);
      return [];
    }
    if (!qEmb) return [];

    // 2. 从数据库拉取所有已向量化的知识（带可选 source_type 过滤）
    const sql = sourceType
      ? 'SELECT id, source_id, source_type, title, content FROM knowledge_chunks WHERE source_type = ? AND embedding IS NOT NULL'
      : 'SELECT id, source_id, source_type, title, content, embedding FROM knowledge_chunks WHERE embedding IS NOT NULL';
    const params = sourceType ? [sourceType] : [];
    const [rows] = await pool.query(sql, params);

    if (rows.length === 0) return [];

    // 3. 单独查 embedding（LONGBLOB 在主查询里选出来避免文本字段编码问题）
    const ids = rows.map(r => r.id);
    const [embRows] = await pool.query(
      'SELECT id, embedding FROM knowledge_chunks WHERE id IN (?) AND embedding IS NOT NULL',
      [ids]
    );
    const embMap = new Map(embRows.map(r => [r.id, bufferToVector(r.embedding)]));

    // 4. 计算相似度并排序
    const scored = rows
      .map(r => {
        const vec = embMap.get(r.id);
        if (!vec) return null;
        const score = cosineSimilarity(qEmb, vec);
        return { id: r.id, source_id: r.source_id, source_type: r.source_type, title: r.title, content: r.content, score };
      })
      .filter(Boolean)
      .filter(r => r.score >= minScore)
      .sort((a, b) => b.score - a.score)
      .slice(0, topK);

    return scored;
  } catch (err) {
    console.error('[RAG] 检索异常，降级为空结果:', err.message);
    return [];
  }
}

/**
 * 获取知识库统计信息
 */
export async function getKnowledgeStats() {
  const [rows] = await pool.query(
    `SELECT source_type, COUNT(*) AS cnt FROM knowledge_chunks WHERE embedding IS NOT NULL GROUP BY source_type`
  );
  const total = rows.reduce((s, r) => s + r.cnt, 0);
  return { total, byType: rows };
}

/**
 * 构造 RAG 上下文文本（拼接到 LLM system prompt）
 * @param {Array} chunks 检索结果
 * @returns {string}
 */
export function buildRagContext(chunks) {
  if (!chunks || chunks.length === 0) return '';
  const lines = chunks.map((c, i) =>
    `[知识${i + 1}] ${c.title}\n${c.content}`
  );
  return `以下是从越剧知识库检索到的相关资料，请结合这些资料回答用户问题，并在回答中用【出处：${chunks.map(c => c.title).join(' / ')}】标注来源：\n\n${lines.join('\n\n')}\n\n---`;
}
