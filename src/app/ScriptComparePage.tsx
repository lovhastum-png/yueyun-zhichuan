import { useEffect, useRef, useState } from 'react';
import { Fragment } from 'react';
import { postForm } from '../shared/api';
import { getToken, isLoggedIn } from '../shared/auth';
import { toast } from '../shared/toast';
import { InkGrinding } from '../shared/InkGrinding';
import { activateProps } from '../shared/a11y';
import type { ApiResponse } from '../shared/types';
import { AiBadge, AiNotice } from '../shared/AiLabel';

// ============================================================
// 剧本版本比对（教学辅助工具）
// ------------------------------------------------------------
// 【硬性专业约束 —— 页面强制展示】
// 1. 本工具为教学辅助工具，差异判定请以专业教师为准；
// 2. 所有比对结果均为「参考差异」，不构成版本优劣判定；
// 3. 按越剧剧本体例对齐：先对场次，再对场内唱段念白；
//    唱词以整句为单位比对，不拆成单字。
// ============================================================

// ---------- 后端报告契约（见 server/python/script-compare/comparator.py） ----------
type RowStatus = 'unchanged' | 'modified' | 'removed' | 'added';
type DiffPart = [string, 'same' | 'diff'];

interface SentenceRow {
  status: RowStatus;
  old: string | null;
  new: string | null;
  old_role: string;
  new_role: string;
  similarity: number | null;
  old_parts?: DiffPart[] | null;
  new_parts?: DiffPart[] | null;
  note?: string;
  tags?: string[];
  keywords?: string[];
}

interface SegmentRow {
  type: '唱段' | '念白';
  role: string;
  status: 'matched' | 'old_only' | 'new_only';
  similarity: number | null;
  tags: string[];
  sentences: SentenceRow[];
}

interface SceneRow {
  status: 'matched' | 'old_only' | 'new_only';
  old_title: string | null;
  new_title: string | null;
  similarity: number | null;
  tags: string[];
  note: string;
  segments: SegmentRow[];
}

interface VersionInfo {
  title: string;
  version: string;
  year: string;
  label: string;
  scene_count: number;
  sentence_count: number;
  roles: string[];
}

interface CompareReport {
  disclaimer: string;
  scope: string;
  old: VersionInfo;
  new: VersionInfo;
  overall_similarity: number;
  summary: Record<string, number>;
  role_changes: {
    added_roles: string[];
    removed_roles: string[];
    role_stats: Record<string, Record<string, number>>;
  };
  scenes: SceneRow[];
  markdown: string;
  meta: { elapsed_ms: number; version: string };
}

const MAX_SIZE = 2 * 1024 * 1024; // 与后端网关一致
const FILENAME_RE = /.+_.+_.+\.txt$/i; // 剧目名_版本_年代.txt（软校验，仅提示）

async function getJson<T>(path: string, timeoutMs = 90000): Promise<ApiResponse<T>> {
  const token = getToken();
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const resp = await fetch(`/api${path}`, {
      headers: token ? { Authorization: `Bearer ${token}` } : undefined,
      signal: controller.signal,
    });
    return (await resp.json().catch(() => ({ code: resp.status || -1, message: '服务器响应异常' }))) as ApiResponse<T>;
  } catch (err) {
    if (err instanceof Error && err.name === 'AbortError') {
      return { code: -1, message: '比对超时，请使用更短的剧本或分段比对', data: null as T };
    }
    return { code: -1, message: '网络异常，请重试', data: null as T };
  } finally {
    clearTimeout(timer);
  }
}

const STATUS_META: Record<RowStatus, { label: string; cls: string }> = {
  unchanged: { label: '未变', cls: 'unchanged' },
  modified: { label: '修改', cls: 'modified' },
  removed: { label: '删句', cls: 'removed' },
  added: { label: '增句', cls: 'added' },
};

