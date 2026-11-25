import { useCallback, useEffect, useRef, useState } from 'react';
import { request } from '../shared/api';
import { toast } from '../shared/toast';
import { activateProps } from '../shared/a11y';
import './kg.css';
import { AiBadge, AiNotice } from '../shared/AiLabel';

// ---------- 常量 ----------
const ALL_TYPES = ['person', 'school', 'play', 'role', 'segment', 'concept'];
const TYPE_LABELS: Record<string, string> = {
  person: '人物',
  school: '流派',
  play: '剧目',
  role: '行当',
  segment: '唱段',
  concept: '概念',
};
const TYPE_COLORS: Record<string, string> = {
  person: '#c1272d',
  school: '#3a7d7b',
  play: '#a67c52',
  role: '#8b4513',
  segment: '#d4a574',
  concept: '#1a1a1a',
};

// ---------- 后端载荷（cytoscape elements 格式） ----------
interface KgNodeData {
  id: string;
  name: string;
  type: string;
  typeLabel?: string;
  color?: string;
  description?: string;
  degree?: number;
}

interface KgEdgeData {
  id?: string;
  source: string;
  target: string;
  label?: string;
  weight?: number;
}

interface KgGraphRaw {
  nodes: { data: KgNodeData }[];
  edges: { data: KgEdgeData }[];
}

interface KgStatsData {
  entityTotal: number;
  relTotal: number;
  entityByType: { type: string; cnt: number }[];
  relationByType: { relation: string; cnt: number }[];
}

interface KgSearchItem {
  id: number;
  name: string;
  type: string;
  description?: string;
}

interface KgEntityRef {
  id: number;
  name: string;
  type: string;
}

interface KgEntityDetail {
  entity: { id: number; name: string; type: string; description?: string | null };
  outRelations: { relation: string; target: KgEntityRef }[];
  inRelations: { relation: string; source: KgEntityRef }[];
}

// ---------- 3d-force-graph（CDN UMD）最小类型声明 ----------
interface GraphNode {
  id: string;
  name: string;
  type: string;
  color?: string;
  degree?: number;
  description?: string;
  fx?: number | null;
  fy?: number | null;
  fz?: number | null;
}

interface GraphLink {
  source: string | GraphNode;
  target: string | GraphNode;
  label?: string;
}

interface CameraPosition {
  x?: number;
  y?: number;
  z?: number;
}

interface GraphControls {
  autoRotate?: boolean;
  autoRotateSpeed?: number;
}

interface ForceGraph3DInstance {
  graphData(d: { nodes: GraphNode[]; links: GraphLink[] }): ForceGraph3DInstance;
  backgroundColor(c: string): ForceGraph3DInstance;
  width(w: number): ForceGraph3DInstance;
  height(h: number): ForceGraph3DInstance;
  nodeRelSize(n: number): ForceGraph3DInstance;
  nodeId(k: string): ForceGraph3DInstance;
  nodeVal(fn: (node: GraphNode) => number): ForceGraph3DInstance;
  nodeLabel(fn: (node: GraphNode) => string): ForceGraph3DInstance;
  nodeColor(fn: (node: GraphNode) => string): ForceGraph3DInstance;
  nodeOpacity(n: number): ForceGraph3DInstance;
  linkSource(k: string): ForceGraph3DInstance;
  linkTarget(k: string): ForceGraph3DInstance;
  linkLabel(fn: (link: GraphLink) => string): ForceGraph3DInstance;
  linkColor(fn: (link: GraphLink) => string): ForceGraph3DInstance;
  linkWidth(n: number): ForceGraph3DInstance;
  linkOpacity(n: number): ForceGraph3DInstance;
  linkDirectionalArrowLength(n: number): ForceGraph3DInstance;
  linkDirectionalArrowRelPos(n: number): ForceGraph3DInstance;
  linkDirectionalParticles(n: number): ForceGraph3DInstance;
  d3AlphaDecay(n: number): ForceGraph3DInstance;
  d3VelocityDecay(n: number): ForceGraph3DInstance;
  cooldownTicks(n: number): ForceGraph3DInstance;
  warmupTicks(n: number): ForceGraph3DInstance;
  onNodeDragEnd(fn: (node: GraphNode) => void): ForceGraph3DInstance;
  onNodeClick(fn: (node: GraphNode) => void): ForceGraph3DInstance;
  onEngineStop(fn: () => void): ForceGraph3DInstance;
  cameraPosition(): CameraPosition;
  cameraPosition(pos: CameraPosition, transitionTarget?: null, msDuration?: number): ForceGraph3DInstance;
  controls(): GraphControls | undefined;
  zoomToFit(msDuration?: number, padding?: number): ForceGraph3DInstance;
  pauseAnimation(): ForceGraph3DInstance;
  resumeAnimation(): ForceGraph3DInstance;
  _destructor?: () => void;
}

