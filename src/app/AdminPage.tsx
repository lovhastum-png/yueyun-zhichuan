import { useCallback, useEffect, useState, type ReactNode } from 'react';
import { request } from '../shared/api';
import { getUser } from '../shared/auth';
import { CountUp } from '../shared/CountUp';
import { toast } from '../shared/toast';
import { Modal } from '../shared/modal';
import { EmptyState } from '../shared/EmptyState';
import './admin.css';

/** /system/status 返回的系统状态（字段与后端一致，含 snake_case 混合命名） */
interface SystemStatus {
  server: {
    uptime_human: string;
    hostname: string;
    platform: string;
    nodeVersion: string;
    arch: string;
    pid: number;
    started_at: string;
  };
  database: {
    connected: boolean;
    latency_ms?: number;
    usedConnections?: number;
    poolSize?: number;
    error?: string;
  };
  resources: {
    memory: { heap_used_mb: number; heap_total_mb: number; heapUsed: number; heapTotal: number; rss: number };
    system: { cpuCores: number; loadAvg: number[]; totalMem: string; freeMem: string; freeMemPct: string };
    cpu: { user_ms: number; system_ms: number };
  };
  requests: {
    total: number;
    success: number;
    clientError: number;
    serverError: number;
    avgDuration: number;
    errorRate: string;
    maxDuration: number;
    slowRequests: number;
    topPaths?: Array<{ path: string; count: number; avgDuration: number; errors: number }>;
  };
  tableStats?: Record<string, number>;
  logs: {
    counts?: Record<string, number>;
    uptime_human: string;
    errors: number;
    lastError?: { time_human: string; message: string } | null;
  };
}

const LOG_LEVELS = ['debug', 'info', 'warn', 'error', 'success'] as const;

function truncate(str: string, len: number): string {
  if (!str) return '';
  return str.length > len ? str.slice(0, len) + '...' : str;
}

