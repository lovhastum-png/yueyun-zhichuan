import { IframePage } from '../shared/IframePage';

// 越韵里：江南建筑群与中央越剧戏台，导航与登录状态由 SPA 外层统一提供。
export function StagePage() {
  return <IframePage src="/3d-stage.html?bare=1" title="越韵里 · 江南戏院 3D舞台" />;
}
