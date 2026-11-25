// Qwen3-ASR 音频识别封装
// 调用阿里云百炼 qwen-omni-turbo 多模态模型，同时完成：
//   1. 越剧唱词识别
//   2. 流派判定（基于唱腔特征 + 唱词内容，由模型直接判定）
// 关键词匹配仅作兜底
import config from '../config.js';
import { withTimeout, withRetry } from '../utils/resilience.js';

// 越剧流派唱腔特征描述（供模型判定参考 + 关键词兜底）
const schoolDescriptions = {
  '袁派': '袁雪芬创立，质朴委婉、深情含蓄，旋律平直朴素，以《祥林嫂》《西厢记》为代表',
  '尹派': '尹桂芳创立，深沉流畅、柔中带刚，起调低沉，以《何文秀》《红楼梦》《沙漠王子》为代表',
  '范派': '范瑞娟创立，浑厚稳健、阳刚之美，宽亮结实，以《梁山伯与祝英台》《孔雀东南飞》为代表',
  '傅派': '傅全香创立，婉转华丽、真假声结合、花腔丰富，以《情探》《杜十娘》为代表',
  '徐派': '徐玉兰创立，高亢激昂、跌宕起伏、刚劲有力，以《红楼梦·宝玉哭灵》《追鱼》为代表',
  '戚派': '戚雅仙创立，朴素深情、哀婉缠绵、节奏稳，以《白蛇传》《血手印》为代表',
  '王派': '王文娟创立，秀美醇厚、细腻传神、音色圆润，以《红楼梦·林黛玉》《孟丽君》为代表',
  '毕派': '毕春芳创立，轻松明快、活泼俊逸，以《三笑》《血手印》为代表',
  '陆派': '陆锦花创立，清亮洒脱、俊雅飘逸，以《珍珠塔》《盘夫索夫》为代表',
  '吕派': '吕瑞英创立，灵巧甜美、活泼俏丽，以《三看御妹》《穆桂英》为代表',
  '金派': '金采风创立，端庄委婉、细腻大方，以《碧玉簪》《盘夫索夫》为代表',
  '张派': '张桂凤创立，苍劲豪放、刚健有力，以《貂蝉》《蔡文姬》为代表',
};

// 兜底用关键词库（模型判定失败时用）
const schoolKeywords = {
  '袁派': ['祥林嫂', '祝福', '西厢记', '崔莺莺', '黛玉葬花', '方亚芬', '袁雪芬'],
  '尹派': ['何文秀', '屈原', '沙漠王子', '浪荡子', '宝玉', '赵志刚', '茅威涛', '王君安'],
  '范派': ['梁山伯', '祝英台', '孔雀东南飞', '焦仲卿', '范瑞娟', '吴凤花'],
  '傅派': ['情探', '敫桂英', '杜十娘', '李甲', '刘兰芝', '傅全香', '陈颖', '何英'],
  '徐派': ['贾宝玉', '宝玉哭灵', '追鱼', '张珍', '北地王', '徐玉兰', '钱惠丽', '郑国凤'],
  '戚派': ['白蛇传', '白素贞', '血手印', '王千金', '琵琶记', '赵五娘', '戚雅仙', '金静'],
  '王派': ['林黛玉', '鲤鱼', '孟丽君', '王文娟', '王志萍', '单仰萍'],
  '毕派': ['三笑', '唐伯虎', '秋香', '林招得', '毕春芳', '丁小蛙', '杨童华'],
  '陆派': ['珍珠塔', '方卿', '盘夫索夫', '曾荣', '陆锦花', '许杰', '黄慧'],
  '吕派': ['三看御妹', '刘金定', '穆桂英', '九斤姑娘', '吕瑞英', '张咏梅', '吴素英'],
  '金派': ['碧玉簪', '李秀英', '严兰贞', '金采风', '谢群英', '黄美菊'],
  '张派': ['貂蝉', '蔡文姬', '张桂凤', '董柯娣'],
};

