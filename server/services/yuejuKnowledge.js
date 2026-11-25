// 越剧资料检索：分别按关键词和领域概念召回，再合并排序。
// 语料由 scripts/build-yueju-retrieval-corpus.mjs 生成，不修改训练集。
// 这里的领域概念匹配使用本地同义词规则，不调用向量模型。
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import logger from '../utils/logger.js';

const log = logger.module('YUEJU_KB');
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DATA_DIR = path.join(__dirname, '..', '..', 'models', 'yueju_asr_correct', 'data');
const DEFAULT_CORPUS = path.join(DATA_DIR, 'retrieval_corpus.json');
const FALLBACK_CORPUS = path.join(DATA_DIR, 'train.json');
const FACTS_PATH = path.join(DATA_DIR, 'authoritative_facts.json');
const CORPUS_PATH = process.env.YUEJU_KB_PATH || DEFAULT_CORPUS;

const BODY_MATCH_LIMIT = 700;
const INJECT_SNIPPET_LIMIT = 420;
const RECALL_LIMIT = 48;
const DEFAULT_MIN_CONFIDENCE = 0.46;

const STOP_GRAMS = new Set([
  '越剧', '请介', '介绍', '绍越', '关于', '什么', '有哪', '哪些', '怎么', '如何',
  '一下', '是什', '么样', '这个', '那个', '可以', '需要', '我们', '他们', '相关',
  '内容', '方面', '进行', '通过', '以及', '并且', '因此', '所以', '的时', '时候',
  '请说', '说明', '分别', '什么', '关系', '主要', '一个', '两个', '几个',
]);

const TOPIC_RULES = [
  ['heritage', /非物质文化遗产|非遗|传承人|保护单位|第几批/],
  ['origin', /发源|起源|诞生|形成|落地唱书|小歌班|的笃班|绍兴文戏|进入上海|名称演变|最初叫什么|最早|舞台形式/],
  ['vocal', /唱腔|声腔|四工|尺调|弦下|板腔|曲调|演唱|艺术特征|抒情/],
  ['school', /流派|袁派|尹派|范派|傅派|徐派|戚派|王派|毕派|陆派|吕派|金派|张派/],
  ['role', /行当|小生|花旦|老生|老旦|丑行|丑角|净行|女扮男装/],
  ['organization', /剧团|越剧院|小百花|成立|建团/],
  ['play', /剧目|情节|剧情|经典折子|结局|梁山伯与祝英台|梁祝|红楼梦|西厢记|祥林嫂|五女拜寿|何文秀|追鱼|情探/],
  ['person', /人物|演员|艺术家|师承|饰演|创始人|代表人物/],
];

const SEMANTIC_CONCEPTS = [
  ['origin-place', ['发源', '起源', '发源于哪里', '发源地', '起源地', '诞生地', '从哪里发展', '哪个地方', '哪个省份']],
  ['origin-time', ['形成', '诞生', '形成于哪一年', '什么时候形成', '诞生于哪一年', '起源时间', '最早形成']],
  ['history-name', ['最初叫什么', '最早叫什么', '最早的舞台形式', '舞台形式', '早期名称', '名称演变', '曾经叫什么', '进入上海', '绍兴文戏']],
  ['heritage-batch', ['哪一年列入', '第几批', '首批非遗', '国家级非遗', '非物质文化遗产名录']],
  ['vocal-system', ['声腔体系', '唱腔体系', '板腔体系', '主要腔调', '四工腔', '尺调腔', '弦下腔']],
  ['art-features', ['艺术特征', '艺术特点', '审美特点', '表演风格', '以唱为主', '长于抒情']],
  ['school-founder', ['流派创始人', '谁创立', '主要流派', '代表人物', '六个流派']],
  ['role-system', ['主要行当', '角色类型', '小生和花旦', '生旦净丑', '女扮男装']],
  ['play-story', ['主要情节', '故事梗概', '经典折子', '结局是什么', '剧情节点']],
  ['cast-role', ['分别饰演', '塑造什么角色', '演员与角色', '谁演的', '代表演员']],
  ['organization-history', ['哪一年成立', '什么时候建团', '代表剧目', '院团历史']],
];

