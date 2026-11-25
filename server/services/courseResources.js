// ============================================================
// PDF 导入课程 · AI 教学资源一条龙生成
// ------------------------------------------------------------
// 在课程导入（OCR→章节→卡片→基线判断题）之后追加生成：
//   1. 教案（plan）        → course_resources(type='plan')
//   2. PPT 课件（slides）  → course_resources(type='slides')，HTML 预览与 .pptx 导出共用 schema
//   3. 知识图谱（graph）   → kg_entities / kg_relations（source_id='course:{id}'）
//   4. AI 题目（quizai）   → 追加进课程第一个 exam（single/multiple）
// 统一走星辰大模型 callAgent + parseJsonLoose（复用 singingEval/aiFeedback 模式），
// 每步独立容错：失败 throw 由调用方 catch 记 warnings，不阻断主流程。
// ============================================================
import pptxgen from 'pptxgenjs';
import path from 'path';
import { existsSync } from 'fs';
import { fileURLToPath } from 'url';
import pool from '../db.js';
import { callAgent } from './xingchenWs.js';
import { parseJsonLoose } from './aiGrade.js';

// ---------- 文本预算（OCR 全文可能 10w+ 字，必须截断） ----------
const BUDGET = { plan: 9000, slides: 0, graph: 12000, quiz: 6000 }; // slides 只喂章节摘要，不吃全文
const MAX_CHAPTERS = 14;
const MAX_SLIDES_PAGES = 16;
const MAX_KG_ENTITIES = 40;
const MAX_KG_RELATIONS = 60;
const MAX_QUIZ_AI = 8;
const projectRoot = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const SLIDE_IMAGE_DIR = path.join(projectRoot, 'data', 'course-slide-images');
const PPT_WIDTH = 10;
const PPT_HEIGHT = 5.625;

function safeSlideImagePath(courseId, fileName) {
  if (!/^[a-f0-9-]{20,64}\.(png|jpg|webp)$/.test(String(fileName || ''))) return null;
  const filePath = path.join(SLIDE_IMAGE_DIR, String(courseId), fileName);
  return existsSync(filePath) ? filePath : null;
}

function slideImageBox(image) {
  const w = Math.max(0.8, Math.min(PPT_WIDTH, Number(image?.w) || 3));
  const h = Math.max(0.6, Math.min(PPT_HEIGHT, Number(image?.h) || 2.1));
  return {
    x: Math.max(0, Math.min(PPT_WIDTH - w, Number(image?.x) || 0)),
    y: Math.max(0, Math.min(PPT_HEIGHT - h, Number(image?.y) || 0)),
    w, h,
  };
}

// 头尾拼接 + 等距采样截断：保开头（概论）与结尾（总结），中段均匀采样
function clipText(text, maxChars) {
  const t = String(text || '').replace(/\s+/g, ' ').trim();
  if (t.length <= maxChars) return t;
  const headLen = Math.floor(maxChars * 0.55);
  const tailLen = Math.floor(maxChars * 0.25);
  const midLen = maxChars - headLen - tailLen;
  const midStart = Math.floor((t.length - midLen) / 2);
  return [
    t.slice(0, headLen),
    t.slice(midStart, midStart + midLen),
    t.slice(t.length - tailLen),
  ].join('……');
}

// 章节摘要：每章 title + body 前 N 字
function chapterDigest(chapters, perChapter, maxChapters = MAX_CHAPTERS) {
  return (chapters || []).slice(0, maxChapters).map((ch, i) => {
    const body = String(ch.body || '').replace(/\s+/g, ' ').trim().slice(0, perChapter);
    return `第${i + 1}章《${ch.title}》：${body}${(ch.body || '').length > perChapter ? '……' : ''}`;
  }).join('\n');
}

