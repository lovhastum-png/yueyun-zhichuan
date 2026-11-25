// AI 批改服务：向量检索（embedding 语义相似度）+ LLM 语义判定 双重校验
// 用于考试简答题自动批改、作业提交评分建议
import config from '../config.js';
import { callAgent } from './xingchenWs.js';

// ---------- 百炼 embedding 端点（从 ASR URL 推导兼容模式） ----------
function getEmbeddingUrl() {
  const asrUrl = config.qwenAsr.url || '';
  // /compatible-mode/v1/chat/completions → /compatible-mode/v1/embeddings
  if (asrUrl.includes('/chat/completions')) {
    return asrUrl.replace(/\/chat\/completions$/, '/embeddings');
  }
  // 兜底：标准百炼域名
  return 'https://dashscope.aliyuncs.com/compatible-mode/v1/embeddings';
}

/**
 * 批量获取文本向量
 * @param {string[]} texts
 * @returns {Promise<number[][]>} 向量数组
 */
export async function getEmbeddings(texts) {
  const apiKey = config.qwenAsr.apiKey;
  if (!apiKey) throw Object.assign(new Error('未配置 QWEN API Key，无法使用向量检索'), { expose: true });
  const url = getEmbeddingUrl();
  const resp = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model: 'text-embedding-v3',
      input: texts,
    }),
  });
  if (!resp.ok) {
    const t = await resp.text().catch(() => '');
    throw Object.assign(new Error(`向量服务异常(${resp.status})：${t.slice(0, 160)}`), { expose: true });
  }
  const data = await resp.json();
  if (!data.data || !Array.isArray(data.data)) {
    throw Object.assign(new Error('向量服务返回格式异常'), { expose: true });
  }
  // 按 index 排序确保顺序
  return data.data.sort((a, b) => a.index - b.index).map(d => d.embedding);
}

/**
 * 余弦相似度
 */
export function cosineSimilarity(a, b) {
  if (!a || !b || a.length !== b.length) return 0;
  let dot = 0, na = 0, nb = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    na += a[i] * a[i];
    nb += b[i] * b[i];
  }
  return dot / (Math.sqrt(na) * Math.sqrt(nb) + 1e-8);
}

// ---------- JSON 容错解析（含被 max_tokens 截断的修复） ----------
export function parseJsonLoose(text) {
  if (!text) return null;
  let t = text.trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/i, '');
  // 1. 直接解析
  try { return JSON.parse(t); } catch {}
  // 2. 提取首个完整 {...} 片段
  const objMatch = t.match(/\{[\s\S]*\}/);
  if (objMatch) {
    try { return JSON.parse(objMatch[0]); } catch {}
  }
  // 3. 截断修复：JSON 因 max_tokens 超限被截断，尝试逐步闭合
  //    找到首个 { 后，从末尾向前找到最后一个能闭合的 }
  const start = t.indexOf('{');
  if (start === -1) return null;
  const sub = t.slice(start);
  // 用栈匹配，未闭合的 { 和 [ 都补上对应闭合符
  let stack = [];
  let inStr = false, escape = false;
  for (let i = 0; i < sub.length; i++) {
    const c = sub[i];
    if (escape) { escape = false; continue; }
    if (c === '\\') { escape = true; continue; }
    if (c === '"') { inStr = !inStr; continue; }
    if (inStr) continue;
    if (c === '{' || c === '[') stack.push(c);
    else if (c === '}' || c === ']') {
      const top = stack[stack.length - 1];
      if ((c === '}' && top === '{') || (c === ']' && top === '[')) stack.pop();
    }
  }
  if (stack.length > 0) {
    // 还有未闭合的，从末尾倒序补全
    // 但末尾可能是不完整的 value，先尝试截断到最后一个完整的逗号
    let lastComma = -1;
    inStr = false; escape = false; stack = [];
    for (let i = 0; i < sub.length; i++) {
      const c = sub[i];
      if (escape) { escape = false; continue; }
      if (c === '\\') { escape = true; continue; }
      if (c === '"') { inStr = !inStr; continue; }
      if (inStr) continue;
      if (c === '{' || c === '[') stack.push(c);
      else if (c === '}' || c === ']') {
        const top = stack[stack.length - 1];
        if ((c === '}' && top === '{') || (c === ']' && top === '[')) stack.pop();
      } else if (c === ',' && stack.length === 1) {
        // 顶层逗号，记为可截断点
        lastComma = i;
      }
    }
    let repaired = sub;
    if (lastComma > 0) repaired = sub.slice(0, lastComma); // 截到最后一个顶层逗号
    // 去掉可能的尾随逗号和空白
    repaired = repaired.replace(/[\s,]+$/, '');
    // 补全外层闭合
    // 重新计算栈
    stack = [];
    inStr = false; escape = false;
    for (let i = 0; i < repaired.length; i++) {
      const c = repaired[i];
      if (escape) { escape = false; continue; }
      if (c === '\\') { escape = true; continue; }
      if (c === '"') { inStr = !inStr; continue; }
      if (inStr) continue;
      if (c === '{' || c === '[') stack.push(c);
      else if (c === '}' || c === ']') {
        const top = stack[stack.length - 1];
        if ((c === '}' && top === '{') || (c === ']' && top === '[')) stack.pop();
      }
    }
    while (stack.length > 0) {
      const open = stack.pop();
      repaired += (open === '{' ? '}' : ']');
    }
    try { return JSON.parse(repaired); } catch {}
  }
  return null;
}

