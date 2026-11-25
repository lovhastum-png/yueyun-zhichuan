/* ============================================================
   越韵智传 · 公共脚本
   ============================================================ */

// ---------- 配置 ----------
const API_BASE = '/api';

// ---------- 全局错误兜底（防止任何模块崩溃导致白屏） ----------
// 必须在所有业务脚本之前注入，所以放在 common.js 顶部
(function setupGlobalErrorHandler() {
  // 防止重复注入
  if (window.__yyErrorHandlerInstalled) return;
  window.__yyErrorHandlerInstalled = true;

  // 同步错误
  window.addEventListener('error', (e) => {
    console.error('[全局错误]', e.message, e.error || e.filename + ':' + e.lineno);
    showFatalError(e.message);
  });

  // Promise 未捕获异常
  window.addEventListener('unhandledrejection', (e) => {
    const reason = e.reason;
    const msg = reason instanceof Error ? reason.message : String(reason);
    console.error('[未处理Promise]', reason);
    showFatalError(msg);
  });

  // 仅在白屏（body 无可见内容）时显示兜底提示，避免打扰正常页面
  function showFatalError(msg) {
    // 给页面一点渲染时间
    setTimeout(() => {
      const body = document.body;
      if (!body) return;
      // 如果 body 已有较多内容，说明只是局部报错，不打扰
      if (body.innerHTML.length > 500) return;
      // 白屏场景：显示友好错误页
      if (document.querySelector('#__yyFatalMask')) return;
      const mask = document.createElement('div');
      mask.id = '__yyFatalMask';
      mask.style.cssText = [
        'position:fixed', 'inset:0', 'z-index:99999',
        'display:grid', 'place-items:center',
        'background:linear-gradient(180deg,#f5f0e8,#e8ddc6)',
        'font-family:"PingFang SC","Microsoft YaHei",sans-serif',
        'color:#1a1a1a', 'text-align:center', 'padding:24px'
      ].join(';');
      mask.innerHTML = `
        <div style="max-width:420px;">
          <div style="font-family:'STKaiti','KaiTi',serif;font-size:64px;color:#c1272d;margin-bottom:8px;">韵</div>
          <div style="font-size:18px;font-weight:600;margin-bottom:6px;">页面加载异常</div>
          <div style="font-size:13px;color:#666;line-height:1.7;margin-bottom:18px;">
            越韵智传遇到了一点问题，请尝试刷新页面。<br>
            如问题持续，请联系管理员。
          </div>
          <button onclick="location.reload()" style="
            padding:8px 24px;border:1px solid #c1272d;border-radius:6px;
            background:#c1272d;color:#f5f0e8;cursor:pointer;font-size:14px;
            font-family:inherit;">重新加载</button>
        </div>
      `;
      body.appendChild(mask);
    }, 800);
  }
})();

// ---------- Token 管理 ----------
const Auth = {
  getToken() { return localStorage.getItem('yy_token'); },
  setToken(t) { localStorage.setItem('yy_token', t); },
  clear() { localStorage.removeItem('yy_token'); localStorage.removeItem('yy_user'); },
  getUser() {
    try { return JSON.parse(localStorage.getItem('yy_user') || 'null'); } catch { return null; }
  },
  setUser(u) { localStorage.setItem('yy_user', JSON.stringify(u)); },
  isLoggedIn() { return !!this.getToken(); },
  // 带鉴权头的 headers
  authHeaders(extra = {}) {
    const h = { 'Content-Type': 'application/json', ...extra };
    const t = this.getToken();
    if (t) h['Authorization'] = `Bearer ${t}`;
    return h;
  },
};

// ---------- 统一请求封装 ----------
// 全局请求重试与超时控制
const REQUEST_TIMEOUT_MS = 30000; // 默认 30 秒
let networkOfflineToastShown = false;

// 监听网络状态
window.addEventListener('offline', () => {
  if (!networkOfflineToastShown) {
    networkOfflineToastShown = true;
    toast('网络已断开，请检查网络连接', 'err', 5000);
  }
});
window.addEventListener('online', () => {
  if (networkOfflineToastShown) {
    networkOfflineToastShown = false;
    toast('网络已恢复', 'ok', 2000);
  }
});

