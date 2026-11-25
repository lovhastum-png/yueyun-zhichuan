// AI 辅助出题 + AI 自动批改路由
// 复用讯飞星辰助手 Agent（与智能问答同一 API）+ 百炼 embedding 向量检索
import { Router } from 'express';
import pool from '../db.js';
import { authRequired, requireRole } from '../middleware/auth.js';
import { success, fail, asyncHandler } from '../middleware/error.js';
import { callAgent } from '../services/xingchenWs.js';
import { gradeShortAnswer, gradeAssignment } from '../services/aiGrade.js';

const router = Router();
router.use(authRequired, requireRole('teacher'));

// 越剧出题专家系统提示
const EXPERT_PROMPT = `你是「越韵智传」越剧教学辅助系统的资深越剧出题专家，精通越剧历史、十二大流派（袁、尹、范、傅、徐、戚、王、毕、陆、吕、金、张）、经典剧目、行当唱腔与非遗文化。
你的任务是协助高校教师设计越剧课程作业与试卷，题目须专业、准确、有教学价值。
出题要求：
1. 题目内容准确无歧义，选项间有明显区分度，干扰项要有迷惑性但不可模棱两可。
2. 答案与解析须基于权威越剧史料，不得臆造剧目、流派或人物。
3. 严格按用户指定的题型与数量出题，输出必须为合法 JSON，禁止附加任何解释性文字或 Markdown 代码块标记。
4. 选项为数组，如 ["A. 选项一", "B. 选项二", ...]；答案对单选/判断为索引（整数），多选为索引数组，简答为参考答案文本。`;

// 解析 AI 返回的 JSON（容错：去代码块、提取花括号/方括号片段）
function parseJsonLoose(text) {
  if (!text) return null;
  let t = text.trim();
  // 去 markdown 代码块
  t = t.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/i, '');
  try { return JSON.parse(t); } catch {}
  // 尝试提取首个 JSON 对象或数组
  const arrMatch = t.match(/\[[\s\S]*\]/);
  if (arrMatch) {
    try { return JSON.parse(arrMatch[0]); } catch {}
  }
  const objMatch = t.match(/\{[\s\S]*\}/);
  if (objMatch) {
    try { return JSON.parse(objMatch[0]); } catch {}
  }
  return null;
}

// 安全解析 exam_questions.answer / options 字段
// 数据库中可能是 JSON 字符串（如 '["选项A"]'）或纯文本（如简答题参考答案），需兼容
function safeParseAnswer(v) {
  if (v == null) return null;
  if (typeof v !== 'string') return v;
  try { return JSON.parse(v); } catch { return v; } // 解析失败时把原字符串作为值返回
}

// ---------- 生成作业描述 ----------
// body: { courseId, topic, requirements, type }
//   type: 'listen' 听辨 / 'analysis' 唱段分析 / 'essay' 论述 / 'research' 文献调研 / 自定义
router.post('/assignment', asyncHandler(async (req, res) => {
  const { courseId, topic, requirements, type } = req.body || {};
  if (!topic) return fail(res, '请输入作业主题', 400, 400);

  // 取课程标题/描述作为上下文
  let courseCtx = '';
  if (courseId) {
    const [c] = await pool.query('SELECT title, subtitle, description FROM courses WHERE id = ? AND teacher_id = ?', [courseId, req.user.id]);
    if (c.length) courseCtx = `课程：《${c[0].title}》${c[0].subtitle || ''}\n课程简介：${c[0].description || '（无）'}`;
  }

  const typeHint = {
    listen: '听辨练习（聆听音频并判定流派/唱段）',
    analysis: '唱段分析（分析唱腔特征、流派归属、艺术处理）',
    essay: '论述题（结合理论与实例展开论述）',
    research: '文献调研（查阅资料并整理成报告）',
  }[type] || type || '综合练习';

  const userMsg = `请为以下越剧课程设计一份作业。
${courseCtx || '（未指定课程，请按通用越剧教学设计）'}

作业主题：${topic}
作业类型：${typeHint}
教师额外要求：${requirements || '无'}

【输出要求】必须输出一个 JSON 对象（不是数组），严格使用以下字段：
{
  "title": "作业标题（不超过 30 字，凝练有文化感）",
  "description": "作业详细描述，含背景说明、具体任务、提交要求，200-400 字，可用 \\n 换行分段",
  "total_score": 100,
  "suggested_questions": ["建议学生思考的子任务要点1", "要点2", "要点3"]
}

注意：suggested_questions 是对象内的一个字段，不要把整个输出写成数组。第一个字符必须是 {。只输出 JSON，不要任何解释或代码块标记。`;

  let raw;
  try {
    raw = await callAgent(
      [
        { role: 'system', content: EXPERT_PROMPT },
        { role: 'user', content: userMsg },
      ],
      { timeout: 45000 }
    );
  } catch (err) {
    return fail(res, err.expose ? err.message : 'AI 服务暂时不可用', 502, 502);
  }

  let data = parseJsonLoose(raw);
  // 兜底：若 AI 错误地返回了数组，转化为对象
  if (Array.isArray(data)) {
    data = {
      title: topic,
      description: `本作业围绕「${topic}」展开，要求学生结合所学流派理论与剧目实例进行深入分析。`,
      total_score: 100,
      suggested_questions: data.filter(x => typeof x === 'string'),
    };
  }
  if (!data || typeof data !== 'object') return fail(res, 'AI 返回内容无法解析，请重试', 502, 502);
  // 字段兜底
  if (!data.title) data.title = `作业·${topic}`;
  if (!data.description) data.description = `请围绕「${topic}」完成本次作业。`;
  if (!data.total_score) data.total_score = 100;
  if (!Array.isArray(data.suggested_questions)) data.suggested_questions = [];
  return success(res, data, '作业已生成');
}));

