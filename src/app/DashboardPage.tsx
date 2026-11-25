import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { request } from '../shared/api';
import { getUser } from '../shared/auth';
import { toast } from '../shared/toast';
import { CourseCard } from '../shared/CourseCard';
import { activateProps } from '../shared/a11y';
import type { Course } from '../shared/types';
import stageHero from '../../public/assets/generated/yueju-hero-v1.webp';
import stagePerformer from '../../public/assets/generated/defaults/stage-performer-v1.webp';
import gardenDawn from '../../public/assets/generated/defaults/garden-dawn-v1.webp';
import backstage from '../../public/assets/generated/defaults/backstage-v1.webp';
import inkLandscape from '../../public/assets/generated/defaults/ink-landscape-v1.webp';

interface DashTile {
  icon: string;
  title: string;
  sub: string;
  href: string;
}

interface Feature extends DashTile {
  cue: string;
  note: string;
  tone: 'vermilion' | 'jade' | 'midnight' | 'gold';
}

// 精选入口 = 三大含金量亮点 + 3D 舞台（舞台放最矮的横条位，弱化展示）
// 卡位布局见 dashboard.css：card-1 左侧通高（最大）、card-2/3 上排、card-4 底部横条（最矮）
function buildFeaturedTools(isTeacher: boolean): Feature[] {
  return [
    {
      icon: '问',
      title: '开卷问戏',
      sub: 'RAG 检索 · 多智能体问答',
      href: '/agent',
      cue: '一问一答，皆有出处',
      note: '检索两千余条越剧权威语料，智能体调用工具作答，回答标注来源、流式呈现。',
      tone: 'vermilion',
    },
    {
      icon: '唱',
      title: '听腔评唱',
      sub: '演唱测评 · 音准板眼',
      href: '/singing-eval',
      cue: '音准板眼，逐段定位',
      note: 'DTW 对齐范本唱段，标记抢板拖板与音分偏差，生成分段改进报告。',
      tone: 'jade',
    },
    isTeacher
      ? {
          icon: '课',
          title: '一册成课',
          sub: '课程精读 · 知识图谱',
          href: '/course-import',
          cue: '一册教材，满堂内容',
          note: '上传 PDF 自动生成教案、课件、测验，并抽取六类越剧实体织成图谱。',
          tone: 'midnight',
        }
      : {
          icon: '图',
          title: '一册成课',
          sub: '越剧图谱 · 结构化知识',
          href: '/kg',
          cue: '流派源流，一图可循',
          note: '人物、流派、剧目、行当、唱段、概念六类实体与关系，图谱化呈现。',
          tone: 'midnight',
        },
    {
      icon: '台',
      title: '云上登台',
      sub: '3D 舞台',
      href: '/stage',
      cue: '灯亮时，故事才开始',
      note: '调度角色、服装与动作，让练习有一方真正的舞台。',
      tone: 'gold',
    },
  ];
}

// ---------- 生图定制卡片背景：用户用「丹青生图」的作品装点主页入口 ----------
type FeatureBgMap = Record<string, string>;
const BG_STORE_PREFIX = 'yueyun_feature_bg_';

function loadBgMap(username: string): FeatureBgMap {
  try {
    return JSON.parse(localStorage.getItem(BG_STORE_PREFIX + username) || '{}') || {};
  } catch {
    return {};
  }
}

function saveBgMap(username: string, map: FeatureBgMap) {
  try {
    localStorage.setItem(BG_STORE_PREFIX + username, JSON.stringify(map));
  } catch {
    /* 存储不可用时静默降级：仅本次会话生效 */
  }
}

interface GalleryItem {
  id: number | string;
  prompt: string;
  imageUrl: string;
  source: 'preset' | 'personal';
}

const DEFAULT_BACKGROUND_IMAGES: GalleryItem[] = [
  { id: 'preset-stage', prompt: '朱帷初启，越剧花旦立于戏台中央', imageUrl: stagePerformer, source: 'preset' },
  { id: 'preset-garden', prompt: '春晓园林，水袖轻扬的越剧人物', imageUrl: gardenDawn, source: 'preset' },
  { id: 'preset-backstage', prompt: '戏箱与妆台之间的后台片刻', imageUrl: backstage, source: 'preset' },
  { id: 'preset-ink', prompt: '水墨江南，戏韵隐现于山水之间', imageUrl: inkLandscape, source: 'preset' },
];

