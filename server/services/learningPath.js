// 个性化学习路径推荐服务
// 收集学生学习数据 → LLM 分析薄弱点 → RAG 检索学习资源 → 生成可视化学习路径
import pool from '../db.js';
import { callAgent } from './xingchenWs.js';
import { retrieveKnowledge } from './ragRetrieval.js';
import { parseJsonLoose } from './aiGrade.js';

function parseJsonColumn(value, fallback) {
  if (value == null) return fallback;
  if (typeof value !== 'string') return value;
  try { return JSON.parse(value); } catch { return value; }
}

// 收集学生完整学习数据
async function collectStudentData(userId) {
  // 1. 课程信息
  const [courses] = await pool.query(
    `SELECT c.id, c.title, c.subtitle, c.category
     FROM course_members cm JOIN courses c ON cm.course_id = c.id
     WHERE cm.student_id = ?`,
    [userId]
  );

  // 2. 作业成绩
  const [assignments] = await pool.query(
    `SELECT a.title, a.total_score, s.score, s.status, s.feedback,
            c.title AS course_title
     FROM assignment_submissions s
     JOIN assignments a ON s.assignment_id = a.id
     JOIN courses c ON a.course_id = c.id
     WHERE s.student_id = ?
     ORDER BY s.submitted_at DESC`,
    [userId]
  );

  // 3. 考试成绩 + 题目分析
  const [exams] = await pool.query(
    `SELECT e.title, e.total_score, s.score, s.status, s.answers,
            e.id AS exam_id
     FROM exam_submissions s
     JOIN exams e ON s.exam_id = e.id
     WHERE s.student_id = ?
     ORDER BY s.submitted_at DESC`,
    [userId]
  );

  // 4. 考试错题分析（客观题）
  const wrongQuestions = [];
  for (const exam of exams) {
    if (exam.status !== 'graded' && exam.status !== 'submitted') continue;
    const [questions] = await pool.query(
      'SELECT id, type, content, options, answer, score FROM exam_questions WHERE exam_id = ? ORDER BY sort_order',
      [exam.exam_id]
    );
    const parsedAnswers = parseJsonColumn(exam.answers, {});
    const answers = parsedAnswers && typeof parsedAnswers === 'object' ? parsedAnswers : {};
    for (const q of questions) {
      if (q.type === 'short') continue;
      const correctAns = parseJsonColumn(q.answer, null);
      const userAns = answers[String(q.id)] ?? answers[q.id];
      if (!correctAns || userAns === undefined) continue;
      const ua = Array.isArray(userAns) ? userAns.slice().sort() : [userAns];
      const ca = Array.isArray(correctAns) ? correctAns.slice().sort() : [correctAns];
      const correct = ua.length === ca.length && ua.every((v, i) => String(v) === String(ca[i]));
      if (!correct) {
        wrongQuestions.push({
          exam: exam.title,
          type: q.type,
          content: q.content.slice(0, 60),
          score: q.score,
        });
      }
    }
  }

  // 5. 签到统计
  const [attendance] = await pool.query(
    `SELECT r.status, COUNT(*) AS cnt
     FROM attendance_records r
     JOIN attendances a ON r.attendance_id = a.id
     WHERE r.student_id = ?
     GROUP BY r.status`,
    [userId]
  );
  const attStats = {};
  attendance.forEach(r => { attStats[r.status] = r.cnt; });

  // 6. 学习活跃度（聊天/画板/生图等）
  const [activity] = await pool.query(
    `SELECT
       (SELECT COUNT(*) FROM chat_history WHERE user_id = ?) AS chat_count,
       (SELECT COUNT(*) FROM drawings WHERE user_id = ?) AS draw_count,
       (SELECT COUNT(*) FROM image_history WHERE user_id = ?) AS img_count`,
    [userId, userId, userId]
  );

  return {
    courses,
    assignments,
    exams: exams.map(e => ({ title: e.title, total_score: e.total_score, score: e.score, status: e.status })),
    wrongQuestions,
    attendance: attStats,
    activity: activity[0] || {},
  };
}

