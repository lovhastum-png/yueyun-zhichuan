// PDF 导入课程：上传 → OCR → 越剧审查 → 自动建课 + 章节 + 卡片 + 测验 + 知识库
// 由于 OCR 可能耗时数分钟，采用「任务+轮询」模式，不阻塞 HTTP 请求。
import { Router } from 'express';
import crypto from 'crypto';
import http from 'http';
import https from 'https';
import { promises as fs, createReadStream } from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import pool from '../db.js';
import { createKeyedLock } from '../utils/keyedLock.js';
import { authRequired, requireRole } from '../middleware/auth.js';
import { success, fail, asyncHandler } from '../middleware/error.js';
import { classifyYueju } from '../services/yuejuClassifier.js';
import {
  genLessonPlan, genSlides, genKnowledgeGraph, genQuizAI,
  savePlan, saveSlides, saveKgToDb, appendQuizAI, markResourceFailed,
} from '../services/courseResources.js';

const router = Router();
const withUploadLock = createKeyedLock();
router.use(authRequired);
router.use(requireRole('teacher'));

function intEnv(name, fallback, min, max) {
  const parsed = Number.parseInt(process.env[name] || '', 10);
  return Number.isFinite(parsed) ? Math.max(min, Math.min(max, parsed)) : fallback;
}

const OCR_URL = process.env.PDF_IMPORT_OCR_URL || 'http://127.0.0.1:8768';
const MAX_PDF_MB = intEnv('PDF_IMPORT_MAX_MB', 100, 10, 400);
const MAX_PDF = MAX_PDF_MB * 1024 * 1024;
const IMPORT_CONCURRENCY = intEnv('PDF_IMPORT_CONCURRENCY', 1, 1, 2);
const OCR_TIMEOUT_MS = intEnv('PDF_IMPORT_OCR_TIMEOUT_MS', 45 * 60_000, 60_000, 2 * 60 * 60_000);
const OCR_HEALTH_TIMEOUT = 3500;
// Cloudflare Tunnel 在当前网络下会中断 2MB 以上的原始请求；256KB 可稳定透传，
// 同时仍能维持合理的上传速度与失败重试粒度。
const UPLOAD_CHUNK_SIZE = 256 * 1024;

// 原版 PDF 存储目录（项目根/data/course-pdf，不走公开静态目录，仅经权限接口访问）
const projectRoot = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const PDF_DIR = path.join(projectRoot, 'data', 'course-pdf');
const TEMP_DIR = path.join(projectRoot, 'data', 'course-import-tmp');

// 内存任务表负责本进程的排队；任务本身同步保存到 MySQL，重启后仍可查看和继续。
const tasks = new Map();
// 分片上传会话只记录元信息，PDF 本体始终落盘，避免大文件滞留在 Node 内存。
const uploads = new Map();
// OCR 是本功能的主要内存消费者。4G 生产机默认只执行一个导入任务，其余任务排队。
const importQueue = [];
let activeImports = 0;

const ACTIVE_TASK_STATUSES = ['queued', 'ocr', 'review', 'build', 'plan', 'ppt', 'graph', 'quizai'];
const TERMINAL_TASK_STATUSES = ['done', 'failed', 'rejected', 'interrupted'];

const taskStoreReady = pool.query(`
  CREATE TABLE IF NOT EXISTS course_import_tasks (
    id VARCHAR(32) PRIMARY KEY,
    teacher_id INT NOT NULL,
    filename VARCHAR(160) NOT NULL,
    course_title VARCHAR(180) NOT NULL,
    category VARCHAR(80) NOT NULL,
    status VARCHAR(24) NOT NULL,
    progress TINYINT UNSIGNED NOT NULL DEFAULT 0,
    result JSON NULL,
    error_msg VARCHAR(500) NULL,
    temp_path VARCHAR(700) NULL,
    resume_count INT UNSIGNED NOT NULL DEFAULT 0,
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    INDEX idx_course_import_teacher_updated (teacher_id, updated_at),
    INDEX idx_course_import_status (status, updated_at)
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
`).then(async () => {
  // OCR/AI 请求不能在进程重启后从中间状态盲目续跑；保留文件和进度，让教师明确继续。
  await pool.query(
    `UPDATE course_import_tasks
       SET status = 'interrupted', error_msg = '服务刚刚重启，任务已安全暂停，可继续导入。'
     WHERE status IN (${ACTIVE_TASK_STATUSES.map(() => '?').join(',')})`,
    ACTIVE_TASK_STATUSES,
  );
}).catch((err) => {
  console.error('[courseImport] 初始化任务存储失败：', err?.message || err);
  throw err;
});

