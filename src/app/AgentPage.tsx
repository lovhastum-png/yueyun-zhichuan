import { useCallback, useEffect, useRef, useState, type KeyboardEvent } from 'react';
import { request, openStream } from '../shared/api';
import { getToken } from '../shared/auth';
import { toast } from '../shared/toast';
import { InkGrinding } from '../shared/InkGrinding';
import { renderAnswerHtml, formatTime } from '../shared/format';
import { AiBadge, AiNotice } from '../shared/AiLabel';

/* ============================================================
   AI 学习助手页（React 版）：SSE 流式 + 工具调用展示 + 历史会话
   交互与旧版 public/agent.html + public/js/agent.js 完全一致
   ============================================================ */

/** 工具元信息（前端展示用，与后端 agentTools 对应） */
interface ToolMeta {
  name: string;
  icon: string;
  desc: string;
}

const TOOLS_META: ToolMeta[] = [
  { name: 'query_courses', icon: '课', desc: '查询已选课程' },
  { name: 'query_assignments', icon: '作', desc: '查询作业与提交状态' },
  { name: 'query_exams', icon: '考', desc: '查询考试安排与成绩' },
  { name: 'query_grades', icon: '绩', desc: '成绩汇总与平均分' },
  { name: 'query_knowledge', icon: '识', desc: '越剧知识库检索' },
  { name: 'generate_image', icon: '画', desc: 'AI 生成越剧图片' },
  { name: 'query_attendance', icon: '勤', desc: '签到记录与出勤统计' },
];

const TOOL_META_MAP: Record<string, ToolMeta> = Object.fromEntries(TOOLS_META.map((t) => [t.name, t]));

/** /api/agent/chat 的 SSE 事件（与后端 agent 路由对齐） */
type AgentSseEvent =
  | { type: 'tool_start'; name: string; args?: Record<string, unknown> }
  | { type: 'tool_end'; name: string; summary?: string; success?: boolean }
  | { type: 'rag'; chunks: AgentRagChunk[] }
  | { type: 'token'; content: string }
  | { type: 'error'; message: string }
  | { type: 'done'; sessionId: string; toolsUsed?: string[] };

interface AgentRagChunk {
  title: string;
  score: number;
}

/** GET /agent/sessions 响应（snake_case 与后端一致） */
interface AgentSession {
  session_id: string;
  preview: string | null;
  last_at: string;
  msg_count: number;
}

/** GET /agent/history/:sid 响应 */
interface AgentHistoryMsg {
  role: 'user' | 'assistant';
  message: string;
}

type AgentPhase = 'pending' | 'streaming' | 'done';

interface AgentToolCall {
  name: string;
  argsStr: string;
  state: 'running' | 'done' | 'failed';
  summary?: string;
}

interface AgentMsg {
  id: number;
  role: 'user' | 'assistant';
  text: string;
  phase: AgentPhase;
  welcome?: boolean;
  errorText?: string;
  networkError?: string;
  tools: AgentToolCall[];
  ragChunks?: AgentRagChunk[];
  toolsUsed?: string[];
  restored?: boolean;
}

const EXAMPLE_QUESTIONS: [label: string, q: string][] = [
  ['我的课程', '我有哪些课程？'],
  ['未交作业', '我还有哪些作业没交？'],
  ['考试成绩', '我的考试成绩怎么样？'],
  ['出勤情况', '我的出勤情况如何？'],
  ['越剧知识', '徐派小生的唱腔特点是什么？'],
  ['AI 生图', '帮我画一张水墨风格的越剧花旦图'],
];