// ---------- 生成考试题目 ----------
// body: { courseId, topic, types: {single, multiple, judge, short}, difficulty, count }
//   difficulty: 'easy' | 'medium' | 'hard'
router.post('/exam', asyncHandler(async (req, res) => {
  const { courseId, topic, types, difficulty = 'medium' } = req.body || {};
  if (!topic) return fail(res, '请输入考试主题', 400, 400);

  const t = types || {};
  const single = Math.max(0, parseInt(t.single || 0, 10));
  const multiple = Math.max(0, parseInt(t.multiple || 0, 10));
  const judge = Math.max(0, parseInt(t.judge || 0, 10));
  const short = Math.max(0, parseInt(t.short || 0, 10));
  const total = single + multiple + judge + short;
  if (total === 0) return fail(res, '请至少选择一种题型', 400, 400);
  if (total > 20) return fail(res, '单次生成不超过 20 道题目', 400, 400);

  let courseCtx = '';
  if (courseId) {
    const [c] = await pool.query('SELECT title, subtitle, description FROM courses WHERE id = ? AND teacher_id = ?', [courseId, req.user.id]);
    if (c.length) courseCtx = `课程：《${c[0].title}》${c[0].subtitle || ''}\n课程简介：${c[0].description || '（无）'}`;
  }

  const diffHint = { easy: '基础识记', medium: '理解应用', hard: '综合分析' }[difficulty] || '理解应用';

  const userMsg = `请为以下越剧课程设计一套试卷题目。
${courseCtx || '（未指定课程，请按通用越剧教学设计）'}

考试主题：${topic}
难度要求：${diffHint}
题型与数量：
- 单选题（single）：${single} 道，4 个选项，答案为正确选项的索引（0-3）
- 多选题（multiple）：${multiple} 道，4-6 个选项，答案为所有正确选项的索引数组
- 判断题（judge）：${judge} 道，选项固定为 ["正确", "错误"]，答案为 0 或 1
- 简答题（short）：${short} 道，答案为参考答案文本（150-300 字）

出题原则：
1. 题目覆盖越剧流派、剧目、行当、唱腔、名伶、历史等知识点，避免重复。
2. 选项顺序随机，正确答案不要集中在同一位置。
3. 简答题须给出要点清晰的参考答案。

请输出 JSON 数组，每个元素格式：
{
  "type": "single|multiple|judge|short",
  "content": "题干文本",
  "options": ["A. 选项一", "B. 选项二", ...],   // 简答题为 null
  "answer": 0,                                    // 单选/判断：整数；多选：数组如 [0,2]；简答：参考答案字符串
  "score": 5,                                     // 单选/判断默认 5 分，多选 8 分，简答 20 分
  "analysis": "答案解析（简要说明）"
}
只输出 JSON 数组，不要任何解释。`;

  let raw;
  try {
    raw = await callAgent(
      [
        { role: 'system', content: EXPERT_PROMPT },
        { role: 'user', content: userMsg },
      ],
      { timeout: 60000 }
    );
  } catch (err) {
    return fail(res, err.expose ? err.message : 'AI 服务暂时不可用', 502, 502);
  }

  let questions = parseJsonLoose(raw);
  if (!Array.isArray(questions)) {
    // 兼容 {questions: [...]} 形式
    if (questions && Array.isArray(questions.questions)) questions = questions.questions;
    else return fail(res, 'AI 返回内容无法解析，请重试', 502, 502);
  }

  // 规范化字段
  questions = questions.map(q => {
    const score = q.score ?? (q.type === 'multiple' ? 8 : q.type === 'short' ? 20 : 5);
    let answer = q.answer;
    // 简答题答案统一为数组（与手动添加保持一致）
    if (q.type === 'short' && typeof answer === 'string') answer = [answer];
    // 选项去除前缀（如 "A. xxx" → "xxx"）由前端按需处理，这里保留原样
    return {
      type: q.type,
      content: q.content,
      options: q.options || (q.type === 'short' ? null : []),
      answer,
      score,
      analysis: q.analysis || '',
    };
  });

  return success(res, { questions, count: questions.length }, `已生成 ${questions.length} 道题目`);
}));