const JUDGE_PROMPT = `你是「越韵智传」越剧考试简答题阅卷专家，精通越剧流派、剧目、唱腔、行当、历史。
你的任务是判定学生答案的得分。评分原则：
1. 意思相符但表述不同应给分，不要求字面一致。
2. 命中核心要点得 60% 以上，部分命中按比例给分。
3. 完全错误、离题或空白给 0-30%。
4. 严格按要点给分，不得主观抬分或压分。
输出必须是合法 JSON，格式：{"score":数字,"reason":"评分依据(50字内)","key_points":["命中的要点1","命中的要点2"]}
不要附加任何解释或代码块标记。`;

/**
 * LLM 语义判定（用于考试简答题）
 * @returns {Promise<{score, reason, key_points}>}
 */
async function llmGradeShort(question, reference, studentAnswer, maxScore) {
  const userMsg = `请批改以下越剧简答题。

题目：${question}
参考答案：${reference}
学生答案：${studentAnswer || '（未作答）'}
满分：${maxScore}

请按 JSON 格式输出评分结果。`;
  const raw = await callAgent(
    [
      { role: 'system', content: JUDGE_PROMPT },
      { role: 'user', content: userMsg },
    ],
    { timeout: 30000, maxTokens: 2048 }
  );
  console.log('[aiGrade][简答] LLM 原始返回(前300字):', String(raw).slice(0, 300));
  const data = parseJsonLoose(raw);
  console.log('[aiGrade][简答] parseJsonLoose:', data ? `OK, keys=${Array.isArray(data) ? 'array' : Object.keys(data).join(',')}` : 'null');
  if (!data || typeof data !== 'object') {
    return { score: 0, reason: 'AI 判定结果解析失败，建议人工复核', key_points: [] };
  }
  // 字段兼容：LLM 可能返回 comment/explanation 而非 reason
  const reason = data.reason || data.comment || data.explanation || data.评语 || '已评分';
  const keyPoints = Array.isArray(data.key_points)
    ? data.key_points
    : Array.isArray(data.keypoints)
    ? data.keypoints
    : Array.isArray(data.points)
    ? data.points
    : Array.isArray(data.命中要点)
    ? data.命中要点 : [];
  if (typeof data.score !== 'number') {
    return { score: 0, reason: reason !== '已评分' ? reason : 'AI 判定结果解析失败，建议人工复核', key_points: keyPoints };
  }
  // 分数越界修正
  let score = data.score;
  if (score < 0) score = 0;
  if (score > maxScore) score = maxScore;
  return {
    score,
    reason,
    key_points: keyPoints,
  };
}

/**
 * 综合批改一道简答题（向量相似度 + LLM 判定）
 * @param {string} question 题干
 * @param {string} reference 参考答案
 * @param {string} studentAnswer 学生答案
 * @param {number} maxScore 满分
 * @returns {Promise<{score, maxScore, reason, key_points, sim_score, llm_score, confidence, method}>}
 */