async function request(path, { method = 'GET', body, headers, isForm = false, timeout = REQUEST_TIMEOUT_MS } = {}) {
  const opts = { method, headers: {} };
  if (body) {
    if (isForm) {
      opts.headers = { ...Auth.authHeaders({}) };
      delete opts.headers['Content-Type'];
      opts.body = body;
    } else {
      opts.headers = { ...Auth.authHeaders(), ...headers };
      opts.body = JSON.stringify(body);
    }
  } else {
    opts.headers = { ...Auth.authHeaders({}), ...headers };
  }

  // 网络断开提示
  if (!navigator.onLine) {
    toast('网络已断开，请检查网络连接', 'err');
    return { code: -1, message: '网络已断开', data: null };
  }

  // 超时控制
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeout);
  opts.signal = controller.signal;

  let resp;
  try {
    resp = await fetch(API_BASE + path, opts);
  } catch (err) {
    clearTimeout(timer);
    if (err.name === 'AbortError') {
      toast('请求超时，请稍后重试', 'err');
      return { code: -1, message: '请求超时', data: null };
    }
    // 网络错误（服务端不可达）
    toast('网络连接失败，请检查服务是否启动', 'err');
    return { code: -1, message: '网络连接失败', data: null };
  }
  clearTimeout(timer);

  // 处理 401：清除登录态
  if (resp.status === 401) {
    Auth.clear();
    toast('登录已过期，请重新登录', 'err');
    setTimeout(() => { window.location.href = '/login.html'; }, 1000);
    return { code: 401, message: '未登录或登录已过期', data: null };
  }

  // 处理 429：限流
  if (resp.status === 429) {
    const data = await resp.json().catch(() => ({}));
    toast(data.message || '请求过于频繁，请稍后再试', 'err', 4000);
    return { code: 429, message: data.message || '请求过于频繁', data: null };
  }

  // 处理 409：重复提交
  if (resp.status === 409) {
    const data = await resp.json().catch(() => ({}));
    toast(data.message || '请勿重复提交', 'err', 3000);
    return { code: 409, message: data.message || '请勿重复提交', data: null };
  }

  // 处理 503：服务降级
  if (resp.status === 503) {
    toast('服务暂时不可用，请稍后重试', 'err', 4000);
    return { code: 503, message: '服务暂时不可用', data: null };
  }

  const data = await resp.json().catch(() => ({ code: resp.status, message: '服务器响应异常' }));
  return data;
}

// ---------- 防重复点击 ----------
// 用于提交按钮：点击后禁用一段时间，避免重复提交
function preventDuplicateSubmit(btn, opts = {}) {
  const { duration = 3000, text = '提交中...' } = opts;
  if (!btn) return () => {};
  if (btn.dataset.submitting === '1') return null; // 已在提交中
  btn.dataset.submitting = '1';
  btn.disabled = true;
  const originalText = btn.textContent;
  btn.textContent = text;
  return function release() {
    btn.dataset.submitting = '0';
    btn.disabled = false;
    btn.textContent = originalText;
  };
}

// ---------- Toast ----------
function toast(message, type = 'info', duration = 2600) {
  let wrap = document.querySelector('.toast-wrap');
  if (!wrap) {
    wrap = document.createElement('div');
    wrap.className = 'toast-wrap';
    document.body.appendChild(wrap);
  }
  const el = document.createElement('div');
  el.className = `toast ${type === 'ok' ? 'ok' : type === 'err' ? 'err' : ''}`;
  el.textContent = message;
  wrap.appendChild(el);
  setTimeout(() => {
    el.style.opacity = '0';
    el.style.transform = 'translateY(-8px)';
    el.style.transition = 'all 0.3s';
    setTimeout(() => el.remove(), 300);
  }, duration);
}

