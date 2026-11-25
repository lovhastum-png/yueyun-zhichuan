// 多智能体协作编排器：调度员 Agent 接收问题 → 路由分发给专家 Agent → 专家处理 → 调度员汇总
// 模式：路由分发式（Orchestrator-Worker）
// 专家：越剧教授(知识RAG) / 学业顾问(成绩作业) / 艺术指导(生图唱腔) / 班主任(签到综合)
// 注意：星辰 Agent 有内置系统角色会覆盖传入 system 消息，故所有指令嵌入 user 消息
import { callAgent } from './xingchenWs.js';
import { retrieveKnowledge, buildRagContext } from './ragRetrieval.js';
import { parseJsonLoose } from './aiGrade.js';
import pool from '../db.js';
import { generateImage as genImg } from './xunfeiImage.js';
import { askYuejuLocal, isYuejuLocalHealthy, shouldUseYuejuLocal } from './yuejuLocalLlm.js';
import { buildKnowledgeFallback } from './xingchenAgent.js';
import { emitPaced } from '../utils/pace.js';

// ============================================================
// 专家 Agent 定义
// ============================================================
export const EXPERTS = {
  professor: {
    key: 'professor',
    name: '越剧教授',
    avatar: '授',
    color: 'cinnabar',
    desc: '越剧历史、流派、剧目、行当、唱腔等专业知识',
    tools: ['query_knowledge'],
  },
  advisor: {
    key: 'advisor',
    name: '学业顾问',
    avatar: '顾',
    color: 'cyan',
    desc: '课程、作业、考试、成绩、错题等学情数据',
    tools: ['query_courses', 'query_assignments', 'query_exams', 'query_grades', 'query_wrong_questions'],
  },
  artist: {
    key: 'artist',
    name: '艺术指导',
    avatar: '艺',
    color: 'ochre',
    desc: 'AI 生图、唱腔模仿、身段表演、舞台艺术指导',
    tools: ['generate_image', 'query_knowledge'],
  },
  mentor: {
    key: 'mentor',
    name: '班主任',
    avatar: '班',
    color: 'ink',
    desc: '签到出勤、学习态度、综合表现、学习路径建议',
    tools: ['query_attendance', 'query_grades'],
  },
};

// ============================================================
// 调度员 Agent：分析问题 → 决定路由给哪些专家
// ============================================================
const ROUTER_DIRECTIVE = `【重要指令】你现在是「越韵智传」平台的多智能体调度系统。你的任务是分析用户问题，决定由哪些专家Agent协作处理。

【可用专家】
1. professor(越剧教授)：处理越剧历史/流派/剧目/行当/唱腔等专业知识问题
2. advisor(学业顾问)：处理课程/作业/考试/成绩/错题等学情数据查询
3. artist(艺术指导)：处理AI生图/唱腔模仿/身段表演/舞台艺术指导
4. mentor(班主任)：处理签到出勤/学习态度/综合表现/学习路径建议

【路由规则】
1. 根据问题内容，选择1-3个最相关的专家。不要选择无关专家。
2. 简单问候或与平台无关的问题，直接回答即可（experts为空数组）。
3. 复杂问题可多专家协作（如"我的成绩如何，哪些流派需要加强"→advisor+professor）。

【输出格式】
仅输出如下JSON（不加解释、不加markdown代码块）：
{"experts": ["专家key1", "专家key2"], "analysis": "一句话分析为什么选这些专家"}

【用户问题】`;

// 解析路由决策
export function parseRouting(text) {
  if (!text) return null;
  const cleaned = text.trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/i, '').trim();
  try {
    const obj = JSON.parse(cleaned);
    if (obj && Array.isArray(obj.experts)) return obj;
  } catch {}
  const match = cleaned.match(/\{[\s\S]*\}/);
  if (match) {
    try {
      const obj = JSON.parse(match[0]);
      if (obj && Array.isArray(obj.experts)) return obj;
    } catch {}
  }
  return null;
}

// 高频场景使用可解释的本地规则路由，外部调度模型不可用时仍能正确分派专家。
export function inferExperts(question) {
  const text = String(question || '').trim();
  if (!text || /^(你好|您好|嗨|hello|hi)[！!。.]?$/.test(text.toLowerCase())) return [];
  const experts = [];
  if (/越剧|流派|剧目|行当|唱腔|袁派|尹派|范派|傅派|徐派|戚派|梁祝|红楼梦|嵊州|非遗/.test(text)) experts.push('professor');
  if (/课程|选课|作业|考试|成绩|平均分|错题|学习情况/.test(text)) experts.push('advisor');
  if (/生成.{0,4}(图片|图像)|画一[张幅]|画个|身段|台步|水袖|舞台动作|表演指导/.test(text)) experts.push('artist');
  if (/签到|出勤|迟到|缺勤|学习路径|学习计划|综合表现/.test(text)) experts.push('mentor');
  return [...new Set(experts)].slice(0, 3);
}

