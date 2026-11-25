import { useEffect } from 'react';
import { useLocation } from 'react-router-dom';

// 参与「滚动入场」的块级选择器：仅挑选稳定的卡片/分区，避开导航、弹层与聊天流。
const SELECTORS = [
  '.ex-reveal',
  '.dashboard-section',
  '.feature-card',
  '.page-hero',
  '.section',
  '.course-card',
  '.knowledge-card',
  '.expert-card',
  '.path-card',
  '.gallery-item',
  '.stat-tile',
  '.info-card',
  '.learn-item',
  '.timeline > li',
  '.timeline-item',
  '.history-card',
  '.stat-card',
  '.review-card',
  '.image-main',
  '.draw-thumb',
  '.audio-result',
  '.exam-paper',
  '.bs-input-card',
  '.bs-panel',
].join(',');

const MAX_STAGGER = 8;
const STAGGER_MS = 60;

// 全站滚动揭示：元素进入视口时补上 .reveal-in，触发 motion.css 的浮起动画。
// 纯视觉增强——不加动画也能正常显示（JS 未就绪时元素保持可见的兜底见下）。
export function ScrollReveal() {
  const location = useLocation();

  useEffect(() => {
    // Observe the stable wrapper too: lazy routes may still show a fallback on first mount.
    const root = document.querySelector('.spa-page');
    if (!root || typeof IntersectionObserver === 'undefined') return;

    const io = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (entry.isIntersecting) {
            entry.target.classList.add('reveal-in');
            io.unobserve(entry.target);
          }
        }
      },
      { rootMargin: '0px 0px -8% 0px', threshold: 0.08 },
    );

    const processed = new WeakSet<Element>();

    const register = (el: Element) => {
      if (processed.has(el)) return;
      // 已有自身入场动画的（如 .rise-in）、弹层/提示内的元素一律不接管
      if (el.classList.contains('rise-in')) return;
      if (el.closest('.modal-mask, .toast-wrap, .no-reveal')) return;
      processed.add(el);
      if (el.classList.contains('reveal-in')) return;
      el.classList.add('reveal-item');

      // 同层兄弟间错落登场（越靠后延迟越大，封顶避免过长等待）
      const parent = el.parentElement;
      let idx = 0;
      if (parent) {
        const siblings = Array.from(parent.children).filter((c) => c.classList.contains('reveal-item'));
        idx = siblings.indexOf(el);
      }
      const delay = Math.min(Math.max(idx, 0), MAX_STAGGER) * STAGGER_MS;
      (el as HTMLElement).style.setProperty('--reveal-delay', `${delay}ms`);

      io.observe(el);
    };

    // 扫描入口：全页按选择器登记待揭示元素
    const scan = () => root.querySelectorAll(SELECTORS).forEach(register);

    scan();

    // 数据异步到达后新出现的卡片也要接管。
    // 性能关键：扫描必须去抖。此前每批 DOM 变更都立即全页 querySelectorAll，
    // 在聊天/多智能体等 SSE 流式页（逐 token 改 DOM）每秒会触发数十次全页扫描，
    // 是全站「打字卡、流式卡」的主因。改为 160ms 尾随去抖 + 无新增节点直接跳过。
    let scanTimer = 0;
    const scheduleScan = () => {
      if (scanTimer) return;
      scanTimer = window.setTimeout(() => {
        scanTimer = 0;
        scan();
      }, 160);
    };

    const mo = new MutationObserver((records) => {
      for (const r of records) {
        if (r.addedNodes.length > 0) {
          scheduleScan();
          break;
        }
      }
    });
    mo.observe(root, { childList: true, subtree: true });

    return () => {
      io.disconnect();
      mo.disconnect();
      if (scanTimer) window.clearTimeout(scanTimer);
    };
  }, [location.pathname, location.search]);

  return null;
}