// 统一 LLM→JSON：callAgent + parseJsonLoose，失败 throw
async function callAgentJson(system, user, { timeout = 120000 } = {}) {
  const raw = await callAgent(
    [
      { role: 'system', content: system },
      { role: 'user', content: user },
    ],
    { timeout }
  );
  const data = parseJsonLoose(raw);
  if (!data || typeof data !== 'object') throw new Error('AI 返回内容无法解析为 JSON');
  return data;
}

// ============================================================
// 一、教案生成
// ============================================================
const PLAN_PROMPT = `你是「越韵智传」平台的越剧教研专家，为教师撰写结构完整的中文教案。
你会收到课程的章节结构与文本节选，请据此撰写教案。

【硬性约束】
1. 只依据提供的材料，不得编造材料中不存在的剧目、人物、流派。
2. objectives 3-5 条；key_points 与 difficulties 各 2-4 条；sessions 按内容体量给 2-4 课时；process 4-8 个环节；homework 2-3 项（含赏析/实践类）。
3. process 各环节的 minutes 为 5-30 的整数，且总和约等于课时数×45。
4. 输出必须是合法 JSON（不要 markdown 代码块、不要任何解释文字）：
{"course_title":"课程名","objectives":["教学目标1","教学目标2"],"key_points":["重点1"],"difficulties":["难点1"],"sessions":[{"no":1,"title":"课时主题","chapter_refs":"第1-2章","minutes":45}],"process":[{"phase":"导入","minutes":5,"activity":"教师活动描述","design_intent":"设计意图"}],"homework":["作业1"]}`;

export async function genLessonPlan({ courseTitle, category, chapters, fullText }) {
  const userMsg = [
    `课程《${courseTitle}》（分类：${category || '越剧知识'}），共 ${(chapters || []).length} 章。`,
    `章节结构：\n${chapterDigest(chapters, 400)}`,
    `\n文本节选：\n${clipText(fullText, BUDGET.plan)}`,
    '\n请按 JSON 格式输出教案。',
  ].join('\n');
  const data = await callAgentJson(PLAN_PROMPT, userMsg);
  return sanitizePlan(data);
}

function sanitizePlan(d) {
  const arr = (v, n) => (Array.isArray(v) ? v.map((x) => String(x || '').trim()).filter(Boolean).slice(0, n) : []);
  const sessions = (Array.isArray(d.sessions) ? d.sessions : []).map((s, i) => ({
    no: Number(s.no) || i + 1,
    title: String(s.title || `第${i + 1}课时`).slice(0, 60),
    chapter_refs: String(s.chapter_refs || '').slice(0, 60),
    minutes: Math.min(90, Math.max(20, Number(s.minutes) || 45)),
  })).slice(0, 6);
  const process = (Array.isArray(d.process) ? d.process : []).map((p) => ({
    phase: String(p.phase || '教学环节').slice(0, 12),
    minutes: Math.min(30, Math.max(5, Number(p.minutes) || 10)),
    activity: String(p.activity || '').slice(0, 200),
    design_intent: String(p.design_intent || '').slice(0, 120),
  })).filter((p) => p.activity).slice(0, 10);
  if (!arr(d.objectives, 5).length && !process.length) throw new Error('教案内容为空');
  return {
    course_title: String(d.course_title || d.title || '').slice(0, 120),
    objectives: arr(d.objectives || d.教学目标, 5),
    key_points: arr(d.key_points || d.重点, 4),
    difficulties: arr(d.difficulties || d.难点, 4),
    sessions,
    process,
    homework: arr(d.homework || d.作业, 3),
  };
}

