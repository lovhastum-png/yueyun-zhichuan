-- ============================================================
-- 越韵智传 · 越剧教学平台 数据库初始化脚本
-- 使用方法: mysql -u root -p < server/sql/init.sql
-- ============================================================

CREATE DATABASE IF NOT EXISTS yueyun_db DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
USE yueyun_db;

-- ============================================================
-- 一、账号体系
-- ============================================================

-- 用户表（扩展 role / real_name / avatar / intro）
CREATE TABLE IF NOT EXISTS users (
  id INT AUTO_INCREMENT PRIMARY KEY,
  username VARCHAR(50) NOT NULL UNIQUE,
  password VARCHAR(255) NOT NULL,
  email VARCHAR(100) DEFAULT NULL,
  role ENUM('teacher','student') NOT NULL DEFAULT 'student',
  real_name VARCHAR(50) DEFAULT NULL,
  avatar VARCHAR(255) DEFAULT NULL,
  intro TEXT DEFAULT NULL,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_role (role)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ============================================================
-- 二、教学主链路
-- ============================================================

-- 课程表
CREATE TABLE IF NOT EXISTS courses (
  id INT AUTO_INCREMENT PRIMARY KEY,
  teacher_id INT NOT NULL,
  title VARCHAR(120) NOT NULL,
  subtitle VARCHAR(200) DEFAULT NULL,
  description TEXT DEFAULT NULL,
  cover VARCHAR(255) DEFAULT NULL,
  category VARCHAR(50) DEFAULT NULL,
  code VARCHAR(20) DEFAULT NULL COMMENT '选课码',
  status ENUM('open','closed') DEFAULT 'open',
  pdf_path VARCHAR(255) DEFAULT NULL COMMENT '原版PDF文件路径(相对项目根目录)',
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_teacher (teacher_id),
  INDEX idx_category (category),
  CONSTRAINT fk_course_teacher FOREIGN KEY (teacher_id) REFERENCES users(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- 课程在线阅读章节表（电子书/文档类课程正文）
CREATE TABLE IF NOT EXISTS course_lessons (
  id INT AUTO_INCREMENT PRIMARY KEY,
  course_id INT NOT NULL,
  title VARCHAR(200) NOT NULL COMMENT '章节标题',
  chapter_no INT DEFAULT 0 COMMENT '章序号',
  sort_order INT DEFAULT 0 COMMENT '排序',
  body LONGTEXT DEFAULT NULL COMMENT '章节正文(纯文本)',
  source_note VARCHAR(100) DEFAULT NULL COMMENT '来源标注',
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_lesson_course (course_id),
  CONSTRAINT fk_lesson_course FOREIGN KEY (course_id) REFERENCES courses(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- 选课关系表
CREATE TABLE IF NOT EXISTS course_members (
  id INT AUTO_INCREMENT PRIMARY KEY,
  course_id INT NOT NULL,
  student_id INT NOT NULL,
  joined_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY uk_course_student (course_id, student_id),
  INDEX idx_student (student_id),
  CONSTRAINT fk_cm_course FOREIGN KEY (course_id) REFERENCES courses(id) ON DELETE CASCADE,
  CONSTRAINT fk_cm_student FOREIGN KEY (student_id) REFERENCES users(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- 课程视频表
CREATE TABLE IF NOT EXISTS videos (
  id INT AUTO_INCREMENT PRIMARY KEY,
  course_id INT NOT NULL,
  title VARCHAR(150) NOT NULL,
  description TEXT DEFAULT NULL,
  file_path VARCHAR(500) NOT NULL,
  duration INT DEFAULT 0 COMMENT '秒',
  size BIGINT DEFAULT 0 COMMENT '字节',
  sort_order INT DEFAULT 0,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_course (course_id),
  CONSTRAINT fk_video_course FOREIGN KEY (course_id) REFERENCES courses(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- 作业表
CREATE TABLE IF NOT EXISTS assignments (
  id INT AUTO_INCREMENT PRIMARY KEY,
  course_id INT NOT NULL,
  title VARCHAR(150) NOT NULL,
  description TEXT DEFAULT NULL,
  total_score INT DEFAULT 100,
  due_at DATETIME DEFAULT NULL,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_course (course_id),
  CONSTRAINT fk_assign_course FOREIGN KEY (course_id) REFERENCES courses(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- 作业提交表
CREATE TABLE IF NOT EXISTS assignment_submissions (
  id INT AUTO_INCREMENT PRIMARY KEY,
  assignment_id INT NOT NULL,
  student_id INT NOT NULL,
  content TEXT DEFAULT NULL,
  attachment VARCHAR(500) DEFAULT NULL,
  score INT DEFAULT NULL,
  feedback TEXT DEFAULT NULL,
  status ENUM('pending','submitted','graded') DEFAULT 'pending',
  submitted_at DATETIME DEFAULT NULL,
  graded_at DATETIME DEFAULT NULL,
  UNIQUE KEY uk_assign_student (assignment_id, student_id),
  INDEX idx_student (student_id),
  CONSTRAINT fk_asub_assign FOREIGN KEY (assignment_id) REFERENCES assignments(id) ON DELETE CASCADE,
  CONSTRAINT fk_asub_student FOREIGN KEY (student_id) REFERENCES users(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- 点名会话表
CREATE TABLE IF NOT EXISTS attendances (
  id INT AUTO_INCREMENT PRIMARY KEY,
  course_id INT NOT NULL,
  teacher_id INT NOT NULL,
  code VARCHAR(8) NOT NULL COMMENT '签到码',
  title VARCHAR(100) DEFAULT NULL,
  start_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  end_at DATETIME DEFAULT NULL,
  status ENUM('active','closed') DEFAULT 'active',
  INDEX idx_course (course_id),
  INDEX idx_code (code),
  CONSTRAINT fk_att_course FOREIGN KEY (course_id) REFERENCES courses(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- 签到记录表
CREATE TABLE IF NOT EXISTS attendance_records (
  id INT AUTO_INCREMENT PRIMARY KEY,
  attendance_id INT NOT NULL,
  student_id INT NOT NULL,
  status ENUM('present','late','absent') DEFAULT 'absent',
  signed_at DATETIME DEFAULT NULL,
  UNIQUE KEY uk_att_student (attendance_id, student_id),
  CONSTRAINT fk_ar_att FOREIGN KEY (attendance_id) REFERENCES attendances(id) ON DELETE CASCADE,
  CONSTRAINT fk_ar_student FOREIGN KEY (student_id) REFERENCES users(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- 考试表
CREATE TABLE IF NOT EXISTS exams (
  id INT AUTO_INCREMENT PRIMARY KEY,
  course_id INT NOT NULL,
  title VARCHAR(150) NOT NULL,
  description TEXT DEFAULT NULL,
  total_score INT DEFAULT 100,
  duration_min INT DEFAULT 60 COMMENT '考试时长(分钟)',
  start_at DATETIME DEFAULT NULL,
  end_at DATETIME DEFAULT NULL,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_course (course_id),
  CONSTRAINT fk_exam_course FOREIGN KEY (course_id) REFERENCES courses(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- 考试题目表
CREATE TABLE IF NOT EXISTS exam_questions (
  id INT AUTO_INCREMENT PRIMARY KEY,
  exam_id INT NOT NULL,
  type ENUM('single','multiple','judge','short') NOT NULL COMMENT '单选/多选/判断/简答',
  content TEXT NOT NULL,
  options JSON DEFAULT NULL COMMENT '选项数组',
  answer JSON DEFAULT NULL COMMENT '正确答案(索引或文本)',
  score INT DEFAULT 5,
  sort_order INT DEFAULT 0,
  INDEX idx_exam (exam_id),
  CONSTRAINT fk_q_exam FOREIGN KEY (exam_id) REFERENCES exams(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- 考试提交表
CREATE TABLE IF NOT EXISTS exam_submissions (
  id INT AUTO_INCREMENT PRIMARY KEY,
  exam_id INT NOT NULL,
  student_id INT NOT NULL,
  answers JSON DEFAULT NULL COMMENT '学生答案',
  score INT DEFAULT NULL,
  status ENUM('in_progress','submitted','graded') DEFAULT 'in_progress',
  started_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  submitted_at DATETIME DEFAULT NULL,
  UNIQUE KEY uk_exam_student (exam_id, student_id),
  CONSTRAINT fk_esub_exam FOREIGN KEY (exam_id) REFERENCES exams(id) ON DELETE CASCADE,
  CONSTRAINT fk_esub_student FOREIGN KEY (student_id) REFERENCES users(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- 课程讨论表（支持回复）
CREATE TABLE IF NOT EXISTS course_posts (
  id INT AUTO_INCREMENT PRIMARY KEY,
  course_id INT NOT NULL,
  user_id INT NOT NULL,
  parent_id INT DEFAULT NULL COMMENT '回复的目标帖',
  content TEXT NOT NULL,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_course (course_id),
  INDEX idx_parent (parent_id),
  CONSTRAINT fk_cp_course FOREIGN KEY (course_id) REFERENCES courses(id) ON DELETE CASCADE,
  CONSTRAINT fk_cp_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
  CONSTRAINT fk_cp_parent FOREIGN KEY (parent_id) REFERENCES course_posts(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ============================================================
-- 三、实时通讯与画板
-- ============================================================

-- 聊天室消息表（持久化）
CREATE TABLE IF NOT EXISTS chat_messages (
  id INT AUTO_INCREMENT PRIMARY KEY,
  user_id INT NOT NULL,
  room VARCHAR(50) DEFAULT 'hall' COMMENT '聊天室频道',
  content TEXT NOT NULL,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_room_time (room, created_at),
  CONSTRAINT fk_cm_msg_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- 画板作品表
CREATE TABLE IF NOT EXISTS drawings (
  id INT AUTO_INCREMENT PRIMARY KEY,
  user_id INT NOT NULL,
  title VARCHAR(150) DEFAULT NULL,
  file_path VARCHAR(500) NOT NULL,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_user (user_id),
  CONSTRAINT fk_draw_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ============================================================
-- 四、AI 工具历史（保留原有）
-- ============================================================

-- 聊天历史表（按会话分组）
CREATE TABLE IF NOT EXISTS chat_history (
  id INT AUTO_INCREMENT PRIMARY KEY,
  user_id INT NOT NULL,
  session_id VARCHAR(64) NOT NULL,
  role ENUM('user','assistant') NOT NULL,
  message TEXT NOT NULL,
  sources JSON DEFAULT NULL,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_user_session (user_id, session_id),
  INDEX idx_created (created_at),
  CONSTRAINT fk_chat_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- 收藏表
CREATE TABLE IF NOT EXISTS favorites (
  id INT AUTO_INCREMENT PRIMARY KEY,
  user_id INT NOT NULL,
  item_type ENUM('chat','image') NOT NULL,
  target_id INT DEFAULT NULL,
  content TEXT DEFAULT NULL,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_user_type (user_id, item_type),
  CONSTRAINT fk_fav_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- 生图历史表
CREATE TABLE IF NOT EXISTS image_history (
  id INT AUTO_INCREMENT PRIMARY KEY,
  user_id INT NOT NULL,
  prompt TEXT NOT NULL,
  image_url TEXT NOT NULL,
  style VARCHAR(50) DEFAULT NULL,
  role VARCHAR(50) DEFAULT NULL,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_user (user_id),
  CONSTRAINT fk_img_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ============================================================
-- 八、AI Agent · 越剧知识库（RAG 向量检索）
-- ============================================================

-- 知识分块表：存储文本块 + embedding 向量
CREATE TABLE IF NOT EXISTS knowledge_chunks (
  id INT AUTO_INCREMENT PRIMARY KEY,
  source_id VARCHAR(64) NOT NULL COMMENT '来源标识（如卡片ID/课程ID）',
  source_type ENUM('card','course','play','document','school','role','makeup','heritage','history') NOT NULL DEFAULT 'card',
  title VARCHAR(120) NOT NULL,
  content TEXT NOT NULL,
  keywords JSON DEFAULT NULL COMMENT '辅助关键词',
  embedding LONGBLOB DEFAULT NULL COMMENT 'text-embedding-v3 向量（1024维 float32）',
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_source (source_type, source_id),
  INDEX idx_title (title)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ============================================================
-- 九、AI Agent · 越剧知识图谱
-- ============================================================

-- 实体表：人物/流派/剧目/行当/唱段/概念
CREATE TABLE IF NOT EXISTS kg_entities (
  id INT AUTO_INCREMENT PRIMARY KEY,
  name VARCHAR(100) NOT NULL COMMENT '实体名称',
  type ENUM('person','school','play','role','segment','concept') NOT NULL DEFAULT 'concept',
  description TEXT DEFAULT NULL COMMENT '实体描述',
  source_id VARCHAR(64) DEFAULT NULL COMMENT '来源知识块ID',
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY uk_name_type (name, type),
  INDEX idx_type (type),
  INDEX idx_name (name)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- 关系表：头实体-关系-尾实体
CREATE TABLE IF NOT EXISTS kg_relations (
  id INT AUTO_INCREMENT PRIMARY KEY,
  head_id INT NOT NULL COMMENT '头实体ID',
  relation VARCHAR(50) NOT NULL COMMENT '关系类型(创立/代表作/属于流派/演唱流派/选自/师承等)',
  tail_id INT NOT NULL COMMENT '尾实体ID',
  weight FLOAT DEFAULT 1.0 COMMENT '关系强度',
  source_id VARCHAR(64) DEFAULT NULL COMMENT '来源知识块ID',
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY uk_rel (head_id, relation, tail_id),
  INDEX idx_head (head_id),
  INDEX idx_tail (tail_id),
  INDEX idx_relation (relation),
  CONSTRAINT fk_kgrel_head FOREIGN KEY (head_id) REFERENCES kg_entities(id) ON DELETE CASCADE,
  CONSTRAINT fk_kgrel_tail FOREIGN KEY (tail_id) REFERENCES kg_entities(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ============================================================
-- 数据飞轮：高频问题审核入库（教师审核后自动加入 RAG 知识库）
-- ============================================================
CREATE TABLE IF NOT EXISTS knowledge_review (
  id INT AUTO_INCREMENT PRIMARY KEY,
  question_hash CHAR(64) NOT NULL COMMENT '问题归一化后的 SHA256，去重用',
  question TEXT NOT NULL COMMENT '用户原始问题',
  ask_count INT NOT NULL DEFAULT 1 COMMENT '累计被问次数',
  best_answer TEXT COMMENT '最佳 AI 回答（取最近一次完整回答）',
  best_sources JSON COMMENT 'AI 回答的来源标注',
  sample_session_id VARCHAR(64) COMMENT '采样会话ID',
  sample_user_id INT COMMENT '采样用户ID（仅用于追溯，不展示）',
  status ENUM('pending','approved','rejected') NOT NULL DEFAULT 'pending',
  reviewed_by INT DEFAULT NULL COMMENT '审核教师 user_id',
  reviewed_at DATETIME DEFAULT NULL,
  reject_reason VARCHAR(200) DEFAULT NULL,
  chunk_id INT DEFAULT NULL COMMENT '审核通过后入库到 knowledge_chunks 的记录ID',
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uk_qhash (question_hash),
  INDEX idx_status (status),
  INDEX idx_ask_count (ask_count),
  INDEX idx_reviewed (reviewed_by)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci COMMENT='高频问题审核入库（数据飞轮）';

-- 扩展 knowledge_chunks.source_type，新增 qa 类型（用户问答沉淀）
-- 注意：ENUM 修改需 ALTER，已在 init 之后的迁移脚本中处理；此处仅作注释说明
-- 实际 ALTER 语句：ALTER TABLE knowledge_chunks MODIFY COLUMN source_type ENUM('card','course','play','document','school','role','makeup','heritage','history','qa') NOT NULL DEFAULT 'card';

-- ============================================================
-- 十、PDF 导入课程 · AI 教学资源（教案 / PPT 课件）
-- ============================================================
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
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ============================================================
-- 初始化完成
-- 演示账号与示例课程由 node server/seed.js 创建（密码用 bcrypt 加密）
-- ============================================================
