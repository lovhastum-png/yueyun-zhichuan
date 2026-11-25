/* ============================================================
   课程详情页（React 版）
   迁移自 public/course-detail.html + public/js/course-detail.js
   简介 / 视频 / 作业 / 考试 / 签到 / 讨论 多 Tab，教师/学生双视角
   ============================================================ */
import { useCallback, useEffect, useRef, useState } from 'react';
import { Link, Navigate, useNavigate, useSearchParams } from 'react-router-dom';
import { request } from '../shared/api';
import { getToken, getUser } from '../shared/auth';
import { toast } from '../shared/toast';
import { Modal } from '../shared/modal';
import { formatTime } from '../shared/format';
import { activateProps } from '../shared/a11y';
import { EmptyState } from '../shared/EmptyState';
import type { ApiResponse, Course } from '../shared/types';

type TabKey = 'intro' | 'video' | 'assignment' | 'exam' | 'attendance' | 'discussion';

const TABS: Array<{ key: TabKey; label: string }> = [
  { key: 'intro', label: '课程简介' },
  { key: 'video', label: '教学视频' },
  { key: 'assignment', label: '课程作业' },
  { key: 'exam', label: '在线考试' },
  { key: 'attendance', label: '课堂点名' },
  { key: 'discussion', label: '讨论提问' },
];

interface CourseDetailInfo extends Course {
  isTeacher?: boolean;
}

interface VideoItem {
  id: number;
  title: string;
  size: number;
  created_at: string;
}

interface AssignmentListItem {
  id: number;
  title: string;
  total_score: number;
  due_at?: string | null;
  submit_count?: number;
  my_status?: 'submitted' | 'graded' | null;
  my_score?: number | null;
}

interface ExamListItem {
  id: number;
  title: string;
  duration_min: number;
  total_score: number;
  question_count?: number | null;
  start_at?: string | null;
  end_at?: string | null;
  submit_count?: number;
  my_status?: 'submitted' | 'graded' | null;
  my_score?: number | null;
}

interface AttendanceItem {
  id: number;
  title?: string | null;
  status: 'active' | 'closed';
  start_at: string;
  code?: string;
  present_count?: number;
  late_count?: number;
  total_count?: number;
  my_status?: 'present' | 'late' | 'absent' | null;
}

interface AttendanceRecord {
  real_name?: string | null;
  username: string;
  status: 'present' | 'late' | 'absent';
}

interface PostItem {
  id: number;
  parent_id: number | null;
  user_id: number;
  user_role: string;
  real_name?: string | null;
  username: string;
  content: string;
  created_at: string;
}

interface AiAssignSuggestion {
  title?: string;
  description?: string;
  total_score?: number;
  suggested_questions?: string[];
}

// 课程详情页：URL 参数 ?id= 为课程 ID；登录与权限由路由层 / 后端接口保证
export function CourseDetailPage() {
  const [params] = useSearchParams();
  const courseId = params.get('id');
  const [course, setCourse] = useState<CourseDetailInfo | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<TabKey>('intro');

  useEffect(() => {
    document.title = '越韵智传 · 课程详情';
  }, []);

  const load = useCallback(async () => {
    if (!courseId) return;
    const res = await request<CourseDetailInfo>(`/course/${courseId}`);
    if (res.code !== 0) {
      setError(res.message || '课程不存在');
      return;
    }
    setCourse(res.data);
  }, [courseId]);

  useEffect(() => {
    load();
  }, [load]);

  if (!courseId) return <Navigate to="/courses" replace />;

  const isTeacher = !!course?.isTeacher;

  return (
    <>
      <main className="main">
        <div className="container" style={{ paddingTop: 8 }}>
          {!course && !error && (
            <div style={{ textAlign: 'center', padding: '80px 0' }}>
              <div className="spinner" style={{ margin: '0 auto' }} />
            </div>
          )}
          {error && (
            <EmptyState icon="失" text={error} />
          )}
          {course && (
            <>
              <CourseHeader course={course} isTeacher={isTeacher} />
              <div className="learn-tabs">
                {TABS.map((t) => (
                  <div
                    key={t.key}
                    className={`learn-tab ${t.key === activeTab ? 'active' : ''}`}
                    onClick={() => setActiveTab(t.key)}
                    {...activateProps(() => setActiveTab(t.key), t.label)}
                  >
                    {t.label}
                  </div>
                ))}
              </div>
              {course.id && (
                <Link to={`/course-reader?courseId=${course.id}`} className="btn btn-brush btn-lg ch-reader-btn">
                  精读学习 · 在线阅读全文 →
                </Link>
              )}
              <div>
                {activeTab === 'intro' && <IntroTab course={course} isTeacher={isTeacher} />}
                {activeTab === 'video' && <VideoTab courseId={courseId} isTeacher={isTeacher} />}
                {activeTab === 'assignment' && <AssignmentTab courseId={courseId} isTeacher={isTeacher} />}
                {activeTab === 'exam' && <ExamTab courseId={courseId} isTeacher={isTeacher} />}
                {activeTab === 'attendance' && <AttendanceTab courseId={courseId} isTeacher={isTeacher} />}
                {activeTab === 'discussion' && <DiscussionTab courseId={courseId} isTeacher={isTeacher} />}
              </div>
            </>
          )}
        </div>
      </main>
    </>
  );
}

