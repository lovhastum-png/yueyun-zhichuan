import { useCallback, useEffect, useState } from 'react';
import { request } from '../shared/api';
import { getUser } from '../shared/auth';
import { toast } from '../shared/toast';
import { Modal } from '../shared/modal';
import { formatTime, renderAnswerHtml } from '../shared/format';
import { EmptyState } from '../shared/EmptyState';
import './knowledge-review.css';

type ReviewTab = 'pending' | 'approved' | 'rejected';

/** 审核条目（字段与后端 knowledge-review 接口一致） */
interface ReviewItem {
  id: number;
  question: string;
  askCount: number;
  bestAnswer?: string | null;
  bestSources?: Array<{ title?: string } | string>;
  status?: string;
  updatedAt?: string;
  reviewedAt?: string;
  rejectReason?: string | null;
}

interface ReviewStats {
  pending_count?: number;
  approved_count?: number;
  rejected_count?: number;
  max_ask?: number;
}

/** 接口返回可能是 { list, stats } 或裸数组（与旧版兼容逻辑一致） */
type ReviewListData = ReviewItem[] | { list?: ReviewItem[]; stats?: ReviewStats };

/** 弹窗状态：approve / reject / revoke 为确认类，edit 为修订表单 */
type ModalState =
  | { kind: 'approve'; item: ReviewItem }
  | { kind: 'reject'; item: ReviewItem }
  | { kind: 'revoke'; item: ReviewItem }
  | { kind: 'edit'; item: ReviewItem };

const EMPTY_TEXT: Record<ReviewTab, string> = {
  pending: '暂无待审核问题\n学生提问后将自动沉淀到这里',
  approved: '暂无已入库问题\n审核通过后这里会显示',
  rejected: '暂无已拒绝问题',
};

