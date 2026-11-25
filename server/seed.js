// 越韵智传 · 演示数据初始化脚本
// 用法: node server/seed.js
// 幂等：重复执行不会重复创建，只会补全缺失数据
import bcrypt from 'bcryptjs';
import pool from './db.js';
import 'dotenv/config';

// 容错执行 ALTER TABLE（兼容已有旧库，字段已存在则忽略）
async function safeAlter(sql) {
  try {
    await pool.query(sql);
  } catch (e) {
    // 字段已存在 / 重复列名 等忽略
    if (!/Duplicate column|already exists|Duplicate key/i.test(e.message)) {
      console.warn('[ALTER] 跳过:', e.message);
    }
  }
}

async function ensureSchema() {
  // 兼容旧 users 表：补齐新增字段
  await safeAlter('ALTER TABLE users ADD COLUMN role ENUM(\'teacher\',\'student\') NOT NULL DEFAULT \'student\'');
  await safeAlter('ALTER TABLE users ADD COLUMN real_name VARCHAR(50) DEFAULT NULL');
  await safeAlter('ALTER TABLE users ADD COLUMN avatar VARCHAR(255) DEFAULT NULL');
  await safeAlter('ALTER TABLE users ADD COLUMN intro TEXT DEFAULT NULL');
  console.log('[seed] schema 检查完成');
}

// 获取或创建用户
async function getOrCreateUser({ username, password, role, realName, intro }) {
  const [rows] = await pool.query('SELECT id FROM users WHERE username = ?', [username]);
  if (rows.length > 0) {
    // 补全 role（旧用户可能没 role）
    await pool.query('UPDATE users SET role = COALESCE(NULLIF(role,\'\'), ?), real_name = COALESCE(real_name, ?), intro = COALESCE(intro, ?) WHERE id = ?',
      [role, realName, intro, rows[0].id]);
    return rows[0].id;
  }
  const hashed = await bcrypt.hash(password, 10);
  const [r] = await pool.query(
    'INSERT INTO users (username, password, role, real_name, intro) VALUES (?, ?, ?, ?, ?)',
    [username, hashed, role, realName, intro]
  );
  return r.insertId;
}

