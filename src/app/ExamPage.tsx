/* ============================================================
   考试详情页（React 版）
   迁移自 public/exam.html + public/js/exam.js
   教师出题管理（手动添加 / AI 一键出卷 / 批改 / AI 批改）
   学生答题（倒计时、多题型、暂存、交卷）
   ============================================================ */
import { useCallback, useEffect, useRef, useState } from 'react';
import { Link, Navigate, useSearchParams } from 'react-router-dom';
import { request } from '../shared/api';
import { toast } from '../shared/toast';
import { Modal } from '../shared/modal';
import { formatTime, confColor, confLabel } from '../shared/format';
import { EmptyState } from '../shared/EmptyState';
import { AiNotice } from '../shared/AiLabel';

type QuestionType = 'single' | 'multiple' | 'judge' | 'short';

const QUESTION_TYPE_LABELS: Record<QuestionType, string> = {
  single: '单选',
  multiple: '多选',
  judge: '判断',
  short: '简答',
};

interface ExamQuestion {
  id: number;
  type: QuestionType;
  content: string;
  options: string | string[] | null;
  answer?: string | null;
  score: number;
}

interface ExamDetail {
  id: number;
  course_id: number;
  title: string;
  description?: string | null;
  total_score: number;
  duration_min: number;
  start_at?: string | null;
  end_at?: string | null;
  isTeacher?: boolean;
  questions?: ExamQuestion[];
  my_submission?: { id: number; status: string; score: number | null } | null;
}

interface ExamSubmissionItem {
  id: number;
  status: string;
  score: number | null;
  submitted_at?: string | null;
  answers?: string | Record<string, unknown> | null;
  real_name?: string | null;
  username: string;
}

interface AiGenQuestion {
  type: QuestionType;
  content: string;
  options?: string[] | null;
  answer?: number[] | string[] | null;
  score?: number;
}

interface AiShortResult {
  score: number;
  maxScore: number;
  confidence: number;
  studentAnswer?: string;
  reference?: string;
  reason?: string;
  key_points?: string[];
  method?: string;
  sim_score?: number | null;
  llm_score?: number | null;
}

interface AiExamGrade {
  objectiveScore: number;
  maxObjective: number;
  shortScore: number;
  maxShort: number;
  totalScore: number;
  maxScore: number;
  confidence: number;
  needReview: boolean;
  shortResults?: AiShortResult[];
}

// 学生答案：客观题为选项下标数组，简答题为单元素文本数组（与旧版 answers 结构一致）
type StudentAnswers = Record<string, number[] | string[]>;

// options 字段可能是 JSON 字符串或数组，统一解析为数组
function parseOptions(v: string | string[] | null | undefined): string[] {
  if (v == null) return [];
  if (Array.isArray(v)) return v;
  if (typeof v === 'string') {
    try {
      const parsed = JSON.parse(v);
      return Array.isArray(parsed) ? parsed : [];
    } catch {
      return [];
    }
  }
  return [];
}

// answer 字段兼容 JSON 字符串 / 数组 / 标量
function parseAnswer(v: string | number[] | string[] | null | undefined): Array<number | string> | null {
  if (v == null) return null;
  if (typeof v === 'string') {
    try {
      const parsed = JSON.parse(v);
      return Array.isArray(parsed) ? parsed : [parsed];
    } catch {
      return [v];
    }
  }
  if (Array.isArray(v)) return v;
  return [v];
}

// 考试页：URL 参数 ?id= 为考试 ID；教师看出题管理，学生看结果或答题
export function ExamPage() {
  const [params] = useSearchParams();
  const id = params.get('id');
  const [exam, setExam] = useState<ExamDetail | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    document.title = '越韵智传 · 考试';
    // 补挂页面标识，供 atmosphere.css 定位卷首视差层（SPA 中手动补挂）
    const prevClass = document.body.className;
    document.body.className = 'page-exam';
    return () => {
      document.body.className = prevClass;
    };
  }, []);

  const load = useCallback(async () => {
    if (!id) return;
    const res = await request<ExamDetail>(`/exam/${id}`);
    if (res.code !== 0) {
      setError(res.message || '考试不存在');
      return;
    }
    setError(null);
    setExam(res.data);
  }, [id]);

  useEffect(() => {
    load();
  }, [load]);

  if (!id) return <Navigate to="/courses" replace />;

  const sub = exam?.my_submission;
  const finished = !!sub && (sub.status === 'graded' || sub.status === 'submitted');

  return (
    <>
      <main className="main">
        <div className="container" style={{ paddingTop: 8, maxWidth: 900 }}>
          {!exam && !error && (
            <div style={{ textAlign: 'center', padding: '80px 0' }}>
              <div className="spinner" style={{ margin: '0 auto' }} />
            </div>
          )}
          {error && (
            <EmptyState icon="失" text={error} />
          )}
          {exam && exam.isTeacher && <TeacherExamView exam={exam} reload={load} />}
          {exam && !exam.isTeacher && sub && finished && <ExamResultView exam={exam} sub={sub} />}
          {exam && !exam.isTeacher && !finished && <StudentExamView exam={exam} reload={load} />}
        </div>
      </main>
    </>
  );
}

