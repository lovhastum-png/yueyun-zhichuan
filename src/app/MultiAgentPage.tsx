import { useEffect, useRef, useState, type KeyboardEvent } from 'react';
import { getToken } from '../shared/auth';
import { toast } from '../shared/toast';
import { renderAnswerHtml } from '../shared/format';
import { activateProps } from '../shared/a11y';
import { AiBadge, AiNotice } from '../shared/AiLabel';

/* ============================================================
   多智能体协作页（React 版）：调度分发 + 专家并行 + 汇总 SSE 流式
   交互与旧版 public/multi-agent.html + public/js/multi-agent.js 完全一致
   （页面专属样式来自旧 HTML 内联 <style>，原样内嵌保证视觉一致）
   ============================================================ */

/** 专家元信息（与后端 EXPERTS 对应） */
interface ExpertMeta {
  name: string;
  avatar: string;
  color: string;
  desc: string;
}

const EXPERTS_META: Record<string, ExpertMeta> = {
  professor: { name: '越剧教授', avatar: '授', color: 'cinnabar', desc: '越剧历史、流派、剧目、行当、唱腔专业知识' },
  advisor: { name: '学业顾问', avatar: '顾', color: 'cyan', desc: '课程、作业、考试、成绩、错题学情数据' },
  artist: { name: '艺术指导', avatar: '艺', color: 'ochre', desc: 'AI 生图、唱腔模仿、身段表演、舞台艺术' },
  mentor: { name: '班主任', avatar: '班', color: 'ink', desc: '签到出勤、学习态度、综合表现、学习建议' },
};
const EXPERT_KEYS = Object.keys(EXPERTS_META);

interface MaRagChunk {
  title: string;
  content?: string;
  score: number;
}

/** /api/multi-agent/chat 的 SSE 事件（与后端 multiAgent 路由对齐，snake_case） */
type MaSseEvent =
  | { type: 'routing'; experts?: string[]; analysis?: string }
  | { type: 'expert_start'; expert: string; color: string; avatar: string; name: string }
  | { type: 'tool_start'; expert: string; name: string; args?: Record<string, unknown>; round?: number }
  | { type: 'tool_end'; expert: string; name: string; summary?: string; success?: boolean; round?: number }
  | { type: 'rag'; expert: string; chunks: MaRagChunk[] }
  | { type: 'expert_end'; expert: string; answer?: string; duration_ms?: number; chars?: number }
  | { type: 'summarizer_start' }
  | { type: 'summarizer_end'; duration_ms?: number }
  | { type: 'token'; content: string }
  | { type: 'error'; message: string }
  | {
      type: 'done';
      toolCount?: number;
      expertStats?: Record<string, { duration: number; tools: number; chars: number }>;
      summarizerDuration?: number;
      totalDuration?: number;
    };

type MaPhase = 'routing' | 'experts' | 'summarizer' | 'done';

interface MaTool {
  /** toolName_rN：同名工具多轮调用不冲突 */
  uid: string;
  name: string;
  round: number;
  argsStr: string;
  state: 'running' | 'done' | 'failed';
  summary?: string;
}

interface MaExpertState {
  key: string;
  color: string;
  avatar: string;
  name: string;
  tools: MaTool[];
  rag?: MaRagChunk[];
  /** 展开原文的 chunk 下标 */
  ragExpanded: number[];
  answer?: string;
  durationMs?: number;
  chars?: number;
  done: boolean;
}

interface MaMsg {
  id: number;
  role: 'user' | 'assistant';
  phase: MaPhase;
  /** 未开始输出时的打字占位文案（随协作阶段变化） */
  placeholder: string;
  routing?: { experts: string[]; analysis: string };
  activeExperts: string[];
  experts: MaExpertState[];
  summarizer?: { status: 'thinking' | 'generating' | 'done'; durationMs?: number };
  text: string;
  started: boolean;
  welcome?: boolean;
  errorText?: string;
  networkError?: string;
  collaborators: string[];
  toolCount?: number;
  expertStats?: Record<string, { duration: number; tools: number; chars: number }>;
  summarizerDuration?: number;
  totalDuration?: number;
}