// ============================================================
// 二、PPT 课件生成
// ============================================================
const SLIDES_PROMPT = `你是「越韵智传」平台的课件设计师，为越剧课程设计「红金戏曲风」PPT 页面大纲。
你输出的是每页要点大纲（不是逐字讲稿），前端会渲染成翻页课件并可导出 PPT。

【硬性约束】
1. 页面序列：第 1 页 kind=cover（封面，课程名+副标题），第 2 页 kind=toc（目录），中间每章 1-2 页 kind=content，最后 1 页 kind=end（结语致谢）。总页数不超过 ${MAX_SLIDES_PAGES} 页。
2. content 页：title 为页标题；points 为 3-5 条要点、每条不超过 40 字；note 为教师讲稿提示、不超过 60 字（可为空字符串）。
3. 只依据提供的章节结构，不得编造。
4. 输出必须是合法 JSON（不要 markdown 代码块、不要任何解释文字）：
{"pages":[{"kind":"cover","title":"课程名","subtitle":"副标题"},{"kind":"toc","title":"目录","items":["一、…","二、…"]},{"kind":"content","title":"页标题","points":["要点1","要点2"],"note":"讲稿提示"},{"kind":"end","title":"谢谢观赏","subtitle":"越韵智传"}]}`;

export async function genSlides({ courseTitle, category, chapters }) {
  const userMsg = [
    `课程《${courseTitle}》（分类：${category || '越剧知识'}），共 ${(chapters || []).length} 章。`,
    `章节结构：\n${chapterDigest(chapters, 200)}`,
    '\n请按 JSON 格式输出课件页面大纲（封面→目录→各章内容页→结尾）。',
  ].join('\n');
  const data = await callAgentJson(SLIDES_PROMPT, userMsg);
  return sanitizeSlides(data, courseTitle);
}

function sanitizeSlides(d, courseTitle) {
  const KINDS = new Set(['cover', 'toc', 'content', 'end']);
  const pages = (Array.isArray(d.pages) ? d.pages : [])
    .map((p) => {
      const kind = KINDS.has(p.kind) ? p.kind : 'content';
      const page = {
        kind,
        title: String(p.title || '').trim().slice(0, 60),
        subtitle: String(p.subtitle || '').trim().slice(0, 60),
      };
      if (kind === 'toc') page.items = (Array.isArray(p.items) ? p.items : []).map((s) => String(s || '').trim()).filter(Boolean).slice(0, 8);
      if (kind === 'content') {
        page.points = (Array.isArray(p.points) ? p.points : []).map((s) => String(s || '').trim()).filter(Boolean).slice(0, 5);
        page.note = String(p.note || '').trim().slice(0, 80);
      }
      return page;
    })
    .filter((p) => p.title || (p.points && p.points.length) || (p.items && p.items.length))
    .slice(0, MAX_SLIDES_PAGES);
  if (!pages.length) throw new Error('课件页面为空');
  // 保证首尾：无 cover 补、无 end 补
  if (pages[0].kind !== 'cover') pages.unshift({ kind: 'cover', title: courseTitle, subtitle: '越韵智传 · 戏曲共读' });
  if (pages[pages.length - 1].kind !== 'end') pages.push({ kind: 'end', title: '谢谢观赏', subtitle: '越韵智传' });
  return { pages };
}

// ============================================================
// 三、知识图谱生成
// ============================================================
const KG_TYPES = new Set(['person', 'school', 'play', 'role', 'segment', 'concept']);
const KG_PROMPT = `你是「越韵智传」平台的越剧知识图谱构建专家，从课程文本中抽取实体与关系。

【硬性约束】
1. 实体 type 只能取：person（人物）、school（流派）、play（剧目）、role（行当）、segment（唱段）、concept（概念）。
2. 实体 20-40 个，每个实体必须有 description（不超过 60 字，依据文本概括）。
3. 关系 25-60 条，relation 用短动词或短语（如：创立、师承、属于、代表作、出演、选自、流行于、形成于）。
4. 关系的 head 与 tail 必须与实体列表中的 name 完全一致。
5. 只抽取文本中有依据的实体关系，不得编造。
6. 输出必须是合法 JSON（不要 markdown 代码块、不要任何解释文字）：
{"entities":[{"name":"袁雪芬","type":"person","description":"越剧袁派创始人，越剧改革先驱"}],"relations":[{"head":"袁雪芬","relation":"创立","tail":"袁派"}]}`;