// 鉴权图片不能直接使用 <img src>，否则浏览器不会附带 Bearer Token。
// 先带登录信息获取二进制，再交给图片元素显示。
async function loadAuthenticatedImages(root = document) {
  const images = [...root.querySelectorAll('img[data-auth-src]')];
  await Promise.all(images.map(async (img) => {
    const src = img.dataset.authSrc;
    if (!src) return;
    try {
      const resp = await fetch(src, { headers: Auth.authHeaders() });
      if (!resp.ok) throw new Error(`图片加载失败 (${resp.status})`);
      const objectUrl = URL.createObjectURL(await resp.blob());
      const release = () => URL.revokeObjectURL(objectUrl);
      img.addEventListener('load', release, { once: true });
      img.addEventListener('error', release, { once: true });
      img.src = objectUrl;
      img.removeAttribute('data-auth-src');
    } catch (err) {
      img.classList.add('auth-image-error');
      img.alt = `${img.alt || '图片'}（加载失败）`;
      console.warn('[图片加载]', err.message);
    }
  }));
}

// ---------- 顶部导航渲染 ----------
// 核心功能直接展示，其余收进「探索体验」下拉；移动端折叠为竖排菜单
function renderNavbar(activeKey) {
  // bare 模式：被 React SPA 以 iframe 桥接加载时，导航由外层 SPA 渲染，跳过注入
  // （检查放在函数内部，覆盖 initPage 之外的直接调用，如 3d-stage.html）
  if (new URLSearchParams(location.search).get('bare') === '1') return;
  const user = Auth.getUser();

  // 核心功能（宽屏直接展示）；全站已迁移 React SPA，导航链接统一指向 /app/*
  const coreLinks = [
    { key: 'chat', href: '/app/chat', label: '智能问答' },
    { key: 'course', href: '/app/courses', label: '越韵课堂' },
    { key: 'agent', href: '/app/agent', label: 'AI助手' },
    { key: 'kg', href: '/app/kg', label: '知识图谱' },
  ];
  // 教师专属：知识飞轮，直接展示
  if (user && user.role === 'teacher') {
    coreLinks.push({ key: 'knowledge-review', href: '/app/knowledge-review', label: '知识飞轮' });
  }

  // 「探索体验」收进下拉（teacher/tryon/stage 为本目录保留的桥接页）
  const exploreItems = [
    { key: 'multi-agent', href: '/app/multi-agent', label: '多智能体' },
    { key: 'teacher', href: '/app/virtual-teacher', label: '越韵先生' },
    { key: 'image', href: '/app/image', label: '丹青生图' },
    { key: 'audio', href: '/app/audio', label: '音韵识腔' },
    { key: 'tryon', href: '/app/virtual-tryon', label: '虚拟试衣' },
    { key: 'stage', href: '/app/stage', label: '3D舞台' },
    { key: 'draw', href: '/app/draw', label: '水墨画板' },
    { key: 'chatroom', href: '/app/chatroom', label: '雅集聊天' },
  ];

  const userHtml = user
    ? `<a href="/app/profile" class="nav-user"><span class="avatar">${user.username.charAt(0)}</span><span>${user.username}</span>${user.role === 'teacher' ? '<span class="role-tag teacher" style="margin-left:6px;">师</span>' : '<span class="role-tag student" style="margin-left:6px;">生</span>'}</a>`
    : `<a href="/app/login" class="btn btn-ghost btn-sm">登录 / 注册</a>`;

  const navHTML = `
    <nav class="navbar">
      <div class="container nav-inner">
        <a href="/app/" class="brand">
          <div class="brand-seal">韵</div>
          <div class="brand-text">
            <span class="brand-name">越韵智传</span>
            <span class="brand-sub">YUE YUN ZHI CHUAN</span>
          </div>
        </a>

        <div class="nav-links">
          ${coreLinks.map(l => `<a class="nav-link ${l.key === activeKey ? 'active' : ''}" href="${l.href}">${l.label}</a>`).join('')}
          <div class="dropdown" id="exploreDropdown">
            <button type="button" class="nav-link nav-link-button ${exploreItems.some(i => i.key === activeKey) ? 'active' : ''}" id="exploreMenuBtn" aria-expanded="false" aria-haspopup="true">探索体验</button>
            <div class="dropdown-menu">
              ${exploreItems.map(i => `<a class="dropdown-item ${i.key === activeKey ? 'active' : ''}" href="${i.href}">${i.label}</a>`).join('')}
            </div>
          </div>
        </div>

        <div class="nav-right">
          <button class="mobile-menu-btn" id="mobileMenuBtn" aria-label="打开菜单">
            <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><line x1="3" y1="6" x2="21" y2="6"></line><line x1="3" y1="12" x2="21" y2="12"></line><line x1="3" y1="18" x2="21" y2="18"></line></svg>
          </button>
          ${userHtml}
        </div>
      </div>

      <div class="mobile-menu" id="mobileMenu">
        ${coreLinks.map(l => `<a class="mobile-menu-item ${l.key === activeKey ? 'active' : ''}" href="${l.href}">${l.label}</a>`).join('')}
        <div class="mobile-dropdown">
          <div class="mobile-dropdown-title">探索体验</div>
          <div class="mobile-dropdown-content">
            ${exploreItems.map(i => `<a class="mobile-dropdown-item ${i.key === activeKey ? 'active' : ''}" href="${i.href}">${i.label}</a>`).join('')}
          </div>
        </div>
      </div>
    </nav>
  `;

  // 插入到 app-shell 内部最前，保持 flex 布局
  const shell = document.querySelector('.app-shell');
  if (shell) shell.insertAdjacentHTML('afterbegin', navHTML);
  else document.body.insertAdjacentHTML('afterbegin', navHTML);

  // 移动端折叠菜单开关
  const menuBtn = document.getElementById('mobileMenuBtn');
  const mobileMenu = document.getElementById('mobileMenu');
  const exploreDropdown = document.getElementById('exploreDropdown');
  const exploreMenuBtn = document.getElementById('exploreMenuBtn');
  const closeExploreMenu = () => {
    exploreDropdown?.classList.remove('dropdown-open');
    exploreMenuBtn?.setAttribute('aria-expanded', 'false');
  };
  if (exploreDropdown && exploreMenuBtn) {
    exploreMenuBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      const willOpen = !exploreDropdown.classList.contains('dropdown-open');
      exploreDropdown.classList.toggle('dropdown-open', willOpen);
      exploreMenuBtn.setAttribute('aria-expanded', String(willOpen));
    });
  }

  // Use a capturing pointer event so every click outside closes the panel,
  // even when a page component stops click propagation.
  document.addEventListener('pointerdown', (e) => {
    if (exploreDropdown && !exploreDropdown.contains(e.target)) {
      closeExploreMenu();
    }
  }, true);
  window.addEventListener('blur', closeExploreMenu);

  if (menuBtn && mobileMenu) {
    menuBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      mobileMenu.classList.toggle('show');
      menuBtn.classList.toggle('open');
    });
    // 点击菜单外关闭
    document.addEventListener('click', (e) => {
      if (!mobileMenu.contains(e.target) && !menuBtn.contains(e.target)) {
        mobileMenu.classList.remove('show');
        menuBtn.classList.remove('open');
      }
    });
  }

  document.addEventListener('keydown', (e) => {
    if (e.key !== 'Escape') return;
    closeExploreMenu();
    mobileMenu?.classList.remove('show');
    menuBtn?.classList.remove('open');
  });
}

