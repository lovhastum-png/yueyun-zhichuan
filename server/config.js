// 配置读取：从环境变量加载所有配置，统一出口
import dotenv from 'dotenv';
import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { fileURLToPath } from 'url';
dotenv.config();

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// ---------------------------------------------------------------------------
// JWT 密钥安全兜底
// 占位符密钥意味着任何人都能用公开字符串签出合法 token 伪造任意身份，
// 生产环境绝不能使用。这里采取「开箱即用」策略：检测到缺失或仍是占位符时，
// 自动生成一份随机密钥落盘到 data/.jwt-secret（已 gitignore），此后启动复用，
// 既堵住漏洞又不会因每次重启换密钥把所有用户踢下线。
// ---------------------------------------------------------------------------
const PLACEHOLDER_SECRETS = new Set([
  '',
  'dev_default_secret_change_me',
  'please_change_this_to_a_random_secret_key',
  'your_jwt_secret',
  'changeme',
  'secret',
]);

function resolveJwtSecret(raw) {
  const value = String(raw || '').trim();
  if (value && !PLACEHOLDER_SECRETS.has(value) && value.length >= 32) return value;

  const secretFile = path.join(__dirname, '..', 'data', '.jwt-secret');
  try {
    if (fs.existsSync(secretFile)) {
      const saved = fs.readFileSync(secretFile, 'utf8').trim();
      if (saved.length >= 32) return saved;
    }
    fs.mkdirSync(path.dirname(secretFile), { recursive: true });
    const generated = crypto.randomBytes(48).toString('base64url');
    fs.writeFileSync(secretFile, generated, { mode: 0o600 });
    console.warn(
      '[CONFIG] 检测到 JWT_SECRET 未配置或仍为占位符，已自动生成随机密钥并保存到 data/.jwt-secret。' +
      '原有登录状态将失效，请重新登录；如需自行管理请设置足够长的 JWT_SECRET 环境变量。'
    );
    return generated;
  } catch (err) {
    console.warn(`[CONFIG] 自动生成 JWT 密钥失败：${err?.message || err}，请手动配置 JWT_SECRET`);
    return 'dev_default_secret_change_me';
  }
}

