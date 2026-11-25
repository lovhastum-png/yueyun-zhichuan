import { useEffect, useRef, useState } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { getUser } from './auth';

interface NavLinkItem {
  key: string;
  href: string;
  label: string;
}

interface NavLinkGroup {
  title: string;
  items: NavLinkItem[];
}

// 全站已迁移到 React SPA：所有导航链接走前端路由（Link，无整页刷新）
const CORE_LINKS: NavLinkItem[] = [
  { key: 'experience', href: '/experience', label: '数字展馆' },
  { key: 'chat', href: '/chat', label: '智能问答' },
  { key: 'course', href: '/courses', label: '越韵课堂' },
  { key: 'agent', href: '/agent', label: 'AI助手' },
  { key: 'kg', href: '/kg', label: '知识图谱' },
];

// 探索体验按功能定位分两组，避免 9 项平铺难以浏览：
//   学习测评 —— 与教学/评测直接相关；创意体验 —— 创作、娱乐与社交
const EXPLORE_GROUPS: NavLinkGroup[] = [
  {
    title: '学习测评',
    items: [
      { key: 'teacher', href: '/virtual-teacher', label: '越韵先生' },
      { key: 'singing-eval', href: '/singing-eval', label: '演唱测评' },
      { key: 'pose-eval', href: '/pose-eval', label: '身段测评' },
      { key: 'script-compare', href: '/script-compare', label: '剧本比对' },
      { key: 'banshi', href: '/banshi', label: '板式解析' },
      { key: 'audio', href: '/audio', label: '音韵识腔' },
      { key: 'multi-agent', href: '/multi-agent', label: '多智能体' },
    ],
  },
  {
    title: '创意体验',
    items: [
      { key: 'image', href: '/image', label: '丹青生图' },
      { key: 'draw', href: '/draw', label: '水墨画板' },
      { key: 'tryon', href: '/virtual-tryon', label: '虚拟试衣' },
      { key: 'stage', href: '/stage', label: '3D舞台' },
      { key: 'chatroom', href: '/chatroom', label: '雅集聊天' },
    ],
  },
];

// 统一渲染导航链接（全部为 SPA 内部路由）
function NavLink({ item, className }: { item: NavLinkItem; className: string }) {
  return (
    <Link className={className} to={item.href}>
      {item.label}
    </Link>
  );
}