// ============ 教师视角 ============
function TeacherExamView({ exam, reload }: { exam: ExamDetail; reload: () => void }) {
  const [showAddQ, setShowAddQ] = useState(false);
  const [showAiGen, setShowAiGen] = useState(false);
  const [showSubs, setShowSubs] = useState(false);
  const questions = exam.questions || [];

  const delQuestion = async (qid: number) => {
    if (!window.confirm('确认删除该题目？')) return;
    const r = await request(`/exam/question/${qid}`, { method: 'DELETE' });
    toast(r.message, r.code === 0 ? 'ok' : 'err');
    if (r.code === 0) reload();
  };

  return (
    <>
      <Link
        to={`/course-detail?id=${exam.course_id}`}
        style={{ display: 'inline-block', marginBottom: 16, fontSize: 13, color: 'var(--ink-light)' }}
      >
        ← 返回课程
      </Link>
      <div className="scroll-frame" style={{ marginBottom: 20 }}>
        <div className="section-title">
          <span className="st-text">{exam.title}</span>
          <span className="st-line" />
        </div>
        <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap', fontSize: 13, color: 'var(--ink-light)', marginBottom: 16 }}>
          <span>满分 {exam.total_score}</span>
          <span>时长 {exam.duration_min} 分钟</span>
          <span>{questions.length} 题</span>
          {exam.start_at ? <span>开始 {formatTime(exam.start_at)}</span> : null}
          {exam.end_at ? <span>结束 {formatTime(exam.end_at)}</span> : null}
        </div>
        <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
          <button className="btn btn-primary btn-sm" onClick={() => setShowAddQ(true)}>
            ＋ 添加题目
          </button>
          <button className="btn btn-brush btn-sm" onClick={() => setShowAiGen(true)}>
            AI 一键出卷
          </button>
          <button className="btn btn-ghost btn-sm" onClick={() => setShowSubs(true)}>
            查看提交
          </button>
        </div>
      </div>
      <div>
        {questions.length === 0 ? (
          <div className="scroll-frame">
            <EmptyState icon="空" text="还没有题目，点击「添加题目」" />
          </div>
        ) : (
          questions.map((q, i) => <TeacherQuestionCard key={q.id} q={q} index={i} onDelete={delQuestion} />)
        )}
      </div>

      {showAddQ && <AddQuestionModal examId={exam.id} onClose={() => setShowAddQ(false)} reload={reload} />}
      {showAiGen && <AiGenExamModal exam={exam} onClose={() => setShowAiGen(false)} reload={reload} />}
      {showSubs && <SubmissionsModal exam={exam} onClose={() => setShowSubs(false)} reload={reload} />}
    </>
  );
}

function TeacherQuestionCard({ q, index, onDelete }: { q: ExamQuestion; index: number; onDelete: (id: number) => void }) {
  const typeLabel = QUESTION_TYPE_LABELS[q.type] || q.type;
  const opts = parseOptions(q.options);
  const ans = parseAnswer(q.answer);
  let answerNode: JSX.Element | null = null;
  if (ans) {
    if (q.type === 'short') {
      answerNode = <div style={{ marginTop: 8, fontSize: 13, color: 'var(--gold)' }}>参考答案：{ans.join('')}</div>;
    } else {
      answerNode = (
        <div style={{ marginTop: 8, fontSize: 13, color: 'var(--gold)' }}>
          正确答案：
          {ans.map((idx) => `${String.fromCharCode(65 + Number(idx))}. ${opts[Number(idx)] || ''}`).join('；')}
        </div>
      );
    }
  }
  return (
    <div className="exam-question">
      <div className="exam-q-head">
        <span className="exam-q-no">{index + 1}</span>
        <span className="exam-q-type">{typeLabel}</span>
        <span className="exam-q-score">{q.score} 分</span>
      </div>
      <div className="exam-q-content">{q.content}</div>
      {opts.map((o, idx) => (
        <div className="exam-option" style={{ cursor: 'default' }} key={idx}>
          <span className="exam-option-mark">{String.fromCharCode(65 + idx)}</span>
          <span>{o}</span>
        </div>
      ))}
      {answerNode}
      <div style={{ marginTop: 12 }}>
        <button className="btn btn-ghost btn-sm" style={{ color: 'var(--cinnabar)' }} onClick={() => onDelete(q.id)}>
          删除题目
        </button>
      </div>
    </div>
  );
}

