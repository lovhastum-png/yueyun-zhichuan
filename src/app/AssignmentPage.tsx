/* ============================================================
   作业详情页（React 版）
   迁移自 public/assignment.html + public/js/assignment.js
   学生：查看批改结果 / 提交（或重新提交）作业
   教师：查看学生提交、手动批改、AI 评分建议
   ============================================================ */
import { useCallback, useEffect, useState } from 'react';
import { Link, Navigate, useSearchParams } from 'react-router-dom';
import { request } from '../shared/api';
import { toast } from '../shared/toast';
import { Modal } from '../shared/modal';
import { formatTime, confColor, confLabel } from '../shared/format';
import { AiNotice } from '../shared/AiLabel';
import { EmptyState } from '../shared/EmptyState';

interface MySubmission {
  id: number;
  status: 'submitted' | 'graded';
  score: number | null;
  content?: string | null;
  feedback?: string | null;
}

interface AssignmentDetail {
  id: number;
  course_id: number;
  title: string;
  description?: string | null;
  total_score: number;
  due_at?: string | null;
  created_at: string;
  isTeacher?: boolean;
  my_submission?: MySubmission | null;
}

interface AssignmentSubmission {
  id: number;
  real_name?: string | null;
  username: string;
  submitted_at?: string | null;
  status: 'submitted' | 'graded';
  score: number | null;
  content?: string | null;
  feedback?: string | null;
}

interface AiGradeSuggestion {
  score: number;
  maxScore: number;
  confidence: number;
  feedback?: string | null;
  strengths?: string[] | null;
  weaknesses?: string[] | null;
}

// 作业页：URL 参数 ?id= 为作业 ID；教师/学生视角由接口返回的 isTeacher 决定
export function AssignmentPage() {
  const [params] = useSearchParams();
  const id = params.get('id');
  const [assign, setAssign] = useState<AssignmentDetail | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    document.title = '越韵智传 · 作业详情';
    // 补挂页面标识，供 atmosphere.css 定位卷首视差层（SPA 中手动补挂）
    const prevClass = document.body.className;
    document.body.className = 'page-assignment';
    return () => {
      document.body.className = prevClass;
    };
  }, []);

  const load = useCallback(async () => {
    if (!id) return;
    const res = await request<AssignmentDetail>(`/assignment/${id}`);
    if (res.code !== 0) {
      setError(res.message || '作业不存在');
      return;
    }
    setError(null);
    setAssign(res.data);
  }, [id]);

  useEffect(() => {
    load();
  }, [load]);

  if (!id) return <Navigate to="/courses" replace />;

  const isTeacher = !!assign?.isTeacher;

  return (
    <>
      <main className="main">
        <div className="container" style={{ paddingTop: 8, maxWidth: 900 }}>
          {!assign && !error && (
            <div style={{ textAlign: 'center', padding: '80px 0' }}>
              <div className="spinner" style={{ margin: '0 auto' }} />
            </div>
          )}
          {error && (
            <EmptyState icon="失" text={error} />
          )}
          {assign && (
            <>
              <Link
                to={`/course-detail?id=${assign.course_id}`}
                style={{ display: 'inline-block', marginBottom: 16, fontSize: 13, color: 'var(--ink-light)' }}
              >
                ← 返回课程
              </Link>
              <div className="scroll-frame" style={{ marginBottom: 20 }}>
                <div className="section-title">
                  <span className="st-text">{assign.title}</span>
                  <span className="st-line" />
                </div>
                <div
                  style={{
                    display: 'flex',
                    gap: 16,
                    flexWrap: 'wrap',
                    fontSize: 13,
                    color: 'var(--ink-light)',
                    marginBottom: 16,
                  }}
                >
                  <span>满分 {assign.total_score}</span>
                  {assign.due_at ? <span>截止 {formatTime(assign.due_at)}</span> : null}
                  <span>发布于 {formatTime(assign.created_at)}</span>
                </div>
                <div style={{ fontSize: 15, lineHeight: 2, color: 'var(--ink-soft)', whiteSpace: 'pre-wrap' }}>
                  {assign.description || '无要求说明'}
                </div>
              </div>
              {isTeacher ? (
                <TeacherSubmissions assignId={assign.id} reload={load} />
              ) : (
                <StudentSubmit assign={assign} reload={load} />
              )}
            </>
          )}
        </div>
      </main>
    </>
  );
}

