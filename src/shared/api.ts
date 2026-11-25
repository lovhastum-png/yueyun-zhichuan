import { getToken, clearAuth } from './auth';
import { toast } from './toast';
import type { ApiResponse } from './types';

interface RequestOptions {
  method?: string;
  body?: unknown;
  headers?: Record<string, string>;
  timeout?: number;
  signal?: AbortSignal;
  silent?: boolean;
}

let redirecting = false;

// 登录过期统一处理：清凭证 + 提示 + 跳登录（带 next 回跳）。
// 抽成函数是为了让 SSE 流式请求也能复用同一套行为。
function handleUnauthorized(): void {
  clearAuth();
  if (redirecting) return;
  redirecting = true;
  const next = window.location.pathname + window.location.search + window.location.hash;
  toast('登录已过期，请重新登录', 'err');
  window.setTimeout(() => {
    window.location.assign('/app/login?next=' + encodeURIComponent(next));
  }, 500);
}

/**
 * 打开 SSE 流式请求（POST + 逐块读取响应体）。
 *
 * 为什么不用 request()：流式接口要拿 ReadableStream，不能等整个响应体。
 * 但直接 fetch 会绕过 request() 里的 401 处理，导致登录过期时
 * 只抛出「请求失败 (401)」这种误导性提示，用户卡在页面不知道要重新登录。
 * 这里补上统一的鉴权与 401 跳转。
 */
export async function openStream(
  path: string,
  body: unknown,
  signal: AbortSignal,
): Promise<Response> {
  const token = getToken();
  const resp = await fetch('/api' + path, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: JSON.stringify(body),
    signal,
  });
  if (resp.status === 401) {
    handleUnauthorized();
    throw new Error('登录已过期，请重新登录');
  }
  return resp;
}

/**
 * FormData 上传专用（图片生成、剧本比对等文件上传接口）。
 * 不能走 request()：request 会把 body JSON 化并设置 Content-Type，
 * 而 multipart 必须由浏览器自动生成 boundary。
 */
export async function postForm<T = unknown>(
  path: string,
  form: FormData,
  options: { timeout?: number; timeoutMessage?: string } = {},
): Promise<ApiResponse<T>> {
  const { timeout, timeoutMessage = '请求超时，请稍后重试' } = options;
  const token = getToken();
  const controller = timeout ? new AbortController() : null;
  const timer = controller ? setTimeout(() => controller.abort(), timeout) : null;

  try {
    const resp = await fetch('/api' + path, {
      method: 'POST',
      headers: token ? { Authorization: `Bearer ${token}` } : undefined,
      body: form,
      signal: controller?.signal,
    });
    return (await resp.json().catch(() => ({
      code: resp.status || -1,
      message: '服务器响应异常',
    }))) as ApiResponse<T>;
  } catch (err) {
    if (err instanceof Error && err.name === 'AbortError') {
      return { code: -1, message: timeoutMessage, data: null as T };
    }
    return { code: -1, message: '网络异常，请重试', data: null as T };
  } finally {
    if (timer) clearTimeout(timer);
  }
}

export async function request<T = unknown>(
  path: string,
  options: RequestOptions = {},
): Promise<ApiResponse<T>> {
  const { method = 'GET', body, headers, timeout = 30000, signal, silent = false } = options;
  const token = getToken();
  const authRequest = /^\/auth\/(login|register)(?:\?|$)/.test(path);
  const controller = new AbortController();
  let timedOut = false;
  const abort = () => controller.abort();
  signal?.addEventListener('abort', abort, { once: true });
  if (signal?.aborted) abort();
  const timer = setTimeout(() => { timedOut = true; controller.abort(); }, timeout);
  const failure = (code: number, message: string): ApiResponse<T> => {
    if (!silent && code !== -2) toast(message, 'err');
    return { code, message, data: null as T };
  };

  try {
    const resp = await fetch('/api' + path, {
      method,
      headers: {
        ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}),
        ...(token && !authRequest ? { Authorization: `Bearer ${token}` } : {}),
        ...headers,
      },
      body: body !== undefined ? JSON.stringify(body) : undefined,
      signal: controller.signal,
    });
    // 保留超时保护直到响应正文读取完成，避免只收到响应头后永久等待。
    const text = await resp.text();
    let data: ApiResponse<T> | undefined;
    try { data = JSON.parse(text); } catch { /* 网关可能返回 HTML 错误页 */ }

    if (resp.status === 401 && !authRequest && token && getToken() === token) {
      handleUnauthorized();
      return { code: 401, message: '登录已过期，请重新登录', data: null as T };
    }
    if (data && typeof data.code === 'number') {
      if (!resp.ok && data.code === 0) return failure(resp.status, '服务器响应异常，请稍后重试');
      return data;
    }
    return failure(resp.ok ? -1 : resp.status,
      resp.status === 413 ? '文件或请求内容过大，请缩小后重试'
        : resp.status === 429 ? '请求过于频繁，请稍后再试'
        : resp.status >= 500 ? '服务暂时不可用，请稍后重试'
        : '服务器响应格式异常，请稍后重试');
  } catch {
    if (signal?.aborted) return failure(-2, '请求已取消');
    return failure(-1, timedOut ? '请求超时，请稍后重试' : '网络连接失败，请检查网络后重试');
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener('abort', abort);
  }
}
