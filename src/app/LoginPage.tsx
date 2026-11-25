import { useState, type FormEvent } from 'react';
import { Navigate, useNavigate } from 'react-router-dom';
import { request } from '../shared/api';
import { isLoggedIn, setToken, setUser } from '../shared/auth';
import { toast } from '../shared/toast';
import { activateProps } from '../shared/a11y';
import type { LoginResult, Role } from '../shared/types';

type Mode = 'login' | 'register';

// 登录 / 注册页：交互与旧版 auth.js 一致。
// 登录成功后通过 SPA 路由进入课程页（无整页刷新）；旧版是跳 dashboard.html。
export function LoginPage() {
  const navigate = useNavigate();
  const [mode, setMode] = useState<Mode>('login');
  const [role, setRole] = useState<Role>('student');
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [realName, setRealName] = useState('');
  const [submitting, setSubmitting] = useState(false);
  // 开场动画重播序号：自增触发左侧内容 remount，动画从头播放
  const [replayKey, setReplayKey] = useState(0);

  // 已登录则直接进入主页（路由内重定向）
  if (isLoggedIn()) {
    return <Navigate to="/dashboard" replace />;
  }

  const isRegister = mode === 'register';

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    const name = username.trim();
    if (!name || !password) {
      toast('请填写用户名和密码', 'err');
      return;
    }
    if (isRegister && password.length < 6) {
      toast('密码不少于 6 位', 'err');
      return;
    }

    setSubmitting(true);
    const body = isRegister
      ? { username: name, password, role, realName: realName.trim() || undefined }
      : { username: name, password };
    const res = await request<LoginResult>(`/auth/${mode}`, { method: 'POST', body });
    setSubmitting(false);

    if (res.code !== 0 || !res.data) {
      toast(res.message || '操作失败', 'err');
      return;
    }

    setToken(res.data.token);
    setUser(res.data.user);
    toast(isRegister ? '注册成功，欢迎加入' : '登录成功', 'ok');
    // 路由内跳转：不触发整页加载
    setTimeout(() => navigate('/dashboard', { replace: true }), 700);
  };

  return (
    <div className="auth-layout">
      {/* 左侧水墨意境：印章旋落 + 标题逐字浮现（动画见 polish.css）。
          点击左侧区域可重播开场动画（演示用彩蛋） */}
      <aside
        className="auth-aside"
        onClick={() => setReplayKey((k) => k + 1)}
        title="点击重播开场动画"
        style={{ cursor: 'pointer' }}
      >
        <div className="auth-aside-content" key={replayKey}>
          <div className="auth-aside-seal">韵</div>
          <h1>
            {'越韵智传'.split('').map((ch, i) => (
              <span className="auth-title-char" key={i} style={{ animationDelay: `${0.35 + i * 0.13}s` }}>
                {ch}
              </span>
            ))}
          </h1>
          <p>越剧教学辅助平台<br />水墨写意 · 戏曲传承 · 智慧育人</p>
        </div>
      </aside>

      {/* 右侧表单 */}
      <main className="auth-main">
        <div className="auth-card-box">
          <h2>{isRegister ? '注 册' : '登 录'}</h2>
          <p className="auth-sub">{isRegister ? '加入越韵智传，开启越剧学习之旅' : '欢迎回到越韵智传'}</p>

          {/* 角色选择（仅注册时显示） */}
          <div className={`role-pick ${isRegister ? '' : 'hidden'}`} role="group" aria-label="选择角色">
            <div
              className={`role-pick-opt ${role === 'student' ? 'active' : ''}`}
              onClick={() => setRole('student')}
              {...activateProps(() => setRole('student'), '学生')}
            >
              <div className="role-pick-opt-icon">生</div>
              <div className="role-pick-opt-label">学 生</div>
            </div>
            <div
              className={`role-pick-opt ${role === 'teacher' ? 'active' : ''}`}
              onClick={() => setRole('teacher')}
              {...activateProps(() => setRole('teacher'), '教师')}
            >
              <div className="role-pick-opt-icon">师</div>
              <div className="role-pick-opt-label">教 师</div>
            </div>
          </div>

          <form onSubmit={submit}>
            <div className="field">
              <label className="field-label" htmlFor="login-username">用户名</label>
              <input
                id="login-username"
                className="input"
                placeholder="请输入用户名"
                autoComplete="username"
                value={username}
                onChange={(e) => setUsername(e.target.value)}
              />
            </div>
            <div className="field">
              <label className="field-label" htmlFor="login-password">密码</label>
              <input
                id="login-password"
                className="input"
                type="password"
                placeholder="请输入密码（不少于 6 位）"
                autoComplete="current-password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
              />
            </div>
            <div className={`field ${isRegister ? '' : 'hidden'}`}>
              <label className="field-label" htmlFor="login-realname">真实姓名（选填）</label>
              <input
                id="login-realname"
                className="input"
                placeholder="如：林清音"
                value={realName}
                onChange={(e) => setRealName(e.target.value)}
              />
            </div>

            <button
              className="btn btn-primary btn-lg"
              type="submit"
              disabled={submitting}
              style={{ width: '100%', marginTop: 8 }}
            >
              {submitting ? (
                <>
                  <span className="spinner" style={{ width: 16, height: 16, borderWidth: 2 }} /> 处理中…
                </>
              ) : isRegister ? (
                '注 册'
              ) : (
                '登 录'
              )}
            </button>
          </form>

          <div style={{ textAlign: 'center', marginTop: 18, fontSize: 14, color: 'var(--ink-light)' }}>
            <span>{isRegister ? '已有账号？' : '还没有账号？'}</span>
            <a
              href="javascript:;"
              style={{ color: 'var(--cinnabar)', fontWeight: 500, cursor: 'pointer' }}
              onClick={() => setMode(isRegister ? 'login' : 'register')}
            >
              {isRegister ? '返回登录' : '立即注册'}
            </a>
          </div>

          <div className="demo-account">
            <b>演示账号</b>
            <br />
            教师：teacher / teacher123
            <br />
            学生：student1 / student123
            <br />
            学生：student2 / student123
          </div>
        </div>
      </main>
    </div>
  );
}
