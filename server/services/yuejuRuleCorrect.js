// 越剧 ASR 规则纠错层（方案A）：纯内存词表替换，零外部依赖，常驻可用。
// 词表来源：models/yueju_asr_correct/prepare_correction_data.py 的 TERM_GROUPS
// （越剧微调模型的词典层知识，抽出来让 4G 服务器也能用，模型服务只做兜底）。
import { readFileSync } from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const VOCAB_PATH = path.join(__dirname, '..', 'data', 'yueju-rule-vocab.json');

// 惰性加载 + 进程级单例（131 术语 / ~400 变体，内存占用可忽略）
let replacements = null;

function loadReplacements() {
  if (replacements) return replacements;
  try {
    const raw = JSON.parse(readFileSync(VOCAB_PATH, 'utf-8'));
    const pairs = [];
    for (const terms of Object.values(raw.groups || {})) {
      for (const [correct, noisyList] of Object.entries(terms)) {
        for (const noisy of noisyList) pairs.push([noisy, correct]);
      }
    }
    // 长变体优先替换，避免短变体抢先吃掉长词的一部分
    pairs.sort((a, b) => b[0].length - a[0].length);
    replacements = pairs;
  } catch (err) {
    console.warn('[yuejuRuleCorrect] 词表加载失败，规则纠错停用:', err.message);
    replacements = [];
  }
  return replacements;
}

/**
 * 规则纠错：把 ASR 常见同音错字替换为正确越剧术语
 * @param {string} text
 * @returns {{ text: string, changed: boolean, hits: string[] }}
 */
export function correctWithRules(text) {
  if (!text || !text.trim()) return { text, changed: false, hits: [] };
  let result = text;
  const hits = [];
  for (const [noisy, correct] of loadReplacements()) {
    if (result.includes(noisy)) {
      result = result.split(noisy).join(correct);
      hits.push(`${noisy}→${correct}`);
    }
  }
  return { text: result, changed: result !== text, hits };
}

/**
 * 判断规则层能否兜住这段文本（有术语命中即认为可处理）
 */
export function rulesLikelyCover(text) {
  if (!text || !text.trim()) return true;
  return loadReplacements().some(([noisy]) => text.includes(noisy));
}
