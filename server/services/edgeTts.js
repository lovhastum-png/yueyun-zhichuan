// Edge 神经网络语音合成（TTS）封装
// 使用微软 Edge 免费神经网络语音（msedge-tts），比浏览器原生 speechSynthesis 更自然，
// 并返回真实的 word/sentence boundary 时间点，用于驱动数字人口型的精确同步。
import { MsEdgeTTS, OUTPUT_FORMAT } from 'msedge-tts';

// 默认音色：云希（年轻清脆的男声），适合「越韵先生」以年轻老师身份娓娓道来、更响亮清爽
const DEFAULT_VOICE = 'zh-CN-YunxiNeural';

// 音频结果缓存：按文本+参数哈希，命中直接返回，重复内容（如开场白、示例问题）秒出
const CACHE_MAX = 100;                   // 最多缓存条数，防止内存无限增长
const audioCache = new Map();            // key -> { audio, boundaries }

// 快速字符串哈希（FNV-1a），用于生成缓存键
function hashKey(str) {
  let h = 0x811c9dc5;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = (h * 0x01000193) >>> 0;
  }
  return h.toString(36);
}

// 缓存读取；命中则把该条移到末尾（近似 LRU）
function cacheGet(key) {
  if (!audioCache.has(key)) return null;
  const hit = audioCache.get(key);
  audioCache.delete(key);
  audioCache.set(key, hit);
  return hit;
}

function cachePut(key, value) {
  audioCache.set(key, value);
  if (audioCache.size > CACHE_MAX) {
    // 淘汰最早插入（Map 迭代顺序即插入顺序）
    const oldest = audioCache.keys().next().value;
    if (oldest !== undefined) audioCache.delete(oldest);
  }
}

// 供流式路由在合成完成后把结果写入缓存
export function cacheResult(key, audio, boundaries) {
  if (!key || !audio || audio.length === 0) return;
  cachePut(key, { audio, boundaries: boundaries || [] });
}

// 合成一段文本，返回 mp3 音频 Buffer + boundary 元数据
// options: { rate?, pitch?, volume?, voice? }
export async function synthesizeSpeech(text, options = {}) {
  const voice = options.voice || DEFAULT_VOICE;
  const rate = options.rate ?? 1.0;
  const pitch = options.pitch ?? '+5%';
  const volume = options.volume ?? 'default';

  // 缓存命中直接返回，跳过重复合成
  const key = hashKey(`${voice}|${rate}|${pitch}|${volume}|${text}`);
  const cached = cacheGet(key);
  if (cached) return cached;

  const tts = new MsEdgeTTS();
  try {
    // 注意：不要用 16kHz/32kbps 低码率，msedge-tts 会导致连接中断（无静音保护）
    await tts.setMetadata(voice, OUTPUT_FORMAT.AUDIO_24KHZ_48KBITRATE_MONO_MP3, {
      wordBoundaryEnabled: true,
      sentenceBoundaryEnabled: true,
    });

    const { audioStream, metadataStream } = tts.toStream(text, {
      rate,
      pitch,
      volume,
    });

    // 收集音频
    const audioChunks = [];
    const audioCollected = new Promise((resolve, reject) => {
      audioStream.on('data', (c) => audioChunks.push(c));
      audioStream.on('error', reject);
      audioStream.on('end', resolve);
      audioStream.on('close', resolve);
    });

    // 收集 boundary 元数据
    const boundaries = [];
    const metaCollected = new Promise((resolve, reject) => {
      if (!metadataStream) return resolve();
      metadataStream.on('data', (chunk) => {
        try {
          const obj = JSON.parse(chunk.toString());
          for (const item of obj.Metadata || []) {
            const data = item.Data || {};
            const text = data?.text?.Text;
            boundaries.push({
              type: item.Type || 'WordBoundary',
              offsetMs: Math.round((data.Offset ?? 0) / 10000),
              text: text || '',
            });
          }
        } catch (_) { /* 忽略解析失败的数据片 */ }
      });
      metadataStream.on('error', reject);
      metadataStream.on('end', resolve);
      metadataStream.on('close', resolve);
    });

    await Promise.all([audioCollected, metaCollected]);

    const audio = Buffer.concat(audioChunks);
    if (audio.length === 0) {
      throw Object.assign(new Error('语音合成未返回音频'), { status: 502, expose: true });
    }

    const result = { audio, boundaries };
    cachePut(key, result); // 写入缓存，加速后续重复合成
    return result;
  } finally {
    tts.close();
  }
}

// 获取可用音色（供调试/配置使用）
export async function listVoices() {
  const tts = new MsEdgeTTS();
  try {
    return await tts.getVoices();
  } finally {
    tts.close();
  }
}

// 流式合成会话：返回可逐块读取的 audioStream / metadataStream，供 SSE 边收边播。
// 若文本命中缓存，则直接返回整段音频+cache 标记，无需再连接 Edge 服务。
// 返回: { cached, audio?, boundaries?, key, audioStream?, metadataStream?, close() }
export async function createStreamSession(text, options = {}) {
  const voice = options.voice || DEFAULT_VOICE;
  const rate = options.rate ?? 1.0;
  const pitch = options.pitch ?? '+5%';
  const volume = options.volume ?? 'default';
  const key = hashKey(`${voice}|${rate}|${pitch}|${volume}|${text}`);

  const cached = cacheGet(key);
  if (cached) {
    return { cached: true, audio: cached.audio, boundaries: cached.boundaries, key, close() {} };
  }

  const tts = new MsEdgeTTS();
  try {
    await tts.setMetadata(voice, OUTPUT_FORMAT.AUDIO_24KHZ_48KBITRATE_MONO_MP3, {
      wordBoundaryEnabled: true,
      sentenceBoundaryEnabled: true,
    });
    const { audioStream, metadataStream } = tts.toStream(text, { rate, pitch, volume });
    return { cached: false, audioStream, metadataStream, key, close() { tts.close(); } };
  } catch (err) {
    tts.close();
    throw err;
  }
}