const EXAMPLE_QUESTIONS: [label: string, q: string][] = [
  ['成绩+流派分析', '我的成绩怎么样？哪些越剧流派需要加强？'],
  ['学情+生图', '帮我分析学习情况并画一张水墨越剧花旦图'],
  ['知识+出勤', '徐派有什么特点？我的出勤如何？'],
  ['综合学情诊断', '分析我的作业和考试，给出学习建议'],
];

/* 旧 multi-agent.html 内联样式，原样迁移（协作拓扑图/汇总卡片/统计面板/RAG 展开/轮次标记） */
const MA_STYLE = `
/* ===== 协作拓扑图 ===== */
.topology-card {
  background: var(--paper);
  border: 1px solid var(--ink-10);
  border-radius: var(--r-md);
  padding: 16px 18px;
  margin-bottom: 14px;
  box-shadow: var(--shadow-ink);
}
.topology-title {
  font-size: 12px;
  color: var(--ink-light);
  letter-spacing: 2px;
  margin-bottom: 12px;
  display: flex;
  align-items: center;
  gap: 8px;
}
.topology-title::before {
  content: '';
  width: 3px; height: 12px;
  background: var(--cinnabar);
}
.topology-flow {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-wrap: wrap;
  min-height: 50px;
}
.topo-node {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 4px;
  padding: 8px 12px;
  border: 1px solid var(--ink-10);
  border-radius: var(--r-sm);
  background: var(--paper);
  min-width: 76px;
  transition: all 0.3s;
  opacity: 0.4;
}
.topo-node.active {
  opacity: 1;
  border-color: var(--cinnabar);
  box-shadow: 0 0 0 3px rgba(193, 39, 45, 0.1);
}
.topo-node.done { opacity: 1; }
.topo-node-avatar {
  width: 32px; height: 32px;
  display: grid; place-items: center;
  border-radius: 50%;
  font-size: 13px;
  font-family: var(--font-brush);
  color: var(--paper);
}
.topo-node-avatar.cinnabar { background: var(--cinnabar); }
.topo-node-avatar.cyan { background: var(--cyan); }
.topo-node-avatar.ochre { background: var(--ochre); }
.topo-node-avatar.ink { background: var(--ink); }
.topo-node-avatar.router { background: var(--ink); }
.topo-node-avatar.summarizer { background: var(--ochre); }
.topo-node-name { font-size: 11px; color: var(--ink); }
.topo-node-status {
  font-size: 9px;
  color: var(--ink-light);
  letter-spacing: 1px;
}
.topo-arrow {
  color: var(--ink-light);
  font-size: 16px;
  opacity: 0.5;
}
.topo-arrow.active { opacity: 1; color: var(--cinnabar); }

/* ===== 汇总阶段卡片 ===== */
.summarizer-card {
  background: linear-gradient(135deg, rgba(166, 124, 82, 0.08), rgba(193, 39, 45, 0.04));
  border: 1px solid var(--ochre);
  border-radius: var(--r-md);
  padding: 14px 18px;
  margin: 8px 0;
  box-shadow: var(--shadow-ink);
}
.summarizer-head {
  display: flex;
  align-items: center;
  gap: 10px;
  margin-bottom: 8px;
}
.summarizer-avatar {
  width: 28px; height: 28px;
  display: grid; place-items: center;
  background: var(--ochre);
  color: var(--paper);
  border-radius: 50%;
  font-size: 12px;
  font-family: var(--font-brush);
}
.summarizer-title {
  font-size: 13px;
  color: var(--ink);
  font-weight: 600;
  font-family: var(--font-kai);
}
.summarizer-status {
  font-size: 11px;
  color: var(--ink-light);
  margin-left: auto;
}
.summarizer-status.thinking::before {
  content: '';
  display: inline-block;
  width: 6px; height: 6px;
  border-radius: 50%;
  background: var(--ochre);
  margin-right: 5px;
  animation: maPulse 1.2s ease-in-out infinite;
}
@keyframes maPulse {
  0%, 100% { opacity: 0.3; transform: scale(0.8); }
  50% { opacity: 1; transform: scale(1.2); }
}

/* ===== 协作统计面板 ===== */
.collab-stats {
  background: var(--paper);
  border: 1px solid var(--ink-10);
  border-radius: var(--r-md);
  padding: 12px 16px;
  margin-top: 10px;
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(140px, 1fr));
  gap: 10px;
}
.collab-stat {
  display: flex;
  flex-direction: column;
  gap: 2px;
}
.collab-stat-label {
  font-size: 10px;
  color: var(--ink-light);
  letter-spacing: 1px;
}
.collab-stat-value {
  font-size: 14px;
  color: var(--ink);
  font-weight: 600;
  font-family: var(--font-kai);
}

/* ===== RAG 引用展开 ===== */
.ep-rag-chunk {
  cursor: pointer;
  transition: background 0.2s;
}
.ep-rag-chunk:hover { background: rgba(58, 125, 123, 0.05); }
.ep-rag-content {
  display: none;
  margin-top: 4px;
  padding: 6px 8px;
  background: rgba(245, 240, 232, 0.6);
  border-left: 2px solid var(--cyan);
  font-size: 11px;
  color: var(--ink-soft);
  line-height: 1.6;
  white-space: pre-wrap;
}
.ep-rag-chunk.expanded .ep-rag-content { display: block; }

/* ===== 工具调用 round 标记 ===== */
.ep-tool-round {
  display: inline-block;
  padding: 0 5px;
  margin-left: 4px;
  background: var(--ink-10);
  color: var(--ink-light);
  border-radius: 8px;
  font-size: 9px;
}

/* ===== 专家卡片耗时 ===== */
.ep-duration {
  font-size: 10px;
  color: var(--ink-light);
  margin-left: auto;
}
`;

