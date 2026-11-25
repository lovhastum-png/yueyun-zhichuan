import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { request } from '../shared/api';
import { getUser } from '../shared/auth';
import { toast } from '../shared/toast';
import { Modal } from '../shared/modal';
import { activateProps } from '../shared/a11y';
import { CourseCard } from '../shared/CourseCard';
import { EmptyState } from '../shared/EmptyState';
import type { Course } from '../shared/types';

type Tab = 'mine' | 'all';

const CATEGORIES = ['流派唱腔', '经典剧目', '表演身段', '越剧历史', '唱词赏析'];

// 课程列表页：我的课程 / 选课大厅、教师建课、学生加入课程（登录守卫由路由层处理）
export function CourseListPage() {
  const user = getUser();
  const isTeacher = user?.role === 'teacher';
  const [tab, setTab] = useState<Tab>('mine');
  const [courses, setCourses] = useState<Course[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showCreate, setShowCreate] = useState(false);
  const [category, setCategory] = useState<string>('all');

  useEffect(() => {
    document.title = '越韵智传 · 越韵课堂';
  }, []);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    const res = await request<Course[]>(tab === 'mine' ? '/course' : '/course/all');
    setLoading(false);
    if (res.code === 0) {
      setCourses(res.data ?? []);
    } else {
      // 失败不再伪装成「空列表」：显式错误态 + 可重试
      setCourses(null);
      setError(res.message || '课程加载失败，请检查网络后重试');
    }
  }, [tab]);

  useEffect(() => {
    load();
  }, [load]);

  const join = async (id: number) => {
    const r = await request(`/course/${id}/join`, { method: 'POST' });
    toast(r.message || (r.code === 0 ? '已加入课程' : '加入课程失败'), r.code === 0 ? 'ok' : 'err');
    if (r.code === 0) load();
  };

  // 列表中实际出现过的分类（≥2 个才展示筛选，避免单课程时变成噪音）
  const presentCategories = useMemo(
    () => Array.from(new Set((courses || []).map((c) => c.category).filter(Boolean) as string[])),
    [courses]
  );
  const showChips = presentCategories.length >= 2;
  const filtered = useMemo(
    () => (category === 'all' || !courses ? courses : courses.filter((c) => c.category === category)),
    [courses, category]
  );

  return (
    <>
      <main className="main">
        <div className="container" style={{ paddingTop: 8 }}>
          <section className="page-hero">
            <div className="ink-wash ink-wash-1" style={{ background: 'var(--cyan)', left: '12%' }} />
            <div className="ink-wash ink-wash-2" style={{ background: 'var(--cinnabar)', right: '12%', opacity: 0.1 }} />
            <div className="hero-seal">
              <span className="seal seal-vertical">课堂</span>
            </div>
            <h1>越韵课堂</h1>
          </section>

          <div className="course-toolbar">
            <div className="learn-tabs" style={{ border: 'none', margin: 0 }}>
              <div
                className={`learn-tab ${tab === 'mine' ? 'active' : ''}`}
                onClick={() => setTab('mine')}
                {...activateProps(() => setTab('mine'))}
              >
                我的课程
              </div>
              {/* 教师不需要选课大厅 */}
              {!isTeacher && (
                <div
                  className={`learn-tab ${tab === 'all' ? 'active' : ''}`}
                  onClick={() => setTab('all')}
                  {...activateProps(() => setTab('all'))}
                >
                  选课大厅
                </div>
              )}
            </div>
            {isTeacher && (
              <div style={{ display: 'flex', gap: 8 }}>
                <Link className="btn btn-sm" to="/course-import"
                  style={{ border: '1px solid rgba(193,39,45,.5)', color: '#a12022' }}>
                  PDF 导入课程
                </Link>
                <button className="btn btn-primary btn-sm" onClick={() => setShowCreate(true)}>
                  ＋ 建课
                </button>
              </div>
            )}
          </div>

          {showChips && (
            <div className="category-chips">
              <div
                className={`chip ${category === 'all' ? 'active' : ''}`}
                onClick={() => setCategory('all')}
                {...activateProps(() => setCategory('all'))}
              >
                全部
              </div>
              {presentCategories.map((c) => (
                <div
                  key={c}
                  className={`chip ${category === c ? 'active' : ''}`}
                  onClick={() => setCategory(c)}
                  {...activateProps(() => setCategory(c))}
                >
                  {c}
                </div>
              ))}
            </div>
          )}

          <div className="course-grid">
            {loading && (
              <div className="empty-state" style={{ gridColumn: '1/-1' }}>
                <div className="spinner" style={{ margin: '0 auto' }} />
                <div className="empty-state-text" role="status">正在载入课程…</div>
              </div>
            )}

            {!loading && error && (
              <EmptyState style={{ gridColumn: '1/-1' }} role="alert" icon="叹" text={error}>
                <button className="btn btn-sm" style={{ marginTop: 14 }} onClick={load}>
                  重新加载
                </button>
              </EmptyState>
            )}

            {!loading && !error && courses && courses.length === 0 && (
              <EmptyState
                style={{ gridColumn: '1/-1' }}
                icon={tab === 'mine' ? '空' : '寻'}
                text={
                  tab === 'mine'
                    ? isTeacher
                      ? '尚未创建课程，点击右上角「建课」'
                      : '尚未加入课程，去「选课大厅」看看'
                    : '暂无开放课程'
                }
              />
            )}

            {!loading &&
              !error &&
              filtered &&
              filtered.map((c, i) => (
                <CourseCard key={c.id} course={c} index={i} showJoin={tab === 'all'} onJoin={join} />
              ))}
          </div>
        </div>
      </main>

      {showCreate && (
        <CreateCourseModal
          onClose={() => setShowCreate(false)}
          onCreated={() => {
            setShowCreate(false);
            load();
          }}
        />
      )}
    </>
  );
}

