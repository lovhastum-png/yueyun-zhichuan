import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import stage from '../../public/assets/generated/yueju-hero-v1.webp';
import garden from '../../public/assets/generated/defaults/garden-dawn-v1.webp';
import backstage from '../../public/assets/generated/defaults/backstage-v1.webp';
import landscape from '../../public/assets/generated/defaults/ink-landscape-v1.webp';

const scenes = [
  { name: '一折入梦', en: 'THE STAGE', image: stage, title: ['让古老的戏韵，', '在此刻新生。'], desc: '从一声唱腔，到一方数字舞台。以新的方式，走进越剧的万千世界。', href: '/stage', action: '步入数字舞台', caption: '01 / 朱帷初启 · 一眼入戏' },
  { name: '游园寻韵', en: 'THE GARDEN', image: garden, title: ['把江南的诗意，', '写进你的想象。'], desc: '循着水袖与园林的意境，让灵感成为画面，让每个人都能参与越剧创作。', href: '/image', action: '开启丹青创作', caption: '02 / 游园春晓 · 以画传情' },
  { name: '幕后拾光', en: 'THE STORY', image: backstage, title: ['每一身行头，', '都有未完的故事。'], desc: '从人物、流派到经典剧目，与 AI 一起寻访戏曲背后的知识与故事。', href: '/agent', action: '向 AI 问一折戏', caption: '03 / 幕后拾光 · 以知续韵' },
];
const tools = [
  { title: '云上戏台', en: 'VIRTUAL STAGE', type: '沉浸体验', icon: '台', desc: '走进三维场景，调度角色与动作，成为这折戏的主角。', href: '/stage', image: stage },
  { title: '丹青生图', en: 'AI CREATION', type: '数字创作', icon: '绘', desc: '用一句描述，展开属于你的越剧视觉想象。', href: '/image', image: garden },
  { title: '开卷问戏', en: 'KNOWLEDGE EXPLORER', type: '文化探索', icon: '问', desc: '与 AI 对话，沿着有出处的回答，发现戏里的故事。', href: '/agent', image: backstage },
  { title: '越剧图谱', en: 'CONNECTED STORIES', type: '文化探索', icon: '谱', desc: '让人物、剧目与流派连成一张可探索的文化地图。', href: '/kg', image: landscape },
  { title: '听腔评唱', en: 'VOICE LAB', type: '沉浸体验', icon: '唱', desc: '唱一段经典，在音准与节奏的反馈里慢慢走近越韵。', href: '/singing-eval', image: stage },
  { title: '水墨画板', en: 'INK ATELIER', type: '数字创作', icon: '墨', desc: '在屏幕上落笔，把此刻的感受留作一幅水墨。', href: '/draw', image: landscape },
];
const chapters = [
  { name: '听见', title: '从一声越韵，听见江南。', text: '一段唱腔，是故事的开场。辨识音韵、试唱经典，在旋律与节奏之间感受越剧的表达。', href: '/audio', action: '探索音韵识腔', image: stage, word: '声' },
  { name: '看见', title: '从一方戏台，看见万象。', text: '园林、服饰、身段，都是戏里的语言。进入数字舞台，从观看者变成故事的参与者。', href: '/stage', action: '进入三维舞台', image: garden, word: '境' },
  { name: '共创', title: '从一次落笔，续写新章。', text: '让文化记忆成为创作的起点。通过文字生图与水墨绘画，把你理解的越剧，化为新的表达。', href: '/image', action: '创作你的越剧意境', image: backstage, word: '创' },
];