// 学习路径生成系统提示词
const PATH_PROMPT = `你是「越韵智传」越剧教学平台的个性化学习顾问。请根据学生的学习数据分析其薄弱点和优势，生成一份个性化学习路径推荐。

输出要求：严格输出 JSON 格式（不要 markdown 代码块标记），结构如下：
{
  "overall_assessment": "总体评价（2-3句话概括学习状态）",
  "strengths": ["优势1", "优势2"],
  "weaknesses": ["薄弱点1", "薄弱点2"],
  "recommendations": [
    {
      "title": "建议标题",
      "description": "详细说明为什么这么建议以及怎么学",
      "priority": "high/medium/low",
      "topic": "相关的越剧主题（如徐派/红楼梦/花旦等）",
      "estimated_time": "建议学习时长（如30分钟）"
    }
  ],
  "next_step": "最紧迫的下一步行动建议（1句话）"
}

注意：
1. recommendations 至少 2 条，最多 5 条，按优先级排序。
2. topic 字段用于后续知识库检索，须是越剧专业术语。
3. 如果学生没有学习数据，建议从越剧基础流派开始学起。
4. 分析要具体，不要泛泛而谈，要结合实际成绩数据。`;

export function buildRuleBasedPath(studentData) {
  const gradedAssignments = studentData.assignments.filter(item => item.status === 'graded' && Number(item.total_score) > 0);
  const gradedExams = studentData.exams.filter(item => item.status === 'graded' && Number(item.total_score) > 0);
  const ratios = [
    ...gradedAssignments.map(item => Number(item.score) / Number(item.total_score)),
    ...gradedExams.map(item => Number(item.score) / Number(item.total_score)),
  ].filter(Number.isFinite);
  const average = ratios.length ? Math.round(ratios.reduce((sum, value) => sum + value, 0) / ratios.length * 100) : null;
  const activityCount = Number(studentData.activity.chat_count || 0)
    + Number(studentData.activity.draw_count || 0)
    + Number(studentData.activity.img_count || 0);
  const attendanceIssues = Number(studentData.attendance.late || 0) + Number(studentData.attendance.absent || 0);

  const strengths = [];
  const weaknesses = [];
  if (average != null && average >= 80) strengths.push(`已批改项目平均达成度约 ${average}%，基础掌握较好`);
  if (activityCount >= 5) strengths.push(`平台学习互动 ${activityCount} 次，主动探索意识较强`);
  if (studentData.courses.length > 0) strengths.push(`已参与 ${studentData.courses.length} 门课程，具备持续学习基础`);
  if (average != null && average < 70) weaknesses.push(`已批改项目平均达成度约 ${average}%，基础知识仍需巩固`);
  if (studentData.wrongQuestions.length > 0) weaknesses.push(`现有 ${studentData.wrongQuestions.length} 道客观错题需要回练`);
  if (attendanceIssues > 0) weaknesses.push(`存在 ${attendanceIssues} 次迟到或缺勤记录，课堂连续性不足`);
  if (activityCount < 3) weaknesses.push('平台练习与问答次数偏少，建议增加主动练习');

  const recommendations = [];
  if (studentData.wrongQuestions.length > 0 || (average != null && average < 70)) {
    recommendations.push({
      title: '完成错题回练与基础复盘',
      description: '先按考试和作业整理错题，写明错误原因，再对照课程资料复习流派、行当与唱腔的核心概念。',
      priority: 'high', topic: '越剧基础知识', estimated_time: '40分钟',
    });
  }
  recommendations.push({
    title: '建立越剧流派比较表',
    description: '选择袁派、尹派、范派、傅派、徐派等代表流派，从创始人、行当、音色、代表剧目四个维度进行比较。',
    priority: recommendations.length ? 'medium' : 'high', topic: '越剧流派', estimated_time: '30分钟',
  });
  recommendations.push({
    title: '结合经典剧目做听辨练习',
    description: '从《梁山伯与祝英台》《红楼梦》等经典剧目中选取唱段，记录人物行当、唱腔情绪和舞台表达。',
    priority: 'medium', topic: '越剧经典剧目', estimated_time: '30分钟',
  });
  if (attendanceIssues > 0) {
    recommendations.push({
      title: '补齐课堂学习记录',
      description: '优先查看缺席课程的课件、作业和讨论内容，并在下一次课前完成一次针对性提问。',
      priority: 'high', topic: '越剧教学', estimated_time: '20分钟',
    });
  }

  const assessment = average == null
    ? `当前已加入 ${studentData.courses.length} 门课程，尚缺少足够的已批改成绩数据。建议先完成基础学习与测验，再持续更新路径。`
    : `当前已批改项目的平均达成度约为 ${average}%。系统已结合课程、错题、出勤和平台活跃度生成本次学习路径。`;

  return {
    overall_assessment: assessment,
    strengths: strengths.slice(0, 3),
    weaknesses: weaknesses.slice(0, 3),
    recommendations: recommendations.slice(0, 5),
    next_step: recommendations[0]?.title || '从越剧流派基础开始学习。',
  };
}