// ---------- 课程头 ----------
function CourseHeader({ course, isTeacher }: { course: CourseDetailInfo; isTeacher: boolean }) {
  const teacherName = course.teacher_real_name || course.teacher_name || '';
  return (
    <div className="course-header">
      <div className="ch-mountains" aria-hidden="true" />
      <div className="ch-moon" aria-hidden="true" />
      <div className="ch-seal" aria-hidden="true">
        {(course.title || '课').replace(/\s/g, '').charAt(0)}
      </div>
      <div className="ch-main">
        <h1>{course.title}</h1>
        <div className="ch-sub">{course.subtitle || ''}</div>
        <div className="ch-meta">
          <span className="ch-teacher">
            <span className="teacher-avatar">{teacherName.charAt(0) || '师'}</span>
            {teacherName}
          </span>
          <span className="ch-divider" aria-hidden="true" />
          <span>{course.member_count || 0} 人修读</span>
          {course.code ? (
            <span className="ch-code">
              <em>选课码</em>
              {course.code}
            </span>
          ) : null}
          {isTeacher ? (
            <span className="role-tag teacher">教师视角</span>
          ) : (
            <span className="role-tag student">学生视角</span>
          )}
        </div>
      </div>
    </div>
  );
}

// ---------- 简介 ----------
function IntroTab({ course, isTeacher }: { course: CourseDetailInfo; isTeacher: boolean }) {
  return (
    <div className="scroll-frame">
      <div className="section-title">
        <span className="st-text">课程简介</span>
        <span className="st-line" />
      </div>
      <div className="intro-text">{course.description || '暂无简介'}</div>
      {!isTeacher && (
        <div style={{ textAlign: 'center', marginTop: 20 }}>
          <Link to="/audio" className="btn btn-brush">
            前往音韵识腔 · 练习听辨
          </Link>
        </div>
      )}
    </div>
  );
}

// ---------- 教学视频 ----------
function VideoTab({ courseId, isTeacher }: { courseId: string; isTeacher: boolean }) {
  const [list, setList] = useState<VideoItem[] | null>(null);
  const [showUpload, setShowUpload] = useState(false);
  const [playingId, setPlayingId] = useState<number | null>(null);

  const load = useCallback(async () => {
    const res = await request<VideoItem[]>(`/video/course/${courseId}`);
    setList(res.code === 0 && res.data ? res.data : []);
  }, [courseId]);

  useEffect(() => {
    load();
  }, [load]);

  const delVideo = async (id: number) => {
    if (!window.confirm('确认删除该视频？')) return;
    const r = await request(`/video/${id}`, { method: 'DELETE' });
    toast(r.message, r.code === 0 ? 'ok' : 'err');
    if (r.code === 0) load();
  };

  if (list === null) {
    return (
      <div style={{ textAlign: 'center', padding: 40 }}>
        <div className="spinner" style={{ margin: '0 auto' }} />
      </div>
    );
  }

  return (
    <div className="scroll-frame">
      <div className="section-title">
        <span className="st-text">教学视频</span>
        <span className="st-line" />
        {isTeacher && (
          <button
            className="btn btn-primary btn-sm"
            style={{ marginLeft: 'auto' }}
            onClick={() => setShowUpload(true)}
          >
            ＋ 上传视频
          </button>
        )}
      </div>
      {list.length === 0 ? (
        <EmptyState icon="空" text="暂无教学视频" />
      ) : (
        list.map((v) => (
          <div className="learn-item" key={v.id} style={{ cursor: 'pointer' }} onClick={() => setPlayingId(v.id)}>
            <div className="learn-item-icon">视</div>
            <div className="learn-item-main">
              <div className="learn-item-title">{v.title}</div>
              <div className="learn-item-meta">
                <span>{((v.size || 0) / 1024 / 1024).toFixed(1)} MB</span>
                <span>{formatTime(v.created_at)}</span>
              </div>
            </div>
            {isTeacher && (
              <button
                className="btn btn-ghost btn-sm"
                onClick={(e) => {
                  e.stopPropagation();
                  delVideo(v.id);
                }}
              >
                删除
              </button>
            )}
          </div>
        ))
      )}

      {showUpload && (
        <UploadVideoModal
          courseId={courseId}
          onClose={() => setShowUpload(false)}
          onUploaded={() => {
            setShowUpload(false);
            load();
          }}
        />
      )}
      {playingId !== null && <VideoPlayModal videoId={playingId} onClose={() => setPlayingId(null)} />}
    </div>
  );
}

function VideoPlayModal({ videoId, onClose }: { videoId: number; onClose: () => void }) {
  return (
    <Modal
      title="视频播放"
      onClose={onClose}
      actions={
        <button className="btn btn-ghost" onClick={onClose}>
          关闭
        </button>
      }
    >
      <video
        controls
        autoPlay
        style={{ width: '100%', borderRadius: 4, background: '#000' }}
        src={`/api/video/${videoId}/play`}
      />
    </Modal>
  );
}