export async function gradeShortAnswer(question, reference, studentAnswer, maxScore) {
  maxScore = Number(maxScore) || 5;
  // 空答案直接 0 分
  if (!studentAnswer || !studentAnswer.trim()) {
    return {
      score: 0, maxScore, reason: '未作答', key_points: [],
      sim_score: 0, llm_score: 0, confidence: 1, method: 'empty',
    };
  }

  // 1. 向量相似度（学生答案 vs 参考答案）
  let simScore = 0;
  let method = 'llm_only';
  try {
    const [embRef, embStu] = await getEmbeddings([reference || question, studentAnswer]);
    simScore = Math.max(0, Math.min(1, cosineSimilarity(embRef, embStu)));
    method = 'vector+llm';
  } catch (err) {
    // embedding 不可用时降级为纯 LLM
    console.warn('[aiGrade] embedding 降级，改用纯 LLM:', err.message);
  }

  // 2. LLM 语义判定
  const llmResult = await llmGradeShort(question, reference, studentAnswer, maxScore);
  const llmScore = llmResult.score;

  // 3. 综合给分：LLM 为主(0.7) + 向量相似度为辅(0.3)
  let finalScore;
  if (method === 'vector+llm') {
    finalScore = Math.round((llmScore * 0.7 + simScore * maxScore * 0.3) * 10) / 10;
  } else {
    finalScore = llmScore;
  }
  if (finalScore < 0) finalScore = 0;
  if (finalScore > maxScore) finalScore = maxScore;

  // 4. 置信度：LLM 归一化分 与 向量相似度 的一致性
  const llmNorm = llmScore / maxScore;
  const confidence = method === 'vector+llm'
    ? Math.round((1 - Math.min(1, Math.abs(llmNorm - simScore))) * 100) / 100
    : 0.6; // 纯 LLM 默认中等置信度

  return {
    score: finalScore,
    maxScore,
    reason: llmResult.reason,
    key_points: llmResult.key_points,
    sim_score: Math.round(simScore * 100) / 100,
    llm_score: llmScore,
    confidence,
    method,
  };
}

const ASSIGN_PROMPT = `你是「越韵智传」越剧课程作业评阅专家，精通越剧流派、剧目、唱腔、行当、历史。
依据作业要求评估学生提交质量。评分维度：内容完整性(30%)、专业准确性(30%)、表述质量(20%)、个人见解(20%)。

【输出格式】必须输出一个扁平 JSON 对象（不要嵌套、不要中文字段名、不要 Markdown 代码块、不要解释文字），字段名必须完全是：
{"score":数字,"feedback":"评语","strengths":["亮点1"],"weaknesses":["不足1"]}

【硬性约束】
1. score：0 到满分之间的整数
2. feedback：80 字以内的评语，简明指出优点与改进点
3. strengths：数组，1-3 条亮点，每条不超过 15 字
4. weaknesses：数组，1-3 条不足，每条不超过 15 字
5. 严禁使用"评阅结果"、"总分"、"整体评价"等中文字段名
6. 严禁嵌套结构，必须是扁平的一层 JSON`;

/**
 * 作业提交 AI 评分建议（无标准答案，纯 LLM 评估）
 * @param {object} assignment {title, description, total_score}
 * @param {string} content 学生提交内容
 * @returns {Promise<{score, maxScore, feedback, strengths, weaknesses, confidence}>}
 */