function inferExpertTool(expertKey, question) {
  const text = String(question || '');
  if (expertKey === 'professor') return { name: 'query_knowledge', args: { query: text, topK: 3 } };
  if (expertKey === 'advisor') {
    if (/平均分|成绩|多少分/.test(text)) return { name: 'query_grades', args: {} };
    if (/作业|提交|没交|未交/.test(text)) return { name: 'query_assignments', args: {} };
    if (/考试|测验|开考|交卷/.test(text)) return { name: 'query_exams', args: {} };
    if (/错题/.test(text)) return { name: 'query_wrong_questions', args: {} };
    if (/课程|选课|有哪些课/.test(text)) return { name: 'query_courses', args: {} };
  }
  if (expertKey === 'mentor') {
    if (/签到|出勤|迟到|缺勤/.test(text)) return { name: 'query_attendance', args: {} };
    if (/成绩|综合表现|学习情况/.test(text)) return { name: 'query_grades', args: {} };
  }
  if (expertKey === 'artist') {
    if (/生成.{0,4}(图片|图像)|画一[张幅]|画个/.test(text)) {
      return { name: 'generate_image', args: { prompt: text, style: /工笔/.test(text) ? 'gongbi' : 'ink' } };
    }
    return { name: 'query_knowledge', args: { query: text, topK: 3 } };
  }
  return null;
}

// ============================================================
// 专家 Agent 指令模板
// ============================================================
function buildExpertDirective(expertKey, userQuestion, userId) {
  const expert = EXPERTS[expertKey];
  const toolDesc = {
    query_knowledge: 'query_knowledge(query, topK?) - 检索越剧知识库',
    query_courses: 'query_courses() - 查询学生已选课程',
    query_assignments: 'query_assignments(courseId?, status?) - 查询作业及提交状态',
    query_exams: 'query_exams(courseId?) - 查询考试安排与成绩',
    query_grades: 'query_grades() - 查询成绩汇总与平均分',
    query_wrong_questions: 'query_wrong_questions() - 查询错题',
    query_attendance: 'query_attendance(courseId?) - 查询签到记录',
    generate_image: 'generate_image(prompt, style?, role?) - AI生成越剧图片',
  };
  const availableTools = expert.tools.map(t => toolDesc[t]).filter(Boolean).join('\n');

  return `【重要指令】你现在是「越韵智传」平台的【${expert.name}】专家Agent。你的专长是：${expert.desc}。

【可用工具】
${availableTools}

【工作流程】
1. 若需要查询数据，输出工具调用JSON：{"tool_call": {"name": "工具名", "args": {参数}}}
2. 若信息足够或问题可直接回答，输出专业中文回答（200-500字）。
3. 回答要体现【${expert.name}】的专业视角，结合越剧教学场景。
4. 用真人老师那般自然口语化的方式讲解，语气温和、句子顺口，别机械罗列要点。

【用户问题】${userQuestion}

请以【${expert.name}】的身份处理以上问题。`;
}

