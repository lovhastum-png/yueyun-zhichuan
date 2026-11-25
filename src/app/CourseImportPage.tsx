/* ============================================================
   PDF 导入课程：上传 → OCR → 越剧审查 → 自动建课
   /course-import （教师）
   ============================================================ */
import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { getToken, getUser } from '../shared/auth';
import { toast } from '../shared/toast';

const style = `
.ci-wrap{max-width:760px;margin:0 auto}
.ci-card{background:#fffdf8;border:1px solid rgba(26,26,26,.1);border-radius:18px;padding:28px 32px;box-shadow:0 18px 48px -40px rgba(26,26,26,.7)}
.ci-drop{border:2px dashed rgba(193,39,45,.4);border-radius:14px;padding:38px 20px;text-align:center;cursor:pointer;transition:.2s;background:rgba(193,39,45,.02)}
.ci-drop:hover,.ci-drop.drag{background:rgba(193,39,45,.06);border-color:#a12022}
.ci-drop .big{font-family:"STKaiti","KaiTi",serif;font-size:22px;color:#a12022;letter-spacing:.1em;margin-bottom:6px}
.ci-drop .tip{font-size:12.5px;color:#8a857b}
.ci-field{margin-top:16px}
.ci-field input{width:100%;padding:10px 14px;border:1px solid rgba(26,26,26,.16);border-radius:8px;font-size:14px;font-family:inherit}
.ci-btn{margin-top:16px;width:100%;padding:12px;border:0;border-radius:8px;background:#a12022;color:#fff;font-size:15px;letter-spacing:.1em;cursor:pointer}
.ci-btn:disabled{opacity:.5;cursor:not-allowed}
.ci-bar{height:10px;border-radius:99px;overflow:hidden;background:rgba(26,26,26,.08);margin-top:18px}
.ci-bar i{display:block;height:100%;background:linear-gradient(90deg,#3a7d7b,#a12022);transition:width .3s ease}
.ci-log{font-size:12.5px;color:#555;margin-top:12px;line-height:1.8}
.ci-verdict{margin-top:14px;padding:12px 16px;border-radius:10px;font-size:13px;line-height:1.8}
.ci-verdict.ok{background:rgba(46,158,91,.1);border:1px solid rgba(46,158,91,.3);color:#1e6e40}
.ci-verdict.bad{background:rgba(192,57,43,.08);border:1px solid rgba(192,57,43,.3);color:#a93226}
.ci-stats{display:flex;gap:14px;flex-wrap:wrap;margin-top:14px}
.ci-stat{background:#f7f1e4;border:1px solid rgba(196,160,97,.35);border-radius:10px;padding:12px 20px;text-align:center}
.ci-stat b{display:block;font-family:"STKaiti",serif;font-size:24px;color:#a12022}
.ci-stat span{font-size:11px;color:#8a857b;letter-spacing:.06em}
.ci-go{margin-top:16px;display:inline-flex;padding:11px 26px;border-radius:8px;background:#a12022;color:#fff;font-weight:600;letter-spacing:.06em}
.ci-service{margin:0 0 14px;padding:10px 12px;border-radius:8px;font-size:12.5px;line-height:1.6}
.ci-service.checking{background:rgba(58,125,123,.08);color:#356866}
.ci-service.ready{background:rgba(46,158,91,.1);color:#1e6e40}
.ci-service.offline{background:rgba(192,57,43,.08);color:#a93226}
.ci-retry{margin-top:12px;padding:8px 14px;border:1px solid rgba(161,32,34,.45);border-radius:7px;background:#fffdf8;color:#a12022;cursor:pointer}
.ci-resume{margin-top:12px;padding:9px 16px;border:0;border-radius:7px;background:#a12022;color:#fff;cursor:pointer;font-weight:600}
.ci-cancel{margin-left:10px;padding:8px 14px;border:1px solid rgba(85,80,72,.32);border-radius:7px;background:#fffdf8;color:#625d55;cursor:pointer;font-size:12.5px}
.ci-flow{margin-top:20px;padding:18px;background:#fcf8ef;border:1px solid rgba(196,160,97,.25);border-radius:12px}
.ci-flow-head{display:flex;align-items:baseline;justify-content:space-between;gap:12px;margin-bottom:14px}
.ci-flow-head b{font-size:14px;color:#3e3932;letter-spacing:.04em}.ci-flow-head span{font-size:12px;color:#8a857b}
.ci-flow-grid{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:12px 8px}
.ci-flow-item{position:relative;min-height:62px;padding:3px 4px 3px 28px;color:#a19b90;transition:color .25s ease}
.ci-flow-item:not(:nth-child(4n))::after{content:"";position:absolute;left:9px;right:-7px;top:11px;height:1px;background:#ddd5c8}
.ci-flow-dot{position:absolute;left:2px;top:4px;z-index:1;width:16px;height:16px;border-radius:50%;display:grid;place-items:center;background:#fffdf8;border:1px solid #d7d0c5;font-size:10px;font-weight:700;color:#a19b90}
.ci-flow-item b{display:block;font-size:12.5px;font-weight:600;line-height:1.35}.ci-flow-item span{display:block;margin-top:3px;font-size:10.5px;line-height:1.4;color:#aaa398}
.ci-flow-item.done{color:#2d8060}.ci-flow-item.done .ci-flow-dot{background:#2d8060;border-color:#2d8060;color:#fff}.ci-flow-item.done span{color:#6c9a84}
.ci-flow-item.active{color:#a12022}.ci-flow-item.active .ci-flow-dot{background:#a12022;border-color:#a12022;color:#fff;box-shadow:0 0 0 4px rgba(161,32,34,.12);animation:ci-pulse 1.6s ease-in-out infinite}.ci-flow-item.active span{color:#a12022}
@keyframes ci-pulse{50%{box-shadow:0 0 0 7px rgba(161,32,34,0)}}
@media(max-width:640px){.ci-card{padding:22px 18px}.ci-flow-grid{grid-template-columns:repeat(2,minmax(0,1fr))}.ci-flow-item:not(:nth-child(4n))::after{display:none}.ci-flow-head{display:block}.ci-flow-head span{display:block;margin-top:4px}}
`;

