// 静态资源版本号自动 bump
// ============================================================
// 背景：public/js/*.js 等手动 ?v= 版本化的静态资源若忘记在部署时更新版本串，
//       会被浏览器 / 边缘 CDN 当作"不变资源"长期缓存（旧包持续生效，甚至白屏）。
// 本脚本做"内容感知"版本管理：
//   1. 扫描 public 下所有 html 中形如 x.y.z.js?v=ORIG 的静态引用；
//   2. 对每个引用的真实磁盘文件计算 sha256；
//   3. 只有文件内容发生变化的引用，才把版本号更新为本轮部署的统一版本串；
//      未变化的文件保留原版本号，不造成无谓缓存失效；
//   4. 进度记录于 scripts/.static-version-state.json（首次运行视为全部变化）。
// 用法：npm run version:static   （需在重新构建/改动 public 下静态文件之后执行）
// ============================================================
import { readFileSync, writeFileSync, readdirSync, statSync, existsSync, mkdirSync } from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import crypto from 'crypto';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, '..');
const publicRoot = path.join(root, 'public');
const STATE_FILE = path.join(__dirname, '.static-version-state.json');

// 匹配静态资源引用：捕获 (1)=完整"路径.ext?v=" 前缀，(2)=旧版本号(直至非版本字符)。
const REF_RE = /([\w./-]+\.(?:js|mjs|css)\?v=)([\w.-]+)(?=[^a-z0-9._-]|$)/gi;

// 本轮统一版本串：日期 + 毫秒进制，保证每次部署不同（即使同日多次）。
function buildBuildStamp() {
  const d = new Date();
  const dateStr = `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, '0')}${String(d.getDate()).padStart(2, '0')}`;
  return `${dateStr}-${Date.now().toString(36)}`;
}

function sha256(file) {
  return crypto.createHash('sha256').update(readFileSync(file)).digest('hex');
}

function collectHtml(dir, out = []) {
  if (!existsSync(dir)) return out;
  for (const name of readdirSync(dir)) {
    if (name === 'node_modules' || name.startsWith('.')) continue;
    const p = path.join(dir, name);
    let st;
    try { st = statSync(p); } catch { continue; }
    if (st.isDirectory()) collectHtml(p, out);
    else if (/\.html?$/i.test(name)) out.push(p);
  }
  return out;
}

function loadState() {
  if (!existsSync(STATE_FILE)) return {};
  try { return JSON.parse(readFileSync(STATE_FILE, 'utf8')); } catch { return {}; }
}

let state = loadState();
const pendingVer = new Map();   // fileRel -> 本轮新版本号（保证多处引用一致）
const changedFiles = new Set();
let skipped = 0;

const stamp = buildBuildStamp();
const htmlFiles = collectHtml(publicRoot);

for (const html of htmlFiles) {
  const relHtml = path.relative(root, html).replace(/\\/g, '/');
  const text = readFileSync(html, 'utf8');

  const out = text.replace(REF_RE, (whole, prefix, oldVer) => {
    const assetPath = prefix;                    // 形如 "/js/common.js?v="
    const filePart = assetPath.replace(/\?v=$/, '');
    const diskPath = path.join(publicRoot, filePart.replace(/^\//, ''));
    if (!existsSync(diskPath)) { skipped++; return whole; }
    const relAsset = path.relative(publicRoot, diskPath).replace(/\\/g, '/');
    const hash = sha256(diskPath);
    const prev = state[relAsset];

    if (pendingVer.has(relAsset)) {
      // 同一文件在其他 html / 位置已更新，沿用本轮版本串
      return prefix + pendingVer.get(relAsset);
    }
    if (prev && prev.hash === hash) {
      // 内容未变化，保留原版本号
      skipped++;
      return whole;
    }
    pendingVer.set(relAsset, stamp);
    changedFiles.add(relAsset);
    state[relAsset] = { hash, ver: stamp };
    return prefix + stamp;
  });

  if (out !== text) {
    writeFileSync(html, out, 'utf8');
  }
}

mkdirSync(path.dirname(STATE_FILE), { recursive: true });
writeFileSync(STATE_FILE, JSON.stringify(state, null, 2), 'utf8');

console.log('------------------------------------------------');
console.log(`本轮版本串: ${stamp}`);
console.log(`扫描 html : ${htmlFiles.length} 个`);
console.log(`更新资源 : ${changedFiles.size} 个 -> ${[...changedFiles].join(', ') || '无'}`);
console.log(`保持不变 : ${skipped} 处`);
console.log('提示：边缘仍命中旧缓存时可执行 npm run deploy:purge 清空 Cloudflare 缓存。');