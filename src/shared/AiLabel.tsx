/**
 * AI 生成内容统一标识组件
 *
 * 竞赛合规要求（《02—伦理与安全合规性声明》第三项承诺）：
 *   系统须在所有人工智能生成内容的显著位置设置“AI 生成内容”标识。
 * 本组件为全站唯一标识来源，任何 AI 输出入口均须引用，禁止各自手写文案。
 *
 * 用法：
 *   <AiBadge />                      —— 行内小徽标，用于标题旁、卡片角标
 *   <AiNotice />                     —— 结果区顶部提示条（默认文案）
 *   <AiNotice text="…" />            —— 自定义说明的提示条
 */
import type { CSSProperties } from 'react';

const TIP = '本内容由人工智能生成，可能存在不准确之处，仅供辅助参考，请结合专业判断与权威资料核验后使用';

const BADGE: CSSProperties = {
  display: 'inline-flex',
  alignItems: 'center',
  gap: 4,
  padding: '1px 8px',
  borderRadius: 999,
  fontSize: 11,
  lineHeight: '17px',
  fontWeight: 700,
  letterSpacing: 0.3,
  color: '#8a5a00',
  background: 'linear-gradient(135deg, #fff8e3 0%, #ffe6ad 100%)',
  border: '1px solid #efc978',
  verticalAlign: 'middle',
  whiteSpace: 'nowrap',
  cursor: 'help',
  userSelect: 'none',
  flexShrink: 0,
};

const DOT: CSSProperties = {
  width: 5,
  height: 5,
  borderRadius: '50%',
  background: '#e09b12',
  display: 'inline-block',
};

export function AiBadge({ text = 'AI 生成', style }: { text?: string; style?: CSSProperties }) {
  return (
    <span className="ai-generated-badge" title={TIP} aria-label={`${text}内容`} style={{ ...BADGE, ...style }}>
      <span style={DOT} />
      {text}
    </span>
  );
}

const NOTICE: CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: 8,
  margin: '10px 0',
  padding: '7px 12px',
  borderRadius: 8,
  fontSize: 12,
  lineHeight: 1.6,
  color: '#7a5200',
  background: 'rgba(255, 245, 219, 0.92)',
  border: '1px solid rgba(239, 201, 120, 0.95)',
};

export function AiNotice({
  text = '以下内容由人工智能生成，仅供参考，请结合专业判断与权威资料核验后使用。',
  style,
}: {
  text?: string;
  style?: CSSProperties;
}) {
  return (
    <div className="ai-generated-notice" role="note" style={{ ...NOTICE, ...style }}>
      <AiBadge />
      <span style={{ flex: 1 }}>{text}</span>
    </div>
  );
}

/** 用于 AI 生成图片/音频等媒体上方的悬浮角标 */
export function AiMediaTag({ text = 'AI 生成' }: { text?: string }) {
  return (
    <span
      className="ai-generated-badge"
      title={TIP}
      style={{
        position: 'absolute',
        top: 8,
        right: 8,
        zIndex: 2,
        ...BADGE,
        boxShadow: '0 1px 4px rgba(0,0,0,.18)',
      }}
    >
      <span style={DOT} />
      {text}
    </span>
  );
}
