import { Component, type ReactNode } from 'react';

export class PageErrorBoundary extends Component<{ children: ReactNode }, { failed: boolean }> {
  state = { failed: false };
  static getDerivedStateFromError() { return { failed: true }; }
  render() {
    if (this.state.failed) {
      return <main className="empty-state" role="alert">
        <h1>页面暂时无法打开</h1>
        <p>可能是网络中断或页面已更新，请重新加载。</p>
        <button type="button" className="btn btn-primary" onClick={() => window.location.reload()}>重新加载</button>
        <a className="btn btn-ghost" href="/app/">返回首页</a>
      </main>;
    }
    return this.props.children;
  }
}