function taskFromRow(row) {
  let result = null;
  try { result = typeof row.result === 'string' ? JSON.parse(row.result) : row.result; } catch { result = null; }
  return {
    id: row.id,
    status: row.status,
    teacherId: row.teacher_id,
    filename: row.filename,
    courseTitle: row.course_title,
    category: row.category,
    progress: Number(row.progress || 0),
    createdAt: new Date(row.created_at).getTime(),
    result,
    error: row.error_msg,
    _pdfPath: row.temp_path,
    resumeCount: Number(row.resume_count || 0),
  };
}

async function persistTask(t) {
  await taskStoreReady;
  await pool.query(
    `INSERT INTO course_import_tasks
      (id, teacher_id, filename, course_title, category, status, progress, result, error_msg, temp_path, resume_count)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON DUPLICATE KEY UPDATE status=VALUES(status), progress=VALUES(progress), result=VALUES(result),
       error_msg=VALUES(error_msg), temp_path=VALUES(temp_path), resume_count=VALUES(resume_count), updated_at=CURRENT_TIMESTAMP`,
    [t.id, t.teacherId, t.filename, t.courseTitle, t.category, t.status, t.progress,
      JSON.stringify(t.result ?? null), t.error || null, t._pdfPath || null, t.resumeCount || 0],
  );
}

async function setTask(t, patch) {
  Object.assign(t, patch);
  await persistTask(t);
}

async function findTask(id) {
  const cached = tasks.get(id);
  if (cached) return cached;
  await taskStoreReady;
  const [rows] = await pool.query('SELECT * FROM course_import_tasks WHERE id = ?', [id]);
  if (!rows.length) return null;
  const task = taskFromRow(rows[0]);
  tasks.set(task.id, task);
  return task;
}

const CHAPTER_PAGES = 8;         // 无目录时按每 N 页一章
const MAX_CARDS = 24;
const MAX_QUIZ = 6;
const MIN_CHAPTER_PAGES = 2;

const TYPE_MAP = { school: 'school', hangdang: 'role', play: 'play', person: 'person', term: 'concept' };

async function newTask(teacherId, filename, courseTitle, category, pdfPath) {
  const id = crypto.randomBytes(8).toString('hex');
  const t = {
    id,
    status: 'queued',
    teacherId,
    filename,
    courseTitle: courseTitle || filename.replace(/\.pdf$/i, ''),
    category: category || '越剧知识',
    progress: 0,
    createdAt: Date.now(),
    result: null,
    error: null,
    _pdfPath: pdfPath,
  };
  await persistTask(t);
  tasks.set(id, t);
  importQueue.push(t);
  updateQueuePositions();
  drainImportQueue();
  return t;
}

function updateQueuePositions() {
  importQueue.forEach((task, index) => { task.queuePosition = index + 1; });
}

function drainImportQueue() {
  while (activeImports < IMPORT_CONCURRENCY && importQueue.length > 0) {
    const task = importQueue.shift();
    delete task.queuePosition;
    activeImports += 1;
    updateQueuePositions();
    setImmediate(async () => {
      runImport(task)
        .catch(async (err) => {
          await setTask(task, { status: 'failed', progress: 100, error: err?.message || String(err) });
          await discardTempPdf(task).catch(() => {});
          await persistTask(task).catch(() => {});
        })
        .finally(() => {
          activeImports -= 1;
          drainImportQueue();
        });
    });
  }
}

function randomHex(n) { return crypto.randomBytes(n).toString('hex').slice(0, n); }

// 把原版 PDF 写入磁盘，返回相对项目根的路径（如 data/course-pdf/5.pdf）
async function saveCoursePdf(courseId, sourcePath) {
  await fs.mkdir(PDF_DIR, { recursive: true });
  const fileName = `${courseId}.pdf`;
  await fs.copyFile(sourcePath, path.join(PDF_DIR, fileName));
  return path.join('data', 'course-pdf', fileName);
}

async function discardTempPdf(t) {
  if (!t?._pdfPath) return;
  const tempPath = t._pdfPath;
  t._pdfPath = null;
  await fs.unlink(tempPath).catch((err) => {
    if (err?.code !== 'ENOENT') throw err;
  });
}