// 手动添加题目：题型切换联动选项/答案输入区
function AddQuestionModal({
  examId,
  onClose,
  reload,
}: {
  examId: number;
  onClose: () => void;
  reload: () => void;
}) {
  const [type, setType] = useState<QuestionType>('single');
  const [score, setScore] = useState('10');
  const [content, setContent] = useState('');
  const [shortAnswer, setShortAnswer] = useState('');
  const [judgeIdx, setJudgeIdx] = useState('0');
  const [optionsText, setOptionsText] = useState('');
  const [answerIdx, setAnswerIdx] = useState('');
  const [submitting, setSubmitting] = useState(false);

  const submit = async () => {
    const c = content.trim();
    if (!c) {
      toast('请输入题干', 'err');
      return;
    }
    let options: string[] | null = null;
    let answer: number[] | string[] | null = null;
    if (type === 'short') {
      const a = shortAnswer.trim();
      if (a) answer = [a];
    } else if (type === 'judge') {
      options = ['正确', '错误'];
      answer = [parseInt(judgeIdx)];
    } else {
      const optText = optionsText.trim();
      if (!optText) {
        toast('请输入选项', 'err');
        return;
      }
      options = optText.split('\n').map((s) => s.trim()).filter(Boolean);
      const ansStr = answerIdx.trim();
      answer = ansStr.split(',').map((s) => parseInt(s.trim())).filter((n) => !isNaN(n));
      if (answer.length === 0) {
        toast('请输入正确答案序号', 'err');
        return;
      }
    }
    setSubmitting(true);
    const r = await request(`/exam/${examId}/question`, {
      method: 'POST',
      body: { type, content: c, options, answer, score: parseInt(score) || 5 },
    });
    setSubmitting(false);
    toast(r.message, r.code === 0 ? 'ok' : 'err');
    if (r.code === 0) {
      onClose();
      reload();
    }
  };

  return (
    <Modal
      title="添加题目"
      onClose={onClose}
      actions={
        <button className="btn btn-primary" disabled={submitting} onClick={submit}>
          添加
        </button>
      }
    >
      <div className="field">
        <label className="field-label">题型</label>
        <select className="select" value={type} onChange={(e) => setType(e.target.value as QuestionType)}>
          <option value="single">单选题</option>
          <option value="multiple">多选题</option>
          <option value="judge">判断题</option>
          <option value="short">简答题</option>
        </select>
      </div>
      <div className="field">
        <label className="field-label">分值</label>
        <input className="input" type="number" value={score} onChange={(e) => setScore(e.target.value)} />
      </div>
      <div className="field">
        <label className="field-label">题干</label>
        <textarea
          className="textarea"
          placeholder="输入题目内容"
          value={content}
          onChange={(e) => setContent(e.target.value)}
        />
      </div>

      {type === 'short' && (
        <div className="field">
          <label className="field-label">参考答案（选填，供批改参考）</label>
          <textarea
            className="textarea"
            placeholder="参考答案"
            value={shortAnswer}
            onChange={(e) => setShortAnswer(e.target.value)}
          />
        </div>
      )}
      {type === 'judge' && (
        <>
          <div className="field">
            <label className="field-label">选项</label>
            <input className="input" value="正确" disabled style={{ marginBottom: 8 }} readOnly />
            <input className="input" value="错误" disabled readOnly />
          </div>
          <div className="field">
            <label className="field-label">正确答案</label>
            <select className="select" value={judgeIdx} onChange={(e) => setJudgeIdx(e.target.value)}>
              <option value="0">正确</option>
              <option value="1">错误</option>
            </select>
          </div>
        </>
      )}
      {(type === 'single' || type === 'multiple') && (
        <>
          <div className="field">
            <label className="field-label">选项（每行一个）</label>
            <textarea
              className="textarea"
              placeholder={'选项A\n选项B\n选项C\n选项D'}
              value={optionsText}
              onChange={(e) => setOptionsText(e.target.value)}
            />
          </div>
          <div className="field">
            <label className="field-label">
              正确答案{type === 'multiple' ? '（多选，填序号如 0,2）' : '（填序号 0/1/2/3）'}
            </label>
            <input
              className="input"
              placeholder={type === 'multiple' ? '0,2' : '1'}
              value={answerIdx}
              onChange={(e) => setAnswerIdx(e.target.value)}
            />
          </div>
        </>
      )}
    </Modal>
  );
}

