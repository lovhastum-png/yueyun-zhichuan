// RAG A/B 对照评测（讯飞星火 generalv3.5 · OpenAI 兼容接口）
// 衡量 RAG 注入对真实云端大模型回答准确性的正向作用
// 用法: node server/eval_rag_spark.js
import 'dotenv/config';
import config from './config.js';
import { retrieveYuejuKnowledge, buildKnowledgeContext } from './services/yuejuKnowledge.js';

const { apiUrl, apiKey, apiSecret, model, provider } = config.textLlm;
const TIMEOUT = 90000;

// 与 xingchen 评测保持一致，便于横向对比
const QA = [
  { q: '越剧是发源于哪个省的？', points: ['浙江', '嵊'] },
  { q: '越剧的原始唱书形式叫什么？', points: ['落地唱书'] },
  { q: '越剧1916年进入上海时称为什么？', points: ['绍兴文戏'] },
  { q: '越剧是哪一年列入国家级非物质文化遗产名录的？', points: ['2006'] },
  { q: '越剧列入非遗时属于什么类别？', points: ['戏剧'] },
  { q: '越剧的主要唱腔体系包括哪些？', points: ['四工', '尺调', '弦下'] },
  { q: '袁派是由谁创立的？', points: ['袁雪芬'] },
  { q: '浙江小百花越剧团是哪一年成立的？', points: ['1984'] },
];

async function askSpark(question) {
  const authHeader = (provider === 'iflytek' && apiSecret) ? `Bearer ${apiKey}:${apiSecret}` : `Bearer ${apiKey}`;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT);
  try {
    const resp = await fetch(apiUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: authHeader },
      body: JSON.stringify({
        model,
        messages: [{ role: 'user', content: question }],
        temperature: 0.3,
        max_tokens: 500,
        enable_thinking: false,
      }),
      signal: controller.signal,
    });
    if (!resp.ok) {
      const detail = await resp.text().catch(() => '');
      throw new Error(`星火 ${resp.status}${detail ? `：${detail.slice(0, 120)}` : ''}`);
    }
    const data = await resp.json();
    return (data?.choices?.[0]?.message?.content || '').trim();
  } catch (err) {
    if (err.name === 'AbortError') throw new Error('星火响应超时');
    throw err;
  } finally {
    clearTimeout(timer);
  }
}

function scoreAnswer(answer, points) {
  const hits = points.filter((p) => answer.includes(p));
  return { hits, total: points.length, ratio: points.length ? hits.length / points.length : 0 };
}

function injectRag(question, chunks) {
  const ctx = buildKnowledgeContext(chunks);
  return `请只依据下面检索到的越剧资料回答，资料中明确写到的年份、名称、类别必须采用，不要用资料之外的信息或凭印象作答。\n\n${ctx}\n\n问题：${question}`;
}

async function main() {
  console.log('======== RAG A/B 对照评测（讯飞星火 generalv3.5）========');
  console.log(`模型: ${model} | 问题数: ${QA.length}\n`);

  let sumNoRag = 0, sumRag = 0, ragActivated = 0;

  for (const item of QA) {
    const { q, points } = item;

    let noRag = '';
    try { noRag = await askSpark(q); } catch (e) { noRag = `[错误] ${e.message}`; }

    let chunks = [];
    try { chunks = retrieveYuejuKnowledge(q, { topK: 3 }); } catch { chunks = []; }
    let rag = '';
    if (chunks.length) {
      ragActivated++;
      try { rag = await askSpark(injectRag(q, chunks)); } catch (e) { rag = `[错误] ${e.message}`; }
    } else {
      rag = noRag;
    }

    const sNo = scoreAnswer(noRag, points);
    const sRag = scoreAnswer(rag, points);
    sumNoRag += sNo.ratio;
    sumRag += sRag.ratio;

    const gain = sRag.ratio - sNo.ratio;
    console.log(`▸ ${q}`);
    console.log(`  无RAG: ${noRag.replace(/\n/g, ' ').slice(0, 70)}`);
    console.log(`  有RAG: ${rag.replace(/\n/g, ' ').slice(0, 70)}`);
    console.log(`  命中 无RAG ${sNo.hits.length}/${sNo.total} | 有RAG ${sRag.hits.length}/${sRag.total} | 增益 ${gain >= 0 ? '+' : ''}${(gain * 100).toFixed(0)}%\n`);
  }

  const avgNo = sumNoRag / QA.length;
  const avgRag = sumRag / QA.length;
  console.log('========================================');
  console.log(`RAG 实际激活题数: ${ragActivated}/${QA.length}`);
  console.log(`平均事实命中率 | 无RAG: ${(avgNo * 100).toFixed(1)}% | 有RAG: ${(avgRag * 100).toFixed(1)}%`);
  console.log(`平均提升: +${((avgRag - avgNo) * 100).toFixed(1)} 个百分点`);
  console.log('========================================');
}

main().catch((e) => { console.error('评测失败:', e); process.exit(1); });