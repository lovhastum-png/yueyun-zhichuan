// 云端 AI API 健康监测（进程内滑动窗口）。
// 用途：云端 LLM（星火/星尘等）连续失败时，自动「唤醒」服务器上的越剧微调模型
// 兜底服务；平时模型服务保持睡眠，不占内存。
import config from '../config.js';

const WINDOW_MS = Number(process.env.API_HEALTH_WINDOW_MS || 10 * 60 * 1000); // 故障记忆窗口，默认 10 分钟
const FAILURE_THRESHOLD = Number(process.env.API_HEALTH_FAILURES || 2); // 窗口内失败 N 次判定为降级

// name → 最近失败时间戳数组
const failures = new Map();
// name → 最近成功时间戳
const lastSuccess = new Map();

function prune(name, now) {
  const arr = failures.get(name);
  if (!arr) return;
  while (arr.length && now - arr[0] > WINDOW_MS) arr.shift();
}

/**
 * 各云端 LLM 调用点在成功/失败时上报。
 * @param {'textLlm'|'xingchen'|'image'} name API 类别
 */
export function reportApiSuccess(name) {
  lastSuccess.set(name, Date.now());
  failures.delete(name);
}

export function reportApiFailure(name) {
  const now = Date.now();
  if (!failures.has(name)) failures.set(name, []);
  const arr = failures.get(name);
  prune(name, now);
  arr.push(now);
}

/**
 * 云端 API 是否处于故障/降级状态（窗口内失败次数达阈值即视为降级）
 */
export function isApiDegraded(name = 'textLlm') {
  const now = Date.now();
  prune(name, now);
  return (failures.get(name)?.length || 0) >= FAILURE_THRESHOLD;
}

/**
 * 观测用：/api/system/status 等接口可读取
 */
export function apiHealthStatus() {
  const now = Date.now();
  const out = {};
  for (const name of new Set([...failures.keys(), ...lastSuccess.keys()])) {
    prune(name, now);
    out[name] = {
      degraded: isApiDegraded(name),
      recentFailures: failures.get(name)?.length || 0,
      lastSuccessAt: lastSuccess.get(name) || null,
    };
  }
  return out;
}

// 配置可观测（避免每次调用读 env）
export const API_HEALTH_CONFIG = {
  windowMs: WINDOW_MS,
  failureThreshold: FAILURE_THRESHOLD,
  enabled: config.nodeEnv === 'production' || process.env.API_HEALTH_ENABLE === 'true',
};