// AI 一键出卷：生成后批量入库
function AiGenExamModal({ exam, onClose, reload }: { exam: ExamDetail; onClose: () => void; reload: () => void }) {
  const [topic, setTopic] = useState('');
  const [difficulty, setDifficulty] = useState('medium');
  const [single, setSingle] = useState('3');
  const [multiple, setMultiple] = useState('1');
  const [judge, setJudge] = useState('2');
  const [short, setShort] = useState('1');
  const [hint, setHint] = useState('总题数不超过 20 道，生成约需 20-40 秒');
  const [loading, setLoading] = useState(false);

  const go = async () => {
    const t = topic.trim();
    if (!t) {
      toast('请输入考试主题', 'err');
      return;
    }
    const types = {
      single: parseInt(single) || 0,
      multiple: parseInt(multiple) || 0,
      judge: parseInt(judge) || 0,
      short: parseInt(short) || 0,
    };
    const total = types.single + types.multiple + types.judge + types.short;
    if (total === 0) {
      toast('请至少选择一种题型', 'err');
      return;
    }
    setLoading(true);
    setHint('AI 正在生成题目，请耐心等待…');
    const r = await request<{ questions: AiGenQuestion[] }>('/ai-assist/exam', {
      method: 'POST',
      body: { courseId: exam.course_id, topic: t, types, difficulty },
      timeout: 120000,
    });
    if (r.code !== 0 || !r.data) {
      setLoading(false);
      setHint('生成失败：' + (r.message || '请重试'));
      toast(r.message || '生成失败', 'err');
      return;
    }
    const questions = r.data.questions || [];
    if (questions.length === 0) {
      setLoading(false);
      setHint('AI 未生成有效题目，请更换主题重试');
      toast('未生成有效题目', 'err');
      return;
    }
    setHint(`已生成 ${questions.length} 道，正在入库…`);
    const batch = questions.map((q) => ({
      type: q.type,
      content: q.content,
      options: q.options || null,
      answer: q.answer,
      score: q.score || (q.type === 'multiple' ? 8 : q.type === 'short' ? 20 : 5),
      sortOrder: 0,
    }));
    const br = await request<{ count: number }>(`/exam/${exam.id}/questions`, {
      method: 'POST',
      body: { questions: batch },
    });
    setLoading(false);
    if (br.code !== 0) {
      setHint('入库失败：' + (br.message || ''));
      toast(br.message || '入库失败', 'err');
      return;
    }
    toast(`AI 已生成并添加 ${br.data ? br.data.count : 0} 道题目`, 'ok');
    onClose();
    reload();
  };

  return (
    <Modal
      title="AI 一键出卷"
      onClose={onClose}
      actions={
        <button className="btn btn-primary" disabled={loading} onClick={go}>
          {loading ? 'AI 组卷中…' : '生成并添加'}
        </button>
      }
    >
      <div className="ai-assist-bar">
        <div className="ai-assist-title">AI 智能组卷</div>
        <div className="ai-assist-hint">基于课程信息与主题，AI 自动生成一套试卷，生成后可逐题编辑或删除。</div>
      </div>
      <AiNotice text="本试卷题目由人工智能生成，教师须逐题审核、修订后方可发布；AI 生成试题不得直接作为正式考核依据。" />
      <div className="field">
        <label className="field-label">考试主题</label>
        <input
          className="input"
          placeholder="如：越剧十二大流派唱腔特征"
          value={topic}
          onChange={(e) => setTopic(e.target.value)}
        />
      </div>
      <div className="field">
        <label className="field-label">难度</label>
        <select className="select" value={difficulty} onChange={(e) => setDifficulty(e.target.value)}>
          <option value="easy">基础识记</option>
          <option value="medium">理解应用</option>
          <option value="hard">综合分析</option>
        </select>
      </div>
      <div className="field">
        <label className="field-label">题型与数量</label>
        <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
          <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 14 }}>
            单选{' '}
            <input
              className="input"
              type="number"
              min={0}
              max={10}
              style={{ width: 64, padding: 6 }}
              value={single}
              onChange={(e) => setSingle(e.target.value)}
            />
          </label>
          <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 14 }}>
            多选{' '}
            <input
              className="input"
              type="number"
              min={0}
              max={10}
              style={{ width: 64, padding: 6 }}
              value={multiple}
              onChange={(e) => setMultiple(e.target.value)}
            />
          </label>
          <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 14 }}>
            判断{' '}
            <input
              className="input"
              type="number"
              min={0}
              max={10}
              style={{ width: 64, padding: 6 }}
              value={judge}
              onChange={(e) => setJudge(e.target.value)}
            />
          </label>
          <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 14 }}>
            简答{' '}
            <input
              className="input"
              type="number"
              min={0}
              max={5}
              style={{ width: 64, padding: 6 }}
              value={short}
              onChange={(e) => setShort(e.target.value)}
            />
          </label>
        </div>
      </div>
      <div className="ai-assist-hint">{hint}</div>
    </Modal>
  );
}