export async function genKnowledgeGraph({ courseTitle, fullText }) {
  const userMsg = `以下是课程《${courseTitle}》的材料节选：\n${clipText(fullText, BUDGET.graph)}\n\n请按 JSON 格式输出抽取的实体与关系。`;
  const data = await callAgentJson(KG_PROMPT, userMsg);
  return sanitizeKg(data);
}

function sanitizeKg(d) {
  const rawEntities = (Array.isArray(d.entities) ? d.entities : []).map((e) => ({
    name: String(e.name || '').replace(/《|》/g, '').trim().slice(0, 50),
    type: KG_TYPES.has(e.type) ? e.type : 'concept',
    description: String(e.description || '').trim().slice(0, 120),
  })).filter((e) => e.name);
  // 名称去重（同名取首个）
  const entityMap = new Map();
  for (const e of rawEntities) if (!entityMap.has(e.name)) entityMap.set(e.name, e);
  let entities = [...entityMap.values()].slice(0, MAX_KG_ENTITIES);
  const names = new Set(entities.map((e) => e.name));

  // 关系：端点缺失则补建 concept 实体；(head,relation,tail) 去重
  const relKeys = new Set();
  const relations = [];
  for (const r of (Array.isArray(d.relations) ? d.relations : [])) {
    const head = String(r.head || '').replace(/《|》/g, '').trim().slice(0, 50);
    const tail = String(r.tail || '').replace(/《|》/g, '').trim().slice(0, 50);
    const relation = String(r.relation || '').trim().slice(0, 20);
    if (!head || !tail || !relation) continue;
    if (!names.has(head)) { entities.push({ name: head, type: 'concept', description: '' }); names.add(head); }
    if (!names.has(tail)) { entities.push({ name: tail, type: 'concept', description: '' }); names.add(tail); }
    const key = `${head}|${relation}|${tail}`;
    if (relKeys.has(key)) continue;
    relKeys.add(key);
    relations.push({ head, relation, tail });
    if (relations.length >= MAX_KG_RELATIONS) break;
  }
  if (!entities.length) throw new Error('图谱实体为空');
  return { entities: entities.slice(0, MAX_KG_ENTITIES + 20), relations };
}

// ============================================================
// 四、AI 题目生成（single / multiple，追加进同一测验）
// ============================================================
const QUIZ_PROMPT = `你是「越韵智传」平台的越剧课程命题专家。课程已有脚本生成的判断题作基线，你负责补充单选题与多选题。

【硬性约束】
1. 只出 type 为 "single"（单选）与 "multiple"（多选）的题目，共 6-8 题。
2. 每题恰好 4 个选项（options 为 4 个字符串数组）；干扰项似是而非，答案必须能从材料中找到依据。
3. answer 是 0 起的选项索引数组：单选题恰 1 个索引；多选题 2-3 个索引。
4. 题干 content 不超过 80 字；不得编造材料中不存在的事实。
5. 输出必须是合法 JSON（不要 markdown 代码块、不要任何解释文字）：
{"questions":[{"type":"single","content":"题干？","options":["选项A","选项B","选项C","选项D"],"answer":[1]},{"type":"multiple","content":"题干？","options":["选项A","选项B","选项C","选项D"],"answer":[0,2]}]}`;

export async function genQuizAI({ courseTitle, chapters, fullText }) {
  const userMsg = [
    `课程《${courseTitle}》，共 ${(chapters || []).length} 章。`,
    `章节摘要：\n${chapterDigest(chapters, 150, 8)}`,
    `\n文本节选：\n${clipText(fullText, BUDGET.quiz)}`,
    '\n请按 JSON 格式输出题目（只含单选与多选）。',
  ].join('\n');
  const data = await callAgentJson(QUIZ_PROMPT, userMsg);
  return { questions: sanitizeQuiz(data) };
}

