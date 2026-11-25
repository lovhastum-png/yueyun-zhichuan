// 课程在线阅读内容：章节、知识卡片、随堂测验、原版PDF、教案、课件、知识图谱
// 挂载于 /api/course（多段路径，不与 course.js 的单段 /:id 冲突）
import { Router } from 'express';
import path from 'path';
import { existsSync, promises as fs } from 'fs';
import { fileURLToPath } from 'url';
import crypto from 'crypto';
import multer from 'multer';
import pool from '../db.js';
import { createKeyedLock } from '../utils/keyedLock.js';
const withResourceLock = createKeyedLock();
import { authRequired } from '../middleware/auth.js';
import { success, fail, asyncHandler } from '../middleware/error.js';
import { buildPptxBuffer, generateAndSave, markResourceFailed } from '../services/courseResources.js';

const router = Router();
router.use(authRequired);

// 再生任务内存状态（重启丢失则 GET 按 updated_at 超 5 分钟判 failed 兜底）
const regenErrors = new Map();
const regenState = new Map(); // key: `${courseId}:${type}` → { startedAt }
const REGEN_TIMEOUT = 5 * 60 * 1000;
const projectRoot = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const SLIDE_IMAGE_DIR = path.join(projectRoot, 'data', 'course-slide-images');
const PPT_WIDTH = 10;
const PPT_HEIGHT = 5.625;
const slideImageUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 5 * 1024 * 1024, files: 1 },
  fileFilter: (_req, file, cb) => cb(null, ['image/png', 'image/jpeg', 'image/webp'].includes(file.mimetype)),
});

function clamp(value, fallback, min, max) {
  const n = Number(value);
  return Number.isFinite(n) ? Math.max(min, Math.min(max, n)) : fallback;
}

function normalizePlacement(input = {}) {
  const w = clamp(input.w, 3, 0.8, PPT_WIDTH);
  const h = clamp(input.h, 2.1, 0.6, PPT_HEIGHT);
  return {
    x: clamp(input.x, 6.45, 0, PPT_WIDTH - w),
    y: clamp(input.y, 1.3, 0, PPT_HEIGHT - h),
    w, h,
  };
}