// 学生提交列表：点击批改，含简答题时可 AI 批改
function SubmissionsModal({ exam, onClose, reload }: { exam: ExamDetail; onClose: () => void; reload: () => void }) {
  const [list, setList] = useState<ExamSubmissionItem[] | null>(null);
  const [gradingSub, setGradingSub] = useState<ExamSubmissionItem | null>(null);
  const [aiGradingId, setAiGradingId] = useState<number | null>(null);
  const [aiResult, setAiResult] = useState<{ data: AiExamGrade; sub: ExamSubmissionItem } | null>(null);

  useEffect(() => {
    let alive = true;
    (async () => {
      const res = await request<ExamSubmissionItem[]>(`/exam/${exam.id}/submissions`);
      if (alive) setList(res.data || []);
    })();
    return () => {
      alive = false;
    };
  }, [exam.id]);

  const hasShort = (exam.questions || []).some((q) => q.type === 'short');

  const aiGrade = async (sid: number) => {
    const sub = (list || []).find((s) => s.id === sid);
    if (!sub) return;
    setAiGradingId(sid);
    toast('AI 正在批改简答题，约 20-40 秒…', 'info', 4000);
    const r = await request<AiExamGrade>(`/ai-assist/grade/exam/${sid}`, {
      method: 'POST',
      body: { autoCommit: false },
      timeout: 120000,
    });
    setAiGradingId(null);
    if (r.code !== 0 || !r.data) {
      toast(r.message || 'AI 批改失败', 'err');
      return;
    }
    setAiResult({ data: r.data, sub });
  };

  return (
    <>
      <Modal
        title="学生提交"
        onClose={onClose}
        actions={
          <button className="btn btn-ghost" onClick={onClose}>
            关闭
          </button>
        }
      >
        <div style={{ maxHeight: '60vh', overflowY: 'auto' }}>
          {list === null ? (
            <div style={{ textAlign: 'center', padding: 40 }}>
              <div className="spinner" style={{ margin: '0 auto' }} />
            </div>
          ) : list.length === 0 ? (
            <EmptyState icon="空" text="暂无学生提交" />
          ) : (
            list.map((s) => (
              <div className="learn-item" key={s.id} style={{ cursor: 'pointer' }} onClick={() => setGradingSub(s)}>
                <div className="learn-item-icon">{(s.real_name || s.username).charAt(0)}</div>
                <div className="learn-item-main">
                  <div className="learn-item-title">{s.real_name || s.username}</div>
                  <div className="learn-item-meta">
                    <span>提交于 {formatTime(s.submitted_at)}</span>
                    {s.status === 'graded' ? (
                      <span className="status-seal graded">{s.score ?? '—'} 分</span>
                    ) : (
                      <span className="status-seal submitted">待批改</span>
                    )}
                  </div>
                </div>
                {hasShort && (
                  <button
                    className="btn btn-brush btn-sm ai-grade-btn"
                    style={{ marginRight: 8 }}
                    disabled={aiGradingId === s.id}
                    onClick={(e) => {
                      e.stopPropagation();
                      aiGrade(s.id);
                    }}
                  >
                    {aiGradingId === s.id ? 'AI 批改中…' : 'AI 批改'}
                  </button>
                )}
              </div>
            ))
          )}
        </div>
      </Modal>

      {gradingSub && <GradeModal exam={exam} sub={gradingSub} onClose={() => setGradingSub(null)} reload={reload} />}
      {aiResult && (
        <AiExamGradeModal
          data={aiResult.data}
          sub={aiResult.sub}
          onClose={() => setAiResult(null)}
          onDone={() => {
            setAiResult(null);
            onClose();
            reload();
          }}
        />
      )}
    </>
  );
}