function sanitizeQuiz(d) {
  const questions = [];
  for (const q of (Array.isArray(d.questions) ? d.questions : [])) {
    if (q.type !== 'single' && q.type !== 'multiple') continue;
    const options = (Array.isArray(q.options) ? q.options : []).map((o) => String(o || '').trim()).filter(Boolean).slice(0, 4);
    if (options.length !== 4) continue;
    const answer = [...new Set((Array.isArray(q.answer) ? q.answer : [q.answer]).map(Number))]
      .filter((i) => Number.isInteger(i) && i >= 0 && i < 4).sort((a, b) => a - b);
    if (!answer.length) continue;
    if (q.type === 'single' && answer.length !== 1) continue;
    if (q.type === 'multiple' && (answer.length < 2 || answer.length > 3)) continue;
    const content = String(q.content || '').trim().slice(0, 120);
    if (!content) continue;
    questions.push({ type: q.type, content, options, answer });
    if (questions.length >= MAX_QUIZ_AI) break;
  }
  if (!questions.length) throw new Error('AI 未生成有效题目');
  return questions;
}

// ============================================================
// 五、落库
// ============================================================
async function upsertResource(courseId, type, content) {
  await pool.query(
    `INSERT INTO course_resources (course_id, type, status, content)
     VALUES (?, ?, 'ready', ?)
     ON DUPLICATE KEY UPDATE status = 'ready', content = VALUES(content), error_msg = NULL, updated_at = CURRENT_TIMESTAMP`,
    [courseId, type, JSON.stringify(content)]
  );
}

export async function savePlan(courseId, plan) { await upsertResource(courseId, 'plan', plan); }
export async function saveSlides(courseId, slides) {
  // 教师手动插入的图片不应因“重新生成课件文案”被静默清除。
  const [rows] = await pool.query('SELECT content FROM course_resources WHERE course_id = ? AND type = ?', [courseId, 'slides']);
  if (rows.length) {
    try {
      const previous = typeof rows[0].content === 'string' ? JSON.parse(rows[0].content) : rows[0].content;
      if (previous?.images && typeof previous.images === 'object') {
        slides.images = Object.fromEntries(Object.entries(previous.images)
          .filter(([pageIndex]) => Number.isInteger(Number(pageIndex)) && Number(pageIndex) >= 0 && Number(pageIndex) < (slides.pages || []).length));
      }
    } catch { /* 旧资源 JSON 异常时仍可生成新的课件 */ }
  }
  await upsertResource(courseId, 'slides', slides);
}

export async function markResourceFailed(courseId, type, message) {
  await pool.query(
    `INSERT INTO course_resources (course_id, type, status, content, error_msg)
     VALUES (?, ?, 'failed', '{}', ?)
     ON DUPLICATE KEY UPDATE status = 'failed', error_msg = VALUES(error_msg), updated_at = CURRENT_TIMESTAMP`,
    [courseId, type, String(message || '生成失败').slice(0, 480)]
  );
}

// 图谱落库：实体 upsert（回填描述不抢 source_id）+ 关系 upsert（复用 extractKg.js 模式）
export async function saveKgToDb(courseId, kg, db = pool) {
  const sourceId = `course:${courseId}`;
  const idByName = new Map();
  let entityCount = 0;
  for (const e of kg.entities) {
    try {
      await db.query(
        `INSERT INTO kg_entities (name, type, description, source_id)
         VALUES (?, ?, ?, ?)
         ON DUPLICATE KEY UPDATE description = COALESCE(VALUES(description), description)`,
        [e.name, e.type, e.description || null, sourceId]
      );
      const [rows] = await db.query('SELECT id FROM kg_entities WHERE name = ? AND type = ?', [e.name, e.type]);
      if (rows[0]) { idByName.set(e.name, rows[0].id); entityCount++; }
    } catch (err) { if (db !== pool) throw err; }
  }
  let relationCount = 0;
  for (const r of kg.relations) {
    const headId = idByName.get(r.head);
    const tailId = idByName.get(r.tail);
    if (!headId || !tailId) continue;
    try {
      await db.query(
        `INSERT INTO kg_relations (head_id, relation, tail_id, source_id)
         VALUES (?, ?, ?, ?)
         ON DUPLICATE KEY UPDATE weight = weight + 0.1`,
        [headId, r.relation, tailId, sourceId]
      );
      relationCount++;
    } catch (err) { if (db !== pool) throw err; }
  }
  return { entities: entityCount, relations: relationCount };
}