// ---------- 句级差异单元格（左右分栏一行） ----------
function SentenceCells({
  row, segRole, onSelect,
}: {
  row: SentenceRow;
  segRole: string;
  onSelect: () => void;
}) {
  const clickable = row.status !== 'unchanged';
  const roleL = row.old_role && row.old_role !== segRole ? row.old_role : '';
  const roleR = row.new_role && row.new_role !== segRole ? row.new_role : '';

  const cell = (side: 'old' | 'new') => {
    const text = side === 'old' ? row.old : row.new;
    const role = side === 'old' ? roleL : roleR;
    if (text === null || text === undefined) {
      return <span className="sc-cell-empty">—</span>;
    }
    const parts = side === 'old' ? row.old_parts : row.new_parts;
    return (
      <span className="sc-cell-text">
        {role && <em className="sc-role">{role}</em>}
        {parts && parts.length
          ? parts.map(([t, kind], i) => (
              <mark key={i} className={kind === 'diff' ? (side === 'old' ? 'sc-hl sc-hl-del' : 'sc-hl sc-hl-add') : 'sc-hl-same'}>
                {t}
              </mark>
            ))
          : text}
      </span>
    );
  };

  return (
    <div
      className={`sc-row sc-row-${row.status}${clickable ? ' sc-row-click' : ''}`}
      onClick={clickable ? onSelect : undefined}
      role={clickable ? 'button' : undefined}
      tabIndex={clickable ? 0 : undefined}
      onKeyDown={clickable ? (e) => e.key === 'Enter' && onSelect() : undefined}
      title={clickable ? '点击查看差异详情与溯源关键词' : undefined}
    >
      <div className={`sc-cell sc-cell-old${row.status === 'removed' ? ' sc-cell-mark' : ''}`}>{cell('old')}</div>
      <div className={`sc-cell sc-cell-new${row.status === 'added' ? ' sc-cell-mark' : ''}`}>{cell('new')}</div>
    </div>
  );
}

