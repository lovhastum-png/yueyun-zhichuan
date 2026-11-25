import { useCallback, useEffect, useRef, useState } from 'react';
import { request, postForm } from '../shared/api';
import { getToken, isLoggedIn } from '../shared/auth';
import { toast } from '../shared/toast';
import { Modal } from '../shared/modal';
import { formatTime } from '../shared/format';
import { EmptyState } from '../shared/EmptyState';
import { activateProps } from '../shared/a11y';
import { AiBadge, AiNotice } from '../shared/AiLabel';

// ---------- 配色（中国传统色） ----------
const COLORS = [
  { name: '墨黑', value: '#1a1a1a' },
  { name: '朱砂', value: '#c1272d' },
  { name: '赭石', value: '#8b5a3c' },
  { name: '古金', value: '#b08d57' },
  { name: '淡青', value: '#6b9fa3' },
  { name: '黛色', value: '#3a4a4a' },
  { name: '月白', value: '#a8b0b8' },
  { name: '深朱', value: '#9e1f24' },
];

// ---------- 笔锋 ----------
const BRUSHES = [
  { name: '细', size: 3, dot: 4 },
  { name: '中', size: 7, dot: 8 },
  { name: '粗', size: 14, dot: 14 },
  { name: '特粗', size: 24, dot: 22 },
];

const MAX_HISTORY = 30;

// ---------- 后端载荷 ----------
interface DrawingItem {
  id: number;
  title: string;
  file_path: string;
  created_at: string;
}