// 请求 OCR 健康检查。与导入请求使用相同的地址解析，避免配置成 https 时意外失效。
function requestOcrHealth() {
  return new Promise((resolve, reject) => {
    const url = new URL(OCR_URL);
    const transport = url.protocol === 'https:' ? https : http;
    const req = transport.request({
      hostname: url.hostname,
      port: url.port || undefined,
      path: '/health',
      method: 'GET',
    }, (res) => {
      const chunks = [];
      res.on('data', (c) => chunks.push(c));
      res.on('end', () => resolve({ status: res.statusCode || 500, text: Buffer.concat(chunks).toString('utf8') }));
      res.on('error', reject);
    });
    req.setTimeout(OCR_HEALTH_TIMEOUT, () => req.destroy(new Error('OCR 服务响应超时')));
    req.on('error', reject);
    req.end();
  });
}

async function getOcrStatus() {
  try {
    const full = await requestOcrHealth();
    if (full.status === 200) return { ready: true, message: 'OCR 服务运行正常' };
    return { ready: false, message: `OCR 服务返回 HTTP ${full.status}` };
  } catch (err) {
    return { ready: false, message: `无法连接 OCR 服务（${err?.message || '未知错误'}）` };
  }
}

// 发送 PDF 到 OCR 服务（multipart/form-data）。
// 不用全局 fetch：其底层 undici 默认 5 分钟 headersTimeout，大书 OCR 常超时被断开；
// 这里用 http 模块并显式关闭超时，允许长时间 OCR。
async function postOcr(pdfPath) {
  const stat = await fs.stat(pdfPath);
  return new Promise((resolve, reject) => {
    const boundary = `----Yueju${Date.now().toString(16)}`;
    const head = Buffer.from(
      `--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="upload.pdf"\r\nContent-Type: application/pdf\r\n\r\n`
    );
    const tail = Buffer.from(`\r\n--${boundary}--\r\n`);
    const url = new URL(OCR_URL);
    const transport = url.protocol === 'https:' ? https : http;
    const req = transport.request({
      hostname: url.hostname,
      port: url.port || undefined,
      path: '/ocr',
      method: 'POST',
      headers: {
        'Content-Type': `multipart/form-data; boundary=${boundary}`,
        // 以文件流传送，避免整个 PDF 进入 Node 堆内存。
        'Content-Length': head.length + stat.size + tail.length,
      },
    }, (res) => {
      const chunks = [];
      res.on('data', (c) => chunks.push(c));
      res.on('end', () => resolve({ status: res.statusCode, text: Buffer.concat(chunks).toString('utf8') }));
      res.on('error', reject);
    });
    // 防止 OCR 进程异常后任务永久占住单并发队列；默认允许最长 45 分钟无响应。
    req.setTimeout(OCR_TIMEOUT_MS, () => req.destroy(new Error('OCR 处理超时，请缩小 PDF 或降低页数后重试')));
    req.on('error', reject);
    req.write(head);
    const stream = createReadStream(pdfPath);
    stream.on('error', (err) => req.destroy(err));
    stream.on('end', () => req.end(tail));
    stream.pipe(req, { end: false });
  });
}

// ---------- 章节切分（通用启发式） ----------
function cleanLine(line) {
  const s = String(line).replace(/[\u00b7·\s]+/g, '').trim();
  if (!s) return '';
  if (/^\d{1,3}$/.test(s)) return ''; // 页脚页码
  return s;
}