// 教师手动批改：查看学生逐题作答并给分
function GradeModal({
  exam,
  sub,
  onClose,
  reload,
}: {
  exam: ExamDetail;
  sub: ExamSubmissionItem;
  onClose: () => void;
  reload: () => void;
}) {
  const [score, setScore] = useState(sub.score != null ? String(sub.score) : '');
  const [submitting, setSubmitting] = useState(false);

  let ans: Record<string, unknown> = {};
  if (sub.answers) {
    if (typeof sub.answers === 'string') {
      try {
        ans = JSON.parse(sub.answers) as Record<string, unknown>;
      } catch {
        ans = {};
      }
    } else {
      ans = sub.answers;
    }
  }

  const submit = async () => {
    const s = parseInt(score);
    if (isNaN(s)) {
      toast('请输入分数', 'err');
      return;
    }
    setSubmitting(true);
    const r = await request(`/exam/submission/${sub.id}/grade`, { method: 'PUT', body: { score: s } });
    setSubmitting(false);
    toast(r.message, r.code === 0 ? 'ok' : 'err');
    if (r.code === 0) {
      onClose();
      reload();
    }
  };

  return (
    <Modal
      title="批改试卷"
      onClose={onClose}
      actions={
        <button className="btn btn-primary" disabled={submitting} onClick={submit}>
          提交评分
        </button>
      }
    >
      <div style={{ fontSize: 14, marginBottom: 12 }}>
        学生：<b>{sub.real_name || sub.username}</b>
      </div>
      <div style={{ maxHeight: 300, overflowY: 'auto', marginBottom: 16 }}>
        {(exam.questions || []).map((q, i) => {
          const ua = ans[String(q.id)];
          let uaText = '（未作答）';
          if (ua !== undefined) {
            if (q.type === 'short') {
              uaText = Array.isArray(ua) ? ua.join('') : String(ua);
            } else {
              const opts = parseOptions(q.options);
              uaText = (Array.isArray(ua) ? ua : [ua])
                .map((idx) => `${String.fromCharCode(65 + Number(idx))}. ${opts[Number(idx)] || ''}`)
                .join('；');
            }
          }
          return (
            <div style={{ marginBottom: 10, padding: 10, background: 'var(--ink-5)', borderRadius: 4 }} key={q.id}>
              <b>
                {i + 1}. {q.content}
              </b>
              <br />
              <span style={{ fontSize: 13, color: 'var(--ink-light)' }}>作答：{uaText}</span>
            </div>
          );
        })}
      </div>
      <div className="field">
        <label className="field-label">总分</label>
        <input
          className="input"
          type="number"
          value={score}
          placeholder={`0-${exam.total_score}`}
          onChange={(e) => setScore(e.target.value)}
        />
      </div>
    </Modal>
  );
}