// ---------- 学生视角：已批改显示成绩，否则显示提交表单 ----------
function StudentSubmit({ assign, reload }: { assign: AssignmentDetail; reload: () => void }) {
  const [content, setContent] = useState(assign.my_submission?.content || '');
  const [submitting, setSubmitting] = useState(false);
  const sub = assign.my_submission;

  const submit = async () => {
    const c = content.trim();
    if (!c) {
      toast('请输入作业内容', 'err');
      return;
    }
    setSubmitting(true);
    const r = await request(`/assignment/${assign.id}/submit`, { method: 'POST', body: { content: c } });
    setSubmitting(false);
    toast(r.message, r.code === 0 ? 'ok' : 'err');
    if (r.code === 0) reload();
  };

  if (sub && sub.status === 'graded') {
    return (
      <>
        <div className="scroll-frame" style={{ marginBottom: 20 }}>
          <div className="section-title">
            <span className="st-text">我的成绩</span>
            <span className="st-line" />
          </div>
          <div style={{ textAlign: 'center', padding: '20px 0' }}>
            <div style={{ fontFamily: 'var(--font-brush)', fontSize: 56, color: 'var(--gold)' }}>{sub.score}</div>
            <div style={{ fontSize: 13, color: 'var(--ink-light)' }}>/ {assign.total_score} 分</div>
          </div>
          {sub.feedback ? (
            <div
              style={{
                marginTop: 16,
                padding: 16,
                background: 'var(--ink-5)',
                borderLeft: '3px solid var(--cyan)',
                borderRadius: 4,
                fontSize: 14,
                lineHeight: 1.8,
              }}
            >
              <b>教师评语：</b>
              <br />
              {sub.feedback}
            </div>
          ) : null}
        </div>
        <div className="scroll-frame">
          <div className="section-title">
            <span className="st-text">我的提交</span>
            <span className="st-line" />
          </div>
          <div style={{ fontSize: 15, lineHeight: 1.8, color: 'var(--ink-soft)', whiteSpace: 'pre-wrap' }}>
            {sub.content || '（无文字内容）'}
          </div>
        </div>
      </>
    );
  }

  return (
    <div className="scroll-frame">
      <div className="section-title">
        <span className="st-text">{sub ? '修改提交' : '提交作业'}</span>
        <span className="st-line" />
      </div>
      <div className="field">
        <label className="field-label">作业内容</label>
        <textarea
          className="textarea"
          placeholder="请输入你的作业作答…"
          style={{ minHeight: 240 }}
          value={content}
          onChange={(e) => setContent(e.target.value)}
        />
      </div>
      <button className="btn btn-primary" disabled={submitting} onClick={submit}>
        {sub ? '重新提交' : '提交作业'}
      </button>
    </div>
  );
}

// ---------- 教师视角：学生提交列表 + 批改 ----------
function TeacherSubmissions({ assignId, reload }: { assignId: number; reload: () => void }) {
  const [list, setList] = useState<AssignmentSubmission[] | null>(null);
  const [grading, setGrading] = useState<AssignmentSubmission | null>(null);

  const load = useCallback(async () => {
    const res = await request<AssignmentSubmission[]>(`/assignment/${assignId}/submissions`);
    setList(res.code === 0 && res.data ? res.data : []);
  }, [assignId]);

  useEffect(() => {
    load();
  }, [load]);

  return (
    <div className="scroll-frame">
      <div className="section-title">
        <span className="st-text">学生提交</span>
        <span className="st-line" />
        <span style={{ marginLeft: 'auto', fontSize: 13, color: 'var(--ink-light)' }}>
          共 {list ? list.length : 0} 份
        </span>
      </div>
      {list === null ? (
        <div style={{ textAlign: 'center', padding: 40 }}>
          <div className="spinner" style={{ margin: '0 auto' }} />
        </div>
      ) : list.length === 0 ? (
        <EmptyState icon="空" text="暂无学生提交" />
      ) : (
        list.map((s) => (
          <div className="learn-item" key={s.id} style={{ cursor: 'pointer' }} onClick={() => setGrading(s)}>
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
          </div>
        ))
      )}

      {grading && (
        <GradeModal
          sub={grading}
          onClose={() => setGrading(null)}
          onGraded={() => {
            setGrading(null);
            load();
            reload();
          }}
        />
      )}
    </div>
  );
}

