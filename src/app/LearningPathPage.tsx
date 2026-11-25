import { useEffect, useState } from 'react';
import { request } from '../shared/api';
import { getUser } from '../shared/auth';
import { CountUp } from '../shared/CountUp';
import { toast } from '../shared/toast';
import { EmptyState } from '../shared/EmptyState';
import { AiBadge, AiNotice } from '../shared/AiLabel';

/** 单条学习建议（字段与后端 /agent/learning-path 返回一致） */
interface PathRecommendation {
  title?: string;
  description?: string;
  priority?: string;
  topic?: string;
  estimated_time?: string;
}

/** 关联知识库资源 */
interface KnowledgeResourceItem {
  title: string;
  score: number;
  content: string;
}

interface KnowledgeResource {
  topic: string;
  resources?: KnowledgeResourceItem[];
}

/** 学情数据（仅用到长度/计数字段） */
interface StudentData {
  courses: unknown[];
  assignments: unknown[];
  exams: unknown[];
  wrongQuestions: unknown[];
  attendance: { present?: number; late?: number; absent?: number };
  activity: { chat_count?: number; draw_count?: number; img_count?: number };
}

interface LearningPathResult {
  studentData: StudentData;
  path: {
    overall_assessment?: string;
    next_step?: string;
    recommendations?: PathRecommendation[];
    strengths?: string[];
    weaknesses?: string[];
  };
  knowledgeResources?: KnowledgeResource[];
}

type Phase = 'idle' | 'loading' | 'done' | 'error';

const PRIORITY_MAP: Record<string, { label: string; color: string; bg: string }> = {
  high: { label: '高优先级', color: 'var(--cinnabar)', bg: 'rgba(193,39,45,0.1)' },
  medium: { label: '中优先级', color: 'var(--ochre)', bg: 'rgba(166,124,82,0.1)' },
  low: { label: '低优先级', color: 'var(--cyan)', bg: 'rgba(58,125,123,0.1)' },
};

// 个性化学习路径：AI 分析学情数据生成推荐，交互与旧版 learning-path.js 一致
export function LearningPathPage() {
  const user = getUser();
  const allowed = user?.role === 'student';
  const [phase, setPhase] = useState<Phase>('idle');
  const [result, setResult] = useState<LearningPathResult | null>(null);
  const [errorMsg, setErrorMsg] = useState('');

  useEffect(() => {
    document.title = '越韵智传 · 个性化学习路径';
  }, []);

  // 学生角色守卫：与旧版 requireRole 对应，改为 toast + 不渲染内容
  useEffect(() => {
    if (!allowed) toast(user ? '学习路径推荐仅对学生开放' : '请先登录后使用此功能', 'err');
    // eslint-disable-next-line react-hooks/exhaustive-deps -- user 取自首帧即可，角色会话内不变
  }, [allowed]);

  const generatePath = async () => {
    if (phase === 'loading') return;
    setPhase('loading');
    const res = await request<LearningPathResult>('/agent/learning-path');
    if (res.code === 0 && res.data) {
      setResult(res.data);
      setPhase('done');
    } else {
      setErrorMsg(res.message || '生成失败');
      setPhase('error');
    }
  };

  return (
    <>
      <main className="main">
        <div className="container" style={{ paddingTop: 8 }}>
          <section className="page-hero">
            <div className="ink-wash ink-wash-1" style={{ background: 'var(--cyan)' }} />
            <div className="ink-wash ink-wash-2" style={{ background: 'var(--cinnabar)' }} />
            <div className="hero-seal">
              <span className="seal seal-vertical">学径</span>
            </div>
            <h1>个性化学习路径 <AiBadge style={{ fontSize: 12, padding: '2px 10px' }} /></h1>
          </section>
          <AiNotice text="本页学习路径与建议由人工智能依据学习行为数据生成，仅供参考，请结合个人实际情况调整。" />

          {!allowed ? (
            <EmptyState icon="径" text={user ? '学习路径推荐仅对学生开放' : '请先登录后使用此功能'} />
          ) : (
            <div className="scroll-frame" style={{ marginBottom: 20 }}>
              <div className="section-title">
                <span className="st-text">学情诊断</span>
                <span className="st-line" />
                <button className="btn btn-primary" style={{ marginLeft: 'auto' }} onClick={generatePath} disabled={phase === 'loading'}>
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <path d="M12 2v4M12 18v4M4.93 4.93l2.83 2.83M16.24 16.24l2.83 2.83M2 12h4M18 12h4M4.93 19.07l2.83-2.83M16.24 7.76l2.83-2.83" />
                  </svg>
                  生成学习路径
                </button>
              </div>

              {/* 路径容器：空态 / 加载中 / 出错 / 结果 */}
              {phase === 'idle' && (
                <div className="path-empty">
                  <div className="empty-icon">径</div>
                  <div className="empty-text">
                    点击上方按钮，AI 将分析您的<br />
                    课程、作业、考试、签到等学情数据<br />
                    生成个性化学习路径
                  </div>
                </div>
              )}

              {phase === 'loading' && (
                <div className="path-loading">
                  <div className="loader-brush">
                    <div className="loader-stroke" />
                    <div className="loader-stroke" />
                    <div className="loader-stroke" />
                  </div>
                  <div className="loading-text">AI 正在分析您的学情数据…</div>
                  <div className="loading-sub">收集课程 · 作业 · 考试 · 错题 · 签到 · 活跃度</div>
                </div>
              )}

              {phase === 'error' && (
                <div className="path-error">
                  <div style={{ fontSize: 36, color: 'var(--cinnabar)', fontFamily: 'var(--font-brush)' }}>叹</div>
                  <div style={{ marginTop: 8, color: 'var(--cinnabar)' }}>{errorMsg}</div>
                  <div style={{ fontSize: 13, color: 'var(--ink-light)', marginTop: 6 }}>请稍后重试，或先参与课程学习以积累学情数据</div>
                </div>
              )}

              {phase === 'done' && result && <PathResult data={result} />}
            </div>
          )}
        </div>
      </main>
    </>
  );
}