// AI 批改结果：明细 + 采纳写入
function AiExamGradeModal({
  data,
  sub,
  onClose,
  onDone,
}: {
  data: AiExamGrade;
  sub: ExamSubmissionItem;
  onClose: () => void;
  onDone: () => void;
}) {
  const [committing, setCommitting] = useState(false);

  const commit = async () => {
    setCommitting(true);
    const r = await request(`/ai-assist/grade/exam/${sub.id}`, {
      method: 'POST',
      body: { autoCommit: true },
      timeout: 120000,
    });
    setCommitting(false);
    if (r.code !== 0) {
      toast(r.message || '写入失败', 'err');
      return;
    }
    toast(r.message || '已写入', 'ok');
    onDone();
  };

  const shortResults = data.shortResults || [];

  return (
    <Modal
      title={`AI 批改结果 · ${sub.real_name || sub.username}`}
      onClose={onClose}
      actions={
        <button className="btn btn-primary" disabled={committing} onClick={commit}>
          采纳并写入
        </button>
      }
    >
      <div className="ai-grade-summary">
        <div className="ags-row">
          <span>客观题得分：</span>
          <b>
            {data.objectiveScore}/{data.maxObjective}
          </b>
        </div>
        <div className="ags-row">
          <span>简答题 AI 评分：</span>
          <b>
            {data.shortScore}/{data.maxShort}
          </b>
        </div>
        <div className="ags-row ags-total">
          <span>合计建议总分：</span>
          <b>
            {data.totalScore}/{data.maxScore}
          </b>
        </div>
        <div className="ags-row">
          <span>综合置信度：</span>
          <b style={{ color: confColor(data.confidence) }}>{data.confidence}</b>{' '}
          {data.needReview ? (
            <span className="tag tag-cinnabar" style={{ marginLeft: 8 }}>
              建议人工复核
            </span>
          ) : (
            <span className="tag tag-cyan" style={{ marginLeft: 8 }}>
              可信
            </span>
          )}
        </div>
      </div>
      {shortResults.length > 0 ? (
        <>
          <div className="brush-divider" style={{ margin: '16px 0' }} />
          <div style={{ fontSize: 14, color: 'var(--ink-light)', marginBottom: 8 }}>简答题批改明细</div>
          {shortResults.map((r, i) => (
            <div className="ai-grade-item" key={i}>
              <div className="agi-head">
                <span className="agi-q">第{i + 1}题（简答）</span>
                <span className="agi-score">
                  {r.score}/{r.maxScore}
                </span>
                <span className="agi-conf" style={{ color: confColor(r.confidence), borderColor: confColor(r.confidence) }}>
                  置信度{confLabel(r.confidence)}({r.confidence})
                </span>
              </div>
              <div className="agi-row">
                <b>学生作答：</b>
                {r.studentAnswer || '（未作答）'}
              </div>
              <div className="agi-row">
                <b>参考答案：</b>
                {r.reference || '（无）'}
              </div>
              <div className="agi-row">
                <b>AI 评语：</b>
                {r.reason || ''}
              </div>
              {r.key_points && r.key_points.length > 0 ? (
                <div className="agi-row">
                  <b>命中要点：</b>
                  {r.key_points.map((p, j) => (
                    <span key={j}>
                      <span className="tag tag-cyan">{p}</span>{' '}
                    </span>
                  ))}
                </div>
              ) : null}
              <div className="agi-meta">
                方法：
                {r.method === 'vector+llm' ? '向量检索+LLM双判定' : r.method === 'llm_only' ? '仅LLM判定' : r.method} ｜
                向量相似度：{r.sim_score ?? '—'} ｜ LLM 给分：{r.llm_score ?? '—'}
              </div>
            </div>
          ))}
        </>
      ) : (
        <div style={{ textAlign: 'center', color: 'var(--ink-light)', padding: 20 }}>本试卷无简答题</div>
      )}
    </Modal>
  );
}

