// VRM/GLB 贴图 WebP 化：手动解析 GLB 容器，仅重编码贴图，其余字节原样保留。
// 用法: node scripts/webp-vrm-textures.mjs <输入.vrm> <输出.vrm> [--quality 90] [--normal-quality 96]
import { readFile, writeFile } from 'node:fs/promises';
import sharp from 'sharp';

const args = process.argv.slice(2);
const input = args[0];
const output = args[1];
if (!input || !output) {
  console.error('用法: node scripts/webp-vrm-textures.mjs <输入.vrm> <输出.vrm> [--quality 90] [--normal-quality 96]');
  process.exit(1);
}
const quality = Number(args.includes('--quality') ? args[args.indexOf('--quality') + 1] : 90);
const normalQuality = Number(args.includes('--normal-quality') ? args[args.indexOf('--normal-quality') + 1] : 96);

const JSON_CHUNK = 0x4e4f534a;
const BIN_CHUNK = 0x004e4942;

const data = await readFile(input);
if (data.readUInt32LE(0) !== 0x46546c67) throw new Error('输入不是 GLB');

// —— 解析 GLB chunks ——
let json = null, bin = null, off = 12;
while (off < data.length) {
  const len = data.readUInt32LE(off);
  const type = data.readUInt32LE(off + 4);
  const chunk = data.subarray(off + 8, off + 8 + len);
  if (type === JSON_CHUNK) json = JSON.parse(chunk.toString('utf8').replace(/\0+$/, '').trim());
  else if (type === BIN_CHUNK) bin = chunk;
  off += 8 + len;
}
if (!json || !bin) throw new Error('GLB 缺少 JSON/BIN chunk');

// —— 收集贴图 bufferView（多张 image 可能共享同一 view）——
const viewToImages = new Map();
for (const img of json.images ?? []) {
  if (img.bufferView === undefined) continue;
  if (!viewToImages.has(img.bufferView)) viewToImages.set(img.bufferView, []);
  viewToImages.get(img.bufferView).push(img);
}

// —— WebP 重编码 ——
const replacement = new Map(); // viewIndex -> { payload, mime }
let totalBefore = 0, totalAfter = 0, converted = 0, kept = 0;
for (const [viewIdx, imgs] of viewToImages) {
  const view = json.bufferViews[viewIdx];
  const start = view.byteOffset ?? 0;
  const payload = bin.subarray(start, start + view.byteLength);
  const mime = imgs[0].mimeType ?? 'image/png';
  if (mime !== 'image/png') { kept++; continue; } // 只处理 PNG

  const name = imgs[0].name ?? '';
  const isNormal = /nml|normal/i.test(name);
  const q = isNormal ? normalQuality : quality;
  try {
    const out = await sharp(payload, { failOn: 'none' })
      .webp({ quality: q, effort: 4, smartSubsample: true })
      .toBuffer();
    if (out.length < payload.length) {
      totalBefore += payload.length; totalAfter += out.length;
      converted++;
      replacement.set(viewIdx, { payload: out, mime: 'image/webp' });
    } else {
      kept++;
    }
  } catch (e) {
    console.warn(`  跳过 ${name}: ${e.message}`);
    kept++;
  }
}

// —— 更新 image mimeType ——
for (const [viewIdx, imgs] of viewToImages) {
  const rep = replacement.get(viewIdx);
  if (rep) for (const img of imgs) img.mimeType = rep.mime;
}

// —— 重建 BIN ——
const chunks = [];
let rebuiltLen = 0;
const pushChunk = (buf) => { chunks.push(buf); rebuiltLen += buf.length; };
const padTo4 = () => { const pad = (4 - (rebuiltLen % 4)) % 4; if (pad) pushChunk(Buffer.alloc(pad, 0)); };
for (let i = 0; i < json.bufferViews.length; i++) {
  padTo4();
  const view = json.bufferViews[i];
  const rep = replacement.get(i);
  const payload = rep ? rep.payload : bin.subarray(view.byteOffset ?? 0, (view.byteOffset ?? 0) + view.byteLength);
  view.buffer = 0;
  view.byteOffset = rebuiltLen;
  view.byteLength = payload.length;
  pushChunk(Buffer.from(payload));
}
json.buffers[0].byteLength = rebuiltLen;

// —— 打包 GLB ——
let jsonBytes = Buffer.from(JSON.stringify(json), 'utf8');
const jsonPad = (4 - (jsonBytes.length % 4)) % 4;
jsonBytes = Buffer.concat([jsonBytes, Buffer.alloc(jsonPad, 0x20)]);
const binBytes = Buffer.concat(chunks);
const binPad = (4 - (binBytes.length % 4)) % 4;
const binFinal = Buffer.concat([binBytes, Buffer.alloc(binPad, 0)]);

const total = 12 + 8 + jsonBytes.length + 8 + binFinal.length;
const out = Buffer.alloc(total);
out.write('glTF', 0, 'ascii');
out.writeUInt32LE(2, 4);
out.writeUInt32LE(total, 8);
out.writeUInt32LE(jsonBytes.length, 12);
out.writeUInt32LE(JSON_CHUNK, 16);
jsonBytes.copy(out, 20);
out.writeUInt32LE(binFinal.length, 20 + jsonBytes.length);
out.writeUInt32LE(BIN_CHUNK, 24 + jsonBytes.length);
binFinal.copy(out, 28 + jsonBytes.length);

await writeFile(output, out);
const srcSize = (await readFile(input)).length;
console.log(`${input}`);
console.log(`  贴图: 转换 ${converted} 张 / 保留 ${kept} 张`);
if (converted > 0) console.log(`  贴图体积: ${(totalBefore / 1024).toFixed(0)}KB -> ${(totalAfter / 1024).toFixed(0)}KB (-${(100 - totalAfter / totalBefore * 100).toFixed(0)}%)`);
console.log(`  文件体积: ${(srcSize / 1024 / 1024).toFixed(2)}MB -> ${(out.length / 1024 / 1024).toFixed(2)}MB (-${(100 - out.length / srcSize * 100).toFixed(0)}%)`);
