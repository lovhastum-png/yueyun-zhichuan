// 演唱测评报告 · 下游系统导出适配器
// ============================================================
// 把 analyze 生成的结构化报告送往三个下游：
//   1. 多智能体：把报告摘要注入多智能体对话，由「越剧教授」解读
//   2. AI 批改：复用 aiGrade 的 LLM 评阅能力，产出分数 + 评语 + 亮点/不足
//   3. 学习通作业系统：调用开放 API 回传；未配置时降级为「生成可下载作业包」
//
// 【设计原则】
// - 任何下游不可用时，都必须返回**可展示的降级结果**，绝不能只回一句
//   「接口已预留」让用户以为功能坏了（历史上就是这么被当成 bug 报上来的）。
// - 所有下游调用都要有超时与错误兜底，异常不得穿透到路由层变 500。
// ============================================================
import path from 'path';
import fsp from 'fs/promises';
import { assessSingingAccuracy } from './aiFeedback.js';
import { gradeAssignment } from '../aiGrade.js';
import logger from '../../utils/logger.js';

const log = logger.module('SINGING_EXPORT');

// 字段容错：analyzer.py 的规范字段是 start_time/end_time/dim/problem_desc，
// 但下游（或人工构造的作业包）可能用 start/end/issue/detail 等别名。
// 这里统一归一化，避免摘要里出现 "undefined-undefined秒 undefined"。
const pick = (obj, keys) => {
  for (const k of keys) {
    const v = obj?.[k];
    if (v !== undefined && v !== null && v !== '') return v;
  }
  return undefined;
};

function normalizeSegment(s) {
  const start = pick(s, ['start_time', 'start', 'startTime', 'begin']);
  const end = pick(s, ['end_time', 'end', 'endTime', 'stop']);
  const dim = pick(s, ['dim', 'dimension', 'type']);
  const desc = pick(s, ['problem_desc', 'detail', 'issue', 'desc', 'description', 'message']);
  const dimLabel = dim === 'pitch' || dim === 'rhythm' ? (dim === 'pitch' ? '音准' : '板眼') : (dim || '偏差');
  const range = start !== undefined && end !== undefined
    ? `${Number(start).toFixed(1)}-${Number(end).toFixed(1)}秒`
    : (start !== undefined ? `${Number(start).toFixed(1)}秒起` : '时间未标注');
  return `[${dimLabel} ${range}] ${desc ?? '（未描述）'}`;
}

/** 报告 → 人类可读摘要（给 LLM / 下游系统用的上下文） */
export function summarizeReport(report = {}) {
  const segs = (report.problem_segments || [])
    .slice(0, 12)
    .map(normalizeSegment)
    .join('\n');
  return [
    `总参考分：${report.total_score}`,
    `音准参考分：${report.pitch_score ?? '未评'}（中位偏差 ${report.stats?.median_abs_dev_cents ?? '?'} 音分，50音分内占比 ${report.stats?.within_50_cents_ratio ?? '?'}）`,
    `节奏板眼参考分：${report.rhythm_score ?? '未评'}（演唱/范本时长比 ${report.stats?.tempo_ratio ?? '?'}）`,
    `范本时长：${report.meta?.ref_duration ?? '?'}s，演唱时长：${report.meta?.stu_duration ?? '?'}s`,
    `偏差片段：\n${segs || '无明显偏差片段'}`,
  ].join('\n');
}

/** 报告 → 给多智能体的专家上下文（纯文本，可直接塞进对话） */
export function reportToAgentContext(report) {
  return [
    '【演唱测评报告】以下是系统对一段越剧清唱的客观算法测评结果，请据此解读并给出练习指导。',
    summarizeReport(report),
    `免责：${report.disclaimer || '本测评仅为教学演示参考'}`,
    `范围：${report.scope || '仅评估音准与节奏板眼'}`,
  ].join('\n');
}

/**
 * 发送测评报告给多智能体模块
 * 产出：一段可直接注入多智能体对话的专家上下文
 * @param {object} report analyze 返回的结构化报告 JSON
 * @param {{ sessionId?: string, question?: string }} ctx 上下文
 */
export async function sendReportToMultiAgent(report, ctx = {}) {
  const context = reportToAgentContext(report);
  const suggestion = ctx.question
    || '请以越剧教授的身份，结合这份测评报告，指出我音准与板眼上的主要问题，并给出可执行的练习步骤。';
  return {
    target: 'multi-agent',
    status: 'ok',
    received: true,
    summary: '报告已整理为多智能体专家上下文，可直接发起解读',
    context,
    suggestion,
    ctxKeys: Object.keys(ctx),
  };
}

/**
 * 提交测评报告给 AI 批改
 * 产出：分数 + 总评 + 亮点 / 不足 / 练习建议（复用星辰大模型）
 * @param {object} report 结构化报告 JSON
 * @param {{ assignmentTitle?: string, totalScore?: number }} ctx
 */
