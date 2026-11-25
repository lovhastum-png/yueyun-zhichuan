/* ============================================================
   虚拟越剧老师 · 3D VRM + 口型同步 + RAG 语音问答
   ============================================================ */
(function () {
  initPage('teacher');

  // ========== DOM ==========
  const canvas = document.getElementById('teacherCanvas');
  const stageLoading = document.getElementById('stageLoading');
  const teacherBubble = document.getElementById('teacherBubble');
  const emojiBubble = document.getElementById('emojiBubble');
  const statusDot = document.getElementById('statusDot');
  const statusText = document.getElementById('statusText');
  const chatHistory = document.getElementById('chatHistory');
  const msgInput = document.getElementById('msgInput');
  const sendBtn = document.getElementById('sendBtn');
  const exampleQs = document.getElementById('exampleQs');
  const voiceToggle = document.getElementById('voiceToggle');
  const btnVoice = document.getElementById('btnVoice');
  const btnStopVoice = document.getElementById('btnStopVoice');
  const btnRotate = document.getElementById('btnRotate');

  // ========== 状态 ==========
  let voiceEnabled = true;
  let isSpeaking = false;
  let isThinking = false;
  let autoRotate = false;
  // 多轮会话：持久化保存后端下发的 sessionId，保证同一会话内的上下文连续
  let sessionId = localStorage.getItem('teacherSessionId') || null;

  // ========== 3D 相关 ==========
  let scene, camera, renderer, vrm, expressionManager, mixer;
  let lastTime = performance.now();
  // 渲染性能控制：后台暂停 / 静置降分辨率 / 活跃时拉高
  let renderRunning = true;      // 是否处于渲染循环中
  let pageVisible = !document.hidden;
  let highQuality = false;       // 说话/倾听/思考等活跃时是否用高清晰度
  // 自然度：固定周期眨眼 + 呼吸 + 被点互动
  let blinkTimer = 0;            // 眨眼相位计时（固定周期 4.6s）
  let pokeAt = 0;                // 被点击致意的时间戳（ms），0 表示未触发

  // ===== 情绪表情系统 =====
  // 模型支持的情绪表情（VRM 映射）：happy(joy)/relaxed(fun)/angry/sad/surprised
  let moodName = 'relaxed';      // 当前目标情绪表情名
  let moodWeight = 0.25;         // 当前目标权重 0~1
  let moodCur = 0.25;            // 当前实际权重（平滑过渡用）
  let pokeMoodTimer = null;      // 被点后开心表情的恢复定时器

  // ===== 预置动作系统 =====
  // action: 'angry'(生气摆手) | null
  let action = null;
  let actionStart = 0;         // 动作开始时间戳（ms）
  let angryCount = 0;          // 连续点击计数（达到阈值触发生气）
  let lastClickAt = 0;         // 最近一次点击时间（ms）
  // 口型动画状态（由 onboundary 真实发音时序驱动）
  const lipSync = {
    active: false,
    lastActivity: 0,   // 最近一次真实发声边界的时间戳（ms）
    visemes: ['aa', 'ih', 'ou', 'ee', 'oh'],
  };
  // 字幕状态
  let speakSeq = [];      // 当前整段回答分句序列 [{ text, start }]
  const subtitleEl = document.getElementById('teacherSubtitle');

  // ========== 性能：统一加载轻量模型 ==========
  // 桌面端与低端设备均加载轻量 fast 模型（含 .br 压缩，仅约 3MB），显著加快首屏；
  // 如需更高画质可改回 yueju-base.web.vrm（已生成 .br，约 13.8MB）。
  function pickModelPath() {
    return '/assets/3d-stage/vroid/yueju-base.fast.vrm?v=20260820';
  }

  // 是否为低端设备（用于降低渲染倍率）
  function isLowEndDevice() {
    const isMobile = /Android|iPhone|iPad|iPod|Mobile/i.test(navigator.userAgent)
      || (window.matchMedia && matchMedia('(pointer: coarse)').matches)
      || (window.innerWidth <= 768);
    const weakCPU = navigator.hardwareConcurrency && navigator.hardwareConcurrency <= 4;
    const lowMem = navigator.deviceMemory && navigator.deviceMemory <= 4;
    return isMobile || weakCPU || lowMem;
  }

  // 初始化 3D 场景
  function init3D() {
    const { THREE, GLTFLoader, VRMLoaderPlugin, VRMUtils } = window.Yueju3D || {};
    if (!THREE || !GLTFLoader || !VRMLoaderPlugin || !VRMUtils) {
      stageLoading.innerHTML = '<div class="loader-content"><div class="loader-text" style="color:var(--cinnabar)">3D 运行库未加载，请刷新重试</div></div>';
      return;
    }

    // 场景
    scene = new THREE.Scene();

    // 相机（半身像视角）
    const w = canvas.clientWidth || 1, h = canvas.clientHeight || 1;
    camera = new THREE.PerspectiveCamera(38, w / h, 0.1, 100);
    camera.position.set(0, 1.35, 3.6);
    camera.lookAt(0, 1.25, 0);

    // 渲染器（低端设备同时关闭抗锯齿，进一步降低 GPU 负担）
    renderer = new THREE.WebGLRenderer({ canvas, antialias: !isLowEndDevice(), alpha: true });
    // 低端设备降低渲染倍率，提升流畅度
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, isLowEndDevice() ? 1 : 2));
    renderer.setSize(w, h, false);
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.0;

    // 灯光（柔和的舞台光）
    const ambient = new THREE.AmbientLight(0xfff5e8, 0.7);
    scene.add(ambient);
    const keyLight = new THREE.DirectionalLight(0xffffff, 0.9);
    keyLight.position.set(1, 2, 2);
    scene.add(keyLight);
    const fillLight = new THREE.DirectionalLight(0xa8c8c0, 0.4);
    fillLight.position.set(-1, 1, 1.5);
    scene.add(fillLight);
    const rimLight = new THREE.DirectionalLight(0xffd0a0, 0.3);
    rimLight.position.set(0, 1.5, -2);
    scene.add(rimLight);

    // 加载 VRM 模型 + 服装层
    const vrmLoader = new GLTFLoader();
    vrmLoader.register((parser) => new VRMLoaderPlugin(parser));

    vrmLoader.load(
      pickModelPath(),
      (gltf) => {
        try {
          vrm = gltf.userData.vrm;
          if (!vrm) throw new Error('文件中未找到 VRM 人形数据');

          if (typeof VRMUtils.rotateVRM0 === 'function') VRMUtils.rotateVRM0(vrm);
          const model = vrm.scene;
          model.name = 'Yueju_Teacher_Base';

          // 遍历处理材质
          model.traverse((object) => {
            if (!object.isMesh) return;
            object.frustumCulled = false;
          });

          // 关键：缩放和定位（复用 3d-stage.html 逻辑，把模型高度归一化到约 2.18 米，底部贴地）
          model.updateMatrixWorld(true);
          const originalBounds = new THREE.Box3().setFromObject(model);
          const originalSize = originalBounds.getSize(new THREE.Vector3());
          const modelScale = 2.18 / Math.max(0.1, originalSize.y);
          model.scale.setScalar(modelScale);
          model.updateMatrixWorld(true);
          const scaledBounds = new THREE.Box3().setFromObject(model);
          const modelBaseY = model.position.y - scaledBounds.min.y;
          model.position.y = modelBaseY;

          scene.add(model);
          expressionManager = vrm.expressionManager;

          // 服装层已停用：Y-5 模型测试期间使用模型自带衣服
          // 如需恢复红色越剧戏服，取消下方注释即可
          // const costumeLoader = new GLTFLoader();
          // costumeLoader.load(
          //   '/assets/3d-stage/vroid/xu-xiaosheng-vroid-costume.glb?v=20260720-2',
          //   (costumeGltf) => {
          //     const costume = costumeGltf.scene;
          //     costume.name = 'Yueju_Teacher_Costume';
          //     costume.scale.setScalar(modelScale);
          //     costume.rotation.copy(model.rotation);
          //     costume.position.copy(model.position);
          //     costume.position.y += 0.045;
          //     costume.traverse((object) => {
          //       if (!object.isMesh) return;
          //       object.frustumCulled = false;
          //     });
          //     scene.add(costume);
          //     console.log('[teacher] 服装层加载完成');
          //   },
          //   undefined,
          //   (err) => {
          //     console.warn('[teacher] 服装层加载失败（不影响基础展示）', err);
          //   }
          // );

          // 隐藏加载提示
          stageLoading.style.display = 'none';
          setStatus('ready', '就绪');

          // 开始渲染循环（必须在 toast 之前，避免 toast 异常阻断渲染）
          animate();

          // 开场引导：首次进入时老师主动开口自我介绍
          scheduleOpening();

          toast('越韵先生已登场，可以开始提问', 'ok');
        } catch (e) {
          console.error('[teacher] VRM 处理失败', e);
          stageLoading.innerHTML = '<div class="loader-content"><div class="loader-icon" style="color:var(--cinnabar)">!</div><div class="loader-text">模型处理失败：' + escapeHtml(e.message) + '</div></div>';
        }
      },
      (progress) => {
        if (progress.total > 0) {
          // 部分二进制/压缩模型 loaded 会略超 total，钳制到 100% 以内
          const pct = Math.min(100, Math.round((progress.loaded / progress.total) * 100));
          const loaderText = stageLoading.querySelector('.loader-text');
          if (loaderText) loaderText.textContent = `正在登台... ${pct}%`;
        }
      },
      (err) => {
        console.error('[teacher] VRM 加载失败', err);
        stageLoading.innerHTML = '<div class="loader-content"><div class="loader-icon" style="color:var(--cinnabar)">!</div><div class="loader-text">模型加载失败，请刷新重试</div></div>';
      }
    );

    // 窗口尺寸变化
    window.addEventListener('resize', onResize);

    // 点击人物互动：轻点致意；连续快速点 3 次以上会触发生气「摆手拒绝」
    canvas.addEventListener('click', () => {
      if (!vrm) return;
      const nowClick = performance.now();
      // 生气阈值：3 秒内连续点击 >= 3 次
      if (nowClick - lastClickAt > 3000) angryCount = 1;
      else angryCount++;
      lastClickAt = nowClick;

      if (angryCount >= 3) {
        angryCount = 0;
        action = 'angry';
        actionStart = nowClick;
        clearTimeout(pokeMoodTimer);   // 取消之前点击遗留的「开心→放松」恢复定时器，避免覆盖生气表情
        setMood('angry', 0.8);         // 摆手动作为生气表情
        updateEmojiBubble();           // 气泡切换为生气 emoji
        toast('别戳啦，我都要生气了！', 'warn', 1500);
        return;
      }
      pokeAt = nowClick;
      setMood('happy', 0.9);   // 被点后开心一笑
      clearTimeout(pokeMoodTimer);
      pokeMoodTimer = setTimeout(() => setMood('relaxed', 0.25), 1500);
      toast('越韵先生向你点头致意', 'ok', 1200);
    });
  }

  function onResize() {
    if (!renderer || !camera) return;
    const w = canvas.clientWidth, h = canvas.clientHeight;
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
    renderer.setSize(w, h, false);
  }

  // ========== 渲染性能控制 ==========
  // 静置（不说话/听/思考）时降为低分辨率，活跃时拉高清晰度，兼顾观感与性能
  function setRenderQuality(active) {
    if (highQuality === active || !renderer) return;
    highQuality = active;
    const target = Math.min(window.devicePixelRatio, isLowEndDevice() ? 1 : 2);
    renderer.setPixelRatio(active ? target : Math.min(target, 1));
  }

  // 页面切到后台时暂停渲染循环，切回时恢复，节省 CPU/GPU 与电量
  function startRender() { renderRunning = true; }
  function stopRender() { renderRunning = false; }
  document.addEventListener('visibilitychange', () => {
    pageVisible = !document.hidden;
    if (pageVisible) startRender(); else stopRender();
  });

  // ========== 渲染循环 ==========
  function animate() {
    if (!renderRunning || !pageVisible) return;
    requestAnimationFrame(animate);
    const now = performance.now();
    const delta = Math.min((now - lastTime) / 1000, 0.1);
    lastTime = now;
    const elapsed = now / 1000;

    // 动态清晰度：说话/倾听/思考/口型活跃时用高分辨率，否则降分辨省资源
    setRenderQuality(isSpeaking || isListening || isThinking || lipSync.active);

    if (vrm) {
      // 眨眼动画（固定周期 4.6s，其中后 0.24s 闭眼）
      if (expressionManager) {
        blinkTimer += delta;
        const blinkPhase = blinkTimer % 4.6;
        const blink = blinkPhase > 4.36 ? Math.sin(((blinkPhase - 4.36) / 0.24) * Math.PI) : 0;
        expressionManager.setValue('blink', Math.max(0, blink));

        // 口型同步：由真实发声边界驱动（onboundary 更新 lastActivity）
        if (lipSync.active) {
          const since = now - lipSync.lastActivity;
          if (since < 600) {
            // 距上次发声边界 < 0.6s 视为正在发声，用正弦波让口型开合更自然
            const visemeIdx = Math.floor((now / 1000) * 8) % lipSync.visemes.length;
            const viseme = lipSync.visemes[visemeIdx];
            const intensity = 0.5 + 0.5 * Math.sin((now / 1000) * 12);
            // 重置所有元音
            lipSync.visemes.forEach(v => expressionManager.setValue(v, 0));
            expressionManager.setValue(viseme, intensity * 0.9);
          } else {
            // 超过发声窗口则闭嘴
            lipSync.active = false;
            lipSync.visemes.forEach(v => expressionManager.setValue(v, 0));
          }
        } else {
          // 不说话时清零口型
          lipSync.visemes.forEach(v => expressionManager.setValue(v, 0));
        }

        // 情绪表情：平滑过渡到目标权重，与口型/眨眼叠加
        moodCur += (moodWeight - moodCur) * 0.12;
        try {
          const moods = ['happy', 'relaxed', 'angry', 'sad', 'surprised'];
          for (const m of moods) expressionManager.setValue(m, 0);
          if (moodCur > 0.01 && moodName !== 'neutral') {
            expressionManager.setValue(moodName, moodCur);
          }
        } catch (_) { /* 模型无对应表情时静默忽略 */ }
      }

      // 待机微动（呼吸 + 轻微摆动）+ 说话点头 + 倾听侧头 + 被点致意
      if (vrm.humanoid) {
        const breath = Math.sin(elapsed * 1.2) * 0.02;
        const sway = Math.sin(elapsed * 0.6) * 0.03;
        const spine = vrm.humanoid.getNormalizedBoneNode('spine');
        const head = vrm.humanoid.getNormalizedBoneNode('head');
        // 说话时轻微点头配合语速，让讲解更生动
        let headNod = 0;
        let mouthEmphasis = 0;
        if (isSpeaking && lipSync.active) {
          headNod = Math.sin(now / 1000 * 6) * 0.03;
          mouthEmphasis = Math.sin(now / 1000 * 6) * 0.02;
        }
        // 倾听时微微侧头，做"正在聆听"的姿态
        let listenTilt = 0;
        if (isListening) listenTilt = 0.12;
        // 被点击致意：0.6s 内明显点头 + 前倾回礼
        let pokeNod = 0, pokeBow = 0;
        if (pokeAt && now - pokeAt < 600) {
          const pp = (now - pokeAt) / 600;
          pokeNod = Math.sin(pp * Math.PI) * 0.18;
          pokeBow = Math.sin(pp * Math.PI) * 0.06;
        }
        if (spine) {
          spine.rotation.x = breath + pokeBow;
        }
        if (head) {
          head.rotation.y = sway + (isListening ? 0.15 : 0);
          head.rotation.x = breath * 0.5 + pokeNod;
          head.rotation.z = listenTilt + mouthEmphasis;
        }
        // 生气动作 2 秒后自动恢复待机
        if (action === 'angry' && now - actionStart > 2000) {
          action = null;
          setMood('relaxed', 0.25);
          updateEmojiBubble();   // 气泡恢复为待机 emoji
        }

        // 手臂/前臂/手骨骼（供动作使用）
        const leftArm = vrm.humanoid.getNormalizedBoneNode('leftUpperArm');
        const rightArm = vrm.humanoid.getNormalizedBoneNode('rightUpperArm');
        const leftFore = vrm.humanoid.getNormalizedBoneNode('leftLowerArm');
        const rightFore = vrm.humanoid.getNormalizedBoneNode('rightLowerArm');
        const rightHand = vrm.humanoid.getNormalizedBoneNode('rightHand');
        const leftHand = vrm.humanoid.getNormalizedBoneNode('leftHand');
        const armDropAngle = Math.PI * 0.42;
        const armSway = Math.sin(elapsed * 0.8) * 0.015;

        if (action === 'angry') {
          // 生气摆手「no」：双臂在胸前左右快速摆动
          const noSwing = Math.sin(now / 1000 * 8) * 0.5;
          if (rightArm) rightArm.rotation.z = -armDropAngle + noSwing;
          if (leftArm) leftArm.rotation.z = armDropAngle - noSwing;
          if (rightFore) rightFore.rotation.x = 0.6;
          if (leftFore) leftFore.rotation.x = 0.6;
        } else {
          // 普通站立：上臂下垂，仅保留轻微待机摆动；前臂/手复位
          if (leftArm) leftArm.rotation.z = armDropAngle + armSway;
          if (rightArm) rightArm.rotation.z = -armDropAngle - armSway;
          if (leftFore) leftFore.rotation.x = 0;
          if (rightFore) rightFore.rotation.x = 0;
          if (rightHand) rightHand.rotation.x = 0;
          if (leftHand) leftHand.rotation.x = 0;
        }
      }

      vrm.update(delta);
    }

    // 自动旋转
    if (autoRotate && camera) {
      const angle = elapsed * 0.3;
      camera.position.x = Math.sin(angle) * 3.6;
      camera.position.z = Math.cos(angle) * 3.6;
      camera.position.y = 1.35;
      camera.lookAt(0, 1.25, 0);
    }

    if (renderer && scene && camera) {
      renderer.render(scene, camera);
    }
  }

  // ========== 状态指示 ==========
  function setStatus(state, text) {
    statusDot.className = 'status-dot ' + state;
    statusText.textContent = text;
    // 根据状态自动切换情绪表情（配合口型/眨眼叠加）
    switch (state) {
      case 'speaking': setMood('happy', 0.45); break;   // 讲解时带亲切微笑（调试期不禁用 think）
      case 'listening': setMood('happy', 0.3); break;   // 聆听时轻微笑
      case 'thinking': setMood('neutral', 0); break; // 思考中
      case 'ready':
      default: setMood('relaxed', 0.25); break;         // 待机放松微笑
    }
    updateEmojiBubble();
  }

  // 更新人物脸部旁的情绪 emoji 气泡：仅说话/思考/生气时显示（优先级：生气 > 思考 > 回答），其余状态隐藏
  function updateEmojiBubble() {
    let emoji = '';
    if (action === 'angry') emoji = '😠';          // 生气摆手
    else if (isThinking) emoji = '🤔';             // 思考
    else if (isSpeaking) emoji = '😊';             // 回答/讲解
    if (emoji) {
      emojiBubble.textContent = emoji;
      emojiBubble.classList.add('show');
    } else {
      emojiBubble.classList.remove('show');
    }
  }

  // 设置目标情绪表情（name 为模型支持的标准名，weight 为 0~1 目标权重）
  function setMood(name, weight) {
    moodName = name || 'relaxed';
    moodWeight = weight || 0;
  }

  // ========== 语音合成（Edge 神经网络语音 · 后端 TTS） ==========
  // 使用微软 Edge 神经网络语音（免费），比浏览器原生 speechSynthesis 更接近真人，
  // 且返回真实的 word boundary 时间点，用于驱动口型的精确同步。
  let speakToken = 0;          // 每次 speak 自增，用于取消时让旧链路失效
  let currentAudio = null;     // 当前正在播放的 <audio> 元素
  let currentObjUrl = null;    // 当前音频 Blob URL（用于释放）
  let currentStreamReader = null; // 流式合成时的 fetch reader（用于取消）
  let currentBoundaries = [];  // 整段文本的 word/sentence boundary 元数据
  let currentSentB = [];       // 整段的句边界 [{ offsetMs, text }]
  let currentWords = [];       // 整段的词边界 [{ offsetMs, text }]

  // 语音合成配置（可微调让语气更自然）：云希清脆男声，音调略高、语速适中，年轻老师感
  const TTS_CONFIG = { rate: 1.0, pitch: '+5%' };

  // 把整段回答按句拆分，供朗读与字幕高亮定位使用
  function splitSubtitleSeq(text) {
    const seq = [];
    const raw = text.split(/([。！？；;!?])/);
    let start = 0;
    for (let i = 0; i < raw.length; i += 2) {
      const seg = (raw[i] || '') + (raw[i + 1] || '');
      if (seg.trim()) {
        seq.push({ text: seg, start });
        start += seg.length;
      }
    }
    return seq.length ? seq : [{ text, start: 0 }];
  }

  // 高亮字幕：根据当前播放时刻 t(ms)，用句边界定位当前句子并高亮
  function updateSubtitleByTime(t) {
    if (!subtitleEl) return;
    let text = null;
    if (currentSentB.length) {
      // 取最后一个已发生的句边界作为当前句
      let active = null;
      for (const s of currentSentB) {
        if (s.offsetMs <= t) active = s.text;
      }
      text = active;
    } else if (currentWords.length && speakSeq.length) {
      // 退化：按词边界累计文本长度，近似定位到分句序列中的句子
      let offset = 0;
      for (const w of currentWords) {
        if (w.offsetMs <= t) offset += w.text.length;
      }
      for (const s of speakSeq) {
        if (offset >= s.start && offset < s.start + s.text.length) {
          text = s.text;
          break;
        }
      }
    }
    if (text) {
      subtitleEl.textContent = text;
      subtitleEl.classList.add('show');
    } else {
      subtitleEl.classList.remove('show');
    }
  }

  // 清理音频资源
  function disposeAudio() {
    if (currentStreamReader) {
      try { currentStreamReader.cancel(); } catch (_) {}
      currentStreamReader = null;
    }
    if (currentAudio) {
      currentAudio.pause();
      currentAudio.src = '';
      currentAudio.onended = null;
      currentAudio.ontimeupdate = null;
      currentAudio.onerror = null;
      currentAudio = null;
    }
    if (currentObjUrl) {
      URL.revokeObjectURL(currentObjUrl);
      currentObjUrl = null;
    }
  }

  function speak(text) {
    if (!voiceEnabled) return;
    stopSpeak();

    // 清理文本（去掉 markdown 标记）
    const cleanText = text
      .replace(/```[\s\S]*?```/g, '')
      .replace(/【[^】]*】/g, '')
      .replace(/\[[^\]]*\]\([^)]*\)/g, '')
      .replace(/[*#`_~]/g, '')
      .replace(/\s+/g, ' ')
      .trim();

    if (!cleanText) return;

    // 整段一次性合成，避免逐句合成带来的卡顿与漏句
    speakSeq = splitSubtitleSeq(cleanText);
    speakToken++;
    const token = speakToken;
    setStatus('speaking', '正在讲解');
    isSpeaking = true;
    btnVoice.classList.add('active');
    lipSync.active = true;
    lipSync.lastActivity = performance.now();
    synthesizeByStream(cleanText, token);
  }

  // base64 → Uint8Array
  function base64ToU8(b64) {
    const bin = atob(b64);
    const bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    return bytes;
  }

  // 带登录凭证的 fetch（TTS 接口需要鉴权）
  function authFetch(url, opts = {}) {
    const headers = new Headers(opts.headers || {});
    const tok = localStorage.getItem('yy_token');
    if (tok) headers.set('Authorization', 'Bearer ' + tok);
    return fetch(url, { ...opts, headers });
  }

  // 应用边界元数据，驱动口型与字幕
  function applyBoundaries(boundaries) {
    currentBoundaries = boundaries || [];
    currentWords = currentBoundaries.filter(b => b.type === 'WordBoundary' && b.text);
    currentSentB = currentBoundaries.filter(b => b.type === 'SentenceBoundary' && b.text);
  }

  // 边收边播：用 MediaSource 把后端流式推送的音频块逐步塞进播放器，
  // 合成完第一批就开播，不用等整段完成，显著降低首声等待。
  // 任何不支持/失败都会回退到整段合成 synthesizeAndPlay。
  async function synthesizeByStream(text, token) {
    const MediaSourceCtor = window.MediaSource || window.WebKitMediaSource;
    if (!MediaSourceCtor) return synthesizeAndPlay(text, token);

    let resp;
    try {
      resp = await authFetch('/api/tts/stream', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text, ...TTS_CONFIG }),
      });
    } catch (e) {
      console.warn('[TTS] 流式请求失败，回退整段合成:', e);
      return synthesizeAndPlay(text, token);
    }
    if (token !== speakToken) { try { resp.body && resp.body.cancel(); } catch (_) {} return; }
    if (!resp.ok || !resp.body) {
      console.warn('[TTS] 流式响应异常(' + resp.status + ')，回退整段合成');
      return synthesizeAndPlay(text, token);
    }

    const mediaSource = new MediaSourceCtor();
    const audio = new Audio();
    currentAudio = audio;
    let sourceBuffer = null;
    let started = false;
    let appendChain = Promise.resolve();

    const objUrl = URL.createObjectURL(mediaSource);
    currentObjUrl = objUrl;
    audio.src = objUrl;

    // 等待 sourceopen
    await new Promise((resolve) => {
      if (mediaSource.readyState === 'open') return resolve();
      mediaSource.addEventListener('sourceopen', resolve, { once: true });
      mediaSource.addEventListener('error', () => resolve(), { once: true });
    });
    if (token !== speakToken) { disposeAudio(); return; }

    try {
      sourceBuffer = mediaSource.addSourceBuffer('audio/mpeg');
    } catch (e) {
      console.warn('[TTS] 无法创建 SourceBuffer，回退整段合成:', e);
      disposeAudio();
      return synthesizeAndPlay(text, token);
    }

    // 串行追加音频块（一次只允许一个 append 在更新）
    const appendChunk = (bytes) => {
      appendChain = appendChain.then(() => new Promise((resolve) => {
        const onUpdate = () => { sourceBuffer.removeEventListener('updateend', onUpdate); resolve(); };
        sourceBuffer.addEventListener('updateend', onUpdate);
        try { sourceBuffer.appendBuffer(bytes); } catch (_) { sourceBuffer.removeEventListener('updateend', onUpdate); resolve(); }
      }));
      return appendChain;
    };

    // 实时驱动口型与字幕
    audio.ontimeupdate = () => {
      if (token !== speakToken) return;
      const t = audio.currentTime * 1000;
      let hasWord = false;
      for (const w of currentWords) { if (w.offsetMs <= t) { hasWord = true; break; } }
      if (hasWord) { lipSync.active = true; lipSync.lastActivity = performance.now(); }
      else lipSync.active = false;
      updateSubtitleByTime(t);
    };
    audio.onended = () => { if (token === speakToken) { disposeAudio(); finishSpeak(); } };
    audio.onerror = () => { if (token === speakToken) { disposeAudio(); finishSpeak(); } };

    const reader = resp.body.getReader();
    currentStreamReader = reader;
    const decoder = new TextDecoder();
    let buf = '';

    try {
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        buf += decoder.decode(value, { stream: true });
        let idx;
        while ((idx = buf.indexOf('\n\n')) !== -1) {
          const raw = buf.slice(0, idx);
          buf = buf.slice(idx + 2);
          const line = raw.split('\n').find(l => l.startsWith('data:'));
          if (!line) continue;
          let evt;
          try { evt = JSON.parse(line.slice(5)); } catch (_) { continue; }
          if (token !== speakToken) { disposeAudio(); return; }
          if (evt.t === 'a' && sourceBuffer) {
            await appendChunk(base64ToU8(evt.d));
            if (!started) {
              started = true;
              audio.play().catch(e => console.warn('[TTS] 播放失败:', e));
            }
          } else if (evt.t === 'done') {
            applyBoundaries(evt.b || []);
          } else if (evt.t === 'err') {
            throw new Error(evt.m || '语音合成失败');
          }
        }
      }
    } catch (e) {
      console.warn('[TTS] 流式播放中断:', e);
      if (token === speakToken) { disposeAudio(); finishSpeak(); }
      return;
    }

    // 全部音频块已推送，标记流结束
    if (token === speakToken && mediaSource.readyState === 'open') {
      try { mediaSource.endOfStream(); } catch (_) {}
    }
  }

  // 一次性合成整段并播放：用整段 word/sentence boundary 驱动口型与字幕
  async function synthesizeAndPlay(text, token) {
    let res;
    try {
      res = await request('/tts/synthesize', {
        method: 'POST',
        body: { text, ...TTS_CONFIG },
        timeout: 60000, // 长文本合成更耗时，放宽超时
      });
    } catch (e) {
      console.warn('[TTS] 合成请求失败:', e);
      return finishSpeak();
    }
    if (token !== speakToken) return;            // 等待期间被取消
    if (!res || res.code !== 0 || !res.data || !res.data.audio) {
      console.warn('[TTS] 合成失败:', res && res.msg);
      return finishSpeak();
    }

    // 解析词/句边界元数据
    const boundaries = res.data.boundaries || [];
    currentWords = boundaries.filter(b => b.type === 'WordBoundary' && b.text);
    currentSentB = boundaries.filter(b => b.type === 'SentenceBoundary' && b.text);
    currentBoundaries = boundaries;

    // base64 → Uint8Array → Blob → ObjectURL
    const byteString = atob(res.data.audio);
    const bytes = new Uint8Array(byteString.length);
    for (let i = 0; i < byteString.length; i++) bytes[i] = byteString.charCodeAt(i);
    const blob = new Blob([bytes], { type: 'audio/mpeg' });

    disposeAudio();
    currentObjUrl = URL.createObjectURL(blob);

    const audio = new Audio();
    currentAudio = audio;
    audio.src = currentObjUrl;

    // 实时发声：用整段真实 word boundary 驱动口型，句边界驱动字幕高亮
    audio.ontimeupdate = () => {
      if (token !== speakToken) return;
      const t = audio.currentTime * 1000;
      let hasWord = false;
      for (const w of currentWords) {
        if (w.offsetMs <= t) { hasWord = true; break; }
      }
      if (hasWord) {
        lipSync.active = true;
        lipSync.lastActivity = performance.now();
      } else {
        lipSync.active = false;
      }
      updateSubtitleByTime(t);
    };

    audio.onended = () => {
      if (token !== speakToken) return;
      disposeAudio();
      finishSpeak();
    };

    audio.onerror = () => {
      if (token !== speakToken) return;
      disposeAudio();
      finishSpeak();
    };

    try {
      await audio.play();
    } catch (e) {
      console.warn('[TTS] 播放失败:', e);
      disposeAudio();
      finishSpeak();
    }
  }

  function finishSpeak() {
    disposeAudio();
    isSpeaking = false;
    currentBoundaries = [];
    currentSentB = [];
    currentWords = [];
    setStatus('ready', '就绪');
    lipSync.active = false;
    if (subtitleEl) subtitleEl.classList.remove('show');
    if (expressionManager) {
      lipSync.visemes.forEach(v => expressionManager.setValue(v, 0));
    }
  }

  function stopSpeak() {
    speakToken++;                                 // 让正在进行的朗读链失效
    disposeAudio();
    isSpeaking = false;
    currentBoundaries = [];
    currentSentB = [];
    currentWords = [];
    lipSync.active = false;
    if (subtitleEl) subtitleEl.classList.remove('show');
    if (expressionManager) {
      lipSync.visemes.forEach(v => expressionManager.setValue(v, 0));
    }
    setStatus('ready', '就绪');
  }

  // ========== 开场引导 ==========
  let openingDone = false;
  const OPENING_TEXT = '同学你好，我是越韵先生。关于越剧的流派、剧目、唱腔、身段，都可以问我。试着点击下方示例问题，或直接输入你的问题吧。';

  // 预热 TTS 缓存：后台把开场白/示例等固定文本提前合成，命中缓存后首次开口几乎零等待
  function warmTtsCache() {
    const texts = [OPENING_TEXT];
    // 常见示例问题（若页面有示例按钮，可同步其文案）
    for (const el of document.querySelectorAll('.example-btn')) {
      const t = (el.getAttribute('data-prompt') || el.textContent || '').trim();
      if (t) texts.push(t);
    }
    for (const t of texts) {
      authFetch('/api/tts/synthesize', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text: t, ...TTS_CONFIG }),
      }).then(r => r.text()).catch(() => {});
    }
  }

  // 模型就绪后延迟开场，等待语音引擎就绪；若用户已发文则不再打扰
  function scheduleOpening() {
    if (openingDone) return;
    warmTtsCache(); // 提前暖缓存
    setTimeout(() => {
      if (openingDone) return;
      if (voiceEnabled && !isSpeaking && !isStreaming && !isThinking) {
        // 同步老师气泡展示开场语
        teacherBubble.classList.add('show');
        teacherBubble.innerHTML = escapeHtml(OPENING_TEXT);
        speak(OPENING_TEXT);
      }
    }, 1200);
  }

  // 用户首次提问后，标记开场已结束，避免后续再自动播报
  function markOpeningDone() {
    if (!openingDone) {
      openingDone = true;
      stopSpeak();
    }
  }

  // ========== 语音识别（ASR · 录音上传后端识别） ==========
  const micBtn = document.getElementById('micBtn');

  // 优先使用 MediaRecorder 录音后上传到后端 ASR；原生 Web Speech 作为最后的降级。
  let mediaRecorder = null;
  let recordStream = null;
  let audioChunks = [];
  let recordTimer = null;
  let isRecording = false;

  const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
  let recognition = null;
  let isListening = false;
  let asrFinalHandled = false;

  // 麦克风只在「安全上下文」(HTTPS 或 localhost) 下可用。
  const isSecureCtx = window.isSecureContext === true;
  if (!isSecureCtx && micBtn) {
    micBtn.disabled = true;
    micBtn.classList.remove('recording');
    micBtn.title = '麦克风需 HTTPS 或 localhost 才能使用（当前页面为不安全连接 http）';
  }

  if (SR) {
    recognition = new SR();
    recognition.lang = 'zh-CN';
    recognition.continuous = false;
    recognition.interimResults = true;
    recognition.maxAlternatives = 1;

    recognition.onresult = (event) => {
      let interim = '';
      let finalText = '';
      for (let i = event.resultIndex; i < event.results.length; i++) {
        const res = event.results[i];
        if (res.isFinal) finalText += res[0].transcript;
        else interim += res[0].transcript;
      }
      msgInput.value = finalText + interim;
      msgInput.dispatchEvent(new Event('input'));
      if (finalText && !asrFinalHandled) {
        asrFinalHandled = true;
        handleFinalTranscript(finalText.trim());
      }
    };

    recognition.onerror = (e) => {
      isListening = false;
      updateMicUI();
      console.warn('[ASR] 识别错误码:', e.error, e);
      if (e.error === 'not-allowed') {
        toast('麦克风权限被拒绝：请点地址栏左侧🔒→“麦克风”→改为“允许”并刷新页面；若已允许请刷新后重试', 'err', 4500);
      } else if (e.error === 'service-not-allowed' || e.error === 'network' || e.error === 'audio-capture') {
        toast('语音识别服务暂不可用（可能是网络无法连接识别服务）。建议改用文字输入提问', 'err', 5000);
      } else if (e.error === 'no-speech') {
        toast('未检测到语音，请重试', 'err');
      } else if (e.error !== 'aborted') {
        toast('语音识别出错：' + e.error, 'err');
      }
    };

    recognition.onend = () => {
      isListening = false;
      updateMicUI();
      if (!isStreaming && !isThinking) setStatus('ready', '就绪');
    };
  }

  function pickBestMimeType() {
    const types = ['audio/webm', 'audio/webm;codecs=opus', 'audio/mp4'];
    for (const t of types) {
      if (MediaRecorder.isTypeSupported(t)) return t;
    }
    return '';
  }

  async function startRecording() {
    if (isStreaming || isThinking) {
      toast('越韵先生正在回答，请稍候', 'err');
      return;
    }
    if (!requireLogin('请先登录后再语音提问')) return;

    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
      toast('当前浏览器不支持麦克风录音', 'err');
      return;
    }

    try {
      recordStream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const mimeType = pickBestMimeType();
      const options = mimeType ? { mimeType } : {};
      mediaRecorder = new MediaRecorder(recordStream, options);
      audioChunks = [];

      mediaRecorder.ondataavailable = (e) => {
        if (e.data && e.data.size > 0) audioChunks.push(e.data);
      };

      mediaRecorder.onstop = async () => {
        isRecording = false;
        updateMicUI();
        if (audioChunks.length === 0) {
          setStatus('ready', '就绪');
          toast('未录到声音', 'err');
          return;
        }
        const blob = new Blob(audioChunks, { type: mediaRecorder.mimeType || 'audio/webm' });
        const ext = (blob.type || '').includes('mp4') ? 'mp4' : 'webm';
        await uploadAudioForAsr(blob, ext);
      };

      mediaRecorder.onerror = (e) => {
        console.error('[MediaRecorder] error', e);
        isRecording = false;
        updateMicUI();
        toast('录音失败，请重试', 'err');
      };

      mediaRecorder.start();
      isRecording = true;
      updateMicUI();
      setStatus('listening', '聆听中');
      toast('聆听中，请向越韵先生提问，说完再点一次麦克风', 'ok', 2000);

      clearTimeout(recordTimer);
      recordTimer = setTimeout(() => {
        if (isRecording) stopListening();
      }, 30000);
    } catch (e) {
      console.warn('[MediaRecorder] 启动失败', e);
      // 诊断：把浏览器实际报告的权限状态打出来，用于区分「浏览器层」还是「系统层」拦截
      if (navigator.permissions && navigator.permissions.query) {
        navigator.permissions.query({ name: 'microphone' })
          .then((s) => console.warn('[MicDiag] 浏览器权限状态 =', s.state))
          .catch((qErr) => console.warn('[MicDiag] 无法查询权限状态', qErr.name, qErr.message));
      }
      if (e.name === 'NotAllowedError' || e.name === 'PermissionDeniedError') {
        toast('麦克风权限被拒绝：请点地址栏🔒→麦克风→允许，并刷新页面', 'err', 4500);
      } else if (e.name === 'NotFoundError') {
        toast('未找到麦克风设备', 'err');
      } else {
        toast('无法启动录音：' + e.name, 'err');
      }
    }
  }

  async function uploadAudioForAsr(blob, ext) {
    setStatus('thinking', '正在识别');
    const form = new FormData();
    form.append('audio', blob, `recording.${ext}`);

    try {
      const res = await request('/audio/recognize', { method: 'POST', body: form, isForm: true });
      if (res.code !== 0 || !res.data || !res.data.text) {
        toast(res.message || '识别失败，建议改用文字输入', 'err');
        setStatus('ready', '就绪');
        return;
      }
      toast('识别完成', 'ok', 1200);
      handleFinalTranscript(res.data.text);
    } catch (err) {
      console.error('[ASR] 上传识别失败', err);
      toast('识别请求失败，建议改用文字输入', 'err');
      setStatus('ready', '就绪');
    }
  }

  async function startListening() {
    if (isStreaming || isThinking) {
      toast('越韵先生正在回答，请稍候', 'err');
      return;
    }
    if (!requireLogin('请先登录后再语音提问')) return;

    if (!window.isSecureContext) {
      toast('麦克风需安全连接：请用 https:// 域名或 localhost 打开本页（当前为 http 不安全连接）', 'err', 4500);
      return;
    }

    // 优先 MediaRecorder 录音上传后端 ASR
    if (window.MediaRecorder && navigator.mediaDevices && navigator.mediaDevices.getUserMedia) {
      await startRecording();
      return;
    }

    // 降级：浏览器原生 Web Speech API
    if (!recognition) {
      toast('当前浏览器不支持语音输入，请使用 Chrome / Edge', 'err');
      return;
    }

    try {
      asrFinalHandled = false;
      recognition.start();
      isListening = true;
      updateMicUI();
      setStatus('listening', '聆听中');
      toast('聆听中，请向越韵先生提问', 'ok', 1500);
    } catch (e) {
      console.warn('[ASR] 启动失败', e);
      isListening = false;
      updateMicUI();
      toast('无法启动语音识别，请改用文字输入', 'err', 4500);
    }
  }

  function stopListening() {
    clearTimeout(recordTimer);
    if (mediaRecorder && mediaRecorder.state !== 'inactive') {
      try { mediaRecorder.stop(); } catch (_) {}
    }
    if (recordStream) {
      recordStream.getTracks().forEach(t => t.stop());
      recordStream = null;
    }
    isRecording = false;
    if (recognition) { try { recognition.stop(); } catch (_) {} }
    isListening = false;
    updateMicUI();
    if (!isStreaming && !isThinking) setStatus('ready', '就绪');
  }

  function toggleListening() {
    if (isRecording || isListening) stopListening();
    else startListening();
  }

  function updateMicUI() {
    if (!micBtn) return;
    const active = isRecording || isListening;
    micBtn.classList.toggle('recording', active);
    micBtn.title = active ? '停止聆听' : '语音提问';
  }

  async function handleFinalTranscript(raw) {
    if (!raw) return;
    stopListening();
    setStatus('ready', '就绪');
    let question = raw;
    // 越剧术语纠错（离线本地模型，异常则退回原文）
    try {
      const r = await request('/audio/correct', { method: 'POST', body: { text: raw } });
      if (r && r.code === 0 && r.data && r.data.corrected) {
        question = r.data.corrected;
        if (r.data.changed) console.log('[ASR] 术语纠错:', raw, '→', question);
      }
    } catch (_) { /* 纠错异常则使用原文 */ }
    msgInput.value = question;
    msgInput.dispatchEvent(new Event('input'));
    askQuestion(question);
  }

  // ========== RAG 问答（复用 /api/chat/stream） ==========
  let isStreaming = false;

  async function askQuestion(question) {
    if (isStreaming || isThinking) {
      toast('越韵先生正在回答，请稍候', 'err');
      return;
    }
    if (!requireLogin('请先登录后再提问')) return;

    // 用户已正式提问，结束开场引导
    markOpeningDone();

    // 添加用户消息（按纯文本渲染，杜绝 HTML 注入）
    appendMessage('user', question, { asText: true });
    msgInput.value = '';
    msgInput.style.height = 'auto';

    // 添加 AI 占位
    const aiMsg = appendMessage('assistant', '<span class="typing-dots"><span></span><span></span><span></span></span> 正在研墨运笔…');
    const bubble = aiMsg.querySelector('.msg-bubble');

    isStreaming = true;
    isThinking = true;
    sendBtn.disabled = true;
    if (micBtn) micBtn.disabled = true;
    setStatus('thinking', '正在思考');
    teacherBubble.classList.add('show', 'streaming');
    teacherBubble.innerHTML = '<span class="typing-dots"><span></span><span></span><span></span></span> 越韵先生正在查阅典籍...';

    let fullText = '';
    let sources = [];

    try {
      const resp = await fetch('/api/chat/stream', {
        method: 'POST',
        headers: Auth.authHeaders(),
        // 携带会话 id，后端据此拉取历史上下文，实现多轮连续对话
        body: JSON.stringify({ message: question, sessionId }),
      });

      if (!resp.ok) throw new Error(`请求失败 (${resp.status})`);

      const reader = resp.body.getReader();
      const decoder = new TextDecoder('utf-8');
      let buffer = '';
      let started = false;
      let bubbleText = '';

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() || '';

        for (const line of lines) {
          const trimmed = line.trim();
          if (!trimmed || !trimmed.startsWith('data:')) continue;
          const payload = trimmed.slice(5).trim();
          if (!payload) continue;
          let evt;
          try { evt = JSON.parse(payload); } catch { continue; }

          if (evt.type === 'token') {
            if (!started) {
              isThinking = false;
              setStatus('speaking', '正在讲解');
              started = true;
              bubble.innerHTML = '';
              teacherBubble.innerHTML = '';
              bubble.classList.add('stream-cursor');
            }
            fullText += evt.content;
            const html = renderAnswer(fullText);
            bubble.innerHTML = html;
            bubbleText = fullText;
            // 老师气泡同步显示
            teacherBubble.innerHTML = html;
            scrollChatToBottom();
          } else if (evt.type === 'rag') {
            // 在老师气泡顶部显示 RAG 检索标记
            const chunkNames = (evt.chunks || []).slice(0, 3).map(c =>
              `<span class="src-mark">${escapeHtml(c.title)}</span>`
            ).join(' ');
            if (chunkNames && !teacherBubble.querySelector('.rag-marks')) {
              const marksDiv = document.createElement('div');
              marksDiv.className = 'rag-marks';
              marksDiv.style.cssText = 'font-size:11px;margin-bottom:6px;';
              marksDiv.innerHTML = `📚 检索到：${chunkNames}`;
              teacherBubble.insertBefore(marksDiv, teacherBubble.firstChild);
            }
          } else if (evt.type === 'sources') {
            sources = evt.sources || [];
          } else if (evt.type === 'error') {
            bubble.innerHTML = `<p style="color:var(--cinnabar)">⚠ ${escapeHtml(evt.message)}</p>`;
            teacherBubble.innerHTML = `<p style="color:var(--cinnabar)">⚠ ${escapeHtml(evt.message)}</p>`;
          } else if (evt.type === 'done') {
            bubble.classList.remove('stream-cursor');
            teacherBubble.classList.remove('streaming');
            // 保存会话 id，供后续轮次复用，保持上下文连续
            if (evt.sessionId) {
              sessionId = evt.sessionId;
              localStorage.setItem('teacherSessionId', sessionId);
            }
            // 完成渲染
            finalizeAnswer(aiMsg, fullText, sources, question);
            // 语音朗读
            if (voiceEnabled && fullText) {
              setTimeout(() => speak(fullText), 300);
            } else {
              setStatus('ready', '就绪');
            }
          }
        }
      }
    } catch (err) {
      bubble.innerHTML = `<p style="color:var(--cinnabar)">⚠ 网络异常：${escapeHtml(err.message)}</p>`;
      teacherBubble.innerHTML = `<p style="color:var(--cinnabar)">⚠ 网络异常</p>`;
      teacherBubble.classList.remove('streaming');
      setStatus('ready', '就绪');
    } finally {
      isStreaming = false;
      isThinking = false;
      sendBtn.disabled = false;
      if (micBtn) micBtn.disabled = false;
    }
  }

  // ========== 消息渲染 ==========
  // content 默认按 HTML 片段处理（AI 回答走 renderAnswer 生成的受控 HTML）。
  // 用户输入/语音识别结果必须用 { asText: true } 传入，走 textContent 写入——
  // 直接拼进 innerHTML 的话，一条 <img src=x onerror=...> 就能在页面里执行脚本。
  function appendMessage(role, content, options) {
    const asText = !!(options && options.asText);
    const msg = document.createElement('div');
    msg.className = `msg ${role}`;

    const avatar = document.createElement('div');
    avatar.className = 'msg-avatar';
    avatar.textContent = role === 'user' ? '我' : '师';

    const body = document.createElement('div');
    body.className = 'msg-body';

    const bubble = document.createElement('div');
    bubble.className = 'msg-bubble';
    if (asText) bubble.textContent = content;
    else bubble.innerHTML = content;

    body.appendChild(bubble);
    msg.appendChild(avatar);
    msg.appendChild(body);
    chatHistory.appendChild(msg);
    scrollChatToBottom();
    return msg;
  }

  function finalizeAnswer(aiMsg, text, sources, question) {
    const bubble = aiMsg.querySelector('.msg-bubble');
    bubble.innerHTML = renderAnswer(text);
    // 添加出处和重播按钮
    const metaDiv = document.createElement('div');
    metaDiv.style.cssText = 'margin-top:6px;font-size:11px;color:var(--ink-light);display:flex;align-items:center;gap:8px;flex-wrap:wrap;';
    if (sources.length > 0) {
      const srcHtml = sources.slice(0, 3).map(s => `<span class="src-mark">${escapeHtml(s.title)}</span>`).join(' ');
      metaDiv.innerHTML += `<span>📚 出处：</span>${srcHtml}`;
    }
    const replayBtn = document.createElement('span');
    replayBtn.className = 'msg-replay';
    replayBtn.innerHTML = '🔊 重新朗读';
    replayBtn.addEventListener('click', () => speak(text));
    metaDiv.appendChild(replayBtn);
    aiMsg.querySelector('.msg-body').appendChild(metaDiv);
    scrollChatToBottom();
  }

  function scrollChatToBottom() {
    chatHistory.scrollTop = chatHistory.scrollHeight;
  }

  // ========== 事件绑定 ==========
  // 输入框自适应
  msgInput.addEventListener('input', () => {
    msgInput.style.height = 'auto';
    msgInput.style.height = Math.min(msgInput.scrollHeight, 120) + 'px';
  });
  msgInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      sendMessage();
    }
  });
  sendBtn.addEventListener('click', sendMessage);

  function sendMessage() {
    const text = msgInput.value.trim();
    if (!text) return;
    askQuestion(text);
  }

  // 示例问题
  exampleQs.addEventListener('click', (e) => {
    const q = e.target.closest('.example-q');
    if (!q) return;
    msgInput.value = q.dataset.q;
    sendMessage();
  });

  // 语音开关
  function toggleVoice() {
    voiceEnabled = !voiceEnabled;
    voiceToggle.classList.toggle('active', voiceEnabled);
    btnVoice.classList.toggle('active', voiceEnabled);
    voiceToggle.innerHTML = voiceEnabled ? '🔊' : '🔇';
    btnVoice.innerHTML = voiceEnabled ? '🔊' : '🔇';
    if (!voiceEnabled) stopSpeak();
    toast(voiceEnabled ? '语音已开启' : '语音已关闭', 'ok');
  }
  voiceToggle.addEventListener('click', toggleVoice);
  btnVoice.addEventListener('click', toggleVoice);

  btnStopVoice.addEventListener('click', stopSpeak);

  btnRotate.addEventListener('click', () => {
    autoRotate = !autoRotate;
    btnRotate.classList.toggle('active', autoRotate);
    toast(autoRotate ? '自动旋转已开启' : '自动旋转已关闭', 'ok');
  });

  if (micBtn) {
    micBtn.addEventListener('click', toggleListening);
  }

  // 初始化
  // 运行库已改为 async 加载，这里等待其就绪后再初始化 3D，避免并发时序问题
  function whenRuntimeReady(cb) {
    if (window.Yueju3D) return cb();
    let waited = 0;
    const timer = setInterval(() => {
      waited += 50;
      if (window.Yueju3D) { clearInterval(timer); return cb(); }
      // 8 秒仍就绪失败则按未加载处理（init3D 内部会给出友好提示）
      if (waited > 8000) { clearInterval(timer); return cb(); }
    }, 50);
  }
  whenRuntimeReady(init3D);
})();
