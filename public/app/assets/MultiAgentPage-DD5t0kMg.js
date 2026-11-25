import{r as m,j as e,t as H,c as L}from"./index-Bzxtr7Nc.js";import{r as R}from"./format-CcxkhmgL.js";import{a as Y}from"./a11y-B3OSKWap.js";import{a as q,A as G}from"./AiLabel-CFKnteLN.js";const k={professor:{name:"越剧教授",avatar:"授",color:"cinnabar",desc:"越剧历史、流派、剧目、行当、唱腔专业知识"},advisor:{name:"学业顾问",avatar:"顾",color:"cyan",desc:"课程、作业、考试、成绩、错题学情数据"},artist:{name:"艺术指导",avatar:"艺",color:"ochre",desc:"AI 生图、唱腔模仿、身段表演、舞台艺术"},mentor:{name:"班主任",avatar:"班",color:"ink",desc:"签到出勤、学习态度、综合表现、学习建议"}},O=Object.keys(k),V=[["成绩+流派分析","我的成绩怎么样？哪些越剧流派需要加强？"],["学情+生图","帮我分析学习情况并画一张水墨越剧花旦图"],["知识+出勤","徐派有什么特点？我的出勤如何？"],["综合学情诊断","分析我的作业和考试，给出学习建议"]],Z=`
/* ===== 协作拓扑图 ===== */
.topology-card {
  background: var(--paper);
  border: 1px solid var(--ink-10);
  border-radius: var(--r-md);
  padding: 16px 18px;
  margin-bottom: 14px;
  box-shadow: var(--shadow-ink);
}
.topology-title {
  font-size: 12px;
  color: var(--ink-light);
  letter-spacing: 2px;
  margin-bottom: 12px;
  display: flex;
  align-items: center;
  gap: 8px;
}
.topology-title::before {
  content: '';
  width: 3px; height: 12px;
  background: var(--cinnabar);
}
.topology-flow {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-wrap: wrap;
  min-height: 50px;
}
.topo-node {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 4px;
  padding: 8px 12px;
  border: 1px solid var(--ink-10);
  border-radius: var(--r-sm);
  background: var(--paper);
  min-width: 76px;
  transition: all 0.3s;
  opacity: 0.4;
}
.topo-node.active {
  opacity: 1;
  border-color: var(--cinnabar);
  box-shadow: 0 0 0 3px rgba(193, 39, 45, 0.1);
}
.topo-node.done { opacity: 1; }
.topo-node-avatar {
  width: 32px; height: 32px;
  display: grid; place-items: center;
  border-radius: 50%;
  font-size: 13px;
  font-family: var(--font-brush);
  color: var(--paper);
}
.topo-node-avatar.cinnabar { background: var(--cinnabar); }
.topo-node-avatar.cyan { background: var(--cyan); }
.topo-node-avatar.ochre { background: var(--ochre); }
.topo-node-avatar.ink { background: var(--ink); }
.topo-node-avatar.router { background: var(--ink); }
.topo-node-avatar.summarizer { background: var(--ochre); }
.topo-node-name { font-size: 11px; color: var(--ink); }
.topo-node-status {
  font-size: 9px;
  color: var(--ink-light);
  letter-spacing: 1px;
}
.topo-arrow {
  color: var(--ink-light);
  font-size: 16px;
  opacity: 0.5;
}
.topo-arrow.active { opacity: 1; color: var(--cinnabar); }

/* ===== 汇总阶段卡片 ===== */
.summarizer-card {
  background: linear-gradient(135deg, rgba(166, 124, 82, 0.08), rgba(193, 39, 45, 0.04));
  border: 1px solid var(--ochre);
  border-radius: var(--r-md);
  padding: 14px 18px;
  margin: 8px 0;
  box-shadow: var(--shadow-ink);
}
.summarizer-head {
  display: flex;
  align-items: center;
  gap: 10px;
  margin-bottom: 8px;
}
.summarizer-avatar {
  width: 28px; height: 28px;
  display: grid; place-items: center;
  background: var(--ochre);
  color: var(--paper);
  border-radius: 50%;
  font-size: 12px;
  font-family: var(--font-brush);
}
.summarizer-title {
  font-size: 13px;
  color: var(--ink);
  font-weight: 600;
  font-family: var(--font-kai);
}
.summarizer-status {
  font-size: 11px;
  color: var(--ink-light);
  margin-left: auto;
}
.summarizer-status.thinking::before {
  content: '';
  display: inline-block;
  width: 6px; height: 6px;
  border-radius: 50%;
  background: var(--ochre);
  margin-right: 5px;
  animation: maPulse 1.2s ease-in-out infinite;
}
@keyframes maPulse {
  0%, 100% { opacity: 0.3; transform: scale(0.8); }
  50% { opacity: 1; transform: scale(1.2); }
}

/* ===== 协作统计面板 ===== */
.collab-stats {
  background: var(--paper);
  border: 1px solid var(--ink-10);
  border-radius: var(--r-md);
  padding: 12px 16px;
  margin-top: 10px;
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(140px, 1fr));
  gap: 10px;
}
.collab-stat {
  display: flex;
  flex-direction: column;
  gap: 2px;
}
.collab-stat-label {
  font-size: 10px;
  color: var(--ink-light);
  letter-spacing: 1px;
}
.collab-stat-value {
  font-size: 14px;
  color: var(--ink);
  font-weight: 600;
  font-family: var(--font-kai);
}

/* ===== RAG 引用展开 ===== */
.ep-rag-chunk {
  cursor: pointer;
  transition: background 0.2s;
}
.ep-rag-chunk:hover { background: rgba(58, 125, 123, 0.05); }
.ep-rag-content {
  display: none;
  margin-top: 4px;
  padding: 6px 8px;
  background: rgba(245, 240, 232, 0.6);
  border-left: 2px solid var(--cyan);
  font-size: 11px;
  color: var(--ink-soft);
  line-height: 1.6;
  white-space: pre-wrap;
}
.ep-rag-chunk.expanded .ep-rag-content { display: block; }

/* ===== 工具调用 round 标记 ===== */
.ep-tool-round {
  display: inline-block;
  padding: 0 5px;
  margin-left: 4px;
  background: var(--ink-10);
  color: var(--ink-light);
  border-radius: 8px;
  font-size: 9px;
}

/* ===== 专家卡片耗时 ===== */
.ep-duration {
  font-size: 10px;
  color: var(--ink-light);
  margin-left: auto;
}
`;function pe(){const[a,o]=m.useState([{id:0,role:"assistant",phase:"done",placeholder:"",activeExperts:[],experts:[],text:"",started:!0,welcome:!0,collaborators:[]}]),[i,x]=m.useState(""),[l,t]=m.useState(!1),[h,f]=m.useState([]),b=m.useRef(1),y=m.useRef(!1),E=m.useRef(null),D=m.useRef(null),S=m.useRef(null);m.useEffect(()=>{document.title="越韵智传 · 多智能体协作";const n=document.body.className;return document.body.className="page-multi-agent",()=>{var c;document.body.className=n,(c=E.current)==null||c.abort()}},[]),m.useEffect(()=>{const n=D.current;n&&(n.scrollTop=n.scrollHeight)},[a]);const B=()=>{const n=S.current;n&&(n.style.height="auto",n.style.height=Math.min(n.scrollHeight,140)+"px")},W=n=>{n.key==="Enter"&&!n.shiftKey&&(n.preventDefault(),A())},A=async n=>{const c=(n??i).trim();if(!c)return;if(y.current){H("正在协作处理中，请稍候","err");return}if(!L()){H("请先登录后再提问","err");return}const w=b.current++,M=b.current++;o(p=>[...p,{id:w,role:"user",phase:"done",placeholder:"",activeExperts:[],experts:[],text:c,started:!0,collaborators:[]},{id:M,role:"assistant",phase:"routing",placeholder:"调度系统正在分析问题…",activeExperts:[],experts:[],text:"",started:!1,collaborators:[]}]),x(""),S.current&&(S.current.style.height="auto"),y.current=!0,t(!0);const d=p=>o(v=>v.map(g=>g.id===M?p(g):g)),u=(p,v)=>d(g=>({...g,experts:g.experts.map(z=>z.key===p?v(z):z)})),$=new AbortController;E.current=$;let I="";try{const p=L(),v=await fetch("/api/multi-agent/chat",{method:"POST",headers:{"Content-Type":"application/json",...p?{Authorization:`Bearer ${p}`}:{}},body:JSON.stringify({message:c}),signal:$.signal});if(!v.ok)throw new Error(`请求失败 (${v.status})`);const g=v.body.getReader(),z=new TextDecoder("utf-8");let _="";for(;;){const{done:X,value:J}=await g.read();if(X)break;_+=z.decode(J,{stream:!0});const F=_.split(`
`);_=F.pop()||"";for(const Q of F){const C=Q.trim();if(!C||!C.startsWith("data:"))continue;const P=C.slice(5).trim();if(!P)continue;const s=(()=>{try{return JSON.parse(P)}catch{return null}})();if(s)if(s.type==="routing"){const r=s.experts||[];f(r),d(N=>({...N,routing:{experts:r,analysis:s.analysis||""},activeExperts:r,phase:"routing",placeholder:"已分发专家，正在并行处理…"}))}else if(s.type==="expert_start")d(r=>({...r,experts:[...r.experts,{key:s.expert,color:s.color,avatar:s.avatar,name:s.name,tools:[],ragExpanded:[],done:!1}],activeExperts:r.activeExperts.includes(s.expert)?r.activeExperts:[...r.activeExperts,s.expert],collaborators:[...r.collaborators,s.expert],phase:"experts"}));else if(s.type==="tool_start"){const r=s.round||0,N=Object.entries(s.args||{}),T=N.length?N.map(([j,U])=>`${j}: ${String(U)}`).join("，"):"（无参数）";u(s.expert,j=>({...j,tools:[...j.tools,{uid:`${s.name}_r${r}`,name:s.name,round:r,argsStr:T,state:"running"}]}))}else if(s.type==="tool_end"){const r=s.round||0,N=`${s.name}_r${r}`;u(s.expert,T=>({...T,tools:T.tools.map(j=>j.uid===N?{...j,state:s.success===!1?"failed":"done",summary:s.summary}:j)}))}else if(s.type==="rag"){if(!s.chunks||s.chunks.length===0)continue;u(s.expert,r=>r.rag?r:{...r,rag:s.chunks})}else s.type==="expert_end"?u(s.expert,r=>({...r,done:!0,answer:s.answer,durationMs:s.duration_ms,chars:s.chars})):s.type==="summarizer_start"?d(r=>({...r,phase:"summarizer",summarizer:{status:"thinking"},placeholder:"汇总 Agent 正在综合各专家回答…"})):s.type==="summarizer_end"?d(r=>({...r,summarizer:r.summarizer?{...r.summarizer,status:"done",durationMs:s.duration_ms}:{status:"done",durationMs:s.duration_ms}})):s.type==="token"?(I+=s.content,d(r=>({...r,started:!0,text:I,errorText:void 0,summarizer:r.summarizer&&!r.started&&r.summarizer.status==="thinking"?{...r.summarizer,status:"generating"}:r.summarizer}))):s.type==="error"?d(r=>({...r,errorText:s.message})):s.type==="done"&&d(r=>({...r,phase:"done",toolCount:s.toolCount,expertStats:s.expertStats,summarizerDuration:s.summarizerDuration,totalDuration:s.totalDuration,errorText:void 0}))}}}catch(p){if(p instanceof DOMException&&p.name==="AbortError")return;const v=p instanceof Error?p.message:String(p);d(g=>({...g,networkError:v}))}finally{y.current=!1,t(!1),setTimeout(()=>f([]),2e3)}},K=(n,c,w)=>{o(M=>M.map(d=>d.id===n?{...d,experts:d.experts.map(u=>u.key===c?{...u,ragExpanded:u.ragExpanded.includes(w)?u.ragExpanded.filter($=>$!==w):[...u.ragExpanded,w]}:u)}:d))};return e.jsxs(e.Fragment,{children:[e.jsx("style",{children:Z}),e.jsx("main",{className:"main",children:e.jsxs("div",{className:"container",style:{paddingTop:8},children:[e.jsxs("section",{className:"page-hero",children:[e.jsx("div",{className:"ink-wash ink-wash-1",style:{background:"var(--cinnabar)"}}),e.jsx("div",{className:"ink-wash ink-wash-2",style:{background:"var(--cyan)"}}),e.jsx("div",{className:"hero-seal",children:e.jsx("span",{className:"seal seal-vertical",children:"协作"})}),e.jsxs("h1",{children:["多智能体协作 ",e.jsx(q,{style:{fontSize:12,padding:"2px 10px"}})]})]}),e.jsx(G,{text:"本页结论由多个人工智能智能体分工协作生成，各专家意见均由模型推理得出，可能存在相互矛盾或不准确之处，请人工甄别后使用。"}),e.jsxs("div",{className:"scroll-frame",style:{marginBottom:20},children:[e.jsxs("div",{className:"section-title",children:[e.jsx("span",{className:"st-text",children:"专家团队"}),e.jsx("span",{className:"st-line"})]}),e.jsx("div",{className:"expert-team",id:"expertTeam",children:O.map(n=>{const c=k[n];return e.jsxs("div",{className:`expert-card${h.includes(n)?" expert-active":""}`,children:[e.jsx("div",{className:`expert-avatar expert-color-${c.color}`,children:c.avatar}),e.jsxs("div",{className:"expert-info",children:[e.jsx("div",{className:"expert-name",children:c.name}),e.jsx("div",{className:"expert-desc",children:c.desc})]})]},n)})})]}),e.jsx("div",{className:"agent-main",children:e.jsxs("div",{className:"chat-stream",children:[e.jsx("div",{className:"chat-area",id:"chatArea",ref:D,children:a.map(n=>e.jsx(ee,{m:n,onToggleRag:K},n.id))}),e.jsxs("div",{className:"composer-wrap",children:[e.jsx("div",{className:"example-questions",id:"exampleQuestions",children:V.map(([n,c])=>e.jsx("span",{className:"example-q",onClick:()=>A(c),children:n},c))}),e.jsxs("div",{className:"chat-composer",children:[e.jsx("textarea",{className:"textarea",id:"msgInput",ref:S,placeholder:"提出复杂问题，多专家将协作处理…",rows:1,value:i,onChange:n=>x(n.target.value),onInput:B,onKeyDown:W}),e.jsx("button",{className:"send-btn",id:"sendBtn",title:"发送",disabled:l,onClick:()=>A(),children:e.jsxs("svg",{width:"20",height:"20",viewBox:"0 0 24 24",fill:"none",stroke:"currentColor",strokeWidth:"2",strokeLinecap:"round",strokeLinejoin:"round",children:[e.jsx("line",{x1:"22",y1:"2",x2:"11",y2:"13"}),e.jsx("polygon",{points:"22 2 15 22 11 13 2 9 22 2"})]})})]})]})]})})]})})]})}function ee({m:a,onToggleRag:o}){const i=a.role==="user",x=a.started&&!a.networkError&&a.phase!=="done";return e.jsxs("div",{className:`msg ${a.role} fade-up`,children:[e.jsx("div",{className:`msg-avatar${i?"":" ma-avatar"}`,children:i?"我":"协"}),e.jsxs("div",{className:"msg-body",children:[a.routing&&e.jsx(se,{routing:a.routing}),a.role==="assistant"&&!a.welcome&&(a.routing||a.phase!=="routing")&&e.jsx(re,{m:a}),a.experts.map(l=>e.jsx(te,{e:l,msgId:a.id,onToggleRag:o},l.key)),a.summarizer&&e.jsx(ne,{s:a.summarizer}),e.jsx("div",{className:`bubble${x?" stream-cursor streaming-ink":""}`,children:a.welcome?e.jsx(ae,{}):a.networkError?e.jsxs("p",{style:{color:"var(--cinnabar)"},children:["⚠ 网络异常：",a.networkError]}):a.errorText?e.jsxs("p",{style:{color:"var(--cinnabar)"},children:["⚠ ",a.errorText]}):a.role==="user"?a.text:a.started?e.jsx("span",{dangerouslySetInnerHTML:{__html:R(a.text)}}):a.phase==="done"?e.jsx("span",{style:{color:"var(--ink-light)"},children:"协作完成，但未生成回答"}):e.jsxs(e.Fragment,{children:[e.jsxs("span",{className:"typing-dots",children:[e.jsx("span",{}),e.jsx("span",{}),e.jsx("span",{})]})," ",a.placeholder]})}),a.phase==="done"&&!a.welcome&&a.collaborators.length>0&&e.jsxs("div",{className:"msg-meta",children:[e.jsx("span",{style:{fontSize:12,color:"var(--ink-light)"},children:"协作专家"})," ",a.collaborators.map(l=>{const t=k[l];return t?e.jsxs("span",{className:`collab-badge expert-color-${t.color}`,children:[e.jsx("span",{className:"cb-icon",children:t.avatar}),t.name]},l):null})," ",a.toolCount&&a.toolCount>0?e.jsxs("span",{style:{fontSize:11,color:"var(--ink-light)",marginLeft:6},children:["· 调用 ",a.toolCount," 次工具"]}):null]}),a.expertStats&&e.jsx(oe,{expertStats:a.expertStats,summarizerDuration:a.summarizerDuration||0,totalDuration:a.totalDuration||0})]})]})}function ae(){return e.jsxs(e.Fragment,{children:[e.jsxs("p",{children:["您好，我是",e.jsx("strong",{children:"多智能体协作系统"}),"。我会将您的问题分发给最合适的专家 Agent 团队并行处理，再综合汇总成完整回答。"]}),e.jsx("p",{children:"试试问我："}),e.jsxs("p",{children:["· ",e.jsx("span",{style:{color:"var(--cinnabar)"},children:"我的成绩怎么样？哪些越剧流派需要加强？"}),"（学业顾问+越剧教授协作）",e.jsx("br",{}),"· ",e.jsx("span",{style:{color:"var(--cinnabar)"},children:"帮我分析学习情况并画一张水墨越剧图"}),"（学业顾问+艺术指导协作）",e.jsx("br",{}),"· ",e.jsx("span",{style:{color:"var(--cinnabar)"},children:"徐派有什么特点？我的出勤如何？"}),"（越剧教授+班主任协作）"]})]})}function se({routing:a}){return e.jsxs("div",{className:"routing-card",children:[e.jsxs("div",{className:"routing-head",children:[e.jsxs("svg",{width:"14",height:"14",viewBox:"0 0 24 24",fill:"none",stroke:"currentColor",strokeWidth:"2",children:[e.jsx("circle",{cx:"12",cy:"12",r:"3"}),e.jsx("path",{d:"M12 1v6M12 17v6M4.22 4.22l4.24 4.24M15.54 15.54l4.24 4.24M1 12h6M17 12h6M4.22 19.78l4.24-4.24M15.54 8.46l4.24-4.24"})]}),"调度决策"]}),e.jsx("div",{className:"routing-experts",children:a.experts.map(o=>{const i=k[o];return i?e.jsxs("span",{className:`routing-badge expert-color-${i.color}`,children:[e.jsx("span",{className:"rb-icon",children:i.avatar}),i.name]},o):null})}),e.jsx("div",{className:"routing-analysis",children:a.analysis})]})}function re({m:a}){const o=a.phase!=="routing",i=a.phase==="summarizer",x=a.phase==="done",l=O.filter(t=>a.activeExperts.includes(t)).map(t=>{const h=k[t],f=a.experts.find(E=>E.key===t),b=!!(f!=null&&f.done),y=a.phase==="experts"&&!b;return e.jsxs("div",{className:`topo-node ${b?"done":y?"active":""}`,children:[e.jsx("div",{className:`topo-node-avatar ${h.color}`,children:h.avatar}),e.jsx("div",{className:"topo-node-name",children:h.name}),e.jsx("div",{className:"topo-node-status",children:b?"已完成":y?"处理中":"待激活"})]},t)});return e.jsxs("div",{className:"topology-card",children:[e.jsx("div",{className:"topology-title",children:"协作拓扑图"}),e.jsxs("div",{className:"topology-flow",children:[e.jsxs("div",{className:`topo-node ${o?"done":"active"}`,children:[e.jsx("div",{className:"topo-node-avatar router",children:"调"}),e.jsx("div",{className:"topo-node-name",children:"调度员"}),e.jsx("div",{className:"topo-node-status",children:o?"已分发":"分析中"})]}),e.jsx("span",{className:`topo-arrow ${o?"active":""}`,children:"→"}),l.length>0&&e.jsxs(e.Fragment,{children:[l,e.jsx("span",{className:`topo-arrow ${a.phase!=="routing"?"active":""}`,children:"→"})]}),e.jsxs("div",{className:`topo-node ${i?"active":x?"done":""}`,children:[e.jsx("div",{className:"topo-node-avatar summarizer",children:"汇"}),e.jsx("div",{className:"topo-node-name",children:"汇总 Agent"}),e.jsx("div",{className:"topo-node-status",children:x?"已完成":i?"汇总中":"待汇总"})]})]})]})}function te({e:a,msgId:o,onToggleRag:i}){const x=a.durationMs?` · ${(a.durationMs/1e3).toFixed(1)}s`:"",l=a.chars?` · ${a.chars}字`:"";return e.jsxs("div",{className:`expert-process expert-color-${a.color}`,children:[e.jsxs("div",{className:"ep-head",children:[e.jsx("div",{className:`ep-avatar expert-color-${a.color}`,children:a.avatar}),e.jsxs("div",{className:"ep-info",children:[e.jsx("div",{className:"ep-name",children:a.name}),e.jsx("div",{className:"ep-status",children:a.done?e.jsxs("span",{className:"ep-status-text",children:["已完成",x,l]}):e.jsxs(e.Fragment,{children:[e.jsx("span",{className:"ep-spinner"}),e.jsx("span",{className:"ep-status-text",children:"正在处理…"})]})})]})]}),e.jsxs("div",{className:"ep-tools",children:[a.tools.map(t=>e.jsxs("div",{className:"ep-tool",children:[e.jsxs("div",{className:"ep-tool-head",children:[e.jsxs("span",{className:"ep-tool-name",children:[t.name,t.round>0&&e.jsxs("span",{className:"ep-tool-round",children:["第",t.round+1,"轮"]})]}),e.jsx("span",{className:"ep-tool-status",children:t.state==="running"?e.jsxs(e.Fragment,{children:[e.jsx("span",{className:"ep-tool-spinner"}),"调用中"]}):t.state==="failed"?"失败":"完成"})]}),e.jsx("div",{className:"ep-tool-args",children:t.argsStr}),t.state!=="running"&&e.jsx("div",{className:"ep-tool-result",style:{display:"block"},dangerouslySetInnerHTML:{__html:R(t.summary)||"（无返回）"}})]},t.uid)),a.rag&&a.rag.length>0&&e.jsxs("div",{className:"ep-rag",children:[e.jsxs("div",{className:"ep-rag-title",children:["📚 知识库检索（",a.rag.length," 条，点击展开原文）"]}),a.rag.map((t,h)=>e.jsxs("div",{className:`ep-rag-chunk${a.ragExpanded.includes(h)?" expanded":""}`,onClick:()=>i(o,a.key,h),...Y(()=>i(o,a.key,h),t.title),children:[e.jsxs("div",{style:{display:"flex",justifyContent:"space-between",alignItems:"center",padding:"4px 0"},children:[e.jsx("span",{className:"ep-rag-title-text",children:t.title}),e.jsxs("span",{className:"ep-rag-score",children:[(t.score*100).toFixed(0),"%"]})]}),e.jsx("div",{className:"ep-rag-content",children:t.content||"（无内容）"})]},h))]})]}),a.done&&e.jsx("div",{className:"ep-answer",style:{display:"block"},dangerouslySetInnerHTML:{__html:R(a.answer)}})]})}function ne({s:a}){const o=a.status==="done"?`已完成 · ${a.durationMs??0}ms`:a.status==="generating"?"生成中…":"综合中…";return e.jsxs("div",{className:"summarizer-card",children:[e.jsxs("div",{className:"summarizer-head",children:[e.jsx("div",{className:"summarizer-avatar",children:"汇"}),e.jsx("div",{className:"summarizer-title",children:"汇总 Agent"}),e.jsx("div",{className:`summarizer-status${a.status==="thinking"?" thinking":""}`,children:o})]}),e.jsx("div",{style:{fontSize:12,color:"var(--ink-light)",lineHeight:1.7},children:"融合各专家观点，去除重复，保持逻辑连贯，输出最终答案"})]})}function oe({expertStats:a,summarizerDuration:o,totalDuration:i}){return e.jsxs("div",{className:"collab-stats",children:[Object.entries(a).map(([x,l])=>{const t=k[x];return t?e.jsxs("div",{className:"collab-stat",children:[e.jsxs("div",{className:"collab-stat-label",children:[t.name," 耗时"]}),e.jsxs("div",{className:"collab-stat-value",children:[(l.duration/1e3).toFixed(1),"s · ",l.tools,"工具 · ",l.chars,"字"]})]},x):null}),e.jsxs("div",{className:"collab-stat",children:[e.jsx("div",{className:"collab-stat-label",children:"汇总 Agent 耗时"}),e.jsxs("div",{className:"collab-stat-value",children:[(o/1e3).toFixed(1),"s"]})]}),e.jsxs("div",{className:"collab-stat",children:[e.jsx("div",{className:"collab-stat-label",children:"总协作耗时"}),e.jsxs("div",{className:"collab-stat-value",style:{color:"var(--cinnabar)"},children:[(i/1e3).toFixed(1),"s"]})]})]})}export{pe as MultiAgentPage};