const ENTITY_ALIASES = [
  ['嵊州', ['嵊州', '嵊县']],
  ['落地唱书', ['落地唱书']],
  ['小歌班', ['小歌班', '的笃班']],
  ['绍兴文戏', ['绍兴文戏', '女子绍兴文戏']],
  ['国家级非遗', ['国家级非物质文化遗产', '国家级非遗', '非遗']],
  ['四工腔', ['四工腔', '四工调', '四工']],
  ['尺调腔', ['尺调腔', '尺调']],
  ['弦下腔', ['弦下腔', '弦下调', '弦下']],
  ['袁派', ['袁派', '袁雪芬']], ['尹派', ['尹派', '尹桂芳']],
  ['范派', ['范派', '范瑞娟']], ['傅派', ['傅派', '傅全香']],
  ['徐派', ['徐派', '徐玉兰']], ['戚派', ['戚派', '戚雅仙']],
  ['王派', ['王派', '王文娟']],
  ['小生', ['小生']], ['花旦', ['花旦', '旦行', '旦角']],
  ['老生', ['老生']], ['丑行', ['丑行', '丑角', '小丑']],
  ['梁祝', ['梁山伯与祝英台', '梁祝', '梁山伯', '祝英台', '十八相送', '楼台会', '化蝶']],
  ['红楼梦', ['红楼梦', '贾宝玉', '林黛玉', '宝玉哭灵', '黛玉葬花']],
  ['西厢记', ['西厢记', '崔莺莺', '张生', '红娘']],
  ['祥林嫂', ['祥林嫂', '祝福']],
  ['浙江小百花', ['浙江小百花越剧团', '浙江小百花', '小百花', '五女拜寿']],
];

const DOMAIN_PATTERN = /越剧|嵊州|嵊县|落地唱书|小歌班|的笃班|绍兴文戏|非遗|唱腔|声腔|流派|行当|小生|花旦|老生|丑行|梁山伯|祝英台|梁祝|红楼梦|西厢记|祥林嫂|五女拜寿|小百花|袁雪芬|尹桂芳|范瑞娟|傅全香|徐玉兰|王文娟|戚雅仙/;

let corpus = null;
let authoritativeFacts = null;
let loadFailed = false;

function cleanText(value) {
  return String(value || '').replace(/\s+/g, ' ').trim();
}

function detectTopics(text) {
  return TOPIC_RULES.filter(([, pattern]) => pattern.test(text)).map(([topic]) => topic);
}

function detectConcepts(text) {
  return SEMANTIC_CONCEPTS
    .filter(([, aliases]) => aliases.some((alias) => text.includes(alias)))
    .map(([concept]) => concept);
}

function detectEntities(text) {
  return ENTITY_ALIASES
    .filter(([, aliases]) => aliases.some((alias) => text.includes(alias)))
    .map(([entity]) => entity);
}

function normalizeDocument(item, index, fallback = false) {
  const title = cleanText(item.title ?? item.instruction);
  const body = cleanText(item.content ?? item.output);
  const combined = `${title}\n${body}`;
  const source = item.source || {
    name: '越韵智传校本越剧语料', url: '', type: 'school_corpus', level: 1,
  };
  return {
    id: item.id || `fallback-${index}`,
    title,
    body,
    matchBody: body.slice(0, BODY_MATCH_LIMIT),
    topics: item.topics || (item.topic ? [item.topic] : detectTopics(combined)),
    entities: item.entities || detectEntities(combined),
    concepts: detectConcepts(combined),
    keywords: item.keywords || [],
    factGroups: item.fact_groups || [],
    source,
    reviewStatus: item.review_status || (fallback ? 'unverified' : 'school_corpus'),
  };
}

function loadCorpus() {
  if (corpus) return corpus;
  if (loadFailed) return [];
  try {
    const selectedPath = fs.existsSync(CORPUS_PATH) ? CORPUS_PATH : FALLBACK_CORPUS;
    const raw = JSON.parse(fs.readFileSync(selectedPath, 'utf8'));
    const fallback = selectedPath === FALLBACK_CORPUS;
    corpus = raw.map((item, index) => normalizeDocument(item, index, fallback)).filter((item) => item.title && item.body);
    log.info(`学校越剧知识库已载入 ${corpus.length} 条检索资料（${fallback ? '原始回退语料' : '净化语料'}）`);
    return corpus;
  } catch (err) {
    log.warn(`知识库载入失败，跳过知识注入: ${err.message}`);
    loadFailed = true;
    corpus = null;
    return [];
  }
}

function loadFacts() {
  if (authoritativeFacts) return authoritativeFacts;
  try {
    authoritativeFacts = JSON.parse(fs.readFileSync(FACTS_PATH, 'utf8'));
  } catch {
    authoritativeFacts = [];
  }
  return authoritativeFacts;
}

