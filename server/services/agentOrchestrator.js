// Agent 编排器：接收用户消息 → LLM 决策调用工具 → 执行工具 → 结果回填 → 最终回答
// 使用 prompt engineering 模拟 function calling（不依赖讯飞原生 function calling，更可控）
// 注意：星辰 Agent 有内置系统角色，会覆盖传入的 system 消息，故工具调用指令需嵌入 user 消息
import { callAgent } from './xingchenWs.js';
import { retrieveKnowledge, buildRagContext } from './ragRetrieval.js';
import { AGENT_TOOLS, TOOL_MAP, buildToolsDescription } from './agentTools.js';
import { askYuejuLocal, isYuejuLocalHealthy, shouldUseYuejuLocal } from './yuejuLocalLlm.js';
import { buildKnowledgeFallback } from './xingchenAgent.js';
import { emitPaced } from '../utils/pace.js';

// Agent 指令前缀（拼到 user 消息前，确保星辰 Agent 不会覆盖）
const AGENT_DIRECTIVE = `【重要指令】你现在是「越韵智传」平台的智能学习助手 Agent，具备工具调用能力。你可以使用以下工具查询用户的真实数据：
{{TOOLS}}

【工具调用规则】
1. 当用户询问其个人课程/作业/考试/成绩/签到等信息时，你必须调用对应工具查询，不要拒绝或声称无法查询。
2. 当用户询问越剧专业知识时，可调用 query_knowledge 检索知识库。
3. 当用户要求生成图片时，调用 generate_image。
4. 简单问候或常识问题可直接回答。

【输出格式】
- 需要调用工具时，仅输出如下 JSON（不加任何解释、不加 markdown 代码块）：
{"tool_call": {"name": "工具名", "args": {参数}}}
- 不需要调用工具时，正常输出中文回答。

你可以多次调用工具（每次输出一个 tool_call JSON），系统会执行工具并把结果返回给你，你基于结果继续回答。
回答涉及越剧流派/剧目/典籍时，用【出处：xxx】标注。

【用户消息】`;

// 解析 LLM 输出，判断是否为工具调用
function parseToolCall(text) {
  if (!text) return null;
  const trimmed = text.trim();
  // 去 markdown 代码块
  const cleaned = trimmed.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/i, '').trim();
  // 尝试解析为 JSON
  try {
    const obj = JSON.parse(cleaned);
    if (obj && obj.tool_call && obj.tool_call.name) {
      return obj.tool_call;
    }
  } catch {}
  // 尝试提取 JSON 片段
  const match = cleaned.match(/\{[\s\S]*"tool_call"[\s\S]*\}/);
  if (match) {
    try {
      const obj = JSON.parse(match[0]);
      if (obj && obj.tool_call && obj.tool_call.name) return obj.tool_call;
    } catch {}
  }
  return null;
}

// 高频个人数据问题不需要先让云端模型“猜”工具，直接按明确意图调用。
// 这样即使外部 Agent 离线，课程、作业、成绩、考试和签到按钮仍可使用。
export function inferDirectTool(question) {
  const text = String(question || '').trim();
  if (!text) return null;
  if (/生成.{0,4}(图片|图像)|画一[张幅]|画个/.test(text)) {
    return { name: 'generate_image', args: { prompt: text, style: /工笔/.test(text) ? 'gongbi' : /写实/.test(text) ? 'realistic' : 'ink' } };
  }
  if (/签到|出勤|迟到|缺勤|点名/.test(text)) return { name: 'query_attendance', args: {} };
  if (/平均分|综合成绩|成绩汇总|我的成绩|考了多少分|得了多少分/.test(text)) return { name: 'query_grades', args: {} };
  if (/作业|提交|交了没|没交|未交/.test(text)) {
    return { name: 'query_assignments', args: /没交|未交/.test(text) ? { status: 'unsubmitted' } : {} };
  }
  if (/考试|测验|开考|交卷/.test(text)) return { name: 'query_exams', args: {} };
  if (/(我的|已选|有哪些|查询).{0,5}(课|课程)|课程列表|选了什么课/.test(text)) return { name: 'query_courses', args: {} };
  return null;
}