export function MultiAgentPage() {
  const [messages, setMessages] = useState<MaMsg[]>([
    {
      id: 0,
      role: 'assistant',
      phase: 'done',
      placeholder: '',
      activeExperts: [],
      experts: [],
      text: '',
      started: true,
      welcome: true,
      collaborators: [],
    },
  ]);
  const [input, setInput] = useState('');
  const [isStreaming, setIsStreaming] = useState(false);
  /** 专家团队栏高亮（routing 事件设置，协作结束 2s 后复位） */
  const [activeExperts, setActiveExperts] = useState<string[]>([]);

  const nextId = useRef(1);
  const streamingRef = useRef(false);
  const abortRef = useRef<AbortController | null>(null);
  const areaRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    document.title = '越韵智传 · 多智能体协作';
    // 旧页面 <body class="page-multi-agent"> 承载布局样式（components.css），SPA 中手动补挂
    const prevClass = document.body.className;
    document.body.className = 'page-multi-agent';
    return () => {
      document.body.className = prevClass;
      abortRef.current?.abort();
    };
  }, []);

  useEffect(() => {
    const el = areaRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [messages]);

  // ---------- 输入框自适应高度 ----------
  const adjustHeight = () => {
    const el = inputRef.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = Math.min(el.scrollHeight, 140) + 'px';
  };

  const onKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      sendMessage();
    }
  };

  // ---------- 发送消息（SSE 流式，与旧版 fetch reader 实现一致） ----------
  const sendMessage = async (overrideText?: string) => {
    const text = (overrideText ?? input).trim();
    if (!text) return;
    if (streamingRef.current) {
      toast('正在协作处理中，请稍候', 'err');
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
      { id: userId, role: 'user', phase: 'done', placeholder: '', activeExperts: [], experts: [], text, started: true, collaborators: [] },
      {
        id: aiId,
        role: 'assistant',
        phase: 'routing',
        placeholder: '调度系统正在分析问题…',
        activeExperts: [],
        experts: [],
        text: '',
        started: false,
        collaborators: [],
      },
    ]);
    setInput('');
    if (inputRef.current) inputRef.current.style.height = 'auto';

    streamingRef.current = true;
    setIsStreaming(true);

    const patch = (fn: (m: MaMsg) => MaMsg) =>
      setMessages((prev) => prev.map((m) => (m.id === aiId ? fn(m) : m)));
    const patchExpert = (expertKey: string, fn: (e: MaExpertState) => MaExpertState) =>
      patch((m) => ({ ...m, experts: m.experts.map((e) => (e.key === expertKey ? fn(e) : e)) }));

    const controller = new AbortController();
    abortRef.current = controller;

    let fullText = '';

    try {
      const token = getToken();
      const resp = await fetch('/api/multi-agent/chat', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        body: JSON.stringify({ message: text }),
        signal: controller.signal,
      });
      if (!resp.ok) throw new Error(`请求失败 (${resp.status})`);

      const reader = resp.body!.getReader();
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
          const evt = ((): MaSseEvent | null => {
            try {
              return JSON.parse(payload) as MaSseEvent;
            } catch {
              return null;
            }
          })();
          if (!evt) continue;

          if (evt.type === 'routing') {
            // 路由决策：高亮专家团队 + 调度分析 + 拓扑图
            const experts = evt.experts || [];
            setActiveExperts(experts);
            patch((m) => ({
              ...m,
              routing: { experts, analysis: evt.analysis || '' },
              activeExperts: experts,
              phase: 'routing',
              placeholder: '已分发专家，正在并行处理…',
            }));
          } else if (evt.type === 'expert_start') {
            patch((m) => ({
              ...m,
              experts: [
                ...m.experts,
                { key: evt.expert, color: evt.color, avatar: evt.avatar, name: evt.name, tools: [], ragExpanded: [], done: false },
              ],
              activeExperts: m.activeExperts.includes(evt.expert) ? m.activeExperts : [...m.activeExperts, evt.expert],
              collaborators: [...m.collaborators, evt.expert],
              phase: 'experts',
            }));
          } else if (evt.type === 'tool_start') {
            const round = evt.round || 0;
            const entries = Object.entries(evt.args || {});
            const argsStr = entries.length
              ? entries.map(([k, v]) => `${k}: ${String(v)}`).join('，')
              : '（无参数）';
            patchExpert(evt.expert, (e) => ({
              ...e,
              tools: [...e.tools, { uid: `${evt.name}_r${round}`, name: evt.name, round, argsStr, state: 'running' }],
            }));
          } else if (evt.type === 'tool_end') {
            const round = evt.round || 0;
            const uid = `${evt.name}_r${round}`;
            patchExpert(evt.expert, (e) => ({
              ...e,
              tools: e.tools.map((t) =>
                t.uid === uid ? { ...t, state: evt.success === false ? 'failed' : 'done', summary: evt.summary } : t,
              ),
            }));
          } else if (evt.type === 'rag') {
            if (!evt.chunks || evt.chunks.length === 0) continue;
            patchExpert(evt.expert, (e) => (e.rag ? e : { ...e, rag: evt.chunks }));
          } else if (evt.type === 'expert_end') {
            patchExpert(evt.expert, (e) => ({
              ...e,
              done: true,
              answer: evt.answer,
              durationMs: evt.duration_ms,
              chars: evt.chars,
            }));
          } else if (evt.type === 'summarizer_start') {
            patch((m) => ({
              ...m,
              phase: 'summarizer',
              summarizer: { status: 'thinking' },
              placeholder: '汇总 Agent 正在综合各专家回答…',
            }));
          } else if (evt.type === 'summarizer_end') {
            patch((m) => ({
              ...m,
              summarizer: m.summarizer
                ? { ...m.summarizer, status: 'done', durationMs: evt.duration_ms }
                : { status: 'done', durationMs: evt.duration_ms },
            }));
          } else if (evt.type === 'token') {
            fullText += evt.content;
            patch((m) => ({
              ...m,
              started: true,
              text: fullText,
              errorText: undefined,
              summarizer:
                m.summarizer && !m.started && m.summarizer.status === 'thinking'
                  ? { ...m.summarizer, status: 'generating' }
                  : m.summarizer,
            }));
          } else if (evt.type === 'error') {
            patch((m) => ({ ...m, errorText: evt.message }));
          } else if (evt.type === 'done') {
            patch((m) => ({
              ...m,
              phase: 'done',
              toolCount: evt.toolCount,
              expertStats: evt.expertStats,
              summarizerDuration: evt.summarizerDuration,
              totalDuration: evt.totalDuration,
              errorText: undefined,
            }));
          }
        }
      }
    } catch (err) {
      if (err instanceof DOMException && err.name === 'AbortError') return;
      const msg = err instanceof Error ? err.message : String(err);
      patch((m) => ({ ...m, networkError: msg }));
    } finally {
      streamingRef.current = false;
      setIsStreaming(false);
      // 协作结束后 2s 重置专家团队高亮（与旧版一致）
      setTimeout(() => setActiveExperts([]), 2000);
    }
  };

  // ---------- 展开/收起专家 RAG 原文 ----------
  const toggleRag = (msgId: number, expertKey: string, idx: number) => {
    setMessages((prev) =>
      prev.map((m) =>
        m.id === msgId
          ? {
              ...m,
              experts: m.experts.map((e) =>
                e.key === expertKey
                  ? {
                      ...e,
                      ragExpanded: e.ragExpanded.includes(idx)
                        ? e.ragExpanded.filter((i) => i !== idx)
                        : [...e.ragExpanded, idx],
                    }
                  : e,
              ),
            }
          : m,
      ),
    );
  };

  return (
    <>
      {/* 旧页面内联样式（协作拓扑图等页面专属样式） */}
      <style>{MA_STYLE}</style>
      <main className="main">
        <div className="container" style={{ paddingTop: 8 }}>
          {/* 页面横幅 */}
          <section className="page-hero">
            <div className="ink-wash ink-wash-1" style={{ background: 'var(--cinnabar)' }}></div>
            <div className="ink-wash ink-wash-2" style={{ background: 'var(--cyan)' }}></div>
            <div className="hero-seal">
              <span className="seal seal-vertical">协作</span>
            </div>
            <h1>多智能体协作 <AiBadge style={{ fontSize: 12, padding: '2px 10px' }} /></h1>
          </section>
          <AiNotice text="本页结论由多个人工智能智能体分工协作生成，各专家意见均由模型推理得出，可能存在相互矛盾或不准确之处，请人工甄别后使用。" />

          {/* 专家团队展示 */}
          <div className="scroll-frame" style={{ marginBottom: 20 }}>
            <div className="section-title">
              <span className="st-text">专家团队</span>
              <span className="st-line"></span>
            </div>
            <div className="expert-team" id="expertTeam">
              {EXPERT_KEYS.map((key) => {
                const e = EXPERTS_META[key];
                return (
                  <div key={key} className={`expert-card${activeExperts.includes(key) ? ' expert-active' : ''}`}>
                    <div className={`expert-avatar expert-color-${e.color}`}>{e.avatar}</div>
                    <div className="expert-info">
                      <div className="expert-name">{e.name}</div>
                      <div className="expert-desc">{e.desc}</div>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>

          {/* 协作工作台 */}
          <div className="agent-main">
            <div className="chat-stream">
              <div className="chat-area" id="chatArea" ref={areaRef}>
                {messages.map((m) => (
                  <MaMessage key={m.id} m={m} onToggleRag={toggleRag} />
                ))}
              </div>
              <div className="composer-wrap">
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
                    placeholder="提出复杂问题，多专家将协作处理…"
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
          </div>
        </div>
      </main>
    </>
  );
}

/* ---------------- 单条消息 ---------------- */

function MaMessage({ m, onToggleRag }: { m: MaMsg; onToggleRag: (msgId: number, expertKey: string, idx: number) => void }) {
  const isUser = m.role === 'user';
  const cursor = m.started && !m.networkError && m.phase !== 'done';

  return (
    <div className={`msg ${m.role} fade-up`}>
      <div className={`msg-avatar${isUser ? '' : ' ma-avatar'}`}>{isUser ? '我' : '协'}</div>
      <div className="msg-body">
        {m.routing && <RoutingCard routing={m.routing} />}
        {/* 拓扑图：routing 事件后渲染；即使 routing 事件缺失，协作进入后续阶段也应出现（与旧版 renderTopology 的兜底创建一致） */}
        {m.role === 'assistant' && !m.welcome && (m.routing || m.phase !== 'routing') && <TopologyCard m={m} />}
        {m.experts.map((e) => (
          <ExpertProcessCard key={e.key} e={e} msgId={m.id} onToggleRag={onToggleRag} />
        ))}
        {m.summarizer && <SummarizerCard s={m.summarizer} />}

        <div className={`bubble${cursor ? ' stream-cursor streaming-ink' : ''}`}>
          {m.welcome ? (
            <MaWelcome />
          ) : m.networkError ? (
            <p style={{ color: 'var(--cinnabar)' }}>⚠ 网络异常：{m.networkError}</p>
          ) : m.errorText ? (
            <p style={{ color: 'var(--cinnabar)' }}>⚠ {m.errorText}</p>
          ) : m.role === 'user' ? (
            // 用户消息为纯文本（旧版仅 escapeHtml，不走 AI 回答渲染）
            m.text
          ) : m.started ? (
            <span dangerouslySetInnerHTML={{ __html: renderAnswerHtml(m.text) }} />
          ) : m.phase === 'done' ? (
            <span style={{ color: 'var(--ink-light)' }}>协作完成，但未生成回答</span>
          ) : (
            <>
              <span className="typing-dots">
                <span></span>
                <span></span>
                <span></span>
              </span>{' '}
              {m.placeholder}
            </>
          )}
        </div>

        {/* 协作完成徽章 */}
        {m.phase === 'done' && !m.welcome && m.collaborators.length > 0 && (
          <div className="msg-meta">
            <span style={{ fontSize: 12, color: 'var(--ink-light)' }}>协作专家</span>{' '}
            {m.collaborators.map((k) => {
              const e = EXPERTS_META[k];
              if (!e) return null;
              return (
                <span key={k} className={`collab-badge expert-color-${e.color}`}>
                  <span className="cb-icon">{e.avatar}</span>
                  {e.name}
                </span>
              );
            })}{' '}
            {m.toolCount && m.toolCount > 0 ? (
              <span style={{ fontSize: 11, color: 'var(--ink-light)', marginLeft: 6 }}>· 调用 {m.toolCount} 次工具</span>
            ) : null}
          </div>
        )}

        {/* 协作统计面板 */}
        {m.expertStats && (
          <CollabStats
            expertStats={m.expertStats}
            summarizerDuration={m.summarizerDuration || 0}
            totalDuration={m.totalDuration || 0}
          />
        )}
      </div>
    </div>
  );
}

function MaWelcome() {
  return (
    <>
      <p>
        您好，我是<strong>多智能体协作系统</strong>
        。我会将您的问题分发给最合适的专家 Agent 团队并行处理，再综合汇总成完整回答。
      </p>
      <p>试试问我：</p>
      <p>
        · <span style={{ color: 'var(--cinnabar)' }}>我的成绩怎么样？哪些越剧流派需要加强？</span>
        （学业顾问+越剧教授协作）
        <br />· <span style={{ color: 'var(--cinnabar)' }}>帮我分析学习情况并画一张水墨越剧图</span>
        （学业顾问+艺术指导协作）
        <br />· <span style={{ color: 'var(--cinnabar)' }}>徐派有什么特点？我的出勤如何？</span>
        （越剧教授+班主任协作）
      </p>
    </>
  );
}

/* ---------------- 路由决策卡片 ---------------- */

function RoutingCard({ routing }: { routing: { experts: string[]; analysis: string } }) {
  return (
    <div className="routing-card">
      <div className="routing-head">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
          <circle cx="12" cy="12" r="3" />
          <path d="M12 1v6M12 17v6M4.22 4.22l4.24 4.24M15.54 15.54l4.24 4.24M1 12h6M17 12h6M4.22 19.78l4.24-4.24M15.54 8.46l4.24-4.24" />
        </svg>
        调度决策
      </div>
      <div className="routing-experts">
        {routing.experts.map((k) => {
          const e = EXPERTS_META[k];
          if (!e) return null;
          return (
            <span key={k} className={`routing-badge expert-color-${e.color}`}>
              <span className="rb-icon">{e.avatar}</span>
              {e.name}
            </span>
          );
        })}
      </div>
      <div className="routing-analysis">{routing.analysis}</div>
    </div>
  );
}

/* ---------------- 协作拓扑图 ---------------- */

function TopologyCard({ m }: { m: MaMsg }) {
  const routerDone = m.phase !== 'routing';
  const summarizerActive = m.phase === 'summarizer';
  const summarizerDone = m.phase === 'done';

  const expertNodes = EXPERT_KEYS.filter((k) => m.activeExperts.includes(k)).map((k) => {
    const e = EXPERTS_META[k];
    const st = m.experts.find((x) => x.key === k);
    const isDone = !!st?.done;
    const isActive = m.phase === 'experts' && !isDone;
    return (
      <div key={k} className={`topo-node ${isDone ? 'done' : isActive ? 'active' : ''}`}>
        <div className={`topo-node-avatar ${e.color}`}>{e.avatar}</div>
        <div className="topo-node-name">{e.name}</div>
        <div className="topo-node-status">{isDone ? '已完成' : isActive ? '处理中' : '待激活'}</div>
      </div>
    );
  });

  return (
    <div className="topology-card">
      <div className="topology-title">协作拓扑图</div>
      <div className="topology-flow">
        <div className={`topo-node ${routerDone ? 'done' : 'active'}`}>
          <div className="topo-node-avatar router">调</div>
          <div className="topo-node-name">调度员</div>
          <div className="topo-node-status">{routerDone ? '已分发' : '分析中'}</div>
        </div>
        <span className={`topo-arrow ${routerDone ? 'active' : ''}`}>→</span>
        {expertNodes.length > 0 && (
          <>
            {expertNodes}
            <span className={`topo-arrow ${m.phase !== 'routing' ? 'active' : ''}`}>→</span>
          </>
        )}
        <div className={`topo-node ${summarizerActive ? 'active' : summarizerDone ? 'done' : ''}`}>
          <div className="topo-node-avatar summarizer">汇</div>
          <div className="topo-node-name">汇总 Agent</div>
          <div className="topo-node-status">{summarizerDone ? '已完成' : summarizerActive ? '汇总中' : '待汇总'}</div>
        </div>
      </div>
    </div>
  );
}

/* ---------------- 专家处理卡片 ---------------- */

function ExpertProcessCard({
  e,
  msgId,
  onToggleRag,
}: {
  e: MaExpertState;
  msgId: number;
  onToggleRag: (msgId: number, expertKey: string, idx: number) => void;
}) {
  const durationStr = e.durationMs ? ` · ${(e.durationMs / 1000).toFixed(1)}s` : '';
  const charsStr = e.chars ? ` · ${e.chars}字` : '';

  return (
    <div className={`expert-process expert-color-${e.color}`}>
      <div className="ep-head">
        <div className={`ep-avatar expert-color-${e.color}`}>{e.avatar}</div>
        <div className="ep-info">
          <div className="ep-name">{e.name}</div>
          <div className="ep-status">
            {e.done ? (
              <span className="ep-status-text">
                已完成{durationStr}
                {charsStr}
              </span>
            ) : (
              <>
                <span className="ep-spinner"></span>
                <span className="ep-status-text">正在处理…</span>
              </>
            )}
          </div>
        </div>
      </div>
      <div className="ep-tools">
        {e.tools.map((t) => (
          <div key={t.uid} className="ep-tool">
            <div className="ep-tool-head">
              <span className="ep-tool-name">
                {t.name}
                {t.round > 0 && <span className="ep-tool-round">第{t.round + 1}轮</span>}
              </span>
              <span className="ep-tool-status">
                {t.state === 'running' ? (
                  <>
                    <span className="ep-tool-spinner"></span>调用中
                  </>
                ) : t.state === 'failed' ? (
                  '失败'
                ) : (
                  '完成'
                )}
              </span>
            </div>
            <div className="ep-tool-args">{t.argsStr}</div>
            {t.state !== 'running' && (
              <div
                className="ep-tool-result"
                style={{ display: 'block' }}
                dangerouslySetInnerHTML={{ __html: renderAnswerHtml(t.summary) || '（无返回）' }}
              />
            )}
          </div>
        ))}

        {/* 专家 RAG 检索（点击展开原文） */}
        {e.rag && e.rag.length > 0 && (
          <div className="ep-rag">
            <div className="ep-rag-title">📚 知识库检索（{e.rag.length} 条，点击展开原文）</div>
            {e.rag.map((c, idx) => (
              <div
                key={idx}
                className={`ep-rag-chunk${e.ragExpanded.includes(idx) ? ' expanded' : ''}`}
                onClick={() => onToggleRag(msgId, e.key, idx)}
                {...activateProps(() => onToggleRag(msgId, e.key, idx), c.title)}
              >
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '4px 0' }}>
                  <span className="ep-rag-title-text">{c.title}</span>
                  <span className="ep-rag-score">{(c.score * 100).toFixed(0)}%</span>
                </div>
                <div className="ep-rag-content">{c.content || '（无内容）'}</div>
              </div>
            ))}
          </div>
        )}
      </div>
      {e.done && (
        <div className="ep-answer" style={{ display: 'block' }} dangerouslySetInnerHTML={{ __html: renderAnswerHtml(e.answer) }} />
      )}
    </div>
  );
}

/* ---------------- 汇总 Agent 卡片 ---------------- */

function SummarizerCard({ s }: { s: { status: 'thinking' | 'generating' | 'done'; durationMs?: number } }) {
  const statusText = s.status === 'done' ? `已完成 · ${s.durationMs ?? 0}ms` : s.status === 'generating' ? '生成中…' : '综合中…';
  return (
    <div className="summarizer-card">
      <div className="summarizer-head">
        <div className="summarizer-avatar">汇</div>
        <div className="summarizer-title">汇总 Agent</div>
        <div className={`summarizer-status${s.status === 'thinking' ? ' thinking' : ''}`}>{statusText}</div>
      </div>
      <div style={{ fontSize: 12, color: 'var(--ink-light)', lineHeight: 1.7 }}>
        融合各专家观点，去除重复，保持逻辑连贯，输出最终答案
      </div>
    </div>
  );
}

/* ---------------- 协作统计面板 ---------------- */

function CollabStats({
  expertStats,
  summarizerDuration,
  totalDuration,
}: {
  expertStats: Record<string, { duration: number; tools: number; chars: number }>;
  summarizerDuration: number;
  totalDuration: number;
}) {
  return (
    <div className="collab-stats">
      {Object.entries(expertStats).map(([k, v]) => {
        const e = EXPERTS_META[k];
        if (!e) return null;
        return (
          <div key={k} className="collab-stat">
            <div className="collab-stat-label">{e.name} 耗时</div>
            <div className="collab-stat-value">
              {(v.duration / 1000).toFixed(1)}s · {v.tools}工具 · {v.chars}字
            </div>
          </div>
        );
      })}
      <div className="collab-stat">
        <div className="collab-stat-label">汇总 Agent 耗时</div>
        <div className="collab-stat-value">{(summarizerDuration / 1000).toFixed(1)}s</div>
      </div>
      <div className="collab-stat">
        <div className="collab-stat-label">总协作耗时</div>
        <div className="collab-stat-value" style={{ color: 'var(--cinnabar)' }}>
          {(totalDuration / 1000).toFixed(1)}s
        </div>
      </div>
    </div>
  );
}
