/* ============================================================
   个人中心页（React 版）
   迁移自 public/profile.html + public/js/profile.js
   个人资料展示与编辑 + 会话/丹青/画作/收藏四类历史记录
   ============================================================ */
import { useCallback, useEffect, useState, type CSSProperties } from 'react';
import { useNavigate } from 'react-router-dom';
import { request } from '../shared/api';
import { clearAuth, getToken, getUser, setUser } from '../shared/auth';
import { toast } from '../shared/toast';
import { Modal } from '../shared/modal';
import { formatTime } from '../shared/format';
import type { User } from '../shared/types';

type ProfileTab = 'chat' | 'favorite' | 'image' | 'draw';

const TABS: Array<{ key: ProfileTab; label: string }> = [
  { key: 'chat', label: '聊天历史' },
  { key: 'favorite', label: '收藏记录' },
  { key: 'image', label: '生图历史' },
  { key: 'draw', label: '我的画作' },
];

// /auth/me 返回 DB 行（real_name / created_at 为 snake_case），同时兼容 camelCase
interface ProfileUser {
  id?: number;
  username?: string;
  email?: string | null;
  role?: string;
  realName?: string | null;
  real_name?: string | null;
  avatar?: string | null;
  intro?: string | null;
  created_at?: string;
}

interface ChatHistoryItem {
  sessionId: string;
  firstMessage?: string | null;
  lastMessage?: string | null;
  createdAt: string;
}

interface ImageHistoryItem {
  imageUrl: string;
  prompt?: string | null;
}

interface FavoriteItem {
  type: 'chat' | 'image';
  content?: string | null;
  imageUrl?: string | null;
  prompt?: string | null;
  createdAt: string;
}

interface DrawingItem {
  id: number;
  title: string;
  created_at: string;
}

function Loading() {
  return (
    <div style={{ textAlign: 'center', padding: 40 }}>
      <div className="spinner" style={{ margin: '0 auto' }} />
    </div>
  );
}

// 将 /auth/me 返回（含 snake_case 字段）合并进本地登录态，并归一化为 User 类型
function mergeAuthUser(cur: User, d: ProfileUser): User {
  return {
    ...cur,
    ...d,
    role: d.role === 'teacher' ? 'teacher' : d.role === 'student' ? 'student' : cur.role,
    realName: d.realName ?? d.real_name ?? cur.realName ?? null,
  };
}

function EmptyState({ icon, text }: { icon: string; text: string }) {
  return (
    <div className="empty-state">
      <div className="es-icon">{icon}</div>
      <div>{text}</div>
    </div>
  );
}

