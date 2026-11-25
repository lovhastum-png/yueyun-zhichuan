(function exposeYuejuMotionRecognition(global) {
  'use strict';

  const MEDIAPIPE_ROOT = 'https://cdn.jsdelivr.net/npm/@mediapipe/pose@0.5.1675469404';
  const MEDIAPIPE_SCRIPT = `${MEDIAPIPE_ROOT}/pose.js`;
  const GESTURES = {
    water: { label: '水袖抛扬', hint: '双臂上扬过头顶，如将水袖抛出' },
    cloud: { label: '双山膀展袖', hint: '双臂向两侧平展拉开，如山膀定式' },
    orchid: { label: '兰指顾盼', hint: '双手收拢胸前，兰花指轻搭回腕' },
    salute: { label: '托按掌亮相', hint: '一手上托过顶，一手下按胸前，稳住亮相' }
  };
  const SKELETON = [[11, 12], [11, 13], [13, 15], [12, 14], [14, 16], [11, 23], [12, 24], [23, 24]];
  // 决策参数：评分阈值 / 领先幅度 / 稳定帧数 / 同动作冷却
  const FIRE_SCORE = 0.62;
  const FIRE_MARGIN = 0.1;
  const FIRE_FRAMES = 4;
  const REFIRE_COOLDOWN = 1500;
  const NEUTRAL_SCORE = 0.32;
  const NEUTRAL_FRAMES = 8;
  let libraryPromise = null;

  const clamp01 = (value) => Math.min(1, Math.max(0, value));
  // 线性爬升：value ≤ start 记 0 分，≥ end 记满分
  function ramp(value, start, end) {
    if (end <= start) return value >= end ? 1 : 0;
    return clamp01((value - start) / (end - start));
  }
  // 带缓冲的区间隶属：落在 [low, high] 内记满分，向外线性衰减
  function band(value, low, high, feather) {
    const inner = ramp(value, low, low + feather) * (1 - ramp(value, high - feather, high));
    return clamp01(inner);
  }

  function distance(a, b) {
    return Math.hypot(a.x - b.x, a.y - b.y);
  }

  function visible(point, threshold = 0.42) {
    return Boolean(point) && (point.visibility ?? 1) >= threshold;
  }

  // 肘部内角（肩-肘-腕），手臂伸直趋近 π
  function elbowAngle(shoulder, elbow, wrist) {
    const ax = shoulder.x - elbow.x;
    const ay = shoulder.y - elbow.y;
    const bx = wrist.x - elbow.x;
    const by = wrist.y - elbow.y;
    const denom = (Math.hypot(ax, ay) * Math.hypot(bx, by)) || 1e-6;
    const cosine = Math.min(1, Math.max(-1, (ax * bx + ay * by) / denom));
    return Math.acos(cosine);
  }

  function extractUpperBodyPose(landmarks) {
    if (!landmarks) return null;
    const required = [11, 12, 13, 14, 15, 16];
    if (!required.every((index) => visible(landmarks[index], 0.35))) return null;
    const leftShoulder = landmarks[11];
    const rightShoulder = landmarks[12];
    const shoulderWidth = distance(leftShoulder, rightShoulder);
    if (shoulderWidth < 0.045) return null;
    const center = {
      x: (leftShoulder.x + rightShoulder.x) * 0.5,
      y: (leftShoulder.y + rightShoulder.y) * 0.5,
      z: ((leftShoulder.z || 0) + (rightShoulder.z || 0)) * 0.5
    };
    const normalize = (point) => ({
      x: (point.x - center.x) / shoulderWidth,
      y: (point.y - center.y) / shoulderWidth,
      z: ((point.z || 0) - center.z) / shoulderWidth
    });
    return {
      left: { shoulder: normalize(leftShoulder), elbow: normalize(landmarks[13]), wrist: normalize(landmarks[15]) },
      right: { shoulder: normalize(rightShoulder), elbow: normalize(landmarks[14]), wrist: normalize(landmarks[16]) },
      nose: visible(landmarks[0], 0.3) ? normalize(landmarks[0]) : null,
      shoulderTilt: (leftShoulder.y - rightShoulder.y) / shoulderWidth
    };
  }

  // ===== 连续评分制：把四个参考动作各自的几何特征映射到 0~1 分 =====
  function scoreGestures(landmarks) {
    if (!landmarks) return null;
    const leftShoulder = landmarks[11];
    const rightShoulder = landmarks[12];
    const leftElbow = landmarks[13];
    const rightElbow = landmarks[14];
    const leftWrist = landmarks[15];
    const rightWrist = landmarks[16];
    const leftHip = landmarks[23];
    const rightHip = landmarks[24];
    if (![leftShoulder, rightShoulder, leftWrist, rightWrist].every((point) => visible(point))) return null;

    const shoulderWidth = distance(leftShoulder, rightShoulder);
    if (shoulderWidth < 0.045) return null;
    const shoulderY = (leftShoulder.y + rightShoulder.y) * 0.5;
    const hipY = visible(leftHip, 0.25) && visible(rightHip, 0.25)
      ? (leftHip.y + rightHip.y) * 0.5
      : shoulderY + shoulderWidth * 1.55;
    const torso = Math.max(shoulderWidth, hipY - shoulderY);

    // 手腕相对肩线的高度（>0 即手腕在肩线上方，按躯干高度归一）
    const leftH = (shoulderY - leftWrist.y) / torso;
    const rightH = (shoulderY - rightWrist.y) / torso;
    const minH = Math.min(leftH, rightH);
    const highH = Math.max(leftH, rightH);
    const lowH = -Math.min(leftH, rightH); // 较低那只手沉到肩线下多深
    const levelGap = Math.abs(leftH - rightH);
    const wristSpan = distance(leftWrist, rightWrist) / shoulderWidth;
    const wristMidH = (shoulderY - (leftWrist.y + rightWrist.y) * 0.5) / torso;
    const elbowsTracked = visible(leftElbow, 0.28) && visible(rightElbow, 0.28);
    const elbowSpan = elbowsTracked ? distance(leftElbow, rightElbow) / shoulderWidth : 0;
    const minElbowAngle = elbowsTracked
      ? Math.min(
          elbowAngle(leftShoulder, leftElbow, leftWrist),
          elbowAngle(rightShoulder, rightElbow, rightWrist)
        )
      : Math.PI * 0.75;

    const scores = {
      // 水袖抛扬（双扬袖）：双手同时高举过头，手臂偏伸直加分
      water: clamp01(
        ramp(minH, 0.16, 0.58) * (0.62 + 0.38 * ramp(minElbowAngle, 2.1, 2.85))
      ),
      // 双山膀：双臂向两侧拉开成弧——腕距拉满、双手都保持在肩带高度
      // （较低那只手不得沉过胸口太多，与「托按掌」的一高一低区分开）
      cloud: clamp01(
        ramp(wristSpan, 1.5, 2.25) * band(wristMidH, -0.5, 0.45, 0.45) * (0.6 + 0.4 * ramp(elbowSpan, 1.1, 1.6)) * ramp(minH, -0.55, -0.2)
      ),
      // 兰指顾盼：双腕收拢在胸前到下巴之间（单手外伸「顾盼」时腕距可达
      // ~0.7 肩宽，间距因子放宽容忍；高度带覆盖胸口略低于肩线的位置）
      orchid: clamp01(
        // 双手靠近并不等于兰指：还要落在胸前至下巴的“手位”，且双肘
        // 不能完全打直。这样可避免抱拳、双手过头等普通姿势被误判。
        ramp(1.0 - wristSpan, 0.0, 0.4)
          * band(wristMidH, -0.75, 0.28, 0.25)
          * band(minElbowAngle, 0.7, 2.45, 0.35)
      ),
      // 托按掌亮相：一手上托、一手下按，明显错层且横向拉开
      salute: clamp01(
        ramp(levelGap, 0.32, 0.75) * ramp(highH, 0.05, 0.3) * ramp(lowH, 0.1, 0.42) * ramp(wristSpan, 0.85, 1.25)
      )
    };
    return scores;
  }

  function pickGesture(scores) {
    if (!scores) return null;
    const entries = Object.entries(scores).sort((a, b) => b[1] - a[1]);
    const [topName, topScore] = entries[0];
    const secondScore = entries[1]?.[1] ?? 0;
    if (topScore >= FIRE_SCORE && topScore - secondScore >= FIRE_MARGIN) return topName;
    return null;
  }

  // 兼容旧接口：单帧直接判定
  function classifyGesture(landmarks) {
    return pickGesture(scoreGestures(landmarks));
  }

  // ===== 参考小人：四个参考身段的连贯动画（多关键帧 + 平滑插值） =====
  // 关键点布局与 MediaPipe 一致：左右肩/肘/腕 + 左右髋（归一化坐标，y 轴向下）。
  // 每个动作由 3~5 个关键帧组成一个循环：小人真正「做出」这段身段，
  // 而不是定格摆姿——起势 → 定式（停留）→ 回势，符合戏曲身段示范习惯。
  const GUIDE_FRAME_MS = 430;  // 每个关键帧的播放时长（关键帧间平滑插值）
  const GUIDE_POSES = {
    water: {
      label: '水袖抛扬',
      sway: { axis: 'y', amp: 0.012, speed: 2.0 }, // 定式处双腕轻送，如抛袖余韵
      // 双扬袖：双手自胸前经体侧上扬过头顶（抛袖）
      frames: [
        { shoulders: [[0.40, 0.32], [0.60, 0.32]], elbows: [[0.35, 0.47], [0.65, 0.47]], wrists: [[0.44, 0.46], [0.56, 0.46]], hips: [[0.43, 0.62], [0.57, 0.62]] },
        { shoulders: [[0.40, 0.32], [0.60, 0.32]], elbows: [[0.30, 0.36], [0.70, 0.36]], wrists: [[0.32, 0.22], [0.68, 0.22]], hips: [[0.43, 0.62], [0.57, 0.62]] },
        { shoulders: [[0.40, 0.32], [0.60, 0.32]], elbows: [[0.35, 0.18], [0.65, 0.18]], wrists: [[0.41, 0.06], [0.59, 0.06]], hips: [[0.43, 0.62], [0.57, 0.62]] },
        { shoulders: [[0.40, 0.32], [0.60, 0.32]], elbows: [[0.35, 0.16], [0.65, 0.16]], wrists: [[0.40, 0.03], [0.60, 0.03]], hips: [[0.43, 0.62], [0.57, 0.62]] },
        { shoulders: [[0.40, 0.32], [0.60, 0.32]], elbows: [[0.35, 0.17], [0.65, 0.17]], wrists: [[0.405, 0.045], [0.595, 0.045]], hips: [[0.43, 0.62], [0.57, 0.62]] }
      ]
    },
    cloud: {
      label: '双山膀展袖',
      sway: { axis: 'x', amp: 0.02, speed: 1.4 }, // 拉开后双臂的呼吸感
      // 双山膀：双手胸前合抱 → 向两侧缓缓拉开成弧，如拉满弓定式
      frames: [
        { shoulders: [[0.40, 0.32], [0.60, 0.32]], elbows: [[0.37, 0.47], [0.63, 0.47]], wrists: [[0.46, 0.44], [0.54, 0.44]], hips: [[0.43, 0.62], [0.57, 0.62]] },
        { shoulders: [[0.40, 0.32], [0.60, 0.32]], elbows: [[0.31, 0.40], [0.69, 0.40]], wrists: [[0.24, 0.36], [0.76, 0.36]], hips: [[0.43, 0.62], [0.57, 0.62]] },
        { shoulders: [[0.40, 0.32], [0.60, 0.32]], elbows: [[0.26, 0.36], [0.74, 0.36]], wrists: [[0.13, 0.33], [0.87, 0.33]], hips: [[0.43, 0.62], [0.57, 0.62]] },
        { shoulders: [[0.40, 0.32], [0.60, 0.32]], elbows: [[0.26, 0.36], [0.74, 0.36]], wrists: [[0.12, 0.34], [0.88, 0.34]], hips: [[0.43, 0.62], [0.57, 0.62]] },
        { shoulders: [[0.40, 0.32], [0.60, 0.32]], elbows: [[0.26, 0.36], [0.74, 0.36]], wrists: [[0.13, 0.33], [0.87, 0.33]], hips: [[0.43, 0.62], [0.57, 0.62]] }
      ]
    },
    orchid: {
      label: '兰指顾盼',
      sway: { axis: 'y', amp: 0.01, speed: 2.6 },
      // 兰指顾盼：双手收拢胸前，左右手交替向外轻点（指法回腕）
      frames: [
        { shoulders: [[0.40, 0.32], [0.60, 0.32]], elbows: [[0.38, 0.49], [0.62, 0.49]], wrists: [[0.46, 0.42], [0.54, 0.42]], hips: [[0.43, 0.62], [0.57, 0.62]] },
        { shoulders: [[0.40, 0.32], [0.60, 0.32]], elbows: [[0.39, 0.48], [0.63, 0.46]], wrists: [[0.465, 0.40], [0.60, 0.37]], hips: [[0.43, 0.62], [0.57, 0.62]] },
        { shoulders: [[0.40, 0.32], [0.60, 0.32]], elbows: [[0.38, 0.49], [0.62, 0.49]], wrists: [[0.46, 0.42], [0.53, 0.43]], hips: [[0.43, 0.62], [0.57, 0.62]] },
        { shoulders: [[0.40, 0.32], [0.60, 0.32]], elbows: [[0.37, 0.48], [0.61, 0.46]], wrists: [[0.40, 0.38], [0.535, 0.40]], hips: [[0.43, 0.62], [0.57, 0.62]] },
        { shoulders: [[0.40, 0.32], [0.60, 0.32]], elbows: [[0.38, 0.49], [0.62, 0.49]], wrists: [[0.46, 0.42], [0.54, 0.42]], hips: [[0.43, 0.62], [0.57, 0.62]] }
      ]
    },
    salute: {
      label: '托按掌亮相',
      sway: { axis: 'y', amp: 0.014, speed: 1.2 }, // 亮相机架的缓起缓落
      // 托按掌：右手托掌上举过顶、左手按掌压于胸前，起势后定住亮相
      frames: [
        { shoulders: [[0.40, 0.32], [0.60, 0.32]], elbows: [[0.37, 0.47], [0.63, 0.47]], wrists: [[0.45, 0.44], [0.55, 0.44]], hips: [[0.43, 0.62], [0.57, 0.62]] },
        { shoulders: [[0.40, 0.32], [0.60, 0.32]], elbows: [[0.35, 0.22], [0.63, 0.48]], wrists: [[0.33, 0.10], [0.62, 0.54]], hips: [[0.43, 0.62], [0.57, 0.62]] },
        { shoulders: [[0.40, 0.32], [0.60, 0.32]], elbows: [[0.34, 0.17], [0.64, 0.50]], wrists: [[0.31, 0.05], [0.63, 0.57]], hips: [[0.43, 0.62], [0.57, 0.62]] },
        { shoulders: [[0.40, 0.32], [0.60, 0.32]], elbows: [[0.34, 0.16], [0.64, 0.50]], wrists: [[0.30, 0.03], [0.64, 0.58]], hips: [[0.43, 0.62], [0.57, 0.62]] },
        { shoulders: [[0.40, 0.32], [0.60, 0.32]], elbows: [[0.34, 0.17], [0.64, 0.50]], wrists: [[0.31, 0.045], [0.635, 0.57]], hips: [[0.43, 0.62], [0.57, 0.62]] }
      ]
    }
  };

  // 在给定 2D 上下文里绘制参考小人（timeSeconds 驱动连贯动作循环）
  function drawReferencePose(context, width, height, name, timeSeconds = 0) {
    const pose = GUIDE_POSES[name];
    if (!pose || !context) return false;

    // 多关键帧平滑插值（smoothstep 缓动）：小人连贯地做出整段身段
    let shoulders, elbows, wrists, hips;
    const sway = pose.sway || { axis: 'y', amp: 0, speed: 1 };
    const offset = Math.sin(timeSeconds * sway.speed) * sway.amp;
    if (Array.isArray(pose.frames) && pose.frames.length > 1) {
      const n = pose.frames.length;
      const tPos = ((timeSeconds * 1000) / GUIDE_FRAME_MS) % n;
      const i0 = Math.floor(tPos) % n;
      const i1 = (i0 + 1) % n;
      const k = tPos - Math.floor(tPos);
      const e = k * k * (3 - 2 * k);
      const a = pose.frames[i0];
      const b = pose.frames[i1];
      const lerp = (pa, pb) => pa.map((p, idx) => [
        p[0] + (pb[idx][0] - p[0]) * e,
        p[1] + (pb[idx][1] - p[1]) * e
      ]);
      shoulders = lerp(a.shoulders, b.shoulders);
      elbows = lerp(a.elbows, b.elbows);
      hips = lerp(a.hips, b.hips);
      // 腕部叠加呼吸摆动（抛袖余韵 / 山膀呼吸感）
      wrists = lerp(a.wrists, b.wrists).map(([x, y], index) => [
        x + (sway.axis === 'x' ? (index === 0 ? offset : -offset) : 0),
        y + (sway.axis === 'y' ? offset : 0)
      ]);
    } else {
      // 兼容旧版静态字段
      shoulders = pose.shoulders;
      elbows = pose.elbows;
      hips = pose.hips;
      wrists = pose.wrists.map(([x, y], index) => [
        x + (sway.axis === 'x' ? (index === 0 ? offset : -offset) : 0),
        y + (sway.axis === 'y' ? offset : 0)
      ]);
    }
    const px = (point) => point[0] * width;
    const py = (point) => point[1] * height;

    context.clearRect(0, 0, width, height);
    context.lineCap = 'round';
    context.lineJoin = 'round';
    context.lineWidth = Math.max(2.4, width / 30);
    context.strokeStyle = '#e9c377';

    // 躯干与肩线、髋线
    context.beginPath();
    context.moveTo(px(shoulders[0]), py(shoulders[0]));
    context.lineTo(px(shoulders[1]), py(shoulders[1]));
    const midShoulder = [(shoulders[0][0] + shoulders[1][0]) / 2, (shoulders[0][1] + shoulders[1][1]) / 2];
    const midHip = [(hips[0][0] + hips[1][0]) / 2, (hips[0][1] + hips[1][1]) / 2];
    context.moveTo(px(midShoulder), py(midShoulder));
    context.lineTo(px(midHip), py(midHip));
    context.moveTo(px(hips[0]), py(hips[0]));
    context.lineTo(px(hips[1]), py(hips[1]));
    // 双臂：肩 → 肘 → 腕
    elbows.forEach((elbow, index) => {
      const shoulder = shoulders[index];
      const wrist = wrists[index];
      context.moveTo(px(shoulder), py(shoulder));
      context.lineTo(px(elbow), py(elbow));
      context.lineTo(px(wrist), py(wrist));
    });
    context.stroke();

    // 头部
    const headR = width * 0.075;
    context.beginPath();
    context.arc(width / 2, height * 0.155, headR, 0, Math.PI * 2);
    context.fillStyle = 'rgba(13, 18, 16, 0.55)';
    context.fill();
    context.stroke();

    // 双腕点睛（朱砂）
    context.fillStyle = '#c8553f';
    wrists.forEach((wrist) => {
      context.beginPath();
      context.arc(px(wrist), py(wrist), Math.max(2.2, width / 40), 0, Math.PI * 2);
      context.fill();
    });
    return true;
  }

  function loadLibrary() {
    if (typeof global.Pose === 'function') return Promise.resolve();
    if (libraryPromise) return libraryPromise;
    libraryPromise = new Promise((resolve, reject) => {
      const script = document.createElement('script');
      script.src = MEDIAPIPE_SCRIPT;
      script.async = true;
      script.crossOrigin = 'anonymous';
      script.onload = resolve;
      script.onerror = () => {
        libraryPromise = null;
        reject(new Error('人体动作识别组件加载失败，请检查网络后重试。'));
      };
      document.head.appendChild(script);
    });
    return libraryPromise;
  }

  function create(options) {
    const video = options.video;
    const canvas = options.canvas;
    const context = canvas.getContext('2d');
    const state = {
      active: false,
      processing: false,
      stream: null,
      pose: null,
      token: 0,
      smoothed: { water: 0, cloud: 0, orchid: 0, salute: 0 },
      candidate: null,
      stableFrames: 0,
      lastFired: null,
      lastFiredAt: 0,
      neutralFrames: 0,
      frames: 0,
      fpsStartedAt: performance.now()
    };

    const emitState = (mode, message) => options.onState?.({ active: state.active, mode, message });

    function drawLandmarks(landmarks) {
      const width = canvas.width;
      const height = canvas.height;
      context.clearRect(0, 0, width, height);
      if (!landmarks) return;
      context.lineCap = 'round';
      context.lineJoin = 'round';
      context.lineWidth = Math.max(2, width / 150);
      context.strokeStyle = 'rgba(235, 202, 126, 0.88)';
      SKELETON.forEach(([from, to]) => {
        const a = landmarks[from];
        const b = landmarks[to];
        if (!visible(a, 0.25) || !visible(b, 0.25)) return;
        context.beginPath();
        context.moveTo(a.x * width, a.y * height);
        context.lineTo(b.x * width, b.y * height);
        context.stroke();
      });
      context.fillStyle = '#b8323d';
      [11, 12, 13, 14, 15, 16, 23, 24].forEach((index) => {
        const point = landmarks[index];
        if (!visible(point, 0.25)) return;
        context.beginPath();
        context.arc(point.x * width, point.y * height, Math.max(3, width / 90), 0, Math.PI * 2);
        context.fill();
      });
    }

    function processGesture(landmarks) {
      const raw = scoreGestures(landmarks);
      // 指数平滑：单帧抖动不至于让分值条闪烁
      for (const name of Object.keys(state.smoothed)) {
        const value = raw?.[name] ?? 0;
        state.smoothed[name] = state.smoothed[name] * 0.55 + value * 0.45;
      }
      options.onScores?.({ ...state.smoothed });

      const gesture = pickGesture(state.smoothed);
      if (!gesture) {
        state.candidate = null;
        state.stableFrames = 0;
        state.neutralFrames += 1;
        const allCool = Object.values(state.smoothed).every((score) => score < NEUTRAL_SCORE);
        if (allCool && state.neutralFrames >= NEUTRAL_FRAMES) {
          state.lastFired = null; // 完全放手后允许再次触发同一动作
          options.onCandidate?.(null, GESTURES);
        }
        return;
      }
      state.neutralFrames = 0;
      if (state.candidate === gesture) state.stableFrames += 1;
      else {
        state.candidate = gesture;
        state.stableFrames = 1;
      }
      options.onCandidate?.(gesture, GESTURES);

      const now = performance.now();
      const cooled = state.lastFired !== gesture || now - state.lastFiredAt >= REFIRE_COOLDOWN;
      if (state.stableFrames >= FIRE_FRAMES && cooled) {
        state.lastFired = gesture;
        state.lastFiredAt = now;
        state.stableFrames = 0;
        options.onGesture?.(gesture, GESTURES[gesture]);
      }
    }

    function handleResults(results) {
      if (!state.active) return;
      drawLandmarks(results.poseLandmarks);
      options.onPose?.(extractUpperBodyPose(results.poseLandmarks));
      processGesture(results.poseLandmarks);
      state.frames += 1;
      const now = performance.now();
      const elapsed = now - state.fpsStartedAt;
      if (elapsed >= 1000) {
        options.onMetrics?.({ fps: Math.round(state.frames * 1000 / elapsed) });
        state.frames = 0;
        state.fpsStartedAt = now;
      }
    }

    async function initPose() {
      await loadLibrary();
      if (typeof global.Pose !== 'function') throw new Error('人体动作识别组件未能初始化。');
      const pose = new global.Pose({ locateFile: (file) => `${MEDIAPIPE_ROOT}/${file}` });
      pose.setOptions({
        modelComplexity: 1, // 提高一档模型精度，关键点更稳
        smoothLandmarks: true,
        enableSegmentation: false,
        minDetectionConfidence: 0.55,
        minTrackingConfidence: 0.6
      });
      pose.onResults(handleResults);
      if (typeof pose.initialize === 'function') await pose.initialize();
      state.pose = pose;
    }

    async function openCamera() {
      if (!navigator.mediaDevices?.getUserMedia) {
        throw new Error('当前浏览器不支持摄像头动作识别。');
      }
      state.stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: 'user', width: { ideal: 640 }, height: { ideal: 360 }, frameRate: { ideal: 24, max: 24 } },
        audio: false
      });
      video.srcObject = state.stream;
      await video.play();
      await new Promise((resolve) => {
        if (video.readyState >= 2 && video.videoWidth) resolve();
        else video.addEventListener('loadedmetadata', resolve, { once: true });
      });
      canvas.width = video.videoWidth || 640;
      canvas.height = video.videoHeight || 360;
    }

    function launchLoop() {
      const token = ++state.token;
      const step = async () => {
        if (!state.active || token !== state.token) return;
        if (!state.processing && video.readyState >= 2 && state.pose) {
          state.processing = true;
          try { await state.pose.send({ image: video }); }
          catch (error) { options.onError?.(error); }
          finally { state.processing = false; }
        }
        if (!state.active || token !== state.token) return;
        if ('requestVideoFrameCallback' in video) video.requestVideoFrameCallback(step);
        else requestAnimationFrame(step);
      };
      if ('requestVideoFrameCallback' in video) video.requestVideoFrameCallback(step);
      else requestAnimationFrame(step);
    }

    async function start() {
      if (state.active) return;
      state.active = true;
      emitState('loading', '正在请求镜头并加载动作识别');
      try {
        await Promise.all([openCamera(), initPose()]);
        state.fpsStartedAt = performance.now();
        emitState('active', '请站到镜头前，露出肩、肘和手腕');
        launchLoop();
      } catch (error) {
        await stop(false);
        emitState('error', error?.name === 'NotAllowedError'
          ? '摄像头权限未开启，请允许后重试'
          : (error?.message || '动作识别暂时不可用'));
        throw error;
      }
    }

    async function stop(announce = true) {
      state.active = false;
      state.token += 1;
      state.processing = false;
      state.stream?.getTracks().forEach((track) => track.stop());
      state.stream = null;
      video.srcObject = null;
      if (state.pose && typeof state.pose.close === 'function') {
        try { await state.pose.close(); } catch (_) { /* already released */ }
      }
      state.pose = null;
      state.candidate = null;
      state.lastFired = null;
      state.stableFrames = 0;
      state.neutralFrames = 0;
      state.smoothed = { water: 0, cloud: 0, orchid: 0, salute: 0 };
      context.clearRect(0, 0, canvas.width, canvas.height);
      options.onPose?.(null);
      options.onScores?.({ ...state.smoothed });
      if (announce) emitState('idle', '体感跟演已关闭');
    }

    return { start, stop, get active() { return state.active; } };
  }

  global.YuejuMotionRecognition = {
    create,
    classifyGesture,
    extractUpperBodyPose,
    scoreGestures,
    drawReferencePose,
    guidePoses: GUIDE_POSES,
    gestures: GESTURES
  };
})(window);