// 调用 qwen-omni-turbo 识别唱词并判定流派
// audioBuffer: 上传的音频文件 Buffer
// fileName: 文件名（用于判定格式）
export async function recognizeAudio(audioBuffer, fileName) {
  const { apiKey, url } = config.qwenAsr;
  if (!apiKey) {
    throw Object.assign(new Error('Qwen ASR API Key 未配置'), { status: 500, expose: false });
  }

  const ext = (fileName.split('.').pop() || 'wav').toLowerCase();
  const mimeType = ext === 'mp3' ? 'audio/mpeg' : ext === 'm4a' ? 'audio/mp4' : ext === 'ogg' ? 'audio/ogg' : ext === 'flac' ? 'audio/flac' : ext === 'webm' ? 'audio/webm' : 'audio/wav';
  const base64 = audioBuffer.toString('base64');
  const dataUri = `data:${mimeType};base64,${base64}`;

  // 构造流派特征说明文本
  const schoolGuide = Object.entries(schoolDescriptions)
    .map(([name, desc]) => `- ${name}：${desc}`)
    .join('\n');

  const systemPrompt = `你是一位资深越剧专家，精通越剧十二大流派（袁、尹、范、傅、徐、戚、王、毕、陆、吕、金、张派）的唱腔特征与代表剧目。

请听这段越剧音频，完成两项任务：
1. **唱词识别**：准确转写音频中的越剧唱词，保持原文的曲词、衬字和语气词，不加任何解释。
2. **流派判定**：根据音频的唱腔特征（行腔、咬字、用嗓、气息、音色）以及唱词内容所属的剧目/唱段，判定最可能归属的流派。如果难以明确判定，给出最可能的 1-3 个候选并附置信度。

越剧十二大流派参考：
${schoolGuide}

请严格按以下 JSON 格式输出，不要输出 JSON 之外的任何内容：
{
  "lyrics": "完整唱词文本",
  "schools": [
    {"name": "流派名（如：徐派）", "confidence": 0.85, "reason": "判定依据（唱腔/剧目/演员等）"}
  ]
}`;

  // 百炼兼容模式：qwen-omni-turbo 支持 input_audio 类型，直接传 base64 音频
  // 增加超时和重试，避免音频文件大时网络抖动导致失败
  const doFetch = async () => {
    const resp = await withTimeout(
      fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${apiKey}`,
        },
        body: JSON.stringify({
          model: 'qwen-omni-turbo',
          messages: [
            { role: 'system', content: [{ type: 'text', text: systemPrompt }] },
            {
              role: 'user',
              content: [
                { type: 'input_audio', input_audio: { data: dataUri, format: ext } },
                { type: 'text', text: '请听音频，识别唱词并判定流派，按 JSON 格式输出。' },
              ],
            },
          ],
          temperature: 0.1,
        }),
      }),
      90000,
      '音频识别请求'
    );

    if (!resp.ok) {
      const errText = await resp.text();
      console.error('[Qwen-ASR] 请求失败:', resp.status, errText);
      throw Object.assign(new Error(`音频识别服务调用失败 (${resp.status})`), { status: 502, expose: true });
    }
    return resp.json();
  };

  const data = await withRetry(doFetch, {
    retries: 1,
    delay: 800,
    label: '音频识别',
  });

  // 兼容解析返回内容（content 可能为字符串或数组）
  let raw = data?.choices?.[0]?.message?.content
    || data?.output?.choices?.[0]?.message?.content
    || data?.output?.text
    || '';
  if (Array.isArray(raw)) {
    raw = raw.map(c => (typeof c === 'string' ? c : c?.text || '')).join('');
  }
  const rawText = String(raw).trim();

  // 尝试从返回中解析 JSON
  const parsed = parseJsonResponse(rawText);

  let transcription = '';
  let schools = [];

  if (parsed) {
    transcription = cleanTranscription(parsed.lyrics || '');
    if (Array.isArray(parsed.schools) && parsed.schools.length > 0) {
      schools = parsed.schools
        .filter(s => s && s.name)
        .map(s => ({
          name: String(s.name).trim(),
          confidence: typeof s.confidence === 'number' ? s.confidence : 0.5,
          reason: s.reason ? String(s.reason) : '',
        }))
        .filter(s => schoolDescriptions[s.name]) // 只保留合法流派名
        .sort((a, b) => b.confidence - a.confidence)
        .slice(0, 5);
    }
  } else {
    // JSON 解析失败，回退：把整个文本当唱词
    transcription = cleanTranscription(rawText);
  }

  if (!transcription) {
    console.error('[Qwen-ASR] 响应无文本:', JSON.stringify(data).slice(0, 800));
    throw Object.assign(new Error('音频识别未返回结果，请检查音频是否包含人声'), { status: 502, expose: true });
  }

  // 若模型未给出流派判定，用关键词匹配兜底
  if (schools.length === 0) {
    schools = detectSchoolsByKeywords(transcription);
  }

  // 将唱词按标点分句
  const lyrics = splitSentences(transcription);

  return { lyrics, schools, fullText: transcription };
}

// 尝试从模型返回文本中提取 JSON（兼容带 ```json 代码块或前后多余文字）
function parseJsonResponse(text) {
  if (!text) return null;
  // 1. 直接尝试整体解析
  try {
    return JSON.parse(text);
  } catch {}
  // 2. 提取 ```json ... ``` 代码块
  const codeBlock = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (codeBlock) {
    try {
      return JSON.parse(codeBlock[1].trim());
    } catch {}
  }
  // 3. 提取第一个 { ... } 块
  const objMatch = text.match(/\{[\s\S]*\}/);
  if (objMatch) {
    try {
      return JSON.parse(objMatch[0]);
    } catch {}
  }
  return null;
}

// 清理对话型模型可能添加的前缀和引号包裹
function cleanTranscription(text) {
  if (!text) return '';
  let t = String(text).trim();
  t = t.replace(/^(这段音频[^：:]*[：:]\s*|识别结果[：:]\s*|唱词[：:]\s*|音频内容[：:]\s*| transcript[：:]\s*)/i, '');
  if (/^[「『"'"].+[」』"'"]$/.test(t)) {
    t = t.slice(1, -1);
  }
  return t.trim();
}

// 按句号、问号、感叹号、逗号、顿号、换行分句
function splitSentences(text) {
  const parts = text.split(/[。！？，、；\n]+/).map(s => s.trim()).filter(Boolean);
  return parts.map(s => ({ text: s }));
}

// 关键词兜底：基于唱词内容做流派判定
function detectSchoolsByKeywords(text) {
  const results = [];
  for (const [school, keywords] of Object.entries(schoolKeywords)) {
    let hits = 0;
    for (const kw of keywords) {
      if (text.includes(kw)) hits++;
    }
    if (hits > 0) {
      const confidence = Math.min(0.95, 0.45 + hits * 0.18);
      results.push({ name: school, confidence: Number(confidence.toFixed(2)), reason: '唱词命中关键词' });
    }
  }
  if (results.length === 0) {
    results.push({ name: '待判定', confidence: 0, reason: '唱词未命中已知流派关键词，建议结合唱腔人工判定' });
  }
  return results.sort((a, b) => b.confidence - a.confidence).slice(0, 5);
}
