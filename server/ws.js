// WebSocket 实时通讯服务
// - 聊天室：客户端鉴权后广播消息给所有在线用户
// - 课程通知：路由层调用 broadcastNotice() 推送作业/签到等通知
// - 身段测评：/pose-ws 透明代理到本机 pose-eval sidecar 的 /ws/pose-v2，
//   让公网隧道（Cloudflare）场景也能用实时比对（sidecar 只绑 127.0.0.1）
import { WebSocketServer, WebSocket } from 'ws';
import jwt from 'jsonwebtoken';
import config from './config.js';
import pool from './db.js';

let wss = null;
let poseWss = null;

// pose-eval sidecar 地址（仅本机回环）
const POSE_EVAL_WS_URL = process.env.POSE_EVAL_WS_URL || 'ws://127.0.0.1:8767/ws/pose-v2';

// 初始化 WebSocket 服务，挂载到同一 HTTP server
export function initWebSocket(server) {
  // 两个服务都用 noServer 模式：ws 库多实例直接挂 server 时，
  // 先注册的实例会对不匹配路径 abortHandshake(400)，导致其他路径全部握手失败
  wss = new WebSocketServer({ noServer: true });
  poseWss = new WebSocketServer({ noServer: true });

  // 唯一的 upgrade 入口，按路径分发
  server.on('upgrade', (req, socket, head) => {
    const { pathname } = new URL(req.url, 'http://localhost');
    if (pathname === '/ws') {
      wss.handleUpgrade(req, socket, head, (ws) => wss.emit('connection', ws, req));
    } else if (pathname === '/pose-ws') {
      poseWss.handleUpgrade(req, socket, head, (ws) => poseWss.emit('connection', ws, req));
    } else {
      socket.destroy();
    }
  });

  wss.on('connection', async (ws, req) => {
    // 从 query 解析 token: /ws?token=xxx
    const url = new URL(req.url, 'http://localhost');
    const token = url.searchParams.get('token');

    let user = null;
    if (token) {
      try {
        const payload = jwt.verify(token, config.jwt.secret);
        user = { id: payload.id, username: payload.username, role: payload.role };
      } catch {
        ws.send(JSON.stringify({ type: 'error', message: '认证失败，请重新登录' }));
        ws.close();
        return;
      }
    }

    if (!user) {
      ws.send(JSON.stringify({ type: 'error', message: '未提供认证令牌' }));
      ws.close();
      return;
    }

    ws.user = user;
    console.log(`[WS] ${user.username} 已连接，当前在线 ${wss.clients.size} 人`);

    // 上线广播
    broadcast({
      type: 'presence',
      online: wss.clients.size,
      username: user.username,
      action: 'join',
    });

    // 推送历史消息（最近 50 条）
    try {
      const [rows] = await pool.query(
        'SELECT cm.id, cm.content, cm.created_at, u.username, u.role FROM chat_messages cm JOIN users u ON cm.user_id = u.id WHERE cm.room = \'hall\' ORDER BY cm.id DESC LIMIT 50'
      );
      ws.send(JSON.stringify({
        type: 'history',
        messages: rows.reverse().map(r => ({
          id: r.id, username: r.username, role: r.role, content: r.content, createdAt: r.created_at
        })),
      }));
    } catch (e) {
      console.error('[WS] 历史消息查询失败:', e.message);
    }

    ws.on('message', async (raw) => {
      let msg;
      try { msg = JSON.parse(raw.toString()); } catch { return; }
      if (msg.type !== 'chat' || !msg.content) return;

      const content = String(msg.content).trim().slice(0, 1000);
      if (!content) return;

      // 持久化
      try {
        await pool.query('INSERT INTO chat_messages (user_id, room, content) VALUES (?, \'hall\', ?)', [user.id, content]);
      } catch (e) {
        console.error('[WS] 消息持久化失败:', e.message);
      }

      // 广播
      broadcast({
        type: 'chat',
        id: Date.now(),
        username: user.username,
        role: user.role,
        content,
        createdAt: new Date().toISOString(),
      });
    });

    ws.on('close', () => {
      console.log(`[WS] ${user.username} 已断开，当前在线 ${wss.clients.size} 人`);
      broadcast({
        type: 'presence',
        online: wss.clients.size,
        username: user.username,
        action: 'leave',
      });
    });
  });

  console.log('[WS] WebSocket 服务已挂载到 /ws');
  initPoseProxy();
  startHeartbeat();

  // 交给 server.js 用于优雅退出时关闭长连接
  return { wss, poseWss };
}