const config = {
  port: parseInt(process.env.PORT || '3000', 10),
  nodeEnv: process.env.NODE_ENV || 'development',
  isDev: (process.env.NODE_ENV || 'development') === 'development',

  db: {
    host: process.env.DB_HOST || 'localhost',
    port: parseInt(process.env.DB_PORT || '3306', 10),
    user: process.env.DB_USER || 'root',
    password: process.env.DB_PASSWORD || 'REDACTED_CONFIGURE_IN_ENV',
    database: process.env.DB_NAME || 'yueyun_db',
    connectionLimit: Math.max(2, Math.min(20, parseInt(process.env.DB_POOL_SIZE || '6', 10) || 6)),
  },

  jwt: {
    secret: resolveJwtSecret(process.env.JWT_SECRET),
    expiresIn: process.env.JWT_EXPIRES || '7d',
  },

  // 讯飞星辰助手 Agent（WebSocket 接口，同时承担智能问答与生图）
  xingchenAgent: {
    // 新版星辰工作流 HTTP API（当前推荐接入方式）
    httpUrl: process.env.XINGCHEN_AGENT_API_URL || '',
    flowId: process.env.XINGCHEN_AGENT_FLOW_ID || 'REDACTED_CONFIGURE_IN_ENV',
    inputKey: process.env.XINGCHEN_AGENT_INPUT_KEY || 'AGENT_USER_INPUT',
    // 完整 wss 地址，例如 wss://spark-openapi.cn-huabei-1.xf-yun.com/v1/assistants/xxx_v1
    wsUrl: process.env.XINGCHEN_AGENT_WS_URL || '',
    apiKey: process.env.XINGCHEN_AGENT_API_KEY || 'REDACTED_CONFIGURE_IN_ENV',
    apiSecret: process.env.XINGCHEN_AGENT_API_SECRET || 'REDACTED_CONFIGURE_IN_ENV',
    appId: process.env.XINGCHEN_AGENT_APP_ID || 'REDACTED_CONFIGURE_IN_ENV',
    // 从 wsUrl 自动解析 host 与 path，用于鉴权签名
    get host() { return extractHost(this.wsUrl); },
    get path() { return extractPath(this.wsUrl); },
  },

  // Qwen3-ASR 音频识别（讯飞助手 Agent 不支持音频，仍用通义千问 ASR）
  qwenAsr: {
    url: process.env.QWEN_ASR_API_URL || 'https://dashscope.aliyuncs.com/api/v1/services/audio/asr/transcription',
    apiKey: process.env.QWEN_ASR_API_KEY || 'REDACTED_CONFIGURE_IN_ENV',
  },

  // ---------- AI 生图（丹青生图）多供应商配置 ----------
  // 默认硅基流动 SiliconFlow · Kolors；可经 IMAGE_GENERATION_PROVIDER 切换
  // siliconflow / iflytek / dashscope / openai(即 Pollinations)。
  // 注：SiliconFlow 虽 Kolors 按张免费，但要求账户余额 > 0 才放行任何调用；
  // 余额不足时本服务会自动回退到 openai(Pollinations) 兜底出图。
  imageGeneration: {
    provider: (process.env.IMAGE_GENERATION_PROVIDER || 'siliconflow').toLowerCase(),
    apiUrl: process.env.IMAGE_GENERATION_API_URL || 'https://api.siliconflow.cn/v1/images/generations',
    apiKey: process.env.IMAGE_GENERATION_API_KEY || 'REDACTED_CONFIGURE_IN_ENV',
    apiSecret: process.env.IMAGE_GENERATION_API_SECRET || 'REDACTED_CONFIGURE_IN_ENV',
    appId: process.env.IMAGE_GENERATION_APP_ID || 'REDACTED_CONFIGURE_IN_ENV',
    model: process.env.IMAGE_GENERATION_MODEL || 'Kwai-Kolors/Kolors',
  },

  // ---------- 妙笔润色（提示词增强）文字大模型配置 ----------
  // 固定走科大讯飞星火（与星辰 Agent 共用三件套 key/secret）。
  textLlm: {
    enable: (process.env.TEXT_LLM_ENABLE || 'true') !== 'false',
    provider: (process.env.TEXT_LLM_PROVIDER || 'iflytek').toLowerCase(),
    apiUrl: process.env.TEXT_LLM_API_URL || 'https://spark-api-open.xf-yun.com/v1/chat/completions',
    apiKey: process.env.TEXT_LLM_API_KEY || 'REDACTED_CONFIGURE_IN_ENV',
    apiSecret: process.env.TEXT_LLM_API_SECRET || 'REDACTED_CONFIGURE_IN_ENV',
    model: process.env.TEXT_LLM_MODEL || 'generalv3.5',
    useLocalYuejuLlm: (process.env.TEXT_LLM_USE_LOCAL_YUEJU || 'false') === 'true',
  },

  // CORS 允许的源。
  // 默认带上常见入口（本地/公网 IP/正式域名），避免换入口访问时
  // 字体、接口因 Origin 不在白名单而失败。线上可用 CORS_ORIGINS 覆盖。
  corsOrigins: (
    process.env.CORS_ORIGINS ||
    [
      'http://localhost:3000',
      'http://localhost:3100',
      'http://127.0.0.1:3000',
      'http://124.221.195.239',
      'http://124.221.195.239:8443',
      'https://124.221.195.239:8443',
      'http://yueyun.xiaoqingyalove.online',
      'https://yueyun.xiaoqingyalove.online',
      'http://xiaoqingyalove.online',
      'https://xiaoqingyalove.online',
    ].join(',')
  ).split(',').map(s => s.trim()).filter(Boolean),
};

// 从 wss://host/path?query 中解析 host
function extractHost(url) {
  if (!url) return '';
  const m = url.match(/^wss?:\/\/([^\/]+)/);
  return m ? m[1] : '';
}

// 从 wss://host/path?query 中解析 path（不含 query）
function extractPath(url) {
  if (!url) return '';
  const m = url.match(/^wss?:\/\/[^\/]+(\/[^?]*)/);
  return m ? m[1] : '';
}

export default config;