const STEPS: Record<string, string> = {
  queued: '排队中',
  ocr: '正在 OCR 识别文字（多页可能需要几分钟，请稍候）…',
  review: '正在审查是否为越剧内容…',
  build: '正在构建课程章节、知识卡片与测验…',
  plan: '正在 AI 撰写教案…',
  ppt: '正在生成 PPT 课件大纲…',
  graph: '正在抽取知识图谱（实体+关系）…',
  quizai: '正在生成单选/多选题…',
  interrupted: '服务重启后已安全暂停。可继续导入，或进入已生成的课程。',
};

const PROCESS_STEPS = [
  { key: 'upload', title: '上传文件', hint: '安全传送 PDF' },
  { key: 'ocr', title: '文字识别', hint: '逐页提取内容' },
  { key: 'review', title: '内容审核', hint: '核验越剧主题' },
  { key: 'build', title: '课程构建', hint: '章节与知识卡片' },
  { key: 'plan', title: '生成教案', hint: '梳理教学目标' },
  { key: 'ppt', title: '课件大纲', hint: '组织课堂内容' },
  { key: 'graph', title: '知识图谱', hint: '提取实体关系' },
  { key: 'quizai', title: '随堂测验', hint: '生成练习题目' },
];

const STATUS_STEP_INDEX: Record<string, number> = {
  queued: 1, ocr: 1, review: 2, build: 3,
  plan: 4, ppt: 5, graph: 6, quizai: 7,
};