export function ExperiencePage() {
  const [scene, setScene] = useState(0);
  const [chapter, setChapter] = useState(0);
  const [filter, setFilter] = useState('全部体验');
  const hero = useRef<HTMLElement>(null);
  const current = scenes[scene];
  const story = chapters[chapter];

  useEffect(() => {
    document.title = '越韵智传 · 越剧数字文化体验';
    const media = window.matchMedia('(prefers-reduced-motion: reduce)');
    if (media.matches) return;
    let frame = 0;
    const update = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => hero.current?.style.setProperty('--hero-shift', `${Math.min(window.scrollY * 0.18, 110)}px`));
    };
    window.addEventListener('scroll', update, { passive: true });
    return () => { window.removeEventListener('scroll', update); cancelAnimationFrame(frame); };
  }, []);

  return (
    <main className="experience-page">
      <section className="ex-hero" ref={hero} aria-label="越剧数字文化体验">
        <div className="ex-scenes" aria-hidden="true">
          {scenes.map((item, i) => <img key={item.name} src={item.image} alt="" className={scene === i ? 'is-active' : ''} fetchPriority={i === 0 ? 'high' : 'auto'} />)}
        </div>
        <div className="ex-hero-shade" aria-hidden="true" />
        <div className="ex-hero-grain" aria-hidden="true" />
        <div className="ex-hero-top"><span><i /> 越剧 · 数字文化体验</span><span>HERITAGE MEETS POSSIBILITY</span></div>
        <div className="ex-hero-copy" key={scene}>
          <p className="ex-eyebrow">YUE OPERA / A LIVING HERITAGE</p>
          <h1>{current.title[0]}<br /><em>{current.title[1]}</em></h1>
          <p className="ex-hero-desc">{current.desc}</p>
          <div className="ex-actions">
            <Link to={current.href} className="ex-button ex-button-light">{current.action}<span>↗</span></Link>
            <a href="#experiences" className="ex-text-button">发现更多体验 <span>↓</span></a>
          </div>
        </div>
        <div className="ex-vertical" aria-hidden="true">一 袖 江 南 · 百 年 越 韵</div>
        <div className="ex-hero-bottom">
          <a href="#prologue" className="ex-scroll"><span className="ex-scroll-line" />向下，展开这折戏</a>
          <div className="ex-scene-tabs" role="group" aria-label="切换首页场景">
            {scenes.map((item, i) => <button key={item.name} type="button" aria-pressed={scene === i} onClick={() => setScene(i)} className={scene === i ? 'is-active' : ''}><small>0{i + 1}</small>{item.name}<span /></button>)}
          </div>
          <span className="ex-scene-caption">{current.caption}</span>
        </div>
      </section>

      <section className="ex-prologue ex-wrap" id="prologue">
        <div className="ex-section-label"><span>序 / PROLOGUE</span><span>文化有根，表达无界</span></div>
        <div className="ex-prologue-body ex-reveal">
          <div><span className="ex-seal">越</span><h2>越剧的下一幕，<br />有你<span>在场。</span></h2></div>
          <div className="ex-prologue-text"><p>曾经，我们在台下听戏。<br />现在，你可以走进戏里。</p><p>越韵智传将越剧文化、人工智能与数字交互相连，<br className="ex-desktop" />让欣赏、探索与创作，在同一方舞台发生。</p><a href="#chapters" className="ex-inline-link">寻找你的入戏方式 <span>↘</span></a></div>
        </div>
        <div className="ex-index-strip"><span>01 <b>沉浸观演</b></span><i /><span>02 <b>文化探索</b></span><i /><span>03 <b>数字共创</b></span><span className="ex-strip-note">传统的回响，当代的表达 ↗</span></div>
      </section>

      <section className="ex-chapters ex-wrap" id="chapters">
        <div className="ex-section-label"><span>一 / WAYS TO CONNECT</span><span>不止于观看</span></div>
        <div className="ex-chapter-tabs" role="tablist" aria-label="体验篇章">
          {chapters.map((item, i) => <button key={item.name} role="tab" id={`chapter-tab-${i}`} aria-controls="chapter-panel" aria-selected={chapter === i} tabIndex={chapter === i ? 0 : -1} className={chapter === i ? 'is-active' : ''} onClick={() => setChapter(i)} onKeyDown={(e) => { if (['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(e.key)) { e.preventDefault(); const next = e.key === 'Home' ? 0 : e.key === 'End' ? 2 : (chapter + (e.key === 'ArrowRight' ? 1 : 2)) % 3; setChapter(next); document.getElementById(`chapter-tab-${next}`)?.focus(); } }}><small>0{i + 1}</small>{item.name}<span>↗</span></button>)}
        </div>
        <div className="ex-chapter-panel ex-reveal" id="chapter-panel" role="tabpanel" aria-labelledby={`chapter-tab-${chapter}`}>
          <div className="ex-chapter-image"><img key={story.image} src={story.image} alt={`${story.name}篇章的越剧意境图`} loading="lazy" /><span aria-hidden="true">{story.word}</span><small>YUE OPERA · {String(chapter + 1).padStart(2, '0')}</small></div>
          <div className="ex-chapter-copy" key={chapter}><p className="ex-eyebrow">EXPLORE / EXPERIENCE / CREATE</p><h2>{story.title}</h2><p>{story.text}</p><Link className="ex-button ex-button-dark" to={story.href}>{story.action}<span>↗</span></Link></div>
        </div>
      </section>

      <section className="ex-experiences ex-wrap" id="experiences">
        <div className="ex-section-label"><span>二 / THE EXPERIENCE COLLECTION</span><span>选择一扇门，走进越剧</span></div>
        <div className="ex-collection-head"><div><p className="ex-eyebrow">YOUR NEXT DISCOVERY</p><h2>好戏，<em>由你开启。</em></h2></div><div className="ex-filters" role="group" aria-label="体验分类">{['全部体验', '沉浸体验', '文化探索', '数字创作'].map(item => <button key={item} type="button" aria-pressed={filter === item} onClick={() => setFilter(item)} className={filter === item ? 'is-active' : ''}>{item}</button>)}</div></div>
        <div className="ex-tool-grid" key={filter}>
          {tools.filter(item => filter === '全部体验' || item.type === filter).map((item, i) => <Link to={item.href} className="ex-tool-card ex-reveal" key={item.title} style={{ '--card-order': i } as React.CSSProperties}><div className="ex-tool-image"><img src={item.image} alt={`${item.title}越剧意境图`} loading="lazy" /><span className="ex-tool-type">{item.type}</span><span className="ex-tool-enter" aria-hidden="true">↗</span><b aria-hidden="true">{item.icon}</b></div><div className="ex-tool-copy"><small>{item.en}</small><h3>{item.title}</h3><p>{item.desc}</p></div></Link>)}
        </div>
      </section>

      <section className="ex-finale">
        <img src={landscape} alt="" loading="lazy" aria-hidden="true" />
        <div className="ex-finale-copy ex-reveal"><p className="ex-eyebrow">THE STORY CONTINUES WITH YOU</p><h2>戏有落幕，<br /><em>传承不散场。</em></h2><p>从今日的一次相遇，走向更长久的热爱。</p><Link className="ex-button ex-button-dark" to="/courses">走进越韵课堂<span>↗</span></Link><Link className="ex-inline-link" to="/dashboard">前往我的学习工作台 →</Link></div>
      </section>
    </main>
  );
}
