// ============================================================
// 系统状态路由：健康检查 + 监控统计
// - GET /api/health        基础健康检查（公开，含 DB 状态）
// - GET /api/system/status 完整系统状态（需教师权限）
// - GET /api/system/logs   最近日志统计（需教师权限）
// ============================================================
import { Router } from 'express';
import os from 'os';
import pool, { getDbStatus } from '../db.js';
import { authRequired, requireRole } from '../middleware/auth.js';
import { success, asyncHandler } from '../middleware/error.js';
import logger from '../utils/logger.js';
import { getRequestStats, resetRequestStats } from '../middleware/requestLogger.js';
import { getConcurrencyStats } from '../middleware/concurrency.js';

const router = Router();
const log = logger.module('SYSTEM');

// 启动时间戳
const START_TIME = Date.now();

// ========== 基础健康检查（公开，用于负载均衡/监控探针） ==========
router.get('/health', asyncHandler(async (req, res) => {
  const db = await getDbStatus();
  const uptime = Date.now() - START_TIME;

  // 健康状态：DB 连通即认为健康
  const healthy = db.connected;
  const status = healthy ? 'healthy' : 'degraded';

  return res.json({
    code: 0,
    message: 'ok',
    data: {
      status,
      healthy,
      uptime_seconds: Math.floor(uptime / 1000),
      uptime_human: formatUptime(uptime),
      timestamp: new Date().toISOString(),
      version: process.env.npm_package_version || '1.0.0',
      environment: process.env.NODE_ENV || 'development',
      database: {
        connected: db.connected,
        latency_ms: db.latency_ms,
      },
    },
  });
}));

// ========== 完整系统状态（教师权限） ==========
router.get('/status', authRequired, requireRole('teacher'), asyncHandler(async (req, res) => {
  const db = await getDbStatus();
  const mem = process.memoryUsage();
  const cpu = process.cpuUsage();
  const uptime = Date.now() - START_TIME;

  // 数据库表行数统计
  let tableStats = {};
  try {
    const [tables] = await pool.query(
      `SELECT table_name AS tbl, table_rows AS rows_count
       FROM information_schema.tables
       WHERE table_schema = DATABASE() AND table_name IN
       ('users','courses','course_members','chat_history','knowledge_chunks',
        'knowledge_review','assignments','submissions','exams','exam_attempts',
        'kg_entities','kg_relations','videos','drawings','attendance_records')`
    );
    tableStats = tables.reduce((acc, t) => {
      acc[t.tbl] = t.rows_count;
      return acc;
    }, {});
  } catch (err) {
    log.warn('获取表统计失败:', err.message);
  }

  return success(res, {
    server: {
      hostname: os.hostname(),
      platform: `${os.type()} ${os.release()}`,
      nodeVersion: process.version,
      arch: process.arch,
      uptime_seconds: Math.floor(uptime / 1000),
      uptime_human: formatUptime(uptime),
      started_at: new Date(START_TIME).toISOString(),
      pid: process.pid,
    },
    resources: {
      memory: {
        rss: formatBytes(mem.rss),
        heapUsed: formatBytes(mem.heapUsed),
        heapTotal: formatBytes(mem.heapTotal),
        external: formatBytes(mem.external),
        arrayBuffers: formatBytes(mem.arrayBuffers),
        rss_mb: Math.round(mem.rss / 1024 / 1024 * 100) / 100,
        heap_used_mb: Math.round(mem.heapUsed / 1024 / 1024 * 100) / 100,
        heap_total_mb: Math.round(mem.heapTotal / 1024 / 1024 * 100) / 100,
      },
      cpu: {
        user: cpu.user,
        system: cpu.system,
        user_ms: Math.round(cpu.user / 1000),
        system_ms: Math.round(cpu.system / 1000),
      },
      system: {
        loadAvg: os.loadavg(),
        cpuCores: os.cpus().length,
        totalMem: formatBytes(os.totalmem()),
        freeMem: formatBytes(os.freemem()),
        freeMemPct: (os.freemem() / os.totalmem() * 100).toFixed(1) + '%',
      },
    },
    database: db,
    tableStats,
    requests: getRequestStats(),
    // 各重量级接口的并发占用（4C4G 上用来判断是否接近过载）
    concurrency: getConcurrencyStats(),
    logs: logger.getStats(),
  });
}));

// ========== 日志统计（教师权限） ==========
router.get('/logs', authRequired, requireRole('teacher'), asyncHandler(async (req, res) => {
  const { reset } = req.query;
  const stats = logger.getStats();
  const requests = getRequestStats();

  if (reset === '1') {
    logger.resetStats();
    resetRequestStats();
    log.info('教师重置了日志统计');
    return success(res, { reset: true }, '统计已重置');
  }

  return success(res, {
    logs: {
      uptime: stats.uptime,
      uptime_human: formatUptime(stats.uptime),
      counts: stats.counts,
      errors: stats.errors,
      lastError: stats.lastError
        ? { ...stats.lastError, time_human: new Date(stats.lastError.time).toISOString() }
        : null,
    },
    requests,
  });
}));

// ========== 工具函数 ==========
function formatBytes(bytes) {
  if (bytes === 0) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return (bytes / Math.pow(k, i)).toFixed(2) + ' ' + sizes[i];
}

function formatUptime(ms) {
  const seconds = Math.floor(ms / 1000);
  const days = Math.floor(seconds / 86400);
  const hours = Math.floor((seconds % 86400) / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  const secs = seconds % 60;
  const parts = [];
  if (days > 0) parts.push(`${days}天`);
  if (hours > 0) parts.push(`${hours}小时`);
  if (minutes > 0) parts.push(`${minutes}分钟`);
  parts.push(`${secs}秒`);
  return parts.join(' ');
}

export default router;