type ForceGraph3DFactory = () => (el: HTMLElement) => ForceGraph3DInstance;

const KG_LIB_SCRIPT_ID = 'kg-3d-force-graph-script';
const KG_LIB_SRC = 'https://unpkg.com/3d-force-graph@1.73.0/dist/3d-force-graph.min.js';

// 3d-force-graph 的 UMD 全局名为 ForceGraph3D（个别版本暴露 ThreeDForceGraph）
function getLib(): ForceGraph3DFactory | null {
  const w = window as typeof window & {
    ForceGraph3D?: ForceGraph3DFactory;
    ThreeDForceGraph?: ForceGraph3DFactory;
  };
  return w.ForceGraph3D || w.ThreeDForceGraph || null;
}

// 动态加载 CDN 库（以 script id 防重复注入；失败则移除脚本以便重试，页面显示降级提示）
function loadLib(): Promise<ForceGraph3DFactory | null> {
  const lib = getLib();
  if (lib) return Promise.resolve(lib);
  return new Promise((resolve) => {
    const existing = document.getElementById(KG_LIB_SCRIPT_ID) as HTMLScriptElement | null;
    if (existing) {
      existing.addEventListener('load', () => resolve(getLib()));
      existing.addEventListener('error', () => resolve(null));
      return;
    }
    const s = document.createElement('script');
    s.id = KG_LIB_SCRIPT_ID;
    s.src = KG_LIB_SRC;
    s.async = true;
    s.onload = () => resolve(getLib());
    s.onerror = () => {
      s.remove();
      resolve(null);
    };
    document.head.appendChild(s);
  });
}

// 3D 节点尺寸映射（按关联度）
function nodeSize(node: GraphNode): number {
  const degree = node.degree || 1;
  return Math.max(4, Math.min(20, 4 + degree * 1.2));
}

