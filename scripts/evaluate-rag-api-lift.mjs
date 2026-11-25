import fs from 'node:fs';
import path from 'node:path';
import { performance } from 'node:perf_hooks';
import { fileURLToPath } from 'node:url';

import config from '../server/config.js';
import { callAgent } from '../server/services/xingchenWs.js';
import { retrieveYuejuKnowledge } from '../server/services/yuejuKnowledge.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.join(__dirname, '..');
const sourcePath = path.join(rootDir, 'docs', 'roadshow', 'text_retrieval_results.json');

const args = new Set(process.argv.slice(2));
const isSmoke = args.has('--smoke');
const runAll = args.has('--all');
const providerArg = process.argv.find((arg) => arg.startsWith('--providers='));
const selectedProviders = providerArg
  ? providerArg.split('=', 2)[1].split(',').map((item) => item.trim()).filter(Boolean)
  : ['local-qwen', 'spark-generalv3.5', 'xingchen-workflow'];

const benchmark = JSON.parse(fs.readFileSync(sourcePath, 'utf8'));
const defaultIds = new Set(['B1', 'B2', 'B3', 'B4', 'M1', 'M2', 'M4', 'H1']);
let questions = benchmark.rows
  .filter((row) => runAll || defaultIds.has(row.id))
  .map(({ id, tier, q, facts }) => ({ id, tier, q, facts }));
if (isSmoke) questions = questions.slice(0, 1);

const outputName = isSmoke ? 'rag_api_benchmark_smoke.json' : 'rag_api_benchmark_results.json';
const outputPath = path.join(rootDir, 'docs', 'roadshow', outputName);

const SYSTEM = [
  '你是“越韵智传”的越剧专业问答助手。',
  '请用简体中文准确、简洁地回答，只写与问题相关的内容。',
  '不知道时明确说明，不要编造年份、人物、流派或剧目。',
].join('\n');

function buildRagContext(question) {
  const chunks = retrieveYuejuKnowledge(question, { topK: 3, minScore: 1.5 });
  if (chunks.length === 0) return { chunks, text: '' };
  const text = chunks
    .map((chunk, index) => `【资料${index + 1}】${chunk.title}\n${chunk.content}`)
    .join('\n\n');
  return { chunks, text };
}

function buildMessages(question, ragText) {
  const system = ragText
    ? `${SYSTEM}\n\n下面是校本越剧知识库检索到的资料。请优先依据资料作答；资料没有覆盖的事实不要猜测。\n\n${ragText}`
    : SYSTEM;
  return [
    { role: 'system', content: system },
    { role: 'user', content: question },
  ];
}

function scoreCoverage(answer, facts) {
  const normalized = String(answer || '').replace(/\s+/g, '');
  const detail = facts.map((alternatives) => ({
    alternatives,
    ok: alternatives.some((term) => normalized.includes(term)),
  }));
  const hit = detail.filter((item) => item.ok).length;
  return { hit, total: facts.length, score: hit / facts.length, detail };
}

async function callLocal(messages) {
  const url = process.env.YUEJU_LLM_LOCAL_URL || 'http://127.0.0.1:3456';
  const combined = messages.map((item) => `${item.role === 'system' ? '回答要求' : '问题'}：${item.content}`).join('\n\n');
  const response = await fetch(`${url}/ask`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ question: combined, max_new_tokens: 192 }),
    signal: AbortSignal.timeout(60_000),
  });
  if (!response.ok) throw new Error(`HTTP ${response.status}: ${(await response.text()).slice(0, 160)}`);
  const data = await response.json();
  return data.answer || data.corrected || '';
}

async function callSpark(messages) {
  const { apiUrl, apiKey, apiSecret, model, provider } = config.textLlm;
  if (!apiUrl || !apiKey) throw new Error('文字模型 API 配置不完整');
  const authorization = provider === 'iflytek' && apiSecret
    ? `Bearer ${apiKey}:${apiSecret}`
    : `Bearer ${apiKey}`;
  const response = await fetch(apiUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: authorization },
    body: JSON.stringify({
      model,
      messages,
      temperature: 0,
      max_tokens: 192,
      stream: false,
      enable_thinking: false,
    }),
    signal: AbortSignal.timeout(60_000),
  });
  if (!response.ok) throw new Error(`HTTP ${response.status}: ${(await response.text()).slice(0, 160)}`);
  const data = await response.json();
  return data?.choices?.[0]?.message?.content || '';
}

