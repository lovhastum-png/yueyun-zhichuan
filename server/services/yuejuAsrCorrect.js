// 越剧 ASR 术语纠错：分层管线（4G 内存友好）
//   第 1 层：规则纠错（常驻，词表替换，零内存开销）—— 方案A，平时走这里
//   第 2 层：本地微调模型（Qwen2.5-0.5B + LoRA sidecar，端口 3456）
//           平时保持睡眠；仅当云端 AI API 故障降级且规则层没兜住时按需唤醒，
//           systemd 单元带 MemoryMax + RuntimeMaxSec（用完自动睡眠回内存）。
// 模型服务：models/yueju_asr_correct/serve.py --low-mem（部署见 deploy/4c4g/install-yueju-correct.sh）
import { execFile } from 'child_process';
import { correctWithRules } from './yuejuRuleCorrect.js';
import { isApiDegraded } from './apiHealth.js';

const CORRECT_SERVICE_URL = process.env.YUEJU_CORRECT_URL || 'http://127.0.0.1:3456';
const COLD_TIMEOUT_MS = Number(process.env.YUEJU_CORRECT_TIMEOUT_MS || 90 * 1000); // 冷启动加载模型需 10-30s
const MODEL_START_CMD = process.env.YUEJU_CORRECT_START_CMD || 'sudo -n /bin/systemctl start yueju-correct.service';

let startingModel = null; // 并发去重：同一时刻只尝试拉起一次

async function ensureModelService() {
  if (startingModel) return startingModel;
  startingModel = (async () => {
    // 先探测：可能已经在跑
    if (await isCorrectServiceHealthy()) return true;
    const [cmd, ...args] = MODEL_START_CMD.split(' ').filter(Boolean);
    await new Promise((resolve) => {
      execFile(cmd, args, { timeout: 15 * 1000 }, (err) => {
        if (err) console.warn('[yuejuAsrCorrect] 拉起模型服务失败（未配置 sudoers 或非生产环境）:', err.message);
        resolve();
      });
    });
    // 轮询等健康（模型加载 10-30 秒）
    for (let i = 0; i < 18; i++) {
      await new Promise((r) => setTimeout(r, 5000));
      if (await isCorrectServiceHealthy()) return true;
    }
    return false;
  })().finally(() => {
    // 保留结果 60s 后允许下次重试
    setTimeout(() => { startingModel = null; }, 60 * 1000);
  });
  return startingModel;
}

async function correctWithModel(text) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), COLD_TIMEOUT_MS);
  try {
    const resp = await fetch(`${CORRECT_SERVICE_URL}/correct`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text: text.trim() }),
      signal: controller.signal,
    });
    if (!resp.ok) {
      console.warn('[yuejuAsrCorrect] 模型服务返回非 200:', resp.status);
      return null;
    }
    const data = await resp.json();
    return typeof data.corrected === 'string' ? data.corrected : null;
  } catch (err) {
    console.warn('[yuejuAsrCorrect] 模型服务调用失败:', err.message);
    return null;
  } finally {
    clearTimeout(timeout);
  }
}

/**
 * 对 ASR 识别后的文本进行越剧术语纠错（分层）
 * @param {string} text ASR 原始文本
 * @returns {Promise<string>} 纠错后的文本（全部层不可用时原样返回）
 */
export async function correctYuejuTerms(text) {
  if (!text || !text.trim()) return text;

  // 第 1 层：规则纠错（词表来自微调训练数据，覆盖流派/名家/剧目/唱段/唱腔/表演/历史）
  const rule = correctWithRules(text);
  if (rule.changed) return rule.text;

  // 第 2 层：仅当云端 API 故障降级时，才唤醒本地微调模型兜底
  const force = process.env.YUEJU_CORRECT_FORCE === 'true';
  if (!force && !isApiDegraded('textLlm')) return text;

  const started = await ensureModelService();
  if (!started) return text;
  const corrected = await correctWithModel(text);
  return corrected ?? text;
}

/**
 * 检查本地纠错模型服务是否健康（运行中且模型已加载）
 */
export async function isCorrectServiceHealthy() {
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 2000);
    const resp = await fetch(`${CORRECT_SERVICE_URL}/health`, { signal: controller.signal });
    clearTimeout(timeout);
    if (!resp.ok) return false;
    const data = await resp.json();
    return data.model_loaded === true;
  } catch {
    return false;
  }
}