function imageExtension(file) {
  const head = file?.buffer?.subarray(0, 12) || Buffer.alloc(0);
  if (head.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return 'png';
  if (head[0] === 0xff && head[1] === 0xd8 && head[2] === 0xff) return 'jpg';
  if (head.subarray(0, 4).toString('ascii') === 'RIFF' && head.subarray(8, 12).toString('ascii') === 'WEBP') return 'webp';
  return null;
}

function pageImages(slides, pageIndex) {
  const images = slides?.images?.[String(pageIndex)];
  return Array.isArray(images) ? images : [];
}

function safeImageName(value) {
  return /^[a-f0-9-]{20,64}\.(png|jpg|webp)$/.test(String(value || '')) ? String(value) : null;
}

async function updateSlides(courseId, work) {
  const resource = await loadResource(courseId, 'slides');
  if (resource.status !== 'ready' || !resource.content?.pages?.length) {
    throw Object.assign(new Error('请先生成课件，再插入图片'), { status: 409 });
  }
  const slides = resource.content;
  if (!slides.images || typeof slides.images !== 'object') slides.images = {};
  const result = await work(slides);
  await pool.query(
    "UPDATE course_resources SET content = ?, updated_at = CURRENT_TIMESTAMP WHERE course_id = ? AND type = 'slides'",
    [JSON.stringify(slides), courseId],
  );
  return result;
}

// 校验访问权限：教师本人 或 已选课学生
async function assertCanAccess(res, courseId, userId) {
  const [rows] = await pool.query('SELECT id, teacher_id FROM courses WHERE id = ?', [courseId]);
  if (rows.length === 0) return { error: '课程不存在', status: 404 };
  const course = rows[0];
  if (course.teacher_id === userId) return {};
  const [m] = await pool.query('SELECT 1 FROM course_members WHERE course_id = ? AND student_id = ?', [courseId, userId]);
  if (m.length === 0) return { error: '请先加入该课程', status: 403 };
  return {};
}

// 校验教师本人（教案等专属资源）
async function assertTeacherOwn(courseId, userId) {
  const [rows] = await pool.query('SELECT id, teacher_id FROM courses WHERE id = ?', [courseId]);
  if (rows.length === 0) return { error: '课程不存在', status: 404 };
  if (rows[0].teacher_id !== userId) return { error: '该资源仅授课教师可访问', status: 403 };
  return {};
}

// 读 course_resources 单条，兼容重启残留的 generating 状态
async function loadResource(courseId, type) {
  const [rows] = await pool.query(
    'SELECT status, content, error_msg, updated_at FROM course_resources WHERE course_id = ? AND type = ?',
    [courseId, type]
  );
  if (rows.length === 0) return { status: 'none' };
  const row = rows[0];
  let status = row.status;
  const regenerating = regenState.has(`${courseId}:${type}`);
  if (status === 'generating' && !regenerating && Date.now() - new Date(row.updated_at).getTime() > REGEN_TIMEOUT) {
    status = 'failed'; // 服务器重启导致的残留状态
  }
  let content = null;
  try { content = typeof row.content === 'string' ? JSON.parse(row.content) : row.content; } catch { content = null; }
  return { status: regenerating ? 'generating' : status, content, error: row.error_msg, updatedAt: row.updated_at };
}

// 章节列表
router.get('/:courseId/lessons', asyncHandler(async (req, res) => {
  const courseId = Number(req.params.courseId);
  const check = await assertCanAccess(res, courseId, req.user.id);
  if (check.error) return fail(res, check.error, check.status, check.status);
  const [rows] = await pool.query(
    'SELECT id, title, chapter_no, sort_order FROM course_lessons WHERE course_id = ? ORDER BY chapter_no, sort_order, id',
    [courseId]
  );
  return success(res, rows);
}));

// 章节正文
router.get('/:courseId/lessons/:lessonId', asyncHandler(async (req, res) => {
  const courseId = Number(req.params.courseId);
  const lessonId = Number(req.params.lessonId);
  const check = await assertCanAccess(res, courseId, req.user.id);
  if (check.error) return fail(res, check.error, check.status, check.status);
  const [rows] = await pool.query(
    'SELECT id, title, chapter_no, sort_order, body, source_note FROM course_lessons WHERE id = ? AND course_id = ?',
    [lessonId, courseId]
  );
  if (rows.length === 0) return fail(res, '章节不存在', 404, 404);
  return success(res, rows[0]);
}));

// 知识卡片（复用 knowledge_chunks，source_type='course'）
router.get('/:courseId/cards', asyncHandler(async (req, res) => {
  const courseId = Number(req.params.courseId);
  const check = await assertCanAccess(res, courseId, req.user.id);
  if (check.error) return fail(res, check.error, check.status, check.status);
  const [rows] = await pool.query(
    'SELECT id, title, content, keywords FROM knowledge_chunks WHERE source_type = ? AND source_id = ? ORDER BY id',
    ['course', String(courseId)]
  );
  return success(res, rows);
}));

// 随堂测验：返回课程下最先创建的一个测验及题目（含答案用于即时对错）
router.get('/:courseId/quiz', asyncHandler(async (req, res) => {
  const courseId = Number(req.params.courseId);
  const check = await assertCanAccess(res, courseId, req.user.id);
  if (check.error) return fail(res, check.error, check.status, check.status);
  const [exams] = await pool.query(
    'SELECT id, title, description FROM exams WHERE course_id = ? ORDER BY id LIMIT 1',
    [courseId]
  );
  if (exams.length === 0) return success(res, { exam: null, questions: [] });
  const exam = exams[0];
  const [questions] = await pool.query(
    'SELECT id, type, content, options, answer, score FROM exam_questions WHERE exam_id = ? ORDER BY sort_order, id',
    [exam.id]
  );
  return success(res, {
    exam: { id: exam.id, title: exam.title, description: exam.description },
    questions,
    regenerating: regenState.has(`${courseId}:quizai`),
    error: regenErrors.get(`${courseId}:quizai`) || null,
  });
}));

// 原版 PDF：内联预览（浏览器自带下载），仅教师本人/已选课学生可访问
router.get('/:courseId/pdf', asyncHandler(async (req, res) => {
  const courseId = Number(req.params.courseId);
  const check = await assertCanAccess(res, courseId, req.user.id);
  if (check.error) return fail(res, check.error, check.status, check.status);
  const [rows] = await pool.query('SELECT id, title, pdf_path FROM courses WHERE id = ?', [courseId]);
  if (rows.length === 0) return fail(res, '课程不存在', 404, 404);
  const pdfRel = rows[0].pdf_path;
  if (!pdfRel) return fail(res, '该课程没有原版 PDF', 404, 404);

  const projectRoot = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
  const pdfDir = path.resolve(projectRoot, 'data', 'course-pdf');
  const filePath = path.resolve(projectRoot, pdfRel);
  // 防目录穿越：仅允许 data/course-pdf 目录内的文件
  if (!filePath.startsWith(`${pdfDir}${path.sep}`) || !existsSync(filePath)) {
    return fail(res, '原版 PDF 文件不存在', 404, 404);
  }
  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader('Content-Disposition', `inline; filename*=UTF-8''${encodeURIComponent(`${rows[0].title}.pdf`)}`);
  return res.sendFile(filePath);
}));

// ---------- 教案（教师本人专属） ----------
router.get('/:courseId/plan', asyncHandler(async (req, res) => {
  const courseId = Number(req.params.courseId);
  const check = await assertTeacherOwn(courseId, req.user.id);
  if (check.error) return fail(res, check.error, check.status, check.status);
  const r = await loadResource(courseId, 'plan');
  return success(res, {
    status: r.status,
    plan: r.status === 'ready' ? r.content : null,
    error: r.error,
    updatedAt: r.updatedAt,
  });
}));

// ---------- PPT 课件（师生可读） ----------
router.get('/:courseId/slides', asyncHandler(async (req, res) => {
  const courseId = Number(req.params.courseId);
  const check = await assertCanAccess(res, courseId, req.user.id);
  if (check.error) return fail(res, check.error, check.status, check.status);
  const r = await loadResource(courseId, 'slides');
  return success(res, {
    status: r.status,
    slides: r.status === 'ready' ? r.content : null,
    error: r.error,
    updatedAt: r.updatedAt,
  });
}));

// 课件插图只经鉴权接口读取，避免把教师上传的素材放到公开静态目录。
router.get('/:courseId/slides/images/:imageId', asyncHandler(async (req, res) => {
  const courseId = Number(req.params.courseId);
  const check = await assertCanAccess(res, courseId, req.user.id);
  if (check.error) return fail(res, check.error, check.status, check.status);
  const resource = await loadResource(courseId, 'slides');
  const match = Object.values(resource.content?.images || {}).flat().find((image) => image?.id === req.params.imageId);
  const fileName = safeImageName(match?.fileName);
  const filePath = fileName ? path.join(SLIDE_IMAGE_DIR, String(courseId), fileName) : null;
  if (!filePath || !existsSync(filePath)) return fail(res, '课件图片不存在', 404, 404);
  res.setHeader('Cache-Control', 'private, max-age=300');
  return res.sendFile(filePath);
}));

// 教师把本地 PNG/JPEG/WebP 放到当前课件页；坐标使用 PPT 的英寸坐标，预览与导出保持一致。
router.post('/:courseId/slides/images', slideImageUpload.single('image'), asyncHandler(async (req, res) => withResourceLock(`${req.params.courseId}:slides`, async () => {
  const courseId = Number(req.params.courseId);
  const check = await assertTeacherOwn(courseId, req.user.id);
  if (check.error) return fail(res, check.error, check.status, check.status);
  const pageIndex = Number(req.body?.pageIndex);
  if (!Number.isInteger(pageIndex) || pageIndex < 0) return fail(res, '课件页码无效', 400, 400);
  const ext = imageExtension(req.file);
  if (!req.file || !ext) return fail(res, '请选择不超过 5MB 的 PNG、JPEG 或 WebP 图片', 400, 400);

  const id = crypto.randomUUID();
  const fileName = `${id}.${ext}`;
  const dir = path.join(SLIDE_IMAGE_DIR, String(courseId));
  await fs.mkdir(dir, { recursive: true });
  const target = path.join(dir, fileName);
  await fs.writeFile(target, req.file.buffer, { flag: 'wx' });
  try {
    const image = await updateSlides(courseId, async (slides) => {
      if (pageIndex >= slides.pages.length) throw Object.assign(new Error('课件页码无效'), { status: 400 });
      const placement = normalizePlacement();
      const next = { id, fileName, name: String(req.file.originalname || '图片').slice(0, 120), ...placement };
      slides.images[String(pageIndex)] = [...pageImages(slides, pageIndex), next];
      return next;
    });
    return success(res, { image, pageIndex }, '图片已插入当前课件页');
  } catch (err) {
    await fs.unlink(target).catch(() => {});
    throw err;
  }
})));

router.patch('/:courseId/slides/images/:imageId', asyncHandler(async (req, res) => withResourceLock(`${req.params.courseId}:slides`, async () => {
  const courseId = Number(req.params.courseId);
  const check = await assertTeacherOwn(courseId, req.user.id);
  if (check.error) return fail(res, check.error, check.status, check.status);
  const image = await updateSlides(courseId, async (slides) => {
    for (const key of Object.keys(slides.images || {})) {
      const list = pageImages(slides, key);
      const found = list.find((item) => item?.id === req.params.imageId);
      if (found) {
        Object.assign(found, normalizePlacement({ ...found, ...req.body }));
        return found;
      }
    }
    throw Object.assign(new Error('课件图片不存在'), { status: 404 });
  });
  return success(res, { image }, '图片位置已更新');
})));

router.delete('/:courseId/slides/images/:imageId', asyncHandler(async (req, res) => withResourceLock(`${req.params.courseId}:slides`, async () => {
  const courseId = Number(req.params.courseId);
  const check = await assertTeacherOwn(courseId, req.user.id);
  if (check.error) return fail(res, check.error, check.status, check.status);
  const removed = await updateSlides(courseId, async (slides) => {
    for (const key of Object.keys(slides.images || {})) {
      const list = pageImages(slides, key);
      const found = list.find((item) => item?.id === req.params.imageId);
      if (found) {
        slides.images[key] = list.filter((item) => item?.id !== req.params.imageId);
        return found;
      }
    }
    throw Object.assign(new Error('课件图片不存在'), { status: 404 });
  });
  const fileName = safeImageName(removed.fileName);
  if (fileName) await fs.unlink(path.join(SLIDE_IMAGE_DIR, String(courseId), fileName)).catch(() => {});
  return success(res, null, '图片已移除');
})));

// ---------- 知识图谱（师生可读）：并集查询防同名全局实体丢点 ----------
router.get('/:courseId/graph', asyncHandler(async (req, res) => {
  const courseId = Number(req.params.courseId);
  const check = await assertCanAccess(res, courseId, req.user.id);
  if (check.error) return fail(res, check.error, check.status, check.status);
  const sourceId = `course:${courseId}`;
  const [nodes] = await pool.query(
    `SELECT DISTINCT e.id, e.name, e.type, e.description FROM kg_entities e
     WHERE e.source_id = ? OR e.id IN (
       SELECT head_id FROM kg_relations WHERE source_id = ?
       UNION
       SELECT tail_id FROM kg_relations WHERE source_id = ?
     )`,
    [sourceId, sourceId, sourceId]
  );
  const [edges] = await pool.query(
    'SELECT r.head_id, r.relation, r.tail_id FROM kg_relations r WHERE r.source_id = ?',
    [sourceId]
  );
  return success(res, { nodes, edges, regenerating: regenState.has(`${courseId}:graph`), error: regenErrors.get(`${courseId}:graph`) || null });
}));

// ---------- PPT 课件下载 .pptx ----------
router.get('/:courseId/slides/pptx', asyncHandler(async (req, res) => {
  const courseId = Number(req.params.courseId);
  const check = await assertCanAccess(res, courseId, req.user.id);
  if (check.error) return fail(res, check.error, check.status, check.status);
  const [rows] = await pool.query('SELECT title FROM courses WHERE id = ?', [courseId]);
  const r = await loadResource(courseId, 'slides');
  if (r.status !== 'ready' || !r.content?.pages?.length) {
    return fail(res, '该课程暂无可下载的课件', 404, 404);
  }
  const buf = await buildPptxBuffer(r.content, rows[0]?.title || '', courseId);
  res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.presentationml.presentation');
  res.setHeader('Content-Disposition', `attachment; filename*=UTF-8''${encodeURIComponent(`${rows[0]?.title || '课件'}-课件.pptx`)}`);
  return res.send(buf);
}));

// ---------- 单项重新生成（教师本人） ----------
router.post('/:courseId/regenerate/:type', asyncHandler(async (req, res) => withResourceLock(`${req.params.courseId}:${req.params.type}`, async () => {
  const courseId = Number(req.params.courseId);
  const type = req.params.type;
  if (!['plan', 'slides', 'graph', 'quizai'].includes(type)) {
    return fail(res, '未知的资源类型', 400, 400);
  }
  const check = await assertTeacherOwn(courseId, req.user.id);
  if (check.error) return fail(res, check.error, check.status, check.status);

  const key = `${courseId}:${type}`;
  if (regenState.has(key)) return success(res, { started: true }, '正在生成中，请稍候');

  // 清理旧数据 / 预置生成中状态
  if (type === 'plan' || type === 'slides') {
    await pool.query(
      `INSERT INTO course_resources (course_id, type, status, content)
       VALUES (?, ?, 'generating', '{}')
       ON DUPLICATE KEY UPDATE status = 'generating', error_msg = NULL, updated_at = CURRENT_TIMESTAMP`,
      [courseId, type]
    );
  }

  regenErrors.delete(key);

  regenState.set(key, { startedAt: Date.now() });
  generateAndSave(courseId, type)
    .catch(async (err) => {
      if (regenErrors.size >= 1000) regenErrors.delete(regenErrors.keys().next().value);
      regenErrors.set(key, String(err?.message || '生成失败，请重试').slice(0, 480));
      console.warn(`[courseContent] 重新生成失败 course=${courseId} type=${type}:`, err?.message || err);
      if (type === 'plan' || type === 'slides') {
        await markResourceFailed(courseId, type, err?.message || err).catch(() => {});
      }
    })
    .finally(() => regenState.delete(key));
  return success(res, { started: true }, '已开始生成，请稍后刷新查看');
})));

export default router;