// 知识飞轮：教师专属的高频问题审核（通过入库 RAG / 拒绝 / 撤销 / 修订），
// 交互与旧版 knowledge-review.js 一致，原生 confirm/prompt 改用共享 Modal
export function KnowledgeReviewPage() {
  const user = getUser();
  const isTeacher = user?.role === 'teacher';
  const [tab, setTab] = useState<ReviewTab>('pending');
  const [list, setList] = useState<ReviewItem[] | null>(null);
  const [listError, setListError] = useState<string | null>(null);
  const [stats, setStats] = useState<ReviewStats>({});
  const [modal, setModal] = useState<ModalState | null>(null);
  const [rejectReason, setRejectReason] = useState('');
  const [editQuestion, setEditQuestion] = useState('');
  const [editAnswer, setEditAnswer] = useState('');
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    document.title = '越韵智传 · 知识飞轮';
  }, []);

  // 教师角色守卫：与旧版 requireRole('teacher') 对应，改为 toast + 不渲染内容
  useEffect(() => {
    if (!isTeacher) toast(user ? '仅教师可访问知识飞轮' : '请先登录后使用此功能', 'err');
    // eslint-disable-next-line react-hooks/exhaustive-deps -- user 取自首帧即可，角色会话内不变
  }, [isTeacher]);

  // history 接口不返回 stats，需单独拉一次
  const loadStats = useCallback(async () => {
    const res = await request<ReviewListData>('/knowledge-review/pending?limit=1');
    if (res.code === 0 && !Array.isArray(res.data) && res.data?.stats) setStats(res.data.stats);
  }, []);

  const loadList = useCallback(async () => {
    setList(null);
    setListError(null);
    const path =
      tab === 'pending'
        ? '/knowledge-review/pending?limit=50'
        : `/knowledge-review/history?limit=100&status=${tab}`;
    const res = await request<ReviewListData>(path);
    if (res.code !== 0) {
      setListError(res.message || '加载失败');
      setList([]);
      return;
    }
    if (Array.isArray(res.data)) {
      setList(res.data);
      loadStats();
    } else {
      setList(res.data?.list || []);
      if (res.data?.stats) setStats(res.data.stats);
      else loadStats();
    }
  }, [tab, loadStats]);

  useEffect(() => {
    loadList();
  }, [loadList]);

  const openModal = (m: ModalState) => {
    if (m.kind === 'reject') setRejectReason('');
    if (m.kind === 'edit') {
      setEditQuestion(m.item.question);
      setEditAnswer(m.item.bestAnswer || '');
    }
    setModal(m);
  };

  const closeModal = () => setModal(null);

  // ---------- 审核操作 ----------
  const doApprove = async (item: ReviewItem) => {
    setSubmitting(true);
    const res = await request('/knowledge-review/approve', { method: 'POST', body: { id: item.id } });
    setSubmitting(false);
    if (res.code === 0) {
      toast('已审核通过并入库', 'ok');
      closeModal();
      loadList();
    } else {
      toast(res.message || '操作失败', 'err');
    }
  };

  const doReject = async (item: ReviewItem) => {
    setSubmitting(true);
    const res = await request('/knowledge-review/reject', {
      method: 'POST',
      body: { id: item.id, reason: rejectReason },
    });
    setSubmitting(false);
    if (res.code === 0) {
      toast('已拒绝', 'ok');
      closeModal();
      loadList();
    } else {
      toast(res.message || '操作失败', 'err');
    }
  };

  const doRevoke = async (item: ReviewItem) => {
    setSubmitting(true);
    const res = await request(`/knowledge-review/${item.id}`, { method: 'DELETE' });
    setSubmitting(false);
    if (res.code === 0) {
      toast('已撤销入库', 'ok');
      closeModal();
      loadList();
    } else {
      toast(res.message || '操作失败', 'err');
    }
  };

  const doEditSave = async (item: ReviewItem) => {
    const q = editQuestion.trim();
    const a = editAnswer.trim();
    if (!q || !a) {
      toast('问题和答案不能为空', 'err');
      return;
    }
    setSubmitting(true);
    const res = await request('/knowledge-review/approve-with-edit', {
      method: 'POST',
      body: { id: item.id, question: q, answer: a },
    });
    setSubmitting(false);
    if (res.code === 0) {
      toast('已修订并入库', 'ok');
      closeModal();
      loadList();
    } else {
      toast(res.message || '保存失败', 'err');
    }
  };

  if (!isTeacher) {
    return (
      <>
        <main className="main">
          <div className="container" style={{ paddingTop: 8 }}>
            <EmptyState icon="轮" text={user ? '仅教师可访问知识飞轮' : '请先登录后使用此功能'} />
          </div>
        </main>
      </>
    );
  }

  const statCards: Array<{ label: string; value: number; sub: string; cls: string }> = [
    { label: '待审核', value: stats.pending_count ?? 0, sub: '学生高频提问', cls: '' },
    { label: '已入库', value: stats.approved_count ?? 0, sub: '已加入 RAG 知识库', cls: 'cyan' },
    { label: '已拒绝', value: stats.rejected_count ?? 0, sub: '不纳入知识库', cls: 'ochre' },
    { label: '最高频次', value: stats.max_ask ?? 0, sub: '单个问题被问次数', cls: 'ink' },
  ];

  return (
    <>
      <main className="main">
        <div className="container" style={{ paddingTop: 8 }}>
          <section className="page-hero">
            <div className="ink-wash ink-wash-1" style={{ background: 'var(--cinnabar)' }} />
            <div className="ink-wash ink-wash-2" style={{ background: 'var(--ochre)' }} />
            <div className="hero-seal">
              <span className="seal seal-vertical">飞轮</span>
            </div>
            <h1>知识飞轮</h1>
          </section>

          {/* 数据看板 */}
          <div className="flywheel-stats">
            {statCards.map((c) => (
              <div className={`stat-card ${c.cls}`} key={c.label}>
                <div className="stat-label">{c.label}</div>
                <div className="stat-value">{c.value}</div>
                <div className="stat-sub">{c.sub}</div>
              </div>
            ))}
          </div>

          {/* Tab 切换 */}
          <div className="review-tabs">
            {(
              [
                ['pending', '待审核', stats.pending_count ?? 0],
                ['approved', '已入库', stats.approved_count ?? 0],
                ['rejected', '已拒绝', stats.rejected_count ?? 0],
              ] as Array<[ReviewTab, string, number]>
            ).map(([key, label, count]) => (
              <button
                key={key}
                className={`review-tab ${tab === key ? 'active' : ''}`}
                onClick={() => setTab(key)}
              >
                {label} <span className="badge">{count}</span>
              </button>
            ))}
          </div>

          {/* 列表 */}
          <div className="review-list">
            {list === null && (
              <EmptyState icon="韵" text="加载中..." />
            )}

            {list !== null && listError !== null && (
              <EmptyState icon="错" text={listError} role="alert" />
            )}

            {list !== null && listError === null && list.length === 0 && (
              <EmptyState icon="空" text={EMPTY_TEXT[tab]} />
            )}

            {list !== null &&
              listError === null &&
              list.map((item, idx) => (
                <ReviewCard key={item.id} item={item} idx={idx + 1} tab={tab} onAction={openModal} />
              ))}
          </div>
        </div>
      </main>

      {/* 确认 / 表单弹窗 */}
      {modal?.kind === 'approve' && (
        <Modal
          title="审核确认"
          onClose={closeModal}
          actions={
            <button className="btn btn-primary" disabled={submitting} onClick={() => doApprove(modal.item)}>
              {submitting ? '处理中…' : '通过入库'}
            </button>
          }
        >
          <p>确认审核通过并入库到 RAG 知识库？</p>
        </Modal>
      )}

      {modal?.kind === 'reject' && (
        <Modal
          title="拒绝问题"
          onClose={closeModal}
          actions={
            <button className="btn btn-primary" disabled={submitting} onClick={() => doReject(modal.item)}>
              {submitting ? '处理中…' : '确认拒绝'}
            </button>
          }
        >
          <div className="field">
            <label className="field-label" htmlFor="kr-reject-reason">拒绝原因（可选）</label>
            <textarea
              id="kr-reject-reason"
              className="textarea"
              rows={3}
              placeholder="填写原因便于后续追溯"
              value={rejectReason}
              onChange={(e) => setRejectReason(e.target.value)}
            />
          </div>
        </Modal>
      )}

      {modal?.kind === 'revoke' && (
        <Modal
          title="撤销入库"
          onClose={closeModal}
          actions={
            <button className="btn btn-primary" disabled={submitting} onClick={() => doRevoke(modal.item)}>
              {submitting ? '处理中…' : '确认撤销'}
            </button>
          }
        >
          <p>撤销入库后，对应的知识块将从 RAG 库中删除，确定吗？</p>
        </Modal>
      )}

      {modal?.kind === 'edit' && (
        <Modal
          title="修订问题与答案"
          onClose={closeModal}
          actions={
            <button className="btn btn-primary" disabled={submitting} onClick={() => doEditSave(modal.item)}>
              {submitting ? '处理中…' : '保存并入库'}
            </button>
          }
        >
          <div className="field">
            <label className="field-label" htmlFor="kr-edit-question">问题</label>
            <textarea
              id="kr-edit-question"
              className="textarea"
              rows={2}
              value={editQuestion}
              onChange={(e) => setEditQuestion(e.target.value)}
            />
          </div>
          <div className="field">
            <label className="field-label" htmlFor="kr-edit-answer">标准答案（入库后将作为 RAG 检索内容）</label>
            <textarea
              id="kr-edit-answer"
              className="textarea"
              rows={10}
              value={editAnswer}
              onChange={(e) => setEditAnswer(e.target.value)}
            />
          </div>
        </Modal>
      )}
    </>
  );
}