function CreateCourseModal({ onClose, onCreated }: { onClose: () => void; onCreated: () => void }) {
  const [title, setTitle] = useState('');
  const [subtitle, setSubtitle] = useState('');
  const [category, setCategory] = useState(CATEGORIES[0]);
  const [description, setDescription] = useState('');
  const [submitting, setSubmitting] = useState(false);

  const submit = async () => {
    const t = title.trim();
    if (!t) {
      toast('请填写课程标题', 'err');
      return;
    }
    setSubmitting(true);
    const r = await request<{ id: number }>('/course', {
      method: 'POST',
      body: { title: t, subtitle: subtitle.trim(), category, description: description.trim() },
    });
    setSubmitting(false);
    toast(r.message || (r.code === 0 ? '课程已创建' : '创建课程失败'), r.code === 0 ? 'ok' : 'err');
    if (r.code === 0) onCreated();
  };

  return (
    <Modal
      title="创建课程"
      onClose={onClose}
      actions={
        <button className="btn btn-primary" disabled={submitting} onClick={submit}>
          {submitting ? '创建中…' : '创建'}
        </button>
      }
    >
      <div className="field">
        <label className="field-label" htmlFor="cc-title">课程标题</label>
        <input
          id="cc-title"
          className="input"
          placeholder="如：越剧流派赏析"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
        />
      </div>
      <div className="field">
        <label className="field-label" htmlFor="cc-subtitle">副标题</label>
        <input
          id="cc-subtitle"
          className="input"
          placeholder="如：十二大流派唱腔精讲"
          value={subtitle}
          onChange={(e) => setSubtitle(e.target.value)}
        />
      </div>
      <div className="field">
        <label className="field-label" htmlFor="cc-category">分类</label>
        <select id="cc-category" className="select" value={category} onChange={(e) => setCategory(e.target.value)}>
          {CATEGORIES.map((c) => (
            <option key={c} value={c}>
              {c}
            </option>
          ))}
        </select>
      </div>
      <div className="field">
        <label className="field-label" htmlFor="cc-desc">课程简介</label>
        <textarea
          id="cc-desc"
          className="textarea"
          placeholder="介绍课程内容、目标与适用人群"
          value={description}
          onChange={(e) => setDescription(e.target.value)}
        />
      </div>
    </Modal>
  );
}