// AI 题目追加进课程第一个 exam（不存在则建），sort_order 续排，重算 total_score
export async function appendQuizAI(courseId, questions, db = pool) {
  let [exams] = await db.query('SELECT id FROM exams WHERE course_id = ? ORDER BY id LIMIT 1', [courseId]);
  let examId;
  if (exams.length === 0) {
    const [ins] = await db.query(
      "INSERT INTO exams (course_id, title, description, total_score) VALUES (?, '随堂测验', '由 PDF 自动生成，即时对错', 0)",
      [courseId]
    );
    examId = ins.insertId;
  } else {
    examId = exams[0].id;
  }
  const [maxRow] = await db.query('SELECT COALESCE(MAX(sort_order), 0) AS m FROM exam_questions WHERE exam_id = ?', [examId]);
  let sort = maxRow[0].m;
  for (const q of questions) {
    sort += 1;
    await db.query(
      'INSERT INTO exam_questions (exam_id, type, content, options, answer, score, sort_order) VALUES (?,?,?,?,?,?,?)',
      [examId, q.type, q.content, JSON.stringify(q.options), JSON.stringify(q.answer), q.type === 'single' ? 5 : 8, sort]
    );
  }
  await db.query(
    'UPDATE exams SET total_score = (SELECT COALESCE(SUM(score), 0) FROM exam_questions WHERE exam_id = ?) WHERE id = ?',
    [examId, examId]
  );
  return questions.length;
}

// ============================================================
// 六、.pptx 导出（与 HTML 课件共用 slides schema）
// ============================================================
export async function buildPptxBuffer(slides, courseTitle, courseId = null) {
  const pptx = new pptxgen();
  pptx.layout = 'LAYOUT_16x9';
  pptx.author = '越韵智传';
  pptx.title = courseTitle || '课件';

  for (const [pageIndex, page] of (slides.pages || []).entries()) {
    const slide = pptx.addSlide();
    if (page.kind === 'cover' || page.kind === 'end') {
      slide.background = { color: '8E1D22' }; // 深越剧红
      slide.addText(page.title || courseTitle || '', {
        x: 0.5, y: 2.1, w: 9, h: 1.2, fontSize: 40, bold: true,
        color: 'F7F1E4', fontFace: 'KaiTi', align: 'center',
      });
      slide.addShape(pptx.ShapeType.rect, { x: 3.6, y: 3.05, w: 2.8, h: 0.035, fill: { color: 'C4A061' } });
      if (page.subtitle) {
        slide.addText(page.subtitle, { x: 0.5, y: 3.3, w: 9, h: 0.6, fontSize: 16, color: 'C4A061', fontFace: 'KaiTi', align: 'center' });
      }
    } else {
      slide.background = { color: 'FDF9F0' }; // 米白宣纸
      slide.addText(page.title || '', {
        x: 0.6, y: 0.32, w: 8.8, h: 0.7, fontSize: 26, bold: true,
        color: 'A12022', fontFace: 'KaiTi',
      });
      slide.addShape(pptx.ShapeType.rect, { x: 0.65, y: 1.02, w: 2.2, h: 0.03, fill: { color: 'C4A061' } });
      const items = page.kind === 'toc' ? (page.items || []) : (page.points || []);
      if (items.length) {
        slide.addText(
          items.map((t) => ({ text: t, options: { bullet: true } })),
          { x: 0.9, y: 1.35, w: 8.2, h: 3.8, fontSize: 16, color: '33302A', fontFace: 'KaiTi', lineSpacingMultiple: 1.5, valign: 'top' }
        );
      }
    }
    // 教师插图与页面预览共用坐标；缺失文件会被跳过，不影响整个课件下载。
    for (const image of (slides.images?.[String(pageIndex)] || [])) {
      const imagePath = safeSlideImagePath(courseId, image?.fileName);
      if (!imagePath) continue;
      slide.addImage({ path: imagePath, ...slideImageBox(image), transparency: 0 });
    }
    if (page.note) slide.addNotes(page.note);
  }
  return pptx.write({ outputType: 'nodebuffer' });
}

