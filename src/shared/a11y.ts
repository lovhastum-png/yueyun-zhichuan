// 无障碍小工具：让「非 button 元素充当按钮」的既有卡片/标签/筹码可被键盘操作。
// 用法：<div className="chip" onClick={fn} {...activateProps(fn)}>…</div>
// 这样 Enter / Space 与鼠标点击行为完全一致，且不会改变既有 DOM 结构与样式。

import type { KeyboardEvent } from 'react';

export function activateProps(onActivate: () => void, label?: string) {
  return {
    role: 'button' as const,
    tabIndex: 0,
    'aria-label': label,
    onKeyDown: (e: KeyboardEvent<HTMLElement>) => {
      if (e.key === 'Enter' || e.key === ' ' || e.key === 'Spacebar') {
        e.preventDefault();
        onActivate();
      }
    },
  };
}