// ---------- 批改作业：AI 评分建议（可采纳）+ 分数评语提交 ----------
function GradeModal({
  sub,
  onClose,
  onGraded,
}: {
  sub: AssignmentSubmission;
  onClose: () => void;
  onGraded: () => void;
}) {
  const [score, setScore] = useState(sub.score != null ? String(sub.score) : '');
  const [feedback, setFeedback] = useState(sub.feedback || '');
  const [aiData, setAiData] = useState<AiGradeSuggestion | null>(null);
  const [aiError, setAiError] = useState<string | null>(null);
  const [aiLoading, setAiLoading] = useState(false);
  const [applied, setApplied] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  const runAi = async () => {
    setAiLoading(true);
    setAiError(null);
    const r = await request<AiGradeSuggestion>(`/ai-assist/grade/assignment/${sub.id}`, {
      method: 'POST',
      body: { autoCommit: false },
      timeout: 120000,
    });
    setAiLoading(false);
    if (r.code !== 0 || !r.data) {
      setAiError(r.message || '请重试');
      return;
    }
    setAiData(r.data);
  };

  const applyAi = () => {
    if (!aiData) return;
    setScore(String(aiData.score));
    setFeedback(
      (aiData.feedback || '') +
        '\n\n【本评语由 AI 生成内容（人工智能）辅助撰写，已经教师复核修改后方为最终评语】',
    );
    setApplied(true);
    toast('已填入，可继续编辑后提交', 'ok');
  };

  const submit = async () => {
    const s = parseInt(score);
    if (isNaN(s)) {
      toast('请输入分数', 'err');
      return;
    }
    setSubmitting(true);
    const r = await request(`/assignment/submission/${sub.id}/grade`, {
      method: 'PUT',
      body: { score: s, feedback: feedback.trim() },
    });
    setSubmitting(false);
    toast(r.message, r.code === 0 ? 'ok' : 'err');
    if (r.code === 0) onGraded();
  };

  return (
    <Modal
      title="批改作业"
      onClose={onClose}
      actions={
        <button className="btn btn-primary" disabled={submitting} onClick={submit}>
          提交批改
        </button>
      }
    >
      <div className="ai-assist-bar" style={{ marginBottom: 16 }}>
        <div className="ai-assist-title">AI 评分建议</div>
        <div className="ai-assist-hint">
          点击让 AI 依据作业要求评估学生提交，给出分数与评语建议（仅供参考，可编辑）。
        </div>
        <button className="btn btn-brush btn-sm" style={{ marginTop: 8 }} disabled={aiLoading} onClick={runAi}>
          {aiLoading ? 'AI 评阅中…' : '让 AI 评分'}
        </button>
        <div style={{ marginTop: 12 }}>
          {aiLoading && <div style={{ fontSize: 13, color: 'var(--ink-light)' }}>AI 正在评阅，约 20-40 秒…</div>}
          {aiError && <div style={{ color: 'var(--cinnabar)', fontSize: 13 }}>评阅失败：{aiError}</div>}
          {aiData && (
            <>
              <AiNotice text="以下评分与评语由人工智能生成，仅供参考；最终成绩须由任课教师复核确认后提交，AI 结果不作为唯一评分依据。" />
              <div className="ai-grade-summary">
                <div className="ags-row ags-total">
                  <span>建议得分：</span>
                  <b>
                    {aiData.score}/{aiData.maxScore}
                  </b>
                </div>
                <div className="ags-row">
                  <span>置信度：</span>
                  <b style={{ color: confColor(aiData.confidence) }}>
                    {confLabel(aiData.confidence)}({aiData.confidence})
                  </b>{' '}
                  {aiData.confidence < 0.6 ? (
                    <span className="tag tag-cinnabar" style={{ marginLeft: 8 }}>
                      建议人工复核
                    </span>
                  ) : null}
                </div>
              </div>
              <div
                style={{
                  marginTop: 10,
                  padding: 10,
                  background: 'var(--ink-5)',
                  borderRadius: 4,
                  fontSize: 13,
                  lineHeight: 1.7,
                }}
              >
                {aiData.feedback || ''}
              </div>
              {aiData.strengths && aiData.strengths.length > 0 ? (
                <div style={{ marginTop: 8, fontSize: 13 }}>
                  <b style={{ color: 'var(--cyan)' }}>亮点：</b>
                  {aiData.strengths.map((s, i) => (
                    <span key={i} className="tag tag-cyan" style={{ marginRight: 6 }}>
                      {s}
                    </span>
                  ))}
                </div>
              ) : null}
              {aiData.weaknesses && aiData.weaknesses.length > 0 ? (
                <div style={{ marginTop: 6, fontSize: 13 }}>
                  <b style={{ color: 'var(--cinnabar)' }}>不足：</b>
                  {aiData.weaknesses.map((s, i) => (
                    <span key={i} className="tag tag-cinnabar" style={{ marginRight: 6 }}>
                      {s}
                    </span>
                  ))}
                </div>
              ) : null}
              <button className="btn btn-ghost btn-sm" style={{ marginTop: 10 }} disabled={applied} onClick={applyAi}>
                {applied ? '已采纳' : '采纳（填入分数与评语）'}
              </button>
            </>
          )}
        </div>
      </div>
      <div style={{ marginBottom: 16 }}>
        <div style={{ fontSize: 14, color: 'var(--ink-light)', marginBottom: 6 }}>
          {sub.real_name || sub.username} 的提交
        </div>
        <div
          style={{
            padding: 14,
            background: 'var(--ink-5)',
            borderRadius: 4,
            fontSize: 14,
            lineHeight: 1.8,
            whiteSpace: 'pre-wrap',
            maxHeight: 200,
            overflowY: 'auto',
          }}
        >
          {sub.content || '（无内容）'}
        </div>
      </div>
      <div className="field">
        <label className="field-label">分数</label>
        <input
          className="input"
          type="number"
          placeholder="0-100"
          value={score}
          onChange={(e) => setScore(e.target.value)}
        />
      </div>
      <div className="field">
        <label className="field-label">评语</label>
        <textarea
          className="textarea"
          placeholder="给学生的反馈…"
          style={{ minHeight: 100 }}
          value={feedback}
          onChange={(e) => setFeedback(e.target.value)}
        />
      </div>
    </Modal>
  );
}