export async function gradeAssignment(assignment, content) {
  const maxScore = Number(assignment.total_score) || 100;
  if (!content || !content.trim()) {
    return {
      score: 0, maxScore, feedback: '未提交内容',
      strengths: [], weaknesses: ['未作答'], confidence: 1,
    };
  }

  const userMsg = `请评阅以下越剧课程作业。

作业标题：${assignment.title}
作业要求：${assignment.description || '（无特定要求）'}
满分：${maxScore}

学生提交内容：
${content}

请按 JSON 格式输出评阅结果。`;

  const raw = await callAgent(
    [
      { role: 'system', content: ASSIGN_PROMPT },
      { role: 'user', content: userMsg },
    ],
    { timeout: 60000, maxTokens: 4096 }
  );
  console.log('[aiGrade][作业] LLM 原始返回(前400字):', String(raw).slice(0, 400));
  console.log('[aiGrade][作业] LLM 返回长度:', String(raw).length);
  const data = parseJsonLoose(raw);
  console.log('[aiGrade][作业] parseJsonLoose:', data ? `OK, keys=${Array.isArray(data) ? 'array' : Object.keys(data).join(',')}` : 'null');
  if (!data || typeof data !== 'object') {
    return {
      score: 0, maxScore,
      feedback: 'AI 评阅结果解析失败，建议人工评阅',
      strengths: [], weaknesses: [], confidence: 0.3,
    };
  }

  // ===== 字段映射（高度兼容 LLM 各种返回结构）=====
  // LLM 常返回嵌套中文结构：{评阅结果: {总分, 整体评价, 分项评价: {...}}}
  // 需要展平并映射到标准 score/feedback/strengths/weaknesses
  const flat = {}; // 展平后的字段集合
  function walk(obj, depth = 0) {
    if (depth > 3 || !obj || typeof obj !== 'object') return;
    for (const [k, v] of Object.entries(obj)) {
      const lk = k.toLowerCase().replace(/[\s_-]/g, '');
      // 分数类字段
      if (/^(score|总分|分数|得分|评分|最终分|finalscore|totalscore)$/i.test(k)) {
        if (typeof v === 'number' && flat.score == null) flat.score = v;
        if (typeof v === 'string' && flat.score == null) {
          const m = v.match(/-?\d+(\.\d+)?/);
          if (m) flat.score = parseFloat(m[0]);
        }
      }
      // 评语类字段
      else if (/^(feedback|comment|评语|整体评价|总体评价|评价|总评|overall|summary|review)$/i.test(k)) {
        if (typeof v === 'string' && v.length > 5) flat.feedback = v;
      }
      // 亮点数组
      else if (/^(strengths|亮点|优点|pros|merits)$/i.test(k)) {
        if (Array.isArray(v)) flat.strengths = v;
      }
      // 不足数组
      else if (/^(weaknesses|不足|缺点|cons|flaws|issues)$/i.test(k)) {
        if (Array.isArray(v)) flat.weaknesses = v;
      }
      // 改进建议
      else if (/^(suggestion|改进建议|建议|improvement|advice)$/i.test(k)) {
        if (typeof v === 'string') flat.suggestion = v;
      }
      // 嵌套对象继续递归
      else if (v && typeof v === 'object' && !Array.isArray(v)) {
        walk(v, depth + 1);
      }
    }
  }
  walk(data);

  let score = flat.score;
  let feedback = flat.feedback || '已评阅';
  if (flat.suggestion) feedback = feedback + '\n\n【改进建议】' + flat.suggestion;

  // 截断过长的 strengths/weaknesses 单项（避免前端 tag 撑爆，最多 30 字）
  const truncateItem = (s) => typeof s === 'string' ? (s.length > 30 ? s.slice(0, 30) + '…' : s) : String(s);
  const strengths = (Array.isArray(flat.strengths) ? flat.strengths
    : Array.isArray(data.strengths) ? data.strengths
    : Array.isArray(data.亮点) ? data.亮点
    : Array.isArray(data.pros) ? data.pros : []).map(truncateItem);
  const weaknesses = (Array.isArray(flat.weaknesses) ? flat.weaknesses
    : Array.isArray(data.weaknesses) ? data.weaknesses
    : Array.isArray(data.不足) ? data.不足
    : Array.isArray(data.cons) ? data.cons : []).map(truncateItem);

  if (score == null || isNaN(score)) {
    return {
      score: 0, maxScore,
      feedback: feedback !== '已评阅' ? feedback : 'AI 评阅结果解析失败，建议人工评阅',
      strengths, weaknesses, confidence: 0.4,
    };
  }
  if (score < 0) score = 0;
  if (score > maxScore) score = maxScore;

  // 作业评阅置信度：基于评语长度与字段完整度
  const fbLen = feedback.length;
  const fieldCount = (feedback ? 1 : 0) + (strengths.length ? 1 : 0) + (weaknesses.length ? 1 : 0);
  const confidence = fbLen >= 80 && fieldCount >= 2 ? 0.8 : fbLen >= 40 ? 0.6 : 0.45;

  return {
    score,
    maxScore,
    feedback,
    strengths,
    weaknesses,
    confidence,
  };
}