// 越剧知识图谱 3D：基于 3d-force-graph 的实体关系可视化（自 public/js/kg.js 迁移）
export function KgPage() {
  const [activeTypes, setActiveTypes] = useState<Set<string>>(new Set(ALL_TYPES));
  const [stats, setStats] = useState<KgStatsData | null>(null);
  const [searchQ, setSearchQ] = useState('');
  const [searchResults, setSearchResults] = useState<KgSearchItem[] | null>(null);
  const [detail, setDetail] = useState<KgEntityDetail | null>(null);
  const [physicsPaused, setPhysicsPaused] = useState(false);
  const [canvasNotice, setCanvasNotice] = useState<{ text: string; color: string } | null>(null);

  const canvasRef = useRef<HTMLDivElement>(null);
  const graphRef = useRef<ForceGraph3DInstance | null>(null);
  const aliveRef = useRef(true);

  useEffect(() => {
    document.title = '越韵智传 · 越剧知识图谱 3D';
    document.body.classList.add('page-kg');
    return () => document.body.classList.remove('page-kg');
  }, []);

  // ---------- 节点详情模态窗口 ----------
  const showEntityModal = useCallback(async (entityId: number) => {
    const res = await request<KgEntityDetail>(`/kg/entity/${entityId}`);
    if (res.code !== 0) {
      toast('加载详情失败', 'err');
      return;
    }
    setDetail(res.data);
  }, []);

  // ---------- 初始化 3D 图谱 ----------
  const initGraph = useCallback(
    (factory: ForceGraph3DFactory, graphData: { nodes: GraphNode[]; links: GraphLink[] }) => {
      const container = canvasRef.current;
      if (!container) return;

      if (graphRef.current) {
        graphRef.current._destructor?.();
        graphRef.current = null;
      }
      container.innerHTML = '';

      if (!graphData.nodes.length) {
        setCanvasNotice({ text: '暂无图谱数据', color: 'var(--ink-light)' });
        return;
      }

      const graph = factory()(container)
        .graphData(graphData)
        .backgroundColor('rgba(0,0,0,0)')
        .width(container.clientWidth)
        .height(container.clientHeight)
        // 节点配置
        .nodeRelSize(5)
        .nodeId('id')
        .nodeVal(nodeSize)
        .nodeLabel((node) => {
          const typeLabel = TYPE_LABELS[node.type] || node.type;
          const desc = node.description
            ? `<div style="font-size:11px;color:#aaa;max-width:200px;white-space:normal;margin-top:2px">${node.description.slice(0, 50)}${node.description.length > 50 ? '...' : ''}</div>`
            : '';
          return `<div style="font-family:'STKaiti','KaiTi',serif;padding:4px 8px;background:rgba(26,26,26,0.92);color:#f5f0e8;border-radius:4px;font-size:14px"><b>${node.name}</b><span style="font-size:11px;color:#aaa;margin-left:6px">[${typeLabel}]</span>${desc}</div>`;
        })
        .nodeColor((node) => node.color || '#666')
        .nodeOpacity(0.95)
        // 关系配置
        .linkSource('source')
        .linkTarget('target')
        .linkLabel(
          (link) =>
            `<div style="font-family:'STKaiti','KaiTi',serif;padding:2px 6px;background:rgba(166,124,82,0.9);color:#fff;border-radius:3px;font-size:11px">${link.label || ''}</div>`,
        )
        .linkColor(() => 'rgba(140,120,90,0.55)')
        .linkWidth(0.8)
        .linkOpacity(0.6)
        .linkDirectionalArrowLength(3.5)
        .linkDirectionalArrowRelPos(1)
        .linkDirectionalParticles(0)
        // 物理模拟参数
        .d3AlphaDecay(0.028)
        .d3VelocityDecay(0.4)
        .cooldownTicks(200)
        .warmupTicks(50)
        // 节点拖拽
        .onNodeDragEnd((node) => {
          node.fx = null;
          node.fy = null;
          node.fz = null;
        })
        // 点击节点 → 弹出详情
        .onNodeClick((node) => {
          // 停止自动旋转
          const ctrls = graph.controls();
          if (ctrls) ctrls.autoRotate = false;
          showEntityModal(parseInt(node.id.replace('n', '')));
        });

      graphRef.current = graph;
      setCanvasNotice(null);

      // 初始相机位置
      graph.cameraPosition({ z: 280 });

      // 引擎稳定后保留轻微自动旋转，营造“活态”效果
      graph.onEngineStop(() => {
        const ctrls = graph.controls();
        if (ctrls) {
          ctrls.autoRotate = true;
          ctrls.autoRotateSpeed = 0.4;
        }
      });

      // 启动时自动旋转
      const ctrls = graph.controls();
      if (ctrls) {
        ctrls.autoRotate = true;
        ctrls.autoRotateSpeed = 0.8;
      }
    },
    [showEntityModal],
  );

  // ---------- 加载图谱数据 ----------
  const loadGraph = useCallback(async () => {
    const lib = await loadLib();
    if (!aliveRef.current) return;
    if (!lib) {
      setCanvasNotice({ text: '3D 图谱库未加载，请检查网络', color: 'var(--cinnabar)' });
      return;
    }
    const types = [...activeTypes].join(',');
    const res = await request<KgGraphRaw>(`/kg/graph?types=${encodeURIComponent(types)}&max=150`);
    if (res.code !== 0) {
      toast('加载图谱失败：' + (res.message || ''), 'err');
      return;
    }
    if (!aliveRef.current) return;
    const nodes = (res.data?.nodes || []).map((n) => ({ ...n.data }));
    const links = (res.data?.edges || []).map((e) => ({ ...e.data }));
    initGraph(lib, { nodes, links });
  }, [activeTypes, initGraph]);

  useEffect(() => {
    aliveRef.current = true;
    loadGraph();
    return () => {
      aliveRef.current = false;
      // 销毁图谱实例，释放 WebGL 资源
      graphRef.current?._destructor?.();
      graphRef.current = null;
      const container = canvasRef.current;
      if (container) container.innerHTML = '';
    };
  }, [loadGraph]);

  // ---------- 加载统计 ----------
  useEffect(() => {
    (async () => {
      const res = await request<KgStatsData>('/kg/stats');
      if (res.code === 0) setStats(res.data);
    })();
  }, []);

  // ---------- 加载邻居子图 ----------
  const loadNeighbors = useCallback(
    async (entityId: number) => {
      const lib = await loadLib();
      if (!lib || !aliveRef.current) return;
      const res = await request<KgGraphRaw>(`/kg/entity/${entityId}/neighbors`);
      if (res.code !== 0) return;
      if (!aliveRef.current) return;
      const nodes = (res.data?.nodes || []).map((n) => ({ ...n.data }));
      const links = (res.data?.edges || []).map((e) => ({ ...e.data }));
      if (nodes.length === 0) {
        toast('无邻居数据', 'err');
        return;
      }
      initGraph(lib, { nodes, links });
    },
    [initGraph],
  );

  // ---------- 搜索 ----------
  const doSearch = useCallback(async () => {
    const q = searchQ.trim();
    if (!q) return;
    const res = await request<KgSearchItem[]>(`/kg/search?q=${encodeURIComponent(q)}`);
    if (res.code !== 0) return;
    setSearchResults(res.data || []);
  }, [searchQ]);

  // ---------- 工具栏 ----------
  const togglePause = () => {
    const g = graphRef.current;
    if (!g) return;
    if (physicsPaused) {
      g.resumeAnimation();
    } else {
      g.pauseAnimation();
    }
    setPhysicsPaused(!physicsPaused);
  };

  const zoomIn = () => {
    const g = graphRef.current;
    if (!g) return;
    const cam = g.cameraPosition();
    g.cameraPosition({ z: (cam.z ?? 300) * 0.8 }, null, 300);
  };

  const zoomOut = () => {
    const g = graphRef.current;
    if (!g) return;
    const cam = g.cameraPosition();
    g.cameraPosition({ z: (cam.z ?? 300) * 1.25 }, null, 300);
  };

  // ---------- 类型筛选 ----------
  const toggleType = (type: string) => {
    const next = new Set(activeTypes);
    if (next.has(type)) {
      next.delete(type);
    } else {
      next.add(type);
    }
    setActiveTypes(next);
  };

  // ---------- 模态窗口关闭（Esc） ----------
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setDetail(null);
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, []);

  // ---------- 窗口大小变化 ----------
  useEffect(() => {
    const onResize = () => {
      const g = graphRef.current;
      const container = canvasRef.current;
      if (!g || !container) return;
      g.width(container.clientWidth).height(container.clientHeight);
    };
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, []);

  const outRels = detail?.outRelations || [];
  const inRels = detail?.inRelations || [];

  return (
    <>
      <main className="main">
        <div className="container" style={{ paddingTop: 8 }}>
          <section className="page-hero">
            <div className="ink-wash ink-wash-1" style={{ background: 'var(--cyan)' }} />
            <div className="ink-wash ink-wash-2" style={{ background: 'var(--ochre)' }} />
            <div className="hero-seal">
              <span className="seal seal-vertical">图谱</span>
            </div>
            <h1>越剧知识图谱 <AiBadge style={{ fontSize: 12, padding: '2px 10px' }} /></h1>
          </section>
          <AiNotice text="本知识图谱由人工智能从越剧文献中自动抽取构建，实体与关系可能存在遗漏或误判，请以权威文献为准。" />

          <div className="kg-main">
            {/* 3D 图谱画布 */}
            <div className="kg-canvas-wrap">
              <div className="kg-toolbar">
                <button className="kg-tool-btn" onClick={() => graphRef.current?.zoomToFit(60, 200)}>
                  适配视图
                </button>
                <button className="kg-tool-btn" onClick={() => loadGraph()}>
                  重置布局
                </button>
                <button className="kg-tool-btn" onClick={togglePause}>
                  {physicsPaused ? '继续物理' : '暂停物理'}
                </button>
                <button className="kg-tool-btn" onClick={zoomIn}>
                  放大
                </button>
                <button className="kg-tool-btn" onClick={zoomOut}>
                  缩小
                </button>
              </div>
              <div id="kgCanvas" ref={canvasRef} />
              {canvasNotice && (
                <div
                  style={{
                    position: 'absolute',
                    inset: 0,
                    display: 'grid',
                    placeItems: 'center',
                    color: canvasNotice.color,
                    fontFamily: 'var(--font-kai)',
                  }}
                >
                  {canvasNotice.text}
                </div>
              )}
              <div className="kg-hint">
                🖱 拖拽旋转视角 · 滚轮缩放
                <br />
                🖱 点击节点查看详情 · 双击聚焦邻居
              </div>
              <div className="kg-legend">
                <div className="kg-legend-title">实体类型</div>
                {ALL_TYPES.map((t) => (
                  <div className="kg-legend-item" key={t}>
                    <span className="kg-legend-dot" style={{ background: TYPE_COLORS[t] }} />
                    {TYPE_LABELS[t]}
                  </div>
                ))}
              </div>
              <div className="kg-node-tooltip" />
            </div>

            {/* 侧边栏 */}
            <div className="kg-sidebar">
              <div className="kg-stats-card">
                <div className="kg-stats-title">图谱概览</div>
                <div>
                  {stats && (
                    <>
                      <div className="kg-stat-row">
                        <span className="label">实体总数</span>
                        <span className="value">{stats.entityTotal}</span>
                      </div>
                      <div className="kg-stat-row">
                        <span className="label">关系总数</span>
                        <span className="value">{stats.relTotal}</span>
                      </div>
                      <div style={{ borderTop: '1px dashed var(--ink-10)', margin: '6px 0' }} />
                      {stats.entityByType.map((t) => (
                        <div className="kg-stat-row" key={t.type}>
                          <span className="label">{TYPE_LABELS[t.type] || t.type}</span>
                          <span className="value">{t.cnt}</span>
                        </div>
                      ))}
                      <div style={{ borderTop: '1px dashed var(--ink-10)', margin: '6px 0' }} />
                      {stats.relationByType.slice(0, 6).map((r) => (
                        <div className="kg-stat-row" key={r.relation}>
                          <span className="label">{r.relation}</span>
                          <span className="value">{r.cnt}</span>
                        </div>
                      ))}
                    </>
                  )}
                </div>
              </div>

              <div className="kg-stats-card">
                <div className="kg-stats-title">实体搜索</div>
                <div className="kg-search-box">
                  <input
                    type="text"
                    placeholder="输入人名/流派/剧目…"
                    value={searchQ}
                    onChange={(e) => setSearchQ(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') doSearch();
                    }}
                  />
                  <button className="kg-search-btn" onClick={doSearch}>
                    搜索
                  </button>
                </div>
                <div className="kg-search-results">
                  {searchResults !== null && searchResults.length === 0 && (
                    <div style={{ fontSize: 12, color: 'var(--ink-light)', padding: '6px 0' }}>未找到匹配实体</div>
                  )}
                  {searchResults?.map((r) => (
                    <div key={r.id} className="kg-search-item" onClick={() => showEntityModal(r.id)}>
                      <span className="kg-search-dot" style={{ background: TYPE_COLORS[r.type] || '#666' }} />
                      <span className="rel-name">{r.name}</span>
                      <span className="rel-type">({TYPE_LABELS[r.type] || r.type})</span>
                    </div>
                  ))}
                </div>
              </div>

              <div className="kg-stats-card">
                <div className="kg-stats-title">类型筛选</div>
                <div className="kg-filter-chips">
                  {ALL_TYPES.map((t) => (
                    <span
                      key={t}
                      className={`kg-chip ${activeTypes.has(t) ? 'active' : ''}`}
                      data-type={t}
                      onClick={() => toggleType(t)}
                    >
                      {TYPE_LABELS[t]}
                    </span>
                  ))}
                </div>
              </div>
            </div>
          </div>
        </div>
      </main>

      {/* 节点详情模态窗口 */}
      {detail && (
        <div
          className="kg-modal-mask show"
          onClick={(e) => {
            if (e.target === e.currentTarget) setDetail(null);
          }}
        >
          <div className="kg-modal">
            <button className="kg-modal-close" onClick={() => setDetail(null)}>
              ×
            </button>
            <div>
              <div className="kg-modal-header">
                <div className="kg-modal-name">{detail.entity.name}</div>
                <span
                  className="kg-modal-type-badge"
                  style={{ background: TYPE_COLORS[detail.entity.type] || '#666' }}
                >
                  <span className="dot" />
                  {TYPE_LABELS[detail.entity.type] || detail.entity.type}
                </span>
              </div>
              <div className="kg-modal-body">
                {detail.entity.description && <div className="kg-modal-desc">{detail.entity.description}</div>}
                {outRels.length > 0 && (
                  <div className="kg-modal-section">
                    <div className="kg-modal-section-title">出向关系（{outRels.length}）</div>
                    <div className="kg-modal-rel-list">
                      {outRels.map((r, i) => (
                        <div
                          key={i}
                          className="kg-modal-rel"
                          onClick={() => showEntityModal(r.target.id)}
                          {...activateProps(() => showEntityModal(r.target.id), r.target.name)}
                        >
                          <span className="rel-label">{r.relation}</span>
                          <span className="rel-arrow">→</span>
                          <span className="rel-name">{r.target.name}</span>
                          <span className="rel-type">({TYPE_LABELS[r.target.type] || r.target.type})</span>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
                {inRels.length > 0 && (
                  <div className="kg-modal-section">
                    <div className="kg-modal-section-title">入向关系（{inRels.length}）</div>
                    <div className="kg-modal-rel-list">
                      {inRels.map((r, i) => (
                        <div
                          key={i}
                          className="kg-modal-rel"
                          onClick={() => showEntityModal(r.source.id)}
                          {...activateProps(() => showEntityModal(r.source.id), r.source.name)}
                        >
                          <span className="rel-name">{r.source.name}</span>
                          <span className="rel-type">({TYPE_LABELS[r.source.type] || r.source.type})</span>
                          <span className="rel-arrow">→</span>
                          <span className="rel-label">{r.relation}</span>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
                {outRels.length === 0 && inRels.length === 0 && (
                  <div className="kg-modal-empty">该实体暂无关联关系</div>
                )}
                <div className="kg-modal-actions">
                  <button
                    className="kg-modal-btn"
                    onClick={() => {
                      loadNeighbors(detail.entity.id);
                      setDetail(null);
                    }}
                  >
                    查看邻居子图
                  </button>
                  <button className="kg-modal-btn primary" onClick={() => setDetail(null)}>
                    关闭
                  </button>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
