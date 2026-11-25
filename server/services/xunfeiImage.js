// 丹青生图 · 多供应商适配器（文件名 xunfeiImage 为历史遗留，无需在意）。
//
// 默认供应商：硅基流动 SiliconFlow · Kwai-Kolors/Kolors（中文训练，越剧适配最佳）。
// 另支持 iflytek（讯飞图片生成/HiDream）、dashscope（通义万相）、openai（即 Pollinations 兜底）。
// 切换方式：.env 的 IMAGE_GENERATION_PROVIDER=siliconflow|iflytek|dashscope|openai。
//
// 关键：Kolors 由 buildYuejuImagePrompt 构建越剧专属提示词（风格前置+行当/流派/服饰/场景+反向词），
// 再交给扩散模型；若 Kolors 因余额不足（SiliconFlow 要求余额>0 才放行任何调用）或调用失败，
// 自动回退到 openai(Pollinations) 兜底出图，保证页面不“开天窗”。
import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { fileURLToPath } from 'url';
import config from '../config.js';
import { buildYuejuImagePrompt } from './yuejuImagePrompt.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const UPLOADS_DIR = path.join(__dirname, '..', '..', 'public', 'uploads');

if (!fs.existsSync(UPLOADS_DIR)) {
  fs.mkdirSync(UPLOADS_DIR, { recursive: true });
}

function newFileName(ext) {
  return `art_${Date.now()}_${Math.floor(Math.random() * 10000)}.${ext}`;
}

// 把二进制图片写入本地 uploads，返回前端可访问的相对 URL
async function saveImageBuffer(buffer, ext = 'png') {
  if (!buffer || buffer.length < 5000) throw new Error('图片数据过小，可能为错误响应');
  const fileName = newFileName(ext);
  fs.writeFileSync(path.join(UPLOADS_DIR, fileName), buffer);
  return `/uploads/${fileName}`;
}

// 下载远程图片到本地（带重试）；Pollinations / SiliconFlow CDN 返回的 url 用此函数落地
async function fetchToLocal(remoteUrl, ext = 'jpg', maxRetry = 3) {
  for (let attempt = 1; attempt <= maxRetry; attempt++) {
    try {
      const resp = await fetch(remoteUrl, {
        signal: AbortSignal.timeout(45000),
        headers: { 'User-Agent': 'Mozilla/5.0 YueYunZhiChuan/1.0' },
      });
      if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
      const contentType = resp.headers.get('content-type') || 'image/jpeg';
      const realExt = contentType.includes('png') ? 'png' : contentType.includes('webp') ? 'webp' : 'jpg';
      const buffer = Buffer.from(await resp.arrayBuffer());
      return await saveImageBuffer(buffer, realExt);
    } catch (e) {
      if (attempt === maxRetry) throw new Error(`图片下载失败（重试 ${maxRetry} 次）：${e.message}`);
      await new Promise(r => setTimeout(r, 1500 * attempt));
    }
  }
}

// 解析供应商返回的图片：支持 { images: [...] } 或 { data: [...] }，每项含 url 或 b64_json
async function resolveImageFromResponse(data) {
  const list = data?.images || data?.data || [];
  const item = list[0];
  if (!item) return null;
  if (item.b64_json) {
    const ext = item.b64_json.startsWith('/9j/') ? 'jpg' : 'png';
    return await saveImageBuffer(Buffer.from(item.b64_json, 'base64'), ext);
  }
  if (item.url) return await fetchToLocal(item.url);
  return null;
}

// ---------------- 各供应商实现 ----------------

// 硅基流动 SiliconFlow · Kolors（默认）
async function genSiliconflow(built) {
  const { apiUrl, apiKey, model } = config.imageGeneration;
  if (!apiKey) throw new Error('未配置 SiliconFlow 密钥');
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 60000);
  try {
    const resp = await fetch(apiUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
      body: JSON.stringify({
        model: model || 'Kwai-Kolors/Kolors',
        prompt: built.finalPrompt,
        negative_prompt: built.negativePrompt,
        image_size: `${built.width}x${built.height}`,
        batch_size: 1,
      }),
      signal: controller.signal,
    });
    if (!resp.ok) {
      const detail = await resp.text().catch(() => '');
      throw new Error(`SiliconFlow 返回 ${resp.status}${detail ? `：${detail.slice(0, 200)}` : ''}`);
    }
    const url = await resolveImageFromResponse(await resp.json());
    if (!url) throw new Error('SiliconFlow 返回中没有可用图片');
    return url;
  } finally {
    clearTimeout(timer);
  }
}