// 视频上传走 FormData，共享 request 只支持 JSON，这里单独 fetch
function UploadVideoModal({
  courseId,
  onClose,
  onUploaded,
}: {
  courseId: string;
  onClose: () => void;
  onUploaded: () => void;
}) {
  const [title, setTitle] = useState('');
  const [desc, setDesc] = useState('');
  const fileRef = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);

  const submit = async () => {
    const file = fileRef.current?.files?.[0];
    if (!file) {
      toast('请选择视频文件', 'err');
      return;
    }
    const form = new FormData();
    form.append('video', file);
    form.append('title', title.trim() || file.name);
    form.append('description', desc.trim());
    setUploading(true);
    try {
      const token = getToken();
      const resp = await fetch(`/api/video/course/${courseId}`, {
        method: 'POST',
        headers: token ? { Authorization: `Bearer ${token}` } : undefined,
        body: form,
      });
      const r = (await resp
        .json()
        .catch(() => ({ code: resp.status, message: '上传失败' }))) as ApiResponse<unknown>;
      toast(r.message, r.code === 0 ? 'ok' : 'err');
      if (r.code === 0) {
        onUploaded();
        return;
      }
    } catch {
      toast('网络连接失败，请检查服务是否启动', 'err');
    }
    setUploading(false);
  };

  return (
    <Modal
      title="上传视频"
      onClose={onClose}
      actions={
        <button className="btn btn-primary" disabled={uploading} onClick={submit}>
          {uploading ? (
            <>
              <span
                className="spinner"
                style={{ width: 14, height: 14, borderWidth: 2, display: 'inline-block', verticalAlign: '-2px' }}
              />{' '}
              上传中…
            </>
          ) : (
            '上传'
          )}
        </button>
      }
    >
      <div className="field">
        <label className="field-label">视频标题</label>
        <input className="input" placeholder="如：徐派唱腔赏析" value={title} onChange={(e) => setTitle(e.target.value)} />
      </div>
      <div className="field">
        <label className="field-label">视频简介</label>
        <textarea className="textarea" placeholder="选填" value={desc} onChange={(e) => setDesc(e.target.value)} />
      </div>
      <div className="field">
        <label className="field-label">视频文件</label>
        <input type="file" accept="video/*" className="input" style={{ padding: 8 }} ref={fileRef} />
      </div>
      <div style={{ fontSize: 12, color: 'var(--ink-light)' }}>支持 mp4/webm/ogg/mov，最大 200MB</div>
    </Modal>
  );
}

// ---------- 课程作业 ----------
function AssignmentTab({ courseId, isTeacher }: { courseId: string; isTeacher: boolean }) {
  const navigate = useNavigate();
  const [list, setList] = useState<AssignmentListItem[] | null>(null);
  const [showCreate, setShowCreate] = useState(false);

  const load = useCallback(async () => {
    const res = await request<AssignmentListItem[]>(`/assignment/course/${courseId}`);
    setList(res.code === 0 && res.data ? res.data : []);
  }, [courseId]);

  useEffect(() => {
    load();
  }, [load]);

  if (list === null) {
    return (
      <div style={{ textAlign: 'center', padding: 40 }}>
        <div className="spinner" style={{ margin: '0 auto' }} />
      </div>
    );
  }

  return (
    <div className="scroll-frame">
      <div className="section-title">
        <span className="st-text">课程作业</span>
        <span className="st-line" />
        {isTeacher && (
          <button
            className="btn btn-primary btn-sm"
            style={{ marginLeft: 'auto' }}
            onClick={() => setShowCreate(true)}
          >
            ＋ 布置作业
          </button>
        )}
      </div>
      {list.length === 0 ? (
        <EmptyState icon="空" text="暂无作业" />
      ) : (
        list.map((a) => {
          let statusSeal: JSX.Element | null = null;
          if (isTeacher) {
            statusSeal = <span className="status-seal submitted">{a.submit_count || 0} 人提交</span>;
          } else if (a.my_status === 'submitted') {
            statusSeal = <span className="status-seal submitted">已提交</span>;
          } else if (a.my_status === 'graded') {
            statusSeal = <span className="status-seal graded">{a.my_score} 分</span>;
          } else {
            statusSeal = <span className="status-seal pending">待提交</span>;
          }
          return (
            <div
              className="learn-item"
              key={a.id}
              style={{ cursor: 'pointer' }}
              onClick={() => navigate(`/assignment?id=${a.id}`)}
            >
              <div className="learn-item-icon">业</div>
              <div className="learn-item-main">
                <div className="learn-item-title">{a.title}</div>
                <div className="learn-item-meta">
                  <span>满分 {a.total_score}</span>
                  {a.due_at ? <span>截止 {formatTime(a.due_at)}</span> : null}
                  {statusSeal}
                </div>
              </div>
            </div>
          );
        })
      )}

      {showCreate && (
        <CreateAssignModal
          courseId={courseId}
          onClose={() => setShowCreate(false)}
          onCreated={() => {
            setShowCreate(false);
            load();
          }}
        />
      )}
    </div>
  );
}

