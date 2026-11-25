// 演唱测评 · AI 准确度点评
// ============================================================
// 算法（librosa/pyworld/DTW）输出结构化报告后，这里把报告中的
// 数值统计与偏差片段交给讯飞星辰大模型，生成"准确度"的拟人化点评：
// 测准分 + 总评 + 亮点 / 不足 / 练习建议。
// 与 aiGrade.js 相同，复用 callAgent（HTTP 工作流优先，WebSocket 兜底）。
// ============================================================
import { callAgent } from '../xingchenWs.js';
import { parseJsonLoose } from '../aiGrade.js';

const AI_PROMPT = `你是「越韵智传」越剧演唱测评专家，精通越剧唱腔、音准与节奏板眼。
你会收到系统算法对一段清唱的客观测评数据（音准/节奏的数值统计与偏差片段）。
请依据这些数据，对学生演唱的"准确度"给出专业、客观、鼓励性的中文点评。

【硬性约束】
1. 只依据提供的测评数据判断，不得编造数据中不存在的信息。
2. 分数均为参考分；点评客观温和，不得使用"很差、离谱、完全不行"等绝对化贬义词。
3. 输出必须是合法 JSON（不要 markdown 代码块、不要任何解释文字）：
{"accuracy_score":0到100的整数,"summary":"总评（60字内）","strengths":["亮点1","亮点2"],"issues":["不足1","不足2"],"suggestions":["练习建议1","练习建议2"]}`;

// 把结构化报告转成 LLM 易读的摘要文本
function summarizeReport(report) {
  const segs = (report.problem_segments || [])
    .map((s) => `[${s.dim === 'pitch' ? '音准' : '板眼'} ${s.start_time}-${s.end_time}秒] ${s.problem_desc}`)
    .join('\n');
  return [
    `总参考分：${report.total_score}`,
    `音准参考分：${report.pitch_score ?? '未评'}（中位偏差 ${report.stats?.median_abs_dev_cents ?? '?'} 音分，50音分内占比 ${report.stats?.within_50_cents_ratio ?? '?'}）`,
    `节奏板眼参考分：${report.rhythm_score ?? '未评'}（演唱/范本时长比 ${report.stats?.tempo_ratio ?? '?'}）`,
    `偏差片段：\n${segs || '无明显偏差片段'}`,
  ].join('\n');
}

/**
 * AI 准确度点评
 * @param {object} report 算法分析的结构化报告
 * @returns {Promise<{ai_score: number|null, summary: string, strengths: string[], issues: string[], suggestions: string[]}>}
 */
export async function assessSingingAccuracy(report) {
  const userMsg = `以下是一段越剧演唱的算法测评数据（参考分）：\n\n${summarizeReport(report)}\n\n请按 JSON 格式输出准确度点评。`;

  const raw = await callAgent(
    [
      { role: 'system', content: AI_PROMPT },
      { role: 'user', content: userMsg },
    ],
    { timeout: 60000, maxTokens: 2048 }
  );

  const data = parseJsonLoose(raw);
  if (!data || typeof data !== 'object') {
    return { ai_score: null, summary: 'AI 点评解析失败，请稍后重试', strengths: [], issues: [], suggestions: [] };
  }

  const toArr = (v) => (Array.isArray(v) ? v.map(String).filter(Boolean).slice(0, 4) : []);
  let aiScore = Number(data.accuracy_score ?? data.ai_score ?? data.score);
  if (!Number.isFinite(aiScore)) aiScore = null;
  if (aiScore !== null) aiScore = Math.max(0, Math.min(100, Math.round(aiScore)));

  return {
    ai_score: aiScore,
    summary: data.summary || data.总评 || 'AI 已完成点评',
    strengths: toArr(data.strengths || data.亮点),
    issues: toArr(data.issues || data.不足),
    suggestions: toArr(data.suggestions || data.suggestion || data.建议),
  };
}