function splitChapters(pages, fallbackTitle) {
  // 去掉明显的封面/版权/目录页（页面文字极少或含"出版发行/ISBN/印数/目 次"）
  const bodyPages = pages.filter((p) => {
    const t = (p.text || '').replace(/\s+/g, '');
    if (t.length < 8) return false;
    if (/出版发行|ISBN|定价|印数|版权所有/.test(t) && t.length < 120) return false;
    if (/^(目|录|目次|序|前言)[\s\S]*$/.test(t) && t.length < 200) return false;
    return true;
  });
  if (bodyPages.length < 1) bodyPages.push(...pages);

  // 尝试目录检测：取一页内"简短标题…数字页码"对
  const tocHits = [];
  for (const p of pages.slice(0, 12)) {
    for (const line of (p.text || '').split('\n')) {
      const m = String(line).trim().match(/^(.{2,30}?)[…·]{1,}?(\d{1,3})$/);
      if (m && !/^\d+$/.test(m[1])) tocHits.push({ title: m[1], page: parseInt(m[2], 10) });
    }
    if (tocHits.length >= 3) break;
  }

  if (tocHits.length >= 3) {
    // 用目录建章（book 页码 → 近似 PDF 顺序：按目录页码排序，正文按顺序切）
    const ordered = tocHits.slice().sort((a, b) => a.page - b.page)
      .map((x) => ({ ...x, firstPageOfChapter: true }))
      .slice(0, 40);
    const chapters = [];
    for (let i = 0; i < ordered.length; i++) {
      const title = ordered[i].title;
      if (chapters.some((c) => c.title === title)) continue; // 去重
      chapters.push({ title });
    }
    // 章节正文：把 bodyPages 均分给章节？目录页码 ≠ PDF 页。采用「目录标题作章名，正文顺序均分」折中
    const len = chapters.length;
    for (let i = 0; i < len; i++) {
      const start = Math.floor((i * bodyPages.length) / len);
      const end = Math.floor(((i + 1) * bodyPages.length) / len);
      chapters[i].start = start;
      chapters[i].end = Math.max(end, start + 1);
    }
    return chapters.map((c, i) => ({
      title: c.title,
      body: blockBody(bodyPages.slice(c.start, c.end)),
    }));
  }

  // 无目录：按页块分段
  const chapters = [];
  const n = bodyPages.length;
  const step = n <= 20 ? n : CHAPTER_PAGES;
  for (let s = 0; s < n; s += step) {
    const slice = bodyPages.slice(s, s + step);
    if (slice.length < 1) continue;
    const head = slice[0].text.split('\n').find((l) => cleanLine(l).length > 8) || '';
    chapters.push({
      title: `第${chapters.length + 1}部分 · ${String(cleanLine(head) || fallbackTitle).slice(0, 18)}`,
      body: blockBody(slice),
    });
  }
  return chapters;
}

function blockBody(pages) {
  const lines = [];
  for (const p of pages) {
    for (const line of (p.text || '').split('\n')) {
      const c = cleanLine(line);
      if (c) lines.push(c);
    }
  }
  return lines.join('\n');
}

// ---------- 测验生成（脚本自动，判断题为主） ----------
const FACT_VERBS = ['是', '位于', '由', '创始', '原名', '发源', '流行', '建立', '首演', '改编', '代表', '继承', '先后', '之后'];
function genQuiz(body) {
  const sentences = [];
  for (const para of body.split('\n')) {
    // 切句
    const parts = para.split(/[。；，]/).map((s) => s.trim()).filter((s) => s.length >= 12 && s.length <= 46);
    for (const s of parts) {
      if (FACT_VERBS.some((v) => s.includes(v)) && !/^(问题|为什么|如何|是否)/.test(s)) {
        sentences.push(s);
        if (sentences.length >= 12) break;
      }
    }
    if (sentences.length >= 12) break;
  }
  // 打乱取样
  const picked = sentences.sort(() => Math.random() - 0.5).slice(0, MAX_QUIZ);
  return picked.map((s, i) => ({
    type: 'judge',
    content: `下列说法是否正确：${s}`,
    options: ['对', '错'],
    answer: [0],
    score: 5,
    sort_order: i,
  }));
}

