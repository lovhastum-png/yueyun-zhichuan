import React, { lazy, Suspense } from 'react';
import ReactDOM from 'react-dom/client';
import { BrowserRouter, Routes, Route, Navigate, useLocation } from 'react-router-dom';

// 复用旧版设计系统，与旧页面视觉完全一致
import '../../public/css/base.css';
import '../../public/css/components.css';
import '../../public/css/pages.css';
import '../../public/css/learn.css';
import './spa.css';
import './polish.css';
import './dashboard.css';
import './image-gallery.css';
import './motion.css';
import './atmosphere.css';
import './experience.css';

import { isLoggedIn } from '../shared/auth';
import { ToastHost } from '../shared/toast';
import type { ReactElement } from 'react';

import { AppLayout, RouteFallback } from './AppLayout';
import { PageErrorBoundary } from '../shared/PageErrorBoundary';

// 页面组件
const LoginPage = lazy(() => import('./LoginPage').then((module) => ({ default: module.LoginPage })));
const ExperiencePage = lazy(() => import('./ExperiencePage').then((module) => ({ default: module.ExperiencePage })));
const DashboardPage = lazy(() => import('./DashboardPage').then((module) => ({ default: module.DashboardPage })));
const CourseListPage = lazy(() => import('./CourseListPage').then((module) => ({ default: module.CourseListPage })));
const CourseDetailPage = lazy(() => import('./CourseDetailPage').then((module) => ({ default: module.CourseDetailPage })));
const CourseReaderPage = lazy(() => import('./CourseReaderPage').then((module) => ({ default: module.CourseReaderPage })));
const CourseImportPage = lazy(() => import('./CourseImportPage').then((module) => ({ default: module.CourseImportPage })));
const ExamPage = lazy(() => import('./ExamPage').then((module) => ({ default: module.ExamPage })));
const AssignmentPage = lazy(() => import('./AssignmentPage').then((module) => ({ default: module.AssignmentPage })));
const ProfilePage = lazy(() => import('./ProfilePage').then((module) => ({ default: module.ProfilePage })));
const ChatPage = lazy(() => import('./ChatPage').then((module) => ({ default: module.ChatPage })));
const AgentPage = lazy(() => import('./AgentPage').then((module) => ({ default: module.AgentPage })));
const MultiAgentPage = lazy(() => import('./MultiAgentPage').then((module) => ({ default: module.MultiAgentPage })));
const KgPage = lazy(() => import('./KgPage').then((module) => ({ default: module.KgPage })));
const ImagePage = lazy(() => import('./ImagePage').then((module) => ({ default: module.ImagePage })));
const AudioPage = lazy(() => import('./AudioPage').then((module) => ({ default: module.AudioPage })));
const SingingEvalPage = lazy(() => import('./SingingEvalPage').then((module) => ({ default: module.SingingEvalPage })));
const PoseEvalPage = lazy(() => import('./PoseEvalPage').then((module) => ({ default: module.PoseEvalPage })));
const ScriptComparePage = lazy(() => import('./ScriptComparePage').then((module) => ({ default: module.ScriptComparePage })));
const BanshiPage = lazy(() => import('./BanshiPage').then((module) => ({ default: module.BanshiPage })));
const DrawPage = lazy(() => import('./DrawPage').then((module) => ({ default: module.DrawPage })));
const ChatroomPage = lazy(() => import('./ChatroomPage').then((module) => ({ default: module.ChatroomPage })));
const LearningPathPage = lazy(() => import('./LearningPathPage').then((module) => ({ default: module.LearningPathPage })));
const KnowledgeReviewPage = lazy(() => import('./KnowledgeReviewPage').then((module) => ({ default: module.KnowledgeReviewPage })));
const AdminPage = lazy(() => import('./AdminPage').then((module) => ({ default: module.AdminPage })));
const VirtualTeacherPage = lazy(() => import('./VirtualTeacherPage').then((module) => ({ default: module.VirtualTeacherPage })));
const VirtualTryonPage = lazy(() => import('./VirtualTryonPage').then((module) => ({ default: module.VirtualTryonPage })));
const StagePage = lazy(() => import('./StagePage').then((module) => ({ default: module.StagePage })));

