import { Suspense, useLayoutEffect } from 'react';
import { useLocation, useOutlet } from 'react-router-dom';
import { Navbar, Footer } from '../shared/navbar';
import { ScrollReveal } from '../shared/ScrollReveal';
import { ScrollProgress } from '../shared/ScrollProgress';
import { BackToTop } from '../shared/BackToTop';
import { InkGrinding } from '../shared/InkGrinding';

// 路由分包加载兜底：chunk 未就绪时展示研墨占位，不白屏。
// full —— 整屏（登录页等布局外路由）；inline —— 内容区内（共享布局内路由）。
export function RouteFallback({ variant = 'inline' }: { variant?: 'full' | 'inline' }) {
  return (
    <div className={'route-fallback ' + variant} role="status" aria-live="polite">
      <InkGrinding text="正在展卷…" />
    </div>
  );
}

// 路径 → 导航条高亮 key（课程系页面统一高亮「越韵课堂」）
const ACTIVE_BY_PATH: Record<string, string> = {
  '/experience': 'experience',
  '/courses': 'course',
  '/course-detail': 'course',
  '/course-reader': 'course',
  '/course-import': 'course',
  '/exam': 'course',
  '/assignment': 'course',
  '/chat': 'chat',
  '/agent': 'agent',
  '/multi-agent': 'multi-agent',
  '/kg': 'kg',
  '/image': 'image',
  '/audio': 'audio',
  '/singing-eval': 'singing-eval',
  '/pose-eval': 'pose-eval',
  '/script-compare': 'script-compare',
  '/banshi': 'banshi',
  '/draw': 'draw',
  '/chatroom': 'chatroom',
  '/knowledge-review': 'knowledge-review',
  '/virtual-teacher': 'teacher',
  '/virtual-tryon': 'tryon',
  '/stage': 'stage',
};

// 全站共享布局：导航条与页脚常驻，不随路由切换重挂 —— 只有内容区切换。
// 这是消除「切换像整页刷新」观感的关键：导航条从头到尾一动不动。
//
// 内容按路由重挂并淡入，导航常驻，避免换页时整体闪烁。
export function AppLayout() {
  const location = useLocation();
  const outlet = useOutlet();

  // 新页挂载前回顶：首帧就从顶部开始，不带旧页的滚动位置
  useLayoutEffect(() => {
    window.scrollTo(0, 0);
  }, [location.pathname]);

  const active = ACTIVE_BY_PATH[location.pathname];

  return (
    <div className="app-shell">
      {/* 全局动效叠加层：阅读进度、滚动揭示（均不影响布局与既有功能） */}
      <ScrollProgress />
      <ScrollReveal />
      <Navbar active={active} />
      <div className="spa-page" style={{ flex: 1, display: 'flex', flexDirection: 'column' }}>
        {/* 内容区分包兜底：导航条/页脚常驻，仅内容区显示研墨占位 */}
        <Suspense fallback={<RouteFallback />}>
          {/* 以 pathname + search 为 key：路由一变立即换页。
              带上 search 是为了让 /course-detail?id=1 → ?id=2 这类「同路径换资源」
              也能重新挂载；只用 pathname 的话组件不重建，加载新数据期间会先显示上一份内容。 */}
          <div key={location.pathname + location.search} className="spa-page-body">
            {outlet}
          </div>
        </Suspense>
      </div>
      <Footer />
      <BackToTop />
    </div>
  );
}