// ============ 学生视角：答题 ============
function StudentExamView({ exam, reload }: { exam: ExamDetail; reload: () => void }) {
  const [answers, setAnswers] = useState<StudentAnswers>({});
  const answersRef = useRef<StudentAnswers>({});
  const [leftSec, setLeftSec] = useState<number | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const submittingRef = useRef(false);
  const examRef = useRef(exam);
  examRef.current = exam;

  const setAnswer = (qid: string, val: number[] | string[]) => {
    answersRef.current = { ...answersRef.current, [qid]: val };
    setAnswers(answersRef.current);
  };

  const submitExam = useCallback(async () => {
    if (submittingRef.current) return; // 防重复提交
    // 若未开始则先 start
    if (!examRef.current.my_submission) {
      const sr = await request(`/exam/${examRef.current.id}/start`, { method: 'POST' });
      if (sr.code !== 0) {
        toast(sr.message, 'err');
        return;
      }
    }
    if (!window.confirm('确认交卷？提交后不可修改')) return;
    submittingRef.current = true;
    setSubmitting(true);
    const r = await request(`/exam/${examRef.current.id}/submit`, {
      method: 'POST',
      body: { answers: answersRef.current },
    });
    submittingRef.current = false;
    setSubmitting(false);
    toast(r.message, r.code === 0 ? 'ok' : 'err');
    if (r.code === 0) reload();
  }, [reload]);

  const submitRef = useRef(submitExam);
  submitRef.current = submitExam;

  // 倒计时：与旧版一致，进入答题页即开始计时；到点自动交卷；卸载时清理
  useEffect(() => {
    const end = Date.now() + exam.duration_min * 60 * 1000;
    const tick = setInterval(() => {
      const left = Math.max(0, (end - Date.now()) / 1000);
      setLeftSec(Math.floor(left));
      if (left <= 0) {
        clearInterval(tick);
        toast('考试时间到，自动交卷', 'err');
        submitRef.current();
      }
    }, 1000);
    return () => clearInterval(tick);
  }, [exam.id, exam.duration_min]);

  const toggleOption = (q: ExamQuestion, idx: number) => {
    const qid = String(q.id);
    if (q.type === 'multiple') {
      const cur = (answersRef.current[qid] as number[] | undefined) ?? [];
      const pos = cur.indexOf(idx);
      setAnswer(qid, pos >= 0 ? cur.filter((i) => i !== idx) : [...cur, idx]);
    } else {
      setAnswer(qid, [idx]);
    }
  };

  const selectedIdxs = (qid: string): number[] => {
    const v = answers[qid];
    return Array.isArray(v) ? (v as number[]) : [];
  };

  const timerText =
    leftSec === null
      ? '--:--'
      : `${String(Math.floor(leftSec / 60)).padStart(2, '0')}:${String(leftSec % 60).padStart(2, '0')}`;

  return (
    <>
      <Link
        to={`/course-detail?id=${exam.course_id}`}
        style={{ display: 'inline-block', marginBottom: 16, fontSize: 13, color: 'var(--ink-light)' }}
      >
        ← 返回课程
      </Link>
      <div className="scroll-frame" style={{ marginBottom: 20 }}>
        <div className="section-title">
          <span className="st-text">{exam.title}</span>
          <span className="st-line" />
        </div>
        <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap', fontSize: 13, color: 'var(--ink-light)', marginBottom: 16 }}>
          <span>满分 {exam.total_score}</span>
          <span>时长 {exam.duration_min} 分钟</span>
          <span>{(exam.questions || []).length} 题</span>
        </div>
        <div style={{ fontSize: 15, lineHeight: 1.8, color: 'var(--ink-soft)' }}>
          {exam.description || '请仔细作答，提交后不可修改'}
        </div>
      </div>
      <div className="exam-timer">
        <span className="exam-timer-clock">{timerText}</span>
        <span style={{ fontSize: 13, color: 'var(--ink-light)' }}>剩余时间</span>
      </div>
      <div className="exam-paper">
        {(exam.questions || []).map((q, i) => {
          const typeLabel = QUESTION_TYPE_LABELS[q.type];
          const opts = parseOptions(q.options);
          const isMulti = q.type === 'multiple';
          const isShort = q.type === 'short';
          const qid = String(q.id);
          return (
            <div className="exam-question" key={q.id}>
              <div className="exam-q-head">
                <span className="exam-q-no">{i + 1}</span>
                <span className="exam-q-type">{typeLabel}</span>
                <span className="exam-q-score">{q.score} 分</span>
              </div>
              <div className="exam-q-content">{q.content}</div>
              {isShort ? (
                <textarea
                  className="textarea"
                  placeholder="请输入你的作答…"
                  style={{ minHeight: 120, marginTop: 8 }}
                  value={((answers[qid] as string[] | undefined)?.[0]) ?? ''}
                  onChange={(e) => setAnswer(qid, [e.target.value])}
                />
              ) : (
                opts.map((o, idx) => {
                  const selected = isMulti ? selectedIdxs(qid).includes(idx) : selectedIdxs(qid)[0] === idx;
                  return (
                    <div
                      className={`exam-option ${selected ? 'selected' : ''}`}
                      key={idx}
                      onClick={() => toggleOption(q, idx)}
                    >
                      <span className={isMulti ? 'exam-option-checkbox' : 'exam-option-mark'}>
                        {isMulti ? '✓' : String.fromCharCode(65 + idx)}
                      </span>
                      <span>{o}</span>
                    </div>
                  );
                })
              )}
            </div>
          );
        })}
      </div>
      <div style={{ textAlign: 'center', margin: '24px 0' }}>
        <button className="btn btn-primary btn-lg" disabled={submitting} onClick={submitExam}>
          交卷
        </button>
      </div>
    </>
  );
}

// ============ 学生视角：结果 ============
function ExamResultView({ exam, sub }: { exam: ExamDetail; sub: { status: string; score: number | null } }) {
  return (
    <>
      <Link
        to={`/course-detail?id=${exam.course_id}`}
        style={{ display: 'inline-block', marginBottom: 16, fontSize: 13, color: 'var(--ink-light)' }}
      >
        ← 返回课程
      </Link>
      <div className="scroll-frame" style={{ textAlign: 'center' }}>
        <div className="section-title">
          <span className="st-text">{exam.title}</span>
          <span className="st-line" />
        </div>
        {sub.status === 'graded' ? (
          <>
            <div style={{ fontFamily: 'var(--font-brush)', fontSize: 80, color: 'var(--gold)', margin: '20px 0' }}>
              {sub.score ?? '—'}
            </div>
            <div style={{ fontSize: 14, color: 'var(--ink-light)' }}>/ {exam.total_score} 分</div>
          </>
        ) : (
          <div style={{ fontSize: 18, color: 'var(--ink-soft)', margin: '30px 0' }}>已提交，简答题待教师批改</div>
        )}
      </div>
    </>
  );
}