/** 单张审核卡片 */
function ReviewCard({
  item,
  idx,
  tab,
  onAction,
}: {
  item: ReviewItem;
  idx: number;
  tab: ReviewTab;
  onAction: (m: ModalState) => void;
}) {
  const sources = (item.bestSources || [])
    .slice(0, 5)
    .map((s) => (typeof s === 'string' ? s : s.title || ''))
    .filter((s) => s);

  const meta =
    tab === 'pending'
      ? `最近提问：${formatTime(item.updatedAt)}`
      : `审核时间：${formatTime(item.reviewedAt)}${item.rejectReason ? ' · 拒绝原因：' + item.rejectReason : ''}`;

  return (
    <div className="review-card">
      <div className="review-card-head">
        <div className="review-q-num">{idx}</div>
        <div className="review-q-text">{item.question}</div>
        <div className="review-ask-badge">被问 {item.askCount} 次</div>
        {tab !== 'pending' && (
          <span className={`review-status-tag ${item.status}`}>
            {item.status === 'approved' ? '已入库' : '已拒绝'}
          </span>
        )}
      </div>
      <div className="review-card-body">
        <div className="review-answer-label">AI 最佳回答</div>
        {/* AI 回答含出处标记 / 图片等富文本，与旧版 renderAnswer 一致 */}
        <div className="review-answer" dangerouslySetInnerHTML={{ __html: renderAnswerHtml(item.bestAnswer || '（暂无回答）') }} />
        {sources.length > 0 && (
          <div className="review-sources">
            {sources.map((s, i) => (
              <span className="review-src-mark" key={i}>
                {s}
              </span>
            ))}
          </div>
        )}
      </div>
      <div className="review-card-foot">
        <div className="review-meta">{meta}</div>
        <div className="review-actions">
          {tab === 'pending' ? (
            <>
              <button className="review-btn edit" onClick={() => onAction({ kind: 'edit', item })}>
                编辑修订
              </button>
              <button className="review-btn approve" onClick={() => onAction({ kind: 'approve', item })}>
                通过入库
              </button>
              <button className="review-btn reject" onClick={() => onAction({ kind: 'reject', item })}>
                拒绝
              </button>
            </>
          ) : (
            item.status === 'approved' && (
              <button className="review-btn revoke" onClick={() => onAction({ kind: 'revoke', item })}>
                撤销入库
              </button>
            )
          )}
        </div>
      </div>
    </div>
  );
}
