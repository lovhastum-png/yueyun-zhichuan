import { useEffect, useRef, useState } from 'react';
import { getToken, getUser } from '../shared/auth';
import { toast } from '../shared/toast';
import { formatTime } from '../shared/format';
import { EmptyState } from '../shared/EmptyState';

/** 聊天消息（服务端 /ws 推送的 chat / history 载荷） */
interface ChatMessage {
  username?: string;
  role?: string;
  content?: string;
  createdAt?: string;
}

/** /ws 下行的所有消息类型（与旧版 chatroom.js 对齐） */
interface WsMessage extends ChatMessage {
  type: string;
  messages?: ChatMessage[]; // history
  online?: number; // presence
  action?: 'join' | 'leave'; // presence
  message?: string; // notice / error
}

/** 页面渲染用的消息条目：聊天消息或系统提示 */
type RenderItem =
  | { kind: 'chat'; id: number; username: string; role: string; content: string; createdAt?: string }
  | { kind: 'sys'; id: number; text: string };

// 雅集聊天：WebSocket 实时聊天室，连接串 / 消息协议与旧版 chatroom.js 完全一致
export function ChatroomPage() {
  // getUser() 每次返回新对象，用 useState 初始化器固定引用，避免 WS effect 反复重连
  const [user] = useState(() => getUser());
  const [messages, setMessages] = useState<RenderItem[]>([]);
  const [onlineCount, setOnlineCount] = useState(0);
  const [onlineUsers, setOnlineUsers] = useState<string[] | null>(null); // null = 尚未收到 presence
  const [input, setInput] = useState('');

  const messagesRef = useRef<HTMLDivElement>(null);
  const wsRef = useRef<WebSocket | null>(null);
  const idRef = useRef(0);

  useEffect(() => {
    document.title = '越韵智传 · 雅集聊天';
  }, []);

  // 未登录：提示后不渲染聊天区（不跳转，登录守卫由路由层处理）
  useEffect(() => {
    if (!user) toast('请先登录后加入雅集', 'err');
  }, [user]);

  // WebSocket 连接：断线 3 秒自动重连，卸载时关闭并停止重连
  useEffect(() => {
    if (!user) return;
    let disposed = false;
    let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
    let historyLoaded = false;
    let ws: WebSocket | null = null;

    const connect = () => {
      if (disposed) return;
      const proto = location.protocol === 'https:' ? 'wss:' : 'ws:';
      const url = `${proto}//${location.host}/ws?token=${encodeURIComponent(getToken() || '')}`;
      ws = new WebSocket(url);
      wsRef.current = ws;

      ws.onmessage = (e) => {
        let msg: WsMessage;
        try {
          msg = JSON.parse(e.data) as WsMessage;
        } catch {
          return;
        }
        if (msg.type === 'history') {
          // 重连后服务端会再推一次历史，仅首次加载
          if (!historyLoaded) {
            const items = (msg.messages || []).map<RenderItem>((m) => ({
              kind: 'chat',
              id: ++idRef.current,
              username: m.username || '?',
              role: m.role || '',
              content: m.content || '',
              createdAt: m.createdAt,
            }));
            setMessages((prev) => [...prev, ...items]);
            historyLoaded = true;
          }
        } else if (msg.type === 'chat') {
          setMessages((prev) => [
            ...prev,
            {
              kind: 'chat',
              id: ++idRef.current,
              username: msg.username || '?',
              role: msg.role || '',
              content: msg.content || '',
              createdAt: msg.createdAt,
            },
          ]);
        } else if (msg.type === 'presence') {
          setOnlineCount(msg.online ?? 0);
          setOnlineUsers((prev) => {
            const set = new Set(prev ?? []);
            if (msg.action === 'join') set.add(msg.username || '');
            else if (msg.action === 'leave') set.delete(msg.username || '');
            return Array.from(set);
          });
          if (msg.action === 'join' && msg.username && msg.username !== user.username) {
            setMessages((prev) => [...prev, { kind: 'sys', id: ++idRef.current, text: `${msg.username} 加入了雅集` }]);
          }
        } else if (msg.type === 'notice') {
          setMessages((prev) => [...prev, { kind: 'sys', id: ++idRef.current, text: `📢 ${msg.message || ''}` }]);
        } else if (msg.type === 'error') {
          toast(msg.message || '发生错误', 'err');
        }
      };

      ws.onclose = () => {
        if (disposed) return;
        reconnectTimer = setTimeout(connect, 3000);
      };
      ws.onerror = () => {
        ws?.close();
      };
    };

    connect();
    return () => {
      disposed = true;
      if (reconnectTimer) clearTimeout(reconnectTimer);
      ws?.close();
      wsRef.current = null;
    };
  }, [user]);

  // 新消息到达自动滚到底部
  useEffect(() => {
    const el = messagesRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [messages]);

  const send = () => {
    const content = input.trim();
    if (!content) return;
    const ws = wsRef.current;
    if (!ws || ws.readyState !== WebSocket.OPEN) {
      toast('连接未就绪，请稍候', 'err');
      return;
    }
    ws.send(JSON.stringify({ type: 'chat', content }));
    setInput('');
  };

  return (
    <>
      <main className="main">
        <div className="container" style={{ paddingTop: 8 }}>
          <section className="page-hero" style={{ padding: '24px 0 16px' }}>
            <div className="ink-wash ink-wash-1" style={{ background: 'var(--cyan)', left: '12%' }} />
            <div className="hero-seal">
              <span className="seal seal-vertical">雅集</span>
            </div>
            <h1>雅集聊天</h1>
          </section>

          {!user ? (
            <EmptyState icon="集" text="请先登录后加入雅集聊天" />
          ) : (
            <div className="chatroom-layout">
              <div className="chatroom-main">
                <div className="chatroom-messages" ref={messagesRef} role="log" aria-live="polite" aria-label="聊天消息">
                  {messages.map((m) =>
                    m.kind === 'sys' ? (
                      <div
                        key={m.id}
                        style={{ textAlign: 'center', fontSize: 12, color: 'var(--ink-light)', padding: '6px 0', letterSpacing: 1 }}
                      >
                        {m.text}
                      </div>
                    ) : (
                      <div key={m.id} className={`chat-msg ${m.username === user.username ? 'self' : ''}`}>
                        <div className={`chat-msg-avatar ${m.role === 'teacher' ? 'teacher' : ''}`}>
                          {(m.username || '?').charAt(0)}
                        </div>
                        <div>
                          <div className="chat-msg-meta">
                            {m.username}
                            {m.role === 'teacher' ? ' · 师' : ''} · {formatTime(m.createdAt)}
                          </div>
                          <div className="chat-msg-bubble">{m.content}</div>
                        </div>
                      </div>
                    ),
                  )}
                </div>
                <div className="chatroom-input">
                  <input
                    className="input"
                    placeholder="说点什么…"
                    maxLength={1000}
                    value={input}
                    onChange={(e) => setInput(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') send();
                    }}
                  />
                  <button className="btn btn-primary" onClick={send}>
                    发 送
                  </button>
                </div>
              </div>
              <aside className="chatroom-sidebar">
                <div className="online-count">{onlineCount}</div>
                <div className="online-label">在 线 同 学</div>
                <div style={{ fontSize: 12, color: 'var(--ink-light)', lineHeight: 2 }}>
                  {onlineUsers === null
                    ? '连接中…'
                    : onlineUsers.length === 0
                      ? '暂无其他在线同学'
                      : onlineUsers.map((u) => <div key={u}>· {u}</div>)}
                </div>
                <div className="brush-divider" />
                <div style={{ fontSize: 13, color: 'var(--ink-light)', lineHeight: 1.8 }}>
                  <div style={{ fontFamily: 'var(--font-brush)', fontSize: 16, color: 'var(--ink)', marginBottom: 8 }}>雅集须知</div>
                  ① 文明交流，互相尊重<br />
                  ② 讨论越剧学习相关话题<br />
                  ③ 教师发言会以朱红标记<br />
                  ④ 消息最多保存 50 条
                </div>
              </aside>
            </div>
          )}
        </div>
      </main>
    </>
  );
}
