import type { CSSProperties, ReactNode } from 'react';

interface EmptyStateProps {
  /** 印匣大字符；省略则不渲染图标（如纯文案或加载态） */
  icon?: ReactNode;
  /** 主文案（渲染进 .empty-state-text） */
  text?: ReactNode;
  /** 追加在文案之后的额外内容（如「重新加载」按钮） */
  children?: ReactNode;
  className?: string;
  style?: CSSProperties;
  role?: 'alert' | 'status';
}

/**
 * 统一空状态（印匣意象）：全站空态共用同一套结构与 class，
 * 视觉由 learn.css 的 .empty-state / .empty-state-icon / .empty-state-text 提供。
 */
export function EmptyState({ icon, text, children, className, style, role }: EmptyStateProps) {
  return (
    <div className={'empty-state' + (className ? ' ' + className : '')} style={style} role={role}>
      {icon != null && <div className="empty-state-icon">{icon}</div>}
      {text != null && <div className="empty-state-text">{text}</div>}
      {children}
    </div>
  );
}
