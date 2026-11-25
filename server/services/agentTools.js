// Agent 工具集：定义所有可被 LLM 调用的工具 schema + 执行函数
// 每个工具包含：name（名称）、description（描述）、parameters（参数说明）、execute（执行函数）
import pool from '../db.js';
import { retrieveKnowledge } from './ragRetrieval.js';

// ============================================================
// 工具执行函数（每个返回 { success, data, summary }）
// summary 是给 LLM 看的精简文本，data 是结构化数据
// ============================================================

// 1. 查询用户课程
async function queryCourses(userId, args = {}) {
  const [rows] = await pool.query(
    `SELECT c.id, c.title, c.subtitle, c.category, c.status, c.code,
            u.real_name AS teacher_name,
            (SELECT COUNT(*) FROM course_members WHERE course_id = c.id) AS student_count
     FROM course_members cm
     JOIN courses c ON cm.course_id = c.id
     JOIN users u ON c.teacher_id = u.id
     WHERE cm.student_id = ?
     ORDER BY c.created_at DESC`,
    [userId]
  );
  const summary = rows.length === 0
    ? '该学生尚未选任何课程。'
    : `已选 ${rows.length} 门课程：${rows.map(c => `《${c.title}》（教师：${c.teacher_name}，${c.student_count}人选修）`).join('；')}`;
  return { success: true, data: rows, summary };
}

// 2. 查询作业列表（含提交状态）
async function queryAssignments(userId, args = {}) {
  const { courseId, status } = args;
  let sql = `SELECT a.id, a.title, a.total_score, a.due_at, a.course_id,
                    c.title AS course_title,
                    s.status AS sub_status, s.score, s.submitted_at
             FROM course_members cm
             JOIN assignments a ON cm.course_id = a.course_id
             JOIN courses c ON a.course_id = c.id
             LEFT JOIN assignment_submissions s ON a.id = s.assignment_id AND s.student_id = ?
             WHERE cm.student_id = ?`;
  const params = [userId, userId];
  if (courseId) { sql += ' AND a.course_id = ?'; params.push(courseId); }
  sql += ' ORDER BY a.created_at DESC';
  const [rows] = await pool.query(sql, params);

  let filtered = rows;
  if (status === 'unsubmitted') {
    filtered = rows.filter(r => !r.sub_status || r.sub_status === 'pending');
  } else if (status === 'graded') {
    filtered = rows.filter(r => r.sub_status === 'graded');
  }

  const summary = filtered.length === 0
    ? '没有符合条件的作业。'
    : `共 ${filtered.length} 份作业：${filtered.map(a => {
        const st = a.sub_status === 'graded' ? `已批改(${a.score}/${a.total_score}分)` :
                   a.sub_status === 'submitted' ? '已提交待批改' : '未提交';
        const due = a.due_at ? `截止${new Date(a.due_at).toLocaleDateString('zh-CN')}` : '无截止';
        return `《${a.title}》(${st}，${due})`;
      }).join('；')}`;
  return { success: true, data: filtered, summary };
}

// 3. 查询考试安排（含成绩）
async function queryExams(userId, args = {}) {
  const { courseId } = args;
  let sql = `SELECT e.id, e.title, e.total_score, e.duration_min, e.start_at, e.end_at,
                    c.title AS course_title,
                    s.status AS sub_status, s.score
             FROM course_members cm
             JOIN exams e ON cm.course_id = e.course_id
             JOIN courses c ON e.course_id = c.id
             LEFT JOIN exam_submissions s ON e.id = s.exam_id AND s.student_id = ?
             WHERE cm.student_id = ?`;
  const params = [userId, userId];
  if (courseId) { sql += ' AND e.course_id = ?'; params.push(courseId); }
  sql += ' ORDER BY e.created_at DESC';
  const [rows] = await pool.query(sql, params);

  const summary = rows.length === 0
    ? '没有考试安排。'
    : `共 ${rows.length} 场考试：${rows.map(e => {
        const st = e.sub_status === 'graded' ? `已批改(${e.score}/${e.total_score}分)` :
                   e.sub_status === 'submitted' ? '已交卷待批改' :
                   e.sub_status === 'in_progress' ? '答题中' : '未开始';
        return `《${e.title}》(${st})`;
      }).join('；')}`;
  return { success: true, data: rows, summary };
}

// 4. 查询成绩汇总
async function queryGrades(userId, args = {}) {
  // 作业成绩
  const [assignRows] = await pool.query(
    `SELECT a.title, a.total_score, s.score, s.status
     FROM assignment_submissions s
     JOIN assignments a ON s.assignment_id = a.id
     WHERE s.student_id = ? AND s.status = 'graded'
     ORDER BY s.graded_at DESC`,
    [userId]
  );
  // 考试成绩
  const [examRows] = await pool.query(
    `SELECT e.title, e.total_score, s.score, s.status
     FROM exam_submissions s
     JOIN exams e ON s.exam_id = e.id
     WHERE s.student_id = ? AND s.status = 'graded'
     ORDER BY s.submitted_at DESC`,
    [userId]
  );
  // 计算平均分
  const allScores = [
    ...assignRows.map(r => r.score / r.total_score),
    ...examRows.map(r => r.score / r.total_score),
  ];
  const avg = allScores.length > 0
    ? Math.round((allScores.reduce((s, r) => s + r, 0) / allScores.length) * 1000) / 10
    : null;

  const summary = `成绩汇总：作业已批改 ${assignRows.length} 份${
    assignRows.length > 0 ? `（${assignRows.map(a => `${a.title}:${a.score}/${a.total_score}`).join('，')}）` : ''
  }，考试已批改 ${examRows.length} 份${
    examRows.length > 0 ? `（${examRows.map(e => `${e.title}:${e.score}/${e.total_score}`).join('，')}）` : ''
  }${avg !== null ? `，综合平均分 ${avg}%` : '，暂无成绩数据'}`;

  return { success: true, data: { assignments: assignRows, exams: examRows, avgPercent: avg }, summary };
}