// ============================================================
// 工具执行（复用 agentTools 逻辑，精简版）
// ============================================================
async function executeTool(toolName, userId, args = {}) {
  switch (toolName) {
    case 'query_courses': {
      const [rows] = await pool.query(
        `SELECT c.id, c.title, c.subtitle, c.category, u.real_name AS teacher_name,
                (SELECT COUNT(*) FROM course_members WHERE course_id = c.id) AS student_count
         FROM course_members cm JOIN courses c ON cm.course_id = c.id
         JOIN users u ON c.teacher_id = u.id WHERE cm.student_id = ?`,
        [userId]
      );
      return { success: true, summary: rows.length === 0 ? '尚未选课' : `已选${rows.length}门：${rows.map(c => `《${c.title}》`).join('、')}` };
    }
    case 'query_assignments': {
      const [rows] = await pool.query(
        `SELECT a.title, a.total_score, s.status AS sub_status, s.score
         FROM course_members cm JOIN assignments a ON cm.course_id = a.course_id
         LEFT JOIN assignment_submissions s ON a.id = s.assignment_id AND s.student_id = ?
         WHERE cm.student_id = ? ORDER BY a.created_at DESC`,
        [userId, userId]
      );
      return { success: true, summary: rows.length === 0 ? '无作业' : `共${rows.length}份作业：${rows.map(a => `《${a.title}》${a.sub_status || '未提交'}`).join('；')}` };
    }
    case 'query_exams': {
      const [rows] = await pool.query(
        `SELECT e.title, e.total_score, s.status AS sub_status, s.score
         FROM course_members cm JOIN exams e ON cm.course_id = e.course_id
         LEFT JOIN exam_submissions s ON e.id = s.exam_id AND s.student_id = ?
         WHERE cm.student_id = ? ORDER BY e.created_at DESC`,
        [userId, userId]
      );
      return { success: true, summary: rows.length === 0 ? '无考试' : `共${rows.length}场考试：${rows.map(e => `《${e.title}》${e.sub_status || '未开始'}`).join('；')}` };
    }
    case 'query_grades': {
      const [a] = await pool.query(
        'SELECT a.title, a.total_score, s.score FROM assignment_submissions s JOIN assignments a ON s.assignment_id = a.id WHERE s.student_id = ? AND s.status = "graded"',
        [userId]
      );
      const [e] = await pool.query(
        'SELECT e.title, e.total_score, s.score FROM exam_submissions s JOIN exams e ON s.exam_id = e.id WHERE s.student_id = ? AND s.status = "graded"',
        [userId]
      );
      return { success: true, summary: `作业已批改${a.length}份，考试已批改${e.length}份` };
    }
    case 'query_wrong_questions': {
      const [exams] = await pool.query(
        'SELECT e.id, e.title, s.answers FROM exam_submissions s JOIN exams e ON s.exam_id = e.id WHERE s.student_id = ? AND s.status IN ("graded","submitted")',
        [userId]
      );
      let wrongCount = 0;
      for (const exam of exams) {
        const [qs] = await pool.query('SELECT id, type, answer FROM exam_questions WHERE exam_id = ?', [exam.id]);
        const answers = typeof exam.answers === 'string' ? JSON.parse(exam.answers) : (exam.answers || {});
        for (const q of qs) {
          if (q.type === 'short') continue;
          const ca = q.answer ? (typeof q.answer === 'string' ? JSON.parse(q.answer) : q.answer) : null;
          const ua = answers[String(q.id)];
          if (ca && ua !== undefined) {
            const u = Array.isArray(ua) ? ua.sort() : [ua];
            const c = Array.isArray(ca) ? ca.sort() : [ca];
            if (!u.every((v, i) => String(v) === String(c[i]))) wrongCount++;
          }
        }
      }
      return { success: true, summary: `错题${wrongCount}道` };
    }
    case 'query_attendance': {
      const [rows] = await pool.query(
        `SELECT r.status FROM attendance_records r JOIN attendances a ON r.attendance_id = a.id WHERE r.student_id = ?`,
        [userId]
      );
      const stats = { present: 0, late: 0, absent: 0 };
      rows.forEach(r => { stats[r.status] = (stats[r.status] || 0) + 1; });
      return { success: true, summary: `出勤${stats.present}次，迟到${stats.late}次，缺勤${stats.absent}次` };
    }
    case 'query_knowledge': {
      const { query, topK = 3 } = args;
      if (!query) return { success: false, summary: '未提供查询关键词' };
      const chunks = await retrieveKnowledge(query, { topK, minScore: 0.2 });
      return { success: true, summary: chunks.length === 0 ? '未检索到相关知识' : `检索到${chunks.length}条知识：${chunks.map(c => c.title).join('、')}`, chunks };
    }
    case 'generate_image': {
      const { prompt, style = 'ink', role } = args;
      if (!prompt) return { success: false, summary: '未提供生图描述' };
      const result = await genImg({ prompt, style, role });
      return { success: true, summary: `已生成图片：【图片：${result.imageUrl}】`, imageUrl: result.imageUrl };
    }
    default:
      return { success: false, summary: `未知工具：${toolName}` };
  }
}

// 解析工具调用
export function parseToolCall(text) {
  if (!text) return null;
  const cleaned = text.trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/i, '').trim();
  try {
    const obj = JSON.parse(cleaned);
    if (obj && obj.tool_call && obj.tool_call.name) return obj.tool_call;
  } catch {}
  const match = cleaned.match(/\{[\s\S]*"tool_call"[\s\S]*\}/);
  if (match) {
    try {
      const obj = JSON.parse(match[0]);
      if (obj && obj.tool_call && obj.tool_call.name) return obj.tool_call;
    } catch {}
  }
  return null;
}

