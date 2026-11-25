// Cloudflare 边缘缓存清理
// ============================================================
// 部署新版本后，若仍有用户/边缘命中旧静态资源（旧版 JS/CSS 导致白屏等），
// 可运行本脚本清空指定 zone 的 Cloudflare 边缘缓存（cache purge all）。
//
// 前置条件：在 .env 中配置
//   CF_ZONE_ID=<你的域名 Zone ID>
//   CF_API_TOKEN=<有 Cache Purge 权限的 API Token>
// 查看位置：Cloudflare 控制台 -> 域名 -> 概览（Zone ID）；
// API Token 在 My Profile -> API Tokens，权限至少含 Zone.Cache Purge / Zone.Firewall Read。
//
// 未配置时不会误删任何内容，仅给出指引。
// 用法：npm run deploy:purge
// ============================================================
import { config as loadEnv } from 'dotenv';
loadEnv();

const ZONE_ID = process.env.CF_ZONE_ID;
const API_TOKEN = process.env.CF_API_TOKEN;

async function main() {
  if (!ZONE_ID || !API_TOKEN) {
    console.warn('未配置 CF_ZONE_ID / CF_API_TOKEN，跳过缓存清理。');
    console.warn('如需启用：在 .env 中加入上述两项后重试；或登录 Cloudflare 控制台手动执行 Purge Everything。');
    process.exit(0);
  }

  const url = `https://api.cloudflare.com/client/v4/zones/${ZONE_ID}/purge_cache`;
  console.log(`正在清空 zone ${ZONE_ID} 的 Cloudflare 边缘缓存...`);
  const resp = await fetch(url, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${API_TOKEN}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ purge_everything: true }),
  });
  const data = await resp.json();
  if (resp.ok && data.success) {
    console.log('✅ Cloudflare 边缘缓存已清空。');
  } else {
    console.error('❌ 清理失败:', Array.isArray(data.errors) ? JSON.stringify(data.errors) : data);
    process.exit(1);
  }
}

main().catch((e) => {
  console.error('❌ 执行出错:', e.message);
  process.exit(1);
});