// 5. 查询知识库（RAG 检索）
async function queryKnowledge(userId, args = {}) {
  const { query, topK = 3 } = args;
  if (!query) return { success: false, data: null, summary: '未提供查询关键词。' };
  const chunks = await retrieveKnowledge(query, { topK, minScore: 0.2 });
  const summary = chunks.length === 0
    ? `未检索到与"${query}"相关的知识。`
    : `检索到 ${chunks.length} 条相关知识：${chunks.map(c => `${c.title}(相关度${(c.score*100).toFixed(0)}%)`).join('、')}`;
  return { success: true, data: chunks, summary };
}

// 6. AI 生图（返回图片 URL）
async function generateImage(userId, args = {}) {
  const { prompt, style = 'ink', role } = args;
  if (!prompt) return { success: false, data: null, summary: '未提供生图描述。' };
  // 动态导入避免循环依赖
  const { generateImage: genImg } = await import('./xunfeiImage.js');
  const result = await genImg({ prompt, style, role });
  const summary = `已生成图片：【图片：${result.imageUrl}】`;
  return { success: true, data: result, summary, imageUrl: result.imageUrl };
}

// 7. 查询签到记录
async function queryAttendance(userId, args = {}) {
  const { courseId } = args;
  let sql = `SELECT a.title, a.start_at, r.status, r.signed_at,
                    c.title AS course_title
             FROM attendance_records r
             JOIN attendances a ON r.attendance_id = a.id
             JOIN courses c ON a.course_id = c.id
             WHERE r.student_id = ?`;
  const params = [userId];
  if (courseId) { sql += ' AND a.course_id = ?'; params.push(courseId); }
  sql += ' ORDER BY a.start_at DESC LIMIT 20';
  const [rows] = await pool.query(sql, params);

  const stats = { present: 0, late: 0, absent: 0 };
  rows.forEach(r => { stats[r.status] = (stats[r.status] || 0) + 1; });
  const summary = rows.length === 0
    ? '暂无签到记录。'
    : `签到记录 ${rows.length} 次：出勤${stats.present}次，迟到${stats.late}次，缺勤${stats.absent}次`;
  return { success: true, data: { records: rows, stats }, summary };
}

// ============================================================
// 工具注册表（LLM 可见的 schema）
// ============================================================
export const AGENT_TOOLS = [
  {
    name: 'query_courses',
    description: '查询学生已选的所有课程列表，包含课程名称、教师、选修人数等信息。当学生询问"我有哪些课""我的课程"时使用。',
    parameters: {},
    execute: queryCourses,
  },
  {
    name: 'query_assignments',
    description: '查询学生的作业列表及提交状态。可按课程过滤，可按状态（unsubmitted未提交/graded已批改）过滤。当学生问"我有什么作业""作业交了没""未交作业"时使用。',
    parameters: {
      courseId: { type: 'number', description: '课程ID（可选）', required: false },
      status: { type: 'string', description: '过滤状态：unsubmitted(未提交) / graded(已批改)，不传则查全部', required: false },
    },
    execute: queryAssignments,
  },
  {
    name: 'query_exams',
    description: '查询学生的考试安排和成绩。当学生问"有什么考试""考试成绩"时使用。',
    parameters: {
      courseId: { type: 'number', description: '课程ID（可选）', required: false },
    },
    execute: queryExams,
  },
  {
    name: 'query_grades',
    description: '查询学生的所有成绩汇总，包括作业成绩和考试成绩，并计算综合平均分。当学生问"我的成绩""考了多少分""平均分"时使用。',
    parameters: {},
    execute: queryGrades,
  },
  {
    name: 'query_knowledge',
    description: '在越剧知识库中进行语义检索，查找与关键词相关的越剧知识（流派、剧目、行当、历史等）。当学生问越剧专业知识时使用。',
    parameters: {
      query: { type: 'string', description: '查询关键词或问题', required: true },
      topK: { type: 'number', description: '返回结果数量，默认3', required: false },
    },
    execute: queryKnowledge,
  },
  {
    name: 'generate_image',
    description: '根据文字描述生成越剧主题的图片。当学生说"画一张""生成图片"时使用。',
    parameters: {
      prompt: { type: 'string', description: '图片描述', required: true },
      style: { type: 'string', description: '风格：ink(水墨)/gongbi(工笔)/realistic(写实)，默认ink', required: false },
      role: { type: 'string', description: '行当：生/旦/净/丑（可选）', required: false },
    },
    execute: generateImage,
  },
  {
    name: 'query_attendance',
    description: '查询学生的签到记录和出勤统计。当学生问"签到""出勤""点名"时使用。',
    parameters: {
      courseId: { type: 'number', description: '课程ID（可选）', required: false },
    },
    execute: queryAttendance,
  },
];

// 工具名称 → 执行函数的映射
export const TOOL_MAP = Object.fromEntries(AGENT_TOOLS.map(t => [t.name, t.execute]));

// 构建工具说明文本（拼入 system prompt）
export function buildToolsDescription() {
  const lines = AGENT_TOOLS.map(t => {
    const params = Object.entries(t.parameters).map(([k, v]) =>
      `${k}${v.required ? '(必填)' : '(选填)'}:${v.description}`
    ).join(', ');
    return `- ${t.name}：${t.description}${params ? `\n  参数：${params}` : ''}`;
  });
  return lines.join('\n');
}
