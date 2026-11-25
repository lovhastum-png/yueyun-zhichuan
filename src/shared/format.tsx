// 从 common.js 移植的聊天回答渲染与时间格式化，供各聊天/AI 页面共用

/** 转义 HTML（用于拼 HTML 字符串的场景；React 文本节点无需手动转义） */
export function escapeHtml(str: string | null | undefined): string {
  if (str == null) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

// 只允许相对路径、http(s) 与 data:image 三类图片地址。
// renderImageTag 会把地址拼进 onclick="window.open('...')"，
// 若 AI 输出 ![x](javascript:alert(1)) 这样的内容，点击缩略图就会执行脚本。
function isSafeImageUrl(url: string): boolean {
  return /^(?:https?:\/\/|\/|\.\/|data:image\/)/i.test(String(url).trim());
}

function renderImageTag(url: string, alt = '生成的图片'): string {
  const cleanUrl = String(url).replace(/[。，、；：？！"'（）【】\].]+$/g, '');
  const safeAlt = escapeHtml(alt);
  if (!isSafeImageUrl(cleanUrl)) {
    // 不安全地址退化为纯文本，不生成可点击的图片节点
    return `<span class="chat-image-fallback">[图片] ${escapeHtml(cleanUrl)}</span>`;
  }
  const safeUrl = escapeHtml(cleanUrl);
  return `<img src="${safeUrl}" alt="${safeAlt}" class="chat-generated-image" loading="lazy" onclick="window.open('${safeUrl}','_blank')" onerror="this.style.display='none';this.nextElementSibling&&(this.nextElementSibling.style.display='inline-block')" onload="this.style.display='block'"><span class="chat-image-fallback" style="display:none;color:var(--ink-light);font-size:12px;">[图片] ${safeUrl}</span>`;
}

/** AI 回答渲染：Markdown 图片、【图片：url】、【出处：xxx】→ HTML（配合 dangerouslySetInnerHTML 使用） */
export function renderAnswerHtml(text: string | null | undefined): string {
  if (!text) return '';
  let html = escapeHtml(text);
  // Markdown 图片语法 ![alt](url) → <img>
  html = html.replace(/!\[([^\]]*)\]\(([^\s)]+)\)/g, (_, alt, url) => renderImageTag(url, alt));
  // 【图片：url】→ <img>
  html = html.replace(/【图片：([^\s】]+)】/g, (_, url) => renderImageTag(url));
  // 常见"已生成图片：/uploads/xxx.jpg"或"图片路径为：/uploads/xxx.jpg" → 文本 + <img>
  html = html.replace(
    /((?:已生成图片|图片路径为|生成图片)[：:]\s*)(\/uploads\/[^\s<]+?\.(?:jpg|jpeg|png|gif|webp))/gi,
    (_, prefix, url) => `${escapeHtml(prefix)}${renderImageTag(url)}`,
  );
  // 【出处：xxx】→ <span class="src-mark">xxx</span>
  html = html.replace(/【出处：([^】]+)】/g, (_, c) => `<span class="src-mark">${escapeHtml(c)}</span>`);
  // 换行
  html = html.replace(/\n/g, '<br>');
  // 段落
  return html
    .split(/<br>(?=<br>)/)
    .map((p) => (p.trim() ? `<p>${p}</p>` : ''))
    .join('');
}

/** 相对时间格式化：刚刚 / N 分钟前 / N 小时前 / N 天前 / YYYY-MM-DD HH:mm */
export function formatTime(dateStr: string | null | undefined): string {
  if (!dateStr) return '';
  const d = new Date(dateStr);
  if (isNaN(d.getTime())) return dateStr;
  const now = new Date();
  const diff = (now.getTime() - d.getTime()) / 1000;
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

/** AI 评分置信度 → 传统色（高/中/低三档），作业页与考试页共用 */
export function confColor(c: number): string {
  return c >= 0.75 ? 'var(--cyan)' : c >= 0.5 ? 'var(--gold)' : 'var(--cinnabar)';
}

/** AI 评分置信度 → 文字标签（高/中/低） */
export function confLabel(c: number): string {
  return c >= 0.75 ? '高' : c >= 0.5 ? '中' : '低';
}
