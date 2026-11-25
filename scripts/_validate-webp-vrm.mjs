// 校验 WebP 化后的 VRM：GLB 结构、VRM 扩展、贴图 mimeType、accessor/bufferView 一致性
import { readFile } from 'node:fs/promises';

const files = process.argv.slice(2);
let allOk = true;

for (const file of files) {
  const data = await readFile(file);
  const issues = [];
  if (data.readUInt32LE(0) !== 0x46546c67) issues.push('GLB magic 错误');
  if (data.readUInt32LE(4) !== 2) issues.push('版本非 2');
  if (data.readUInt32LE(8) !== data.length) issues.push('总长度不匹配');

  let json = null, binLen = 0, off = 12;
  while (off < data.length) {
    const len = data.readUInt32LE(off);
    const type = data.readUInt32LE(off + 4);
    if (off + 8 + len > data.length) { issues.push(`chunk 越界 @${off}`); break; }
    if (type === 0x4e4f534a) json = JSON.parse(data.subarray(off + 8, off + 8 + len).toString('utf8').replace(/\0+$/, ''));
    if (type === 0x004e4942) binLen = len;
    off += 8 + len;
  }
  if (off !== data.length) issues.push('chunk 总长不齐');

  const vrm = json?.extensions?.VRM ?? json?.extensions?.VRMC_vrm;
  if (!vrm) issues.push('缺少 VRM 扩展');
  const webpCount = (json?.images ?? []).filter(i => i.mimeType === 'image/webp').length;
  const otherCount = (json?.images ?? []).length - webpCount;
  const meshCount = (json?.meshes ?? []).length;
  const accessorCount = (json?.accessors ?? []).length;
  const morphTargets = (json?.meshes ?? []).reduce((n, m) => n + (m.primitives ?? []).reduce((n2, p) => n2 + (p.targets ? p.targets.length : 0), 0), 0);

  // accessor 越界检查
  let oob = 0;
  for (const acc of json?.accessors ?? []) {
    if (acc.bufferView === undefined) continue;
    const view = json.bufferViews[acc.bufferView];
    const start = view.byteOffset ?? 0;
    if (start + view.byteLength > binLen) oob++;
  }
  if (oob > 0) issues.push(`${oob} 个 accessor 越界`);

  const ok = issues.length === 0;
  if (!ok) allOk = false;
  console.log(`${ok ? 'OK ' : 'FAIL'} ${file}`);
  console.log(`     VRM扩展:${vrm ? '有' : '无'} 网格:${meshCount} accessor:${accessorCount} 形变目标组:${morphTargets} 贴图 webp:${webpCount} 其他:${otherCount}${issues.length ? ' 问题:' + issues.join('; ') : ''}`);
}
process.exit(allOk ? 0 : 1);