// 个人中心：登录后可见（路由层登录守卫 + 401 兜底）
export function ProfilePage() {
  const navigate = useNavigate();
  const [me, setMe] = useState<ProfileUser>(() => getUser() || {});
  const [stats, setStats] = useState<{ chat: number; img: number; draw: number; fav: number } | null>(null);
  const [tab, setTab] = useState<ProfileTab>('chat');
  const [editOpen, setEditOpen] = useState(false);

  useEffect(() => {
    document.title = '越韵智传 · 个人中心';
  }, []);

  // 拉取个人信息与四类统计（与旧版 loadProfile 一致）
  useEffect(() => {
    let alive = true;
    (async () => {
      const meRes = await request<ProfileUser>('/auth/me');
      if (!alive) return;
      if (meRes.code === 0 && meRes.data) {
        const d = meRes.data;
        setMe(d);
        const cur = getUser();
        if (cur) {
          setUser(mergeAuthUser(cur, d));
        }
      }
      const [chatRes, imgRes, favRes, drawRes] = await Promise.all([
        request<ChatHistoryItem[]>('/chat/history'),
        request<ImageHistoryItem[]>('/image/history'),
        request<FavoriteItem[]>('/favorite'),
        request<DrawingItem[]>('/drawing'),
      ]);
      if (!alive) return;
      setStats({
        chat: chatRes.data?.length || 0,
        img: imgRes.data?.length || 0,
        fav: favRes.data?.length || 0,
        draw: drawRes.data?.length || 0,
      });
    })();
    return () => {
      alive = false;
    };
  }, []);

  // 删除画作后同步统计数字
  const updateDrawCount = useCallback((n: number) => {
    setStats((s) => (s ? { ...s, draw: n } : s));
  }, []);

  const logout = () => {
    clearAuth();
    toast('已退出登录', 'ok');
    setTimeout(() => navigate('/login', { replace: true }), 700);
  };

  const onProfileSaved = (d: ProfileUser) => {
    setMe(d);
    const cur = getUser();
    if (cur) {
      setUser(mergeAuthUser(cur, d));
    }
    setEditOpen(false);
    toast('资料已更新', 'ok');
  };

  const role = me.role || 'student';
  const realName = me.realName || me.real_name || '';
  const avatarChar = (me.username || '韵').charAt(0);
  const statList = [
    { label: '会话', value: stats ? stats.chat : null },
    { label: '丹青', value: stats ? stats.img : null },
    { label: '画作', value: stats ? stats.draw : null },
    { label: '收藏', value: stats ? stats.fav : null },
  ];

  return (
    <>
      <main className="main">
        <div className="container" style={{ paddingTop: 8 }}>
          <section className="page-hero">
            <div className="ink-wash ink-wash-1" style={{ background: 'var(--cinnabar)', left: '10%', opacity: 0.12 }} />
            <div className="ink-wash ink-wash-2" style={{ background: 'var(--cyan)', right: '10%' }} />
            <div className="hero-seal">
              <span className="seal seal-vertical">己</span>
            </div>
            <h1>个人中心</h1>
          </section>

          <div className="profile-main" style={{ marginTop: 8 }}>
            <div className="scroll-frame">
              <div className="profile-header">
                <div className="profile-avatar">{avatarChar}</div>
                <div style={{ flex: 1 }}>
                  <div className="profile-name">
                    {me.username || '用户'}
                    <span className={`role-tag ${role}`} style={{ marginLeft: 10, verticalAlign: 'middle' }}>
                      {role === 'teacher' ? '师' : '生'}
                    </span>
                  </div>
                  {realName ? (
                    <div
                      className="profile-meta"
                      style={{ fontFamily: 'var(--font-brush)', fontSize: 18, color: 'var(--ink-soft)' }}
                    >
                      「{realName}」
                    </div>
                  ) : null}
                  {me.intro ? (
                    <div className="profile-meta" style={{ marginTop: 4 }}>
                      {me.intro}
                    </div>
                  ) : null}
                  <div className="profile-meta" style={{ marginTop: 4 }}>
                    {me.created_at ? `加入于 ${formatTime(me.created_at)}` : '加入于 —'}
                  </div>
                </div>
                <button className="btn btn-ghost btn-sm" style={{ marginRight: 8 }} onClick={() => setEditOpen(true)}>
                  编辑资料
                </button>
                <button className="btn btn-ghost btn-sm" onClick={logout}>
                  退出登录
                </button>
              </div>
              <div className="profile-stats">
                {statList.map((s) => (
                  <div className="stat-card" key={s.label}>
                    <div className={`stat-num${s.value === null ? ' stat-loading' : ''}`}>
                      {s.value === null ? '…' : s.value}
                    </div>
                    <div className="stat-label">{s.label}</div>
                  </div>
                ))}
              </div>
            </div>

            <div className="tabs">
              {TABS.map((t) => (
                <div key={t.key} className={`tab-btn ${t.key === tab ? 'active' : ''}`} onClick={() => setTab(t.key)}>
                  {t.label}
                </div>
              ))}
            </div>

            <div>
              {tab === 'chat' && <ChatHistoryTab />}
              {tab === 'favorite' && <FavoriteTab />}
              {tab === 'image' && <ImageHistoryTab />}
              {tab === 'draw' && <DrawingsTab onCountChange={updateDrawCount} />}
            </div>
          </div>
        </div>
      </main>

      {editOpen && <EditProfileModal me={me} onClose={() => setEditOpen(false)} onSaved={onProfileSaved} />}
    </>
  );
}