/**
 * 生成个性化学习路径
 * @param {number} userId
 * @returns {Promise<object>} { studentData, path, knowledgeResources }
 */
export async function generateLearningPath(userId) {
  // 1. 收集数据
  const studentData = await collectStudentData(userId);

  // 2. 构造数据分析消息
  const dataText = `学生学情数据：
已选课程：${studentData.courses.map(c => c.title).join('、') || '无'}
作业情况：${studentData.assignments.length} 份
${studentData.assignments.map(a => `  - 《${a.title}》${a.status === 'graded' ? `${a.score}/${a.total_score}分` : a.status}`).join('\n')}
考试情况：${studentData.exams.length} 场
${studentData.exams.map(e => `  - 《${e.title}》${e.status === 'graded' ? `${e.score}/${e.total_score}分` : e.status}`).join('\n')}
错题统计：${studentData.wrongQuestions.length} 道错题
${studentData.wrongQuestions.map(w => `  - [${w.exam}] ${w.type}: ${w.content}(${w.score}分)`).join('\n')}
出勤：出勤${studentData.attendance.present || 0}次，迟到${studentData.attendance.late || 0}次，缺勤${studentData.attendance.absent || 0}次
学习活跃：提问${studentData.activity.chat_count || 0}次，画画${studentData.activity.draw_count || 0}次，生图${studentData.activity.img_count || 0}次`;

  // 3. LLM 分析（指令嵌入 user 消息，避免被星辰 Agent 内置角色覆盖）
  let raw;
  try {
    raw = await callAgent(
      [
        { role: 'user', content: PATH_PROMPT + '\n\n' + dataText },
      ],
      { timeout: 45000, maxTokens: 4096 }
    );
  } catch (err) {
    console.warn('[learningPath] 云端分析不可用，使用本地学情规则生成:', err.message);
    raw = '';
  }

  let path = parseJsonLoose(raw);
  if (!path || typeof path !== 'object') {
    path = buildRuleBasedPath(studentData);
  }

  // 4. RAG 检索学习资源（根据推荐主题）
  const knowledgeResources = [];
  for (const rec of (path.recommendations || []).slice(0, 3)) {
    if (rec.topic) {
      try {
        const chunks = await retrieveKnowledge(rec.topic, { topK: 2, minScore: 0.2 });
        if (chunks.length > 0) {
          knowledgeResources.push({ topic: rec.topic, resources: chunks });
        }
      } catch {}
    }
  }

  return { studentData, path, knowledgeResources };
}