function CreateAssignModal({
  courseId,
  onClose,
  onCreated,
}: {
  courseId: string;
  onClose: () => void;
  onCreated: () => void;
}) {
  const [aiType, setAiType] = useState('listen');
  const [aiTopic, setAiTopic] = useState('');
  const [aiHint, setAiHint] = useState('输入主题后点「生成」，AI 将自动填充标题与要求');
  const [aiLoading, setAiLoading] = useState(false);
  const [title, setTitle] = useState('');
  const [desc, setDesc] = useState('');
  const [score, setScore] = useState('100');
  const [due, setDue] = useState('');
  const [submitting, setSubmitting] = useState(false);

  const aiGen = async () => {
    const topic = aiTopic.trim();
    if (!topic) {
      toast('请输入作业主题', 'err');
      return;
    }
    setAiLoading(true);
    setAiHint('AI 正构思作业，约 10-20 秒…');
    const r = await request<AiAssignSuggestion>('/ai-assist/assignment', {
      method: 'POST',
      body: { courseId, topic, type: aiType, requirements: '' },
      timeout: 120000,
    });
    setAiLoading(false);
    if (r.code !== 0 || !r.data) {
      setAiHint('生成失败：' + (r.message || '请重试'));
      toast(r.message || '生成失败', 'err');
      return;
    }
    const d = r.data;
    if (d.title) setTitle(d.title);
    if (d.description) setDesc(d.description);
    if (d.total_score) setScore(String(d.total_score));
    const sq =
      d.suggested_questions && d.suggested_questions.length
        ? '\n\n【思考要点】\n' + d.suggested_questions.map((q, i) => `${i + 1}. ${q}`).join('\n')
        : '';
    if (sq) setDesc((prev) => prev + sq);
    setAiHint('已生成，可在上方编辑修改');
    toast('AI 已生成作业内容', 'ok');
  };

  const submit = async () => {
    const t = title.trim();
    if (!t) {
      toast('请填写标题', 'err');
      return;
    }
    setSubmitting(true);
    const r = await request(`/assignment/course/${courseId}`, {
      method: 'POST',
      body: {
        title: t,
        description: desc.trim(),
        totalScore: parseInt(score) || 100,
        dueAt: due || null,
      },
    });
    setSubmitting(false);
    toast(r.message, r.code === 0 ? 'ok' : 'err');
    if (r.code === 0) onCreated();
  };

  return (
    <Modal
      title="布置作业"
      onClose={onClose}
      actions={
        <button className="btn btn-primary" disabled={submitting} onClick={submit}>
          发布
        </button>
      }
    >
      <div className="ai-assist-bar">
        <div className="ai-assist-title">AI 辅助出题</div>
        <div className="ai-assist-row">
          <select
            className="input"
            style={{ flex: '0 0 140px' }}
            value={aiType}
            onChange={(e) => setAiType(e.target.value)}
          >
            <option value="listen">听辨练习</option>
            <option value="analysis">唱段分析</option>
            <option value="essay">论述题</option>
            <option value="research">文献调研</option>
          </select>
          <input
            className="input"
            placeholder="主题，如：徐派小生唱腔特征"
            style={{ flex: 1 }}
            value={aiTopic}
            onChange={(e) => setAiTopic(e.target.value)}
          />
          <button className="btn btn-brush btn-sm" disabled={aiLoading} onClick={aiGen}>
            {aiLoading ? '生成中…' : '生成'}
          </button>
        </div>
        <div className="ai-assist-hint">{aiHint}</div>
      </div>
      <div className="field">
        <label className="field-label">作业标题</label>
        <input
          className="input"
          placeholder="如：越剧流派听辨练习"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
        />
      </div>
      <div className="field">
        <label className="field-label">作业要求</label>
        <textarea
          className="textarea"
          placeholder="详细描述作业内容与要求"
          value={desc}
          onChange={(e) => setDesc(e.target.value)}
        />
      </div>
      <div style={{ display: 'flex', gap: 12 }}>
        <div className="field" style={{ flex: 1 }}>
          <label className="field-label">总分</label>
          <input className="input" type="number" value={score} onChange={(e) => setScore(e.target.value)} />
        </div>
        <div className="field" style={{ flex: 1 }}>
          <label className="field-label">截止时间</label>
          <input className="input" type="datetime-local" value={due} onChange={(e) => setDue(e.target.value)} />
        </div>
      </div>
    </Modal>
  );
}

