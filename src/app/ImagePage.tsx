import { useCallback, useEffect, useState } from 'react';
import { request } from '../shared/api';
import { isLoggedIn } from '../shared/auth';
import { toast } from '../shared/toast';
import { activateProps } from '../shared/a11y';
import { AiBadge, AiNotice, AiMediaTag } from '../shared/AiLabel';
import stagePerformer from '../../public/assets/generated/defaults/stage-performer-v1.webp';
import gardenDawn from '../../public/assets/generated/defaults/garden-dawn-v1.webp';
import backstage from '../../public/assets/generated/defaults/backstage-v1.webp';
import inkLandscape from '../../public/assets/generated/defaults/ink-landscape-v1.webp';

// ---------- 后端载荷 ----------
interface EnhanceData {
  enhanced?: string;
  original?: string;
  suggestions?: { role?: string };
  knowledgeSources?: string[];
  fallback?: boolean;
  reason?: string;
}

interface GenerateData {
  id: number;
  imageUrl: string;
  prompt?: string;
  fallback?: boolean;
  fallbackReason?: string;
}

interface ImageHistoryItem {
  id: number;
  prompt: string;
  imageUrl: string;
  style?: string;
  role?: string | null;
  createdAt?: string;
}

type GallerySource = 'preset' | 'personal';

interface GalleryItem {
  id: string | number;
  prompt: string;
  imageUrl: string;
  source: GallerySource;
  label: string;
}

// 默认图与个人生图共用同一套画廊卡片。静态图片仅作灵感底图，不写入用户历史。
const DEFAULT_GALLERY_ITEMS: GalleryItem[] = [
  { id: 'preset-stage', prompt: '朱帷将启 · 越剧花旦舞台人物', imageUrl: stagePerformer, source: 'preset', label: '舞台人物' },
  { id: 'preset-garden', prompt: '春晓园林 · 水袖与江南晨雾', imageUrl: gardenDawn, source: 'preset', label: '春晓园林' },
  { id: 'preset-backstage', prompt: '后台妆台 · 行头未整，戏已将开', imageUrl: backstage, source: 'preset', label: '后台妆台' },
  { id: 'preset-ink', prompt: '水墨山水 · 云袖化作烟岚', imageUrl: inkLandscape, source: 'preset', label: '水墨山水' },
];

// ---------- 选项配置（与旧 image.html 的 chip 一致） ----------
const STYLE_OPTIONS = [
  { val: 'ink', brush: '水墨', sub: '写意留白' },
  { val: 'gongbi', brush: '工笔', sub: '细腻重彩' },
  { val: 'realistic', brush: '写实', sub: '光影真实' },
];

const ROLE_OPTIONS = [
  { val: '', brush: '不限', sub: '' },
  { val: 'sheng', brush: '生', sub: '小生' },
  { val: 'dan', brush: '旦', sub: '花旦' },
  { val: 'jing', brush: '净', sub: '花脸' },
];

// 生成面板的四种状态：空 / 加载中 / 失败 / 出图
type ArtState =
  | { kind: 'idle' }
  | { kind: 'loading' }
  | { kind: 'error'; message: string }
  | { kind: 'art'; url: string; prompt: string };

// 把模型建议的行当映射到前端已有 chip（生/旦）；其余行当不强行改选，避免错配
function mapRoleToChip(role: string): string | null {
  if (!role) return null;
  if (['xiaosheng', 'yin', 'fan', 'xu'].includes(role)) return 'sheng';
  if (['huadan', 'yuan', 'fu', 'wang'].includes(role)) return 'dan';
  return null;
}