// ============================================================
// AI 自动批改：考试简答题（向量检索 + LLM 双判定）
// POST /api/ai-assist/grade/exam/:submissionId
//   body: { autoCommit?: boolean }  是否自动写入分数
// 返回：{ objectiveScore, shortResults:[...], totalScore, maxScore, confidence }
// ============================================================
router.post('/grade/exam/:submissionId', asyncHandler(async (req, res) => {
  const { submissionId } = req.params;
  const { autoCommit } = req.body || {};

  // 校验：必须是该考试所属课程的教师
  const [rows] = await pool.query(
    `SELECT s.id, s.exam_id, s.student_id, s.answers, s.score AS old_score, s.status,
            e.course_id, c.teacher_id, e.title AS exam_title
     FROM exam_submissions s
     JOIN exams e ON s.exam_id = e.id
     JOIN courses c ON e.course_id = c.id
     WHERE s.id = ?`,
    [submissionId]
  );
  if (rows.length === 0) return fail(res, '提交记录不存在', 404, 404);
  const sub = rows[0];
  if (sub.teacher_id !== req.user.id) return fail(res, '无权操作', 403, 403);
  if (sub.status !== 'submitted' && sub.status !== 'graded') {
    return fail(res, '该提交尚未交卷，无法批改', 400, 400);
  }

  const [questions] = await pool.query(
    'SELECT * FROM exam_questions WHERE exam_id = ? ORDER BY sort_order ASC, id ASC',
    [sub.exam_id]
  );
  // 答案字段可能被写入过非 JSON 的脏数据，直接 JSON.parse 会让整次批改报 500。
  // 解析失败或结果不是对象时退化为空答案集合，批改仍可继续。
  const parsedAnswers = safeParseAnswer(sub.answers);
  const answers = (parsedAnswers && typeof parsedAnswers === 'object' && !Array.isArray(parsedAnswers))
    ? parsedAnswers
    : {};

  // 1. 计算客观题分数（single/multiple/judge）
  let objectiveScore = 0;
  let maxObjective = 0;
  for (const q of questions) {
    if (q.type === 'short') continue;
    maxObjective += q.score;
    const userAns = answers[String(q.id)] ?? answers[q.id];
    const correctAns = safeParseAnswer(q.answer);
    let correct = false;
    if (correctAns && Array.isArray(correctAns)) {
      const ua = Array.isArray(userAns) ? userAns.slice().sort() : (userAns !== undefined && userAns !== null ? [userAns] : []);
      const ca = correctAns.slice().sort();
      if (q.type === 'multiple') {
        correct = ua.length === ca.length && ua.every((v, i) => String(v) === String(ca[i]));
      } else {
        correct = ua.length === 1 && String(ua[0]) === String(ca[0]);
      }
    }
    if (correct) objectiveScore += q.score;
  }

  // 2. AI 批改每道简答题
  const shortResults = [];
  let shortScore = 0;
  let maxShort = 0;
  let sumConfidence = 0;
  let shortCount = 0;

  for (const q of questions) {
    if (q.type !== 'short') continue;
    maxShort += q.score;
    shortCount++;
    const refAnswer = safeParseAnswer(q.answer);
    const refText = Array.isArray(refAnswer) ? refAnswer.join('；') : (refAnswer || '');
    const stuAns = answers[String(q.id)] ?? answers[q.id];
    const stuText = Array.isArray(stuAns) ? stuAns.join('；') : (stuAns || '');

    try {
      const result = await gradeShortAnswer(q.content, refText, stuText, q.score);
      shortResults.push({
        questionId: q.id,
        content: q.content,
        reference: refText,
        studentAnswer: stuText,
        maxScore: q.score,
        ...result,
      });
      shortScore += result.score;
      sumConfidence += result.confidence;
    } catch (err) {
      shortResults.push({
        questionId: q.id,
        content: q.content,
        reference: refText,
        studentAnswer: stuText,
        maxScore: q.score,
        score: 0,
        reason: 'AI 批改失败：' + (err.expose ? err.message : '服务异常'),
        key_points: [],
        sim_score: 0,
        llm_score: 0,
        confidence: 0,
        method: 'error',
      });
    }
  }

  const totalScore = Math.round((objectiveScore + shortScore) * 10) / 10;
  const maxScore = maxObjective + maxShort;
  const avgConfidence = shortCount > 0 ? Math.round((sumConfidence / shortCount) * 100) / 100 : 1;

  // 3. 可选：自动写入分数（低置信度仍写入但标记 status=submitted 待复核）
  if (autoCommit) {
    const newStatus = avgConfidence >= 0.6 ? 'graded' : 'submitted';
    // 把 AI 批改明细存入 answers JSON 的 _ai_grade 字段
    const enrichedAnswers = { ...answers, _ai_grade: { shortResults, objectiveScore, shortScore, totalScore, gradedAt: new Date().toISOString() } };
    await pool.query(
      'UPDATE exam_submissions SET answers = ?, score = ?, status = ? WHERE id = ?',
      [JSON.stringify(enrichedAnswers), totalScore, newStatus, submissionId]
    );
  }

  return success(res, {
    submissionId: Number(submissionId),
    examTitle: sub.exam_title,
    objectiveScore,
    maxObjective,
    shortScore: Math.round(shortScore * 10) / 10,
    maxShort,
    totalScore,
    maxScore,
    confidence: avgConfidence,
    needReview: avgConfidence < 0.6,
    shortResults,
    autoCommit: !!autoCommit,
  }, avgConfidence >= 0.6 ? `AI 批改完成，总分 ${totalScore}/${maxScore}` : `AI 批改完成但置信度较低，建议人工复核`);
}));