// ============================================================
// 七、重新生成（courseContent regenerate 路由复用）
// ============================================================

// 从库中重建生成上下文（课程 + 章节）
export async function buildContext(courseId) {
  const [courses] = await pool.query('SELECT id, title, category FROM courses WHERE id = ?', [courseId]);
  if (courses.length === 0) throw Object.assign(new Error('课程不存在'), { status: 404 });
  const [lessons] = await pool.query(
    'SELECT title, body FROM course_lessons WHERE course_id = ? ORDER BY chapter_no, sort_order, id',
    [courseId]
  );
  const chapters = lessons.map((l) => ({ title: l.title, body: l.body || '' }));
  const fullText = chapters.map((c) => `${c.title}\n${c.body}`).join('\n');
  return { courseTitle: courses[0].title, category: courses[0].category, chapters, fullText };
}

// 先生成，再在事务里替换；AI 失败时保留旧题目和图谱。
async function withResourceTransaction(work) {
  const db = await pool.getConnection();
  try {
    await db.beginTransaction();
    const result = await work(db);
    await db.commit();
    return result;
  } catch (err) {
    await db.rollback();
    throw err;
  } finally {
    db.release();
  }
}

// 单项生成并落库（type ∈ plan|slides|graph|quizai）
export async function generateAndSave(courseId, type) {
  const ctx = await buildContext(courseId);
  if (type === 'plan') {
    const plan = await genLessonPlan(ctx);
    await savePlan(courseId, plan);
    return plan;
  }
  if (type === 'slides') {
    const slides = await genSlides(ctx);
    await saveSlides(courseId, slides);
    return slides;
  }
  if (type === 'graph') {
    const kg = await genKnowledgeGraph(ctx);
    return withResourceTransaction(async (db) => {
      const sourceId = `course:${courseId}`;
      await db.query('DELETE FROM kg_relations WHERE source_id = ?', [sourceId]);
      return saveKgToDb(courseId, kg, db);
    });
  }
  if (type === 'quizai') {
    const { questions } = await genQuizAI(ctx);
    await withResourceTransaction(async (db) => {
      const [exams] = await db.query('SELECT id FROM exams WHERE course_id = ? ORDER BY id LIMIT 1', [courseId]);
      if (exams.length) {
        await db.query("DELETE FROM exam_questions WHERE exam_id = ? AND type IN ('single','multiple')", [exams[0].id]);
      }
      await appendQuizAI(courseId, questions, db);
    });
    return { added: questions.length };
  }
  throw Object.assign(new Error('未知的资源类型'), { status: 400 });
}

// ============================================================
// 八、幂等建表（extractKg.js 先例：运行时自建，双保险 init.sql）
// ============================================================
const ensureTable = pool.query(`
  CREATE TABLE IF NOT EXISTS course_resources (
    id INT AUTO_INCREMENT PRIMARY KEY,
    course_id INT NOT NULL,
    type ENUM('plan','slides') NOT NULL COMMENT '资源类型：plan=教案 slides=PPT课件',
    status ENUM('generating','ready','failed') NOT NULL DEFAULT 'ready',
    content JSON NOT NULL COMMENT '结构化内容（schema由服务层约定）',
    error_msg VARCHAR(500) DEFAULT NULL COMMENT '生成失败原因（供重新生成提示）',
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    UNIQUE KEY uk_course_type (course_id, type),
    CONSTRAINT fk_cres_course FOREIGN KEY (course_id) REFERENCES courses(id) ON DELETE CASCADE
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
`).catch((err) => console.warn('[courseResources] 建表失败（init.sql 已有兜底）:', err?.message || err));
void ensureTable;