// 教学主页：以「入场—习艺—续课」组织内容，保留全部原有功能入口。
export function DashboardPage() {
  const user = getUser();
  const isTeacher = user?.role === 'teacher';
  const [myCourses, setMyCourses] = useState<Course[] | null>(null);

  // 生图定制背景：可从馆藏越剧底图或用户自己在「丹青生图」生成的作品中选用
  const bgOwner = user?.username || 'anon';
  const [bgMap, setBgMap] = useState<FeatureBgMap>(() => loadBgMap(bgOwner));
  const [pickerTarget, setPickerTarget] = useState<{ key: string; label: string } | null>(null);
  const [gallery, setGallery] = useState<GalleryItem[] | null>(null);

  const openPicker = (target: { key: string; label: string }) => {
    setPickerTarget(target);
    setGallery(null);
    request<GalleryItem[]>('/image/history')
      .then((res) => setGallery(res.code === 0 && res.data ? res.data.map((item) => ({ ...item, source: 'personal' as const })) : []))
      .catch(() => setGallery([]));
  };

  const applyBg = (target: { key: string; label: string }, url: string) => {
    const next = { ...bgMap, [target.key]: url };
    saveBgMap(bgOwner, next);
    setBgMap(next);
    setPickerTarget(null);
    toast(`「${target.label}」已换上新背景`);
  };

  const resetBg = (target: { key: string; label: string }) => {
    const next = { ...bgMap };
    delete next[target.key];
    saveBgMap(bgOwner, next);
    setBgMap(next);
    toast(`「${target.label}」已恢复默认底色`);
  };

  useEffect(() => {
    document.title = '越韵智传 · 教学主页';
    let alive = true;
    (async () => {
      const res = await request<Course[]>('/course');
      if (alive) setMyCourses(res.code === 0 && res.data ? res.data : []);
    })();
    return () => {
      alive = false;
    };
  }, []);

  const hour = new Date().getHours();
  const greet = hour < 6 ? '夜安' : hour < 12 ? '早安' : hour < 14 ? '午安' : hour < 18 ? '日安' : '晚安';

  const tiles: DashTile[] = useMemo(
    () =>
      isTeacher
        ? [
            { icon: '课', title: '我的课程', sub: '建课 · 管理 · 授课', href: '/courses' },
            { icon: '助', title: '学习助手', sub: '工具调用 · 智能体', href: '/agent' },
            { icon: '协', title: '协同研习', sub: '多专家协同 · 综合调度', href: '/multi-agent' },
            { icon: '图', title: '越剧图谱', sub: '实体关系 · 结构化知识', href: '/kg' },
            { icon: '师', title: '越韵先生', sub: '语音教学 · 陪练答疑', href: '/virtual-teacher' },
            { icon: '轮', title: '知识飞轮', sub: '高频问题审核 · 数据自成长', href: '/knowledge-review' },
            { icon: '画', title: '丹青生图', sub: '生成越剧意境图', href: '/image' },
            { icon: '唱', title: '演唱测评', sub: '音准节奏 · 分段报告', href: '/singing-eval' },
            { icon: '身', title: '身段测评', sub: '动作捕捉 · 姿态反馈', href: '/pose-eval' },
            { icon: '本', title: '剧本比对', sub: '版本对读 · 差异高亮', href: '/script-compare' },
            { icon: '板', title: '板式解析', sub: '句式格律 · 押韵参考', href: '/banshi' },
            { icon: '墨', title: '水墨画板', sub: '在线水墨创作', href: '/draw' },
            { icon: '集', title: '雅集聊天', sub: '与同学实时交流', href: '/chatroom' },
          ]
        : [
            { icon: '课', title: '我的课程', sub: '学习 · 作业 · 考试', href: '/courses' },
            { icon: '助', title: '学习助手', sub: '工具调用 · 智能体', href: '/agent' },
            { icon: '协', title: '协同研习', sub: '多专家协同 · 综合调度', href: '/multi-agent' },
            { icon: '图', title: '越剧图谱', sub: '实体关系 · 结构化知识', href: '/kg' },
            { icon: '师', title: '越韵先生', sub: '语音教学 · 陪练答疑', href: '/virtual-teacher' },
            { icon: '径', title: '学习路径', sub: '个性化学习推荐', href: '/learning-path' },
            { icon: '画', title: '丹青生图', sub: '生成越剧意境图', href: '/image' },
            { icon: '唱', title: '演唱测评', sub: '音准节奏 · 分段报告', href: '/singing-eval' },
            { icon: '身', title: '身段测评', sub: '动作捕捉 · 姿态反馈', href: '/pose-eval' },
            { icon: '本', title: '剧本比对', sub: '版本对读 · 差异高亮', href: '/script-compare' },
            { icon: '板', title: '板式解析', sub: '句式格律 · 押韵参考', href: '/banshi' },
            { icon: '墨', title: '水墨画板', sub: '在线水墨创作', href: '/draw' },
            { icon: '集', title: '雅集聊天', sub: '与同学实时交流', href: '/chatroom' },
          ],
    [isTeacher],
  );

  const courseCount = myCourses?.length ?? 0;
  const firstCourse = myCourses?.[0];
  const featuredTools = useMemo(() => buildFeaturedTools(isTeacher), [isTeacher]);

  return (
    <main className="main dashboard-main">
      <div className="container dashboard-container">
        <section className="stage-hero rise-in" aria-label="今日入场">
          {(() => {
            // 开场画卷支持用丹青生图作品定制：沿用默认暗色渐变压住左侧，保证标题可读
            const heroBg = bgMap['hero'];
            const heroWash =
              'linear-gradient(90deg, rgba(19, 12, 9, 0.88) 0%, rgba(20, 12, 9, 0.69) 43%, rgba(27, 16, 11, 0.22) 73%, rgba(21, 12, 10, 0.5) 100%)';
            return (
              <div
                className="stage-hero-image"
                aria-hidden="true"
                style={{
                  backgroundImage: heroBg
                    ? `${heroWash}, url(${heroBg})`
                    : `${heroWash}, url(${stageHero})`,
                }}
              />
            );
          })()}
          <span
            className="feature-custom hero-custom"
            title={bgMap['hero'] ? '换一幅开场画卷（丹青生图）' : '用我在丹青生图的画定制开场画卷'}
            onClick={() => openPicker({ key: 'hero', label: '开场画卷' })}
            {...activateProps(() => openPicker({ key: 'hero', label: '开场画卷' }), '开场画卷')}
          >
            绘
          </span>
          <div className="stage-hero-wash" aria-hidden="true" />
          <div className="stage-hero-copy">
            <p className="stage-kicker">YUE OPERA · LEARNING SALON</p>
            <p className="stage-role">{isTeacher ? '传习人的案头' : '习艺人的一席'}</p>
            <h1>
              {greet}，<em>{user?.realName || user?.username}</em>
            </h1>
            <p className="stage-intro">
              {isTeacher ? '一盏灯，一方台。把心法留给后来的耳朵与身段。' : '先听一阙，再起一式。好戏从此刻的专注开始。'}
            </p>
            <div className="stage-actions">
              <Link className="stage-primary" to={isTeacher ? '/courses' : firstCourse ? `/course-detail?id=${firstCourse.id}` : '/courses'}>
                {isTeacher ? '整理今日课单' : firstCourse ? '续读这门课' : '去选一门课'}
                <span aria-hidden="true">↗</span>
              </Link>
              <Link className="stage-secondary" to="/agent">
                向先生问一句戏
              </Link>
            </div>
          </div>

          <aside className="stage-ticket" aria-label="今日学习状态">
            <div className="stage-ticket-top">
              <span>入场笺</span>
              <i>2026</i>
            </div>
            <div className="stage-ticket-mark">韵</div>
            <p className="stage-ticket-label">正在研习</p>
            <strong>{firstCourse?.title || (isTeacher ? '一堂未命名的好课' : '为第一折戏留一席')}</strong>
            <div className="stage-ticket-rule" />
            <div className="stage-ticket-meta">
              <span>{isTeacher ? '授课' : '在读'}课程</span>
              <b>{myCourses === null ? '…' : String(courseCount).padStart(2, '0')}</b>
            </div>
          </aside>
          <p className="stage-quote">“台上三分钟，台下十年功。”</p>
        </section>

        <section className="dashboard-section dashboard-path-section">
          <div className="section-heading">
            <div>
              <p className="section-eyebrow">THREE CRAFTS, ONE STAGE</p>
              <h2>从这一折，走进戏里</h2>
            </div>
            <p>RAG 智能问答、演唱测评、课程精读——先挑一样称手的。</p>
          </div>
          <div className="feature-constellation">
            {featuredTools.map((feature, index) => {
              const bgUrl = bgMap[feature.title];
              // 换上生图背景时叠一层蒙版：深底卡用暗蒙版保持浅字，浅底卡用宣纸蒙版保持墨字
              const wash =
                feature.tone === 'midnight'
                  ? 'linear-gradient(150deg, rgba(17, 28, 33, 0.68), rgba(31, 48, 52, 0.5))'
                  : 'linear-gradient(155deg, rgba(251, 248, 240, 0.58), rgba(251, 248, 240, 0.38))';
              return (
                <Link
                  className={`feature-card feature-${feature.tone} feature-card-${index + 1}`}
                  to={feature.href}
                  key={feature.title}
                  style={
                    bgUrl
                      ? {
                          backgroundImage: `${wash}, url(${bgUrl})`,
                          backgroundSize: 'cover',
                          backgroundPosition: 'center',
                        }
                      : undefined
                  }
                >
                  <div className="feature-number">0{index + 1}</div>
                  <span
                    className="feature-custom"
                    title={bgUrl ? '换一幅背景（丹青生图）' : '用我在丹青生图的画装点这张卡'}
                    onClick={(e) => {
                      e.preventDefault();
                      e.stopPropagation();
                      openPicker({ key: feature.title, label: feature.title });
                    }}
                    {...activateProps(() => openPicker({ key: feature.title, label: feature.title }), feature.title)}
                  >
                    绘
                  </span>
                  <div className="feature-icon">{feature.icon}</div>
                  <div className="feature-copy">
                    <span>{feature.sub}</span>
                    <h3>{feature.title}</h3>
                    <p className="feature-cue">{feature.cue}</p>
                    <p className="feature-note">{feature.note}</p>
                  </div>
                  <span className="feature-arrow" aria-hidden="true">↗</span>
                </Link>
              );
            })}
          </div>
        </section>

        <section className="dashboard-section dashboard-courses-section">
          <div className="section-heading section-heading-compact">
            <div>
              <p className="section-eyebrow">KEEP THE CURTAIN RAISED</p>
              <h2>{isTeacher ? '正在打磨的课堂' : '尚未散场的课程'}</h2>
            </div>
            <Link className="text-link" to="/courses">查看全部 <span>→</span></Link>
          </div>
          <div className="course-atelier">
            {myCourses === null && (
              <div className="atelier-loading" role="status">
                <span className="atelier-loading-brush">墨</span>
                正在展开课程长卷
              </div>
            )}
            {myCourses !== null && myCourses.length === 0 && (
              <div className="atelier-empty">
                <span>留一方空台</span>
                <p>{isTeacher ? '从一门课开始，慢慢把故事交给学生。' : '从一门课开始，给自己的戏路添上第一笔。'}</p>
                <Link to="/courses">去课程大厅</Link>
              </div>
            )}
            {myCourses !== null && myCourses.length > 0 && (
              <div className="course-grid dashboard-course-grid">
                {myCourses.slice(0, 4).map((course, index) => <CourseCard key={course.id} course={course} index={index} />)}
              </div>
            )}
          </div>
        </section>

        <section className="dashboard-section dashboard-workbench-section">
          <details className="workbench-details">
            <summary>
              <span className="workbench-seal">百</span>
              <span>
                <b>全域工作台</b>
                <em>需要时，再打开这一整套家什</em>
              </span>
              <i>展开</i>
            </summary>
            <div className="workbench-grid">
              {tiles.map((tile) => (
                <Link className="workbench-item" to={tile.href} key={tile.title}>
                  <span className="workbench-icon">{tile.icon}</span>
                  <span>
                    <b>{tile.title}</b>
                    <em>{tile.sub}</em>
                  </span>
                  <i aria-hidden="true">↗</i>
                </Link>
              ))}
            </div>
          </details>
        </section>

        {pickerTarget && (
          <div className="bg-picker-overlay" onClick={() => setPickerTarget(null)}>
            <div className="bg-picker" onClick={(e) => e.stopPropagation()} role="dialog" aria-label="选择卡片背景">
              <div className="bg-picker-head">
                <div className="bg-picker-title">
                  <b>以画入卡</b>
                  <em>为「{pickerTarget.label}」挑一幅越剧底图，或选用你的丹青生图作品</em>
                </div>
                <div className="bg-picker-actions">
                  {bgMap[pickerTarget.key] && (
                    <button type="button" className="bg-picker-reset" onClick={() => resetBg(pickerTarget)}>
                      恢复默认
                    </button>
                  )}
                  <button type="button" className="bg-picker-close" aria-label="关闭" onClick={() => setPickerTarget(null)}>
                    ×
                  </button>
                </div>
              </div>
              <div className="bg-picker-grid">
                {DEFAULT_BACKGROUND_IMAGES.map((item) => (
                  <button
                    type="button"
                    key={item.id}
                    className={`bg-picker-item${bgMap[pickerTarget.key] === item.imageUrl ? ' active' : ''}`}
                    title={item.prompt}
                    onClick={() => applyBg(pickerTarget, item.imageUrl)}
                  >
                    <img src={item.imageUrl} alt={item.prompt} loading="lazy" />
                    <span className="bg-picker-tag">馆藏底图</span>
                  </button>
                ))}
                {gallery === null && <div className="bg-picker-loading">正在取你的作品…</div>}
                {gallery?.map((item) => (
                    <button
                      type="button"
                      key={item.id}
                      className={`bg-picker-item${bgMap[pickerTarget.key] === item.imageUrl ? ' active' : ''}`}
                      title={item.prompt}
                      onClick={() => applyBg(pickerTarget, item.imageUrl)}
                    >
                      <img src={item.imageUrl} alt={item.prompt} loading="lazy" />
                      <span className="bg-picker-tag">我的生成</span>
                    </button>
                  ))}
                {gallery !== null && gallery.length === 0 && (
                  <div className="bg-picker-note">你的丹青生图作品也会显示在这里</div>
                )}
              </div>
            </div>
          </div>
        )}
      </div>
    </main>
  );
}
