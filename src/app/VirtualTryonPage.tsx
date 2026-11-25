import { IframePage } from '../shared/IframePage';

// 虚拟试衣：MediaPipe 姿态识别 + 每帧渲染循环（2597 行，iframe 桥接）
export function VirtualTryonPage() {
  return <IframePage src="/virtual-tryon.html?bare=1" title="虚拟试衣 · 越剧行当服饰" />;
}