// ---------- 主流程 ----------
async function runImport(t) {
  await setTask(t, { status: 'ocr', error: null });
  const full = await postOcr(t._pdfPath);
  if (full.status !== 200) throw new Error(`OCR 服务返回 ${full.status}`);
  let data;
  try {
    data = JSON.parse(full.text);
  } catch {
    throw new Error('OCR 服务返回了无法解析的内容');
  }
  const pages = data.pages || [];
  if (pages.length === 0) throw new Error('OCR 未识别出任何文字');
  await setTask(t, { progress: 60 });

  // 越剧审查
  await setTask(t, { status: 'review' });
  const fullText = pages.map((p) => p.text).join('\n');
  const verdict = classifyYueju(fullText);
  if (!verdict.isYueju) {
    await setTask(t, { status: 'rejected', progress: 100, result: { verdict, pages: pages.length } });
    await discardTempPdf(t);
    await persistTask(t);
    return;
  }

  await setTask(t, { status: 'build' });
  const filename = t.filename;
  const courseTitle = t.courseTitle;

  // 章节切分
  const chapters = splitChapters(pages, courseTitle);
  if (chapters.length === 0) chapters.push({ title: courseTitle, body: blockBody(pages) });

  // 建课
  const [cIns] = await pool.query(
    `INSERT INTO courses (teacher_id, title, subtitle, description, category, status)
     VALUES (?, ?, ?, ?, ?, 'open')`,
    [t.teacherId, courseTitle, `${filename} · PDF 自动导入数字化共读`, `由 PDF「${filename}」经 OCR 自动生成的在线阅读课程（${chapters.length} 章）。`, t.category]
  );
  const courseId = cIns.insertId;
  // 一旦基础课程已落库，重启后绝不重复建课；页面会提供进入已生成课程的入口。
  await setTask(t, { result: { courseId, courseTitle, partial: true } });

  // 保存原版 PDF 到磁盘并记录路径（失败不阻断建课，阅读页自动降级为文字版）
  try {
    const pdfRelPath = await saveCoursePdf(courseId, t._pdfPath);
    await pool.query('UPDATE courses SET pdf_path = ? WHERE id = ?', [pdfRelPath, courseId]);
  } catch (err) {
    console.warn(`[courseImport] 保存原版PDF失败 course=${courseId}: ${err?.message || err}`);
  }

  // 章节正文
  const cards = [];
  for (let i = 0; i < chapters.length; i++) {
    const ch = chapters[i];
    await pool.query(
      'INSERT INTO course_lessons (course_id, title, chapter_no, sort_order, body, source_note) VALUES (?,?,?,?,?,?)',
      [courseId, ch.title, i + 1, i + 1, ch.body, `${filename} · 第${i + 1}章`]
    );
    const firstPara = (ch.body.split('\n').find((p) => p.length > 12) || ch.body).slice(0, 90);
    if (firstPara) cards.push({ title: ch.title, content: firstPara + (firstPara.length >= 90 ? '……' : '') });
  }
  // 知识卡片（写入知识库，source_type='course'）
  for (const c of cards.slice(0, MAX_CARDS)) {
    await pool.query(
      "INSERT INTO knowledge_chunks (source_id, source_type, title, content, keywords) VALUES (?, 'course', ?, ?, ?)",
      [String(courseId), c.title, c.content, JSON.stringify(['课程导读', courseTitle])]
    );
  }

  // 知识图谱实体（把识别的越剧专有词入 kg_entities）
  const uniqueTerms = [...new Set((verdict.hits || []).map((h) => h.kw))];
  for (const kw of uniqueTerms) {
    const hit = verdict.hits.find((h) => h.kw === kw);
    const type = TYPE_MAP[hit?.label] || 'concept';
    await pool.query('INSERT IGNORE INTO kg_entities (name, type, source_id) VALUES (?,?,?)', [kw, type, `course:${courseId}`]);
  }

  // 随堂测验（脚本判断题基线）
  const quizQ = genQuiz(fullText);
  if (quizQ.length) {
    const [examIns] = await pool.query(
      "INSERT INTO exams (course_id, title, description, total_score) VALUES (?, '随堂测验', '由 PDF 自动生成，即时对错', ?)",
      [courseId, quizQ.length * 5]
    );
    const examId = examIns.insertId;
    for (const q of quizQ) {
      await pool.query(
        'INSERT INTO exam_questions (exam_id, type, content, options, answer, score, sort_order) VALUES (?,?,?,?,?,?,?)',
        [examId, q.type, q.content, JSON.stringify(q.options), JSON.stringify(q.answer), q.score, q.sort_order]
      );
    }
  }

  // ---------- AI 教学资源一条龙（每步独立容错，失败记 warnings 不阻断） ----------
  const warnings = [];
  const aiRes = { plan: false, slides: 0, graph: null, quizAI: 0 };
  const aiCtx = { courseTitle, category: t.category, chapters, fullText };

  await setTask(t, { status: 'plan', progress: 72 });
  try {
    const plan = await genLessonPlan(aiCtx);
    await savePlan(courseId, plan);
    aiRes.plan = true;
  } catch (err) {
    warnings.push(`教案生成失败：${err?.message || err}`);
    await markResourceFailed(courseId, 'plan', err?.message || err).catch(() => {});
  }

  await setTask(t, { status: 'ppt', progress: 80 });
  try {
    const slides = await genSlides(aiCtx);
    await saveSlides(courseId, slides);
    aiRes.slides = slides.pages.length;
  } catch (err) {
    warnings.push(`PPT 课件生成失败：${err?.message || err}`);
    await markResourceFailed(courseId, 'slides', err?.message || err).catch(() => {});
  }

  await setTask(t, { status: 'graph', progress: 88 });
  try {
    const kg = await genKnowledgeGraph(aiCtx);
    aiRes.graph = await saveKgToDb(courseId, kg);
  } catch (err) {
    warnings.push(`知识图谱生成失败：${err?.message || err}`);
  }

  await setTask(t, { status: 'quizai', progress: 95 });
  try {
    const { questions } = await genQuizAI(aiCtx);
    aiRes.quizAI = await appendQuizAI(courseId, questions);
  } catch (err) {
    warnings.push(`AI 题目生成失败：${err?.message || err}`);
  }

  await setTask(t, { status: 'done', progress: 100, result: {
    courseId, courseTitle,
    chapters: chapters.length, cards: cards.length, quiz: quizQ.length,
    plan: aiRes.plan, slides: aiRes.slides, graph: aiRes.graph, quizAI: aiRes.quizAI,
    verdict, warnings,
  } });
  await discardTempPdf(t);
  await persistTask(t);
}