// ---------- 在线考试 ----------
function ExamTab({ courseId, isTeacher }: { courseId: string; isTeacher: boolean }) {
  const navigate = useNavigate();
  const [list, setList] = useState<ExamListItem[] | null>(null);
  const [showCreate, setShowCreate] = useState(false);

  const load = useCallback(async () => {
    const res = await request<ExamListItem[]>(`/exam/course/${courseId}`);
    setList(res.code === 0 && res.data ? res.data : []);
  }, [courseId]);

  useEffect(() => {
    load();
  }, [load]);

  if (list === null) {
    return (
      <div style={{ textAlign: 'center', padding: 40 }}>
        <div className="spinner" style={{ margin: '0 auto' }} />
      </div>
    );
  }

  const now = new Date();

  return (
    <div className="scroll-frame">
      <div className="section-title">
        <span className="st-text">在线考试</span>
        <span className="st-line" />
        {isTeacher && (
          <button
            className="btn btn-primary btn-sm"
            style={{ marginLeft: 'auto' }}
            onClick={() => setShowCreate(true)}
          >
            ＋ 创建考试
          </button>
        )}
      </div>
      {list.length === 0 ? (
        <EmptyState icon="空" text="暂无考试" />
      ) : (
        list.map((e) => {
          let statusSeal: JSX.Element | null = null;
          if (isTeacher) {
            statusSeal = <span className="status-seal submitted">{e.submit_count || 0} 人已交</span>;
          } else if (e.my_status === 'graded' || (e.my_status === 'submitted' && e.my_score !== null)) {
            statusSeal = <span className="status-seal graded">{e.my_score} 分</span>;
          } else if (e.my_status === 'submitted') {
            statusSeal = <span className="status-seal submitted">已提交</span>;
          } else if (e.end_at && now > new Date(e.end_at)) {
            statusSeal = <span className="status-seal closed">已结束</span>;
          } else {
            statusSeal = <span className="status-seal active">可作答</span>;
          }
          return (
            <div
              className="learn-item"
              key={e.id}
              style={{ cursor: 'pointer' }}
              onClick={() => navigate(`/exam?id=${e.id}`)}
            >
              <div className="learn-item-icon">考</div>
              <div className="learn-item-main">
                <div className="learn-item-title">{e.title}</div>
                <div className="learn-item-meta">
                  <span>时长 {e.duration_min} 分钟</span>
                  <span>满分 {e.total_score}</span>
                  {e.question_count != null ? <span>{e.question_count} 题</span> : null}
                  {e.start_at ? <span>开始 {formatTime(e.start_at)}</span> : null}
                  {statusSeal}
                </div>
              </div>
            </div>
          );
        })
      )}

      {showCreate && (
        <CreateExamModal
          courseId={courseId}
          onClose={() => setShowCreate(false)}
          onCreated={() => {
            setShowCreate(false);
            load();
          }}
        />
      )}
    </div>
  );
}

function CreateExamModal({
  courseId,
  onClose,
  onCreated,
}: {
  courseId: string;
  onClose: () => void;
  onCreated: () => void;
}) {
  const [title, setTitle] = useState('');
  const [desc, setDesc] = useState('');
  const [score, setScore] = useState('100');
  const [dur, setDur] = useState('30');
  const [start, setStart] = useState('');
  const [end, setEnd] = useState('');
  const [submitting, setSubmitting] = useState(false);

  const submit = async () => {
    const t = title.trim();
    if (!t) {
      toast('请填写标题', 'err');
      return;
    }
    setSubmitting(true);
    const r = await request(`/exam/course/${courseId}`, {
      method: 'POST',
      body: {
        title: t,
        description: desc.trim(),
        totalScore: parseInt(score) || 100,
        durationMin: parseInt(dur) || 30,
        startAt: start || null,
        endAt: end || null,
      },
    });
    setSubmitting(false);
    toast(r.message, r.code === 0 ? 'ok' : 'err');
    if (r.code === 0) onCreated();
  };

  return (
    <Modal
      title="创建考试"
      onClose={onClose}
      actions={
        <button className="btn btn-primary" disabled={submitting} onClick={submit}>
          创建
        </button>
      }
    >
      <div className="field">
        <label className="field-label">考试标题</label>
        <input className="input" placeholder="如期中测验" value={title} onChange={(e) => setTitle(e.target.value)} />
      </div>
      <div className="field">
        <label className="field-label">考试说明</label>
        <textarea className="textarea" placeholder="选填" value={desc} onChange={(e) => setDesc(e.target.value)} />
      </div>
      <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
        <div className="field" style={{ flex: 1, minWidth: 100 }}>
          <label className="field-label">总分</label>
          <input className="input" type="number" value={score} onChange={(e) => setScore(e.target.value)} />
        </div>
        <div className="field" style={{ flex: 1, minWidth: 100 }}>
          <label className="field-label">时长(分钟)</label>
          <input className="input" type="number" value={dur} onChange={(e) => setDur(e.target.value)} />
        </div>
      </div>
      <div style={{ display: 'flex', gap: 12 }}>
        <div className="field" style={{ flex: 1 }}>
          <label className="field-label">开始时间</label>
          <input className="input" type="datetime-local" value={start} onChange={(e) => setStart(e.target.value)} />
        </div>
        <div className="field" style={{ flex: 1 }}>
          <label className="field-label">结束时间</label>
          <input className="input" type="datetime-local" value={end} onChange={(e) => setEnd(e.target.value)} />
        </div>
      </div>
      <div style={{ fontSize: 12, color: 'var(--ink-light)' }}>创建后可在考试详情中添加题目</div>
    </Modal>
  );
}

