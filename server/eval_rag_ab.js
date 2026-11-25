// RAG A/B 对照评测：本地微调模型 + 有/无 RAG 注入
// 衡量 RAG 对回答准确性的正向作用
// 用法: node server/eval_rag_ab.js
import 'dotenv/config';
import { retrieveYuejuKnowledge, buildKnowledgeContext } from './services/yuejuKnowledge.js';

const LOCAL_URL = 'http://127.0.0.1:3456/ask';

// 评测集：越剧精确事实问题（标准答案关键事实点，用于自动打分）
const QA = [
  { q: '越剧发源于哪个省份的哪个县？', points: ['浙江', '嵊'] },
  { q: '越剧早期"小歌班"是哪一年形成的？', points: ['1906'] },
  { q: '越剧的原始唱书形式叫什么？', points: ['落地唱书'] },
  { q: '越剧1916年进入上海时称为什么？', points: ['绍兴文戏'] },
  { q: '越剧是哪一年列入国家级非物质文化遗产名录的？', points: ['2006'] },
  { q: '越剧列入非遗时属于什么类别？', points: ['传统戏剧'] },
  { q: '越剧的主要唱腔体系包括哪些？', points: ['四工', '尺调', '弦下'] },
  { q: '袁派是由谁创立的？', points: ['袁雪芬'] },
  { q: '尹派是由谁创立的？', points: ['尹桂芳'] },
  { q: '徐派是由谁创立的？', points: ['徐玉兰'] },
  { q: '越剧的主要行当有哪些？', points: ['小生', '花旦'] },
  { q: '浙江小百花越剧团是哪一年成立的？', points: ['1984'] },
];

async function askLocal(question) {
  const resp = await fetch(LOCAL_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ question, max_new_tokens: 256 }),
  });
  if (!resp.ok) throw new Error(`本地模型 HTTP ${resp.status}`);
  const data = await resp.json();
  return (data.answer || data.corrected || '').trim();
}

// 打分：回答中命中标准事实点的比例
function scoreAnswer(answer, points) {
  const hits = points.filter((p) => answer.includes(p));
  return { hits, total: points.length, ratio: points.length ? hits.length / points.length : 0 };
}

function injectRag(question, chunks) {
  const ctx = buildKnowledgeContext(chunks);
  return `请务必优先采用下面检索到的越剧资料来回答，资料未覆盖的不要乱猜。\n\n${ctx}\n\n问题：${question}`;
}

async function main() {
  console.log('======== RAG A/B 对照评测 ========');
  console.log(`评测问题数: ${QA.length}\n`);

  let sumNoRag = 0, sumRag = 0, ragActivated = 0, ragInjectedHits = 0, ragInjectedTotal = 0;

  for (const item of QA) {
    const { q, points } = item;

    // A) 无 RAG：本地模型直接回答
    let noRag = '';
    try { noRag = await askLocal(q); } catch (e) { noRag = `[错误] ${e.message}`; }

    // B) 有 RAG：先检索，命中则注入
    let chunks = [];
    try { chunks = retrieveYuejuKnowledge(q, { topK: 3 }); } catch { chunks = []; }
    let rag = '';
    if (chunks.length) {
      ragActivated++;
      try { rag = await askLocal(injectRag(q, chunks)); } catch (e) { rag = `[错误] ${e.message}`; }
    } else {
      rag = noRag; // RAG 未激活，视为无 RAG
    }

    const sNo = scoreAnswer(noRag, points);
    const sRag = scoreAnswer(rag, points);
    sumNoRag += sNo.ratio;
    sumRag += sRag.ratio;

    const gain = sRag.ratio - sNo.ratio;
    console.log(`▸ ${q}`);
    console.log(`  无RAG: ${noRag.slice(0, 80)}`);
    console.log(`  有RAG: ${rag.slice(0, 80)}`);
    console.log(`  命中 无RAG ${sNo.hits.length}/${sNo.total} | 有RAG ${sRag.hits.length}/${sRag.total} | 增益 ${gain >= 0 ? '+' : ''}${(gain * 100).toFixed(0)}%\n`);

    if (chunks.length) {
      ragInjectedHits += sRag.hits.length;
      ragInjectedTotal += sRag.total;
    }
  }

  const avgNo = sumNoRag / QA.length;
  const avgRag = sumRag / QA.length;
  console.log('========================================');
  console.log(`RAG 实际激活题数: ${ragActivated}/${QA.length}`);
  console.log(`平均事实命中率 | 无RAG: ${(avgNo * 100).toFixed(1)}% | 有RAG: ${(avgRag * 100).toFixed(1)}%`);
  console.log(`平均提升: +${((avgRag - avgNo) * 100).toFixed(1)} 个百分点`);
  console.log(`激活RAG题目命中率: ${ragInjectedTotal ? ((ragInjectedHits / ragInjectedTotal) * 100).toFixed(1) : 'N/A'}%`);
  console.log('========================================');
}

main().catch((e) => { console.error('评测失败:', e); process.exit(1); });