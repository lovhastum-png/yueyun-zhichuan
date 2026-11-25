import { IframePage } from '../shared/IframePage';

// 越韵先生：摄像头 + 数字人语音教学（1321 行命令式逻辑，iframe 桥接）
export function VirtualTeacherPage() {
  return <IframePage src="/virtual-teacher.html?bare=1" title="越韵先生 · AI 虚拟越剧老师" />;
}
