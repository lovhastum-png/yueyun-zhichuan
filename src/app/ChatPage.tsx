import { useEffect, useRef, useState, type KeyboardEvent } from 'react';
import { useSearchParams } from 'react-router-dom';
import { request, openStream } from '../shared/api';
import { getToken } from '../shared/auth';
import { toast } from '../shared/toast';
import { InkGrinding } from '../shared/InkGrinding';
import { renderAnswerHtml } from '../shared/format';
import { AiBadge, AiNotice } from '../shared/AiLabel';

// 智能问答页：接收流式回答，展示资料、知识卡片及历史会话。

interface RagChunk {
  title: string;
  content: string;
  score: number;
}

interface KnowledgeCard {
  id: string;
  title: string;
  type: string;
  content: string;
  /** 入场动画延迟（秒） */
  delay: number;
}

interface ChatSource {
  title: string;
}

/** /api/chat/stream 的 SSE 事件（与后端 chat 路由对齐） */
type ChatSseEvent =
  | { type: 'token'; content: string }
  | { type: 'rag'; chunks: RagChunk[] }
  | { type: 'plugin'; content: string }
  | { type: 'sources'; sources: ChatSource[] }
  | { type: 'cards'; cards: Omit<KnowledgeCard, 'delay'>[] }
  | { type: 'error'; message: string }
  | { type: 'done'; sessionId: string };

/** GET /chat/history/:sid 响应 */
interface ChatHistoryData {
  messages: {
    role: 'user' | 'assistant';
    content: string;
    sources: ChatSource[] | null;
  }[];
}

type ChatPhase = 'pending' | 'streaming' | 'done';

interface ChatMsg {
  id: number;
  role: 'user' | 'assistant';
  /** 原始文本（assistant 渲染时经 renderAnswerHtml 转换） */
  text: string;
  phase: ChatPhase;
  /** 欢迎消息（静态内容） */
  welcome?: boolean;
  /** SSE error 事件文本 */
  errorText?: string;
  /** fetch 网络异常文本 */
  networkError?: string;
  sources?: ChatSource[];
  ragChunks?: RagChunk[];
  pluginText?: string;
  /** 收藏用：触发本次回答的问题 */
  question?: string;
  faved?: boolean;
  /** 历史会话恢复的消息（无收藏按钮） */
  restored?: boolean;
}

const EXAMPLE_QUESTIONS: [label: string, q: string][] = [
  ['越剧的起源和历史', '越剧的起源和历史是怎样的？'],
  ['越剧主要流派', '越剧有哪些主要流派？各自的代表人物是谁？'],
  ['梁祝经典唱段', '《梁山伯与祝英台》的经典唱段有哪些？'],
  ['徐派唱腔特点', '徐派小生的唱腔有什么特点？'],
  ['行当区分', '越剧的生旦净丑行当如何区分？'],
];

