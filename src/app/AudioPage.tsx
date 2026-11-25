import { useEffect, useRef, useState } from 'react';
import { getToken, isLoggedIn } from '../shared/auth';
import { toast } from '../shared/toast';
import type { ApiResponse } from '../shared/types';
import { AiBadge, AiNotice } from '../shared/AiLabel';

// ---------- 后端载荷 ----------
interface LyricLine {
  text: string;
}

interface SchoolItem {
  name: string;
  confidence: number;
  reason?: string;
}

interface RecognizeData {
  lyrics?: LyricLine[];
  schools?: SchoolItem[];
  fullText?: string;
  text?: string;
}

const AUDIO_EXTS = ['mp3', 'wav', 'm4a', 'flac', 'ogg'];
const MAX_SIZE = 20 * 1024 * 1024;

// FormData 上传不能走共享 request()（会把 body JSON 化），这里按旧 common.js 的方式自行 fetch
async function postForm<T>(path: string, form: FormData): Promise<ApiResponse<T>> {
  const token = getToken();
  try {
    const resp = await fetch(`/api${path}`, {
      method: 'POST',
      headers: token ? { Authorization: `Bearer ${token}` } : undefined,
      body: form,
    });
    return (await resp.json().catch(() => ({
      code: resp.status || -1,
      message: '服务器响应异常',
    }))) as ApiResponse<T>;
  } catch {
    return { code: -1, message: '网络异常，请重试', data: null as T };
  }
}

// 数字转中文（用于唱词序号）
function toChineseNum(n: number): string {
  const cn = ['一', '二', '三', '四', '五', '六', '七', '八', '九', '十'];
  if (n <= 10) return cn[n - 1];
  if (n < 20) return '十' + (n % 10 ? cn[(n % 10) - 1] : '');
  return String(n);
}