// ---------- 课堂点名 ----------
function AttendanceTab({ courseId, isTeacher }: { courseId: string; isTeacher: boolean }) {
  const [list, setList] = useState<AttendanceItem[] | null>(null);
  const [signCode, setSignCode] = useState('');
  const [showOpenModal, setShowOpenModal] = useState(false);
  const [codeInfo, setCodeInfo] = useState<{ code: string; durationMin: number } | null>(null);
  const [recordsId, setRecordsId] = useState<number | null>(null);

  const load = useCallback(async () => {
    const res = await request<AttendanceItem[]>(`/attendance/course/${courseId}`);
    setList(res.code === 0 && res.data ? res.data : []);
  }, [courseId]);

  useEffect(() => {
    load();
  }, [load]);

  const sign = async () => {
    const code = signCode.trim();
    if (!code) {
      toast('请输入签到码', 'err');
      return;
    }
    const r = await request('/attendance/sign', { method: 'POST', body: { code } });
    toast(r.message, r.code === 0 ? 'ok' : 'err');
    if (r.code === 0) load();
  };

  const closeAtt = async (attId: number) => {
    const r = await request(`/attendance/${attId}/close`, { method: 'PUT' });
    toast(r.message, r.code === 0 ? 'ok' : 'err');
    if (r.code === 0) load();
  };

  if (list === null) {
    return (
      <div style={{ textAlign: 'center', padding: 40 }}>
        <div className="spinner" style={{ margin: '0 auto' }} />
      </div>
    );
  }

  return (
    <div className="scroll-frame">
      <div className="section-title">
        <span className="st-text">课堂点名</span>
        <span className="st-line" />
        {isTeacher && (
          <button
            className="btn btn-primary btn-sm"
            style={{ marginLeft: 'auto' }}
            onClick={() => setShowOpenModal(true)}
          >
            ＋ 开启签到
          </button>
        )}
      </div>

      {!isTeacher && (
        <div className="field" style={{ display: 'flex', gap: 10, alignItems: 'flex-end', marginBottom: 16 }}>
          <div style={{ flex: 1 }}>
            <label className="field-label">输入签到码</label>
            <input
              className="input"
              placeholder="4 位数字"
              maxLength={4}
              value={signCode}
              onChange={(e) => setSignCode(e.target.value)}
            />
          </div>
          <button className="btn btn-primary" onClick={sign}>
            签到
          </button>
        </div>
      )}

      {list.length === 0 ? (
        <EmptyState icon="空" text="暂无签到记录" />
      ) : (
        list.map((a) => {
          let statusSeal: JSX.Element | null = null;
          if (isTeacher) {
            statusSeal = (
              <>
                <span className={`status-seal ${a.status}`}>{a.status === 'active' ? '进行中' : '已关闭'}</span>
                <span>
                  出勤 {a.present_count || 0} / 迟到 {a.late_count || 0} / 共 {a.total_count || 0}
                </span>
              </>
            );
          } else if (a.my_status === 'present') {
            statusSeal = <span className="status-seal present">已签到</span>;
          } else if (a.my_status === 'late') {
            statusSeal = <span className="status-seal late">迟到</span>;
          } else if (a.my_status === 'absent') {
            statusSeal = <span className="status-seal absent">缺勤</span>;
          } else {
            statusSeal = <span className="status-seal pending">未签到</span>;
          }
          return (
            <div
              className="learn-item"
              key={a.id}
              style={isTeacher ? { cursor: 'pointer' } : undefined}
              onClick={isTeacher ? () => setRecordsId(a.id) : undefined}
            >
              <div className="learn-item-icon">到</div>
              <div className="learn-item-main">
                <div className="learn-item-title">{a.title || '课堂签到'}</div>
                <div className="learn-item-meta">
                  <span>{formatTime(a.start_at)}</span>
                  {isTeacher && a.status === 'active' ? <span className="course-code">码：{a.code}</span> : null}
                  {statusSeal}
                </div>
              </div>
              {isTeacher && a.status === 'active' && (
                <button
                  className="btn btn-ghost btn-sm"
                  onClick={(e) => {
                    e.stopPropagation();
                    closeAtt(a.id);
                  }}
                >
                  关闭
                </button>
              )}
            </div>
          );
        })
      )}

      {showOpenModal && (
        <OpenAttendanceModal
          courseId={courseId}
          onClose={() => setShowOpenModal(false)}
          onOpened={(code, durationMin) => {
            setShowOpenModal(false);
            setCodeInfo({ code, durationMin });
            load();
          }}
        />
      )}
      {codeInfo && (
        <Modal
          title="签到已开启"
          onClose={() => setCodeInfo(null)}
          actions={
            <button className="btn btn-primary" onClick={() => setCodeInfo(null)}>
              知道了
            </button>
          }
        >
          <div className="attendance-code-box">
            <div className="attendance-code">{codeInfo.code}</div>
            <div className="attendance-code-hint">请告知学生此签到码 · 有效期 {codeInfo.durationMin} 分钟</div>
          </div>
        </Modal>
      )}
      {recordsId !== null && <AttRecordsModal attId={recordsId} onClose={() => setRecordsId(null)} />}
    </div>
  );
}