// 科大讯飞图片生成（tti v2.1），需要 appId 开通服务
async function genIflytek(built) {
  const { apiUrl, apiKey, apiSecret, appId } = config.imageGeneration;
  if (!apiKey || !apiSecret || !appId) throw new Error('未完整配置讯飞图片生成（需 apiKey/apiSecret/appId）');

  const target = new URL(apiUrl);
  const date = new Date().toUTCString();
  const signatureOrigin = `host: ${target.host}\ndate: ${date}\nGET ${target.pathname} HTTP/1.1`;
  const signature = crypto.createHmac('sha256', apiSecret).update(signatureOrigin).digest('base64');
  const authorization = `api_key="${apiKey}", algorithm="hmac-sha256", headers="host date request-line", signature="${signature}"`;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 60000);
  try {
    const resp = await fetch(apiUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: authorization, Date: date },
      body: JSON.stringify({
        header: { app_id: appId, uid: 'yueyun' },
        parameter: { tti: { width: built.width, height: built.height, image_num: 1 } },
        payload: {
          input: { prompt: built.finalPrompt, negative_prompt: built.negativePrompt },
          output: { encoding: 'jpg' },
        },
      }),
      signal: controller.signal,
    });
    if (!resp.ok) {
      const detail = await resp.text().catch(() => '');
      throw new Error(`讯飞图片生成返回 ${resp.status}${detail ? `：${detail.slice(0, 200)}` : ''}`);
    }
    const data = await resp.json();
    const url = await resolveImageFromResponse(data);
    if (!url) throw new Error('讯飞图片生成返回中没有可用图片');
    return url;
  } finally {
    clearTimeout(timer);
  }
}

// 通义万相 wanx2.1-t2i-turbo（异步任务，需要轮询）
async function genDashscope(built) {
  const { apiUrl, apiKey, model } = config.imageGeneration;
  if (!apiKey) throw new Error('未配置通义万相密钥');
  const submit = await fetch(apiUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}`, 'X-DashScope-Async': 'enable' },
    body: JSON.stringify({
      model: model || 'wanx2.1-t2i-turbo',
      input: { prompt: built.finalPrompt, negative_prompt: built.negativePrompt },
      parameters: { size: `${built.width}*${built.height}`, n: 1 },
    }),
  });
  if (!submit.ok) {
    const detail = await submit.text().catch(() => '');
    throw new Error(`通义万相提交返回 ${submit.status}${detail ? `：${detail.slice(0, 200)}` : ''}`);
  }
  const task = await submit.json();
  const taskId = task?.output?.task_id || task?.task_id;
  if (!taskId) throw new Error('通义万相未返回任务 ID');

  const statusUrl = `https://dashscope.aliyuncs.com/api/v1/tasks/${taskId}`;
  for (let i = 0; i < 30; i++) {
    await new Promise(r => setTimeout(r, 2000));
    const st = await fetch(statusUrl, { headers: { Authorization: `Bearer ${apiKey}` } });
    if (!st.ok) continue;
    const sd = await st.json();
    const status = sd?.output?.task_status || sd?.task_status;
    if (status === 'SUCCEEDED' || status === 'succeeded') {
      const resultUrl = sd?.output?.results?.[0]?.url || sd?.output?.image_url;
      if (!resultUrl) throw new Error('通义万相完成但未返回图片地址');
      return await fetchToLocal(resultUrl);
    }
    if (status === 'FAILED' || status === 'failed') {
      throw new Error(`通义万相任务失败：${sd?.output?.message || sd?.message || ''}`);
    }
  }
  throw new Error('通义万相任务轮询超时');
}

// openai / Pollinations 兜底（无需密钥，海外服务，国内部署可能受限）
async function genPollinations(built) {
  const seed = Math.floor(Math.random() * 1000000);
  const remoteUrl = `https://image.pollinations.ai/prompt/${encodeURIComponent(built.finalPrompt)}`
    + `?width=${built.width}&height=${built.height}&seed=${seed}&nologo=true&model=flux`;
  return await fetchToLocal(remoteUrl);
}

const PROVIDERS = {
  siliconflow: genSiliconflow,
  iflytek: genIflytek,
  dashscope: genDashscope,
  openai: genPollinations,
  pollinations: genPollinations,
};

/**
 * 生成越剧主题图片。
 * @param {object} input { prompt, style, role, school?, costume?, play?, scene?, composition?, aspectRatio?, seed? }
 * @returns {Promise<{imageUrl:string, finalPrompt:string, negativePrompt:string, provider:string, fallback:boolean, fallbackReason?:string}>}
 */
export async function generateImage(input = {}) {
  const built = buildYuejuImagePrompt(input);
  const provider = config.imageGeneration.provider;
  const dispatch = PROVIDERS[provider] || genSiliconflow;

  try {
    const imageUrl = await dispatch(built);
    return {
      imageUrl,
      finalPrompt: built.finalPrompt,
      negativePrompt: built.negativePrompt,
      provider,
      fallback: false,
    };
  } catch (err) {
    // Kolors/主供应商失败时，自动回退到 Pollinations 兜底（除非本来就用它）
    if (provider !== 'openai' && provider !== 'pollinations') {
      try {
        const imageUrl = await genPollinations(built);
        return {
          imageUrl,
          finalPrompt: built.finalPrompt,
          negativePrompt: built.negativePrompt,
          provider: 'openai',
          fallback: true,
          fallbackReason: err.message || String(err),
        };
      } catch {
        // 回退也失败，抛出原始错误
        throw err;
      }
    }
    throw err;
  }
}

export default { generateImage };
