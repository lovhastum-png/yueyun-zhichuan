// 本地微调越剧模型调用服务
// 调用 models/yueju_asr_correct/serve.py 提供的 HTTP /ask 接口
// 需要先在本地启动: python models/yueju_asr_correct/serve.py
//
// 自研本地 LoRA 微调模型（体现技术先进性，无网络依赖）
// 与讯飞星辰 Agent（云端，带 RAG）互为补充。
//
// 推荐策略: 优先本地，本地不可用降级到讯飞平台
import logger from '../utils/logger.js';

const log = logger.module('YUEJU_LOCAL_LLM');

const LOCAL_URL = process.env.YUEJU_LLM_LOCAL_URL || 'http://127.0.0.1:3456';

/**
 * 调用本地微调越剧模型（非流式）
 * @param {string} question 用户问题
 * @param {object} options { maxNewTokens, timeout }
 * @returns {Promise<string>} 模型回答
 */
export async function askYuejuLocal(question, options = {}) {
  if (!question || !question.trim()) return '';

  const timeout = options.timeout ?? 15000;
  const maxNewTokens = options.maxNewTokens ?? 512;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeout);

  try {
    log.info(`调用本地越剧模型，问题长度=${question.length}`);
    const resp = await fetch(`${LOCAL_URL}/ask`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ question: question.trim(), max_new_tokens: maxNewTokens }),
      signal: controller.signal,
    });
    clearTimeout(timer);

    if (!resp.ok) {
      const errText = await resp.text().catch(() => '');
      log.error(`本地模型调用失败: ${resp.status} ${errText}`);
      throw new Error(`本地越剧模型调用失败: ${resp.status}`);
    }

    const data = await resp.json();
    const answer = data?.answer || data?.corrected || '';
    log.info(`本地模型返回，回答长度=${answer.length}`);
    return answer;
  } catch (err) {
    clearTimeout(timer);
    if (err.name === 'AbortError') {
      log.warn('本地模型调用超时');
      throw new Error('本地越剧模型响应超时');
    }
    throw err;
  }
}

/**
 * 检查本地越剧模型服务是否健康
 * @returns {Promise<boolean>}
 */
export async function isYuejuLocalHealthy() {
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 2000);
    const resp = await fetch(`${LOCAL_URL}/health`, { signal: controller.signal });
    clearTimeout(timer);
    if (!resp.ok) return false;
    const data = await resp.json();
    return data.model_loaded === true;
  } catch {
    return false;
  }
}

/**
 * 智能路由：根据问题特征决定是否使用本地微调模型
 * 简单越剧常识问题 → 本地微调模型（自研，体现技术先进性，响应快）
 * 需要权威出处/复杂推理/工具调用 → 讯飞 Agent（带 RAG + 工具）
 * @param {string} question
 * @returns {boolean} 是否使用本地模型
 */
export function shouldUseYuejuLocal(question) {
  if (!question || question.length > 300) return false;

  // 越剧常识关键词（适合本地模型回答）
  const commonKeywords = [
    '越剧', '袁派', '尹派', '范派', '傅派', '徐派', '戚派', '王派', '陆派', '毕派', '吕派', '金派', '张派',
    '梁山伯', '祝英台', '红楼梦', '贾宝玉', '林黛玉', '西厢记', '祥林嫂', '追鱼', '何文秀', '北地王',
    '小生', '花旦', '老生', '老旦', '小丑', '行当', '流派', '唱腔', '水袖', '台步', '身段',
    '嵊州', '嵊县', '小歌班', '的笃班', '非遗', '四工调', '尺调', '弦下调',
    '袁雪芬', '尹桂芳', '范瑞娟', '傅全香', '徐玉兰', '王文娟', '戚雅仙',
  ];

  // 需要 RAG 权威出处/工具的关键词 → 不用本地模型
  const ragKeywords = ['出处', '原文', '典籍', '论文', '引用', '来源', '依据'];
  // 需要工具调用的关键词 → 不用本地模型
  const toolKeywords = ['我的', '帮我', '查询', '生成图片', '画一张', '画个', '签到', '成绩', '作业', '考试', '课程'];

  const hasYueju = commonKeywords.some(k => question.includes(k));
  const needsRag = ragKeywords.some(k => question.includes(k));
  const needsTool = toolKeywords.some(k => question.includes(k));

  // 是越剧知识问题且不需要 RAG/工具 → 用本地模型
  return hasYueju && !needsRag && !needsTool;
}