function OpenAttendanceModal({
  courseId,
  onClose,
  onOpened,
}: {
  courseId: string;
  onClose: () => void;
  onOpened: (code: string, durationMin: number) => void;
}) {
  const [title, setTitle] = useState('课堂签到');
  const [dur, setDur] = useState('5');
  const [submitting, setSubmitting] = useState(false);

  const submit = async () => {
    setSubmitting(true);
    const r = await request<{ code: string }>(`/attendance/course/${courseId}`, {
      method: 'POST',
      body: { title: title.trim(), durationMin: parseInt(dur) || 5 },
    });
    setSubmitting(false);
    if (r.code === 0 && r.data) {
      onOpened(r.data.code, parseInt(dur) || 5);
    } else {
      toast(r.message, 'err');
    }
  };

  return (
    <Modal
      title="开启签到"
      onClose={onClose}
      actions={
        <button className="btn btn-primary" disabled={submitting} onClick={submit}>
          开启
        </button>
      }
    >
      <div className="field">
        <label className="field-label">签到标题</label>
        <input
          className="input"
          placeholder="如：第三次课签到"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
        />
      </div>
      <div className="field">
        <label className="field-label">有效时长（分钟）</label>
        <input className="input" type="number" value={dur} onChange={(e) => setDur(e.target.value)} />
      </div>
      <div style={{ fontSize: 12, color: 'var(--ink-light)' }}>系统将自动生成 4 位签到码，学生输入码签到</div>
    </Modal>
  );
}

function AttRecordsModal({ attId, onClose }: { attId: number; onClose: () => void }) {
  const [records, setRecords] = useState<AttendanceRecord[] | null>(null);

  useEffect(() => {
    let alive = true;
    (async () => {
      const r = await request<AttendanceRecord[]>(`/attendance/${attId}/records`);
      if (!alive) return;
      if (r.code !== 0) {
        toast(r.message, 'err');
        setRecords([]);
        return;
      }
      setRecords(r.data || []);
    })();
    return () => {
      alive = false;
    };
  }, [attId]);

  return (
    <Modal
      title="签到记录"
      onClose={onClose}
      actions={
        <button className="btn btn-ghost" onClick={onClose}>
          关闭
        </button>
      }
    >
      {records === null ? (
        <div style={{ textAlign: 'center', padding: 40 }}>
          <div className="spinner" style={{ margin: '0 auto' }} />
        </div>
      ) : (
        <>
          <div style={{ marginBottom: 14, fontSize: 13, color: 'var(--ink-light)' }}>
            出勤 <b style={{ color: 'var(--cyan)' }}>{records.filter((x) => x.status === 'present').length}</b> · 迟到{' '}
            <b style={{ color: 'var(--ochre)' }}>{records.filter((x) => x.status === 'late').length}</b> · 缺勤{' '}
            <b style={{ color: 'var(--cinnabar)' }}>{records.filter((x) => x.status === 'absent').length}</b>
          </div>
          <div style={{ maxHeight: '50vh', overflowY: 'auto' }}>
            {records.map((r, i) => (
              <div className="learn-item" style={{ marginBottom: 8, cursor: 'default' }} key={i}>
                <div className="learn-item-icon" style={{ fontSize: 14 }}>
                  {(r.real_name || r.username).charAt(0)}
                </div>
                <div className="learn-item-main">
                  <div className="learn-item-title" style={{ fontSize: 14 }}>
                    {r.real_name || r.username}
                  </div>
                </div>
                <span className={`status-seal ${r.status}`}>
                  {r.status === 'present' ? '出勤' : r.status === 'late' ? '迟到' : '缺勤'}
                </span>
              </div>
            ))}
          </div>
        </>
      )}
    </Modal>
  );
}

