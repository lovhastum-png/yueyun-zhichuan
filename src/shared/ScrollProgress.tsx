import { useEffect, useState } from 'react';
import { useLocation } from 'react-router-dom';

// 卷轴阅读进度：顶部一道墨线，随页面滚动自左向右推进。
export function ScrollProgress() {
  const [progress, setProgress] = useState(0);
  const location = useLocation();

  useEffect(() => {
    let raf = 0;
    // 上次已渲染的进度 / 已写入的滚动像素，用于过滤不可见的小变化，
    // 避免滚动期间每帧都触发 React 重渲染和根节点 CSS 变量写入
    let lastDrawn = -1;
    let lastY = -1;
    const update = () => {
      raf = 0;
      const doc = document.documentElement;
      const max = doc.scrollHeight - doc.clientHeight;
      const next = max > 0 ? Math.min(1, Math.max(0, window.scrollY / max)) : 0;
      if (Math.abs(next - lastDrawn) > 0.0015) {
        lastDrawn = next;
        setProgress(next);
      }
      // 供 atmosphere.css 的页眉远山做视差（像素值，非百分比）
      const y = Math.round(window.scrollY);
      if (y !== lastY) {
        lastY = y;
        doc.style.setProperty('--yy-scroll', String(y));
      }
    };
    const onScroll = () => {
      if (!raf) raf = window.requestAnimationFrame(update);
    };

    update();
    window.addEventListener('scroll', onScroll, { passive: true });
    window.addEventListener('resize', onScroll, { passive: true });
    return () => {
      window.removeEventListener('scroll', onScroll);
      window.removeEventListener('resize', onScroll);
      if (raf) window.cancelAnimationFrame(raf);
    };
  }, [location.pathname]);

  return (
    <div className={`scroll-progress${progress > 0.002 ? ' is-active' : ''}`} aria-hidden="true">
      <div className="scroll-progress-bar" style={{ width: `${(progress * 100).toFixed(2)}%` }} />
    </div>
  );
}