/** 学习路径结果：总体评价 / 优劣势 / 学情数据 / 时间线建议 / 关联知识 */
function PathResult({ data }: { data: LearningPathResult }) {
  const { studentData, path, knowledgeResources } = data;
  const recs = path.recommendations || [];
  const strengths = path.strengths || [];
  const weaknesses = path.weaknesses || [];
  const attendance = studentData.attendance || {};
  const activity = studentData.activity || {};

  const dataItems: Array<[number | string, string]> = [
    [studentData.courses.length, '已选课程'],
    [studentData.assignments.length, '作业记录'],
    [studentData.exams.length, '考试记录'],
    [studentData.wrongQuestions.length, '错题数量'],
    [
      (attendance.present || 0) + (attendance.late || 0) + (attendance.absent || 0),
      '签到次数',
    ],
    [
      (activity.chat_count || 0) + (activity.draw_count || 0) + (activity.img_count || 0),
      '学习活跃',
    ],
  ];

  return (
    <>
      {/* 总体评价 */}
      <div className="path-card path-overview fade-up">
        <div className="path-card-head">
          <span className="path-card-icon" style={{ background: 'var(--ink)', color: 'var(--paper)' }}>
            评
          </span>
          <span className="path-card-title">总体评价</span>
        </div>
        <div className="path-overview-text">{path.overall_assessment || '暂无评价'}</div>
        <div className="path-next-step">
          <span className="next-label">下一步建议</span>
          <span className="next-text">{path.next_step || '继续努力学习'}</span>
        </div>
      </div>

      {/* 优势与薄弱点 */}
      <div className="path-sw-grid fade-up" style={{ animationDelay: '0.1s' }}>
        <div className="path-card path-strengths">
          <div className="path-card-head">
            <span className="path-card-icon" style={{ background: 'var(--cyan)', color: 'var(--paper)' }}>
              优
            </span>
            <span className="path-card-title">优势</span>
          </div>
          {strengths.length > 0 ? (
            <ul className="sw-list">
              {strengths.map((s) => (
                <li key={s}>{s}</li>
              ))}
            </ul>
          ) : (
            <div className="sw-empty">暂无明显优势数据</div>
          )}
        </div>
        <div className="path-card path-weaknesses">
          <div className="path-card-head">
            <span className="path-card-icon" style={{ background: 'var(--cinnabar)', color: 'var(--paper)' }}>
              弱
            </span>
            <span className="path-card-title">薄弱点</span>
          </div>
          {weaknesses.length > 0 ? (
            <ul className="sw-list">
              {weaknesses.map((s) => (
                <li key={s}>{s}</li>
              ))}
            </ul>
          ) : (
            <div className="sw-empty">暂无明显薄弱点</div>
          )}
        </div>
      </div>

      {/* 学情数据概览 */}
      <div className="path-card path-data fade-up" style={{ animationDelay: '0.15s' }}>
        <div className="path-card-head">
          <span className="path-card-icon" style={{ background: 'var(--ochre)', color: 'var(--paper)' }}>
            据
          </span>
          <span className="path-card-title">学情数据</span>
        </div>
        <div className="data-grid">
          {dataItems.map(([num, label]) => (
            <div className="data-item" key={label}>
              <div className="data-num">{typeof num === 'number' ? <CountUp value={num} /> : num}</div>
              <div className="data-label">{label}</div>
            </div>
          ))}
        </div>
      </div>

      {/* 学习路径推荐 */}
      <div
        className="scroll-frame"
        style={{ marginTop: 20, background: 'none', border: 'none', padding: 0, boxShadow: 'none' }}
      >
        <div className="section-title">
          <span className="st-text">学习路径</span>
          <span className="st-line" />
          <span style={{ marginLeft: 'auto', fontSize: 12, color: 'var(--ink-light)' }}>共 {recs.length} 条建议</span>
        </div>
        <div className="path-timeline">
          {recs.map((r, i) => (
            <RecommendationItem rec={r} index={i} key={i} />
          ))}
        </div>
      </div>

      {/* 知识库推荐资源 */}
      {knowledgeResources && knowledgeResources.length > 0 && (
        <div className="scroll-frame" style={{ marginTop: 20 }}>
          <div className="section-title">
            <span className="st-text">关联知识</span>
            <span className="st-line" />
          </div>
          <div className="resource-list">
            {knowledgeResources.map((kr) => (
              <div className="resource-group" key={kr.topic}>
                <div className="resource-topic">主题：{kr.topic}</div>
                {(kr.resources || []).map((r, idx) => (
                  <div className="resource-item" key={idx}>
                    <div className="resource-head">
                      <span className="resource-title">{r.title}</span>
                      <span className="resource-score">{(r.score * 100).toFixed(0)}% 相关</span>
                    </div>
                    <div className="resource-body">{r.content.length > 120 ? r.content.slice(0, 120) + '…' : r.content}</div>
                  </div>
                ))}
              </div>
            ))}
          </div>
        </div>
      )}
    </>
  );
}

/** 单条时间线建议 */
function RecommendationItem({ rec, index }: { rec: PathRecommendation; index: number }) {
  const p = PRIORITY_MAP[rec.priority || ''] || PRIORITY_MAP.medium;
  return (
    <div className="rec-item fade-up" style={{ animationDelay: `${0.2 + index * 0.08}s` }}>
      <div className="rec-marker">
        <div className="rec-dot" style={{ background: p.color }} />
        {index < 4 && <div className="rec-line" />}
      </div>
      <div className="rec-body">
        <div className="rec-head">
          <div className="rec-title">{rec.title || '建议'}</div>
          <span className="rec-priority" style={{ color: p.color, background: p.bg }}>
            {p.label}
          </span>
        </div>
        <div className="rec-desc">{rec.description || ''}</div>
        <div className="rec-meta">
          {rec.topic && <span className="rec-tag">主题：{rec.topic}</span>}
          {rec.estimated_time && <span className="rec-tag">建议时长：{rec.estimated_time}</span>}
        </div>
      </div>
    </div>
  );
}