// ---------- 讨论提问 ----------
function DiscussionTab({ courseId, isTeacher }: { courseId: string; isTeacher: boolean }) {
  const [posts, setPosts] = useState<PostItem[] | null>(null);
  const [content, setContent] = useState('');
  const [posting, setPosting] = useState(false);
  const [replyTo, setReplyTo] = useState<PostItem | null>(null);

  const load = useCallback(async () => {
    const res = await request<PostItem[]>(`/discussion/course/${courseId}`);
    setPosts(res.code === 0 && res.data ? res.data : []);
  }, [courseId]);

  useEffect(() => {
    load();
  }, [load]);

  const publish = async () => {
    const c = content.trim();
    if (!c) {
      toast('内容不能为空', 'err');
      return;
    }
    setPosting(true);
    const r = await request(`/discussion/course/${courseId}`, { method: 'POST', body: { content: c } });
    setPosting(false);
    toast(r.message, r.code === 0 ? 'ok' : 'err');
    if (r.code === 0) {
      setContent('');
      load();
    }
  };

  const del = async (postId: number) => {
    if (!window.confirm('确认删除该帖？')) return;
    const r = await request(`/discussion/${postId}`, { method: 'DELETE' });
    toast(r.message, r.code === 0 ? 'ok' : 'err');
    if (r.code === 0) load();
  };

  if (posts === null) {
    return (
      <div style={{ textAlign: 'center', padding: 40 }}>
        <div className="spinner" style={{ margin: '0 auto' }} />
      </div>
    );
  }

  // 组装树：根帖 + 回复映射
  const root = posts.filter((p) => !p.parent_id);
  const replyMap: Record<number, PostItem[]> = {};
  posts
    .filter((p) => p.parent_id)
    .forEach((p) => {
      const key = p.parent_id as number;
      (replyMap[key] = replyMap[key] || []).push(p);
    });

  return (
    <div className="scroll-frame">
      <div className="section-title">
        <span className="st-text">讨论提问</span>
        <span className="st-line" />
      </div>
      <div className="field">
        <textarea
          className="textarea"
          placeholder="发帖提问或讨论…"
          style={{ minHeight: 80 }}
          value={content}
          onChange={(e) => setContent(e.target.value)}
        />
        <button className="btn btn-primary btn-sm" style={{ marginTop: 10 }} disabled={posting} onClick={publish}>
          发 布
        </button>
      </div>
      <div className="post-list" style={{ marginTop: 16 }}>
        {root.length === 0 ? (
          <EmptyState icon="寂" text="还没有人发言，来发第一条吧" />
        ) : (
          root.map((p) => (
            <PostNode
              key={p.id}
              post={p}
              replyMap={replyMap}
              depth={0}
              isTeacher={isTeacher}
              onReply={setReplyTo}
              onDelete={del}
            />
          ))
        )}
      </div>

      {replyTo && (
        <ReplyModal
          courseId={courseId}
          parent={replyTo}
          onClose={() => setReplyTo(null)}
          onReplied={() => {
            setReplyTo(null);
            load();
          }}
        />
      )}
    </div>
  );
}

function PostNode({
  post,
  replyMap,
  depth,
  isTeacher,
  onReply,
  onDelete,
}: {
  post: PostItem;
  replyMap: Record<number, PostItem[]>;
  depth: number;
  isTeacher: boolean;
  onReply: (p: PostItem) => void;
  onDelete: (id: number) => void;
}) {
  const replies = replyMap[post.id] || [];
  const isTeacherPost = post.user_role === 'teacher';
  const canDel = getUser()?.id === post.user_id || isTeacher;
  const name = post.real_name || post.username;

  return (
    <>
      <div className={`post-item ${isTeacherPost ? 'teacher-post' : ''} ${depth > 0 ? 'reply' : ''}`}>
        <div className="post-head">
          <div className={`post-avatar ${isTeacherPost ? 'teacher' : ''}`}>{name.charAt(0)}</div>
          <span className="post-author">
            {name}
            {isTeacherPost && (
              <span className="role-tag teacher" style={{ fontSize: 10, padding: '1px 6px' }}>
                师
              </span>
            )}
          </span>
          <span className="post-time">{formatTime(post.created_at)}</span>
        </div>
        <div className="post-content">{post.content}</div>
        <div style={{ marginTop: 8, display: 'flex', gap: 12 }}>
          <a style={{ fontSize: 12, color: 'var(--ink-light)', cursor: 'pointer' }} onClick={() => onReply(post)}>
            回复
          </a>
          {canDel && (
            <a style={{ fontSize: 12, color: 'var(--cinnabar)', cursor: 'pointer' }} onClick={() => onDelete(post.id)}>
              删除
            </a>
          )}
        </div>
      </div>
      {replies.map((r) => (
        <PostNode
          key={r.id}
          post={r}
          replyMap={replyMap}
          depth={depth + 1}
          isTeacher={isTeacher}
          onReply={onReply}
          onDelete={onDelete}
        />
      ))}
    </>
  );
}

function ReplyModal({
  courseId,
  parent,
  onClose,
  onReplied,
}: {
  courseId: string;
  parent: PostItem;
  onClose: () => void;
  onReplied: () => void;
}) {
  const [content, setContent] = useState('');
  const [submitting, setSubmitting] = useState(false);

  const submit = async () => {
    const c = content.trim();
    if (!c) {
      toast('内容不能为空', 'err');
      return;
    }
    setSubmitting(true);
    const r = await request(`/discussion/course/${courseId}`, {
      method: 'POST',
      body: { content: c, parentId: parent.id },
    });
    setSubmitting(false);
    toast(r.message, r.code === 0 ? 'ok' : 'err');
    if (r.code === 0) onReplied();
  };

  return (
    <Modal
      title="回复"
      onClose={onClose}
      actions={
        <button className="btn btn-primary" disabled={submitting} onClick={submit}>
          回复
        </button>
      }
    >
      <div className="field">
        <textarea
          className="textarea"
          placeholder="写下你的回复…"
          style={{ minHeight: 100 }}
          value={content}
          onChange={(e) => setContent(e.target.value)}
        />
      </div>
    </Modal>
  );
}
