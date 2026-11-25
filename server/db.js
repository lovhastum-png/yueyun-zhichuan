// MySQL 连接池
import mysql from 'mysql2/promise';
import config from './config.js';
import logger from './utils/logger.js';

const log = logger.module('DB');

const pool = mysql.createPool({
  host: config.db.host,
  port: config.db.port,
  user: config.db.user,
  password: config.db.password,
  database: config.db.database,
  waitForConnections: true,
  // 4G 单机默认 6 条连接足够；可通过 DB_POOL_SIZE 调整，避免连接缓存挤占内存。
  connectionLimit: config.db.connectionLimit,
  queueLimit: 0,
  charset: 'utf8mb4',
  // 连接保活与自动重连
  enableKeepAlive: true,
  keepAliveInitialDelay: 10000,
});

// 监听连接池错误，避免未捕获异常导致进程退出
pool.on('error', (err) => {
  log.error('MySQL 连接池错误:', err.message);
});

// 启动时测试连接
export async function testDbConnection() {
  try {
    const conn = await pool.getConnection();
    await conn.ping();
    conn.release();
    log.success('MySQL 连接成功');
  } catch (err) {
    log.error('MySQL 连接失败:', err.message);
    log.error('请确认 MySQL 已启动且配置正确，可执行 server/sql/init.sql 初始化数据库');
  }
}

// 获取连接池状态（用于健康检查）
export async function getDbStatus() {
  try {
    const start = Date.now();
    const conn = await pool.getConnection();
    await conn.ping();
    conn.release();
    const latency = Date.now() - start;
    return {
      connected: true,
      latency_ms: latency,
      host: config.db.host,
      database: config.db.database,
      poolSize: config.db.connectionLimit,
      // mysql2 pool 没有直接暴露空闲连接数，用 _freeConnections.length
      idleConnections: pool._freeConnections?.length ?? 0,
      usedConnections: (pool._allConnections?.length ?? 0) - (pool._freeConnections?.length ?? 0),
    };
  } catch (err) {
    return {
      connected: false,
      error: err.message,
      host: config.db.host,
      database: config.db.database,
    };
  }
}

export default pool;
