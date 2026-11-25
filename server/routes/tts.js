// 语音合成（TTS）路由
import { Router } from 'express';
import { authRequired } from '../middleware/auth.js';
import { success, fail, asyncHandler } from '../middleware/error.js';
import { rateLimit } from '../middleware/rateLimit.js';
import { synthesizeSpeech, createStreamSession, cacheResult } from '../services/edgeTts.js';

const router = Router();

router.use(authRequired);

// 语音合成限流：每用户每分钟最多 20 次（Edge TTS 免费但需防滥用）
const ttsLimiter = rateLimit({ windowMs: 60000, max: 20, message: '语音合成请求过于频繁' });

// 合成语音：返回 mp3 的 base64 + word/sentence boundary 元数据
router.post('/synthesize', ttsLimiter, asyncHandler(async (req, res) => {
  const { text, rate, pitch, volume, voice } = req.body || {};
  if (!text || !text.trim()) return fail(res, '文本不能为空', 400, 400);

  let result;
  try {
    result = await synthesizeSpeech(text.trim(), { rate, pitch, volume, voice });
  } catch (err) {
    console.error('[TTS] 合成异常:', err.message, '| cause:', err.cause?.message || err.stack || '');
    return fail(res, err.expose ? err.message : '语音合成服务暂时不可用', err.status || 502, err.status || 502);
  }

  return success(res, {
    audio: result.audio.toString('base64'),
    mime: 'audio/mpeg',
    boundaries: result.boundaries,
  }, '合成完成');
}));

// SSE 流式合成：边收边播，音频块生成后立即推给前端，减少等待。
// 事件格式：`data: {json}\n\n`，其中 payload 的 t 字段：
//   'a'    -> 音频块 { t:'a', d:'<base64>' }
//   'done' -> 结束+边界 { t:'done', b:[boundaries] }
//   'err'  -> 失败 { t:'err', m:'<message>' }
router.post('/stream', ttsLimiter, asyncHandler(async (req, res) => {
  const { text, rate, pitch, volume, voice } = req.body || {};
  if (!text || !text.trim()) return fail(res, '文本不能为空', 400, 400);

  let session;
  try {
    session = await createStreamSession(text.trim(), { rate, pitch, volume, voice });
  } catch (err) {
    console.error('[TTS] 流式会话创建失败:', err.message, '| cause:', err.cause?.message || err.stack || '');
    return fail(res, err.expose ? err.message : '语音合成服务暂时不可用', err.status || 502, err.status || 502);
  }

  res.setHeader('Content-Type', 'text/event-stream; charset=utf-8');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('X-Accel-Buffering', 'no');
  res.flushHeaders();

  const send = (obj) => {
    if (!res.writableEnded) res.write(`data: ${JSON.stringify(obj)}\n\n`);
  };
  const cleanup = () => { try { session.close(); } catch (_) {} };

  // 客户端断开时释放资源
  req.on('close', cleanup);

  // 命中缓存：一次性回放整段音频
  if (session.cached) {
    send({ t: 'a', d: session.audio.toString('base64') });
    send({ t: 'done', b: session.boundaries || [] });
    res.end();
    return;
  }

  // 未命中：逐块推送音频，同时收集边界与音频用于缓存
  const audioChunks = [];
  const boundaries = [];
  let metadone = false;
  let audiodone = false;

  const tryFinish = () => {
    if (!audiodone || !metadone) return;
    // 缓存本次结果，加速后续重复合成
    const audio = Buffer.concat(audioChunks);
    cacheResult(session.key, audio, boundaries);
    cleanup();
    if (!res.writableEnded) {
      send({ t: 'done', b: boundaries });
      res.end();
    }
  };

  session.audioStream.on('data', (c) => {
    audioChunks.push(c);
    send({ t: 'a', d: c.toString('base64') });
  });
  session.audioStream.on('error', (e) => {
    console.error('[TTS] 流式音频错误:', e.message);
    send({ t: 'err', m: '语音合成中途失败' });
    res.end();
  });
  session.audioStream.on('end', () => { audiodone = true; tryFinish(); });
  session.audioStream.on('close', () => { audiodone = true; tryFinish(); });

  if (session.metadataStream) {
    session.metadataStream.on('data', (chunk) => {
      try {
        const obj = JSON.parse(chunk.toString());
        for (const item of obj.Metadata || []) {
          const data = item.Data || {};
          const t = data?.text?.Text;
          boundaries.push({
            type: item.Type || 'WordBoundary',
            offsetMs: Math.round((data.Offset ?? 0) / 10000),
            text: t || '',
          });
        }
      } catch (_) {}
    });
    session.metadataStream.on('error', () => {});
    session.metadataStream.on('end', () => { metadone = true; tryFinish(); });
    session.metadataStream.on('close', () => { metadone = true; tryFinish(); });
  } else {
    metadone = true;
  }
}));

export default router;