async function main() {
  await ensureSchema();

  console.log('[seed] 创建演示账号...');
  const teacherId = await getOrCreateUser({
    username: 'teacher', password: 'teacher123', role: 'teacher',
    realName: '王砚秋', intro: '越剧研究方向副教授，主讲《越剧流派赏析》',
  });
  const s1Id = await getOrCreateUser({
    username: 'student1', password: 'student123', role: 'student',
    realName: '林清音', intro: '戏剧影视文学专业学生',
  });
  const s2Id = await getOrCreateUser({
    username: 'student2', password: 'student123', role: 'student',
    realName: '苏墨白', intro: '表演专业学生，专攻小生',
  });
  console.log(`[seed] 教师 teacher(id=${teacherId}) / 学生 student1(id=${s1Id}) / 学生 student2(id=${s2Id})`);

  // 示例课程
  console.log('[seed] 创建示例课程...');
  let [courseRows] = await pool.query('SELECT id FROM courses WHERE teacher_id = ? AND title = ?', [teacherId, '越剧流派赏析']);
  let courseId;
  if (courseRows.length > 0) {
    courseId = courseRows[0].id;
  } else {
    const [r] = await pool.query(
      'INSERT INTO courses (teacher_id, title, subtitle, description, category, code) VALUES (?, ?, ?, ?, ?, ?)',
      [teacherId, '越剧流派赏析', '十二大流派唱腔与代表剧目精讲',
       '本课程系统讲授越剧十二大流派（袁、尹、范、傅、徐、戚、王、毕、陆、吕、金、张）的唱腔特征、创立背景与代表剧目，结合音频赏析与流派判定实践，培养学生的越剧鉴赏与辨派能力。',
       '流派唱腔', 'YYZC2026']);
    courseId = r.insertId;
  }
  console.log(`[seed] 课程《越剧流派赏析》id=${courseId}`);

  // 学生选课
  for (const sid of [s1Id, s2Id]) {
    await pool.query('INSERT IGNORE INTO course_members (course_id, student_id) VALUES (?, ?)', [courseId, sid]);
  }
  console.log('[seed] 学生已选课');

  // 示例作业
  console.log('[seed] 创建示例作业...');
  const [assignRows] = await pool.query('SELECT id FROM assignments WHERE course_id = ? AND title = ?', [courseId, '越剧流派听辨练习']);
  let assignId;
  if (assignRows.length > 0) {
    assignId = assignRows[0].id;
  } else {
    const due = new Date(Date.now() + 7 * 86400 * 1000);
    const [r] = await pool.query(
      'INSERT INTO assignments (course_id, title, description, total_score, due_at) VALUES (?, ?, ?, ?, ?)',
      [courseId, '越剧流派听辨练习', '请聆听下列三段越剧音频，分别写出唱词并判定所属流派，简述判定依据。\n\n1. 《红楼梦·宝玉哭灵》\n2. 《梁祝·十八相送》\n3. 《祥林嫂》', 100, due]);
    assignId = r.insertId;
  }

  // 示例考试
  console.log('[seed] 创建示例考试...');
  const [examRows] = await pool.query('SELECT id FROM exams WHERE course_id = ? AND title = ?', [courseId, '越剧流派赏析·期中测验']);
  let examId;
  if (examRows.length > 0) {
    examId = examRows[0].id;
  } else {
    const start = new Date(Date.now() - 86400 * 1000);
    const end = new Date(Date.now() + 30 * 86400 * 1000);
    const [r] = await pool.query(
      'INSERT INTO exams (course_id, title, description, total_score, duration_min, start_at, end_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
      [courseId, '越剧流派赏析·期中测验', '本测验涵盖越剧十二大流派的创立者、唱腔特征与代表剧目。', 100, 30, start, end]);
    examId = r.insertId;
  }

  // 考试题目（5 道）
  console.log('[seed] 创建考试题目...');
  const [qCount] = await pool.query('SELECT COUNT(*) AS c FROM exam_questions WHERE exam_id = ?', [examId]);
  if (qCount[0].c === 0) {
    const questions = [
      { type: 'single', content: '越剧"徐派"的创立者是？', options: ['徐玉兰', '徐天红', '徐铭', '徐志摩'], answer: [0], score: 10, sort: 1 },
      { type: 'single', content: '以下哪部是尹派的代表剧目？', options: ['《祥林嫂》', '《何文秀》', '《梁祝》', '《碧玉簪》'], answer: [1], score: 10, sort: 2 },
      { type: 'multiple', content: '越剧"四大名旦"流派包括？（多选）', options: ['袁派', '傅派', '王派', '戚派'], answer: [0, 1, 2, 3], score: 15, sort: 3 },
      { type: 'judge', content: '《红楼梦·宝玉哭灵》是徐派小生的代表作。', options: ['正确', '错误'], answer: [0], score: 10, sort: 4 },
      { type: 'short', content: '简述越剧"袁派"唱腔的主要特征及其艺术贡献。（不少于100字）', options: null, answer: null, score: 25, sort: 5 },
    ];
    for (const q of questions) {
      await pool.query(
        'INSERT INTO exam_questions (exam_id, type, content, options, answer, score, sort_order) VALUES (?, ?, ?, ?, ?, ?, ?)',
        [examId, q.type, q.content, JSON.stringify(q.options), JSON.stringify(q.answer), q.score, q.sort]
      );
    }
    console.log(`[seed] 已插入 ${questions.length} 道题目`);
  } else {
    console.log(`[seed] 题目已存在(${qCount[0].c}道)，跳过`);
  }

  // 示例讨论帖
  console.log('[seed] 创建示例讨论...');
  const [pCount] = await pool.query('SELECT COUNT(*) AS c FROM course_posts WHERE course_id = ?', [courseId]);
  if (pCount[0].c === 0) {
    const [pr] = await pool.query(
      'INSERT INTO course_posts (course_id, user_id, content) VALUES (?, ?, ?)',
      [courseId, s1Id, '请问老师，徐派和王派都演《红楼梦》，两者在唱腔处理上最大的区别是什么？']);
    await pool.query(
      'INSERT INTO course_posts (course_id, user_id, parent_id, content) VALUES (?, ?, ?, ?)',
      [courseId, teacherId, pr.insertId, '好问题。徐派（徐玉兰）小生高亢激昂、跌宕起伏，宝玉哭灵中以刚劲的"流水板"抒发悲愤；王派（王文娟）旦角秀美醇厚、细腻传神，林黛玉的唱段更重"慢板"的婉转哀怨。两者一刚一柔，互为映衬。']);
  }

  console.log('\n========================================');
  console.log('  演示数据初始化完成');
  console.log('  演示账号：');
  console.log('    教师 teacher / teacher123');
  console.log('    学生 student1 / student123');
  console.log('    学生 student2 / student123');
  console.log('========================================\n');
  process.exit(0);
}

main().catch(e => {
  console.error('[seed] 失败:', e);
  process.exit(1);
});
