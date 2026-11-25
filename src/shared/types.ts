// 与后端统一响应结构 { code, message, data } 对齐；code=0 表示成功
export interface ApiResponse<T = unknown> {
  code: number;
  message: string;
  data: T;
}

export type Role = 'teacher' | 'student';

export interface User {
  id: number;
  username: string;
  email: string | null;
  role: Role;
  realName?: string | null;
  avatar?: string | null;
  intro?: string | null;
}

export interface LoginResult {
  token: string;
  user: User;
}

export interface Course {
  id: number;
  title: string;
  subtitle?: string | null;
  description?: string | null;
  cover?: string | null;
  category?: string | null;
  code?: string | null;
  status?: 'open' | 'closed';
  teacher_name?: string | null;
  teacher_real_name?: string | null;
  member_count?: number;
  joined?: boolean;
}
