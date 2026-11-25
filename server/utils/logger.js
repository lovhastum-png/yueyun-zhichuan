// ============================================================
// 结构化彩色日志工具
// 用法：
//   import logger from '../utils/logger.js';
//   logger.info('消息', { extra: 'data' });
//   logger.error('失败', err);
//   logger.module('RAG').info('入库完成', { count: 5 });
// ============================================================

const COLORS = {
  reset: '\x1b[0m',
  // 级别色
  debug: '\x1b[90m',   // 灰
  info: '\x1b[36m',    // 青
  warn: '\x1b[33m',    // 黄
  error: '\x1b[31m',   // 红
  success: '\x1b[32m', // 绿
  // 模块色
  module: '\x1b[35m',  // 紫
  time: '\x1b[90m',    // 灰
  text: '\x1b[37m',    // 白
  dim: '\x1b[2m',      // 暗
};

// 日志级别权重
const LEVEL_WEIGHT = { debug: 10, info: 20, warn: 30, error: 40, success: 20 };

// 当前级别（受环境变量控制）
const CURRENT_LEVEL = LEVEL_WEIGHT[process.env.LOG_LEVEL?.toLowerCase()] ?? LEVEL_WEIGHT.info;

// 运行时统计
const stats = {
  startTime: Date.now(),
  counts: { debug: 0, info: 0, warn: 0, error: 0, success: 0 },
  requests: 0,
  errors: 0,
  lastError: null,
};

function pad(n, len = 2) { return String(n).padStart(len, '0'); }

function formatTime() {
  const d = new Date();
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}.${pad(d.getMilliseconds(), 3)}`;
}

function formatArgs(args) {
  return args.map(a => {
    if (a instanceof Error) {
      return `${a.message}\n${a.stack || ''}`;
    }
    if (typeof a === 'object' && a !== null) {
      try { return JSON.stringify(a); } catch { return String(a); }
    }
    return String(a);
  }).join(' ');
}

function log(level, module, args) {
  if (LEVEL_WEIGHT[level] < CURRENT_LEVEL) return;
  stats.counts[level]++;

  const time = formatTime();
  const levelTag = level.toUpperCase().padEnd(7);
  const moduleTag = module ? `[${module}]` : '';

  // 控制台彩色输出
  const color = COLORS[level] || COLORS.text;
  console.log(
    `${COLORS.time}${time}${COLORS.reset} ${color}${levelTag}${COLORS.reset} ${COLORS.module}${moduleTag}${COLORS.reset} ${color}${formatArgs(args)}${COLORS.reset}`
  );
}

// 创建带模块名的 logger
function createLogger(moduleName) {
  return {
    debug: (...args) => log('debug', moduleName, args),
    info: (...args) => log('info', moduleName, args),
    warn: (...args) => log('warn', moduleName, args),
    error: (...args) => { stats.errors++; stats.lastError = { time: Date.now(), message: formatArgs(args) }; log('error', moduleName, args); },
    success: (...args) => log('success', moduleName, args),
  };
}

// 默认 logger（无模块名）
const defaultLogger = {
  debug: (...args) => log('debug', '', args),
  info: (...args) => log('info', '', args),
  warn: (...args) => log('warn', '', args),
  error: (...args) => { stats.errors++; stats.lastError = { time: Date.now(), message: formatArgs(args) }; log('error', '', args); },
  success: (...args) => log('success', '', args),
  // 创建子 logger
  module: createLogger,
  // 获取统计
  getStats: () => ({
    ...stats,
    uptime: Date.now() - stats.startTime,
    counts: { ...stats.counts },
  }),
  // 重置统计
  resetStats: () => {
    stats.counts = { debug: 0, info: 0, warn: 0, error: 0, success: 0 };
    stats.requests = 0;
    stats.errors = 0;
    stats.lastError = null;
  },
};

export default defaultLogger;