// 心跳保活：手机切后台、隧道抖动会造成「半开连接」——TCP 没断，但 close 事件永远不触发。
// 这类僵尸连接会让 wss.clients.size 虚高、每次广播都白写一遍（4C4G 上内存与 CPU 都会被慢慢吃掉）。
// 这里每 30 秒 ping 一次，上一轮没回 pong 的直接终止；定时器 unref 不阻塞进程退出。
function startHeartbeat() {
  const timer = setInterval(() => {
    for (const ws of wss.clients) {
      if (ws.isAlive === false) {
        ws.terminate();
        continue;
      }
      ws.isAlive = false;
      try { ws.ping(); } catch { /* 连接已坏，等下一轮 terminate */ }
    }
    for (const ws of poseWss.clients) {
      if (ws.isAlive === false) {
        ws.terminate();
        continue;
      }
      ws.isAlive = false;
      try { ws.ping(); } catch { /* 同上 */ }
    }
  }, 30_000);
  timer.unref();

  const markAlive = (ws) => {
    ws.isAlive = true;
    ws.on('pong', () => { ws.isAlive = true; });
  };
  wss.on('connection', markAlive);
  poseWss.on('connection', markAlive);
}

// 身段测评 WebSocket 代理：客户端(带 token) <-> 本机 pose-eval sidecar
// （实例与 upgrade 分发见 initWebSocket，此处只注册连接处理）
function initPoseProxy() {
  // 4C4G 上 pose-eval sidecar 是单 worker 且吃 CPU 做姿态推理，
  // 同时开太多实时会话会让 Node 与 Python 一起卡住，这里硬性限流。
  const MAX_POSE_SESSIONS = Math.max(1, parseInt(process.env.POSE_EVAL_MAX_SESSIONS || '3', 10) || 3);
  let poseSessions = 0;

  poseWss.on('connection', (client, req) => {
    // 与聊天室相同的 JWT 校验：query 中携带 token
    const url = new URL(req.url, 'http://localhost');
    const token = url.searchParams.get('token');
    let user = null;
    if (token) {
      try {
        const payload = jwt.verify(token, config.jwt.secret);
        user = { id: payload.id, username: payload.username, role: payload.role };
      } catch { /* 无效 token 按未登录处理 */ }
    }
    if (!user) {
      client.close(4001, '未登录或登录已过期');
      return;
    }

    // 超过并发上限：明确告知原因，前端可提示「当前测评人数已满，请稍后再试」
    if (poseSessions >= MAX_POSE_SESSIONS) {
      client.close(4029, '当前身段测评人数已满，请稍后再试');
      return;
    }
    poseSessions += 1;
    let sessionCounted = true;
    const releaseSession = () => {
      if (!sessionCounted) return;
      sessionCounted = false;
      poseSessions -= 1;
    };
    client.on('close', releaseSession);
    client.on('error', releaseSession);

    // 透传连接到 sidecar，双向管道转发
    const upstream = new WebSocket(POSE_EVAL_WS_URL);
    let opened = false;
    const pending = []; // upstream 握手期间到达的客户端消息，open 后统一 flush
    upstream.on('open', () => {
      opened = true;
      for (const m of pending) upstream.send(m);
      pending.length = 0;
    });
    upstream.on('message', (data) => {
      if (client.readyState === WebSocket.OPEN) client.send(data);
    });
    upstream.on('close', () => {
      releaseSession();
      if (client.readyState === WebSocket.OPEN) client.close(1011, '身段比对服务未连接');
    });
    upstream.on('error', () => { /* close 事件会跟随触发 */ });

    client.on('message', (data) => {
      // 必须转字符串以文本帧发送：sidecar 的 receive_json() 不接受二进制帧
      const text = data.toString();
      if (opened && upstream.readyState === WebSocket.OPEN) upstream.send(text);
      else if (!opened) {
        // 上游尚未就绪时缓存过多帧会顶爆内存，超出上限直接丢弃最旧的
        if (pending.length >= 32) pending.shift();
        pending.push(text);
      }
    });
    client.on('close', () => upstream.close());
    client.on('error', () => upstream.close());
  });

  console.log('[WS] 身段测评代理已挂载到 /pose-ws');
}

// 广播给所有在线客户端
export function broadcast(payload) {
  if (!wss) return;
  const data = JSON.stringify(payload);
  wss.clients.forEach((client) => {
    if (client.readyState === 1) {
      client.send(data);
    }
  });
}

// 课程通知推送（供路由调用，如作业发布、签到开始）
export function broadcastNotice(payload) {
  broadcast({ type: 'notice', ...payload });
}