/**
 * Agent 编排主函数
 * @param {object} params
 * @param {Array} params.messages - 历史消息 [{role, content}]
 * @param {number} params.userId - 当前用户ID
 * @param {function} params.onToken - 文本流式回调
 * @param {function} params.onToolStart - 工具开始执行回调 (toolName, args)
 * @param {function} params.onToolEnd - 工具执行完成回调 (toolName, result)
 * @param {function} params.onRag - RAG 检索回调
 * @returns {Promise<string>} 最终回答
 */
export async function runAgent({ messages, userId, onToken, onToolStart, onToolEnd, onRag }) {
  const maxRounds = 4; // 最多 4 轮工具调用
  const toolsDesc = buildToolsDescription();
  const directive = AGENT_DIRECTIVE.replace('{{TOOLS}}', toolsDesc);

  // ===== 本地微调模型路由 =====
  // 纯越剧知识问题优先用本地自研微调模型（体现技术先进性，响应快）
  // 本地不可用或需要工具/RAG 时降级到讯飞 Agent
  const lastUserMsg = [...messages].reverse().find(m => m.role === 'user');
  const userQuestion = lastUserMsg?.content || '';

  const directTool = inferDirectTool(userQuestion);
  if (directTool && TOOL_MAP[directTool.name]) {
    if (onToolStart) onToolStart(directTool.name, directTool.args);
    const result = await TOOL_MAP[directTool.name](userId, directTool.args);
    if (onToolEnd) onToolEnd(directTool.name, result);
    const answer = result.success
      ? `我已为你查询：${result.summary}`
      : `查询没有成功：${result.summary}`;
    await emitPaced(answer, onToken);
    return answer;
  }

  if (userQuestion && shouldUseYuejuLocal(userQuestion)) {
    try {
      const healthy = await isYuejuLocalHealthy();
      if (healthy) {
        console.log('[Agent] 路由到本地微调越剧模型');
        const answer = await askYuejuLocal(userQuestion, { timeout: 20000 });
        if (answer && answer.trim()) {
          await emitPaced(answer, onToken);
          return answer;
        }
        // 本地模型返回空，降级到讯飞 Agent
        console.warn('[Agent] 本地模型返回空，降级到讯飞 Agent');
      } else {
        console.warn('[Agent] 本地模型服务未就绪，降级到讯飞 Agent');
      }
    } catch (err) {
      console.warn('[Agent] 本地模型调用失败，降级到讯飞 Agent:', err.message);
    }
  }
  // ===== 降级路径：走讯飞 Agent 工具调用流程 =====

  // 构造对话：把指令前缀拼到最后一条 user 消息前，确保星辰 Agent 能看到工具说明
  // 历史消息保持原样，只在当前轮的 user 消息前加指令
  let conversationMessages = messages.map(m => ({ ...m }));
  // 记录本对话中生成的图片，用于在最终回答里保留图片标记
  const generatedImageUrls = [];

  for (let round = 0; round <= maxRounds; round++) {
    // 找到最后一条 user 消息并加上指令前缀
    const fullMessages = conversationMessages.map((m, i) => {
      if (m.role === 'user' && i === conversationMessages.length - 1) {
        return { role: 'user', content: directive + m.content };
      }
      return m;
    });

    let llmOutput;
    try {
      llmOutput = await callAgent(fullMessages, {
        timeout: 30000,
      });
    } catch (err) {
      // 云端 Agent 不可用时，知识类问题仍由本地 RAG 可靠回答。
      const chunks = await retrieveKnowledge(userQuestion, { topK: 3, minScore: 0.3 }).catch(() => []);
      const fallback = buildKnowledgeFallback(userQuestion, chunks);
      if (fallback) {
        if (onRag) onRag(chunks);
        await emitPaced(fallback, onToken);
        return fallback;
      }
      throw new Error(`Agent 决策失败：${err.expose ? err.message : 'AI 服务异常'}`);
    }

    // 检查是否是工具调用
    const toolCall = parseToolCall(llmOutput);

    if (toolCall) {
      // ===== 执行工具 =====
      const { name, args = {} } = toolCall;
      const tool = TOOL_MAP[name];
      if (!tool) {
        // 工具不存在，告诉 LLM
        conversationMessages.push({ role: 'assistant', content: llmOutput });
        conversationMessages.push({ role: 'user', content: `工具 ${name} 不存在，请使用可用工具或直接回答。` });
        continue;
      }

      // 通知前端工具开始
      if (onToolStart) onToolStart(name, args);

      // 执行工具
      let result;
      try {
        result = await tool(userId, args);
      } catch (err) {
        result = { success: false, data: null, summary: `工具执行失败：${err.message}` };
      }

      // 记录生成的图片 URL
      if (name === 'generate_image' && result.imageUrl) {
        generatedImageUrls.push(result.imageUrl);
      }

      // 通知前端工具完成
      if (onToolEnd) onToolEnd(name, result);

      // 把工具结果加入对话
      conversationMessages.push({ role: 'assistant', content: llmOutput });
      conversationMessages.push({
        role: 'user',
        content: `[工具 ${name} 返回结果]\n${result.summary}\n\n请基于以上结果回答我的问题。如果需要更多信息，可以继续调用其他工具；如果信息足够，请直接给出完整回答。`,
      });

      // 继续下一轮，让 LLM 基于工具结果生成回答
      continue;
    }

    // ===== 不是工具调用，这是最终回答 =====
    // 先做 RAG 检索增强（如果回答涉及越剧知识）
    let ragContext = '';
    const lastUser = [...messages].reverse().find(m => m.role === 'user');
    if (lastUser && lastUser.content) {
      try {
        const chunks = await retrieveKnowledge(lastUser.content, { topK: 2, minScore: 0.4 });
        if (chunks.length > 0) {
          ragContext = buildRagContext(chunks);
          if (onRag) onRag(chunks);
        }
      } catch {}
    }

    // 如果有 RAG 上下文且 LLM 回答可能不够准确，做一次增强回答
    if (ragContext && llmOutput.length < 200) {
      const enhancedMessages = [
        ...conversationMessages.map((m, i) => {
          if (m.role === 'user' && i === conversationMessages.length - 1) {
            return { role: 'user', content: directive + '请结合以下检索到的知识资料，补充完善你的回答。\n\n' + ragContext + '\n\n' + m.content };
          }
          return m;
        }),
      ];
      try {
        let enhanced = '';
        await callAgent(enhancedMessages, {
          onToken: (token) => { enhanced += token; if (onToken) onToken(token); },
          timeout: 30000,
        });
        return appendImageMarks(enhanced, generatedImageUrls, onToken);
      } catch {
        // 增强失败，返回原始回答
        await emitPaced(llmOutput, onToken);
        return appendImageMarks(llmOutput, generatedImageUrls, onToken);
      }
    }

    // 直接推送最终回答（决策调用未挂 onToken 以免内部 JSON 外泄，这里匀速放出保持流式观感）
    await emitPaced(llmOutput, onToken);
    return appendImageMarks(llmOutput, generatedImageUrls, onToken);
  }

  // 超过最大轮数
  const fallback = '抱歉，我经过多轮工具调用仍未能完成你的请求，请尝试换个问法或直接说明你的需求。';
  await emitPaced(fallback, onToken);
  return appendImageMarks(fallback, generatedImageUrls, onToken);
}

// 若对话中生成了图片但回答里未保留图片标记，则在末尾追加并通过 token 推送
function appendImageMarks(answer, imageUrls, onToken) {
  if (!imageUrls || imageUrls.length === 0) return answer;
  const existing = new Set((answer.match(/【图片：([^\s】]+)】/g) || []).map(m => m.replace(/【图片：|】/g, '')));
  const missing = imageUrls.filter(url => !existing.has(url));
  if (missing.length === 0) return answer;
  const marks = '\n\n' + missing.map(url => `【图片：${url}】`).join('\n');
  if (onToken) onToken(marks);
  return answer.trim() + marks;
}
