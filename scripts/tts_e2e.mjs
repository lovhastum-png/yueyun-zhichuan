// 临时端到端验证：登录 -> /api/tts/synthesize -> /api/tts/stream（SSE）
const BASE = 'http://localhost:3000';

async function main() {
  // 1. 登录拿 token
  const login = await fetch(BASE + '/api/auth/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username: 'teacher', password: 'teacher123' }),
  });
  const loginJson = await login.json();
  const token = loginJson?.data?.token || loginJson?.data?.accessToken;
  if (!token) { console.log('登录失败:', JSON.stringify(loginJson)); return; }
  console.log('登录成功，token 前缀:', token.slice(0, 20) + '...');

  const authHeaders = { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + token };

  // 2. 整段合成
  const syn = await fetch(BASE + '/api/tts/synthesize', {
    method: 'POST', headers: authHeaders,
    body: JSON.stringify({ text: '同学你好，我是越韵先生。', rate: 0.95, pitch: '-15%' }),
  });
  const synJson = await syn.json();
  console.log('synthesize: http', syn.status, 'code', synJson.code,
    'audioBase64Len', synJson.data?.audio?.length, 'boundaries', synJson.data?.boundaries?.length);

  // 3. 流式 SSE
  const stream = await fetch(BASE + '/api/tts/stream', {
    method: 'POST', headers: authHeaders,
    body: JSON.stringify({ text: '越剧的流派、剧目、唱腔都可以问我。', rate: 0.95, pitch: '-15%' }),
  });
  console.log('stream: http', stream.status);
  const reader = stream.body.getReader();
  const dec = new TextDecoder();
  let buf = '', chunks = 0, bytes = 0, gotDone = false, err = null;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    buf += dec.decode(value, { stream: true });
    let i;
    while ((i = buf.indexOf('\n\n')) !== -1) {
      const line = buf.slice(0, i).split('\n').find(l => l.startsWith('data:'));
      buf = buf.slice(i + 2);
      if (!line) continue;
      const ev = JSON.parse(line.slice(5));
      if (ev.t === 'a') { chunks++; bytes += (ev.d.length * 3 / 4); }
      else if (ev.t === 'done') gotDone = true;
      else if (ev.t === 'err') err = ev.m;
    }
  }
  console.log('stream 结果: chunks=' + chunks, 'approxBytes=' + Math.round(bytes), 'gotDone=' + gotDone, err ? ('err=' + err) : '');
  console.log(err || (chunks > 0 && gotDone) ? 'RESULT: PASS ✅' : 'RESULT: FAIL ❌');
}
main().catch(e => { console.error('异常', e); process.exit(1); });