// 顶部导航 + 页脚，结构与 common.js 的 renderNavbar / renderFooter 一致，
// 样式复用 base.css，避免再出现「页面自带样式漏更新」的问题
export function Navbar({ active }: { active?: string }) {
  const location = useLocation();
  const user = getUser();
  const [exploreOpen, setExploreOpen] = useState(false);
  const [mobileOpen, setMobileOpen] = useState(false);
  const [scrolled, setScrolled] = useState(false);
  const exploreRef = useRef<HTMLDivElement>(null);
  const mobileMenuRef = useRef<HTMLDivElement>(null);
  const mobileBtnRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    setExploreOpen(false);
    setMobileOpen(false);
  }, [location.pathname, location.search]);

  const coreLinks =
    user?.role === 'teacher'
      ? [...CORE_LINKS, { key: 'knowledge-review', href: '/knowledge-review', label: '知识飞轮' }]
      : CORE_LINKS;
  const exploreActive = EXPLORE_GROUPS.some((g) => g.items.some((i) => i.key === active));

  // 点击浮层外部 / Esc / 窗口失焦时收起菜单
  useEffect(() => {
    const onPointerDown = (e: PointerEvent) => {
      const target = e.target as Node;
      if (exploreRef.current && !exploreRef.current.contains(target)) setExploreOpen(false);
      if (
        mobileMenuRef.current &&
        !mobileMenuRef.current.contains(target) &&
        mobileBtnRef.current &&
        !mobileBtnRef.current.contains(target)
      ) {
        setMobileOpen(false);
      }
    };
    document.addEventListener('pointerdown', onPointerDown, true);
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      setExploreOpen(false);
      setMobileOpen(false);
    };
    document.addEventListener('keydown', onKeyDown);
    const onBlur = () => setExploreOpen(false);
    window.addEventListener('blur', onBlur);
    // 滚动后导航收拢并加深投影（纯视觉）
    const onScroll = () => setScrolled(window.scrollY > 12);
    onScroll();
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => {
      document.removeEventListener('pointerdown', onPointerDown, true);
      document.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('blur', onBlur);
      window.removeEventListener('scroll', onScroll);
    };
  }, []);

  return (
    <nav className={`navbar${scrolled ? ' navbar-scrolled' : ''}`}>
      <div className="container nav-inner">
        <Link to={isLoggedInRoot()} className="brand">
          <div className="brand-seal">韵</div>
          <div className="brand-text">
            <span className="brand-name">越韵智传</span>
            <span className="brand-sub">YUE YUN ZHI CHUAN</span>
          </div>
        </Link>

        <div className="nav-links">
          {coreLinks.map((l) => (
            <NavLink key={l.key} item={l} className={`nav-link ${l.key === active ? 'active' : ''}`} />
          ))}
          <div className={`dropdown ${exploreOpen ? 'dropdown-open' : ''}`} ref={exploreRef}>
            <button
              type="button"
              className={`nav-link nav-link-button ${exploreActive ? 'active' : ''}`}
              aria-expanded={exploreOpen}
              aria-haspopup="true"
              onClick={() => setExploreOpen((v) => !v)}
            >
              探索体验
            </button>
            <div className="dropdown-menu">
              {EXPLORE_GROUPS.map((g) => (
                <div key={g.title} className="dropdown-group">
                  <div className="dropdown-group-title">{g.title}</div>
                  {g.items.map((i) => (
                    <Link key={i.key} className={`dropdown-item ${i.key === active ? 'active' : ''}`} to={i.href}>
                      {i.label}
                    </Link>
                  ))}
                </div>
              ))}
            </div>
          </div>
        </div>

        <div className="nav-right">
          <button
            className="mobile-menu-btn"
            ref={mobileBtnRef}
            aria-label="打开菜单"
            aria-expanded={mobileOpen}
            onClick={() => setMobileOpen((v) => !v)}
          >
            <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
              <line x1="3" y1="6" x2="21" y2="6" />
              <line x1="3" y1="12" x2="21" y2="12" />
              <line x1="3" y1="18" x2="21" y2="18" />
            </svg>
          </button>
          {user ? (
            <Link to="/profile" className="nav-user">
              <span className="avatar">{user.username.charAt(0)}</span>
              <span>{user.username}</span>
              <span className={`role-tag ${user.role}`} style={{ marginLeft: 6 }}>
                {user.role === 'teacher' ? '师' : '生'}
              </span>
            </Link>
          ) : (
            <Link className="btn btn-ghost btn-sm" to="/login">
              登录 / 注册
            </Link>
          )}
        </div>
      </div>

      <div className={`mobile-menu ${mobileOpen ? 'show' : ''}`} ref={mobileMenuRef}>
        {coreLinks.map((l) => (
          <NavLink key={l.key} item={l} className={`mobile-menu-item ${l.key === active ? 'active' : ''}`} />
        ))}
        <div className="mobile-dropdown">
          <div className="mobile-dropdown-title">探索体验</div>
          {EXPLORE_GROUPS.map((g) => (
            <div key={g.title} className="mobile-dropdown-group">
              <div className="mobile-dropdown-subtitle">{g.title}</div>
              <div className="mobile-dropdown-content">
                {g.items.map((i) => (
                  <Link
                    key={i.key}
                    className={`mobile-dropdown-item ${i.key === active ? 'active' : ''}`}
                    to={i.href}
                  >
                    {i.label}
                  </Link>
                ))}
              </div>
            </div>
          ))}
        </div>
      </div>
    </nav>
  );
}

// 品牌入口统一返回公开数字展馆。
function isLoggedInRoot(): string {
  return '/experience';
}

export function Footer() {
  return (
    <footer className="footer">
      <div className="container">
        越韵智传 · 越剧数字文化体验
        <span className="seal seal-sm" style={{ display: 'inline-grid', width: 22, height: 22, fontSize: 13 }}>
          韵
        </span>
        &nbsp;|&nbsp; 让传统有回响，让传承有新意
      </div>
    </footer>
  );
}