// ---------- 页脚 ----------
function renderFooter() {
  // bare 模式：页脚同样由外层 SPA 渲染（见 renderNavbar 注释）
  if (new URLSearchParams(location.search).get('bare') === '1') return;
  const footer = document.createElement('footer');
  footer.className = 'footer';
  footer.innerHTML = `
    <div class="container">
      越韵智传 · 越剧教学辅助平台
      <span class="seal seal-sm" style="display:inline-grid;width:22px;height:22px;font-size:13px;">韵</span>
      &nbsp;|&nbsp; 面向艺术学一流学科建设 · 2026 中国青年科技创新揭榜挂帅擂台赛
    </div>
  `;
  const shell = document.querySelector('.app-shell');
  if (shell) shell.appendChild(footer);
  else document.body.appendChild(footer);
}

// ---------- 登录守卫 ----------
function requireLogin(redirectMsg = '请先登录后使用此功能') {
  if (!Auth.isLoggedIn()) {
    toast(redirectMsg, 'err');
    setTimeout(() => { window.location.href = '/login.html'; }, 900);
    return false;
  }
  return true;
}

// ---------- 角色守卫：未登录跳 login，角色不符跳 dashboard ----------
function requireRole(role, msg) {
  if (!requireLogin()) return false;
  const user = Auth.getUser();
  if (user.role !== role) {
    toast(msg || `此功能仅${role === 'teacher' ? '教师' : '学生'}可用`, 'err');
    setTimeout(() => { window.location.href = '/dashboard.html'; }, 900);
    return false;
  }
  return true;
}

