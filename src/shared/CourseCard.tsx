import { Link } from 'react-router-dom';
import type { Course } from './types';

// 课程卡片：课程列表页与主页「我的课程」共用
// index 用于错落入场动画的延迟序号（每张延 45ms）
export function CourseCard({
  course,
  showJoin = false,
  onJoin,
  index = 0,
}: {
  course: Course;
  showJoin?: boolean;
  onJoin?: (id: number) => void;
  index?: number;
}) {
  // 封面竖排取标题前 3 字（去空白），不足则单字
  const coverChars = (course.title || '课').replace(/\s/g, '').slice(0, 3).split('');
  // 分类印章取前 2 字（如「流派唱腔」→「流派」）
  const categorySeal = (course.category || '').replace(/\s/g, '').slice(0, 2);

  return (
    <Link
      className="course-card rise-in"
      to={`/course-detail?id=${course.id}`}
      style={{ animationDelay: `${index * 45}ms` }}
    >
      <div className="course-cover">
        <div className="course-cover-mountains" aria-hidden="true" />
        <div className="course-cover-chars" aria-hidden="true">
          {coverChars.map((ch, i) => (
            <span key={i}>{ch}</span>
          ))}
        </div>
        {categorySeal && (
          <div className="course-cover-seal" aria-hidden="true">
            {categorySeal}
          </div>
        )}
        {showJoin && !!course.joined && <div className="course-joined-mark">已修</div>}
      </div>
      <div className="course-body">
        <div className="course-title">{course.title}</div>
        <div className="course-subtitle">{course.subtitle || course.description || ''}</div>
        <div className="course-meta">
          <div className="teacher">
            <span className="teacher-avatar">
              {(course.teacher_real_name || course.teacher_name || '师').charAt(0)}
            </span>
            <span>{course.teacher_real_name || course.teacher_name || '未知'}</span>
          </div>
          <div className="course-meta-right">
            {course.code ? <span className="course-code">{course.code}</span> : null}
            <span>{course.member_count || 0} 人修读</span>
          </div>
        </div>
        {showJoin && !course.joined && onJoin && (
          <button
            className="btn btn-primary btn-sm course-join-btn"
            onClick={(e) => {
              e.preventDefault();
              e.stopPropagation();
              onJoin(course.id);
            }}
          >
            加入课程
          </button>
        )}
        {showJoin && !!course.joined && (
          <div className="status-seal present" style={{ marginTop: 10, justifyContent: 'center' }}>
            已加入
          </div>
        )}
      </div>
    </Link>
  );
}
