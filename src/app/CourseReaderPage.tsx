/* ============================================================
   课程精读（在线阅读 + 教案 + PPT课件 + 知识卡片 + 随堂测验 + 知识图谱）
   /course-reader?courseId=xx
   由课程详情页「精读学习」入口进入
   ============================================================ */
import { useEffect, useMemo, useRef, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { request } from '../shared/api';
import { getToken, getUser } from '../shared/auth';
import { toast } from '../shared/toast';
import { KG_TYPE_LABELS, KG_TYPE_COLORS } from '../shared/kgMeta';
import { AiNotice } from '../shared/AiLabel';

const style = `
.reader-shell{display:grid;grid-template-columns:300px 1fr;gap:22px;min-height:70vh}
.reader-side{background:linear-gradient(180deg,#faf6ee,#f2ebdc);border:1px solid rgba(26,26,26,.11);border-radius:16px;padding:18px 14px;max-height:78vh;overflow:auto}
.reader-side h3{font-family:"STKaiti","KaiTi",serif;font-size:18px;letter-spacing:.12em;color:#a12022;margin-bottom:6px}
.reader-side .sub{font-size:11px;color:#8a857b;letter-spacing:.06em;margin-bottom:12px}
.reader-lesson{display:block;width:100%;text-align:left;padding:9px 12px;border-radius:8px;color:#3c3a34;font-size:13.5px;line-height:1.5;cursor:pointer;transition:.15s;margin-bottom:2px}
.reader-lesson:hover{background:rgba(193,39,45,.07);color:#a12022}
.reader-lesson.on{background:#a12022;color:#fff}
.reader-lesson .no{display:inline-block;min-width:28px;color:#c4a061;font-size:12px;margin-right:6px}
.reader-lesson.on .no{color:#f0d9a8}
.reader-main{min-width:0}
.reader-tabs{display:flex;gap:8px;margin-bottom:14px;flex-wrap:wrap}
.reader-tab{padding:8px 18px;border:1px solid rgba(26,26,26,.16);border-radius:999px;font-size:13px;color:#555;cursor:pointer;transition:.15s}
.reader-tab.on{background:#a12022;border-color:#a12022;color:#fff}
.reader-panel{background:#fffdf8;border:1px solid rgba(26,26,26,.1);border-radius:16px;padding:30px 36px;box-shadow:0 18px 48px -40px rgba(26,26,26,.7)}
.reader-panel.lit{max-width:860px;margin:0 auto}
.reader-panel h2{font-family:"STKaiti","KaiTi",serif;font-size:28px;letter-spacing:.06em;margin-bottom:4px}
.reader-panel .src{font-size:11px;color:#9a9386;letter-spacing:.08em;margin-bottom:18px}
.reader-p{font-size:15px;line-height:2.0;color:#33302a;text-align:justify;margin:0 0 12px;text-indent:2em}
.reader-empty{color:#8a857b;font-size:13px;text-align:center;padding:40px 0}
.reader-prevnext{display:flex;justify-content:space-between;margin-top:26px;gap:12px}
.reader-pn{padding:9px 16px;border:1px solid rgba(26,26,26,.18);border-radius:8px;font-size:13px;cursor:pointer;color:#a12022;transition:.15s;background:#fff}
.reader-pn:hover{background:rgba(193,39,45,.06)}
.reader-pn:disabled{opacity:.35;cursor:not-allowed}
.card-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(240px,1fr));gap:14px}
.card{background:#f7f1e4;border:1px solid rgba(196,160,97,.35);border-radius:12px;padding:16px 18px}
.card h4{font-family:"STKaiti","KaiTi",serif;font-size:16px;color:#a12022;margin-bottom:8px}
.card p{font-size:13px;line-height:1.8;color:#4a453d}
.q{background:#fbf7ee;border:1px solid rgba(26,26,26,.1);border-radius:12px;padding:18px 20px;margin-bottom:14px}
.q .prompt{font-size:14px;font-weight:600;margin-bottom:12px;line-height:1.7}
.q .opt{display:block;width:100%;text-align:left;padding:9px 14px;border:1px solid rgba(26,26,26,.13);border-radius:8px;font-size:13.5px;margin-bottom:7px;cursor:pointer;transition:.15s;color:#33302a;background:#fff}
.q .opt:hover{background:rgba(193,39,45,.06)}
.q .opt.right{border-color:#2e9e5b;background:rgba(46,158,91,.1);color:#1e6e40}
.q .opt.wrong{border-color:#c0392b;background:rgba(192,57,43,.08);color:#a93226}
.q .resp{font-size:12.5px;margin-top:6px;color:#666}
.q .resp.ok{color:#2e9e5b}.q .resp.bad{color:#c0392b}
.q .types{font-size:11px;color:#9a9386;letter-spacing:.06em;margin-left:8px;font-weight:400}
.reader-textlink{margin-left:auto;font-size:12px;color:#9a9386;text-decoration:underline dotted;cursor:pointer;padding:6px 8px}
.reader-textlink:hover{color:#a12022}
.reader-textlink.back{color:#a12022;text-decoration:none}

/* ---------- 教案 ---------- */
.plan-wrap{max-width:860px;margin:0 auto}
.plan-sec{margin-bottom:24px}
.plan-sec h3{font-family:"STKaiti","KaiTi",serif;font-size:19px;color:#a12022;letter-spacing:.1em;margin-bottom:12px;display:flex;align-items:center;gap:10px}
.plan-sec h3::after{content:'';flex:1;height:1px;background:linear-gradient(90deg,rgba(196,160,97,.6),transparent)}
.plan-li{position:relative;padding:5px 0 5px 18px;font-size:14px;line-height:1.9;color:#33302a}
.plan-li::before{content:'';position:absolute;left:2px;top:15px;width:6px;height:6px;border-radius:50%;background:#c4a061}
.plan-cols{display:grid;grid-template-columns:1fr 1fr;gap:14px}
.plan-box{background:#f7f1e4;border:1px solid rgba(196,160,97,.35);border-radius:12px;padding:14px 18px}
.plan-box h5{font-size:13px;color:#a12022;margin:0 0 10px;letter-spacing:.08em}
.plan-tbl{width:100%;border-collapse:collapse;font-size:13px}
.plan-tbl th,.plan-tbl td{border:1px solid rgba(26,26,26,.1);padding:8px 12px;text-align:left;line-height:1.6}
.plan-tbl th{background:#f7f1e4;color:#a12022;font-weight:600;white-space:nowrap}
.plan-step{display:flex;gap:14px;margin-bottom:12px;align-items:flex-start}
.plan-step .badge{flex-shrink:0;height:26px;display:inline-flex;align-items:center;justify-content:center;border-radius:999px;background:#a12022;color:#fff;font-size:12px;letter-spacing:.06em;padding:0 12px;margin-top:2px}
.plan-step .badge small{color:#f0d9a8;margin-left:5px;font-size:11px}
.plan-step .body{flex:1;background:#fbf7ee;border:1px solid rgba(26,26,26,.08);border-radius:10px;padding:10px 14px}
.plan-step .act{font-size:13.5px;line-height:1.8;color:#33302a}
.plan-step .intent{font-size:12px;color:#8a857b;margin-top:6px;line-height:1.6}
.res-empty{text-align:center;padding:40px 0;color:#8a857b;font-size:13.5px;line-height:2}
.res-btn{margin-top:14px;padding:10px 28px;border:0;border-radius:8px;background:#a12022;color:#fff;font-size:13.5px;letter-spacing:.08em;cursor:pointer;transition:.15s}
.res-btn:hover{background:#8e1d22}
.res-btn[disabled]{opacity:.5;cursor:not-allowed}
.res-err{margin-top:12px;padding:10px 14px;border-radius:8px;background:rgba(192,57,43,.08);border:1px solid rgba(192,57,43,.25);color:#a93226;font-size:12.5px;line-height:1.7;text-align:left}
.res-spin{display:inline-block;width:14px;height:14px;border:2px solid rgba(193,39,45,.25);border-top-color:#a12022;border-radius:50%;animation:spin 1s linear infinite;vertical-align:-2px;margin-right:6px}
@keyframes spin{to{transform:rotate(360deg)}}

/* ---------- 课件 PPT ---------- */
.slide-stage{position:relative;width:100%;max-width:1200px;margin:0 auto;aspect-ratio:16/9;border-radius:14px;overflow:hidden;box-shadow:0 24px 60px -36px rgba(26,26,26,.8);border:1px solid rgba(196,160,97,.5);background:#fffdf8}
.slide-stage:fullscreen{max-width:none;height:100vh;border-radius:0}
@media(max-width:640px){.slide-stage{aspect-ratio:auto;min-height:340px}.slide-page{position:relative!important;padding:28px 44px!important;min-height:340px}.slide-page h2{font-size:24px!important;overflow-wrap:anywhere}.slide-points li{font-size:14px!important;padding:6px 0 6px 20px}.slide-page.cover .sub,.slide-page.end .sub{letter-spacing:.06em}.slide-nav{width:30px!important;height:30px!important}.slide-nav.prev{left:4px!important}.slide-nav.next{right:4px!important}}
.slide-page{position:absolute;inset:0;padding:56px 64px;display:flex;flex-direction:column;justify-content:center;overflow:hidden}
.slide-page.cover,.slide-page.end{background:radial-gradient(120% 100% at 50% 0%,#a12022 0%,#8e1d22 55%,#6d1418 100%);align-items:center;text-align:center;justify-content:center}
.slide-page.cover h2,.slide-page.end h2{font-family:"STKaiti","KaiTi",serif;font-size:42px;color:#f7f1e4;letter-spacing:.14em;margin:0 0 20px;font-weight:400}
.slide-page.cover .sub,.slide-page.end .sub{color:#c4a061;font-size:15px;letter-spacing:.3em}
.slide-goldline{width:220px;height:2px;background:linear-gradient(90deg,transparent,#c4a061,transparent);margin:0 auto}
.slide-page.toc,.slide-page.content{background:linear-gradient(160deg,#fffdf8,#faf5e9)}
.slide-page.toc h2,.slide-page.content h2{font-family:"STKaiti","KaiTi",serif;font-size:30px;color:#a12022;letter-spacing:.08em;margin:0 0 6px;font-weight:400}
.slide-underline{width:88px;height:3px;background:#c4a061;border-radius:2px;margin-bottom:28px}
.slide-points{list-style:none;margin:0;padding:0;max-width:100%}
.slide-points li{position:relative;padding:9px 0 9px 26px;font-size:16.5px;line-height:1.7;color:#33302a}
.slide-points li::before{content:'';position:absolute;left:2px;top:19px;width:9px;height:9px;border:2px solid #c4a061;border-radius:50%}
.slide-nav{position:absolute;top:50%;transform:translateY(-50%);width:40px;height:40px;border-radius:50%;border:1px solid rgba(196,160,97,.6);background:rgba(255,253,248,.9);color:#a12022;font-size:17px;cursor:pointer;z-index:3;transition:.15s;display:flex;align-items:center;justify-content:center}
.slide-nav:hover{background:#a12022;color:#fff;border-color:#a12022}
.slide-nav.prev{left:12px}.slide-nav.next{right:12px}
.slide-nav[disabled]{opacity:.2;cursor:not-allowed}
.slide-foot{display:flex;align-items:center;justify-content:space-between;max-width:920px;margin:12px auto 0;gap:12px;flex-wrap:wrap}
.slide-counter{font-size:13px;color:#8a857b;letter-spacing:.14em}
.slide-dl{padding:8px 18px;border:1px solid rgba(193,39,45,.35);border-radius:8px;background:#fff;color:#a12022;font-size:12.5px;letter-spacing:.06em;cursor:pointer;transition:.15s}
.slide-dl:hover{background:#a12022;color:#fff}
.slide-note{max-width:920px;margin:10px auto 0;font-size:12px;color:#9a9386;background:#f7f1e4;border-radius:8px;padding:8px 14px;line-height:1.7}
.slide-custom-image{position:absolute;z-index:2;object-fit:contain;filter:drop-shadow(0 8px 14px rgba(42,30,18,.18));pointer-events:none}
.slide-editor{max-width:920px;margin:12px auto 0;padding:12px 14px;border:1px dashed rgba(196,160,97,.6);border-radius:10px;background:#fcf8ef;color:#625d55;font-size:12.5px}
.slide-editor-head{display:flex;align-items:center;justify-content:space-between;gap:10px;flex-wrap:wrap}.slide-editor-head b{color:#7d2628}.slide-editor-actions{display:flex;gap:6px;flex-wrap:wrap;margin-top:9px;align-items:center}.slide-editor button{padding:5px 9px;border:1px solid rgba(161,32,34,.35);border-radius:6px;background:#fffdf8;color:#8e1d22;cursor:pointer;font-size:12px}.slide-editor button:hover{background:#a12022;color:#fff}.slide-editor button:disabled{opacity:.55;cursor:not-allowed}.slide-image-row{display:flex;align-items:center;gap:7px;flex-wrap:wrap;padding-top:9px;border-top:1px solid rgba(196,160,97,.25);margin-top:9px}.slide-image-name{max-width:190px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;color:#4f493f}

/* ---------- 知识图谱 ---------- */
.kg-wrap{display:grid;grid-template-columns:1fr 290px;gap:16px}
.kg-stage{background:linear-gradient(165deg,#fffdf8,#f5eede);border:1px solid rgba(196,160,97,.3);border-radius:14px;position:relative;overflow:hidden}
.kg-svg{display:block;width:100%;height:auto}
.kg-legend{position:absolute;top:10px;left:12px;display:flex;flex-wrap:wrap;gap:6px;max-width:calc(100% - 24px);z-index:2}
.kg-leg{display:inline-flex;align-items:center;gap:5px;padding:3px 10px;border-radius:999px;background:rgba(255,253,248,.92);border:1px solid rgba(26,26,26,.1);font-size:11px;color:#555;cursor:pointer;user-select:none}
.kg-leg.off{opacity:.35}
.kg-leg i{width:8px;height:8px;border-radius:50%;display:inline-block}
.kg-node{cursor:pointer}
.kg-node circle{stroke:#fffdf8;stroke-width:2;transition:.15s}
.kg-node:hover circle{stroke-width:3.5}
.kg-node text{font-size:11px;fill:#4a453d}
.kg-node.sel circle{stroke:#a12022;stroke-width:3.5}
.kg-edge{stroke:rgba(26,26,26,.2);stroke-width:1.2}
.kg-edge.hi{stroke:#a12022;stroke-width:2.2}
.kg-side{background:#fbf7ee;border:1px solid rgba(26,26,26,.1);border-radius:14px;padding:18px;max-height:70vh;overflow:auto}
.kg-side h4{font-family:"STKaiti","KaiTi",serif;font-size:19px;color:#a12022;margin:0 0 8px}
.kg-side .tp{display:inline-block;padding:2px 10px;border-radius:999px;color:#fff;font-size:11px;margin-bottom:10px}
.kg-side .desc{font-size:13px;line-height:1.9;color:#4a453d;margin-bottom:12px}
.kg-rel{font-size:12.5px;color:#555;padding:6px 10px;background:#fff;border:1px solid rgba(26,26,26,.08);border-radius:8px;margin-bottom:6px;line-height:1.6}
.kg-rel b{color:#a12022}
@media(max-width:960px){.kg-wrap{grid-template-columns:1fr}}
`;

type TabKey = 'pdf' | 'read' | 'plan' | 'slides' | 'cards' | 'quiz' | 'graph';

export function CourseReaderPage() {
  const [params] = useSearchParams();
  const courseId = Number(params.get('courseId'));
  const isTeacher = getUser()?.role === 'teacher';
  const [course, setCourse] = useState<any>(null);
  const [lessons, setLessons] = useState<any[]>([]);
  const [active, setActive] = useState<any>(null);
  const lessonVersion = useRef(0);
  const [body, setBody] = useState<string>('');
  const [cards, setCards] = useState<any[]>([]);
  const [quiz, setQuiz] = useState<any[]>([]);
  const [tab, setTab] = useState<TabKey>('read');
  const chosenRef = useRef(false);
  const [picked, setPicked] = useState<Record<number, number[]>>({});

  // 教案 / 课件 / 图谱
  const [planData, setPlanData] = useState<any>(null);
  const [slidesData, setSlidesData] = useState<any>(null);
  const [graphData, setGraphData] = useState<any>(null);
  const [slideIdx, setSlideIdx] = useState(0);
  const slideStageRef = useRef<HTMLDivElement>(null);
  const slideImageInputRef = useRef<HTMLInputElement>(null);
  const [slideImageUrls, setSlideImageUrls] = useState<Record<string, string>>({});
  const [slideImageBusy, setSlideImageBusy] = useState(false);
  const [downloading, setDownloading] = useState(false);
  const [selNode, setSelNode] = useState<any>(null);
  const [typeOff, setTypeOff] = useState<Record<string, boolean>>({});
  const [regen, setRegen] = useState<string | null>(null);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const chooseTab = (t: TabKey) => {
    chosenRef.current = true;
    setTab(t);
  };

  const openLesson = async (id: number) => {
    const version = ++lessonVersion.current;
    const r = await request<any>(`/course/${courseId}/lessons/${id}`);
    if (version !== lessonVersion.current) return;
    if (r.code === 0 && r.data) {
      setActive(r.data);
      setBody(r.data.body || '');
    } else {
      toast('章节加载失败', 'err');
    }
  };

  const loadPlan = async () => {
    const r = await request<any>(`/course/${courseId}/plan`);
    if (r.code === 0) setPlanData(r.data);
  };
  const loadSlides = async () => {
    const r = await request<any>(`/course/${courseId}/slides`);
    if (r.code === 0) setSlidesData(r.data);
  };
  const loadGraph = async () => {
    const r = await request<any>(`/course/${courseId}/graph`);
    if (r.code === 0) setGraphData(r.data);
  };

  useEffect(() => {
    if (!courseId) return;
    (async () => {
      const [c, l, cd, q] = await Promise.all([
        request<any>(`/course/${courseId}`),
        request<any>(`/course/${courseId}/lessons`),
        request<any>(`/course/${courseId}/cards`),
        request<any>(`/course/${courseId}/quiz`),
      ]);
      if (c.code === 0) {
        setCourse(c.data);
        // 有原版 PDF 时默认进入 PDF 阅读；用户手动切过标签则尊重其选择
        if (c.data?.pdf_path && !chosenRef.current) setTab('pdf');
      }
      if (l.code === 0 && l.data) {
        setLessons(l.data);
        if (l.data.length) await openLesson(l.data[0].id);
      }
      if (cd.code === 0) setCards(cd.data || []);
      if (q.code === 0) setQuiz(q.data?.questions || []);
    })();
    return () => {
      if (pollRef.current) clearInterval(pollRef.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [courseId]);

  // 新 tab 懒加载
  useEffect(() => {
    if (!courseId) return;
    if (tab === 'plan' && isTeacher && planData === null) loadPlan();
    if (tab === 'slides' && slidesData === null) loadSlides();
    if (tab === 'graph' && graphData === null) loadGraph();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tab, courseId]);

  // 课件键盘翻页
  const pages: any[] = slidesData?.slides?.pages || [];
  const curPage = pages[Math.min(slideIdx, Math.max(0, pages.length - 1))];
  const currentSlideImages: any[] = slidesData?.slides?.images?.[String(slideIdx)] || [];
  useEffect(() => {
    const images = Object.values(slidesData?.slides?.images || {}).flat() as any[];
    if (!images.length) { setSlideImageUrls({}); return; }
    let disposed = false;
    const urls: string[] = [];
    (async () => {
      const pairs = await Promise.all(images.map(async (image) => {
        try {
          const resp = await fetch(`/api/course/${courseId}/slides/images/${image.id}`, {
            headers: { Authorization: `Bearer ${getToken()}` },
          });
          if (!resp.ok) return null;
          const url = URL.createObjectURL(await resp.blob());
          urls.push(url);
          return [image.id, url] as const;
        } catch { return null; }
      }));
      if (disposed) return;
      setSlideImageUrls(Object.fromEntries(pairs.filter(Boolean) as Array<readonly [string, string]>));
    })();
    return () => {
      disposed = true;
      urls.forEach((url) => URL.revokeObjectURL(url));
    };
  }, [courseId, slidesData?.updatedAt, JSON.stringify(slidesData?.slides?.images || {})]);
  useEffect(() => {
    if (tab !== 'slides') return;
    const onKey = (e: KeyboardEvent) => {
      if ((e.target as HTMLElement)?.closest('input, textarea, select, [contenteditable="true"]')) return;
      if (pages.length === 0 || e.altKey || e.ctrlKey || e.metaKey) return;
      if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') e.preventDefault();
      if (e.key === 'ArrowLeft') setSlideIdx((i) => Math.max(0, i - 1));
      if (e.key === 'ArrowRight') setSlideIdx((i) => Math.min(pages.length - 1, i + 1));
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [tab, pages.length]);

  // 单项重新生成：POST 启动 + 轮询至完成
  const doRegen = async (type: string) => {
    if (regen) return;
    setRegen(type);
    try {
      const r = await request<any>(`/course/${courseId}/regenerate/${type}`, { method: 'POST' });
      if (r.code !== 0) {
        setRegen(null);
        toast(r.message || '启动生成失败', 'err');
        return;
      }
      toast('已开始生成，请稍候…', 'ok');
      if (pollRef.current) clearInterval(pollRef.current);
      const started = Date.now();
      const poll = async () => {
        try {
          if (type === 'plan') {
            const r2 = await request<any>(`/course/${courseId}/plan`);
            if (r2.code === 0) {
              setPlanData(r2.data);
              if (r2.data.status !== 'generating') { stopPoll(r2.data.status === 'ready' ? undefined : r2.data.error || '生成失败，请重试'); return; }
            }
          } else if (type === 'slides') {
            const r2 = await request<any>(`/course/${courseId}/slides`);
            if (r2.code === 0) {
              setSlidesData(r2.data);
              setSlideIdx(0);
              if (r2.data.status !== 'generating') { stopPoll(r2.data.status === 'ready' ? undefined : r2.data.error || '生成失败，请重试'); return; }
            }
          } else if (type === 'graph') {
            const r2 = await request<any>(`/course/${courseId}/graph`);
            if (r2.code === 0) {
              setGraphData(r2.data);
              setSelNode(null);
              if (!r2.data.regenerating) { stopPoll(r2.data.error); return; }
            }
          } else if (type === 'quizai') {
            const r2 = await request<any>(`/course/${courseId}/quiz`);
            if (r2.code === 0) {
              setQuiz(r2.data?.questions || []);
              if (!r2.data?.regenerating) { stopPoll(r2.data?.error); return; }
            }
          }
        } catch { /* 单次轮询失败忽略 */ }
        if (Date.now() - started > 300000) stopPoll('等待时间较长，后台可能仍在生成，请稍后重新查看');
      };
      const stopPoll = (error?: string) => {
        if (pollRef.current) { clearInterval(pollRef.current); pollRef.current = null; }
        setRegen(null);
        toast(error || '生成完成', error ? 'err' : 'ok');
      };
      pollRef.current = setInterval(poll, 3000);
    } catch {
      setRegen(null);
    }
  };

  // 下载 .pptx（原生 fetch + blob，绕开 request() 的 JSON 解析）
  const downloadPptx = async () => {
    if (downloading) return;
    setDownloading(true);
    try {
      const resp = await fetch(`/api/course/${courseId}/slides/pptx`, {
        headers: { Authorization: `Bearer ${getToken()}` },
      });
      if (!resp.ok) {
        toast('课件下载失败', 'err');
        return;
      }
      const blob = await resp.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `${course?.title || '课程'}-课件.pptx`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      window.setTimeout(() => URL.revokeObjectURL(url), 30000);
    } catch {
      toast('课件下载失败', 'err');
    } finally {
      setDownloading(false);
    }
  };

  const uploadSlideImage = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const image = event.target.files?.[0];
    event.target.value = '';
    if (!image || slideImageBusy) return;
    if (!['image/png', 'image/jpeg', 'image/webp'].includes(image.type) || image.size > 5 * 1024 * 1024) {
      toast('请选择不超过 5MB 的 PNG、JPEG 或 WebP 图片', 'err');
      return;
    }
    setSlideImageBusy(true);
    try {
      const form = new FormData();
      form.append('image', image);
      form.append('pageIndex', String(slideIdx));
      const resp = await fetch(`/api/course/${courseId}/slides/images`, {
        method: 'POST', headers: { Authorization: `Bearer ${getToken()}` }, body: form,
      });
      const data = await resp.json();
      if (data.code !== 0) throw new Error(data.message || '插入图片失败');
      await loadSlides();
      toast('图片已插入当前页，下载 PPT 时会一并保留', 'ok');
    } catch (err: any) {
      toast(err?.message || '插入图片失败', 'err');
    } finally {
      setSlideImageBusy(false);
    }
  };

  const adjustSlideImage = async (image: any, patch: Record<string, number>) => {
    if (slideImageBusy) return;
    setSlideImageBusy(true);
    try {
      const resp = await fetch(`/api/course/${courseId}/slides/images/${image.id}`, {
        method: 'PATCH',
        headers: { Authorization: `Bearer ${getToken()}`, 'Content-Type': 'application/json' },
        body: JSON.stringify(patch),
      });
      const data = await resp.json();
      if (data.code !== 0) throw new Error(data.message || '调整图片失败');
      await loadSlides();
    } catch (err: any) {
      toast(err?.message || '调整图片失败', 'err');
    } finally { setSlideImageBusy(false); }
  };

  const removeSlideImage = async (image: any) => {
    if (slideImageBusy) return;
    setSlideImageBusy(true);
    try {
      const resp = await fetch(`/api/course/${courseId}/slides/images/${image.id}`, {
        method: 'DELETE', headers: { Authorization: `Bearer ${getToken()}` },
      });
      const data = await resp.json();
      if (data.code !== 0) throw new Error(data.message || '移除图片失败');
      await loadSlides();
      toast('图片已移除', 'ok');
    } catch (err: any) {
      toast(err?.message || '移除图片失败', 'err');
    } finally { setSlideImageBusy(false); }
  };

  const idx = lessons.findIndex((x) => x.id === active?.id);
  const goTo = (i: number) => lessons[i] && openLesson(lessons[i].id);

  const isRight = (q: any) => {
    const sel = picked[q.id] || [];
    const ans = q.answer;
    const arr = Array.isArray(ans) ? ans : [ans];
    return sel.length === arr.length && arr.every((a: number) => sel.includes(a));
  };

  const pick = (qid: number, oi: number) => {
    setPicked((prev) => {
      const q = quiz.find((x) => x.id === qid);
      const cur = prev[qid] || [];
      if (q?.type === 'multiple') {
        const next = cur.includes(oi) ? cur.filter((i) => i !== oi) : [...cur, oi];
        return { ...prev, [qid]: next };
      }
      return { ...prev, [qid]: [oi] };
    });
  };

  // 知识图谱布局：按类型分组的环形布局（确定性，纯 SVG）
  const KG_W = 900;
  const KG_H = 620;
  const graphLayout = useMemo(() => {
    const nodes: any[] = graphData?.nodes || [];
    const edges: any[] = graphData?.edges || [];
    const byId = new Map(nodes.map((n) => [n.id, n]));
    const degree: Record<number, number> = {};
    for (const e of edges) {
      degree[e.head_id] = (degree[e.head_id] || 0) + 1;
      degree[e.tail_id] = (degree[e.tail_id] || 0) + 1;
    }
    const groups: Record<string, any[]> = {};
    for (const n of nodes) (groups[n.type] = groups[n.type] || []).push(n);
    const types = Object.keys(groups).sort();
    const pos: Record<number, { x: number; y: number }> = {};
    const R = Math.min(KG_W, KG_H) * 0.36;
    types.forEach((t, gi) => {
      const list = groups[t];
      const ga = (gi / types.length) * Math.PI * 2 - Math.PI / 2;
      const gx = KG_W / 2 + R * Math.cos(ga);
      const gy = KG_H / 2 + R * Math.sin(ga) * 0.85;
      const r = Math.min(95, 20 + list.length * 8);
      list.forEach((n, i) => {
        const a = (i / list.length) * Math.PI * 2 + (ga / Math.PI);
        pos[n.id] = { x: gx + r * Math.cos(a), y: gy + r * Math.sin(a) };
      });
    });
    return { byId, degree, pos, types };
  }, [graphData]);

  const shownNodes = (graphData?.nodes || []).filter((n: any) => !typeOff[n.type]);
  const shownEdges = (graphData?.edges || []).filter(
    (e: any) => !typeOff[graphLayout.byId.get(e.head_id)?.type] && !typeOff[graphLayout.byId.get(e.tail_id)?.type]
  );

  const paras = body.split(/\n+/).filter((p) => p.trim());
  const hasPdf = Boolean((course as any)?.pdf_path);
  const TABS: Array<[TabKey, string]> = [
    ...(hasPdf ? [['pdf', '原版 PDF']] : [['read', '精读正文']]) as Array<[TabKey, string]>,
    ...(isTeacher ? ([['plan', '教案']] as Array<[TabKey, string]>) : []),
    ['slides', '课件 PPT'],
    ['cards', '知识卡片'],
    ['quiz', '随堂测验'],
    ['graph', '知识图谱'],
  ];

  // 原版 PDF：用带 Authorization 的请求取回后转成 blob URL 再展示。
  // 之前是 <iframe src="/api/course/xx/pdf?token=<JWT>">，JWT 会进入浏览器历史、
  // Referer 以及 Nginx/Cloudflare 访问日志，一旦泄露即可被复用登录他人账号。
  const [pdfBlobUrl, setPdfBlobUrl] = useState<string | null>(null);
  const [pdfError, setPdfError] = useState<string | null>(null);
  const pdfUrlRef = useRef<string | null>(null);

  useEffect(() => {
    // 组件卸载时释放最后一次创建的 blob URL
    return () => {
      if (pdfUrlRef.current) URL.revokeObjectURL(pdfUrlRef.current);
    };
  }, []);

  useEffect(() => {
    if (tab !== 'pdf' || !hasPdf || !courseId) return;
    let alive = true;
    (async () => {
      setPdfError(null);
      try {
        const token = getToken();
        const resp = await fetch(`/api/course/${courseId}/pdf`, {
          headers: token ? { Authorization: `Bearer ${token}` } : undefined,
        });
        if (!resp.ok) {
          throw new Error(
            resp.status === 403 || resp.status === 401 ? '无权查看该课程的原版 PDF' : '原版 PDF 加载失败',
          );
        }
        const objectUrl = URL.createObjectURL(await resp.blob());
        if (!alive) {
          URL.revokeObjectURL(objectUrl);
          return;
        }
        if (pdfUrlRef.current) URL.revokeObjectURL(pdfUrlRef.current);
        pdfUrlRef.current = objectUrl;
        setPdfBlobUrl(objectUrl);
      } catch (err) {
        if (alive) setPdfError(err instanceof Error ? err.message : '原版 PDF 加载失败');
      }
    })();
    return () => { alive = false; };
  }, [tab, hasPdf, courseId]);

  // 教案渲染
  const plan = planData?.plan;
  const planSection = (
    <section className="reader-panel">
      <AiNotice text="本教案由人工智能依据课程讲义与越剧学科知识库生成，属教学辅助参考材料，教师使用前请结合学情审核调整。" />
      {planData?.status === 'ready' && plan ? (
        <div className="plan-wrap">
          {!!plan.objectives?.length && (
            <div className="plan-sec">
              <h3>教学目标</h3>
              {plan.objectives.map((o: string, i: number) => <div className="plan-li" key={i}>{o}</div>)}
            </div>
          )}
          {(!!plan.key_points?.length || !!plan.difficulties?.length) && (
            <div className="plan-sec">
              <h3>重点与难点</h3>
              <div className="plan-cols">
                {!!plan.key_points?.length && (
                  <div className="plan-box"><h5>教 学 重 点</h5>{plan.key_points.map((s: string, i: number) => <div className="plan-li" key={i}>{s}</div>)}</div>
                )}
                {!!plan.difficulties?.length && (
                  <div className="plan-box"><h5>教 学 难 点</h5>{plan.difficulties.map((s: string, i: number) => <div className="plan-li" key={i}>{s}</div>)}</div>
                )}
              </div>
            </div>
          )}
          {!!plan.sessions?.length && (
            <div className="plan-sec">
              <h3>课时安排</h3>
              <table className="plan-tbl">
                <thead><tr><th>课时</th><th>主题</th><th>对应章节</th><th>时长</th></tr></thead>
                <tbody>
                  {plan.sessions.map((s: any, i: number) => (
                    <tr key={i}><td>第 {s.no || i + 1} 课时</td><td>{s.title}</td><td>{s.chapter_refs || '—'}</td><td>{s.minutes || 45} 分钟</td></tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          {!!plan.process?.length && (
            <div className="plan-sec">
              <h3>教学过程</h3>
              {plan.process.map((p: any, i: number) => (
                <div className="plan-step" key={i}>
                  <span className="badge">{p.phase}<small>{p.minutes}′</small></span>
                  <div className="body">
                    <div className="act">{p.activity}</div>
                    {p.design_intent && <div className="intent">设计意图：{p.design_intent}</div>}
                  </div>
                </div>
              ))}
            </div>
          )}
          {!!plan.homework?.length && (
            <div className="plan-sec">
              <h3>作业布置</h3>
              {plan.homework.map((h: string, i: number) => <div className="plan-li" key={i}>{h}</div>)}
            </div>
          )}
        </div>
      ) : planData?.status === 'generating' || regen === 'plan' ? (
        <div className="res-empty"><span className="res-spin" />AI 正在撰写教案，请稍候…</div>
      ) : (
        <div className="res-empty">
          {planData?.status === 'failed' ? (
            <>
              教案生成失败{planData?.error ? `：${planData.error}` : ''}
              <div className="res-err">{planData?.error || '生成失败，可点击下方按钮重试'}</div>
            </>
          ) : '该课程尚未生成教案'}
          <div><button className="res-btn" disabled={!!regen} onClick={() => doRegen('plan')}>
            {regen === 'plan' ? '正在生成…' : planData?.status === 'failed' ? '重新生成教案' : 'AI 生成教案'}
          </button></div>
        </div>
      )}
    </section>
  );

  // 课件渲染
  const slidesSection = (
    <section className="reader-panel">
      <AiNotice text="本课件大纲由人工智能生成，页面配图与讲授内容须由教师审核确认后方可用于正式课堂。" />
      {slidesData?.status === 'ready' && pages.length ? (
        <>
          <div className="slide-stage" ref={slideStageRef}>
            {curPage && (
              <div className={`slide-page ${curPage.kind}`}>
                {(curPage.kind === 'cover' || curPage.kind === 'end') ? (
                  <>
                    <h2>{curPage.title}</h2>
                    <div className="slide-goldline" />
                    {curPage.subtitle && <div className="sub" style={{ marginTop: 16 }}>{curPage.subtitle}</div>}
                  </>
                ) : (
                  <>
                    <h2>{curPage.title}</h2>
                    <div className="slide-underline" />
                    <ul className="slide-points">
                      {(curPage.kind === 'toc' ? curPage.items || [] : curPage.points || []).map((t: string, i: number) => (
                        <li key={i}>{t}</li>
                      ))}
                    </ul>
                  </>
                )}
              </div>
            )}
            {currentSlideImages.map((image) => slideImageUrls[image.id] && (
              <img key={image.id} className="slide-custom-image" src={slideImageUrls[image.id]} alt="教师插入的课件图片"
                style={{ left: `${(Number(image.x) / 10) * 100}%`, top: `${(Number(image.y) / 5.625) * 100}%`, width: `${(Number(image.w) / 10) * 100}%`, height: `${(Number(image.h) / 5.625) * 100}%` }} />
            ))}
            <button className="slide-nav prev" disabled={slideIdx <= 0} onClick={() => setSlideIdx((i) => Math.max(0, i - 1))}>‹</button>
            <button className="slide-nav next" disabled={slideIdx >= pages.length - 1} onClick={() => setSlideIdx((i) => Math.min(pages.length - 1, i + 1))}>›</button>
          </div>
          <div className="slide-foot">
            <span className="slide-counter">{slideIdx + 1} / {pages.length} · 可用 ← → 键翻页</span>
            <button className="slide-dl" disabled={downloading} onClick={downloadPptx}>{downloading ? '正在准备下载…' : '下载 .pptx 课件'}</button>
            <button className="slide-dl" onClick={async () => {
              try { await slideStageRef.current?.requestFullscreen(); }
              catch { toast('当前浏览器不支持全屏，可使用浏览器缩放查看', 'err'); }
            }}>全屏查看</button>
            {isTeacher && <button className="slide-dl" disabled={!!regen} onClick={() => doRegen('slides')}>{regen === 'slides' ? '正在生成…' : '重新生成'}</button>}
          </div>
          {isTeacher && <div className="slide-editor">
            <div className="slide-editor-head">
              <b>本页图片</b>
              <span>图片会同步到预览和下载的 PPT</span>
            </div>
            <div className="slide-editor-actions">
              <input ref={slideImageInputRef} type="file" accept="image/png,image/jpeg,image/webp" hidden onChange={uploadSlideImage} />
              <button disabled={slideImageBusy} onClick={() => slideImageInputRef.current?.click()}>{slideImageBusy ? '处理中…' : '插入本地图片'}</button>
              <span>支持 PNG、JPEG、WebP，单张不超过 5MB</span>
            </div>
            {currentSlideImages.map((image) => (
              <div className="slide-image-row" key={image.id}>
                <span className="slide-image-name" title={image.name}>{image.name || '课件图片'}</span>
                <button disabled={slideImageBusy} onClick={() => adjustSlideImage(image, { x: Number(image.x) - .25 })}>← 左移</button>
                <button disabled={slideImageBusy} onClick={() => adjustSlideImage(image, { x: Number(image.x) + .25 })}>右移 →</button>
                <button disabled={slideImageBusy} onClick={() => adjustSlideImage(image, { y: Number(image.y) - .2 })}>上移</button>
                <button disabled={slideImageBusy} onClick={() => adjustSlideImage(image, { y: Number(image.y) + .2 })}>下移</button>
                <button disabled={slideImageBusy} onClick={() => adjustSlideImage(image, { w: Number(image.w) + .35, h: Number(image.h) + .25 })}>放大</button>
                <button disabled={slideImageBusy} onClick={() => adjustSlideImage(image, { w: Number(image.w) - .35, h: Number(image.h) - .25 })}>缩小</button>
                <button disabled={slideImageBusy} onClick={() => removeSlideImage(image)}>移除</button>
              </div>
            ))}
          </div>}
          {curPage?.note && <div className="slide-note">讲稿提示：{curPage.note}</div>}
        </>
      ) : slidesData?.status === 'generating' || regen === 'slides' ? (
        <div className="res-empty"><span className="res-spin" />AI 正在生成课件大纲，请稍候…</div>
      ) : (
        <div className="res-empty">
          {slidesData?.status === 'failed' ? (
            <>
              课件生成失败
              <div className="res-err">{slidesData?.error || '生成失败，可点击下方按钮重试'}</div>
            </>
          ) : '该课程尚未生成课件'}
          {isTeacher && (
            <div><button className="res-btn" disabled={!!regen} onClick={() => doRegen('slides')}>
              {regen === 'slides' ? '正在生成…' : slidesData?.status === 'failed' ? '重新生成课件' : 'AI 生成课件'}
            </button></div>
          )}
        </div>
      )}
    </section>
  );

  // 图谱渲染
  const graphSection = (
    <section className="reader-panel">
      <AiNotice text="本知识图谱由人工智能从课程文本中自动抽取实体与关系，抽取结果可能存在遗漏或误判，请以权威文献为准。" />
      {graphData?.nodes?.length ? (
        <>
          <div className="kg-wrap">
            <div className="kg-stage">
              <div className="kg-legend">
                {graphLayout.types.map((t) => (
                  <span key={t} className={`kg-leg${typeOff[t] ? ' off' : ''}`}
                    onClick={() => setTypeOff((prev) => ({ ...prev, [t]: !prev[t] }))}>
                    <i style={{ background: KG_TYPE_COLORS[t] || '#1a1a1a' }} />{KG_TYPE_LABELS[t] || t}
                  </span>
                ))}
              </div>
              <svg className="kg-svg" viewBox={`0 0 ${KG_W} ${KG_H}`}>
                {shownEdges.map((e: any, i: number) => {
                  const p1 = graphLayout.pos[e.head_id];
                  const p2 = graphLayout.pos[e.tail_id];
                  if (!p1 || !p2) return null;
                  const hi = selNode && (e.head_id === selNode.id || e.tail_id === selNode.id);
                  return (
                    <line key={i} className={`kg-edge${hi ? ' hi' : ''}`} x1={p1.x} y1={p1.y} x2={p2.x} y2={p2.y}>
                      <title>{`${graphLayout.byId.get(e.head_id)?.name} —${e.relation}→ ${graphLayout.byId.get(e.tail_id)?.name}`}</title>
                    </line>
                  );
                })}
                {shownNodes.map((n: any) => {
                  const p = graphLayout.pos[n.id];
                  if (!p) return null;
                  const r = 9 + Math.min(6, graphLayout.degree[n.id] || 0);
                  return (
                    <g key={n.id} className={`kg-node${selNode?.id === n.id ? ' sel' : ''}`}
                      onClick={() => setSelNode(selNode?.id === n.id ? null : n)}>
                      <circle cx={p.x} cy={p.y} r={r} fill={KG_TYPE_COLORS[n.type] || '#1a1a1a'} />
                      <text x={p.x} y={p.y + r + 13} textAnchor="middle">{n.name}</text>
                    </g>
                  );
                })}
              </svg>
            </div>
            <aside className="kg-side">
              {selNode ? (
                <>
                  <h4>{selNode.name}</h4>
                  <span className="tp" style={{ background: KG_TYPE_COLORS[selNode.type] || '#1a1a1a' }}>
                    {KG_TYPE_LABELS[selNode.type] || selNode.type}
                  </span>
                  {selNode.description && <div className="desc">{selNode.description}</div>}
                  {(graphData.edges || []).filter((e: any) => e.head_id === selNode.id || e.tail_id === selNode.id).slice(0, 12).map((e: any, i: number) => (
                    <div className="kg-rel" key={i}>
                      {e.head_id === selNode.id ? (
                        <><b>{selNode.name}</b> —{e.relation}→ {graphLayout.byId.get(e.tail_id)?.name}</>
                      ) : (
                        <>{graphLayout.byId.get(e.head_id)?.name} —{e.relation}→ <b>{selNode.name}</b></>
                      )}
                    </div>
                  ))}
                </>
              ) : (
                <div style={{ color: '#8a857b', fontSize: 12.5, lineHeight: 2, textAlign: 'center', paddingTop: 30 }}>
                  点击图中节点<br />查看实体详情与关联关系
                  <div style={{ marginTop: 18, fontSize: 11.5 }}>
                    共 {graphData.nodes.length} 个实体 · {(graphData.edges || []).length} 条关系
                  </div>
                </div>
              )}
            </aside>
          </div>
          {isTeacher && (
            <div style={{ textAlign: 'center', marginTop: 6 }}>
              <button className="res-btn" disabled={!!regen} onClick={() => doRegen('graph')}>
                {regen === 'graph' ? '正在生成…' : '重新生成知识图谱'}
              </button>
            </div>
          )}
        </>
      ) : regen === 'graph' || graphData?.regenerating ? (
        <div className="res-empty"><span className="res-spin" />AI 正在抽取知识图谱，请稍候…</div>
      ) : (
        <div className="res-empty">
          {graphData ? '该课程暂无知识图谱数据' : '知识图谱加载中…'}
          {isTeacher && (
            <div><button className="res-btn" disabled={!!regen} onClick={() => doRegen('graph')}>
              {regen === 'graph' ? '正在生成…' : 'AI 生成知识图谱'}
            </button></div>
          )}
        </div>
      )}
    </section>
  );

  return (
    <div className="container" style={{ padding: '30px 32px 60px' }}>
      <style>{style}</style>
      <nav style={{ fontSize: 12.5, color: '#8a857b', marginBottom: 10 }}>
        <Link to="/courses" style={{ color: '#a12022' }}>课程中心</Link>
        {' / 精读 '}{course?.title || ''}
      </nav>
      <header style={{ display: 'flex', alignItems: 'baseline', gap: 14, marginBottom: 20, flexWrap: 'wrap' }}>
        <h1 style={{ fontFamily: '"STKaiti","KaiTi",serif', fontSize: 32, letterSpacing: '.08em', margin: 0 }}>
          {course?.title || '课程精读'}
        </h1>
        <span style={{ color: '#8a857b', fontSize: 12, letterSpacing: '.1em' }}>
          {course?.subtitle || ''} · {hasPdf ? '原版 PDF 在线阅读' : '书中原文数字化共读'}
        </span>
      </header>

      <div className="reader-shell" style={tab === 'pdf' || tab === 'slides' ? { gridTemplateColumns: '1fr' } : undefined}>
        {tab !== 'pdf' && tab !== 'slides' && (
          <aside className="reader-side">
            <h3>目 录</h3>
            <div className="sub">共 {lessons.length} 章</div>
            {lessons.map((l, i) => (
              <button key={l.id} className={`reader-lesson${l.id === active?.id ? ' on' : ''}`} onClick={() => openLesson(l.id)}>
                <span className="no">{String(i + 1).padStart(2, '0')}</span>{l.title}
              </button>
            ))}
            {lessons.length === 0 && <div className="reader-empty">暂无章节</div>}
          </aside>
        )}

        <main className="reader-main">
          <div className="reader-tabs" style={{ alignItems: 'center' }}>
            {TABS.map(([key, label]) => (
              <button key={key} className={`reader-tab${tab === key ? ' on' : ''}`} onClick={() => chooseTab(key)}>{label}</button>
            ))}
            {hasPdf && tab !== 'read' && (
              <span className="reader-textlink" onClick={() => chooseTab('read')}>文字版全文</span>
            )}
            {hasPdf && tab === 'read' && (
              <span className="reader-textlink back" onClick={() => chooseTab('pdf')}>← 返回原版 PDF</span>
            )}
          </div>

          {tab === 'pdf' && hasPdf && (
            <section className="reader-panel lit" style={{ padding: 0, overflow: 'hidden' }}>
              {pdfError && (
                <div className="empty-state" role="alert" style={{ padding: 40 }}>
                  <div>{pdfError}</div>
                  <button
                    type="button"
                    className="btn btn-ghost btn-sm"
                    style={{ marginTop: 12 }}
                    onClick={() => {
                      // 触发上面的 effect 重新拉取：先切走再切回
                      setPdfError(null);
                      setTab('read');
                      window.setTimeout(() => setTab('pdf'), 0);
                    }}
                  >
                    重新加载
                  </button>
                </div>
              )}
              {!pdfError && !pdfBlobUrl && (
                <div style={{ padding: 60, textAlign: 'center' }}>
                  <div className="spinner" style={{ margin: '0 auto' }} />
                </div>
              )}
              {!pdfError && pdfBlobUrl && (
                <>
                  <iframe
                    title="原版PDF"
                    src={pdfBlobUrl}
                    style={{ width: '100%', height: '76vh', border: 0, display: 'block' }}
                  />
                  <div style={{ padding: '10px 16px', fontSize: 12, color: '#9a9386', textAlign: 'center' }}>
                    若预览异常，可
                    <a
                      href={pdfBlobUrl}
                      download={`${(course as any)?.title || '课程'}原版.pdf`}
                      style={{ color: '#a12022', margin: '0 2px' }}
                    >
                      下载原版 PDF
                    </a>
                  </div>
                </>
              )}
            </section>
          )}

          {tab === 'read' && (
            <section className="reader-panel lit">
              {active ? (
                <>
                  <h2>{active.title}</h2>
                  <div className="src">{active.source_note || '越剧史话 · 数字化共读'}</div>
                  {paras.map((p, i) => <p key={i} className="reader-p">{p}</p>)}
                  <div className="reader-prevnext">
                    <button className="reader-pn" disabled={idx <= 0} onClick={() => goTo(idx - 1)}>← 上一章</button>
                    <button className="reader-pn" disabled={idx >= lessons.length - 1} onClick={() => goTo(idx + 1)}>下一章 →</button>
                  </div>
                </>
              ) : <div className="reader-empty">请选择左侧章节开始阅读</div>}
            </section>
          )}

          {tab === 'plan' && isTeacher && planSection}

          {tab === 'slides' && slidesSection}

          {tab === 'cards' && (
            <section className="reader-panel">
              <AiNotice text="本页知识卡片由人工智能归纳生成，用于辅助记忆与复习，不作为考核标准答案。" />
              {cards.length ? (
                <div className="card-grid">
                  {cards.map((cd) => (
                    <div className="card" key={cd.id}>
                      <h4>{cd.title}</h4>
                      <p>{cd.content}</p>
                    </div>
                  ))}
                </div>
              ) : <div className="reader-empty">暂无知识卡片</div>}
            </section>
          )}

          {tab === 'quiz' && (
            <section className="reader-panel">
              <AiNotice text="本页练习题由人工智能自动生成，答案与解析可能存在偏差，正式考核请以教师命题为准。" />
              {quiz.length ? quiz.map((q) => {
                const right = isRight(q);
                const answered = Boolean(picked[q.id]);
                return (
                  <div className="q" key={q.id}>
                    <div className="prompt">
                      {q.content}
                      <span className="types">
                        {q.type === 'single' ? '单选' : q.type === 'multiple' ? '多选' : q.type === 'judge' ? '判断' : '简答'}
                      </span>
                    </div>
                    {Array.isArray(q.options) && q.options.map((opt: string, oi: number) => {
                      const sel = (picked[q.id] || []).includes(oi);
                      let cls = 'opt';
                      if (answered) cls += sel ? (right ? ' right' : ' wrong') : '';
                      return (
                        <button key={oi} className={cls} onClick={() => pick(q.id, oi)}>
                          {String.fromCharCode(65 + oi)}. {opt}
                        </button>
                      );
                    })}
                    {answered && (
                      <div className={`resp ${right ? 'ok' : 'bad'}`}>
                        {right ? '回答正确 ✓' : '再想想，重选一下'}{' '}
                        {q.type === 'multiple' && '（多选需全部点中）'}
                      </div>
                    )}
                  </div>
                );
              }) : <div className="reader-empty">暂无随堂测验</div>}
              {isTeacher && (
                <div style={{ textAlign: 'center', marginTop: 8 }}>
                  <button className="res-btn" disabled={!!regen} onClick={() => doRegen('quizai')}>
                    {regen === 'quizai' ? '正在生成…' : '重新生成 AI 题目'}
                  </button>
                </div>
              )}
            </section>
          )}

          {tab === 'graph' && graphSection}
        </main>
      </div>
    </div>
  );
}