// ============================================================
// 单个专家处理（含最多2轮工具调用）
// ============================================================
async function runExpert({ expertKey, userQuestion, userId, onToolStart, onToolEnd, onRag }) {
  const expert = EXPERTS[expertKey];
  let messages = [{ role: 'user', content: buildExpertDirective(expertKey, userQuestion, userId) }];
  const maxRounds = 2;
  // 记录本专家生成的图片，便于前端直接展示
  const generatedImages = [];

  const directTool = inferExpertTool(expertKey, userQuestion);
  if (directTool && expert.tools.includes(directTool.name)) {
    if (onToolStart) onToolStart(expertKey, directTool.name, directTool.args, 0);
    let result;
    try {
      result = await executeTool(directTool.name, userId, directTool.args);
    } catch (err) {
      result = { success: false, summary: `工具执行失败：${err.message}` };
    }
    if (onToolEnd) onToolEnd(expertKey, directTool.name, result, 0);
    if (directTool.name === 'query_knowledge' && result.chunks) {
      if (onRag) onRag(expertKey, result.chunks);
      const knowledgeAnswer = buildKnowledgeFallback(userQuestion, result.chunks);
      if (knowledgeAnswer) return knowledgeAnswer;
    }
    return result.summary;
  }

  // ===== 越剧教授专家：优先使用本地微调模型 =====
  // 纯越剧知识问题用本地自研微调模型（体现技术先进性），需要 RAG/工具时降级到讯飞 Agent
  if (expertKey === 'professor' && shouldUseYuejuLocal(userQuestion)) {
    try {
      const healthy = await isYuejuLocalHealthy();
      if (healthy) {
        console.log(`[MultiAgent] 越剧教授 → 路由到本地微调模型`);
        const answer = await askYuejuLocal(userQuestion, { timeout: 20000 });
        if (answer && answer.trim()) {
          return answer;
        }
        console.warn('[MultiAgent] 本地模型返回空，降级到讯飞 Agent');
      } else {
        console.warn('[MultiAgent] 本地模型未就绪，降级到讯飞 Agent');
      }
    } catch (err) {
      console.warn('[MultiAgent] 本地模型调用失败，降级到讯飞 Agent:', err.message);
    }
  }
  // ===== 降级路径：走讯飞 Agent 工具调用流程 =====

  for (let round = 0; round <= maxRounds; round++) {
    let output;
    try {
      output = await callAgent(messages, { timeout: 30000 });
    } catch (err) {
      return `【${expert.name}】处理失败：${err.expose ? err.message : '服务异常'}`;
    }

    const toolCall = parseToolCall(output);
    if (toolCall && expert.tools.includes(toolCall.name)) {
      const { name, args = {} } = toolCall;
      if (onToolStart) onToolStart(expertKey, name, args, round);
      let result;
      try {
        result = await executeTool(name, userId, args);
      } catch (err) {
        result = { success: false, summary: `工具执行失败：${err.message}` };
      }
      if (onToolEnd) onToolEnd(expertKey, name, result, round);
      // 记录生成的图片 URL
      if (name === 'generate_image' && result.imageUrl) {
        generatedImages.push(result.imageUrl);
      }
      // RAG 结果特殊处理
      if (name === 'query_knowledge' && result.chunks && onRag) {
        onRag(expertKey, result.chunks);
      }
      messages.push({ role: 'assistant', content: output });
      messages.push({ role: 'user', content: `[工具${name}返回] ${result.summary}\n\n请基于结果给出专业回答。` });
      continue;
    }
    // 专家最终回答：若生成了图片，在末尾附加图片标记，便于前端渲染
    if (generatedImages.length > 0 && !output.includes('【图片：')) {
      const imageMarks = generatedImages.map(url => `【图片：${url}】`).join('\n');
      return `${output.trim()}\n\n${imageMarks}`;
    }
    return output;
  }
  return `【${expert.name}】处理超时，请稍后重试。`;
}