// 系统监控面板：服务器状态 / 资源占用 / 请求与日志统计，
// 交互与旧版 admin.js 一致（10 秒自动刷新、手动刷新、重置统计）
export function AdminPage() {
  const user = getUser();
  const isTeacher = user?.role === 'teacher';
  const [status, setStatus] = useState<SystemStatus | null>(null);
  const [lastUpdate, setLastUpdate] = useState('');
  const [autoRefresh, setAutoRefresh] = useState(true);
  const [showReset, setShowReset] = useState(false);

  useEffect(() => {
    document.title = '越韵智传 · 系统监控';
  }, []);

  // 教师角色守卫：与旧版 requireRole('teacher') 对应，改为 toast + 不渲染内容
  useEffect(() => {
    if (!isTeacher) toast(user ? '仅教师可访问系统监控' : '请先登录后使用此功能', 'err');
    // eslint-disable-next-line react-hooks/exhaustive-deps -- user 取自首帧即可，角色会话内不变
  }, [isTeacher]);

  const loadStatus = useCallback(async () => {
    const res = await request<SystemStatus>('/system/status');
    if (res.code !== 0 || !res.data) {
      toast(res.message || '加载失败', 'err');
      return;
    }
    setStatus(res.data);
    setLastUpdate('更新于 ' + new Date().toLocaleTimeString('zh-CN'));
  }, []);

  useEffect(() => {
    if (!isTeacher) return;
    loadStatus();
  }, [isTeacher, loadStatus]);

  // 自动刷新（10 秒），取消勾选或卸载时停止
  useEffect(() => {
    if (!isTeacher || !autoRefresh) return;
    const timer = setInterval(loadStatus, 10000);
    return () => clearInterval(timer);
  }, [isTeacher, autoRefresh, loadStatus]);

  const resetStats = async () => {
    const res = await request('/system/logs?reset=1');
    if (res.code === 0) {
      toast('统计已重置', 'ok');
      setShowReset(false);
      loadStatus();
    } else {
      toast(res.message || '重置失败', 'err');
    }
  };

  if (!isTeacher) {
    return (
      <>
        <main className="main">
          <div className="container" style={{ paddingTop: 8 }}>
            <EmptyState icon="台" text={user ? '仅教师可访问系统监控' : '请先登录后使用此功能'} />
          </div>
        </main>
      </>
    );
  }

  const d = status;

  // 内存占用百分比与进度条配色
  const memPct =
    d && d.resources.memory.heap_total_mb > 0
      ? (d.resources.memory.heap_used_mb / d.resources.memory.heap_total_mb) * 100
      : 0;
  const memBarCls = `progress-fill${memPct > 80 ? ' err' : memPct > 60 ? ' warn' : ''}`;
  const dbOk = d?.database.connected ?? false;

  const tables = d
    ? Object.entries(d.tableStats || {}).sort((a, b) => b[1] - a[1])
    : [];
  const topPaths = d?.requests.topPaths || [];
  const logCounts = d?.logs.counts || {};

  return (
    <>
      <main className="main">
        <div className="container" style={{ paddingTop: 8 }}>
          <section className="page-hero">
            <div className="ink-wash ink-wash-1" style={{ background: 'var(--cyan)' }} />
            <div className="ink-wash ink-wash-2" style={{ background: 'var(--ink)' }} />
            <div className="hero-seal">
              <span className="seal seal-vertical">监控</span>
            </div>
            <h1>系统监控</h1>
          </section>

          <div className="refresh-bar">
            <div className="auto-refresh">
              <input
                type="checkbox"
                id="adminAutoRefresh"
                checked={autoRefresh}
                onChange={(e) => setAutoRefresh(e.target.checked)}
              />
              <label htmlFor="adminAutoRefresh">自动刷新（10秒）</label>
              <span style={{ marginLeft: 8, color: 'var(--ink-light)' }}>{lastUpdate}</span>
            </div>
            <div>
              <button className="admin-btn" onClick={loadStatus}>
                立即刷新
              </button>
              <button className="admin-btn" onClick={() => setShowReset(true)}>
                重置统计
              </button>
            </div>
          </div>

          {/* 核心指标 */}
          <div className="admin-grid">
            <div className="admin-card ok">
              <div className="admin-label">服务状态</div>
              <div className="admin-value">
                <span className={`status-dot ${dbOk ? 'ok' : 'err'}`} />
                {dbOk ? '运行中' : '异常'}
              </div>
              <div className="admin-sub">运行时长 {d?.server.uptime_human ?? '-'}</div>
            </div>
            <div className="admin-card ok">
              <div className="admin-label">数据库</div>
              <div className="admin-value">
                <span className={`status-dot ${dbOk ? 'ok' : 'err'}`} />
                {dbOk ? '正常' : '断开'}
              </div>
              <div className="admin-sub">
                {dbOk
                  ? `延迟 ${d?.database.latency_ms}ms · 已用 ${d?.database.usedConnections}/${d?.database.poolSize}`
                  : d?.database.error || '连接失败'}
              </div>
            </div>
            <div className="admin-card">
              <div className="admin-label">内存占用</div>
              <div className="admin-value">{d ? <><CountUp value={d.resources.memory.heap_used_mb} /> MB</> : '-'}</div>
              <div className="admin-sub">
                {d ? `堆 ${d.resources.memory.heapUsed} / ${d.resources.memory.heapTotal} · RSS ${d.resources.memory.rss}` : '-'}
              </div>
              <div className="progress-bar">
                <div className={memBarCls} style={{ width: `${Math.min(100, memPct)}%` }} />
              </div>
            </div>
            <div className="admin-card">
              <div className="admin-label">请求总数</div>
              <div className="admin-value">{d ? <CountUp value={d.requests.total} /> : '-'}</div>
              <div className="admin-sub">
                {d
                  ? `成功 ${d.requests.success} · 错误 ${d.requests.clientError + d.requests.serverError} · 平均 ${d.requests.avgDuration}ms`
                  : '-'}
              </div>
            </div>
          </div>

          {/* 服务器信息 */}
          <div className="admin-section">
            <div className="admin-section-title">服务器信息</div>
            <div className="kv-grid">
              {d &&
                kvRows([
                  ['主机名', d.server.hostname],
                  ['操作系统', d.server.platform],
                  ['Node 版本', d.server.nodeVersion],
                  ['架构', d.server.arch],
                  ['进程 PID', d.server.pid],
                  ['启动时间', d.server.started_at.replace('T', ' ').split('.')[0]],
                  ['CPU 核心', d.resources.system.cpuCores],
                  ['系统负载', d.resources.system.loadAvg.map((l) => l.toFixed(2)).join(' / ')],
                  ['总内存', d.resources.system.totalMem],
                  ['可用内存', `${d.resources.system.freeMem} (${d.resources.system.freeMemPct})`],
                  ['CPU 用户态', `${d.resources.cpu.user_ms} ms`],
                  ['CPU 内核态', `${d.resources.cpu.system_ms} ms`],
                ])}
            </div>
          </div>

          {/* 数据库统计 */}
          <div className="admin-section">
            <div className="admin-section-title">数据库表统计</div>
            <table className="table-list">
              <thead>
                <tr>
                  <th>表名</th>
                  <th>行数</th>
                </tr>
              </thead>
              <tbody>
                {tables.length === 0 ? (
                  <tr>
                    <td colSpan={2} style={{ textAlign: 'center', color: 'var(--ink-light)' }}>
                      暂无数据
                    </td>
                  </tr>
                ) : (
                  tables.map(([name, count]) => (
                    <tr key={name}>
                      <td>{name}</td>
                      <td>{count}</td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>

          {/* 请求统计 */}
          <div className="admin-section">
            <div className="admin-section-title">HTTP 请求统计</div>
            <div className="kv-grid">
              {d &&
                kvRows([
                  ['总请求数', d.requests.total],
                  ['成功请求', d.requests.success],
                  ['客户端错误 4xx', d.requests.clientError],
                  ['服务端错误 5xx', d.requests.serverError],
                  ['错误率', d.requests.errorRate],
                  ['平均响应时间', `${d.requests.avgDuration} ms`],
                  ['最大响应时间', `${d.requests.maxDuration} ms`],
                  ['慢请求数', `${d.requests.slowRequests} (≥2s)`],
                ])}
            </div>
            <h4 style={{ margin: '16px 0 8px', fontSize: 12, color: 'var(--ink-light)', letterSpacing: 2, fontFamily: 'var(--font-kai)' }}>
              热门路径 TOP 15
            </h4>
            <table className="table-list">
              <thead>
                <tr>
                  <th>路径</th>
                  <th>请求次数</th>
                  <th>平均耗时</th>
                  <th>错误数</th>
                </tr>
              </thead>
              <tbody>
                {topPaths.length === 0 ? (
                  <tr>
                    <td colSpan={4} style={{ textAlign: 'center', color: 'var(--ink-light)' }}>
                      暂无数据
                    </td>
                  </tr>
                ) : (
                  topPaths.map((p) => (
                    <tr key={p.path}>
                      <td>{p.path}</td>
                      <td>{p.count}</td>
                      <td>{p.avgDuration} ms</td>
                      <td style={{ color: p.errors > 0 ? 'var(--cinnabar)' : 'var(--ink-light)' }}>{p.errors}</td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>

          {/* 日志统计 */}
          <div className="admin-section">
            <div className="admin-section-title">日志统计</div>
            <div className="log-counts">
              {LOG_LEVELS.map((lvl) => (
                <div className={`log-count-card ${lvl}`} key={lvl}>
                  <div className="lvl">{lvl.toUpperCase()}</div>
                  <div className="cnt">{logCounts[lvl] || 0}</div>
                </div>
              ))}
            </div>
            <div className="kv-grid">
              {d &&
                kvRows([
                  ['日志运行时长', d.logs.uptime_human],
                  ['总错误数', d.logs.errors],
                  ['最后错误时间', d.logs.lastError ? d.logs.lastError.time_human : '无'],
                  ['最后错误内容', d.logs.lastError ? truncate(d.logs.lastError.message, 80) : '无'],
                ])}
            </div>
          </div>
        </div>
      </main>

      {/* 重置统计确认弹窗（旧版原生 confirm 改用共享 Modal） */}
      {showReset && (
        <Modal
          title="重置统计"
          onClose={() => setShowReset(false)}
          actions={
            <button className="btn btn-primary" onClick={resetStats}>
              确认重置
            </button>
          }
        >
          <p>确定重置所有统计？</p>
        </Modal>
      )}
    </>
  );
}

/** 键值对行组：与旧版 kv() 输出结构一致 */
function kvRows(rows: Array<[string, ReactNode]>): ReactNode {
  return rows.map(([key, val]) => (
    <div className="kv-item" key={key}>
      <span className="kv-key">{key}</span>
      <span className="kv-val">{val ?? '-'}</span>
    </div>
  ));
}