function extractGrams(query) {
  const grams = new Set();
  const cleaned = cleanText(query).replace(/[，。、！？；：“”‘’《》（）()[\]{}~!@#$%^&*_+=|\\/<>,.?;:'"-]+/g, ' ');
  for (const token of cleaned.split(' ')) {
    if (!token) continue;
    if (/^[a-zA-Z0-9]+$/.test(token)) {
      if (token.length >= 2) grams.add(token.toLowerCase());
      continue;
    }
    if (token.length === 1) continue;
    for (let i = 0; i + 2 <= token.length; i++) {
      const gram = token.slice(i, i + 2);
      if (!STOP_GRAMS.has(gram)) grams.add(gram);
    }
  }
  return [...grams];
}

function overlapScore(queryValues, docValues) {
  if (!queryValues.length || !docValues.length) return 0;
  const docSet = new Set(docValues);
  const hits = queryValues.filter((value) => docSet.has(value)).length;
  return hits / Math.sqrt(queryValues.length * docSet.size);
}

function factMatchScore(query, fact, topics, entities, concepts) {
  const haystack = `${fact.title} ${(fact.keywords || []).join(' ')} ${(fact.entities || []).join(' ')}`;
  const grams = extractGrams(query);
  const gramHits = grams.filter((gram) => haystack.includes(gram)).length;
  const topicScore = topics.includes(fact.topic) ? 1 : 0;
  const entityScore = overlapScore(entities, detectEntities(haystack));
  const conceptScore = overlapScore(concepts, detectConcepts(haystack));
  const keywordScore = (fact.keywords || []).some((keyword) => query.includes(keyword) || keyword.includes(query)) ? 1 : 0;
  return Math.min(1,
    gramHits / Math.max(2, grams.length) * 0.25
    + topicScore * 0.32
    + entityScore * 0.16
    + conceptScore * 0.15
    + keywordScore * 0.12,
  );
}

function findBestFact(query, topics, entities, concepts) {
  return loadFacts()
    .map((fact) => ({ fact, score: factMatchScore(query, fact, topics, entities, concepts) }))
    .sort((a, b) => b.score - a.score)[0] || null;
}

// 精确事实类查询：年份/批次/成立时间/创始人/名称等，这类问题必须优先权威事实表，
// 避免未复核校本语料（level=1）里的错误年份/错误名称覆盖官方校准事实。
const FACTUAL_QUERY_PATTERNS = [
  /哪一年|何年|什么时候|什么时间|年份|第几批|第.?批|首批|列入|成立|建团|创建|创团|日期/,
  /创始|创立|创建|由谁|谁创立|谁创立的|最初|最早|原名|曾叫|称为什么|叫什么|起源|发源|诞生|形成于/,
];
function isFactualQuery(query, concepts) {
  for (const pattern of FACTUAL_QUERY_PATTERNS) {
    if (pattern.test(query)) return true;
  }
  return (concepts || []).some((c) =>
    ['origin-time', 'origin-place', 'history-name', 'heritage-batch', 'school-founder', 'organization-history'].includes(c)
  );
}

function isDomainQuery(query, topics, entities) {
  return DOMAIN_PATTERN.test(query) || topics.length > 0 || entities.length > 0;
}

// 同一词片只计一次；标题和关键词命中的权重高于正文。
function scoreKeywordMatches(docs, grams) {
  const documentCounts = new Map();
  const matchedDocs = [];

  for (let index = 0; index < docs.length; index++) {
    const doc = docs[index];
    const matches = [];
    for (const gram of grams) {
      let weight;
      if (doc.title.includes(gram)) {
        weight = 3.2;
      } else if (doc.keywords.some((keyword) => keyword.includes(gram))) {
        weight = 2.4;
      } else if (doc.matchBody.includes(gram)) {
        weight = 1;
      } else {
        continue;
      }
      matches.push({ gram, weight });
      documentCounts.set(gram, (documentCounts.get(gram) || 0) + 1);
    }
    if (matches.length) matchedDocs.push({ index, matches });
  }

  return matchedDocs.map(({ index, matches }) => {
    const raw = matches.reduce((sum, match) => {
      const count = documentCounts.get(match.gram) || 0;
      const idf = Math.max(0, Math.log((docs.length + 1) / (count + 1)));
      return sum + idf * match.weight;
    }, 0);
    return { index, raw };
  }).sort((a, b) => b.raw - a.raw);
}

function scoreConceptMatches(docs, topics, entities, concepts) {
  return docs.map((doc, index) => {
    const conceptScore = overlapScore(concepts, doc.concepts);
    const topicScore = overlapScore(topics, doc.topics);
    const entityScore = overlapScore(entities, doc.entities);
    const raw = conceptScore * 0.42 + entityScore * 0.38 + topicScore * 0.2;
    return { index, raw, conceptScore, topicScore, entityScore };
  }).filter((row) => row.raw > 0).sort((a, b) => b.raw - a.raw);
}

/**
 * 评估检索结果是否值得注入。低置信度时返回 eligible=false，默认检索会直接返回空数组。
 */
export function evaluateKnowledgeGate(query, chunks, analysis = {}) {
  if (!chunks?.length) return { eligible: false, confidence: 0, reason: 'no_result', critical_coverage: 0 };
  const topics = analysis.topics || detectTopics(query);
  const entities = analysis.entities || detectEntities(query);
  const concepts = analysis.concepts || detectConcepts(query);
  if (!isDomainQuery(query, topics, entities)) {
    return { eligible: false, confidence: 0, reason: 'out_of_domain', critical_coverage: 0 };
  }

  const bestFact = analysis.bestFact || findBestFact(query, topics, entities, concepts);
  const combined = chunks.map((chunk) => `${chunk.title}\n${chunk.content}`).join('\n');
  let criticalCoverage = 0;
  if (bestFact && bestFact.score >= 0.35 && bestFact.fact.fact_groups?.length) {
    const hit = bestFact.fact.fact_groups.filter((group) => group.some((term) => combined.includes(term))).length;
    criticalCoverage = hit / bestFact.fact.fact_groups.length;
  }

  const top = chunks[0];
  const authority = Math.min(1, Number(top.sourceLevel || 1) / 3);
  const confidence = Math.min(1,
    Number(top.score || 0) * 0.5
    + authority * 0.2
    + (top.entityScore || 0) * 0.12
    + (top.topicScore || 0) * 0.08
    + criticalCoverage * 0.1,
  );
  const eligible = confidence >= DEFAULT_MIN_CONFIDENCE
    && (top.topicScore > 0 || top.entityScore > 0 || (bestFact?.score || 0) >= 0.35)
    && (!(bestFact?.score >= 0.55) || criticalCoverage >= 0.5);
  return {
    eligible,
    confidence: Number(confidence.toFixed(3)),
    reason: eligible ? 'accepted' : 'low_confidence_or_incomplete',
    critical_coverage: Number(criticalCoverage.toFixed(3)),
    matched_fact_id: bestFact?.score >= 0.35 ? bestFact.fact.id : null,
  };
}

/**
 * 混合检索：关键词召回 + 领域语义召回 + 来源/实体/主题重排。
 */
export function retrieveYuejuKnowledge(query, opts = {}) {
  const {
    topK = 3,
    minConfidence = DEFAULT_MIN_CONFIDENCE,
    allowLowConfidence = false,
  } = opts;
  const docs = loadCorpus();
  const normalizedQuery = cleanText(query);
  if (!normalizedQuery || docs.length === 0) return [];

  const grams = extractGrams(normalizedQuery);
  const topics = detectTopics(normalizedQuery);
  const entities = detectEntities(normalizedQuery);
  const concepts = detectConcepts(normalizedQuery);
  if (!isDomainQuery(normalizedQuery, topics, entities) || grams.length === 0) return [];

  const keywordScored = scoreKeywordMatches(docs, grams);
  const semanticScored = scoreConceptMatches(docs, topics, entities, concepts);

  const candidateIds = new Set([
    ...keywordScored.slice(0, RECALL_LIMIT).map((row) => row.index),
    ...semanticScored.slice(0, RECALL_LIMIT).map((row) => row.index),
  ]);
  docs.forEach((doc, index) => {
    if (Number(doc.source.level) >= 2 && (overlapScore(topics, doc.topics) > 0 || overlapScore(entities, doc.entities) > 0)) {
      candidateIds.add(index);
    }
  });

  const keywordMap = new Map(keywordScored.map((row, rank) => [row.index, { ...row, rank }]));
  const semanticMap = new Map(semanticScored.map((row, rank) => [row.index, { ...row, rank }]));
  const maxKeyword = keywordScored[0]?.raw || 1;
  const bestFact = findBestFact(normalizedQuery, topics, entities, concepts);
  const isFactual = isFactualQuery(normalizedQuery, concepts);
  const bestFactHit = !!bestFact && bestFact.score >= 0.35;

  // 精确事实查询：强制把命中的权威事实文档纳入候选（即使关键词/语义召回没召回它），
  // 确保官方校准事实（年份/批次/名称/创始人）顶到最前，不被未复核语料覆盖。
  if (isFactual && bestFactHit && bestFact.fact.id) {
    const factIndex = docs.findIndex((d) => d.id === bestFact.fact.id);
    if (factIndex >= 0) candidateIds.add(factIndex);
  }

  const reranked = [...candidateIds].map((index) => {
    const doc = docs[index];
    const keyword = keywordMap.get(index);
    const semantic = semanticMap.get(index);
    const keywordNorm = keyword ? keyword.raw / maxKeyword : 0;
    const semanticNorm = semantic?.raw || 0;
    const entityScore = semantic?.entityScore || overlapScore(entities, doc.entities);
    const topicScore = semantic?.topicScore || overlapScore(topics, doc.topics);
    const isSelfFact = isFactual && bestFactHit && doc.id === bestFact.fact.id;
    const suppressUnverified = isFactual && Number(doc.source.level || 1) === 1;
    const baseAuthority = Math.min(1, Number(doc.source.level || 1) / 3);
    // 精确事实优先采用已匹配的权威条目，未复核语料不加来源分。
    let authority = baseAuthority;
    if (isSelfFact) authority = 0.5;
    else if (suppressUnverified) authority = 0;
    const titleScore = grams.length ? grams.filter((gram) => doc.title.includes(gram)).length / grams.length : 0;
    const rankFusion = ((keyword ? 1 / (60 + keyword.rank + 1) : 0) + (semantic ? 1 / (60 + semantic.rank + 1) : 0)) * 30;
    const factBoost = isSelfFact ? 0.9 : 0;
    const score = Math.min(1,
      keywordNorm * 0.25
      + semanticNorm * 0.18
      + entityScore * 0.16
      + topicScore * 0.1
      + authority * 0.13
      + titleScore * 0.05
      + rankFusion * 0.06
      + factBoost,
    );
    return { doc, score, keywordNorm, semanticNorm, entityScore, topicScore, authority, isSelfFact };
  }).sort((a, b) => b.score - a.score);

  const chunks = reranked.slice(0, topK).map((row) => ({
    id: row.doc.id,
    title: row.doc.title,
    content: row.doc.body.slice(0, INJECT_SNIPPET_LIMIT),
    score: Number(row.score.toFixed(3)),
    keywordScore: Number(row.keywordNorm.toFixed(3)),
    semanticScore: Number(row.semanticNorm.toFixed(3)),
    entityScore: Number(row.entityScore.toFixed(3)),
    topicScore: Number(row.topicScore.toFixed(3)),
    sourceName: row.doc.source.name,
    sourceUrl: row.doc.source.url,
    sourceType: row.doc.source.type,
    sourceLevel: Number(row.doc.source.level || 1),
    reviewStatus: row.doc.reviewStatus,
    topics: row.doc.topics,
    entities: row.doc.entities,
  }));

  const gate = evaluateKnowledgeGate(normalizedQuery, chunks, { topics, entities, concepts, bestFact });
  const requiredConfidence = Number.isFinite(minConfidence) ? minConfidence : DEFAULT_MIN_CONFIDENCE;
  const accepted = gate.eligible && gate.confidence >= requiredConfidence;
  if (!accepted && !allowLowConfidence) return [];
  return chunks.map((chunk) => ({ ...chunk, confidence: gate.confidence, gateReason: gate.reason, criticalCoverage: gate.critical_coverage }));
}

export function buildKnowledgeContext(chunks) {
  if (!chunks?.length) return '';
  const lines = chunks.map((chunk, index) => {
    const source = chunk.sourceName ? `｜来源：${chunk.sourceName}` : '';
    return `【资料${index + 1}${source}】${chunk.title}\n${chunk.content}`;
  });
  const citations = [...new Set(chunks.map((chunk) => chunk.sourceName || chunk.title))];
  return [
    '以下是“越韵智传”校本知识库检索到的资料。请优先采用来源等级高、已经复核的事实；资料未覆盖的精确年份或人物不要猜测：',
    lines.join('\n\n'),
    `可标注出处：${citations.join(' / ')}`,
  ].join('\n\n');
}

export function getKnowledgeBaseStats() {
  const docs = loadCorpus();
  const bySourceLevel = {};
  for (const doc of docs) {
    const level = String(doc.source.level || 1);
    bySourceLevel[level] = (bySourceLevel[level] || 0) + 1;
  }
  return {
    loaded: docs.length > 0,
    count: docs.length,
    path: CORPUS_PATH,
    bySourceLevel,
    authoritativeFacts: loadFacts().length,
  };
}
