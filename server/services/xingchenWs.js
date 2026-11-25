// 讯飞星辰助手 Agent · WebSocket 客户端
// 负责：HMAC-SHA256 鉴权 URL 生成 + WebSocket 通信 + 流式接收
// 协议参考：讯飞星辰 MaaS WebSocket 协议 + 通用 URL 鉴权
import WebSocket from 'ws';
import crypto from 'crypto';
import config from '../config.js';

/**
 * 生成讯飞鉴权 URL
 * 签名规则：HMAC-SHA256(apiSecret, "host: <host>\ndate: <date>\nGET <path> HTTP/1.1")
 * 最终 URL: wss://<host><path>?authorization=<base64>&date=<date>&host=<host>
 */
function buildAuthUrl() {
  const { wsUrl, apiKey, apiSecret, host, path } = config.xingchenAgent;
  if (!wsUrl || !apiKey || !apiSecret || !host || !path) {
    throw new Error('星辰 Agent 配置不完整（需 wsUrl / apiKey / apiSecret）');
  }

  // RFC1123 格式时间（与 toUTCString 一致）
  const date = new Date().toUTCString();

  // 1. 拼接签名原串
  const tmp = `host: ${host}\ndate: ${date}\nGET ${path} HTTP/1.1`;

  // 2. HMAC-SHA256 签名 → base64
  const signature = crypto
    .createHmac('sha256', apiSecret)
    .update(tmp)
    .digest('base64');

  // 3. 拼接 authorization_origin 并 base64
  const authorizationOrigin = `api_key="${apiKey}", algorithm="hmac-sha256", headers="host date request-line", signature="${signature}"`;
  const authorization = Buffer.from(authorizationOrigin).toString('base64');

  // 4. 组装最终 wss URL
  const params = new URLSearchParams({
    authorization,
    date,
    host,
  });
  return `wss://${host}${path}?${params.toString()}`;
}

/**
 * 调用星辰助手 Agent（流式 WebSocket）
 * @param {Array<{role, content}>} messages - 对话消息（含 system / user / assistant）
 * @param {object} opts
 * @param {function} opts.onToken - 每收到一段文本回调
 * @param {function} opts.onPlugin - 收到插件/信源信息回调（可选）
 * @param {number} opts.timeout - 超时毫秒，默认 60s
 * @returns {Promise<string>} 完整文本
 */
export function callAgent(messages, opts = {}) {
  const { httpUrl, flowId, apiKey, apiSecret } = config.xingchenAgent;
  if (httpUrl && flowId && apiKey && apiSecret) {
    return callWorkflowHttp(messages, opts);
  }
  return callWebSocketAgent(messages, opts);
}

export function formatWorkflowInput(messages = []) {
  return messages.map((message) => {
    const label = message.role === 'system' ? '系统要求' : message.role === 'assistant' ? '助手' : '用户';
    return `${label}：${String(message.content || '').trim()}`;
  }).filter((line) => !line.endsWith('：')).join('\n\n');
}

export function extractWorkflowContent(payload) {
  const choices = Array.isArray(payload?.choices) ? payload.choices : [];
  return choices.map(choice => choice?.delta?.content || choice?.message?.content || '').join('');
}

async function callWorkflowHttp(messages, opts = {}) {
  const { onToken, timeout = 60000 } = opts;
  const { httpUrl, flowId, apiKey, apiSecret, inputKey } = config.xingchenAgent;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeout);

  try {
    const resp = await fetch(httpUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Accept': 'application/json',
        'Authorization': `Bearer ${apiKey}:${apiSecret}`,
      },
      body: JSON.stringify({
        flow_id: flowId,
        uid: opts.uid || 'yueyun_user',
        parameters: { [inputKey]: formatWorkflowInput(messages) },
        // SSE 流式：正文以 choices[].delta.content 逐帧下发，配合 onToken 实现逐字输出
        stream: true,
      }),
      signal: controller.signal,
    });
    if (!resp.ok) {
      const raw = await resp.text();
      let payload;
      try { payload = JSON.parse(raw); } catch { payload = null; }
      throw Object.assign(new Error(payload?.message || `星辰工作流请求失败 (${resp.status})`), { status: 502, expose: true });
    }

    const contentType = resp.headers.get('content-type') || '';

    // 网关未按 stream 返回（整包 JSON）：退回一次性解析，保持兼容
    if (!contentType.includes('text/event-stream')) {
      const raw = await resp.text();
      let payload;
      try { payload = JSON.parse(raw); } catch { payload = null; }
      if (!payload || Number(payload.code || 0) !== 0) {
        throw Object.assign(new Error(payload?.message || '星辰工作流返回异常'), { status: 502, expose: true });
      }
      const content = extractWorkflowContent(payload);
      if (!content.trim()) {
        throw Object.assign(new Error('星辰工作流未返回文本，请检查工作流结束节点的输出配置'), { status: 502, expose: true });
      }
      if (onToken) onToken(content);
      return content;
    }

    // SSE 流式解析：逐帧取出 delta.content 回调 onToken
    let fullText = '';
    let errMsg = '';
    const reader = resp.body.getReader();
    const decoder = new TextDecoder('utf-8');
    let buffer = '';
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n');
      buffer = lines.pop() || '';
      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed.startsWith('data:')) continue;
        const data = trimmed.slice(5).trim();
        if (!data || data === '[DONE]') continue;
        let frame;
        try { frame = JSON.parse(data); } catch { continue; }
        // 工作流业务错误帧（如知识库节点故障）：记录信息，正文为空时按失败处理
        if (frame.code && frame.code !== 0) {
          errMsg = frame.message || `星辰工作流错误码 ${frame.code}`;
          continue;
        }
        const piece = frame.choices?.[0]?.delta?.content || frame.choices?.[0]?.message?.content || '';
        if (piece) {
          fullText += piece;
          if (onToken) onToken(piece);
        }
      }
    }

    if (!fullText.trim()) {
      throw Object.assign(new Error(errMsg || '星辰工作流未返回文本，请检查工作流结束节点的输出配置'), { status: 502, expose: true });
    }
    return fullText;
  } catch (err) {
    if (err.name === 'AbortError') {
      throw Object.assign(new Error('星辰工作流响应超时'), { status: 504, expose: true });
    }
    throw err;
  } finally {
    clearTimeout(timer);
  }
}