// ---------- 差异详情弹层 ----------
function DetailDialog({
  row, scene, onClose,
}: {
  row: SentenceRow;
  scene: { oldTitle: string | null; newTitle: string | null };
  onClose: () => void;
}) {
  const meta = STATUS_META[row.status];
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose]);

  return (
    <div className="sc-dialog-backdrop" onClick={onClose}>
      <div className="sc-dialog" onClick={(e) => e.stopPropagation()} role="dialog" aria-modal="true">
        <div className="sc-dialog-head">
          <span className={`sc-chip sc-chip-${meta.cls}`}>{meta.label} · 参考差异</span>
          {row.similarity !== null && row.similarity !== undefined && (
            <span className="sc-sim">参考相似度 {row.similarity}%</span>
          )}
          <button type="button" className="sc-dialog-close" onClick={onClose} aria-label="关闭">×</button>
        </div>

        <div className="sc-dialog-body">
          <div className="sc-dialog-field">
            <div className="sc-dialog-label">场次</div>
            <div>{scene.oldTitle || scene.newTitle}{scene.oldTitle && scene.newTitle && scene.oldTitle !== scene.newTitle ? `（新版本：${scene.newTitle}）` : ''}</div>
          </div>
          {row.old && (
            <div className="sc-dialog-field">
              <div className="sc-dialog-label">旧版本原句</div>
              <div className="sc-dialog-old">{row.old_role && <em className="sc-role">{row.old_role}</em>}{row.old}</div>
            </div>
          )}
          {row.new && (
            <div className="sc-dialog-field">
              <div className="sc-dialog-label">新版本原句</div>
              <div className="sc-dialog-new">{row.new_role && <em className="sc-role">{row.new_role}</em>}{row.new}</div>
            </div>
          )}
          {row.note && (
            <div className="sc-dialog-field">
              <div className="sc-dialog-label">备注</div>
              <div>{row.note}</div>
            </div>
          )}
          {row.tags && row.tags.length > 0 && (
            <div className="sc-dialog-field">
              <div className="sc-dialog-label">关联标签</div>
              <div className="sc-tag-list">
                {row.tags.map((t) => <span key={t} className="sc-chip sc-chip-tag">{t}</span>)}
              </div>
            </div>
          )}
          {row.keywords && row.keywords.length > 0 && (
            <div className="sc-dialog-field">
              <div className="sc-dialog-label">史料溯源检索关键词</div>
              <div className="sc-tag-list">
                {row.keywords.map((k) => <span key={k} className="sc-kw">{k}</span>)}
              </div>
              <div className="sc-kw-hint">RAG 史料库检索为预留接口，对接后可直接用以上关键词溯源相关文献</div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// ---------- 页面 ----------
export function ScriptComparePage() {
  const [oldFile, setOldFile] = useState<File | null>(null);
  const [newFile, setNewFile] = useState<File | null>(null);
  const [comparing, setComparing] = useState(false);
  const [report, setReport] = useState<CompareReport | null>(null);
  const [isDemo, setIsDemo] = useState(false);
  const [selected, setSelected] = useState<{ row: SentenceRow; scene: SceneRow } | null>(null);

  const oldInputRef = useRef<HTMLInputElement>(null);
  const newInputRef = useRef<HTMLInputElement>(null);
  const reportRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    document.title = '越韵智传 · 剧本比对';
    document.body.classList.add('page-script-compare');
    return () => document.body.classList.remove('page-script-compare');
  }, []);

  function handleFile(kind: 'old' | 'new', file: File) {
    if (!file.name.toLowerCase().endsWith('.txt')) {
      toast('仅支持 TXT 格式剧本文本', 'err');
      return;
    }
    if (file.size > MAX_SIZE) {
      toast('剧本文件不能超过 2MB', 'err');
      return;
    }
    if (!FILENAME_RE.test(file.name)) {
      toast('文件名建议按「剧目名_版本_年代.txt」命名（不影响比对）', 'info');
    }
    setReport(null);
    setIsDemo(false);
    if (kind === 'old') setOldFile(file);
    else setNewFile(file);
  }

  const compare = async () => {
    if (!oldFile || !newFile) {
      toast('请先上传「旧版本」与「新版本」两个 TXT 剧本文件', 'err');
      return;
    }
    if (!isLoggedIn()) {
      toast('请先登录后进行比对', 'err');
      return;
    }
    setComparing(true);
    setReport(null);

    const form = new FormData();
    form.append('oldScript', oldFile);
    form.append('newScript', newFile);

    const res = await postForm<CompareReport>('/script-compare/compare', form, {
      timeout: 90000,
      timeoutMessage: '比对超时，请使用更短的剧本或分段比对',
    });
    setComparing(false);
    if (res.code !== 0 || !res.data) {
      toast(res.message || '比对失败', 'err', 5000);
      return;
    }
    setReport(res.data);
    setIsDemo(false);
    toast('比对完成（结果为参考差异）', 'ok');
    setTimeout(() => reportRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 80);
  };

  const loadDemo = async () => {
    if (!isLoggedIn()) {
      toast('请先登录后进行比对', 'err');
      return;
    }
    setComparing(true);
    setReport(null);
    const res = await getJson<CompareReport>('/script-compare/demo');
    setComparing(false);
    if (res.code !== 0 || !res.data) {
      toast(res.message || '演示样本加载失败', 'err', 5000);
      return;
    }
    setReport(res.data);
    setIsDemo(true);
    toast('已载入演示样本（梁祝 两个版本）', 'ok');
    setTimeout(() => reportRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 80);
  };

  const exportMarkdown = () => {
    if (!report) return;
    const blob = new Blob([report.markdown], { type: 'text/markdown;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${report.old.title || '剧本'}_版本比对报告.md`;
    a.click();
    URL.revokeObjectURL(url);
    toast('Markdown 报告已导出', 'ok');
  };

  return (
    <main className="main">
      <div className="container" style={{ paddingTop: 8 }}>
        <section className="page-hero">
          <div className="ink-wash ink-wash-1" style={{ background: 'var(--cyan)', left: '12%' }} />
          <div className="ink-wash ink-wash-2" style={{ background: 'var(--ochre)', right: '12%', opacity: 0.15 }} />
          <div className="hero-seal">
            <span className="seal seal-vertical">比對</span>
          </div>
          <h1>剧本比对 <AiBadge style={{ fontSize: 12, padding: '2px 10px' }} /></h1>
        </section>
        <AiNotice text="本页版本差异标注与修改建议由人工智能生成，属辅助审阅意见，最终判定请以专业教师或编剧为准。" />

        {/* 合规提示（硬性要求：页面显眼位置强制展示） */}
        <div className="se-disclaimer" role="note">
          <span className="se-disclaimer-icon">鉴</span>
          <div>
            <strong>本工具为教学辅助工具，差异判定请以专业教师为准。</strong>
            所有比对结果均为<b>「参考差异」</b>，不构成对版本优劣的判定：按越剧剧本体例
            <b>先对场次、再对场内唱段念白</b>，唱词以<b>整句</b>为单位比对；
            相似度为算法折算的参考值，措辞不使用「错误 / 正确」等绝对化表述。
          </div>
        </div>

        {/* 上传区 */}
        <div className="scroll-frame">
          <div className="section-title">
            <span className="st-text">上传剧本</span>
            <span className="st-line" />
            <span className="tag tag-cinnabar">TXT · 命名：剧目名_版本_年代</span>
          </div>
          <div className="se-upload-grid">
            {([
              { kind: 'old' as const, icon: '舊', title: '旧版本剧本', hint: '年代较早的版本（如民国手抄本），TXT 格式，支持繁体', file: oldFile, inputRef: oldInputRef },
              { kind: 'new' as const, icon: '新', title: '新版本剧本', hint: '年代较晚的版本（如 80 年代舞台版），TXT 格式', file: newFile, inputRef: newInputRef },
            ]).map((cfg) => (
              <div key={cfg.kind} className="se-upload-card">
                <div
                  className="upload-zone se-upload-zone"
                  onClick={() => cfg.inputRef.current?.click()}
                  {...activateProps(() => cfg.inputRef.current?.click(), `上传${cfg.title}`)}
                  onDragOver={(e) => e.preventDefault()}
                  onDrop={(e) => {
                    e.preventDefault();
                    if (e.dataTransfer.files.length) handleFile(cfg.kind, e.dataTransfer.files[0]);
                  }}
                >
                  <div className="up-icon">{cfg.icon}</div>
                  <div className="up-title">{cfg.file ? cfg.file.name : `上传「${cfg.title}」`}</div>
                  <div className="up-hint">{cfg.hint}</div>
                  <input
                    type="file"
                    ref={cfg.inputRef}
                    accept=".txt"
                    hidden
                    onChange={(e) => {
                      if (e.target.files?.length) handleFile(cfg.kind, e.target.files[0]);
                    }}
                  />
                </div>
              </div>
            ))}
          </div>

          <div className="se-analyze-row">
            <button
              className="btn btn-primary btn-lg"
              disabled={comparing || !oldFile || !newFile}
              onClick={compare}
            >
              {comparing ? (
                <>
                  <span className="spinner" style={{ width: 16, height: 16, borderWidth: 2 }} /> 比对中…
                </>
              ) : (
                '开始比对'
              )}
            </button>
            <button className="btn btn-ghost" disabled={comparing} onClick={loadDemo}>
              载入演示样本（梁祝）
            </button>
            <span className="se-analyze-hint">
              比对流程：清洗与繁简统一 → 场次对齐 → 唱段念白对齐 → 整句差异标注
            </span>
          </div>
        </div>

        {/* 等待动画 */}
        {comparing && (
          <div className="scroll-frame se-analyzing">
            <InkGrinding text="正在研墨校雠：清洗文本、对齐场次、比对唱句……" />
          </div>
        )}

        {/* 比对报告 */}
        {report && (
          <div className="se-report" ref={reportRef}>
            <div className="scroll-frame">
              <div className="section-title">
                <span className="st-text">比对报告</span>
                <span className="st-line" />
                <span className="tag tag-cinnabar">参考差异 · 教学演示</span>
                {isDemo && <span className="tag tag-cyan">演示样本</span>}
              </div>

              {/* 总览：相似度 + 版本信息 */}
              <div className="sc-overview">
                <div className="sc-overall">
                  <div className="sc-overall-num">{report.overall_similarity}<small>%</small></div>
                  <div className="sc-overall-label">总体参考相似度</div>
                </div>
                <div className="sc-version-cards">
                  <div className="sc-version-card">
                    <div className="sc-version-tag">旧版本</div>
                    <div className="sc-version-name">{report.old.label}</div>
                    <div className="sc-version-meta">
                      {report.old.scene_count} 场 · {report.old.sentence_count} 句 · 角色：{report.old.roles.join('、') || '—'}
                    </div>
                  </div>
                  <div className="sc-version-card">
                    <div className="sc-version-tag sc-version-tag-new">新版本</div>
                    <div className="sc-version-name">{report.new.label}</div>
                    <div className="sc-version-meta">
                      {report.new.scene_count} 场 · {report.new.sentence_count} 句 · 角色：{report.new.roles.join('、') || '—'}
                    </div>
                  </div>
                </div>
              </div>

              {/* 标签统计 + 人物增减 */}
              <div className="sc-stats-row">
                <div className="sc-tags-box">
                  {Object.entries(report.summary).map(([t, n]) => (
                    <span key={t} className="sc-chip sc-chip-tag">{t} {n} 处</span>
                  ))}
                  {Object.keys(report.summary).length === 0 && <span className="sc-stats-empty">未发现明显差异</span>}
                </div>
                <div className="sc-role-box">
                  {report.role_changes.added_roles.length > 0 && (
                    <span className="sc-chip sc-chip-add">新增角色：{report.role_changes.added_roles.join('、')}</span>
                  )}
                  {report.role_changes.removed_roles.length > 0 && (
                    <span className="sc-chip sc-chip-del">未再出现：{report.role_changes.removed_roles.join('、')}</span>
                  )}
                  {report.role_changes.added_roles.length === 0 && report.role_changes.removed_roles.length === 0 && (
                    <span className="sc-stats-empty">两版本登场角色一致</span>
                  )}
                </div>
              </div>

              {/* 图例 */}
              <div className="sc-legend">
                <span><i className="sc-dot sc-dot-add" /> 新增</span>
                <span><i className="sc-dot sc-dot-del" /> 删除</span>
                <span><i className="sc-dot sc-dot-mod" /> 修改</span>
                <span className="sc-legend-hint">点击差异句可查看备注与溯源关键词</span>
              </div>

              {/* 场次明细 */}
              {report.scenes.map((scene, si) => (
                <section key={si} className={`sc-scene sc-scene-${scene.status}`}>
                  <header className="sc-scene-head">
                    <span className="sc-scene-no">{si + 1}</span>
                    <div className="sc-scene-titles">
                      {scene.status === 'matched' ? (
                        scene.old_title !== scene.new_title ? (
                          <>{scene.old_title}<span className="sc-arrow">→</span>{scene.new_title}</>
                        ) : (
                          scene.old_title
                        )
                      ) : (
                        (scene.old_title || scene.new_title)
                      )}
                    </div>
                    <div className="sc-scene-meta">
                      {scene.status === 'old_only' && <span className="sc-chip sc-chip-del">仅见于旧版本</span>}
                      {scene.status === 'new_only' && <span className="sc-chip sc-chip-add">新版本新增场</span>}
                      {scene.status === 'matched' && scene.similarity !== null && (
                        <span className="sc-sim">参考相似度 {scene.similarity}%</span>
                      )}
                      {scene.tags.map((t) => <span key={t} className="sc-chip sc-chip-tag">{t}</span>)}
                    </div>
                  </header>
                  {scene.note && <div className="sc-scene-note">{scene.note}</div>}

                  <div className="sc-grid">
                    <div className="sc-grid-head">
                      <div>旧版本 · {report.old.label}</div>
                      <div>新版本 · {report.new.label}</div>
                    </div>
                    {scene.segments.map((seg, gi) => (
                      <Fragment key={gi}>
                        <div className="sc-seg-head">
                          <span className={`sc-seg-type${seg.type === '唱段' ? ' sc-seg-type-aria' : ''}`}>{seg.type}</span>
                          {seg.role && <span className="sc-seg-role">{seg.role}</span>}
                          {seg.status === 'old_only' && <span className="sc-chip sc-chip-del">旧版本独有</span>}
                          {seg.status === 'new_only' && <span className="sc-chip sc-chip-add">新版本新增</span>}
                          {seg.status === 'matched' && seg.similarity !== null && (
                            <span className="sc-sim">{seg.similarity}%</span>
                          )}
                          {seg.tags.map((t) => <span key={t} className="sc-chip sc-chip-tag">{t}</span>)}
                        </div>
                        {seg.sentences.map((row, ri) => (
                          <SentenceCells
                            key={ri}
                            row={row}
                            segRole={seg.role}
                            onSelect={() => setSelected({ row, scene })}
                          />
                        ))}
                      </Fragment>
                    ))}
                  </div>
                </section>
              ))}

              {/* 范围声明（随报告再次展示，硬性要求） */}
              <div className="se-scope">{report.scope} · {report.disclaimer}</div>

              {/* 导出 */}
              <div className="se-export-row">
                <span className="se-export-label">报告导出：</span>
                <button className="btn btn-ghost btn-sm" onClick={exportMarkdown}>
                  下载 Markdown 比对报告
                </button>
                <span className="se-export-label" style={{ marginLeft: 8 }}>
                  （含版本信息 / 标签统计 / 逐句差异明细）
                </span>
              </div>

              <div className="se-meta">
                旧版 {report.old.sentence_count} 句 · 新版 {report.new.sentence_count} 句 ·
                比对耗时 {(report.meta.elapsed_ms / 1000).toFixed(2)}s · v{report.meta.version}
              </div>
            </div>
          </div>
        )}
      </div>

      {/* 差异详情弹层 */}
      {selected && (
        <DetailDialog
          row={selected.row}
          scene={{ oldTitle: selected.scene.old_title, newTitle: selected.scene.new_title }}
          onClose={() => setSelected(null)}
        />
      )}
    </main>
  );
}