// ============================================================
// 汇总 Agent：综合各专家回答
// ============================================================
const SUMMARIZER_DIRECTIVE = `【重要指令】你现在是「越韵智传」平台多智能体协作的汇总Agent。多位专家Agent已分别处理了用户问题，请综合他们的回答，给出一份完整、连贯、专业的最终回答。

【要求】
1. 融合各专家观点，去除重复，保持逻辑连贯。
2. 在回答中适当标注信息来源专家（如"据越剧教授介绍…""学业顾问指出…"）。
3. 回答涉及越剧流派/剧目/典籍时，用【出处：xxx】标注。
4. 若专家回答中包含图片标记【图片：/uploads/xxx.jpg】，请务必原样保留，方便前端展示图片。
5. 输出纯中文回答，不要输出JSON或工具调用。`;

// ============================================================
// 多智能体协作主函数
// ============================================================
/**
 * @param {object} params
 * @param {string} params.question - 用户问题
 * @param {number} params.userId - 用户ID
 * @param {function} params.onRouting - 路由决策回调 (routing)
 * @param {function} params.onExpertStart - 专家开始回调 (expertKey)
 * @param {function} params.onExpertEnd - 专家完成回调 (expertKey, answer)
 * @param {function} params.onToolStart - 工具开始回调 (expertKey, toolName, args)
 * @param {function} params.onToolEnd - 工具完成回调 (expertKey, toolName, result)
 * @param {function} params.onRag - RAG检索回调 (expertKey, chunks)
 * @param {function} params.onToken - 最终回答流式回调 (token)
 * @returns {Promise<string>} 最终汇总回答
 */
export async function runMultiAgent({ question, userId, onRouting, onExpertStart, onExpertEnd, onToolStart, onToolEnd, onRag, onToken, onSummarizerStart, onSummarizerEnd }) {
  // 1. 调度员路由决策
  let routing;
  const localExperts = inferExperts(question);
  if (localExperts.length > 0 || /^(你好|您好|嗨|hello|hi)[！!。.]?$/i.test(String(question || '').trim())) {
    routing = { experts: localExperts, analysis: '已根据问题意图完成本地路由' };
  } else {
    try {
      const routerOutput = await callAgent(
        [{ role: 'user', content: ROUTER_DIRECTIVE + question }],
        { timeout: 12000, temperature: 0.3 }
      );
      routing = parseRouting(routerOutput);
    } catch (err) {
      routing = { experts: ['professor'], analysis: '云端路由不可用，默认由越剧教授处理' };
    }
  }

  if (!routing) {
    routing = { experts: ['professor'], analysis: '路由解析失败，默认由越剧教授处理' };
  }
  // 过滤无效专家key
  routing.experts = (routing.experts || []).filter(k => EXPERTS[k]);
  if (routing.experts.length === 0) {
    // 无需专家，直接回答
    if (onRouting) onRouting(routing);
    const direct = '您好，我是越韵智传多智能体助手。您的问题我已收到，但似乎与越剧教学无关。您可以问我越剧知识、课程作业、成绩、生图、签到等问题。';
    await emitPaced(direct, onToken);
    return direct;
  }

  if (onRouting) onRouting(routing);

  // 2. 并行调度各专家（最多3个）
  const expertKeys = routing.experts.slice(0, 3);
  const expertPromises = expertKeys.map(async (key) => {
    if (onExpertStart) onExpertStart(key);
    const answer = await runExpert({
      expertKey: key,
      userQuestion: question,
      userId,
      onToolStart,
      onToolEnd,
      onRag,
    });
    if (onExpertEnd) onExpertEnd(key, answer);
    return { expertKey: key, expertName: EXPERTS[key].name, answer };
  });

  const expertResults = await Promise.all(expertPromises);

  // 3. 汇总 Agent 综合
  const summaryInput = `用户问题：${question}\n\n各专家回答：\n${expertResults.map(r => `【${r.expertName}】：${r.answer}`).join('\n\n')}\n\n请综合以上专家回答，给出完整连贯的最终回答。`;

  if (onSummarizerStart) onSummarizerStart();
  const summarizerStart = Date.now();

  let finalAnswer;
  try {
    finalAnswer = await callAgent(
      [{ role: 'user', content: SUMMARIZER_DIRECTIVE + '\n\n' + summaryInput }],
      { onToken: (token) => { if (onToken) onToken(token); }, timeout: 45000, maxTokens: 4096 }
    );
  } catch (err) {
    // 汇总失败，拼接各专家回答（按打字机节奏放出，保持流式观感）
    finalAnswer = expertResults.map(r => `【${r.expertName}】\n${r.answer}`).join('\n\n---\n\n');
    await emitPaced(finalAnswer, onToken);
  }

  if (onSummarizerEnd) onSummarizerEnd(Date.now() - summarizerStart);

  return finalAnswer;
}
