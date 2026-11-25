// 流式问答的响应工具。发出响应头后，错误也要通过流事件返回。

// 写入 SSE 响应头（此时起 HTTP 状态码已固定为 200，不能再改）
export function openSse(res) {
  res.setHeader('Content-Type', 'text/event-stream; charset=utf-8');
  res.setHeader('Cache-Control', 'no-cache, no-transform');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('X-Accel-Buffering', 'no');
  res.flushHeaders?.();
}

// 发送一条 SSE 事件；连接已结束时返回 false，调用方可据此提前停止后续工作
export function sseSend(res, payload) {
  if (res.writableEnded || res.destroyed) return false;
  res.write(`data: ${JSON.stringify(payload)}\n\n`);
  return true;
}

// 以 SSE error 事件的形式报告失败并收尾
export function sseFail(res, err, fallbackMessage = '服务暂时不可用，请稍后重试') {
  sseSend(res, { type: 'error', message: err?.expose ? err.message : fallbackMessage });
  if (!res.writableEnded && !res.destroyed) res.end();
}

// 包裹 SSE 路由处理器
export function sseHandler(handleRequest) {
  return async (req, res) => {
    try {
      await handleRequest(req, res);
    } catch (err) {
      if (res.headersSent) {
        sseFail(res, err);
        return;
      }

      const status = err?.status || 500;
      res.status(status).json({
        code: status,
        message: err?.expose ? err.message : '服务器内部错误',
        data: null,
      });
    }
  };
}