// ============================================================
// AI 作业评分建议（纯 LLM 评估，无标准答案）
// POST /api/ai-assist/grade/assignment/:submissionId
//   body: { autoCommit?: boolean, score?, feedback? }
// 返回：{ score, maxScore, feedback, strengths, weaknesses, confidence }
// ============================================================
router.post('/grade/assignment/:submissionId', asyncHandler(async (req, res) => {
  const { submissionId } = req.params;
  const { autoCommit } = req.body || {};

  const [rows] = await pool.query(
    `SELECT s.id, s.content, s.attachment, s.score AS old_score, s.status,
            a.id AS assignment_id, a.title, a.description, a.total_score,
            c.teacher_id
     FROM assignment_submissions s
     JOIN assignments a ON s.assignment_id = a.id
     JOIN courses c ON a.course_id = c.id
     WHERE s.id = ?`,
    [submissionId]
  );
  if (rows.length === 0) return fail(res, '提交记录不存在', 404, 404);
  const sub = rows[0];
  if (sub.teacher_id !== req.user.id) return fail(res, '无权操作', 403, 403);
  if (sub.status !== 'submitted' && sub.status !== 'graded') {
    return fail(res, '该提交尚未提交，无法评阅', 400, 400);
  }

  const result = await gradeAssignment(
    { title: sub.title, description: sub.description, total_score: sub.total_score },
    sub.content || ''
  );

  if (autoCommit) {
    const newStatus = result.confidence >= 0.6 ? 'graded' : 'submitted';
    await pool.query(
      `UPDATE assignment_submissions SET score = ?, feedback = ?, status = ?, graded_at = NOW() WHERE id = ?`,
      [result.score, result.feedback + '\n\n[本评语由 AI 生成，教师可修改]', newStatus, submissionId]
    );
  }

  return success(res, {
    submissionId: Number(submissionId),
    assignmentTitle: sub.title,
    ...result,
    autoCommit: !!autoCommit,
  }, result.confidence >= 0.6 ? `AI 评阅完成，建议得分 ${result.score}/${result.maxScore}` : 'AI 评阅完成但置信度较低，建议人工复核');
}));

export default router;