export function AgentPage() {
  const [messages, setMessages] = useState<AgentMsg[]>([
    { id: 0, role: 'assistant', text: '', phase: 'done', welcome: true, tools: [] },
  ]);
  const [input, setInput] = useState('');
  const [isStreaming, setIsStreaming] = useState(false);
  /** 侧栏高亮的已调用工具 */
  const [activeTools, setActiveTools] = useState<string[]>([]);
  /** null = 未加载（未登录），[] = 暂无会话 */
  const [sessions, setSessions] = useState<AgentSession[] | null>(null);
  const [sessionsError, setSessionsError] = useState<string | null>(null);

  const nextId = useRef(1);
  const sessionRef = useRef<string | null>(null);
  const streamingRef = useRef(false);
  const abortRef = useRef<AbortController | null>(null);
  const areaRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  // 组件是否仍挂载：流式回调与异步加载都要判断，避免卸载后 setState
  const aliveRef = useRef(true);

  useEffect(() => {
    document.title = '越韵智传 · AI 学习助手';
    // 旧页面 <body class="page-agent"> 承载布局样式（components.css），SPA 中手动补挂
    const prevClass = document.body.className;
    document.body.className = 'page-agent';
    return () => {
      document.body.className = prevClass;
      aliveRef.current = false;
      abortRef.current?.abort();
    };
  }, []);

  useEffect(() => {
    const el = areaRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [messages]);

  // ---------- 加载历史会话列表 ----------
  const loadSessions = useCallback(async () => {
    if (!getToken()) return;
    const res = await request<AgentSession[]>('/agent/sessions', { silent: true });
    if (!aliveRef.current) return;
    if (res.code !== 0) {
      // 加载失败不能等同于「没有历史」，否则用户以为记录丢了
      setSessionsError(res.code === -2 ? null : (res.message || '历史会话加载失败'));
      return;
    }
    setSessionsError(null);
    setSessions(res.data || []);
  }, []);

  useEffect(() => {
    loadSessions();
  }, [loadSessions]);

  // ---------- 输入框自适应高度 ----------
  const adjustHeight = () => {
    const el = inputRef.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = Math.min(el.scrollHeight, 140) + 'px';
  };

  const onKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    // isComposing：中文输入法选词时按 Enter 只是确认候选词，不应触发发送
    if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
      e.preventDefault();
      sendMessage();
    }
  };

  // ---------- 发送消息（SSE 流式，与旧版 fetch reader 实现一致） ----------
  const sendMessage = async (overrideText?: string) => {
    const text = (overrideText ?? input).trim();
    if (!text) return;
    if (streamingRef.current) {
      toast('正在回答中，请稍候', 'err');
      return;
    }
    if (!getToken()) {
      toast('请先登录后再提问', 'err');
      return;
    }

    const userId = nextId.current++;
    const aiId = nextId.current++;
    setMessages((prev) => [
      ...prev,
      { id: userId, role: 'user', text, phase: 'done', tools: [] },
      { id: aiId, role: 'assistant', text: '', phase: 'pending', tools: [] },
    ]);
    setInput('');
    if (inputRef.current) inputRef.current.style.height = 'auto';

    streamingRef.current = true;
    setIsStreaming(true);

    const patch = (fn: (m: AgentMsg) => AgentMsg) =>
      setMessages((prev) => prev.map((m) => (m.id === aiId ? fn(m) : m)));

    const controller = new AbortController();
    abortRef.current = controller;

    let fullText = '';

    try {
      // openStream 统一处理鉴权与 401 跳登录
      const resp = await openStream('/agent/chat', { message: text, sessionId: sessionRef.current }, controller.signal);
      if (!resp.ok) {
        throw new Error(resp.status >= 500 ? '服务暂时不可用，请稍后重试' : `请求失败 (${resp.status})`);
      }
      if (!resp.body) throw new Error('当前浏览器不支持流式响应');
      const reader = resp.body.getReader();
      const decoder = new TextDecoder('utf-8');
      let buffer = '';

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() || '';

        for (const line of lines) {
          const trimmed = line.trim();
          if (!trimmed || !trimmed.startsWith('data:')) continue;
          const payload = trimmed.slice(5).trim();
          if (!payload) continue;
          // const 解析结果：保证联合类型收窄能进入下方闭包（let 会在闭包中丢失收窄）
          const evt = ((): AgentSseEvent | null => {
            try {
              return JSON.parse(payload) as AgentSseEvent;
            } catch {
              return null;
            }
          })();
          if (!evt) continue;

          if (evt.type === 'tool_start') {
            // 工具开始调用（同名工具只展示一张卡片，与旧版一致）
            setActiveTools((prev) => (prev.includes(evt.name) ? prev : [...prev, evt.name]));
            const entries = Object.entries(evt.args || {});
            const argsStr = entries.length
              ? entries.map(([k, v]) => `${k}: ${String(v)}`).join('，')
              : '（无参数）';
            patch((m) =>
              m.tools.some((t) => t.name === evt.name)
                ? m
                : { ...m, tools: [...m.tools, { name: evt.name, argsStr, state: 'running' }] },
            );
          } else if (evt.type === 'tool_end') {
            patch((m) => ({
              ...m,
              tools: m.tools.map((t) =>
                t.name === evt.name
                  ? { ...t, state: evt.success === false ? 'failed' : 'done', summary: evt.summary }
                  : t,
              ),
            }));
          } else if (evt.type === 'rag') {
            if (!evt.chunks || evt.chunks.length === 0) continue;
            patch((m) => (m.ragChunks ? m : { ...m, ragChunks: evt.chunks }));
          } else if (evt.type === 'token') {
            fullText += evt.content;
            patch((m) => ({ ...m, text: fullText, phase: 'streaming', errorText: undefined }));
          } else if (evt.type === 'error') {
            patch((m) => ({ ...m, errorText: evt.message }));
          } else if (evt.type === 'done') {
            sessionRef.current = evt.sessionId;
            patch((m) => ({
              ...m,
              phase: 'done',
              text: fullText,
              toolsUsed: evt.toolsUsed || [],
              errorText: undefined,
            }));
            loadSessions();
          }
        }
      }
    } catch (err) {
      if (err instanceof DOMException && err.name === 'AbortError') return;
      if (!aliveRef.current) return;
      const raw = err instanceof Error ? err.message : String(err);
      const msg = /failed to fetch|networkerror|load failed/i.test(raw)
        ? '网络连接失败，请检查网络后重试'
        : raw;
      patch((m) => ({ ...m, networkError: msg }));
    } finally {
      streamingRef.current = false;
      if (aliveRef.current) setIsStreaming(false);
    }
  };

  // ---------- 恢复历史会话 ----------
  const restoreSession = async (sid: string) => {
    try {
      const res = await request<AgentHistoryMsg[]>(`/agent/history/${sid}`);
      if (res.code !== 0 || !res.data) return;
      sessionRef.current = sid;
      setMessages(
        res.data.map((m) => ({
          id: nextId.current++,
          role: m.role,
          text: m.message,
          phase: 'done' as const,
          tools: [],
          restored: true,
        })),
      );
      toast('已恢复会话', 'ok');
    } catch {
      toast('会话恢复失败', 'err');
    }
  };

  return (
    <>
      <main className="main">
        <div className="container" style={{ paddingTop: 8 }}>
          {/* 页面横幅 */}
          <section className="page-hero">
            <div className="ink-wash ink-wash-1"></div>
            <div className="ink-wash ink-wash-2" style={{ background: 'var(--ochre)' }}></div>
            <div className="hero-seal">
              <span className="seal seal-vertical">助手</span>
            </div>
            <h1>
              AI 学习助手 <AiBadge style={{ fontSize: 12, padding: '2px 10px' }} />
            </h1>
          </section>
          <AiNotice text="本助手的全部回答均由人工智能生成，可能引用越剧知识库但无法保证绝对准确；涉及学术引用、考核评分等场景请务必人工复核。" />

          <div className="agent-main">
            {/* 对话流 */}
            <div className="chat-stream">
              <div className="chat-area" id="chatArea" ref={areaRef}>
                {messages.map((m) => (
                  <AgentMessage key={m.id} m={m} />
                ))}
              </div>
              <div className="composer-wrap">
                {/* 示例问题 */}
                <div className="example-questions" id="exampleQuestions">
                  {EXAMPLE_QUESTIONS.map(([label, q]) => (
                    <span key={q} className="example-q" onClick={() => sendMessage(q)}>
                      {label}
                    </span>
                  ))}
                </div>
                <div className="chat-composer">
                  <textarea
                    className="textarea"
                    id="msgInput"
                    ref={inputRef}
                    placeholder="问我课程、作业、成绩，或越剧知识…"
                    rows={1}
                    value={input}
                    onChange={(e) => setInput(e.target.value)}
                    onInput={adjustHeight}
                    onKeyDown={onKeyDown}
                  />
                  <button
                    className="send-btn"
                    id="sendBtn"
                    title="发送"
                    disabled={isStreaming}
                    onClick={() => sendMessage()}
                  >
                    <svg
                      width="20"
                      height="20"
                      viewBox="0 0 24 24"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="2"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                    >
                      <line x1="22" y1="2" x2="11" y2="13"></line>
                      <polygon points="22 2 15 22 11 13 2 9 22 2"></polygon>
                    </svg>
                  </button>
                </div>
              </div>
            </div>

            {/* 工具栏 */}
            <aside className="agent-sidebar">
              <div className="ks-head">
                <div className="ks-title">可用工具</div>
                <div className="ks-sub">Agent 可主动调用</div>
              </div>
              <div className="ks-body" id="toolsPanel">
                {TOOLS_META.map((t) => (
                  <div key={t.name} className={`tool-item${activeTools.includes(t.name) ? ' tool-active' : ''}`}>
                    <div className="tool-icon">{t.icon}</div>
                    <div className="tool-info">
                      <div className="tool-name">{t.name}</div>
                      <div className="tool-desc">{t.desc}</div>
                    </div>
                  </div>
                ))}
              </div>
              <div className="agent-sessions">
                <div
                  className="ks-title"
                  style={{
                    padding: '12px 20px 8px',
                    borderTop: '1px solid var(--ink-10)',
                    background: 'rgba(26,26,26,0.03)',
                  }}
                >
                  历史会话
                </div>
                <div className="session-list" id="sessionList">
                  {sessions === null && !sessionsError && <div className="session-empty">登录后显示历史</div>}
                  {sessionsError && (
                    <div className="session-empty" role="alert">
                      {sessionsError}
                      <button type="button" className="btn btn-ghost btn-sm" onClick={loadSessions} style={{ marginTop: 8 }}>
                        重新加载
                      </button>
                    </div>
                  )}
                  {sessions !== null && sessions.length === 0 && <div className="session-empty">暂无历史会话</div>}
                  {sessions !== null &&
                    sessions.map((s) => {
                      const preview = (s.preview || '').slice(0, 30);
                      return (
                        <div key={s.session_id} className="session-item" onClick={() => restoreSession(s.session_id)}>
                          <div className="session-preview">
                            {preview}
                            {preview.length >= 30 ? '…' : ''}
                          </div>
                          <div className="session-meta">
                            {formatTime(s.last_at)} · {s.msg_count} 条
                          </div>
                        </div>
                      );
                    })}
                </div>
              </div>
            </aside>
          </div>
        </div>
      </main>
    </>
  );
}

