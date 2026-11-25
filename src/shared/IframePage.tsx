// 重命令式页面（摄像头 / WebGL / 数字人）的 SPA 桥接：
// 以 iframe 加载旧页面（加 ?bare=1 隐藏其自带导航），外壳由 AppLayout 统一提供。
// allow 属性授予摄像头/麦克风/自动播放/全屏权限。
export function IframePage({ src, title }: { src: string; title: string }) {
  return (
    <iframe
      src={src}
      title={title}
      allow="camera; microphone; autoplay; fullscreen; xr-spatial-tracking"
      allowFullScreen
      style={{ flex: 1, width: '100%', border: 'none', display: 'block' }}
    />
  );
}
