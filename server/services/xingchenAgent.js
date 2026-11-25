// 讯飞星辰 Agent 智能问答：RAG 检索增强 + GraphRAG 图谱检索 + 联网搜索 + WebSocket 流式调用
import { callAgent } from './xingchenWs.js';
import { knowledgeCards } from './knowledgeBase.js';
import { retrieveKnowledge, buildRagContext } from './ragRetrieval.js';
import { retrieveGraphContext } from './kgService.js';
import { safeCall } from '../utils/resilience.js';
import { askYuejuLocal, isYuejuLocalHealthy, shouldUseYuejuLocal } from './yuejuLocalLlm.js';
import { emitPaced } from '../utils/pace.js';

// 越剧领域系统提示词，引导模型以一位真人老师般的自然、口语化风格回答
const SYSTEM_PROMPT = `你是「越韵智传」越剧教学系统里的「越剧先生」，一位温厚、亲切、见多识广的越剧老师，此刻正与一位学生面对面聊天。
说话风格：
1. 自然口语化，像真人老师当面讲解，不要生硬罗列要点，避免"首先/其次/最后"这类机械开场。
2. 语气温和有温度，句子长短错落，读起来顺口、像人说的话；可以适当用"咱们""你瞧""不妨这样理解"等口语衔接。
3. 内容须准确专业，涉及典籍、剧目、流派、名段时，在相关内容后用【出处：《剧目名》/ 流派 / 典籍名】标注来源，便于查证。
4. 若问题超出越剧范畴，自然地引回越剧话题，别生硬打断。
5. 对于流派（如袁派、尹派、范派、傅派、徐派、戚派等）要准确区分其代表人物与唱腔特点。
6. 篇幅适中、重点突出，别堆砌长段知识点，讲清楚一个点比罗列十个点更好。
7. 若提供了「检索资料」，须优先参考其中信息作答，不得与资料矛盾；资料未覆盖的可结合自身知识补充但需说明。`;

/**
 * 流式问答（含 RAG 检索增强）
 * messages: [{role, content}]
 * onToken: 每收到一段文本回调
 * onRag: RAG 检索完成回调（返回检索到的知识片段）
 * onPlugin: 联网搜索结果回调
 * ragOptions: { enable: true, topK: 3, minScore: 0.3 }
 */
export async function streamChat({ messages, onToken, onRag, onPlugin, ragOptions }) {
  // ===== 1. RAG 检索（向量检索 + GraphRAG 图谱检索）=====
  let ragContext = '';
  let ragChunks = [];
  const enableRag = !ragOptions || ragOptions.enable !== false;
  if (enableRag && messages.length > 0) {
    // 取最后一条 user 消息作为查询
    const lastUser = [...messages].reverse().find(m => m.role === 'user');
    if (lastUser && lastUser.content) {
      // 并行执行向量检索和图谱检索，任一失败都不影响主流程
      const [vecChunks, graphResult] = await Promise.allSettled([
        safeCall(
          () => retrieveKnowledge(lastUser.content, {
            topK: ragOptions?.topK || 3,
            minScore: ragOptions?.minScore || 0.3,
          }),
          [],
          'RAG向量检索'
        ),
        safeCall(
          () => retrieveGraphContext(lastUser.content, { maxEntities: 5 }),
          null,
          'GraphRAG图谱检索'
        ),
      ]);

      if (vecChunks.status === 'fulfilled') {
        ragChunks = vecChunks.value;
        ragContext = buildRagContext(ragChunks);
        if (onRag && ragChunks.length > 0) onRag(ragChunks);
      }

      // 融合 GraphRAG 上下文
      if (graphResult.status === 'fulfilled' && graphResult.value?.context) {
        ragContext = (ragContext ? ragContext + '\n\n' : '') + graphResult.value.context;
      }
    }
  }

  // ===== 2. 构造完整消息（注入 RAG 上下文）=====
  const fullMessages = [];
  if (ragContext) {
    // 把 RAG 上下文拼到 system prompt 后面
    fullMessages.push({ role: 'system', content: SYSTEM_PROMPT + '\n\n' + ragContext });
  } else {
    fullMessages.push({ role: 'system', content: SYSTEM_PROMPT });
  }
  fullMessages.push(...messages);

  // ===== 3. 调用云端 LLM；云端不可用时自动降级 =====
  // 过去这里一旦星辰工作流报错，整页只能显示“问答服务暂时不可用”。
  // 现在保留云端能力，同时保证校本知识库与本地模型能独立完成基础问答。
  let streamedText = '';
  try {
    const fullText = await callAgent(fullMessages, {
      timeout: 30000,
      onToken: (token) => {
        streamedText += token;
        if (onToken) onToken(token);
      },
      onPlugin: (pluginText) => {
        console.log('[xingchenAgent] 联网搜索结果:', String(pluginText).slice(0, 100));
        if (onPlugin) onPlugin(pluginText);
      },
    });
    if (fullText?.trim()) return fullText;
  } catch (err) {
    console.warn('[xingchenAgent] 云端问答失败，启用本地兜底:', err.message);
    // 若云端已经输出了正文，就保留已收到的内容，避免重复追加另一份答案。
    if (streamedText.trim()) return streamedText;
  }

  const lastUser = [...messages].reverse().find(m => m.role === 'user');
  const question = lastUser?.content || '';

  // 没有可靠检索资料时，再尝试本地微调模型。
  if (question && ragChunks.length === 0 && shouldUseYuejuLocal(question)) {
    try {
      if (await isYuejuLocalHealthy()) {
        const localAnswer = await askYuejuLocal(question, { timeout: 20000 });
        if (localAnswer?.trim()) {
          await emitPaced(localAnswer, onToken);
          return localAnswer;
        }
      }
    } catch (err) {
      console.warn('[xingchenAgent] 本地模型兜底失败:', err.message);
    }
  }

  const fallback = buildKnowledgeFallback(question, ragChunks);
  if (fallback) {
    await emitPaced(fallback, onToken);
    return fallback;
  }

  throw Object.assign(new Error('当前生成模型暂不可用，且校本知识库未检索到足够可靠的资料'), {
    status: 503,
    expose: true,
  });
}