/* ---------------- 单条消息 ---------------- */

function AgentMessage({ m }: { m: AgentMsg }) {
  const avatar = m.role === 'user' ? '我' : '助';
  const cursor = m.phase === 'streaming' && !m.networkError;
  const html = renderAnswerHtml(m.text);

  return (
    <div className={`msg ${m.role} fade-up`}>
      <div className="msg-avatar">{avatar}</div>
      <div className="msg-body">
        {/* 工具调用卡片插在 bubble 之前（与旧版 DOM 顺序一致） */}
        {m.tools.map((t) => (
          <ToolCallCard key={t.name} t={t} />
        ))}

        {m.role === 'assistant' && !m.welcome && (
          <div className="msg-meta" style={{ marginBottom: 4 }}>
            <AiBadge />
          </div>
        )}

        <div className={`bubble${cursor ? ' stream-cursor streaming-ink' : ''}`}>
          {m.welcome ? (
            <AgentWelcome />
          ) : m.networkError ? (
            <>
              <p style={{ color: 'var(--cinnabar)' }}>⚠ 网络异常：{m.networkError}</p>
              <p style={{ fontSize: 13, color: 'var(--ink-light)' }}>请确认后端服务已启动。</p>
            </>
          ) : m.phase === 'pending' ? (
            <InkGrinding text="正在研墨构思，思考调用哪些工具…" />
          ) : m.errorText ? (
            <p style={{ color: 'var(--cinnabar)' }}>⚠ {m.errorText}</p>
          ) : m.role === 'user' ? (
            // 用户消息为纯文本（旧版仅 escapeHtml，不走 AI 回答渲染）
            m.text
          ) : m.phase === 'done' && !html ? (
            // 全程无 token（仅工具调用）时的兜底文案
            <span style={{ color: 'var(--ink-light)' }}>已处理完毕</span>
          ) : (
            <span dangerouslySetInnerHTML={{ __html: html }} />
          )}
        </div>

        {m.ragChunks && m.ragChunks.length > 0 && <AgentRagChunks chunks={m.ragChunks} />}

        {m.role === 'assistant' && m.phase === 'done' && !m.welcome && !m.restored && (m.toolsUsed?.length || 0) > 0 && (
          <div className="msg-meta">
            <span style={{ fontSize: 12, color: 'var(--ink-light)' }}>已调用</span>{' '}
            {m.toolsUsed!.map((t) => {
              const meta = TOOL_META_MAP[t] || { icon: '工' };
              return (
                <span key={t} className="tool-badge">
                  <span className="tb-icon">{meta.icon}</span>
                  {t}
                </span>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}

function AgentWelcome() {
  return (
    <>
      <p>
        您好，我是您的 <strong>AI 学习助手</strong>
        。与普通问答不同，我能主动调用工具查询您的课程、作业、考试、成绩、签到等数据，给出更贴身的帮助。
      </p>
      <p>试试问我：</p>
      <p>
        · <span style={{ color: 'var(--cinnabar)' }}>我有哪些课？还有作业没交吗？</span>
        <br />· <span style={{ color: 'var(--cinnabar)' }}>我的成绩怎么样？平均分多少？</span>
        <br />· <span style={{ color: 'var(--cinnabar)' }}>徐派有什么特点？帮我画一张水墨越剧图。</span>
      </p>
    </>
  );
}

/* ---------------- 工具调用卡片 ---------------- */

function ToolCallCard({ t }: { t: AgentToolCall }) {
  const meta = TOOL_META_MAP[t.name] || { icon: '工', desc: t.name };
  return (
    <div
      className={`tool-call-card ${
        t.state === 'running' ? 'tool-running' : t.state === 'failed' ? 'tool-failed' : 'tool-done'
      }`}
    >
      <div className="tc-head">
        <div className="tc-icon">{meta.icon}</div>
        <div className="tc-info">
          <div className="tc-name">{t.name}</div>
          <div className="tc-desc">{meta.desc}</div>
        </div>
        <div className="tc-status">
          {t.state === 'running' ? (
            <>
              <span className="tc-spinner"></span>
              <span className="tc-status-text">调用中</span>
            </>
          ) : (
            <span className="tc-status-text">{t.state === 'failed' ? '失败' : '完成'}</span>
          )}
        </div>
      </div>
      <div className="tc-args">参数：{t.argsStr}</div>
      {t.state !== 'running' && (
        <div
          className="tc-result"
          style={{ display: 'block' }}
          dangerouslySetInnerHTML={{ __html: renderAnswerHtml(t.summary) || '（无返回）' }}
        />
      )}
    </div>
  );
}

/* ---------------- RAG 检索片段（agent 版仅标题与相关度） ---------------- */

function AgentRagChunks({ chunks }: { chunks: AgentRagChunk[] }) {
  return (
    <div className="rag-chunks">
      <div className="rag-title">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
          <path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20" />
          <path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z" />
        </svg>
        知识库检索（{chunks.length} 条）
      </div>
      {chunks.map((c, i) => (
        <div key={i} className="rag-chunk">
          <div className="rag-chunk-head">
            <span className="rag-chunk-title">{c.title}</span>
            <span className="rag-chunk-score">{(c.score * 100).toFixed(0)}%</span>
          </div>
        </div>
      ))}
    </div>
  );
}