// 音韵识腔：上传越剧音频，AI 识别唱词文本与流派（自 public/js/audio.js 迁移）
export function AudioPage() {
  const [currentFile, setCurrentFile] = useState<File | null>(null);
  const [fileUrl, setFileUrl] = useState<string | null>(null);
  const [dragover, setDragover] = useState(false);
  const [recognizing, setRecognizing] = useState(false);
  const [result, setResult] = useState<RecognizeData | null>(null);

  const fileInputRef = useRef<HTMLInputElement>(null);
  const resultRef = useRef<HTMLDivElement>(null);
  const fileUrlRef = useRef<string | null>(null);

  useEffect(() => {
    document.title = '越韵智传 · 音韵识腔';
    document.body.classList.add('page-audio');
    return () => {
      document.body.classList.remove('page-audio');
      if (fileUrlRef.current) URL.revokeObjectURL(fileUrlRef.current);
    };
  }, []);

  // ---------- 上传交互 ----------
  function handleFile(file: File) {
    const ext = file.name.split('.').pop()?.toLowerCase() || '';
    if (!AUDIO_EXTS.includes(ext)) {
      toast('仅支持 mp3/wav/m4a/flac/ogg 格式', 'err');
      return;
    }
    if (file.size > MAX_SIZE) {
      toast('文件不能超过 20MB', 'err');
      return;
    }
    if (fileUrlRef.current) URL.revokeObjectURL(fileUrlRef.current);
    const url = URL.createObjectURL(file);
    fileUrlRef.current = url;
    setCurrentFile(file);
    setFileUrl(url);
    setResult(null);
  }

  // ---------- 识别 ----------
  const recognize = async () => {
    if (!currentFile) {
      toast('请先上传音频', 'err');
      return;
    }
    if (!isLoggedIn()) {
      toast('请先登录后识腔', 'err');
      return;
    }

    setRecognizing(true);
    setResult(null);

    const form = new FormData();
    form.append('audio', currentFile);

    const res = await postForm<RecognizeData>('/audio/recognize', form);

    setRecognizing(false);

    if (res.code !== 0 || !res.data) {
      toast(res.message || '识别失败', 'err');
      return;
    }

    setResult(res.data);
    toast('识腔完成', 'ok');
  };

  // 识别结果出现后平滑滚动到结果区
  useEffect(() => {
    if (result) resultRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }, [result]);

  const lyrics = result?.lyrics || [];
  const schools = result?.schools || [];

  return (
    <>
      <main className="main">
        <div className="container" style={{ paddingTop: 8 }}>
          <section className="page-hero">
            <div className="ink-wash ink-wash-1" style={{ background: 'var(--cyan)', left: '12%' }} />
            <div
              className="ink-wash ink-wash-2"
              style={{ background: 'var(--ochre)', right: '12%', opacity: 0.15 }}
            />
            <div className="hero-seal">
              <span className="seal seal-vertical">识腔</span>
            </div>
            <h1>音韵识腔 <AiBadge style={{ fontSize: 12, padding: '2px 10px' }} /></h1>
          </section>
          <AiNotice text="本页流派识别结果由人工智能声学模型比对得出，属概率性判断，识别结论仅供参考，不能替代专业听辨。" />

          {/* 上传区 */}
          <div className="scroll-frame" style={{ marginBottom: 8 }}>
            <div
              className={`upload-zone${dragover ? ' dragover' : ''}`}
              onClick={() => fileInputRef.current?.click()}
              onDragOver={(e) => {
                e.preventDefault();
                setDragover(true);
              }}
              onDragLeave={() => setDragover(false)}
              onDrop={(e) => {
                e.preventDefault();
                setDragover(false);
                if (e.dataTransfer.files.length) handleFile(e.dataTransfer.files[0]);
              }}
            >
              <div className="up-icon">乐</div>
              <div className="up-title">{currentFile ? currentFile.name : '拖拽音频至此，或点击上传'}</div>
              <div className="up-hint">支持 mp3 / wav / m4a / flac，单文件 ≤ 20MB</div>
              <div
                className="waveform"
                style={{ marginTop: 16, display: currentFile ? 'flex' : 'none' }}
              >
                <span />
                <span />
                <span />
                <span />
                <span />
                <span />
                <span />
                <span />
              </div>
              <input
                type="file"
                ref={fileInputRef}
                accept=".mp3,.wav,.m4a,.flac,.ogg"
                hidden
                onChange={(e) => {
                  if (e.target.files?.length) handleFile(e.target.files[0]);
                }}
              />
            </div>

            {currentFile && (
              <div className="audio-player">
                <audio controls src={fileUrl ?? undefined} />
                <button className="btn btn-primary btn-sm" disabled={recognizing} onClick={recognize}>
                  {recognizing ? (
                    <>
                      <span className="spinner" style={{ width: 14, height: 14, borderWidth: 2 }} /> 识别中…
                    </>
                  ) : (
                    '开始识腔'
                  )}
                </button>
              </div>
            )}
          </div>

          {/* 识别结果 */}
          {result && (
            <div className="audio-result" ref={resultRef}>
              {/* 唱词 */}
              <div className="scroll-frame">
                <div className="section-title">
                  <span className="st-text">唱词</span>
                  <span className="st-line" />
                </div>
                <div className="lyrics-scroll">
                  {lyrics.length === 0 ? (
                    <div className="knowledge-empty">
                      <div className="empty-icon">空</div>
                      <div>未识别到唱词</div>
                    </div>
                  ) : (
                    lyrics.map((line, i) => (
                      <div key={i} className="lyric-line" style={{ animationDelay: `${i * 0.05}s` }}>
                        <span className="line-no">{toChineseNum(i + 1)}</span>
                        {line.text}
                      </div>
                    ))
                  )}
                </div>
              </div>
              {/* 流派 */}
              <div className="scroll-frame">
                <div className="section-title">
                  <span className="st-text">流派</span>
                  <span className="st-line" />
                </div>
                <div className="school-list">
                  {schools.length === 0 ? (
                    <div className="knowledge-empty">
                      <div className="empty-icon">疑</div>
                      <div>无法判定流派</div>
                    </div>
                  ) : (
                    schools.map((s, i) => {
                      const pct = Math.round(s.confidence * 100);
                      const isMain = i === 0 && s.confidence > 0;
                      return (
                        <div
                          key={`${s.name}-${i}`}
                          className="school-item"
                          style={{ animation: `fadeUp 0.4s ${i * 0.1}s both` }}
                        >
                          <div
                            className="school-seal"
                            style={isMain ? undefined : { background: 'var(--ink-light)', opacity: 0.7 }}
                          >
                            {s.name.charAt(0)}
                          </div>
                          <div className="school-info">
                            <div className="school-name">
                              {s.name}
                              {isMain && (
                                <span className="tag tag-cinnabar" style={{ fontSize: 11, marginLeft: 6 }}>
                                  主要判定
                                </span>
                              )}
                            </div>
                            <div className="school-bar">
                              <div className="school-bar-fill" style={{ width: `${pct}%` }} />
                            </div>
                            <div className="school-conf">置信度 {pct}%</div>
                            {s.reason && <div className="school-reason">{s.reason}</div>}
                          </div>
                        </div>
                      );
                    })
                  )}
                </div>
              </div>
            </div>
          )}
        </div>
      </main>
    </>
  );
}