// 水墨画板：canvas 命令式绘图 + 保存管理（自 public/js/draw.js 迁移）
export function DrawPage() {
  const [color, setColor] = useState(COLORS[0].value);
  const [size, setSize] = useState(BRUSHES[1].size);
  const [gallery, setGallery] = useState<DrawingItem[] | null>(null);
  const [imageUrls, setImageUrls] = useState<Record<number, string>>({});
  const [showClear, setShowClear] = useState(false);
  const [showSave, setShowSave] = useState(false);
  const [saveTitle, setSaveTitle] = useState('');
  const [saving, setSaving] = useState(false);
  const [preview, setPreview] = useState<DrawingItem | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);

  const canvasRef = useRef<HTMLCanvasElement>(null);
  const ctxRef = useRef<CanvasRenderingContext2D | null>(null);
  const historyRef = useRef<ImageData[]>([]);
  const drawingRef = useRef(false);
  const lastPosRef = useRef({ x: 0, y: 0 });
  const colorRef = useRef(color);
  const sizeRef = useRef(size);
  const objectUrlsRef = useRef<string[]>([]);

  useEffect(() => {
    document.title = '越韵智传 · 水墨画板';
    document.body.classList.add('page-draw');
    return () => document.body.classList.remove('page-draw');
  }, []);

  // 画笔参数同步到 ref，供挂载期绑定的原生事件监听读取最新值
  useEffect(() => {
    colorRef.current = color;
  }, [color]);
  useEffect(() => {
    sizeRef.current = size;
  }, [size]);

  // ---------- 撤销栈 ----------
  function pushHistory() {
    const canvas = canvasRef.current;
    const ctx = ctxRef.current;
    if (!canvas || !ctx) return;
    try {
      historyRef.current.push(ctx.getImageData(0, 0, canvas.width, canvas.height));
      if (historyRef.current.length > MAX_HISTORY) historyRef.current.shift();
    } catch {
      /* 忽略 */
    }
  }

  // ---------- 初始化画布 ----------
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    ctxRef.current = ctx;
    ctx.fillStyle = '#f5f1e8';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    pushHistory();
  }, []);

  // ---------- 绘制 ----------
  function startDraw(x: number, y: number) {
    const ctx = ctxRef.current;
    if (!ctx) return;
    drawingRef.current = true;
    lastPosRef.current = { x, y };
    pushHistory();
    // 起笔点一个圆点，避免单击无痕迹
    ctx.beginPath();
    ctx.fillStyle = colorRef.current;
    ctx.arc(x, y, sizeRef.current / 2, 0, Math.PI * 2);
    ctx.fill();
  }

  function drawTo(x: number, y: number) {
    if (!drawingRef.current) return;
    const ctx = ctxRef.current;
    if (!ctx) return;
    ctx.beginPath();
    ctx.moveTo(lastPosRef.current.x, lastPosRef.current.y);
    ctx.lineTo(x, y);
    ctx.strokeStyle = colorRef.current;
    ctx.lineWidth = sizeRef.current;
    ctx.stroke();
    lastPosRef.current = { x, y };
  }

  function endDraw() {
    drawingRef.current = false;
  }

  // ---------- 鼠标 / 触摸事件（原生绑定，touch 需 passive:false 才能 preventDefault） ----------
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    // 坐标转换：屏幕 → 画布内部分辨率
    const getPos = (clientX: number, clientY: number) => {
      const rect = canvas.getBoundingClientRect();
      return {
        x: (clientX - rect.left) * (canvas.width / rect.width),
        y: (clientY - rect.top) * (canvas.height / rect.height),
      };
    };

    const onMouseDown = (e: MouseEvent) => {
      e.preventDefault();
      const p = getPos(e.clientX, e.clientY);
      startDraw(p.x, p.y);
    };
    const onMouseMove = (e: MouseEvent) => {
      if (!drawingRef.current) return;
      const p = getPos(e.clientX, e.clientY);
      drawTo(p.x, p.y);
    };
    const onTouchStart = (e: TouchEvent) => {
      e.preventDefault();
      const t = e.touches[0];
      if (!t) return;
      const p = getPos(t.clientX, t.clientY);
      startDraw(p.x, p.y);
    };
    const onTouchMove = (e: TouchEvent) => {
      e.preventDefault();
      if (!drawingRef.current) return;
      const t = e.touches[0];
      if (!t) return;
      const p = getPos(t.clientX, t.clientY);
      drawTo(p.x, p.y);
    };

    canvas.addEventListener('mousedown', onMouseDown);
    canvas.addEventListener('mousemove', onMouseMove);
    canvas.addEventListener('mouseleave', endDraw);
    window.addEventListener('mouseup', endDraw);
    canvas.addEventListener('touchstart', onTouchStart, { passive: false });
    canvas.addEventListener('touchmove', onTouchMove, { passive: false });
    canvas.addEventListener('touchend', endDraw);

    return () => {
      canvas.removeEventListener('mousedown', onMouseDown);
      canvas.removeEventListener('mousemove', onMouseMove);
      canvas.removeEventListener('mouseleave', endDraw);
      window.removeEventListener('mouseup', endDraw);
      canvas.removeEventListener('touchstart', onTouchStart);
      canvas.removeEventListener('touchmove', onTouchMove);
      canvas.removeEventListener('touchend', endDraw);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ---------- 撤销 ----------
  const undo = () => {
    const ctx = ctxRef.current;
    if (historyRef.current.length <= 1 || !ctx) {
      toast('已无更多笔触可撤销', 'err');
      return;
    }
    historyRef.current.pop();
    const prev = historyRef.current[historyRef.current.length - 1];
    ctx.putImageData(prev, 0, 0);
    toast('已撤销一笔', 'ok', 1200);
  };

  // ---------- 清空 ----------
  const confirmClear = () => {
    const canvas = canvasRef.current;
    const ctx = ctxRef.current;
    pushHistory();
    if (canvas && ctx) {
      ctx.fillStyle = '#f5f1e8';
      ctx.fillRect(0, 0, canvas.width, canvas.height);
    }
    setShowClear(false);
    toast('画板已清空', 'ok');
  };

  // ---------- 保存 ----------
  const openSave = () => {
    if (!isLoggedIn()) {
      toast('请先登录后再使用水墨画板', 'err');
      return;
    }
    setSaveTitle('');
    setShowSave(true);
  };

  const submitSave = async () => {
    const title = saveTitle.trim() || '未题名';
    setSaving(true);
    try {
      const blob = await new Promise<Blob | null>((res) => canvasRef.current?.toBlob(res, 'image/png'));
      if (!blob) throw new Error('导出画布失败');
      const fd = new FormData();
      fd.append('image', blob, 'drawing.png');
      fd.append('title', title);
      const r = await postForm<DrawingItem>('/drawing', fd);
      if (r.code !== 0) {
        toast(r.message || '保存失败', 'err');
        return;
      }
      toast('画作已保存', 'ok');
      setShowSave(false);
      loadGallery();
    } catch (err) {
      toast('保存失败：' + (err instanceof Error ? err.message : String(err)), 'err');
    } finally {
      setSaving(false);
    }
  };

  // ---------- 画廊 ----------
  const loadGallery = useCallback(async () => {
    if (!isLoggedIn()) {
      setGallery([]);
      return;
    }
    const r = await request<DrawingItem[]>('/drawing');
    const list = r.data || [];
    setGallery(list);

    // 释放旧的鉴权图片 objectURL
    objectUrlsRef.current.forEach((u) => URL.revokeObjectURL(u));
    objectUrlsRef.current = [];
    setImageUrls({});

    // 鉴权图片不能直接 <img src>（浏览器不附带 Bearer Token），先取二进制再显示
    const token = getToken();
    await Promise.all(
      list.map(async (d) => {
        try {
          const resp = await fetch(`/api/drawing/${d.id}/image`, {
            headers: token ? { Authorization: `Bearer ${token}` } : undefined,
          });
          if (!resp.ok) throw new Error(`图片加载失败 (${resp.status})`);
          const url = URL.createObjectURL(await resp.blob());
          objectUrlsRef.current.push(url);
          setImageUrls((prev) => ({ ...prev, [d.id]: url }));
        } catch {
          /* 加载失败的缩略图仅显示题名 */
        }
      }),
    );
  }, []);

  useEffect(() => {
    loadGallery();
    return () => {
      objectUrlsRef.current.forEach((u) => URL.revokeObjectURL(u));
      objectUrlsRef.current = [];
    };
  }, [loadGallery]);

  // ---------- 删除画作 ----------
  const deleteDrawing = async (id: number) => {
    const r = await request(`/drawing/${id}`, { method: 'DELETE' });
    if (r.code !== 0) {
      toast(r.message || '删除失败', 'err');
      return;
    }
    setConfirmDelete(false);
    setPreview(null);
    toast('已删除', 'ok');
    loadGallery();
  };

  return (
    <>
      <main className="main">
        <div className="container" style={{ paddingTop: 8 }}>
          {/* 页面横幅 */}
          <section className="page-hero">
            <div className="ink-wash ink-wash-1" style={{ background: 'var(--ink)', left: '5%', opacity: 0.18 }} />
            <div
              className="ink-wash ink-wash-2"
              style={{ background: 'var(--cinnabar)', right: '10%', opacity: 0.12 }}
            />
            <div className="hero-seal">
              <span className="seal seal-vertical">墨</span>
            </div>
            <h1>水墨画板 <AiBadge style={{ fontSize: 12, padding: '2px 10px' }} /></h1>
          </section>
          <AiNotice text="本页“AI 生图”作品由人工智能生成模型合成，非真实影像记录；人工绘制作品不受此标识约束。" />

          {/* 画板区 */}
          <div className="draw-layout">
            {/* 工具栏 */}
            <aside className="draw-toolbar">
              <div className="tool-section">
                <div className="tool-section-title">颜色</div>
                <div className="color-grid">
                  {COLORS.map((c) => (
                    <div
                      key={c.value}
                      className={`color-swatch ${color === c.value ? 'active' : ''}`}
                      style={{ background: c.value }}
                      title={c.name}
                      onClick={() => setColor(c.value)}
                    />
                  ))}
                </div>
              </div>

              <div className="tool-section">
                <div className="tool-section-title">笔锋</div>
                <div className="brush-sizes">
                  {BRUSHES.map((b) => (
                    <div
                      key={b.name}
                      className={`brush-size ${size === b.size ? 'active' : ''}`}
                      title={`${b.name}锋`}
                      onClick={() => setSize(b.size)}
                    >
                      <span className="dot" style={{ width: b.dot, height: b.dot }} />
                    </div>
                  ))}
                </div>
              </div>

              <div className="tool-section">
                <div className="tool-section-title">工具</div>
                <button
                  className="btn btn-ghost btn-sm"
                  style={{ width: '100%', marginBottom: 8 }}
                  onClick={undo}
                >
                  撤销一笔
                </button>
                <button
                  className="btn btn-ghost btn-sm"
                  style={{ width: '100%', marginBottom: 8 }}
                  onClick={() => setShowClear(true)}
                >
                  清空重画
                </button>
                <button className="btn btn-primary btn-sm" style={{ width: '100%' }} onClick={openSave}>
                  保存画作
                </button>
              </div>

              <div className="tool-section" style={{ marginBottom: 0 }}>
                <div className="tool-section-title">提示</div>
                <div style={{ fontSize: 12, color: 'var(--ink-light)', lineHeight: 1.7 }}>
                  鼠标或触控皆可作画；
                  <br />
                  保存后将收入「我的画作」。
                </div>
              </div>
            </aside>

            {/* 画板主体 */}
            <div className="draw-main">
              <div className="draw-canvas-wrap">
                <canvas ref={canvasRef} width={1000} height={600} />
              </div>
            </div>
          </div>

          {/* 我的画作 */}
          <div className="brush-divider" />
          <div className="section-title" style={{ marginBottom: 16 }}>
            <span className="st-text">我的画作</span>
            <span className="st-line" />
          </div>
          <div className="draw-gallery">
            {gallery === null && (
              <div className="empty-state" style={{ gridColumn: '1/-1' }}>
                <div className="spinner" style={{ margin: '0 auto' }} />
              </div>
            )}
            {gallery !== null && gallery.length === 0 && (
              <EmptyState style={{ gridColumn: '1/-1' }} icon="墨" text="尚无画作，保存第一幅吧" />
            )}
            {gallery?.map((d) => (
              <div
                key={d.id}
                className="draw-thumb"
                onClick={() => {
                  setPreview(d);
                  setConfirmDelete(false);
                }}
                {...activateProps(() => {
                  setPreview(d);
                  setConfirmDelete(false);
                }, d.title)}
              >
                <img src={imageUrls[d.id]} alt={d.title} loading="lazy" />
                <div className="draw-thumb-info">
                  <div style={{ color: 'var(--ink)', fontWeight: 500, marginBottom: 2 }}>{d.title}</div>
                  <div>{formatTime(d.created_at)}</div>
                </div>
              </div>
            ))}
          </div>
        </div>
      </main>

      {/* 清空确认 */}
      {showClear && (
        <Modal
          title="清空画板"
          onClose={() => setShowClear(false)}
          actions={
            <button className="btn btn-primary btn-sm" onClick={confirmClear}>
              确定清空
            </button>
          }
        >
          <p style={{ textAlign: 'center', padding: '12px 0', color: 'var(--ink-light)' }}>
            确定要清空当前画板吗？此操作不可撤销。
          </p>
        </Modal>
      )}

      {/* 保存画作 */}
      {showSave && (
        <Modal
          title="保存画作"
          onClose={() => setShowSave(false)}
          actions={
            <button className="btn btn-primary btn-sm" disabled={saving} onClick={submitSave}>
              {saving ? '保存中…' : '保存'}
            </button>
          }
        >
          <div className="field">
            <label className="field-label" htmlFor="draw-save-title">画作题名</label>
            <input
              id="draw-save-title"
              className="input"
              placeholder="如：黛玉葬花"
              maxLength={40}
              autoFocus
              value={saveTitle}
              onChange={(e) => setSaveTitle(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') submitSave();
              }}
            />
          </div>
          <p style={{ fontSize: 13, color: 'var(--ink-light)' }}>画作将保存到「我的画作」，可在画廊中查看。</p>
        </Modal>
      )}

      {/* 画作预览 */}
      {preview && (
        <Modal
          title={preview.title || '画作预览'}
          onClose={() => {
            setPreview(null);
            setConfirmDelete(false);
          }}
          actions={
            <button className="btn btn-primary btn-sm" onClick={() => setConfirmDelete(true)}>
              删除画作
            </button>
          }
        >
          <img
            src={imageUrls[preview.id]}
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

      {/* 删除确认（叠在预览之上） */}
      {preview && confirmDelete && (
        <Modal
          title="删除画作"
          onClose={() => setConfirmDelete(false)}
          actions={
            <button className="btn btn-primary btn-sm" onClick={() => deleteDrawing(preview.id)}>
              确定删除
            </button>
          }
        >
          <p style={{ textAlign: 'center', padding: '12px 0', color: 'var(--ink-light)' }}>删除后不可恢复，确认？</p>
        </Modal>
      )}
    </>
  );
}
