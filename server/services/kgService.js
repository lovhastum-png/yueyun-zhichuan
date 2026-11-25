// 知识图谱查询服务
import pool from '../db.js';

// 实体类型颜色映射（供前端着色）
export const ENTITY_COLORS = {
  person: '#c1272d',    // 朱砂 - 人物
  school: '#3a7d7b',    // 青绿 - 流派
  play: '#a67c52',      // 赭石 - 剧目
  role: '#8b4513',      // 棕色 - 行当
  segment: '#d4a574',   // 浅赭 - 唱段
  concept: '#1a1a1a',   // 墨黑 - 概念
};

export const ENTITY_LABELS = {
  person: '人物',
  school: '流派',
  play: '剧目',
  role: '行当',
  segment: '唱段',
  concept: '概念',
};

/**
 * 获取图谱全局统计
 */
export async function getKgStats() {
  const [entStats] = await pool.query('SELECT type, COUNT(*) as cnt FROM kg_entities GROUP BY type');
  const [relStats] = await pool.query('SELECT relation, COUNT(*) as cnt FROM kg_relations GROUP BY relation ORDER BY cnt DESC');
  const [[{ entityTotal }]] = await pool.query('SELECT COUNT(*) as entityTotal FROM kg_entities');
  const [[{ relTotal }]] = await pool.query('SELECT COUNT(*) as relTotal FROM kg_relations');
  return {
    entityTotal,
    relTotal,
    entityByType: entStats,
    relationByType: relStats,
  };
}

/**
 * 获取图谱数据（全量或按实体类型过滤）
 * 返回 cytoscape.js 格式的 elements
 */
export async function getGraphData(filters = {}) {
  const { entityTypes, maxEntities = 100 } = filters;
  const typeList = entityTypes && entityTypes.length > 0 ? entityTypes : ['person', 'school', 'play', 'role', 'segment', 'concept'];

  // 1. 查询实体（按类型过滤，限制数量，优先选关联度高的）
  const placeholders = typeList.map(() => '?').join(',');
  const [entities] = await pool.query(
    `SELECT e.id, e.name, e.type, e.description,
            (SELECT COUNT(*) FROM kg_relations r WHERE r.head_id = e.id OR r.tail_id = e.id) AS degree
     FROM kg_entities e
     WHERE e.type IN (${placeholders})
     ORDER BY degree DESC, e.id ASC
     LIMIT ?`,
    [...typeList, maxEntities]
  );

  if (entities.length === 0) return { nodes: [], edges: [] };

  const entityIds = entities.map(e => e.id);
  const idMap = new Map(entities.map(e => [e.id, e]));

  // 2. 查询这些实体之间的关系
  const [relations] = await pool.query(
    `SELECT r.id, r.head_id, r.relation, r.tail_id, r.weight
     FROM kg_relations r
     WHERE r.head_id IN (?) AND r.tail_id IN (?)`,
    [entityIds, entityIds]
  );

  // 3. 转 cytoscape 格式
  const nodes = entities.map(e => ({
    data: {
      id: `n${e.id}`,
      name: e.name,
      type: e.type,
      typeLabel: ENTITY_LABELS[e.type] || e.type,
      color: ENTITY_COLORS[e.type] || '#666',
      description: e.description || '',
      degree: e.degree,
    },
  }));

  const edges = relations.map(r => ({
    data: {
      id: `e${r.id}`,
      source: `n${r.head_id}`,
      target: `n${r.tail_id}`,
      label: r.relation,
      weight: r.weight,
    },
  }));

  return { nodes, edges };
}

/**
 * 搜索实体（模糊匹配名称）
 */
export async function searchEntities(keyword, limit = 20) {
  if (!keyword) return [];
  const [rows] = await pool.query(
    `SELECT e.id, e.name, e.type, e.description,
            (SELECT COUNT(*) FROM kg_relations r WHERE r.head_id = e.id OR r.tail_id = e.id) AS degree
     FROM kg_entities e
     WHERE e.name LIKE ?
     ORDER BY degree DESC
     LIMIT ?`,
    [`%${keyword}%`, limit]
  );
  return rows;
}

/**
 * 获取某实体的邻居（1跳关系）
 */