export function ChatPage() {
  const [messages, setMessages] = useState<ChatMsg[]>([
    { id: 0, role: 'assistant', text: '', phase: 'done', welcome: true },
  ]);
  const [cards, setCards] = useState<KnowledgeCard[]>([]);
  const [input, setInput] = useState('');
  const [isStreaming, setIsStreaming] = useState(false);

  const nextId = useRef(1);
  const sessionRef = useRef<string | null>(null);
  const streamingRef = useRef(false);
  const abortRef = useRef<AbortController | null>(null);
  const areaRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  // 离开页面后，不再用异步结果更新消息。
  const aliveRef = useRef(true);
  const [params] = useSearchParams();

  useEffect(() => {
    document.title = '越韵智传 · 智能问答';
    // 旧页面 <body class="page-chat"> 承载布局样式（pages.css），SPA 中手动补挂
    const prevClass = document.body.className;
    document.body.className = 'page-chat';
    return () => {
      document.body.className = prevClass;
      aliveRef.current = false;
      abortRef.current?.abort();
    };
  }, []);

  // 流式期间持续滚动到底部
  useEffect(() => {
    const el = areaRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [messages]);

  // URL ?session=xxx 恢复历史会话（与旧版一致，需已登录）
  useEffect(() => {
    const sid = params.get('session');
    if (!sid || !getToken()) return;
    // 竞态保护：快速切换 session 时，旧请求的响应不能覆盖新会话的消息
    let stale = false;
    (async () => {
      const res = await request<ChatHistoryData>(`/chat/history/${sid}`, { silent: true });
      if (stale || !aliveRef.current) return;
      if (res.code !== 0 || !res.data || !res.data.messages) {
        if (res.code !== -2) toast(res.message || '历史会话加载失败', 'err');
        return;
      }
      sessionRef.current = sid;
      setMessages(
        res.data.messages.map((m) => ({
          id: nextId.current++,
          role: m.role,
          text: m.content,
          phase: 'done' as const,
          sources: m.sources || [],
          restored: true,
        })),
      );
    })();
    return () => { stale = true; };
  }, [params]);

  // ---------- 输入框自适应高度 ----------
  const adjustHeight = () => {
    const el = inputRef.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = Math.min(el.scrollHeight, 140) + 'px';
  };

  const onKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    // isComposing：中文/日文输入法选词时按 Enter 是「确认候选词」，
    // 不排除会导致拼音还没上屏就把半成品发出去。
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
      // 登录守卫由路由层负责，这里仅提示
      toast('请先登录后再提问', 'err');
      return;
    }

    const userId = nextId.current++;
    const aiId = nextId.current++;
    setMessages((prev) => [
      ...prev,
      { id: userId, role: 'user', text, phase: 'done' },
      { id: aiId, role: 'assistant', text: '', phase: 'pending' },
    ]);
    setInput('');
    if (inputRef.current) inputRef.current.style.height = 'auto';

    streamingRef.current = true;
    setIsStreaming(true);

    const patch = (fn: (m: ChatMsg) => ChatMsg) =>
      setMessages((prev) => prev.map((m) => (m.id === aiId ? fn(m) : m)));

    const controller = new AbortController();
    abortRef.current = controller;

    let fullText = '';
    let sources: ChatSource[] = [];

    try {
      // openStream 统一处理鉴权与 401 跳登录，避免 token 过期时只报「请求失败 (401)」
      const resp = await openStream('/chat/stream', { message: text, sessionId: sessionRef.current }, controller.signal);
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
          const evt = ((): ChatSseEvent | null => {
            try {
              return JSON.parse(payload) as ChatSseEvent;
            } catch {
              return null;
            }
          })();
          if (!evt) continue;

          if (evt.type === 'token') {
            fullText += evt.content;
            patch((m) => ({ ...m, text: fullText, phase: 'streaming', errorText: undefined }));
          } else if (evt.type === 'rag') {
            if (!evt.chunks || evt.chunks.length === 0) continue;
            patch((m) => (m.ragChunks ? m : { ...m, ragChunks: evt.chunks }));
          } else if (evt.type === 'plugin') {
            if (!evt.content) continue;
            patch((m) => ({ ...m, pluginText: (m.pluginText || '') + evt.content }));
          } else if (evt.type === 'sources') {
            sources = evt.sources;
          } else if (evt.type === 'cards') {
            // 知识卡片：追加去重
            setCards((prev) => {
              const existing = new Set(prev.map((c) => c.id));
              const add = evt.cards
                .filter((c) => !existing.has(c.id))
                .map((c, i) => ({ ...c, delay: i * 0.1 }));
              return add.length ? [...prev, ...add] : prev;
            });
          } else if (evt.type === 'error') {
            patch((m) => ({ ...m, errorText: evt.message }));
          } else if (evt.type === 'done') {
            sessionRef.current = evt.sessionId;
            patch((m) => ({
              ...m,
              phase: 'done',
              text: fullText,
              sources,
              question: text,
              errorText: undefined,
            }));
          }
        }
      }
    } catch (err) {
      // 组件卸载触发的中止不算错误
      if (err instanceof DOMException && err.name === 'AbortError') return;
      if (!aliveRef.current) return;
      const raw = err instanceof Error ? err.message : String(err);
      // 不把英文技术细节（Failed to fetch 之类）直接甩给用户
      const msg = /failed to fetch|networkerror|load failed/i.test(raw)
        ? '网络连接失败，请检查网络后重试'
        : raw;
      patch((m) => ({ ...m, networkError: msg }));
    } finally {
      streamingRef.current = false;
      // 卸载后不再 setState，避免内存泄漏与无效渲染
      if (aliveRef.current) setIsStreaming(false);
    }
  };

  // ---------- 收藏问答 ----------
  const handleFav = async (m: ChatMsg) => {
    if (m.faved) {
      toast('已收藏', 'ok');
      return;
    }
    const res = await request('/favorite', {
      method: 'POST',
      body: { type: 'chat', content: JSON.stringify({ question: m.question, answer: m.text }) },
    });
    if (res.code === 0) {
      setMessages((prev) => prev.map((x) => (x.id === m.id ? { ...x, faved: true } : x)));
      toast('已加入收藏', 'ok');
    } else {
      toast(res.message || '收藏失败', 'err');
    }
  };

  return (
    <>
      <main className="main">
        <div className="container" style={{ paddingTop: 8 }}>
          {/* 页面横幅 */}
          <section className="page-hero">
            <div className="ink-wash ink-wash-1"></div>
            <div className="ink-wash ink-wash-2"></div>
            <div className="hero-seal">
              <span className="seal seal-vertical">问答</span>
            </div>
            <h1>
              越韵问答 <AiBadge style={{ fontSize: 12, padding: '2px 10px' }} />
            </h1>
          </section>
          <AiNotice text="本页回答由人工智能基于越剧学科知识库检索增强生成（RAG），已附引用出处；AI 可能出现理解偏差，学术引用前请核对原文。" />

          <div className="chat-main">
            {/* 对话流 */}
            <div className="chat-stream">
              <div className="chat-area" id="chatArea" ref={areaRef}>
                {messages.map((m) => (
                  <ChatMessage key={m.id} m={m} onFav={handleFav} />
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
                    placeholder="请输入您的越剧问题…"
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

            {/* 知识卡片栏 */}
            <aside className="knowledge-sidebar">
              <div className="ks-head">
                <div className="ks-title">知识卡片</div>
                <div className="ks-sub">根据对话实时关联</div>
              </div>
              <div className="ks-body knowledge-panel" id="knowledgePanel">
                {cards.length === 0 ? (
                  <div className="knowledge-empty">
                    <div className="empty-icon">墨</div>
                    <div>
                      开始对话后，<br />此处将展示相关越剧知识
                    </div>
                  </div>
                ) : (
                  cards.map((c) => (
                    <div key={c.id} className="knowledge-card" style={{ animationDelay: `${c.delay}s` }}>
                      <div className="kc-head">
                        <span className="kc-title">{c.title}</span>
                        <span className="kc-type">{c.type}</span>
                      </div>
                      <div className="kc-body">{c.content}</div>
                    </div>
                  ))
                )}
              </div>
            </aside>
          </div>
        </div>
      </main>
    </>
  );
}

/* ---------------- 单条消息 ---------------- */

function ChatMessage({ m, onFav }: { m: ChatMsg; onFav: (m: ChatMsg) => void }) {
  const avatar = m.role === 'user' ? '我' : '韵';
  const cursor = m.phase === 'streaming' && !m.networkError;
  const sources = m.sources || [];

  // 完成后是否展示 meta：流式回答始终有收藏；历史消息仅有出处时展示
  const showMeta =
    m.role === 'assistant'
    && m.phase === 'done'
    && !m.welcome
    && (!m.restored || sources.length > 0);

  return (
    <div className={`msg ${m.role} fade-up`}>
      <div className="msg-avatar">{avatar}</div>
      <div className="msg-body">
        {m.role === 'assistant' && !m.welcome && (
          <div className="msg-meta" style={{ marginBottom: 4 }}>
            <AiBadge />
          </div>
        )}
        <div className={`bubble${cursor ? ' stream-cursor streaming-ink' : ''}`}>
          {m.welcome ? (
            <ChatWelcome />
          ) : m.networkError ? (
            <>
              <p style={{ color: 'var(--cinnabar)' }}>⚠ 网络异常：{m.networkError}</p>
              <p style={{ fontSize: 13, color: 'var(--ink-light)' }}>请确认后端服务已启动。</p>
            </>
          ) : m.phase === 'pending' ? (
            <InkGrinding text="正在研墨运笔…" />
          ) : m.errorText ? (
            <p style={{ color: 'var(--cinnabar)' }}>⚠ {m.errorText}</p>
          ) : m.role === 'user' ? (
            // 用户消息为纯文本（旧版仅 escapeHtml，不走 AI 回答渲染）
            m.text
          ) : (
            <span dangerouslySetInnerHTML={{ __html: renderAnswerHtml(m.text) }} />
          )}
        </div>

        {m.ragChunks && m.ragChunks.length > 0 && <RagChunks chunks={m.ragChunks} />}
        {m.pluginText && <PluginSource text={m.pluginText} />}

        {showMeta && (
          <div className="msg-meta">
            {!m.restored && (
              <span
                className={`msg-action${m.faved ? ' faved' : ''}`}
                title="收藏此问答"
                onClick={() => onFav(m)}
              >
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <path d="M19 21l-7-5-7 5V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2z" />
                </svg>
                收藏
              </span>
            )}
            {sources.length > 0 && (
              <>
                <span className="msg-action" style={{ cursor: 'default' }}>
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20" />
                    <path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z" />
                  </svg>
                  出处
                </span>{' '}
                {sources.map((source, i) => (
                  <span key={i} className="tag tag-cinnabar">
                    {source.title}
                  </span>
                ))}
              </>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

function ChatWelcome() {
  return (
    <>
      <p>欢迎来到「越韵智传」。我精通越剧历史、流派、剧目、行当与唱腔，可为您答疑解惑。</p>
      <p>
        试试问我：<span style={{ color: 'var(--cinnabar)' }}>越剧有哪些主要流派？</span> 或{' '}
        <span style={{ color: 'var(--cinnabar)' }}>《红楼梦》中贾宝玉由哪个流派演绎？</span>
      </p>
    </>
  );
}

/* ---------------- RAG 检索片段 ---------------- */

function RagChunks({ chunks }: { chunks: RagChunk[] }) {
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
          <div className="rag-chunk-body">{c.content.length > 80 ? c.content.slice(0, 80) + '…' : c.content}</div>
        </div>
      ))}
    </div>
  );
}

/* ---------------- 联网搜索结果 ---------------- */

function PluginSource({ text }: { text: string }) {
  return (
    <div className="plugin-source">
      <div className="plugin-title">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
          <circle cx="12" cy="12" r="10" />
          <line x1="2" y1="12" x2="22" y2="12" />
          <path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z" />
        </svg>
        联网参考
      </div>
      <div className="plugin-body">{text}</div>
    </div>
  );
}