// 数媒展示入口：访客与已登录用户都先进入公开数字展馆。
function RootRedirect() {
  return <Navigate to="/experience" replace />;
}

// 路由级登录守卫：未登录重定向到 /login（路由内跳转，无整页刷新）
function RequireAuth({ children }: { children: ReactElement }) {
  const location = useLocation();
  if (!isLoggedIn()) return <Navigate to={'/login?next=' + encodeURIComponent('/app' + location.pathname + location.search + location.hash)} replace />;
  return children;
}

function Auth(props: { children: ReactElement }) {
  return <RequireAuth>{props.children}</RequireAuth>;
}

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <BrowserRouter basename="/app">
      <PageErrorBoundary>
      {/* 布局之外的路由（登录页）兜底：分包未就绪时显示全屏研墨加载态 */}
      <Suspense fallback={<RouteFallback variant="full" />}>
      <Routes>
        {/* 登录页独立于共享布局（无导航条，与旧版 login 页一致） */}
        <Route path="/login" element={<LoginPage />} />

        {/* 其余页面共享 AppLayout：导航条/页脚常驻，仅内容区随路由切换 */}
        <Route element={<AppLayout />}>
          <Route index element={<RootRedirect />} />
          <Route path="/experience" element={<ExperiencePage />} />

          {/* 公开浏览页（发送消息等操作在页面内做登录校验） */}
          <Route path="/chat" element={<ChatPage />} />
          <Route path="/agent" element={<AgentPage />} />
          <Route path="/multi-agent" element={<MultiAgentPage />} />
          <Route path="/kg" element={<KgPage />} />
          <Route path="/image" element={<ImagePage />} />
          <Route path="/audio" element={<AudioPage />} />
          <Route path="/singing-eval" element={<SingingEvalPage />} />
          <Route path="/pose-eval" element={<Auth><PoseEvalPage /></Auth>} />
          <Route path="/script-compare" element={<ScriptComparePage />} />
          <Route path="/banshi" element={<BanshiPage />} />
          <Route path="/draw" element={<DrawPage />} />

          {/* 需登录 */}
          <Route path="/dashboard" element={<Auth><DashboardPage /></Auth>} />
          <Route path="/courses" element={<Auth><CourseListPage /></Auth>} />
          <Route path="/course-detail" element={<Auth><CourseDetailPage /></Auth>} />
          <Route path="/course-reader" element={<Auth><CourseReaderPage /></Auth>} />
          <Route path="/course-import" element={<Auth><CourseImportPage /></Auth>} />
          <Route path="/exam" element={<Auth><ExamPage /></Auth>} />
          <Route path="/assignment" element={<Auth><AssignmentPage /></Auth>} />
          <Route path="/profile" element={<Auth><ProfilePage /></Auth>} />
          <Route path="/chatroom" element={<Auth><ChatroomPage /></Auth>} />
          <Route path="/learning-path" element={<Auth><LearningPathPage /></Auth>} />
          <Route path="/knowledge-review" element={<Auth><KnowledgeReviewPage /></Auth>} />
          <Route path="/admin" element={<Auth><AdminPage /></Auth>} />

          {/* 重命令式页面：iframe 桥接（摄像头 / WebGL / 数字人） */}
          <Route path="/virtual-teacher" element={<Auth><VirtualTeacherPage /></Auth>} />
          <Route path="/virtual-tryon" element={<Auth><VirtualTryonPage /></Auth>} />
          <Route path="/stage" element={<Auth><StagePage /></Auth>} />
        </Route>

        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
      </Suspense>
      </PageErrorBoundary>
      <ToastHost />
    </BrowserRouter>
  </React.StrictMode>,
);

// 首屏加载态交棒：待 React 首帧提交后再淡出 #boot-splash，
// 与路由兜底（研墨）自然衔接，避免「韵字 splash」被硬切造成的闪烁。
const bootSplash = document.getElementById('boot-splash');
if (bootSplash) {
  requestAnimationFrame(() => {
    bootSplash.classList.add('boot-splash-out');
    window.setTimeout(() => bootSplash.remove(), 460);
  });
}
