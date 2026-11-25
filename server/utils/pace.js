// 把一次性生成的整段文本切成小片段、按固定间隔逐段回调。
// 用途：云端 LLM 不可用时走本地兜底，答案是瞬时生成的整段字符串，
// 若一次性 onToken 回调，前端就会"整包砸出"、没有任何流式观感。
// 这里按打字机节奏放出，让兜底答案与云端流式保持一致的体验。
// 自适应分片：无论多长的文本，总放出时长收敛在约 1.2s 内。
export async function emitPaced(text, onToken, { maxChunks = 80, intervalMs = 15 } = {}) {
  if (!onToken || !text) return;
  const chunkSize = Math.max(4, Math.ceil(text.length / maxChunks));
  for (let i = 0; i < text.length; i += chunkSize) {
    onToken(text.slice(i, i + chunkSize));
    // eslint-disable-next-line no-await-in-loop
    await new Promise((r) => setTimeout(r, intervalMs));
  }
}
