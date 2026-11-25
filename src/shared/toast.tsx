import { useEffect, useState } from 'react';

export type ToastType = 'ok' | 'err' | 'info';

interface ToastItem {
  id: number;
  message: string;
  type: ToastType;
}

let items: ToastItem[] = [];
let listeners: Array<(items: ToastItem[]) => void> = [];
let nextId = 1;

// 兜底文案：后端 message 可能为空/undefined，若不兜底会出现「空白提示条」
const FALLBACK: Record<ToastType, string> = {
  ok: '操作已完成',
  err: '操作失败，请稍后重试',
  info: '操作已完成',
};

// 与旧版 common.js 的全局 toast() 保持一致的调用方式，可在任何模块直接调用
export function toast(message: string, type: ToastType = 'info', duration = 2600) {
  const text = String(message ?? '').trim() || FALLBACK[type];
  const item: ToastItem = { id: nextId++, message: text, type };
  items = [...items, item];
  listeners.forEach((l) => l(items));
  setTimeout(() => {
    items = items.filter((i) => i.id !== item.id);
    listeners.forEach((l) => l(items));
  }, duration);
}

// 每个页面挂载一次即可，样式复用 base.css 的 .toast-wrap / .toast
export function ToastHost() {
  const [list, setList] = useState<ToastItem[]>(items);

  useEffect(() => {
    listeners.push(setList);
    return () => {
      listeners = listeners.filter((l) => l !== setList);
    };
  }, []);

  return (
    // 屏幕阅读器可感知：提示条出现时自动播报
    <div className="toast-wrap" role="status" aria-live="polite" aria-atomic="false">
      {list.map((t) => (
        <div key={t.id} className={`toast ${t.type === 'ok' ? 'ok' : t.type === 'err' ? 'err' : ''}`}>
          {t.message}
        </div>
      ))}
    </div>
  );
}
