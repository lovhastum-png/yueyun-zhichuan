/* Shared player: production stage and building preview. Never autoplays. */
(() => {
  const host = document.querySelector('[data-opera-audio]');
  if (!host) return;
  host.innerHTML = `
    <div class="opera-audio-heading"><span>听越剧</span><span class="opera-audio-state" role="status">点击播放</span></div>
    <div class="opera-audio-main"><button type="button" class="opera-audio-play" aria-label="播放越剧" aria-pressed="false">▶</button><div class="opera-audio-title"><strong>天上掉下个林妹妹</strong><span>陈飞、周燕萍 · 约 1 分钟</span></div></div>
    <details class="opera-audio-options"><summary>进度与音量</summary>
      <label class="opera-audio-progress"><span class="opera-audio-time">0:00 / 1:01</span><input type="range" min="0" max="100" step="0.1" value="0" aria-label="越剧播放进度" disabled></label>
      <label class="opera-audio-volume">音量<input type="range" min="0" max="100" step="1" value="55" aria-label="越剧音量"><output>55%</output></label>
      <div class="opera-audio-credit"><label><input type="checkbox" aria-label="循环播放越剧">循环播放</label><a href="https://news.gxtv.cn/article/detail_5d45ff5c1b8f43e08b88dc9275cf17bb.html" target="_blank" rel="noopener noreferrer">音源 · 广西网络广播电视台 ↗</a></div>
    </details><audio preload="metadata" src="/assets/3d-stage/audio/lin-meimei-excerpt.mp3"></audio>`;
  const audio = host.querySelector('audio'), play = host.querySelector('.opera-audio-play');
  const state = host.querySelector('.opera-audio-state'), time = host.querySelector('.opera-audio-time');
  const progress = host.querySelector('.opera-audio-progress input'), volume = host.querySelector('.opera-audio-volume input');
  const loop = host.querySelector('[type="checkbox"]'), output = host.querySelector('output');
  const format = value => `${Math.floor(value / 60)}:${String(Math.floor(value % 60)).padStart(2, '0')}`;
  function updateTime() {
    if (!Number.isFinite(audio.duration) || audio.duration <= 0) return;
    progress.disabled = false;
    progress.value = String(audio.currentTime / audio.duration * 100);
    time.textContent = `${format(audio.currentTime)} / ${format(audio.duration)}`;
    progress.setAttribute('aria-valuetext', time.textContent);
  }
  function updatePlayback() {
    const playing = !audio.paused;
    play.textContent = playing ? 'Ⅱ' : '▶';
    play.setAttribute('aria-label', playing ? '暂停越剧' : '播放越剧');
    play.setAttribute('aria-pressed', String(playing));
    host.classList.toggle('is-playing', playing);
    state.textContent = audio.ended ? '播放结束' : playing ? '正在播放' : '已暂停';
  }
  audio.volume = .55;
  play.addEventListener('click', async () => {
    if (!audio.paused) { audio.pause(); return; }
    state.textContent = '正在加载…';
    play.disabled = true;
    try { await audio.play(); } catch { state.textContent = '播放失败，点击重试'; }
    finally { play.disabled = false; }
  });
  for (const event of ['loadedmetadata', 'timeupdate']) audio.addEventListener(event, updateTime);
  for (const event of ['play', 'playing', 'pause', 'ended']) audio.addEventListener(event, updatePlayback);
  audio.addEventListener('waiting', () => { if (!audio.paused) state.textContent = '正在缓冲…'; });
  audio.addEventListener('error', () => { state.textContent = '音频加载失败，点击重试'; });
  progress.addEventListener('input', () => {
    if (Number.isFinite(audio.duration)) audio.currentTime = Number(progress.value) / 100 * audio.duration;
    updateTime();
  });
  volume.addEventListener('input', () => { audio.volume = Number(volume.value) / 100; output.value = `${volume.value}%`; });
  loop.addEventListener('change', () => { audio.loop = loop.checked; });
  // Navigating away stops sound. Returning to the page never starts it by itself.
  addEventListener('pagehide', () => audio.pause());
})();