async function callXingchen(messages) {
  return callAgent(messages, { timeout: 60_000 });
}

const providerMap = {
  'local-qwen': callLocal,
  'spark-generalv3.5': callSpark,
  'xingchen-workflow': callXingchen,
};

function summarizeRows(rows, mode) {
  const subset = rows.filter((row) => row.mode === mode && !row.error);
  const errors = rows.filter((row) => row.mode === mode && row.error).length;
  if (subset.length === 0) {
    return { completed: 0, errors, macro_percent: null, micro_percent: null, avg_latency_ms: null };
  }
  const totalFacts = subset.reduce((sum, row) => sum + row.coverage.total, 0);
  const hitFacts = subset.reduce((sum, row) => sum + row.coverage.hit, 0);
  return {
    completed: subset.length,
    errors,
    macro_percent: Number((subset.reduce((sum, row) => sum + row.coverage.score, 0) / subset.length * 100).toFixed(1)),
    micro_percent: Number((hitFacts / totalFacts * 100).toFixed(1)),
    hit_facts: hitFacts,
    total_facts: totalFacts,
    avg_latency_ms: Number((subset.reduce((sum, row) => sum + row.latency_ms, 0) / subset.length).toFixed(1)),
  };
}

function buildSummary(rows) {
  return Object.fromEntries(selectedProviders.map((provider) => {
    const providerRows = rows.filter((row) => row.provider === provider);
    const withoutRag = summarizeRows(providerRows, 'without_rag');
    const withRag = summarizeRows(providerRows, 'with_rag');
    const lift = withoutRag.micro_percent === null || withRag.micro_percent === null
      ? null
      : Number((withRag.micro_percent - withoutRag.micro_percent).toFixed(1));
    const relative = lift === null || !withoutRag.micro_percent
      ? null
      : Number((lift / withoutRag.micro_percent * 100).toFixed(1));
    return [provider, {
      without_rag: withoutRag,
      with_rag: withRag,
      rag_lift_pp: lift,
      rag_relative_lift_percent: relative,
    }];
  }));
}

const rows = [];
for (const provider of selectedProviders) {
  const caller = providerMap[provider];
  if (!caller) {
    rows.push({ provider, mode: 'provider_error', error: '未知 provider' });
    continue;
  }

  for (const question of questions) {
    const rag = buildRagContext(question.q);
    for (const mode of ['without_rag', 'with_rag']) {
      const messages = buildMessages(question.q, mode === 'with_rag' ? rag.text : '');
      const started = performance.now();
      let answer = '';
      let error = '';
      try {
        answer = await caller(messages);
        if (!answer.trim()) throw new Error('API 返回空文本');
      } catch (err) {
        error = err?.message || String(err);
      }
      const latencyMs = performance.now() - started;
      const row = {
        provider,
        mode,
        id: question.id,
        tier: question.tier,
        question: question.q,
        rag_sources: mode === 'with_rag' ? rag.chunks.map((chunk) => chunk.title) : [],
        answer,
        error,
        latency_ms: Number(latencyMs.toFixed(1)),
        coverage: scoreCoverage(answer, question.facts),
      };
      rows.push(row);
      console.log(`[${provider}] ${question.id} ${mode}: ${error || `${row.coverage.hit}/${row.coverage.total}`} (${row.latency_ms} ms)`);

      const partial = {
        generated_at: new Date().toISOString(),
        status: 'running',
        methodology: { question_count: questions.length, providers: selectedProviders, temperature: 0, max_tokens: 192 },
        summary: buildSummary(rows),
        rows,
      };
      fs.writeFileSync(outputPath, `${JSON.stringify(partial, null, 2)}\n`, 'utf8');
    }
  }
}

const result = {
  generated_at: new Date().toISOString(),
  status: 'complete',
  methodology: {
    question_count: questions.length,
    providers: selectedProviders,
    modes: ['without_rag', 'with_rag'],
    temperature: 0,
    max_tokens: 192,
    retrieval: '同一 2,139 条校本语料，字符级 2-gram + IDF，Top-3',
    metric: '关键事实覆盖率；每组同义词命中任意一个计 1 分',
  },
  summary: buildSummary(rows),
  rows,
};

fs.writeFileSync(outputPath, `${JSON.stringify(result, null, 2)}\n`, 'utf8');
console.log('\nSUMMARY');
console.log(JSON.stringify(result.summary, null, 2));
console.log(`结果已写入：${outputPath}`);