// ---------- 模态框（通用） ----------
function openModal(title, bodyHtml, actionsHtml = '') {
  const mask = document.createElement('div');
  mask.className = 'modal-mask';
  mask.innerHTML = `
    <div class="modal-box">
      <div class="modal-title">${escapeHtml(title)}</div>
      <div class="modal-body">${bodyHtml}</div>
      <div class="modal-actions">${actionsHtml}</div>
    </div>
  `;
  mask.addEventListener('click', (e) => {
    if (e.target === mask || e.target.dataset?.modalClose !== undefined) mask.remove();
  });
  document.body.appendChild(mask);
  return mask;
}
function closeModal(mask) { if (mask) mask.remove(); }

// ---------- 转义 HTML ----------
function escapeHtml(str) {
  if (str == null) return '';
  return String(str)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

// ---------- AI 回答渲染：将【出处：xxx】转为标签、图片 URL 转为 img ----------
function renderAnswer(text) {
  if (!text) return '';
  let html = escapeHtml(text);
  // Markdown 图片语法 ![alt](url) → <img>
  html = html.replace(/!\[([^\]]*)\]\(([^\s)]+)\)/g, (_, alt, url) => renderImageTag(url, alt));
  // 【图片：url】→ <img>
  html = html.replace(/【图片：([^\s】]+)】/g, (_, url) => renderImageTag(url));
  // 常见“已生成图片：/uploads/xxx.jpg”或“图片路径为：/uploads/xxx.jpg” → 文本 + <img>
  html = html.replace(/((?:已生成图片|图片路径为|生成图片)[：:]\s*)(\/uploads\/[^\s<]+?\.(?:jpg|jpeg|png|gif|webp))/gi, (_, prefix, url) => `${escapeHtml(prefix)}${renderImageTag(url)}`);
  // 【出处：xxx】→ <span class="src-mark">xxx</span>
  html = html.replace(/【出处：([^】]+)】/g, (_, c) => `<span class="src-mark">${escapeHtml(c)}</span>`);
  // 换行
  html = html.replace(/\n/g, '<br>');
  // 段落
  return html.split(/<br>(?=<br>)/).map(p => p.trim() ? `<p>${p}</p>` : '').join('');
}

// 渲染图片标签，避免图片过大撑破容器
// 只允许相对路径、http(s) 与 data:image；renderImageTag 会把地址拼进
// onclick="window.open('...')"，若 AI 输出 javascript: 协议的内容，
// 点击缩略图就会执行脚本，因此必须先做协议白名单校验。
function isSafeImageUrl(url) {
  return /^(?:https?:\/\/|\/|\.\/|data:image\/)/i.test(String(url).trim());
}