// ---------- 编辑资料 ----------
function EditProfileModal({
  me,
  onClose,
  onSaved,
}: {
  me: ProfileUser;
  onClose: () => void;
  onSaved: (d: ProfileUser) => void;
}) {
  const [realName, setRealName] = useState(me.realName || me.real_name || '');
  const [email, setEmail] = useState(me.email || '');
  const [intro, setIntro] = useState(me.intro || '');
  const [saving, setSaving] = useState(false);

  const save = async () => {
    setSaving(true);
    const r = await request<ProfileUser>('/auth/me', {
      method: 'PUT',
      body: {
        realName: realName.trim() || null,
        email: email.trim() || null,
        intro: intro.trim() || null,
      },
    });
    setSaving(false);
    if (r.code !== 0 || !r.data) {
      toast(r.message || '保存失败', 'err');
      return;
    }
    onSaved(r.data);
  };

  return (
    <Modal
      title="编辑资料"
      onClose={onClose}
      actions={
        <button className="btn btn-primary" disabled={saving} onClick={save}>
          保存
        </button>
      }
    >
      <div className="field">
        <label className="field-label">真实姓名</label>
        <input
          className="input"
          placeholder="如：王文娟"
          maxLength={50}
          value={realName}
          onChange={(e) => setRealName(e.target.value)}
        />
      </div>
      <div className="field">
        <label className="field-label">邮箱</label>
        <input
          className="input"
          placeholder="便于找回密码"
          maxLength={100}
          value={email}
          onChange={(e) => setEmail(e.target.value)}
        />
      </div>
      <div className="field">
        <label className="field-label">个人简介</label>
        <textarea
          className="textarea"
          placeholder="一句话介绍自己，与越剧的缘分…"
          maxLength={200}
          value={intro}
          onChange={(e) => setIntro(e.target.value)}
        />
      </div>
    </Modal>
  );
}

// ---------- 聊天历史 ----------
function ChatHistoryTab() {
  const navigate = useNavigate();
  const [list, setList] = useState<ChatHistoryItem[] | null>(null);

  useEffect(() => {
    let alive = true;
    (async () => {
      const res = await request<ChatHistoryItem[]>('/chat/history');
      if (alive) setList(res.code === 0 && res.data ? res.data : []);
    })();
    return () => {
      alive = false;
    };
  }, []);

  if (list === null) return <Loading />;
  if (list.length === 0) return <EmptyState icon="问" text="暂无聊天记录，去智能问答探索吧" />;

  return (
    <div className="timeline">
      {list.map((s, i) => (
        <div className="timeline-item" style={{ animationDelay: `${i * 0.05}s` }} key={s.sessionId}>
          <div
            className="history-card"
            style={{ cursor: 'pointer' }}
            onClick={() => {
              // SPA 路由内跳转智能问答，携带 session 恢复历史会话
              navigate(`/chat?session=${encodeURIComponent(s.sessionId)}`);
            }}
          >
            <div className="hc-title">{s.firstMessage || s.lastMessage || '新会话'}</div>
            <div className="hc-time">{formatTime(s.createdAt)}</div>
          </div>
        </div>
      ))}
    </div>
  );
}

// ---------- 生图历史 ----------
function ImageHistoryTab() {
  const [list, setList] = useState<ImageHistoryItem[] | null>(null);
  const [lightboxUrl, setLightboxUrl] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    (async () => {
      const res = await request<ImageHistoryItem[]>('/image/history');
      if (alive) setList(res.code === 0 && res.data ? res.data : []);
    })();
    return () => {
      alive = false;
    };
  }, []);

  if (list === null) return <Loading />;
  if (list.length === 0) return <EmptyState icon="卷" text="暂无生图作品，去丹青生图创作吧" />;

  return (
    <>
      <div className="gallery">
        {list.map((item) => (
          <div className="gallery-item" key={item.imageUrl} onClick={() => setLightboxUrl(item.imageUrl)}>
            <img src={item.imageUrl} alt={item.prompt || ''} loading="lazy" />
            <div className="gi-overlay">
              <div className="gi-title">{item.prompt}</div>
            </div>
          </div>
        ))}
      </div>
      {lightboxUrl && <Lightbox url={lightboxUrl} onClose={() => setLightboxUrl(null)} />}
    </>
  );
}