export async function getEntityNeighbors(entityId, depth = 1) {
  const [entity] = await pool.query('SELECT id, name, type, description FROM kg_entities WHERE id = ?', [entityId]);
  if (entity.length === 0) return null;

  // 1跳邻居
  const [neighbors1] = await pool.query(
    `SELECT DISTINCT e.id, e.name, e.type, e.description, r.relation, r.head_id, r.tail_id
     FROM kg_relations r
     JOIN kg_entities e ON (e.id = r.head_id OR e.id = r.tail_id)
     WHERE (r.head_id = ? OR r.tail_id = ?) AND e.id != ?
     LIMIT 50`,
    [entityId, entityId, entityId]
  );

  // 收集所有相关实体ID
  const allIds = new Set([entityId]);
  neighbors1.forEach(n => allIds.add(n.id));

  // 查询这些实体之间的所有关系
  const idArr = [...allIds];
  const [relations] = await pool.query(
    `SELECT r.id, r.head_id, r.relation, r.tail_id
     FROM kg_relations r
     WHERE r.head_id IN (?) AND r.tail_id IN (?)`,
    [idArr, idArr]
  );

  // 构造子图
  const entMap = new Map();
  entMap.set(entity[0].id, entity[0]);
  neighbors1.forEach(n => {
    if (!entMap.has(n.id)) {
      entMap.set(n.id, { id: n.id, name: n.name, type: n.type, description: n.description });
    }
  });

  const nodes = [...entMap.values()].map(e => ({
    data: {
      id: `n${e.id}`,
      name: e.name,
      type: e.type,
      typeLabel: ENTITY_LABELS[e.type] || e.type,
      color: ENTITY_COLORS[e.type] || '#666',
      description: e.description || '',
      isCenter: e.id === entityId,
    },
  }));

  const edges = relations.map(r => ({
    data: {
      id: `e${r.id}`,
      source: `n${r.head_id}`,
      target: `n${r.tail_id}`,
      label: r.relation,
    },
  }));

  return { center: entity[0], nodes, edges };
}

/**
 * 实体详情（含所有关联关系）
 */
export async function getEntityDetail(entityId) {
  const [entity] = await pool.query('SELECT * FROM kg_entities WHERE id = ?', [entityId]);
  if (entity.length === 0) return null;

  // 作为头实体的关系
  const [outRels] = await pool.query(
    `SELECT r.relation, e.id AS tail_id, e.name AS tail_name, e.type AS tail_type
     FROM kg_relations r JOIN kg_entities e ON r.tail_id = e.id
     WHERE r.head_id = ? ORDER BY r.relation`,
    [entityId]
  );
  // 作为尾实体的关系
  const [inRels] = await pool.query(
    `SELECT r.relation, e.id AS head_id, e.name AS head_name, e.type AS head_type
     FROM kg_relations r JOIN kg_entities e ON r.head_id = e.id
     WHERE r.tail_id = ? ORDER BY r.relation`,
    [entityId]
  );

  return {
    entity: entity[0],
    outRelations: outRels.map(r => ({ relation: r.relation, target: { id: r.tail_id, name: r.tail_name, type: r.tail_type } })),
    inRelations: inRels.map(r => ({ relation: r.relation, source: { id: r.head_id, name: r.head_name, type: r.head_type } })),
  };
}

/**
 * GraphRAG：根据查询文本，检索相关实体及其邻居，构造图谱上下文
 * 与向量RAG互补，提供结构化的关系信息
 */
export async function retrieveGraphContext(query, opts = {}) {
  const { maxEntities = 5, maxHops = 1 } = opts;
  if (!query) return { entities: [], relations: [], context: '' };

  // 1. 关键词匹配实体（简单版：用 LIKE 匹配实体名）
  // 提取查询中的候选实体名（2-4字中文词）
  const keywords = extractKeywords(query);
  if (keywords.length === 0) return { entities: [], relations: [], context: '' };

  let matchedEntities = [];
  for (const kw of keywords) {
    const [rows] = await pool.query(
      'SELECT id, name, type, description FROM kg_entities WHERE name LIKE ? LIMIT 5',
      [`%${kw}%`]
    );
    matchedEntities.push(...rows);
  }
  // 去重
  const seen = new Set();
  matchedEntities = matchedEntities.filter(e => {
    if (seen.has(e.id)) return false;
    seen.add(e.id);
    return true;
  }).slice(0, maxEntities);

  if (matchedEntities.length === 0) return { entities: [], relations: [], context: '' };

  // 2. 扩展1跳邻居
  const entityIds = matchedEntities.map(e => e.id);
  const [relations] = await pool.query(
    `SELECT r.relation, h.name AS head_name, h.type AS head_type, t.name AS tail_name, t.type AS tail_type
     FROM kg_relations r
     JOIN kg_entities h ON r.head_id = h.id
     JOIN kg_entities t ON r.tail_id = t.id
     WHERE r.head_id IN (?) OR r.tail_id IN (?)
     LIMIT 30`,
    [entityIds, entityIds]
  );

  // 3. 构造图谱上下文文本
  const entLines = matchedEntities.map(e => `- ${e.name}（${ENTITY_LABELS[e.type] || e.type}）：${e.description || '无描述'}`);
  const relLines = relations.map(r => `- ${r.head_name} --[${r.relation}]--> ${r.tail_name}`);

  const context = `【知识图谱检索】
相关实体：
${entLines.join('\n')}

实体关系：
${relLines.join('\n')}
`;

  return { entities: matchedEntities, relations, context };
}

// 简单关键词提取（中文2-4字）
function extractKeywords(query) {
  const keywords = [];
  // 提取2-4字中文片段
  const matches = query.match(/[\u4e00-\u9fa5]{2,4}/g);
  if (matches) {
    // 去重，去掉太常见的词
    const stopWords = ['什么', '怎么', '特点', '关系', '属于', '以及', '可以', '我们', '他们', '这个', '那个'];
    const unique = [...new Set(matches)].filter(w => !stopWords.includes(w));
    keywords.push(...unique.slice(0, 5));
  }
  return keywords;
}
