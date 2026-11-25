// 研墨思考动画：AI 等待期间的「砚台磨墨」占位。
// 一方端砚 + 墨锭：墨锭保持倾斜姿态、底端沿椭圆轨迹在砚池内环绕研磨，
// 墨色涟漪随之荡开 —— 越剧平台的 AI 思考隐喻。
// 纯 SVG + CSS 动画，零依赖；样式见 polish.css 的 .ink-grind 段。

export function InkGrinding({ text = '正在研墨构思…' }: { text?: string }) {
  return (
    <div className="ink-grind" role="status" aria-label={text}>
      <svg className="ink-grind-inkstone" viewBox="0 0 72 72" width="56" height="56" aria-hidden="true">
        {/* 砚台：椭圆砚池 + 砚缘 */}
        <ellipse cx="36" cy="44" rx="26" ry="12" fill="#2c3a3a" opacity="0.16" />
        <ellipse cx="36" cy="42" rx="26" ry="12" fill="#3d4f4e" />
        <ellipse cx="36" cy="40.5" rx="26" ry="12" fill="#4a5f5d" />
        {/* 砚池（墨汁） */}
        <ellipse cx="36" cy="40.5" rx="19" ry="8" fill="#1f2b2a" />
        <ellipse cx="36" cy="40" rx="19" ry="8" fill="#263332" />
        {/* 墨锭（随组旋转） */}
        <g className="ink-grind-stick">
          <rect x="32.5" y="20" width="7" height="22" rx="3" fill="#191c1b" transform="rotate(-8 36 31)" />
          <rect x="34" y="22" width="2.4" height="16" rx="1.2" fill="#2e3432" opacity="0.6" transform="rotate(-8 36 31)" />
        </g>
        {/* 墨色涟漪（研磨荡开） */}
        <ellipse className="ink-grind-ripple" cx="36" cy="40.5" rx="19" ry="8" fill="none" stroke="#6b9fa3" strokeWidth="1" opacity="0" />
      </svg>
      <span className="ink-grind-text">{text}</span>
    </div>
  );
}
