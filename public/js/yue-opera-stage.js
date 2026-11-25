/* Production stage with an optional VRoid character, free exploration and opera poses. */
(function () {
  'use strict';
  const mount = document.getElementById('operaStage');
  const canvas = document.getElementById('view');
  const status = document.getElementById('status');
  const loading = document.getElementById('loading');
  const lightButton = document.getElementById('light');
  const fullscreenButton = document.getElementById('fullscreen');
  const embedded = new URLSearchParams(location.search).get('bare') === '1';
  document.body.classList.toggle('embedded', embedded);
  document.getElementById('retry').addEventListener('click', () => location.reload());
  let renderer;
  try {
    const THREE = window.Yueju3D?.THREE;
    if (!THREE || !window.createYueOperaGarden) throw new Error('花园资源未能加载，请检查网络后刷新。');
    const compact = matchMedia('(max-width: 760px), (pointer: coarse)').matches;
    const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)');
    renderer = new THREE.WebGLRenderer({ canvas, antialias: !compact, powerPreference: 'high-performance' });
    renderer.setPixelRatio(Math.min(devicePixelRatio || 1, compact ? 1.25 : 1.5));
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.02;
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = compact ? THREE.PCFSoftShadowMap : THREE.PCFShadowMap;
    renderer.shadowMap.autoUpdate = false;
    renderer.shadowMap.needsUpdate = true;
    const scene = new THREE.Scene();
    scene.background = new THREE.Color('#dce4d8');
    scene.fog = new THREE.Fog('#dce4d8', 35, 240);
    const camera = new THREE.PerspectiveCamera(43, 1, .2, 650);
    const playerViewButtons = [...document.querySelectorAll('[data-player-view]')];
    const lookAtKoiButton = document.getElementById('lookAtKoi');
    const lookLevelButton = document.getElementById('lookLevel');
    const ambient = new THREE.HemisphereLight('#dcebf0', '#65765e', .95);
    scene.add(ambient);
    const sun = new THREE.DirectionalLight('#fff0d5', 3.0);
    sun.position.set(-75,128,35);
    sun.castShadow = true;
    sun.shadow.mapSize.set(compact?2048:4096,compact?2048:4096);
    Object.assign(sun.shadow.camera, { left:-110,right:110,top:110,bottom:-110,near:1,far:421 });sun.shadow.camera.updateProjectionMatrix();
    sun.shadow.normalBias = .035;
    sun.shadow.bias = -.000035;
    scene.add(sun);
    const fill = new THREE.DirectionalLight('#c4ded6', .28);
    fill.position.set(35, 28, -30);
    scene.add(fill);
    const village = window.createYueOperaGarden(THREE, scene, compact);
    const scenery = window.createYueOperaScenery(THREE, scene, compact);
    const playerCamera = window.createYueOperaPlayerCamera(THREE,camera,village.heightfield);
    const skyKoi = window.createYueOperaSkyKoi(THREE, scene, compact);
    const koiPauseButton = document.getElementById('skyKoiPause');
    const koiStyleButton = document.getElementById('koiStyle');
    const koiRollButton = document.getElementById('koiRoll');
    const koiStyles = ['ink','white','pastel'];
    const koiStyleNames = {ink:'水墨鱼',white:'白模鱼',pastel:'淡彩鱼'};
    function syncKoiStyle() {
      const style = skyKoi.stats.style, next = koiStyles[(koiStyles.indexOf(style)+1)%koiStyles.length];
      koiStyleButton.textContent = koiStyleNames[style];
      koiStyleButton.setAttribute('aria-label', '鱼的风格：'+koiStyleNames[style]+'，点击切换'+koiStyleNames[next]);
      canvas.dataset.skyKoi = JSON.stringify(skyKoi.stats);
    }
    koiStyleButton.addEventListener('click', () => {
      skyKoi.setStyle(koiStyles[(koiStyles.indexOf(skyKoi.stats.style)+1)%koiStyles.length]); syncKoiStyle(); requestRender();
    });
    koiRollButton.addEventListener('click', () => {
      skyKoi.requestRoll(); skyKoi.setPaused(false); syncKoiButton();
      requestRender();
    });
    skyKoi.setPaused(matchMedia('(prefers-reduced-motion: reduce)').matches);
    function syncKoiButton() {
      koiPauseButton.textContent = skyKoi.paused ? '继续巡游' : '暂停巡游';
      koiPauseButton.setAttribute('aria-pressed', String(skyKoi.paused));
    }
    syncKoiButton();
    koiPauseButton.disabled = true;
    koiPauseButton.textContent = '锦鲤载入中…';
    skyKoi.ready.then(asset => {
      if (!asset) return;
      koiPauseButton.disabled = false; syncKoiButton();
      koiStyleButton.disabled = false; syncKoiStyle();
      koiRollButton.disabled = false;
      syncPlayerView();
      canvas.dataset.skyKoi = JSON.stringify(skyKoi.stats); requestRender();
    }).catch(error => {
      console.warn('锦鲤模型载入失败', error);
      skyKoi.setPaused(true);
      koiPauseButton.textContent = '锦鲤未载入';
      const notice = document.getElementById('notice');
      notice.textContent = '锦鲤暂未载入，请刷新页面重试。'; notice.hidden = false;
    });
    const backdrop = new THREE.Mesh(new THREE.PlaneGeometry(1000, 1000), new THREE.MeshStandardMaterial({ color: '#bfcdbd', roughness: 1 }));
    backdrop.rotation.x = -Math.PI / 2;
    backdrop.position.y = -1.18;
    backdrop.receiveShadow = true;
    scene.add(backdrop);
    const stageLight = new THREE.SpotLight('#ffd39a', 180, 18, .7, .6, 2);
    stageLight.position.set(0, 5.5, 12);
    const target = new THREE.Object3D();
    target.position.set(0, .4, 10);
    scene.add(target);
    stageLight.target = target;
    stageLight.visible = false;
    scene.add(stageLight);
    const morning = window.createYueOperaMorningRendering({renderer,scene,camera,garden:village,skyKoi,compact});
    canvas.dataset.rendering=JSON.stringify(morning.stats);
    const aim = new THREE.Vector3(0, 1, 0);
    let yaw = .56, pitch = .69, distance = 108, night = false;
    let customCamera = false, frameId = 0, disposed = false;
    let character = null, following = false, previousFrameTime = 0;
    let gardenTime = 0;
    let nightMix = 0;
    let cinematic = false;
      let importedShow = false, importSequence = 0, musicUrl = null;
      const danceMusic = new Audio();danceMusic.preload='auto';
      const importButton=document.getElementById('importDance'),filePicker=document.getElementById('danceFiles'),showButton=document.getElementById('danceShow');
      importButton.addEventListener('click',()=>filePicker.click());
      filePicker.addEventListener('change',async()=>{
        const request=++importSequence,files=[...filePicker.files],motion=files.find(f=>f.name.toLowerCase()==='jimingyue-motion.vmd');
        if(!motion){status.textContent='请选择 jimingyue-motion.vmd，可同时选择配乐';filePicker.value='';return;}
        importButton.disabled=true;
        try{
          const clip=window.YueOperaVMD.parse(await motion.arrayBuffer());
          if(request!==importSequence)return;
          if(cinematic)endRehearsal();
          character.setImportedMotion(clip);
          danceMusic.pause();danceMusic.removeAttribute('src');
          if(musicUrl)URL.revokeObjectURL(musicUrl);musicUrl=null;
          const audio=files.find(f=>/\.(mp3|wav|ogg)$/i.test(f.name));
          if(audio){musicUrl=URL.createObjectURL(audio);danceMusic.src=musicUrl;}
          showButton.hidden=false;showButton.textContent=`观看《寄明月》 · ${Math.floor(clip.duration/60)}分${Math.round(clip.duration%60)}秒`;
          status.textContent=`舞蹈已载入 · 动作 Nivsha${audio?' · 配乐已载入':' · 未选择配乐'} · 仅在本机播放`;
        }catch(error){status.textContent=error.message||'舞蹈未能载入，请重试';}
        finally{importButton.disabled=false;filePicker.value='';requestRender();}
      });
    const rehearsalButton=document.getElementById('rehearsal');
      function endRehearsal(){cinematic=false;importedShow=false;danceMusic.pause();character?.stopRehearsal();rehearsalButton.textContent='60秒运镜预演';rehearsalButton.setAttribute('aria-pressed','false');showButton.textContent='再次观看《寄明月》';showButton.setAttribute('aria-pressed','false');document.body.classList.remove('cinematic');following=!!character?.active;status.textContent='演出结束 · 可继续自由游园';syncPlayerView();}
      showButton.addEventListener('click',async()=>{
        if(cinematic){endRehearsal();requestRender();return;}
        showButton.disabled=true;rehearsalButton.disabled=true;
        try{if(await character.startImported()){
          importedShow=true;cinematic=true;following=false;character.setFirstPerson(false);
          showButton.textContent='结束演出';showButton.setAttribute('aria-pressed','true');document.body.classList.add('cinematic');
          document.querySelectorAll('audio').forEach(audio=>audio.pause());
          if(musicUrl){danceMusic.currentTime=0;danceMusic.play().catch(()=>{status.textContent='音频未播放，可退出后重新开始';});}
          syncPlayerView();requestRender();
        }}finally{showButton.disabled=false;rehearsalButton.disabled=false;}
      });
    rehearsalButton.addEventListener('click',async()=>{
      if(cinematic){endRehearsal();requestRender();return;}
      rehearsalButton.disabled=true;
      try{if(await character.startRehearsal()){cinematic=true;following=false;character.setFirstPerson(false);rehearsalButton.textContent='结束预演';rehearsalButton.setAttribute('aria-pressed','true');document.body.classList.add('cinematic');syncPlayerView();requestRender();}}
      finally{rehearsalButton.disabled=false;}
    });
    const warmSun = new THREE.Color('#fff0d5'), coolSun = new THREE.Color('#b9d3e8');
    const pointers = new Map();
    function requestRender() {
      if (disposed || frameId || document.hidden) return;
      frameId = requestAnimationFrame(now => {
        frameId = 0;
        const playbackDelta = previousFrameTime ? Math.max(0,(now-previousFrameTime)/1000) : 0;
        const delta = Math.min(.05,playbackDelta);
        previousFrameTime = now;
        if(!reducedMotion.matches)gardenTime += delta;
        village.update(gardenTime);
        nightMix = reducedMotion.matches ? Number(night) : THREE.MathUtils.damp(nightMix,Number(night),2,delta);
        scenery.update(gardenTime,nightMix);
        ambient.intensity=THREE.MathUtils.lerp(.95,.45,nightMix);
        sun.intensity=THREE.MathUtils.lerp(3,.85,nightMix);
        sun.color.copy(warmSun).lerp(coolSun,nightMix);
        village.materials.lantern.emissiveIntensity=THREE.MathUtils.lerp(.65,2.4,nightMix);
        village.materials.window.emissiveIntensity=THREE.MathUtils.lerp(.25,1.2,nightMix);
        morning.setNight(nightMix);
        character?.update(delta, now / 1000, following ? playerCamera.yaw : yaw,playbackDelta);
        skyKoi.update(delta);
        canvas.dataset.skyKoiPosition = skyKoi.position.toArray().map(n => n.toFixed(2)).join(',');
        if (skyKoi.stats.loaded) canvas.dataset.koiSwimTime = (skyKoi.mixer.time % skyKoi.stats.swimSeconds).toFixed(3);
        canvas.dataset.koiFlight = JSON.stringify({action:skyKoi.stats.flightAction,time:skyKoi.stats.flightTime,roll:skyKoi.stats.roll,bank:skyKoi.stats.bank});
        stageLight.intensity = character?.active ? 110 : 180;
          if(cinematic && (character.performanceTime===null||character.performanceTime>=character.performanceDuration))endRehearsal();
        if(cinematic){
            const t=character.performanceTime/character.performanceDuration,s=t*t*(3-2*t);
          // One continuous dolly arc: establish, approach, circle, then settle.
          const radius=7.2-2.5*Math.sin(Math.PI*s),angle=-.48+1.0*s;
            const focus=importedShow?character.performanceFocus:null;
            const p=focus?{x:focus.x,y:character.position.y,z:focus.z}:character.position;
          camera.position.set(p.x+Math.sin(angle)*radius,p.y+2.1+.7*Math.sin(Math.PI*s),p.z-Math.cos(angle)*radius);
          camera.lookAt(p.x,p.y+1.15,p.z);
            if(importedShow&&musicUrl&&!danceMusic.paused&&Math.abs(danceMusic.currentTime-character.performanceTime)>.3) danceMusic.currentTime=character.performanceTime;
            status.textContent=`${importedShow?'寄明月 · 动作 Nivsha':'临水清音 · 运镜预演'} ${Math.floor(character.performanceTime)} / ${Math.ceil(character.performanceDuration)} 秒`;
            document.getElementById('gestureHelp').textContent='Esc 或拖动画面退出演出';
        } else if (following && character?.active) {
          playerCamera.update(character.position);
          // Hide the body in first person and when a wall forces the boom
          // too close to the avatar. Restore it as soon as there is space.
          character.setFirstPerson(playerCamera.mode==='first'||playerCamera.boom<.85);
          canvas.dataset.playerCamera=JSON.stringify(playerCamera.snapshot());
        } else {
          camera.position.set(aim.x + Math.sin(yaw) * Math.cos(pitch) * distance, aim.y + Math.sin(pitch) * distance, aim.z + Math.cos(yaw) * Math.cos(pitch) * distance);
          camera.lookAt(aim);
          canvas.dataset.playerCamera=JSON.stringify({mode:'preview',position:camera.position.toArray()});
        }
        renderer.shadowMap.autoUpdate = !!character?.active||!skyKoi.paused;
        morning.render(delta);
        if (character?.active || !skyKoi.paused || !reducedMotion.matches) requestRender();
        else previousFrameTime = 0;
      });
    }
    function showPreview() {
      following = false;
      character?.setFirstPerson(false);
      document.getElementById('gestureHelp').textContent = compact ? '拖动旋转 · 双指缩放' : '拖动旋转 · 滚轮缩放';
      yaw=.42;pitch=.32;distance=88*Math.max(1,1.15/camera.aspect);
      aim.set(0,3,-7);
      camera.fov=43;camera.updateProjectionMatrix();
      customCamera = false;
      syncPlayerView();
      requestRender();
    }
    function syncPlayerView() {
      const entered=following && character?.active;
      playerViewButtons.forEach(button => {
        const active = entered && button.dataset.playerView===playerCamera.mode;
        button.disabled=!entered;
        button.classList.toggle('active', active);
        button.setAttribute('aria-pressed', String(active));
      });
      lookAtKoiButton.disabled=!entered||!skyKoi.stats.loaded;
      lookLevelButton.disabled=!entered;
      if(entered) document.getElementById('gestureHelp').textContent=compact?'方向按钮走动 · 上拖抬头':'WASD 走动 · 上拖抬头 · V 切换人称';
    }
    function setPlayerView(mode) {
      if(!following||!character?.active)return;
      playerCamera.setMode(mode);syncPlayerView();
      canvas.focus({preventScroll:true});
      requestRender();
    }
    function markCustomCamera() {
      customCamera = true;
    }
    function clampDistance(value) { return THREE.MathUtils.clamp(value,12,Math.max(165,240/camera.aspect)); }
    function resize() {
      const { width, height } = mount.getBoundingClientRect();
      camera.aspect = width / Math.max(1, height);
      camera.updateProjectionMatrix();
      renderer.setSize(width, height, false);
      morning.resize(width,height);
      if (!following && !customCamera) showPreview();
      else requestRender();
    }
    playerViewButtons.forEach(button=>button.addEventListener('click',()=>setPlayerView(button.dataset.playerView)));
    lookAtKoiButton.addEventListener('click',()=>{
      if(!following||!character?.active)return;
      playerCamera.lookAt(skyKoi.position,character.position);canvas.focus({preventScroll:true});requestRender();
    });
    lookLevelButton.addEventListener('click',()=>{if(following){playerCamera.level();canvas.focus({preventScroll:true});requestRender();}});
    canvas.addEventListener('pointerdown', event => {
      if(cinematic)endRehearsal();
      if (event.pointerType === 'mouse' && event.button !== 0) return;
      pointers.set(event.pointerId, { x: event.clientX, y: event.clientY });
      canvas.setPointerCapture(event.pointerId);
      canvas.focus({ preventScroll: true });
    });
    canvas.addEventListener('pointermove', event => {
      const old = pointers.get(event.pointerId);
      if (!old) return;
      markCustomCamera();
      if (pointers.size === 2) {
        const other = [...pointers.entries()].find(([id]) => id !== event.pointerId)[1];
        const before = Math.hypot(old.x - other.x, old.y - other.y);
        const after = Math.hypot(event.clientX - other.x, event.clientY - other.y);
        if (after > 4 && before > 4) {
          if(following)playerCamera.zoom((before-after)*2);
          else distance = clampDistance(distance * before / after);
        }
      } else if (pointers.size === 1) {
        if(following)playerCamera.rotate(event.clientX-old.x,event.clientY-old.y);
        else {
          yaw -= (event.clientX - old.x) * .006;
          pitch = THREE.MathUtils.clamp(pitch + (event.clientY - old.y) * .005, .08, 1.48);
        }
      }
      pointers.set(event.pointerId, { x: event.clientX, y: event.clientY });
      requestRender();
    });
    for (const name of ['pointerup', 'pointercancel', 'lostpointercapture']) canvas.addEventListener(name, event => pointers.delete(event.pointerId));
    canvas.addEventListener('wheel', event => {
      if(cinematic)endRehearsal();
      event.preventDefault();
      markCustomCamera();
      if(following)playerCamera.zoom(event.deltaY);
      else distance = clampDistance(distance + event.deltaY * .06);
      requestRender();
    }, { passive: false });
    canvas.addEventListener('keydown', event => {
      const key = event.key;
      if(cinematic&&key==='Escape'){event.preventDefault();endRehearsal();requestRender();return;}
      if (character?.active) {
        if(event.ctrlKey||event.metaKey||event.altKey||/^(INPUT|SELECT|TEXTAREA)$/.test(event.target?.tagName))return;
        const letter=key.toLowerCase();
        if(!['v','i','k','j','l','home','0','+','=','-'].includes(letter))return;
        event.preventDefault();
        if(letter==='v')setPlayerView(playerCamera.mode==='third'?'first':'third');
        if(letter==='i')playerCamera.rotate(0,-18);
        if(letter==='k')playerCamera.rotate(0,18);
        if(letter==='j')playerCamera.rotate(-18,0);
        if(letter==='l')playerCamera.rotate(18,0);
        if(letter==='0'||letter==='home')playerCamera.level();
        if(letter==='+'||letter==='=')playerCamera.zoom(-35);
        if(letter==='-')playerCamera.zoom(35);
        requestRender();return;
      }
      if (!['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', '+', '=', '-', '0', 'Home'].includes(key)) return;
      event.preventDefault();
      if (key === '0' || key === 'Home') { showPreview(); return; }
      markCustomCamera();
      if (key === 'ArrowLeft') yaw += .12;
      if (key === 'ArrowRight') yaw -= .12;
      if (key === 'ArrowUp') pitch = Math.min(1.48, pitch + .07);
      if (key === 'ArrowDown') pitch = Math.max(.08, pitch - .07);
      if (key === '+' || key === '=') distance = clampDistance(distance * .92);
      if (key === '-') distance = clampDistance(distance * 1.08);
      requestRender();
    });
    lightButton.addEventListener('click', () => {
      night = !night;
      document.body.classList.toggle('night', night);
      ambient.intensity = night ? .45 : .95;
      sun.intensity = night ? .85 : 3.0;
      sun.color.set(night ? '#b9d3e8' : '#fff0d5');
      fill.intensity = night ? .22 : .28;
      scene.background.set(night ? '#182d37' : '#dce4d8');
      scene.fog.color.copy(scene.background);
      backdrop.material.color.set(night ? '#263e3c' : '#bfcdbd');
      stageLight.visible = night;
      skyKoi.setNight(night);
      morning.setNight(night);renderer.shadowMap.needsUpdate=true;
      renderer.toneMappingExposure = night ? 1.12 : 1.02;
      lightButton.textContent = night ? '切换日景' : '月下游园';
      lightButton.setAttribute('aria-pressed', String(night));
      status.textContent = night ? '碧波潭畔 · 月下游园' : '清晨薄雾 · 碧波鱼影';
      requestRender();
    });
    koiPauseButton.addEventListener('click', () => {
      skyKoi.setPaused(!skyKoi.paused);
      syncKoiButton();
      previousFrameTime = 0;
      requestRender();
    });
    fullscreenButton.hidden = !document.fullscreenEnabled;
    fullscreenButton.addEventListener('click', async () => {
      try {
        if (document.fullscreenElement) await document.exitFullscreen();
        else await mount.requestFullscreen();
      } catch {
        const notice = document.getElementById('notice');
        notice.textContent = '当前浏览器暂不支持全屏，请继续在页面内游园。';
        notice.hidden = false;
      }
    });
    document.addEventListener('fullscreenchange', () => {
      fullscreenButton.textContent = document.fullscreenElement ? '退出全屏' : '全屏观演';
      resize();
    });
    const observer = new ResizeObserver(resize);
    observer.observe(mount);
    document.addEventListener('visibilitychange', () => { previousFrameTime = 0;if(document.hidden)danceMusic.pause();else if(cinematic&&importedShow&&musicUrl){danceMusic.currentTime=character.performanceTime;danceMusic.play().catch(()=>{});}requestRender(); });
    character = window.createYueOperaCharacter({
      THREE, runtime: window.Yueju3D, scene, heightfield: village.heightfield, compact,
      onChange: requestRender,
      onFollow() {
        if(!following) {playerCamera.reset();playerCamera.setMode('third');}
        following = true;
        syncPlayerView();
        previousFrameTime = 0;
        requestRender();
      },
      onLeave() { showPreview(); }
    });
    canvas.addEventListener('webglcontextlost', event => {
      event.preventDefault();
      showError('三维画面已暂停，请重新加载花园。');
    });
    // An iframe unmount or route change releases its WebGL resources.
    addEventListener('pagehide', event => {
      if (event.persisted) return;
      disposed = true;
      danceMusic.pause();if(musicUrl)URL.revokeObjectURL(musicUrl);
      character?.dispose();
      morning.dispose();
      skyKoi.dispose();
      cancelAnimationFrame(frameId);
      observer.disconnect();
      const geometries = new Set(), materials = new Set(), textures = new Set();
      scene.traverse(object => {
        if (object.isInstancedMesh) object.dispose();
        if (object.geometry) geometries.add(object.geometry);
        if (object.material) (Array.isArray(object.material) ? object.material : [object.material]).forEach(material => materials.add(material));
      });
      materials.forEach(material => {
        Object.values(material).forEach(value => { if (value?.isTexture) textures.add(value); });
        material.dispose();
      });
      geometries.forEach(geometry => geometry.dispose());
      textures.forEach(texture => texture.dispose());
      sun.shadow.dispose();
      renderer.dispose();
    }, { once: true });
    canvas.dataset.stats = JSON.stringify(village.stats);
    canvas.dataset.tier = compact ? 'mobile' : 'desktop';
    canvas.dataset.skyKoi = JSON.stringify(skyKoi.stats);
    status.textContent = '清晨薄雾 · 碧波鱼影';
    if (compact) document.getElementById('gestureHelp').textContent = '拖动旋转 · 双指缩放';
    resize();
    loading.hidden = true;
    document.title = '碧波园 · 追鱼意境 · 越韵智传';
  } catch (error) {
    console.error('碧波园加载失败', error);
    renderer?.dispose();
    showError(error.message?.includes('花园资源') ? error.message : '当前设备未能打开三维花园，请使用支持 WebGL 的浏览器并重新加载。');
  }
  function showError(message) {
    loading.hidden = true;
    document.getElementById('errorMessage').textContent = message;
    document.getElementById('error').hidden = false;
    status.textContent = '花园暂时未能打开';
  }
})();