// 丹青生图：AI 文生图 + 妙笔润色 + 历史画廊（自 public/js/image.js 迁移）
export function ImagePage() {
  const [prompt, setPrompt] = useState('');
  const [style, setStyle] = useState('ink');
  const [role, setRole] = useState('');
  const [autoEnhance, setAutoEnhance] = useState(true);
  const [enhancing, setEnhancing] = useState(false);
  const [generating, setGenerating] = useState(false);
  const [art, setArt] = useState<ArtState>({ kind: 'idle' });
  const [currentImgId, setCurrentImgId] = useState<number | null>(null);
  const [currentArtSource, setCurrentArtSource] = useState<GallerySource | null>(null);
  const [faved, setFaved] = useState(false);
  const [history, setHistory] = useState<ImageHistoryItem[] | null>(null);
  const [lightboxUrl, setLightboxUrl] = useState<string | null>(null);

  useEffect(() => {
    document.title = '越韵智传 · 丹青生图';
    document.body.classList.add('page-image');
    return () => document.body.classList.remove('page-image');
  }, []);

  // ---------- 历史记录 ----------
  const loadHistory = useCallback(async () => {
    if (!isLoggedIn()) {
      setHistory([]);
      return;
    }
    const res = await request<ImageHistoryItem[]>('/image/history');
    if (res.code === 0) setHistory(res.data || []);
  }, []);

  useEffect(() => {
    loadHistory();
  }, [loadHistory]);

  // ---------- 妙笔润色（提示词增强） ----------
  // applyToInput=false 时只取 enhanced 供生成使用、不改写输入框
  const enhance = useCallback(
    async (applyToInput: boolean): Promise<EnhanceData | null> => {
      const text = prompt.trim();
      if (!text) {
        toast('请先输入描述再润色', 'err');
        return null;
      }
      if (!isLoggedIn()) {
        toast('请先登录后润色', 'err');
        return null;
      }

      setEnhancing(true);
      const res = await request<EnhanceData>('/image/enhance-prompt', {
        method: 'POST',
        body: { prompt: text, current: { role, style } },
      });
      setEnhancing(false);

      if (res.code !== 0 || !res.data) {
        toast(res.message || '润色失败', 'err');
        return null;
      }

      const { enhanced, suggestions, knowledgeSources, fallback, reason } = res.data;
      if (applyToInput && enhanced) setPrompt(enhanced);

      // 应用行当建议（仅当能映射到现有 chip）
      if (suggestions?.role) {
        const chipVal = mapRoleToChip(suggestions.role);
        if (chipVal) setRole(chipVal);
      }

      if (fallback) {
        toast(`润色未生效：${reason || '已沿用原描述'}`, 'err');
      } else {
        let msg = '已妙笔润色';
        if (knowledgeSources?.length) msg += `（参考校本知识库：${knowledgeSources.join('、')}）`;
        toast(msg, 'ok');
      }
      return res.data;
    },
    [prompt, role, style],
  );

  // ---------- 生成 ----------
  const generate = useCallback(async () => {
    const text = prompt.trim();
    if (!text) {
      toast('请输入画面描述', 'err');
      return;
    }
    if (!isLoggedIn()) {
      toast('请先登录后生图', 'err');
      return;
    }

    // 生成前自动妙笔润色（可关闭勾选）
    let finalPrompt = text;
    if (autoEnhance) {
      try {
        const data = await enhance(false);
        if (data?.enhanced) finalPrompt = data.enhanced;
      } catch {
        /* 润色失败不阻断生成，沿用原描述 */
      }
    }

    // 加载态（后端会等到图片下载完成才返回，可能需要 10-30 秒）
    setArt({ kind: 'loading' });
    setGenerating(true);

    const res = await request<GenerateData>('/image/generate', {
      method: 'POST',
      body: { prompt: finalPrompt, style, role },
    });

    setGenerating(false);

    if (res.code !== 0 || !res.data?.imageUrl) {
      setArt({ kind: 'error', message: res.message || '生成失败' });
      return;
    }

    setCurrentImgId(res.data.id);
    setCurrentArtSource('personal');
    setArt({ kind: 'art', url: res.data.imageUrl, prompt: finalPrompt });
    setFaved(false);
    if (res.data.fallback) {
      toast(`丹青已成（兜底模型：${res.data.fallbackReason || '主模型不可用'}）`, 'ok');
    } else {
      toast('丹青已成', 'ok');
    }
    loadHistory();
  }, [prompt, autoEnhance, enhance, style, role, loadHistory]);

  // ---------- 收藏图片 ----------
  const favorite = async () => {
    if (!currentImgId) return;
    const res = await request('/favorite', {
      method: 'POST',
      body: { type: 'image', targetId: currentImgId },
    });
    if (res.code === 0) {
      setFaved(true);
      toast('已收藏', 'ok');
    } else {
      toast(res.message || '收藏失败', 'err');
    }
  };

  // 默认图片和个人作品的选用逻辑保持一致：选中后回到上方展示区，可下载或继续作为定制素材。
  const selectGalleryItem = (item: GalleryItem) => {
    setArt({ kind: 'art', url: item.imageUrl, prompt: item.prompt });
    setCurrentImgId(item.source === 'personal' && typeof item.id === 'number' ? item.id : null);
    setCurrentArtSource(item.source);
    setFaved(false);
    toast(`已选用「${item.label}」`, 'ok');
  };

  const personalGalleryItems: GalleryItem[] = (history || []).map((item) => ({
    id: item.id,
    prompt: item.prompt,
    imageUrl: item.imageUrl,
    source: 'personal',
    label: '我的生成',
  }));
  const galleryItems = [...DEFAULT_GALLERY_ITEMS, ...personalGalleryItems];

  return (
    <>
      <main className="main">
        <div className="container" style={{ paddingTop: 8 }}>
          <section className="page-hero">
            <div className="ink-wash ink-wash-1" style={{ background: 'var(--cinnabar)', left: '8%' }} />
            <div className="ink-wash ink-wash-2" style={{ background: 'var(--cyan)', right: '10%' }} />
            <div className="hero-seal">
              <span className="seal seal-vertical">丹青</span>
            </div>
            <h1>
              丹青生图 <AiBadge style={{ fontSize: 12, padding: '2px 10px' }} />
            </h1>
          </section>
          <AiNotice text="本页图片由人工智能生成模型（Kolors）合成，非真实影像记录；生成内容可能与实际戏曲服饰、妆容、流派特征存在偏差，仅作教学示意，不得作为史料引用。" />

          <div className="image-main">
            {/* 创作面板 */}
            <div className="image-create">
              <div className="scroll-frame create-panel">
                <div className="section-title">
                  <span className="st-text">画意</span>
                  <span className="st-line" />
                </div>
                <div className="field">
                  <label className="field-label" htmlFor="img-prompt">画面描述</label>
                  <textarea
                    id="img-prompt"
                    className="textarea"
                    placeholder="例：林黛玉葬花，落英缤纷，手持花锄，神情哀婉…"
                    rows={4}
                    value={prompt}
                    onChange={(e) => setPrompt(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) generate();
                    }}
                  />
                </div>
                <div className="field">
                  <label className="field-label" id="img-style-label">画风流派</label>
                  <div className="option-grid" role="group" aria-labelledby="img-style-label">
                    {STYLE_OPTIONS.map((s) => (
                      <div
                        key={s.val}
                        className={`option-chip ${style === s.val ? 'active' : ''}`}
                        onClick={() => setStyle(s.val)}
                        {...activateProps(() => setStyle(s.val), `${s.brush} ${s.sub}`)}
                      >
                        <span className="chip-brush">{s.brush}</span>
                        <span className="chip-sub">{s.sub}</span>
                      </div>
                    ))}
                  </div>
                </div>
                <div className="field">
                  <label className="field-label" id="img-role-label">行当角色</label>
                  <div className="option-grid" role="group" aria-labelledby="img-role-label" style={{ gridTemplateColumns: 'repeat(4,1fr)' }}>
                    {ROLE_OPTIONS.map((r) => (
                      <div
                        key={r.val || 'any'}
                        className={`option-chip ${role === r.val ? 'active' : ''}`}
                        onClick={() => setRole(r.val)}
                        {...activateProps(() => setRole(r.val), r.brush)}
                      >
                        <span className="chip-brush">{r.brush}</span>
                        {r.sub && <span className="chip-sub">{r.sub}</span>}
                      </div>
                    ))}
                  </div>
                </div>
                <div style={{ display: 'flex', gap: 10, marginTop: 8 }}>
                  <button
                    className="btn btn-primary btn-lg"
                    style={{ flex: 1 }}
                    disabled={generating}
                    onClick={generate}
                  >
                    {generating ? '挥毫中…' : '挥毫生成'}
                  </button>
                  <button
                    className="btn btn-ghost btn-lg"
                    title="妙笔润色：把简短典故扩写成可直接作画的画面描述"
                    disabled={enhancing}
                    onClick={() => enhance(true)}
                  >
                    {enhancing ? '润色中…' : '妙笔'}
                  </button>
                </div>
                <label
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: 6,
                    marginTop: 10,
                    fontSize: 12,
                    color: 'var(--ink-light)',
                    cursor: 'pointer',
                  }}
                >
                  <input type="checkbox" checked={autoEnhance} onChange={(e) => setAutoEnhance(e.target.checked)} />
                  <span>生成前自动妙笔润色（自动补充越剧典故画面）</span>
                </label>
                <div style={{ marginTop: 12, fontSize: 12, color: 'var(--ink-light)', lineHeight: 1.7 }}>
                  提示：描述越具体，画面越生动。可加入服饰、场景、情绪、道具等细节。点击「妙笔」可一键把“林黛玉葬花”这类典故扩写成作画级描述。
                </div>
              </div>
            </div>

            {/* 作品展示 */}
            <div className="image-result">
              <div className="art-display" style={{ position: 'relative' }}>
                {art.kind === 'art' && <AiMediaTag text="AI 生成图片" />}
                {art.kind === 'idle' && (
                  <div className="art-empty">
                    <div className="empty-icon">墨</div>
                    <div style={{ fontFamily: 'var(--font-kai)', fontSize: 16 }}>落笔之处，画卷将现</div>
                    <div style={{ fontSize: 13, marginTop: 6 }}>输入画意后点击「挥毫生成」</div>
                  </div>
                )}
                {art.kind === 'loading' && (
                  <div className="art-empty art-loading">
                    <div className="spinner" />
                    <div style={{ marginTop: 16, fontFamily: 'var(--font-kai)' }}>正在泼墨挥毫…</div>
                    <div style={{ fontSize: 12, marginTop: 8, color: 'var(--ink-300)' }}>
                      AI 正在调墨构思，约需 10-30 秒，请稍候
                    </div>
                  </div>
                )}
                {art.kind === 'error' && (
                  <div className="art-empty">
                    <div className="empty-icon" style={{ color: 'var(--cinnabar)' }}>
                      叹
                    </div>
                    <div>{art.message}</div>
                    <div style={{ fontSize: 13, marginTop: 6, color: 'var(--ink-300)' }}>
                      AI 生图服务偶尔不稳定，请稍后重试
                    </div>
                  </div>
                )}
                {art.kind === 'art' && (
                  <img
                    src={art.url}
                    alt={art.prompt}
                    style={{ cursor: 'zoom-in' }}
                    onClick={() => setLightboxUrl(art.url)}
                    {...activateProps(() => setLightboxUrl(art.url), '查看大图')}
                  />
                )}
              </div>
              {art.kind === 'art' && (
                <div className="art-actions">
                  <a className="btn btn-ghost btn-sm" href={art.url} download>
                    <svg
                      width="14"
                      height="14"
                      viewBox="0 0 24 24"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="2"
                    >
                      <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
                      <polyline points="7 10 12 15 17 10" />
                      <line x1="12" y1="15" x2="12" y2="3" />
                    </svg>
                    下载
                  </a>
                  {currentArtSource === 'personal' && (
                    <button className={`btn btn-ghost btn-sm${faved ? ' faved' : ''}`} onClick={favorite}>
                    <svg
                      width="14"
                      height="14"
                      viewBox="0 0 24 24"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="2"
                    >
                      <path d="M19 21l-7-5-7 5V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2z" />
                    </svg>
                    收藏
                    </button>
                  )}
                </div>
              )}
            </div>
          </div>

          {/* 默认图与历史记录：用户无需先生成，也能从同一画廊里直接选图 */}
          <section className="image-history-sec">
            <div className="section-head">
              <div>
                <div className="sh-title">丹青画匣</div>
                <div className="sh-sub">默认灵感底图与您的生图作品，点击即可选用</div>
              </div>
              <span className="tag">{`${galleryItems.length} 幅`}</span>
            </div>
            <div className="gallery image-choice-gallery">
              {galleryItems.map((item) => (
                <button
                  type="button"
                  key={item.id}
                  className={`gallery-item image-choice-item ${art.kind === 'art' && art.url === item.imageUrl ? 'selected' : ''}`}
                  onClick={() => selectGalleryItem(item)}
                  aria-label={`选用${item.label}`}
                >
                  <img src={item.imageUrl} alt={item.prompt} loading="lazy" />
                  <span className={`gi-source ${item.source}`}>{item.source === 'preset' ? '默认底图' : '我的生成'}</span>
                  <span className="gi-overlay">
                    <span className="gi-title">{item.prompt}</span>
                    <span className="gi-select">点击选用</span>
                  </span>
                </button>
              ))}
              {history === null && isLoggedIn() && (
                <div className="gallery-loading" aria-label="正在加载您的生图历史">
                  <div className="spinner" />
                  <span>正在加载您的作品</span>
                </div>
              )}
            </div>
            {history !== null && history.length === 0 && <p className="gallery-empty-note">还没有自己的作品？从上面的默认底图开始，或挥毫生成第一幅。</p>}
          </section>
        </div>
      </main>

      {/* 大图预览弹层 */}
      {lightboxUrl && (
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
          }}
          onClick={() => setLightboxUrl(null)}
        >
          <img
            src={lightboxUrl}
            alt="画作预览"
            style={{
              maxWidth: '90%',
              maxHeight: '90%',
              borderRadius: 8,
              boxShadow: '0 20px 60px rgba(0,0,0,0.5)',
            }}
          />
        </div>
      )}
    </>
  );
}