// ---------- 路由 ----------
function normalizeFilename(value) {
  return String(value || 'document.pdf').replace(/[\\/:*?"<>|]/g, '').slice(0, 120) || 'document.pdf';
}

function isPdfFilename(filename) {
  return /\.pdf$/i.test(filename);
}

async function hasPdfSignature(filePath) {
  const handle = await fs.open(filePath, 'r');
  try {
    const head = Buffer.alloc(1024);
    const { bytesRead } = await handle.read(head, 0, head.length, 0);
    return head.subarray(0, bytesRead).includes(Buffer.from('%PDF-'));
  } finally {
    await handle.close();
  }
}

async function writeRequestToTemp(req, uploadId) {
  await fs.mkdir(TEMP_DIR, { recursive: true });
  const tempPath = path.join(TEMP_DIR, `${uploadId}.part`);
  const handle = await fs.open(tempPath, 'w');
  let bytes = 0;
  let succeeded = false;
  try {
    for await (const chunk of req) {
      bytes += chunk.length;
      if (bytes > MAX_PDF) {
        const err = new Error(`PDF 过大（限制 ${MAX_PDF_MB}MB）`);
        err.status = 413;
        throw err;
      }
      await handle.write(chunk);
    }
    succeeded = true;
    return { tempPath, bytes };
  } finally {
    await handle.close();
    if (!succeeded) await fs.unlink(tempPath).catch(() => {});
  }
}

async function readRequestChunk(req, maxBytes) {
  const chunks = [];
  let bytes = 0;
  for await (const chunk of req) {
    bytes += chunk.length;
    if (bytes > maxBytes) {
      const err = new Error('上传分片过大');
      err.status = 413;
      throw err;
    }
    chunks.push(chunk);
  }
  return Buffer.concat(chunks, bytes);
}

// PDF OCR 服务状态：前端在用户选择文件前确认服务已可用，避免制造必然失败的任务。
router.get('/import/status', asyncHandler(async (req, res) => {
  const status = await getOcrStatus();
  return success(res, {
    ...status,
    maxPdfMB: MAX_PDF_MB,
    activeImports,
    queuedImports: importQueue.length,
    importConcurrency: IMPORT_CONCURRENCY,
  }, status.ready ? 'PDF 导入服务已就绪' : 'PDF 导入服务暂不可用');
}));

// 大 PDF 采用分片上传：每片仅 256KB，可绕过公网隧道对长请求的缓冲/中断问题。
router.post('/import/upload/init', asyncHandler(async (req, res) => {
  const filename = normalizeFilename(req.body?.filename);
  const size = Number(req.body?.size || 0);
  if (!isPdfFilename(filename)) return fail(res, '请选择 PDF 文件', 400, 400);
  if (!Number.isSafeInteger(size) || size < 512) return fail(res, 'PDF 文件为空或过小', 400, 400);
  if (size > MAX_PDF) return fail(res, `PDF 过大（限制 ${MAX_PDF_MB}MB）`, 400, 400);

  const ocr = await getOcrStatus();
  if (!ocr.ready) return fail(res, `PDF 识别服务未就绪：${ocr.message}`, 503, 503);

  const id = crypto.randomBytes(12).toString('hex');
  await fs.mkdir(TEMP_DIR, { recursive: true });
  const tempPath = path.join(TEMP_DIR, `${id}.part`);
  await fs.writeFile(tempPath, Buffer.alloc(0), { flag: 'wx' });
  // 预分配为稀疏文件，分片可并发、乱序写入，避免公网隧道的逐片往返等待。
  await fs.truncate(tempPath, size);
  uploads.set(id, {
    id,
    teacherId: req.user.id,
    filename,
    courseTitle: String(req.body?.courseTitle || '').slice(0, 160),
    category: String(req.body?.category || '越剧知识').slice(0, 60),
    size,
    received: 0,
    totalChunks: Math.ceil(size / UPLOAD_CHUNK_SIZE),
    receivedChunks: new Set(),
    tempPath,
    createdAt: Date.now(),
    taskId: null,
  });
  return success(res, { uploadId: id, chunkSize: UPLOAD_CHUNK_SIZE }, '已创建分片上传任务');
}));

router.post('/import/upload/:id/chunk/:index', asyncHandler(async (req, res) => withUploadLock(req.params.id, async () => {
  const upload = uploads.get(req.params.id);
  if (!upload) return fail(res, '上传任务不存在或已过期，请重新选择文件', 404, 404);
  if (upload.teacherId !== req.user.id) return fail(res, '无权上传到该任务', 403, 403);
  if (upload.taskId) return fail(res, '文件已提交处理，无需继续上传', 409, 409);
  const index = Number(req.params.index);
  if (!Number.isInteger(index) || index < 0 || index >= upload.totalChunks) return fail(res, '上传分片序号无效', 400, 400);
  // 重试同一片时直接返回当前进度，防止网络重发导致文件重复写入。
  if (upload.receivedChunks.has(index)) {
    return success(res, { received: upload.received, total: upload.size, receivedChunks: upload.receivedChunks.size }, '该分片已收到');
  }

  const offset = index * UPLOAD_CHUNK_SIZE;
  const expectedBytes = Math.min(UPLOAD_CHUNK_SIZE, upload.size - offset);
  // JSON 分片避开当前公网隧道对 application/octet-stream 的异常缓冲；
  // 同时保留二进制兼容入口，便于旧客户端平滑升级。
  const encoded = req.is('application/json') ? req.body?.data : null;
  const maxBase64Length = Math.ceil(expectedBytes / 3) * 4 + 4;
  if (typeof encoded === 'string' && encoded.length > maxBase64Length) {
    return fail(res, '上传分片内容异常，请重新上传该文件', 400, 400);
  }
  const chunk = typeof encoded === 'string'
    ? Buffer.from(encoded, 'base64')
    : await readRequestChunk(req, UPLOAD_CHUNK_SIZE);
  if (chunk.length !== expectedBytes) return fail(res, '上传分片大小异常，请重新上传该文件', 400, 400);
  const handle = await fs.open(upload.tempPath, 'r+');
  try {
    let written = 0;
    while (written < chunk.length) {
      const result = await handle.write(chunk, written, chunk.length - written, offset + written);
      if (!result.bytesWritten) throw new Error('写入文件失败，请重试');
      written += result.bytesWritten;
    }
  } finally {
    await handle.close();
  }
  upload.receivedChunks.add(index);
  upload.received += chunk.length;
  upload.createdAt = Date.now();
  return success(res, { received: upload.received, total: upload.size, receivedChunks: upload.receivedChunks.size });
})));

router.post('/import/upload/:id/complete', asyncHandler(async (req, res) => withUploadLock(req.params.id, async () => {
  const upload = uploads.get(req.params.id);
  if (!upload) return fail(res, '上传任务不存在或已过期，请重新选择文件', 404, 404);
  if (upload.teacherId !== req.user.id) return fail(res, '无权提交该上传任务', 403, 403);
  if (upload.taskId) return success(res, { taskId: upload.taskId }, '导入任务已创建');
  if (upload.received !== upload.size || upload.receivedChunks.size !== upload.totalChunks) {
    return fail(res, '文件尚未上传完整，请继续上传', 400, 400);
  }
  if (!await hasPdfSignature(upload.tempPath)) {
    await fs.unlink(upload.tempPath).catch(() => {});
    uploads.delete(upload.id);
    return fail(res, '文件格式无效，请选择未加密的 PDF 文件', 400, 400);
  }

  const task = await newTask(upload.teacherId, upload.filename, upload.courseTitle, upload.category, upload.tempPath);
  upload.taskId = task.id;
  return success(res, { taskId: task.id }, '导入任务已创建，请轮询进度');
})));

router.delete('/import/upload/:id', asyncHandler(async (req, res) => withUploadLock(req.params.id, async () => {
  const upload = uploads.get(req.params.id);
  if (!upload) return success(res, null, '上传任务已清理');
  if (upload.teacherId !== req.user.id) return fail(res, '无权取消该上传任务', 403, 403);
  if (!upload.taskId) await fs.unlink(upload.tempPath).catch(() => {});
  uploads.delete(upload.id);
  return success(res, null, '上传任务已取消');
})));

// 上传 PDF 并创建导入任务
router.post('/import/pdf', asyncHandler(async (req, res) => {
  // 兼容旧版前端的整文件上传；新版前端走上方分片接口。
  const contentType = req.headers['content-type'] || '';
  const dec = (s) => { try { return s ? decodeURIComponent(s) : ''; } catch { return s || ''; } };
  const filename = normalizeFilename(dec(req.headers['x-filename']));
  if (!contentType.includes('application/octet-stream') && !contentType.includes('application/pdf')) {
    return fail(res, '请以 PDF 二进制上传（Content-Type: application/pdf）', 400, 400);
  }
  if (!isPdfFilename(filename)) return fail(res, '请选择 PDF 文件', 400, 400);

  const ocr = await getOcrStatus();
  if (!ocr.ready) return fail(res, `PDF 识别服务未就绪：${ocr.message}`, 503, 503);

  const legacyId = `legacy-${crypto.randomBytes(12).toString('hex')}`;
  const { tempPath, bytes } = await writeRequestToTemp(req, legacyId);
  if (bytes < 512 || !await hasPdfSignature(tempPath)) {
    await fs.unlink(tempPath).catch(() => {});
    return fail(res, '文件格式无效，请选择未加密的 PDF 文件', 400, 400);
  }

  const task = await newTask(req.user.id, filename, dec(req.headers['x-course-title']), dec(req.headers['x-category']), tempPath);
  return success(res, { taskId: task.id }, '导入任务已创建，请轮询进度');
}));

// 查询任务进度
router.get('/import/task/:id', asyncHandler(async (req, res) => {
  const t = await findTask(req.params.id);
  if (!t) return fail(res, '任务不存在或已过期', 404, 404);
  if (t.teacherId !== req.user.id) return fail(res, '无权查看该任务', 403, 403);
  const { _pdfPath, ...safe } = t;
  void _pdfPath;
  return success(res, safe);
}));

// 服务重启后，OCR 前尚未建课的任务可从保留的临时 PDF 重新排队。
// 若课程基础内容已经写入数据库，则不重跑以避免重复建课，教师可直接进入课程补充资源。
router.post('/import/task/:id/resume', asyncHandler(async (req, res) => {
  const t = await findTask(req.params.id);
  if (!t) return fail(res, '任务不存在或已过期', 404, 404);
  if (t.teacherId !== req.user.id) return fail(res, '无权继续该任务', 403, 403);
  if (t.status !== 'interrupted') return fail(res, '当前任务无需继续处理', 409, 409);
  if (t.result?.courseId) {
    return success(res, { courseId: t.result.courseId }, '课程基础内容已生成，为避免重复建课，请进入课程页补充或重新生成资源');
  }
  if (!t._pdfPath || !await fs.stat(t._pdfPath).then(() => true).catch(() => false)) {
    await setTask(t, { status: 'failed', progress: 100, error: '保留的临时 PDF 已不存在，请重新上传文件。' });
    return fail(res, '保留的临时 PDF 已不存在，请重新上传文件。', 410, 410);
  }
  t.resumeCount = (t.resumeCount || 0) + 1;
  await setTask(t, { status: 'queued', progress: 0, error: null });
  importQueue.push(t);
  updateQueuePositions();
  drainImportQueue();
  return success(res, { taskId: t.id }, '任务已恢复并重新排队');
}));

// 清理过期任务（可选，简单 GC）
setInterval(() => {
  const now = Date.now();
  for (const [id, t] of tasks) {
    if (now - t.createdAt > 3600_000 && ['done', 'failed', 'rejected'].includes(t.status)) {
      discardTempPdf(t).catch(() => {});
      tasks.delete(id);
    }
  }
  for (const [id, upload] of uploads) {
    if (now - upload.createdAt > 3600_000) {
      // 已提交的会话不再拥有临时文件，文件由 task 统一清理。
      if (!upload.taskId) fs.unlink(upload.tempPath).catch(() => {});
      uploads.delete(id);
    }
  }
}, 600000).unref();

export default router;
