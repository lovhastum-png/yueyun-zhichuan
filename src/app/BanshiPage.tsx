import { useEffect, useMemo, useState } from 'react';
import { toast } from '../shared/toast';
import {
  analyze,
  BANSHI_RULES,
  BUILTIN_EXCERPTS,
  fetchClassicExcerpts,
  SHISAN_ZHE,
  type AnalysisResult,
  type BanshiId,
  type ClassicExcerpt,
} from '../shared/banshi';

// 越剧唱词板式格律辅助解析 · 前端页面
// ============================================================
// 定位：教学辅助参考工具（合规声明置于页面顶部显著位置，不可弱化）。
// 差异配色沿用全站水墨语言：符合=青绿、变体=赭、疑似=朱砂、韵脚=黛青。

type PanelKey = 'criteria' | 'zhe' | 'excerpt';

export function BanshiPage() {
  const [banshiId, setBanshiId] = useState<BanshiId>('manban');
  const [text, setText] = useState('');
  const [result, setResult] = useState<AnalysisResult | null>(null);
  const [openPanel, setOpenPanel] = useState<PanelKey | null>(null);
  const [excerpt, setExcerpt] = useState<ClassicExcerpt | null>(null);

  // 打开即可演示：载入慢板示例并自动解析
  useEffect(() => {
    const first = BUILTIN_EXCERPTS[0];
    setText(first.text);
    setExcerpt(first);
    setResult(analyze(first.text, first.banshi));
  }, []);

  // 补挂页面标识，供 atmosphere.css 定位卷首视差层（SPA 中手动补挂）
  useEffect(() => {
    document.title = '越韵智传 · 板式格律';
    const prevClass = document.body.className;
    document.body.className = 'page-banshi';
    return () => {
      document.body.className = prevClass;
    };
  }, []);

  const run = () => {
    if (!text.trim()) {
      toast('请先输入或载入一段唱词', 'info');
      return;
    }
    setResult(analyze(text, banshiId));
    toast('解析完成（结果为参考差异性质，请以专业教师判定为准）', 'ok');
  };

  const loadExample = () => {
    const ex = BUILTIN_EXCERPTS.find((e) => e.banshi === banshiId) ?? BUILTIN_EXCERPTS[0];
    setBanshiId(ex.banshi);
    setText(ex.text);
    setExcerpt(ex);
    setResult(analyze(ex.text, ex.banshi));
    toast(`已载入「${ex.title}」教学示例`, 'ok');
  };

  const clearAll = () => {
    setText('');
    setResult(null);
    setExcerpt(null);
  };

  // 史料库 RAG 预留接口：点击即调用（当前返回内置示例 + 提示）
  const searchRag = async () => {
    const r = await fetchClassicExcerpts({ banshi: banshiId });
    if (r.excerpts.length > 0) {
      setExcerpt(r.excerpts[0]);
      toast(r.message, 'info');
    } else {
      toast('当前板式暂无范例，可先载入其他板式示例参考', 'info');
    }
  };

  const currentExcerpt = useMemo(() => excerpt, [excerpt]);

  return (
    <main className="main">
      {/* 合规声明（硬性要求：显著位置，不可弱化） */}
      <div className="bs-disclaimer">
        <span className="bs-disclaimer-icon" aria-hidden>
          案
        </span>
        <div>
          <strong>本工具为教学辅助参考工具，不替代专业教师判定。</strong>
          <div className="bs-disclaimer-sub">
            板式规范为基础规范，实际演唱存在大量艺术特例；所有比对结果均为「参考」性质，不作绝对判定。
          </div>
        </div>
      </div>

      {/* 输入区 */}
      <div className="bs-input-card">
        <div className="bs-banshi-row">
          {BANSHI_RULES.map((b) => (
            <button
              key={b.id}
              type="button"
              className={`bs-banshi-chip ${b.id === banshiId ? 'active' : ''}`}
              onClick={() => setBanshiId(b.id)}
              title={b.spec}
            >
              <span className="bs-banshi-name">{b.name}</span>
              <span className="bs-banshi-meter">{b.meter}</span>
            </button>
          ))}
        </div>
        <div className="bs-banshi-spec">
          当前板式规范：<strong>{result ? result.banshi.spec : BANSHI_RULES.find((b) => b.id === banshiId)!.spec}</strong>
        </div>
        <textarea
          className="bs-textarea"
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder="粘贴或输入唱词文本（按标点/换行自动分句，上下句按先后顺序配对）……"
          rows={7}
        />
        <div className="bs-actions">
          <button type="button" className="btn btn-primary" onClick={run}>
            解析唱词
          </button>
          <button type="button" className="btn btn-ghost" onClick={loadExample}>
            载入本板式示例
          </button>
          <button type="button" className="btn btn-ghost" onClick={clearAll}>
            清空
          </button>
          <span className="bs-hint">分句依据：标点与换行；唱词可混合七字句 / 十字句等句式</span>
        </div>
      </div>

      {/* 判定标准 / 韵部表 / 范例 —— 折叠面板 */}
      <div className="bs-panels">
        <button type="button" className="bs-panel-toggle" onClick={() => setOpenPanel(openPanel === 'criteria' ? null : 'criteria')}>
          判定标准（透明展示，供核对）
        </button>
        <button type="button" className="bs-panel-toggle" onClick={() => setOpenPanel(openPanel === 'zhe' ? null : 'zhe')}>
          韵部参考表（中州韵 · 十三辙）
        </button>
        <button type="button" className="bs-panel-toggle" onClick={() => setOpenPanel(openPanel === 'excerpt' ? null : 'excerpt')}>
          同板式参考范例
        </button>
      </div>
      {openPanel === 'criteria' && (
        <div className="bs-panel">
          <table className="bs-criteria-table">
            <thead>
              <tr>
                <th>板式</th>
                <th>规范原文</th>
                <th>符合规范</th>
                <th>常见变体</th>
                <th>疑似不规范</th>
              </tr>
            </thead>
            <tbody>
              {BANSHI_RULES.map((b) => (
                <tr key={b.id}>
                  <td className="bs-td-name">{b.name}</td>
                  <td>{b.spec}</td>
                  <td>{b.standard}</td>
                  <td>{b.variant}</td>
                  <td>{b.irregular}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <div className="bs-panel-note">
            句式阈值由规范中「为主 / 较自由 / 短句为主」推导；平仄按现代读音判定（阴平阳平为平，上声去声为仄），多音字按常用读音，均仅供参考。
          </div>
        </div>
      )}
      {openPanel === 'zhe' && (
        <div className="bs-panel">
          <div className="bs-zhe-grid">
            {SHISAN_ZHE.map((z) => (
              <div key={z.name} className="bs-zhe-item">
                <span className="bs-zhe-name">{z.name}</span>
                <span className="bs-zhe-sample">{z.sample}</span>
              </div>
            ))}
          </div>
          <div className="bs-panel-note">越剧唱词押韵习惯上以中州韵十三辙为参考；同辙即视为押韵（参考），跨辙在报告中以「建议参考」提示。</div>
        </div>
      )}
      {openPanel === 'excerpt' && currentExcerpt && (
        <div className="bs-panel">
          <div className="bs-excerpt-head">
            <span className="bs-excerpt-title">{currentExcerpt.title}</span>
            <span className="bs-excerpt-source">{currentExcerpt.source}</span>
            <button type="button" className="btn btn-ghost btn-sm" onClick={searchRag}>
              从史料库检索范例（RAG 预留）
            </button>
          </div>
          <pre className="bs-excerpt-text">{currentExcerpt.text}</pre>
          <div className="bs-panel-note">{currentExcerpt.note}</div>
        </div>
      )}

      {/* 解析结果 */}
      {result && result.sentences.length > 0 && (
        <div className="bs-report">
          {/* 总览 */}
          <div className="bs-stats">
            <div className="bs-stat">
              <span className="bs-stat-num">{result.stats.sentenceCount}</span>
              <span className="bs-stat-label">总句数</span>
            </div>
            <div className="bs-stat">
              <span className="bs-stat-num">
                {result.stats.rhymedPairs}
                <small> / {result.stats.pairCount}</small>
              </span>
              <span className="bs-stat-label">押韵对（参考）</span>
            </div>
            <div className="bs-stat">
              <span className="bs-stat-num bs-stat-verdicts">
                <em className="bs-v bs-v-ok">{result.stats.verdictCounts['符合规范']}</em>
                <em className="bs-v bs-v-variant">{result.stats.verdictCounts['常见变体']}</em>
                <em className="bs-v bs-v-irregular">{result.stats.verdictCounts['疑似不规范']}</em>
              </span>
              <span className="bs-stat-label">符合 / 变体 / 疑似</span>
            </div>
            <div className="bs-stat">
              <span className="bs-stat-num bs-stat-zhe">{result.stats.mainZhe ?? '—'}</span>
              <span className="bs-stat-label">主韵部（下句韵脚）</span>
            </div>
          </div>

          <div className="bs-legend">
            <span>
              <i className="bs-dot bs-dot-ok" />符合规范
            </span>
            <span>
              <i className="bs-dot bs-dot-variant" />常见变体
            </span>
            <span>
              <i className="bs-dot bs-dot-irregular" />疑似不规范
            </span>
            <span>
              <i className="bs-dot bs-dot-foot" />韵脚字（句尾）
            </span>
            <span className="bs-legend-hint">结构拆分：七字句「二二三」· 十字句「三三四」</span>
          </div>

          {/* 逐组上下句 */}
          {result.pairs.map((p) => (
            <section key={p.no} className={`bs-pair ${p.rhymed === false ? 'bs-pair-miss' : 'bs-pair-hit'}`}>
              <header className="bs-pair-head">
                <span className="bs-pair-no">第 {p.no} 组</span>
                {p.rhymed ? (
                  <span className="bs-pair-rhyme ok">
                    押韵 · {p.zheLower}
                  </span>
                ) : (
                  <span className="bs-pair-rhyme miss">疑似不押韵（建议参考）</span>
                )}
                <span className="bs-pair-tone">{p.toneNote}</span>
              </header>
              {[p.upper, p.lower].map((s, i) =>
                s ? (
                  <div key={s.index} className={`bs-row bs-row-${s.verdict === '符合规范' ? 'ok' : s.verdict === '常见变体' ? 'variant' : 'irregular'}`}>
                    <span className={`bs-role ${i === 0 ? 'up' : 'down'}`}>{s.role}</span>
                    <div className="bs-line">
                      <span className="bs-text">
                        {s.segments ? (
                          s.segments.map((seg, j) => (
                            <span key={j} className="bs-seg">
                              {seg}
                            </span>
                          ))
                        ) : (
                          <span className="bs-seg bs-seg-plain">{s.display}</span>
                        )}
                        {s.foot && (
                          <span className="bs-foot" title={`韵脚 ${s.foot.pinyin} · ${s.foot.zhe} · ${s.foot.toneName}声`}>
                            {s.segments ? (
                              <em className="bs-foot-char">{s.segments[s.segments.length - 1].slice(-1)}</em>
                            ) : (
                              <em className="bs-foot-char">{s.foot.char}</em>
                            )}
                            <i className="bs-foot-meta">
                              {s.foot.zhe} · {s.foot.toneName}
                            </i>
                          </span>
                        )}
                      </span>
                      <span className="bs-row-meta">
                        <em className="bs-count">{s.charCount} 字</em>
                        <em
                          className={`bs-verdict bs-verdict-${s.verdict === '符合规范' ? 'ok' : s.verdict === '常见变体' ? 'variant' : 'irregular'}`}
                        >
                          {s.verdict}
                        </em>
                        {s.segments && <em className="bs-structure">{s.structureLabel}</em>}
                      </span>
                    </div>
                    <div className="bs-row-note">{s.verdictNote}{s.foot ? ` · 韵脚「${s.foot.char}」${s.foot.pinyin}（${s.foot.zhe}，${s.foot.toneName}声）` : ''}</div>
                  </div>
                ) : null,
              )}
            </section>
          ))}

          {/* 末句未成对 */}
          {result.unpairedIndex && (
            <div className="bs-unpaired">
              第 {result.unpairedIndex} 句为上句，未检测到对应下句（建议参考上下句成对的体例补全）
            </div>
          )}

          {/* 参考建议报告 */}
          <section className="bs-suggestions">
            <h3 className="bs-sug-title">解析报告 · 参考建议</h3>
            <ol className="bs-sug-list">
              {result.suggestions.map((sg, i) => (
                <li key={i}>{sg}</li>
              ))}
            </ol>
            <div className="bs-sug-footer">本工具为教学辅助参考工具，差异判定请以专业教师为准。</div>
          </section>
        </div>
      )}
    </main>
  );
}