function renderImageTag(url, alt = '生成的图片') {
  const cleanUrl = String(url).replace(/[。，、；：？！"'（）【】\].]+$/g, '');
  const safeAlt = escapeHtml(alt);
  if (!isSafeImageUrl(cleanUrl)) {
    return `<span class="chat-image-fallback">[图片] ${escapeHtml(cleanUrl)}</span>`;
  }
  const safeUrl = escapeHtml(cleanUrl);
  return `<img src="${safeUrl}" alt="${safeAlt}" class="chat-generated-image" loading="lazy" onclick="window.open('${safeUrl}','_blank')" onerror="this.style.display='none';this.nextElementSibling&&(this.nextElementSibling.style.display='inline-block')" onload="this.style.display='block'"><span class="chat-image-fallback" style="display:none;color:var(--ink-light);font-size:12px;">[图片] ${safeUrl}</span>`;
}

// ---------- 时间格式化 ----------
function formatTime(dateStr) {
  if (!dateStr) return '';
  const d = new Date(dateStr);
  if (isNaN(d)) return dateStr;
  const now = new Date();
  const diff = (now - d) / 1000;
  if (diff < 60) return '刚刚';
  if (diff < 3600) return `${Math.floor(diff / 60)} 分钟前`;
  if (diff < 86400) return `${Math.floor(diff / 3600)} 小时前`;
  if (diff < 604800) return `${Math.floor(diff / 86400)} 天前`;
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  const hh = String(d.getHours()).padStart(2, '0');
  const mi = String(d.getMinutes()).padStart(2, '0');
  return `${d.getFullYear()}-${mm}-${dd} ${hh}:${mi}`;
}

// ---------- 页面初始化辅助 ----------
function initPage(activeKey, opts = {}) {
  // bare 模式：被 React SPA 以 iframe 桥接加载时，隐藏旧导航/页脚（SPA 外层已渲染）
  if (new URLSearchParams(location.search).get('bare') === '1') return;
  renderNavbar(activeKey);
  renderFooter();
  // 给 app-shell 包裹
}

// ---------- 全站页面切换过渡 + 悬停预取 ----------
// 旧页面仍是整页加载，这里用「淡出 → 跳转 → 新页淡入」消除白屏硬切，
// 并在鼠标悬停时预取目标页面，让跳转接近即时。React SPA 页面不受影响（不加载 common.js）。
(function setupPageTransition() {
  if (window.__yyPageTransitionInstalled) return;
  // 被嵌入 iframe（React SPA 桥接）时不启用：链接拦截会在 iframe 内跳转，破坏外层路由
  if (window.self !== window.top) return;
  window.__yyPageTransitionInstalled = true;

  const style = document.createElement('style');
  style.textContent = [
    'html{background:var(--paper,#f7f4ec)}',
    'body.yy-fade-out{opacity:0;transition:opacity .17s ease}',
    'body.yy-fade-in{animation:yyFadeIn .3s ease both}',
    '@keyframes yyFadeIn{from{opacity:0}to{opacity:1}}',
    '@media (prefers-reduced-motion:reduce){body.yy-fade-out{transition:none}body.yy-fade-in{animation:none}}'
  ].join('');
  document.head.appendChild(style);

  // 新页面淡入（common.js 在 body 末尾加载，body 已存在）
  if (document.body) {
    document.body.classList.add('yy-fade-in');
    document.body.addEventListener('animationend', () => document.body.classList.remove('yy-fade-in'), { once: true });
  }

  // 浏览器「后退」从 bfcache 恢复时可能带着淡出状态，强制复原
  window.addEventListener('pageshow', (e) => {
    if (e.persisted) document.body.classList.remove('yy-fade-out', 'yy-fade-in');
  });

  // 站内页面链接：/ 开头、.html 结尾或 /app 前缀或根路径，排除 API 与上传资源
  function isInternalNav(href) {
    if (typeof href !== 'string' || !href.startsWith('/') || href.startsWith('//')) return false;
    if (href.startsWith('/api/') || href.startsWith('/uploads/')) return false;
    return href.includes('.html') || href.startsWith('/app') || href === '/';
  }

  // 悬停时预取目标页（每个地址只取一次）
  const prefetched = new Set();
  document.addEventListener('mouseover', (e) => {
    const a = e.target.closest && e.target.closest('a[href]');
    if (!a || a.target === '_blank') return;
    const href = a.getAttribute('href') || '';
    if (!isInternalNav(href) || prefetched.has(href)) return;
    prefetched.add(href);
    const link = document.createElement('link');
    link.rel = 'prefetch';
    link.href = href;
    document.head.appendChild(link);
  }, { passive: true });

  // 点击内链：先淡出再跳转（修饰键/新标签页点击不拦截）
  document.addEventListener('click', (e) => {
    if (e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
    const a = e.target.closest && e.target.closest('a[href]');
    if (!a || a.target === '_blank' || a.hasAttribute('download')) return;
    const href = a.getAttribute('href') || '';
    if (!isInternalNav(href)) return;
    // 指向当前页的链接不处理
    const target = new URL(href, location.origin);
    if (target.pathname + target.search === location.pathname + location.search) return;
    e.preventDefault();
    document.body.classList.add('yy-fade-out');
    setTimeout(() => { window.location.href = href; }, 170);
  });
})();