/**
 * 根据已通过置信度门控的 RAG 片段生成可直接展示的保底回答。
 * 只复述检索资料，不补猜未知事实，因此即使外部模型离线也能稳定工作。
 */
export function buildKnowledgeFallback(question, chunks = []) {
  if (!chunks.length) return '';
  const topScore = Number(chunks[0]?.score || 0);
  const selected = chunks
    .filter((chunk, index) => index === 0 || Number(chunk.score || 0) >= topScore * 0.86)
    .slice(0, 2);
  const paragraphs = selected.map((chunk, index) => {
    let content = String(chunk.content || '').trim();
    if (!content) return '';
    const limit = selected.length === 1 ? 560 : 380;
    if (content.length > limit) {
      const clipped = content.slice(0, limit);
      const sentenceEnd = Math.max(clipped.lastIndexOf('。'), clipped.lastIndexOf('；'));
      content = `${sentenceEnd >= 120 ? clipped.slice(0, sentenceEnd + 1) : clipped}…`;
    }
    return selected.length === 1 ? content : `${index + 1}. ${content}`;
  }).filter(Boolean);
  if (!paragraphs.length) return '';
  const citations = [...new Set(selected.map(chunk => chunk.sourceName || chunk.title).filter(Boolean))];
  const sourceText = citations.length ? `\n\n【出处：${citations.join(' / ')}】` : '';
  return `我翻了下校本越剧知识库，关于“${String(question || '').trim()}”最相关的说法是这样的：\n\n${paragraphs.join('\n\n')}${sourceText}`;
}

// 从回答文本中提取出处标注（匹配【出处：...】）
export function extractSources(text) {
  const sources = [];
  const regex = /【出处：([^】]+)】/g;
  let match;
  while ((match = regex.exec(text)) !== null) {
    const raw = match[1].trim();
    const parts = raw.split('/').map(s => s.trim()).filter(Boolean);
    for (const part of parts) {
      sources.push({ title: part, type: guessSourceType(part) });
    }
  }
  const seen = new Set();
  return sources.filter(s => {
    const key = s.title;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function guessSourceType(name) {
  const schools = ['袁派', '尹派', '范派', '傅派', '徐派', '戚派', '王派', '陆派', '金派', '张派', '毕派', '吕派'];
  const roles = ['生', '旦', '净', '末', '丑', '小生', '花旦', '青衣', '老生', '老旦', '小丑'];
  if (schools.some(s => name.includes(s))) return '流派';
  if (roles.some(r => name === r || name.includes(r))) return '行当';
  if (name.startsWith('《') || name.endsWith('记') || name.endsWith('传') || name.endsWith('梦')) return '剧目';
  return '典籍';
}

// 根据用户问题与回答，生成相关知识卡片（基于关键词匹配本地知识库）
export function buildKnowledgeCards(question, answer) {
  const text = (question + ' ' + answer).toLowerCase();
  const matched = knowledgeCards.filter(card =>
    card.keywords.some(kw => text.includes(kw.toLowerCase()))
  );
  return matched.slice(0, 3);
}