function callWebSocketAgent(messages, opts = {}) {
  const { onToken, onPlugin, timeout = 60000, maxTokens = 2048, temperature = 0.6 } = opts;
  const appId = config.xingchenAgent.appId;

  return new Promise((resolve, reject) => {
    let url;
    try {
      url = buildAuthUrl();
    } catch (e) {
      return reject(Object.assign(new Error(e.message), { status: 500, expose: false }));
    }

    const ws = new WebSocket(url);
    let fullText = '';
    let settled = false;
    const timer = setTimeout(() => {
      if (!settled) {
        settled = true;
        try { ws.close(); } catch {}
        reject(Object.assign(new Error('星辰 Agent 响应超时'), { status: 504, expose: true }));
      }
    }, timeout);

    ws.on('open', () => {
      // app_id 为讯飞接口必传字段，缺失时直接报错（避免 10004 SchemaCheckError）
      if (!appId) {
        if (!settled) {
          settled = true;
          clearTimeout(timer);
          try { ws.close(); } catch {}
          reject(Object.assign(
            new Error('星辰 Agent 缺少 APP_ID：请在讯飞开放平台控制台获取应用 App ID，并配置到 .env 的 XINGCHEN_AGENT_APP_ID'),
            { status: 500, expose: false }
          ));
        }
        return;
      }
      // 构造请求体：header / parameter / payload
      const reqBody = {
        header: {
          app_id: appId,
          uid: 'yueyun_user',
        },
        parameter: {
          chat: {
            // domain 对于星辰助手 Agent 接口非必传（Agent 已由 URL 中的 assistant_id 标识）
            temperature,
            max_tokens: maxTokens,
          },
        },
        payload: {
          message: {
            text: messages,
          },
        },
      };
      ws.send(JSON.stringify(reqBody));
    });

    ws.on('message', (raw) => {
      let json;
      try {
        json = JSON.parse(raw.toString());
      } catch {
        return; // 忽略无法解析的帧
      }

      const header = json.header || {};
      // 错误处理
      if (header.code && header.code !== 0) {
        if (!settled) {
          settled = true;
          clearTimeout(timer);
          try { ws.close(); } catch {}
          const msg = header.message || `星辰 Agent 错误码 ${header.code}`;
          console.error('[星辰Agent] 业务错误:', header.code, msg);
          reject(Object.assign(new Error(msg), { status: 502, expose: true }));
        }
        return;
      }

      // 插件/信源信息（联网搜索时返回）
      const pluginText = json.payload?.plugins?.text;
      if (pluginText && onPlugin) {
        onPlugin(pluginText);
      }

      // 文本响应
      const choices = json.payload?.choices;
      if (choices?.text?.length) {
        const piece = choices.text[0].content || '';
        if (piece) {
          fullText += piece;
          if (onToken) onToken(piece);
        }
      }

      // status: 0 开始 / 1 进行中 / 2 结束
      if (header.status === 2) {
        if (!settled) {
          settled = true;
          clearTimeout(timer);
          try { ws.close(); } catch {}
          resolve(fullText);
        }
      }
    });

    ws.on('error', (err) => {
      if (!settled) {
        settled = true;
        clearTimeout(timer);
        console.error('[星辰Agent] WebSocket 错误:', err.message);
        reject(Object.assign(new Error('星辰 Agent 连接失败：' + err.message), { status: 502, expose: true }));
      }
    });

    ws.on('close', () => {
      if (!settled) {
        settled = true;
        clearTimeout(timer);
        // 连接关闭但未收到结束帧，返回已收到的文本
        if (fullText) resolve(fullText);
        else reject(Object.assign(new Error('星辰 Agent 连接异常关闭'), { status: 502, expose: true }));
      }
    });
  });
}
