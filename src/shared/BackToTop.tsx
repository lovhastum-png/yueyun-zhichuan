import { useEffect, useState } from 'react';
import { useLocation } from 'react-router-dom';

// 回顶印章：滚过一屏后旋落出现，点击平滑回到顶部。
export function BackToTop() {
  const [show, setShow] = useState(false);
  const location = useLocation();

  useEffect(() => {
    const onScroll = () => setShow(window.scrollY > 360);
    onScroll();
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => window.removeEventListener('scroll', onScroll);
  }, [location.pathname]);

  return (
    <button
      type="button"
      className={`back-to-top${show ? ' show' : ''}`}
      aria-label="回到顶部"
      title="回到顶部"
      onClick={() => window.scrollTo({ top: 0, behavior: 'smooth' })}
    >
      <svg width="22" height="22" viewBox="0 0 24 24" fill="none" aria-hidden="true">
        <path d="M12 20V5.5" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
        <path
          d="M5.5 11.5 12 5l6.5 6.5"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </svg>
    </button>
  );
}