// ---------- 收藏记录 ----------
function FavoriteTab() {
  const [list, setList] = useState<FavoriteItem[] | null>(null);
  const [lightboxUrl, setLightboxUrl] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    (async () => {
      const res = await request<FavoriteItem[]>('/favorite');
      if (alive) setList(res.code === 0 && res.data ? res.data : []);
    })();
    return () => {
      alive = false;
    };
  }, []);

  if (list === null) return <Loading />;
  if (list.length === 0) return <EmptyState icon="藏" text="暂无收藏，点击问答或作品中的收藏按钮" />;

  const chats = list.filter((x) => x.type === 'chat');
  const images = list.filter((x) => x.type === 'image' && x.imageUrl);

  return (
    <>
      {chats.length > 0 ? (
        <>
          <div className="section-title">
            <span className="st-text">问答收藏</span>
            <span className="st-line" />
          </div>
          <div className="timeline">
            {chats.map((f, i) => {
              let q = '已收藏问答';
              let a = '';
              if (f.content) {
                try {
                  const c = JSON.parse(f.content) as { question?: string; answer?: string };
                  q = c.question || q;
                  a = c.answer || '';
                } catch {
                  // 非 JSON 内容保持默认展示
                }
              }
              return (
                <div className="timeline-item" style={{ animationDelay: `${i * 0.05}s` }} key={`${f.createdAt}-${i}`}>
                  <div className="history-card">
                    <div className="hc-title">{q}</div>
                    <div
                      className="hc-time"
                      style={{
                        display: '-webkit-box',
                        WebkitLineClamp: 2,
                        WebkitBoxOrient: 'vertical',
                        overflow: 'hidden',
                      }}
                    >
                      {a.slice(0, 80)}
                      {a.length > 80 ? '…' : ''}
                    </div>
                    <div className="hc-time" style={{ marginTop: 4 }}>
                      {formatTime(f.createdAt)}
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        </>
      ) : null}

      {images.length > 0 ? (
        <>
          <div className="section-title" style={{ marginTop: 24 }}>
            <span className="st-text">丹青收藏</span>
            <span className="st-line" />
          </div>
          <div className="gallery">
            {images.map((f) => (
              <div className="gallery-item" key={f.imageUrl || f.createdAt} onClick={() => setLightboxUrl(f.imageUrl || '')}>
                <img src={f.imageUrl || ''} alt={f.prompt || ''} loading="lazy" />
                {f.prompt ? (
                  <div className="gi-overlay">
                    <div className="gi-title">{f.prompt}</div>
                  </div>
                ) : null}
              </div>
            ))}
          </div>
        </>
      ) : null}

      {lightboxUrl && <Lightbox url={lightboxUrl} onClose={() => setLightboxUrl(null)} />}
    </>
  );
}

// ---------- 我的画作 ----------
function DrawingsTab({ onCountChange }: { onCountChange: (n: number) => void }) {
  const [list, setList] = useState<DrawingItem[] | null>(null);
  const [preview, setPreview] = useState<DrawingItem | null>(null);
  const [deleting, setDeleting] = useState(false);
  // 删除不可恢复，必须先二次确认（原先点一下就直接删了）
  const [confirming, setConfirming] = useState(false);

  const load = useCallback(async () => {
    const res = await request<DrawingItem[]>('/drawing');
    const l = res.code === 0 && res.data ? res.data : [];
    setList(l);
    onCountChange(l.length);
  }, [onCountChange]);

  useEffect(() => {
    load();
  }, [load]);

  const closePreview = () => {
    setPreview(null);
    setConfirming(false);
  };

  const del = async () => {
    if (!preview || deleting) return;
    setDeleting(true);
    const r = await request(`/drawing/${preview.id}`, { method: 'DELETE' });
    setDeleting(false);
    if (r.code !== 0) {
      toast(r.message || '删除失败', 'err');
      return;
    }
    setPreview(null);
    setConfirming(false);
    toast('已删除', 'ok');
    load();
  };

  if (list === null) return <Loading />;
  if (list.length === 0) return <EmptyState icon="墨" text="暂无画作，去水墨画板挥毫吧" />;

  return (
    <>
      <div className="draw-gallery">
        {list.map((d) => (
          <div className="draw-thumb" key={d.id} onClick={() => setPreview(d)}>
            <AuthImage src={`/api/drawing/${d.id}/image`} alt={d.title} />
            <div className="draw-thumb-info">
              <div style={{ color: 'var(--ink)', fontWeight: 500, marginBottom: 2 }}>{d.title}</div>
              <div>{formatTime(d.created_at)}</div>
            </div>
          </div>
        ))}
      </div>

      {preview && (
        <Modal
          title={preview.title || '画作预览'}
          onClose={closePreview}
          actions={
            confirming ? (
              <>
                <button className="btn btn-ghost" disabled={deleting} onClick={() => setConfirming(false)}>
                  取消
                </button>
                <button className="btn btn-primary" disabled={deleting} onClick={del}>
                  {deleting ? '删除中…' : '确认删除'}
                </button>
              </>
            ) : (
              <button className="btn btn-ghost" onClick={() => setConfirming(true)}>
                删除画作
              </button>
            )
          }
        >
          <AuthImage
            src={`/api/drawing/${preview.id}/image`}
            alt={preview.title}
            style={{ width: '100%', borderRadius: 4, border: '1px solid var(--ink-10)' }}
          />
          <div
            style={{
              marginTop: 12,
              textAlign: 'center',
              fontFamily: 'var(--font-brush)',
              fontSize: 18,
              color: 'var(--ink)',
            }}
          >
            {preview.title}
          </div>
        </Modal>
      )}
    </>
  );
}

// ---------- 需登录态的图片（画作接口带鉴权，fetch 转 blob URL 展示） ----------
function AuthImage({ src, alt, style }: { src: string; alt?: string; style?: CSSProperties }) {
  const [url, setUrl] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const token = getToken();
        const resp = await fetch(src, { headers: token ? { Authorization: `Bearer ${token}` } : undefined });
        if (!resp.ok) throw new Error(`图片加载失败 (${resp.status})`);
        const objectUrl = URL.createObjectURL(await resp.blob());
        if (alive) {
          setUrl(objectUrl);
        } else {
          URL.revokeObjectURL(objectUrl);
        }
      } catch {
        if (alive) setFailed(true);
      }
    })();
    return () => {
      alive = false;
    };
  }, [src]);

  // url 更新或组件卸载时释放上一个 blob URL，避免内存泄漏
  useEffect(() => {
    return () => {
      if (url) URL.revokeObjectURL(url);
    };
  }, [url]);

  if (failed) {
    return (
      <div className="auth-image-error" style={style}>
        {alt || '图片'}（加载失败）
      </div>
    );
  }
  if (!url) {
    return <div style={{ ...style, background: 'var(--ink-5)', aspectRatio: '4/3' }} />;
  }
  return <img src={url} alt={alt || ''} loading="lazy" style={style} />;
}

// ---------- 灯箱（点击放大，点击任意处关闭） ----------
function Lightbox({ url, onClose }: { url: string; onClose: () => void }) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose]);

  return (
    <div
      style={{
        position: 'fixed',
        inset: 0,
        background: 'rgba(26,26,26,0.85)',
        zIndex: 1000,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: 40,
        cursor: 'pointer',
      }}
      onClick={onClose}
    >
      <img src={url} alt="" style={{ maxWidth: '90%', maxHeight: '90%', borderRadius: 8 }} />
    </div>
  );
}