export function CourseImportPage() {
  const [file, setFile] = useState<File | null>(null);
  const [title, setTitle] = useState('');
  const [drag, setDrag] = useState(false);
  const taskStorageKey = 'yy_import_task_' + getUser()?.id;
  const [taskId, setTaskId] = useState<string | null>(() => {
    try { return sessionStorage.getItem(taskStorageKey); } catch { return null; }
  });
  const [pollError, setPollError] = useState('');
  useEffect(() => {
    try {
      if (taskId) sessionStorage.setItem(taskStorageKey, taskId);
      else sessionStorage.removeItem(taskStorageKey);
    } catch { /* 浏览器可能禁止会话存储 */ }
  }, [taskId, taskStorageKey]);
  const [task, setTask] = useState<any>(null);
  const [pollNonce, setPollNonce] = useState(0);
  const [uploading, setUploading] = useState(false);
  const [uploadProgress, setUploadProgress] = useState(0);
  const [ocr, setOcr] = useState<{
    ready: boolean;
    message: string;
    maxPdfMB?: number;
    activeImports?: number;
    queuedImports?: number;
  } | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);
  const uploadController = useRef<AbortController | null>(null);

  useEffect(() => {
    let disposed = false;
    const checkOcr = async () => {
      try {
        const r = await fetch('/api/course/import/status', {
          headers: { Authorization: `Bearer ${getToken()}` },
          // 304 响应没有正文，状态检测必须始终读取最新 JSON，不能走浏览器协商缓存。
          cache: 'no-store',
        });
        const d = await r.json();
        if (!disposed) {
          setOcr(d.code === 0
            ? d.data
            : { ready: false, message: d.message || 'PDF 识别服务暂不可用' });
        }
      } catch {
        if (!disposed) setOcr({ ready: false, message: '无法连接导入服务，请检查网络后刷新页面' });
      }
    };
    checkOcr();
    // 服务刚重启时无需让教师手动刷新页面，自动恢复可点击状态。
    const timer = window.setInterval(checkOcr, 10_000);
    return () => {
      disposed = true;
      window.clearInterval(timer);
    };
  }, []);

  useEffect(() => {
    if (!taskId) return;
    let disposed = false;
    let timer: ReturnType<typeof setTimeout>;
    let failures = 0;
    let controller: AbortController;
    const poll = async () => {
      controller = new AbortController();
      let terminal = false;
      const timeout = setTimeout(() => controller.abort(), 15000);
      try {
        const r = await fetch(`/api/course/import/task/${taskId}`, {
          headers: { Authorization: `Bearer ${getToken()}` },
          cache: 'no-store', signal: controller.signal,
        });
        const d = await r.json();
        if (disposed) return;
        if (d.code === 0) {
          setTask(d.data);
          setPollError('');
          failures = 0;
          terminal = ['done', 'rejected', 'failed', 'interrupted'].includes(d.data.status);
        } else if ([401, 403, 404].includes(r.status)) {
          setTask({ status: 'failed', error: r.status === 404
            ? '导入进度已过期或服务已重启，请先到课程中心确认是否已生成，再决定是否重新导入。'
            : d.message });
          setPollError('');
          terminal = true;
        } else throw new Error(d.message);
      } catch {
        if (!disposed) {
          failures += 1;
          setPollError('暂时无法获取进度，正在自动重连。后台任务可能仍在处理，请勿重复上传。');
        }
      } finally {
        clearTimeout(timeout);
        if (!disposed && !terminal) timer = setTimeout(poll, Math.min(15000, 2500 * (failures + 1)));
      }
    };
    poll();
    return () => { disposed = true; clearTimeout(timer); controller?.abort(); };
  }, [taskId, pollNonce]);

  const doUpload = async () => {
    if (uploading || taskId) return;
    if (!file) { toast('请先选择 PDF 文件', 'err'); return; }
    if (!file.name.toLowerCase().endsWith('.pdf')) {
      toast('请选择 PDF 文件', 'err'); return;
    }
    if (file.size < 512 || file.size > (ocr?.maxPdfMB || 100) * 1024 * 1024) {
      toast(`请选择有效 PDF，文件上限 ${ocr?.maxPdfMB || 100}MB`, 'err'); return;
    }
    setUploading(true);
    setUploadProgress(0);
    const controller = new AbortController();
    uploadController.current = controller;
    let activeUploadId: string | null = null;
    try {
      const auth = { Authorization: `Bearer ${getToken()}` };
      const readJson = async (r: Response) => {
        const text = await r.text();
        let data: any;
        try { data = JSON.parse(text); } catch {
          const error = new Error(
            r.status >= 500
              ? `上传连接暂时中断（HTTP ${r.status}），系统将自动重试`
              : `上传服务返回异常（HTTP ${r.status}），请刷新页面后重试`,
          );
          (error as Error & { retryable?: boolean }).retryable = r.status === 429 || r.status >= 500;
          throw error;
        }
        if (data.code !== 0) {
          const error = new Error(data.message || `上传失败（HTTP ${r.status}）`);
          // 登录失效、文件校验失败等业务错误不会因重试而恢复，直接提示用户。
          (error as Error & { retryable?: boolean }).retryable = r.status === 429 || r.status >= 500;
          throw error;
        }
        return data.data;
      };
      const sendJson = async (url: string, options: RequestInit) => {
        const attemptController = new AbortController();
        const cancel = () => attemptController.abort();
        controller.signal.addEventListener('abort', cancel, { once: true });
        if (controller.signal.aborted) cancel();
        const timeout = window.setTimeout(cancel, 30000);
        try {
          return await readJson(await fetch(url, { ...options, signal: attemptController.signal }));
        } catch (err) {
          if (attemptController.signal.aborted && !controller.signal.aborted) {
            throw new Error('上传连接超时，请检查网络后重试');
          }
          throw err;
        } finally {
          window.clearTimeout(timeout);
          controller.signal.removeEventListener('abort', cancel);
        }
      };
      // Tunnel 某条连接短暂重建时，初始化和最终提交也必须具备与分片相同的重试能力。
      const requestJson = async (url: string, options: RequestInit, maxAttempts = 4) => {
        let lastError: unknown;
        for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
          try {
            return await sendJson(url, options);
          } catch (err: any) {
            if (controller.signal.aborted || err?.retryable === false) throw err;
            lastError = err;
            if (attempt < maxAttempts - 1) {
              await new Promise((resolve) => window.setTimeout(resolve, 800 * (attempt + 1)));
            }
          }
        }
        throw lastError;
      };

      // 文件分为小分片（当前为 256KB）逐一确认。公网隧道只需稳定传输短请求，不会再卡在单个大请求的 100%。
      const init = await requestJson('/api/course/import/upload/init', {
        method: 'POST',
        headers: { ...auth, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          filename: file.name,
          size: file.size,
          courseTitle: title || file.name.replace(/\.pdf$/i, ''),
          category: '越剧知识',
        }),
      });
      const { uploadId, chunkSize } = init;
      activeUploadId = uploadId;
      setUploadProgress(1);

      let nextIndex = 0;
      let uploadedBytes = 0;
      const totalChunks = Math.ceil(file.size / chunkSize);
      const uploadOneChunk = async (index: number) => {
        const offset = index * chunkSize;
        const end = Math.min(offset + chunkSize, file.size);
        const chunk = file.slice(offset, end);
        const bytes = new Uint8Array(await chunk.arrayBuffer());
        let binary = '';
        // 分段拼接，避免大数组一次展开到 btoa 时触发浏览器参数长度限制。
        for (let start = 0; start < bytes.length; start += 0x8000) {
          binary += String.fromCharCode(...bytes.subarray(start, start + 0x8000));
        }
        const data = btoa(binary);
        let lastError: unknown;
        for (let attempt = 0; attempt < 3; attempt += 1) {
          try {
            await sendJson(`/api/course/import/upload/${uploadId}/chunk/${index}`, {
              method: 'POST',
              headers: { ...auth, 'Content-Type': 'application/json' },
              body: JSON.stringify({ data }),
              signal: controller.signal,
            });
            lastError = null;
            break;
          } catch (err: any) {
            if (controller.signal.aborted) throw err;
            lastError = err;
            if (err?.retryable === false) break;
            if (attempt < 2) await new Promise((resolve) => window.setTimeout(resolve, 700 * (attempt + 1)));
          }
        }
        if (lastError) throw lastError;
        uploadedBytes += end - offset;
        // 最后所有分片完成仍留 1%，用于表示还在向服务器提交最终导入任务。
        setUploadProgress(Math.min(99, Math.max(1, Math.round(uploadedBytes / file.size * 100))));
      };
      const worker = async () => {
        while (nextIndex < totalChunks) {
          const index = nextIndex;
          nextIndex += 1;
          await uploadOneChunk(index);
        }
      };
      // 利用 Tunnel 的多路连接并行上传 8 片；服务端按偏移写盘，支持乱序抵达。
      // 256KB 小片即使个别请求重试，也不会阻塞其余分片。
      await Promise.all(Array.from({ length: Math.min(8, totalChunks) }, worker));

      const d = await requestJson(`/api/course/import/upload/${uploadId}/complete`, {
        method: 'POST', headers: auth,
      });
      setUploadProgress(100);
      setTaskId(d.taskId);
      toast('文件上传完成，开始生成课程…', 'ok');
    } catch (e: any) {
      if (!controller.signal.aborted) controller.abort();
      if (activeUploadId) {
        fetch(`/api/course/import/upload/${activeUploadId}`, {
          method: 'DELETE', headers: { Authorization: `Bearer ${getToken()}` },
        }).catch(() => {});
      }
      toast(e?.name === 'AbortError' ? '已取消上传' : (e?.message || '上传失败：网络错误'), 'err');
    } finally {
      uploadController.current = null;
      setUploading(false);
    }
  };

  const cancelUpload = () => uploadController.current?.abort();

  const done = task?.status === 'done';
  const partial = done && !!task?.result?.warnings?.length;
  const rejected = task?.status === 'rejected';
  const failed = task?.status === 'failed';
  const interrupted = task?.status === 'interrupted';
  const busy = task && !done && !rejected && !failed && !interrupted;
  const activeStep = uploading
    ? 0
    : done
      ? PROCESS_STEPS.length
      : rejected
        ? 3
      : STATUS_STEP_INDEX[task?.status || 'queued'] ?? 0;
  // 上传只占完整流程的一小段，避免文件传完时整体进度条被误认为课程已生成。
  const progress = uploading ? Math.max(1, Math.round(uploadProgress * 0.08)) : task?.progress || 0;
  const resetImport = () => {
    setTaskId(null);
    setTask(null);
    setPollError('');
  };
  const resumeImport = async () => {
    if (!taskId || !interrupted) return;
    try {
      const r = await fetch(`/api/course/import/task/${taskId}/resume`, {
        method: 'POST', headers: { Authorization: `Bearer ${getToken()}` },
      });
      const d = await r.json();
      if (d.code !== 0) throw new Error(d.message || '继续导入失败');
      if (d.data?.courseId) {
        setTask((old: any) => ({ ...old, result: { ...(old?.result || {}), courseId: d.data.courseId } }));
        toast('课程基础内容已保留，可直接进入课程页', 'ok');
      } else {
        setTask(null);
        setPollNonce((value) => value + 1);
        toast('任务已恢复，正在继续导入…', 'ok');
      }
    } catch (err: any) {
      toast(err?.message || '继续导入失败', 'err');
    }
  };

  return (
    <div className="container" style={{ padding: '34px 32px 70px' }}>
      <style>{style}</style>
      <nav style={{ fontSize: 12.5, color: '#8a857b', marginBottom: 12 }}>
        <Link to="/courses" style={{ color: '#a12022' }}>课程中心</Link>
        {' / PDF 导入课程'}
      </nav>
      <div className="ci-wrap">
        <header style={{ marginBottom: 18 }}>
          <h1 style={{ fontFamily: '"STKaiti","KaiTi",serif', fontSize: 30, letterSpacing: '.08em', margin: 0 }}>PDF 导入课程</h1>
          <p style={{ color: '#8a857b', fontSize: 12.5, marginTop: 6, lineHeight: 1.7 }}>
            上传一本越剧 PDF，系统将自动 OCR 识别文字、审查是否为越剧内容，并生成在线阅读课程 + 教案 + PPT 课件 + 知识卡片 + 知识图谱 + 随堂测验（含 AI 单选/多选题），同时补充进本地知识库与知识图谱。
          </p>
        </header>

        <div className="ci-card">
          <div className={`ci-service ${ocr === null ? 'checking' : ocr.ready ? 'ready' : 'offline'}`}>
            {ocr === null
              ? '正在检查 PDF 识别服务…'
              : ocr.ready
                ? '✓ PDF 识别服务已就绪，可开始导入。'
                : `PDF 识别服务暂不可用：${ocr.message}`}
          </div>
          <div
            className={`ci-drop${drag ? ' drag' : ''}`}
            role="button" tabIndex={uploading || taskId ? -1 : 0}
            aria-label="选择 PDF 文件" aria-disabled={!!(uploading || taskId)}
            onKeyDown={(e) => { if (!uploading && !taskId && (e.key === 'Enter' || e.key === ' ')) { e.preventDefault(); fileInput.current?.click(); } }}
            onClick={() => { if (!uploading && !taskId) fileInput.current?.click(); }}
            onDragOver={(e) => { e.preventDefault(); setDrag(true); }}
            onDragLeave={() => setDrag(false)}
            onDrop={(e) => { e.preventDefault(); setDrag(false); const f = e.dataTransfer.files?.[0]; if (f && !uploading && !taskId) setFile(f); }}
          >
            <input ref={fileInput} type="file" accept=".pdf,application/pdf" hidden
              onChange={(e) => { const f = e.target.files?.[0]; if (f && !uploading && !taskId) setFile(f); }} />
            <div className="big">{file ? '已选：' + file.name : '点击或拖拽上传 PDF'}</div>
            <div className="tip">{file
              ? `${(file.size / 1024 / 1024).toFixed(1)} MB，可开始导入`
              : `支持任意越剧资料 PDF · 最大 ${ocr?.maxPdfMB || 100}MB`}</div>
          </div>

          <div className="ci-field">
            <input aria-label="课程标题" disabled={!!(uploading || taskId)} value={title} onChange={(e) => setTitle(e.target.value)} placeholder="课程标题（留空则用文件名）" />
          </div>

          {!taskId && (
            <button className="ci-btn" disabled={!file || uploading || ocr?.ready !== true} onClick={doUpload}>
              {uploading ? `正在上传 PDF · ${uploadProgress}%` : '开始导入并生成课程'}
            </button>
          )}

          {(uploading || taskId) && (
            <div style={{ marginTop: 10 }}>
              <div className="ci-flow" aria-live="polite">
                <div className="ci-flow-head">
                  <b>{partial ? '课程已生成，部分资源待补充' : done ? '课程生成完成' : uploading ? '正在上传文件' : '正在生成课程'}</b>
                  <span>{partial ? '可进入课程重试未完成资源' : done ? '全部资源已整理完成' : uploading ? '上传期间请保持页面开启' : '后台处理中，返回此页可继续查看进度'}</span>
                </div>
                <div className="ci-flow-grid">
                  {PROCESS_STEPS.map((step, index) => {
                    const state = partial && index >= 4 ? '' : index < activeStep ? 'done' : index === activeStep && !done && !failed && !rejected ? 'active' : '';
                    return (
                      <div className={`ci-flow-item ${state}`} key={step.key}>
                        <i className="ci-flow-dot">{state === 'done' ? '✓' : index + 1}</i>
                        <b>{step.title}</b>
                        <span>{state === 'active' ? '正在处理…' : step.hint}</span>
                      </div>
                    );
                  })}
                </div>
              </div>
              <div className="ci-bar"><i style={{ width: `${progress}%` }} /></div>
              <div className="ci-log" aria-live="polite">
                {uploading && <span>正在上传 {file?.name}（{uploadProgress}%），大文件可安全等待更久；请保持页面开启。</span>}
                {!task && !uploading && <span>正在建立导入任务…</span>}
                {busy && <span>{task?.status === 'queued' && task?.queuePosition
                  ? `排队中，前方还有 ${Math.max(0, task.queuePosition - 1)} 个任务…`
                  : STEPS[task?.status] || '处理中…'}</span>}
                {done && <span>✔ 课程已生成</span>}
                {rejected && <span>✕ 导入未通过内容审查</span>}
                {failed && <span>✕ 导入失败：{task?.error}</span>}
                {interrupted && <span>⏸ {STEPS.interrupted}</span>}
              </div>

              {pollError && <div className="ci-verdict bad" role="status">{pollError}</div>}
              {(done || rejected) && <button className="ci-retry" onClick={resetImport}>导入另一份 PDF</button>}
              {rejected && (
                <div className="ci-verdict bad">
                  {task?.result?.verdict?.reason}<br />
                  识别到约 {task?.result?.verdict?.distinct || 0} 个越剧相关词，未达阈值。为非越剧内容，不予导入。
                </div>
              )}
              {failed && (
                <>
                  <div className="ci-verdict bad">{task?.error}</div>
                  <button className="ci-retry" onClick={resetImport}>重新尝试导入</button>
                </>
              )}
              {interrupted && (
                <>
                  <div className="ci-verdict bad">{task?.error || STEPS.interrupted}</div>
                  {task?.result?.courseId ? (
                    <Link className="ci-go" to={`/course-reader?courseId=${task.result.courseId}`}>进入已生成课程 →</Link>
                  ) : (
                    <button className="ci-resume" onClick={resumeImport}>继续导入</button>
                  )}
                  <button className="ci-retry" onClick={resetImport}>导入另一份 PDF</button>
                </>
              )}

              {uploading && <button className="ci-cancel" onClick={cancelUpload}>取消上传</button>}

              {done && task?.result && (
                <>
                  <div className="ci-verdict ok">✓ {task.result.verdict.reason}，已自动生成课程。</div>
                  <div className="ci-stats">
                    <div className="ci-stat"><b>{task.result.chapters}</b><span>章</span></div>
                    <div className="ci-stat"><b>{task.result.plan ? '✓' : '—'}</b><span>教案</span></div>
                    <div className="ci-stat"><b>{task.result.slides || '—'}</b><span>课件页</span></div>
                    <div className="ci-stat"><b>{task.result.cards}</b><span>知识卡片</span></div>
                    <div className="ci-stat">
                      <b>{task.result.graph ? task.result.graph.entities : '—'}</b>
                      <span>图谱实体{task.result.graph ? ` · ${task.result.graph.relations}关系` : ''}</span>
                    </div>
                    <div className="ci-stat"><b>{(task.result.quiz || 0) + (task.result.quizAI || 0)}</b><span>测验题（AI {task.result.quizAI || 0}）</span></div>
                  </div>
                  {!!task.result.warnings?.length && (
                    <div className="ci-verdict bad" style={{ marginTop: 12 }}>
                      {task.result.warnings.map((w: string, i: number) => <div key={i}>⚠ {w}</div>)}
                      <div style={{ marginTop: 4 }}>部分 AI 资源生成失败，可进入精读页单独重新生成。</div>
                    </div>
                  )}
                  <Link className="ci-go" to={`/course-reader?courseId=${task.result.courseId}`}>进入精读 →</Link>
                </>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