export async function submitToAiGrading(report, ctx = {}) {
  const maxScore = Number(ctx.totalScore) || 100;
  try {
    const fb = await assessSingingAccuracy(report);
    const score = fb.ai_score ?? report.total_score ?? 0;
    const normalized = Math.max(0, Math.min(100, Math.round((score / 100) * maxScore)));
    log.info(`AI 批改完成: ${normalized}/${maxScore}`);
    return {
      target: 'ai-grading',
      status: 'ok',
      received: true,
      summary: 'AI 批改已完成',
      grade: {
        score: normalized,
        maxScore,
        feedback: fb.summary || 'AI 已完成评阅',
        strengths: fb.strengths || [],
        weaknesses: fb.issues || [],
        suggestions: fb.suggestions || [],
        confidence: 0.8,
        grader: '星辰大模型 · 越剧演唱测评专家',
      },
    };
  } catch (err) {
    log.warn(`AI 批改调用失败: ${err.message}`);
    // 降级：LLM 不可用时不假装成功，明确告知并给出算法侧的客观结论
    return {
      target: 'ai-grading',
      status: 'degraded',
      received: true,
      summary: 'AI 批改服务暂不可用，已回退为算法侧客观结论',
      grade: {
        score: report.total_score ?? 0,
        maxScore,
        feedback: `AI 点评服务暂不可用。算法侧客观结论：音准 ${report.pitch_score ?? '未评'} 分，节奏板眼 ${report.rhythm_score ?? '未评'} 分。`,
        strengths: [],
        weaknesses: (report.problem_segments || []).slice(0, 3).map((s) => s.problem_desc),
        suggestions: [report.suggestion || '请对照范本放慢速度逐句模唱。'],
        confidence: 0.4,
        grader: '本地算法（AI 服务降级）',
      },
    };
  }
}

/** 构造标准作业包（学习通接口不可用时的可下载产物） */
export function buildHomeworkPackage(report, ctx = {}) {
  return {
    format: 'yueyun-singing-eval/v1',
    generatedAt: new Date().toISOString(),
    homeworkId: ctx.homeworkId || null,
    studentId: ctx.studentId || null,
    score: report.total_score,
    pitchScore: report.pitch_score,
    rhythmScore: report.rhythm_score,
    segments: (report.problem_segments || []).map((s) => ({
      start: pick(s, ['start_time', 'start', 'startTime', 'begin']),
      end: pick(s, ['end_time', 'end', 'endTime', 'stop']),
      dim: pick(s, ['dim', 'dimension', 'type']),
      problem: pick(s, ['problem_desc', 'detail', 'issue', 'desc', 'description', 'message']),
    })),
    suggestion: report.suggestion || '',
    disclaimer: report.disclaimer || '',
    scope: report.scope || '',
  };
}

/**
 * 推送测评报告到学习通作业系统
 * 未配置学习通开放 API 时，降级为「生成标准作业包」，返回可供下载的内容。
 * @param {object} report 结构化报告 JSON
 * @param {{ homeworkId?: string, studentId?: number }} ctx
 */
export async function pushToLearningPlatform(report, ctx = {}) {
  const apiBase = process.env.LEARNING_PLATFORM_API;
  const apiKey = process.env.LEARNING_PLATFORM_KEY;

  if (!apiBase || !apiKey) {
    // 无真实接口：产出标准作业包（可直接下载/转发），而不是空回执
    return {
      target: 'learning-platform',
      status: 'package',
      received: true,
      summary: '学习通开放接口未配置，已生成标准作业包（可下载后手动提交）',
      package: buildHomeworkPackage(report, ctx),
      packageName: `yueyun-singing-eval-${Date.now()}.json`,
    };
  }

  try {
    const resp = await fetch(`${apiBase.replace(/\/$/, '')}/homework/submit`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
      body: JSON.stringify({
        homeworkId: ctx.homeworkId,
        studentId: ctx.studentId,
        score: report.total_score,
        detail: summarizeReport(report),
      }),
      signal: AbortSignal.timeout(15000),
    });
    if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
    const data = await resp.json().catch(() => ({}));
    return {
      target: 'learning-platform',
      status: 'ok',
      received: true,
      summary: '已推送至学习通作业系统',
      remote: data,
    };
  } catch (err) {
    log.warn(`学习通推送失败: ${err.message}`);
    // 降级也必须有产物：用户失败后仍能拿到作业包手动提交，而不是死路一条
    return {
      target: 'learning-platform',
      status: 'degraded',
      received: true,
      summary: `学习通推送失败（${err.message}），已生成作业包，可下载后手动提交或稍后重试`,
      retryable: true,
      package: buildHomeworkPackage(report, ctx),
      packageName: `yueyun-singing-eval-${Date.now()}.json`,
    };
  }
}
