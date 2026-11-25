// 生成自托管字体：从 @fontsource 包提取 woff2 分片到 public/fonts/，
// 并生成 public/css/fonts.css（保留 unicode-range，浏览器按需加载用到的字块）。
// 用法：node scripts/build-fonts.mjs
// 依赖：npm install @fontsource/noto-serif-sc @fontsource/ma-shan-zheng @fontsource/zcool-xiaowei
import { readFileSync, writeFileSync, mkdirSync, readdirSync, existsSync, copyFileSync, statSync } from 'node:fs';
import { join, basename } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(fileURLToPath(import.meta.url), '..', '..');
const fontsDir = join(root, 'public', 'fonts');
mkdirSync(fontsDir, { recursive: true });

// 需要本地化的字体（Noto Serif SC 取实际用到的 4 个权重；书法字体仅 400）
const SOURCES = [
  { pkg: 'noto-serif-sc', weights: [400, 500, 600, 700] },
  { pkg: 'ma-shan-zheng', weights: [400] },
  { pkg: 'zcool-xiaowei', weights: [400] },
];

const faceRe = /@font-face\s*\{[^}]*\}/g;
const urlRe = /url\((\.\/files\/([^)]+\.woff2))\)/;

let cssOut = [
  '/* 自托管字体（由 scripts/build-fonts.mjs 从 @fontsource 生成，勿手改） */',
  '/* 保留 unicode-range 分片：浏览器仅下载页面实际用到的字块 */',
];
let copied = 0;

for (const { pkg, weights } of SOURCES) {
  for (const w of weights) {
    const cssPath = join(root, 'node_modules', '@fontsource', pkg, `${w}.css`);
    if (!existsSync(cssPath)) {
      console.error(`缺少 ${cssPath}，请先 npm install`);
      process.exit(1);
    }
    const css = readFileSync(cssPath, 'utf8');
    for (const face of css.match(faceRe) ?? []) {
      const m = face.match(urlRe);
      if (!m) continue; // 该分片无 woff2（如 latin-ext 纯 woff），跳过
      const fileName = m[2];
      copyFileSync(join(root, 'node_modules', '@fontsource', pkg, 'files', fileName), join(fontsDir, fileName));
      copied++;
      // 重写 src：仅保留 woff2、指向 /fonts/ 绝对路径（SPA 与桥接页共用）
      cssOut.push(face.replace(/src:[^;]+;/, `src: url(/fonts/${fileName}) format('woff2');`));
    }
  }
}

writeFileSync(join(root, 'public', 'css', 'fonts.css'), cssOut.join('\n\n') + '\n', 'utf8');
const sizeMB = (readdirSync(fontsDir).reduce((s, f) => s + statSync(join(fontsDir, f)).size, 0) / 1048576).toFixed(1);
console.log(`字体就绪：${copied} 个 woff2 分片 → public/fonts/（共 ${sizeMB} MB），CSS → public/css/fonts.css`);
