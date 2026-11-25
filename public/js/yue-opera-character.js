/* VRoid actor controls for the authored village walkable surfaces. */
(function () {
  'use strict';
  window.createYueOperaCharacter = function ({ THREE, runtime, scene, heightfield, compact, onChange, onFollow, onLeave }) {
    const enter = document.getElementById('enterCharacter');
    const panel = document.getElementById('characterPanel');
    const pad = document.getElementById('characterPad');
    const status = document.getElementById('characterStatus');
    const outfit = document.getElementById('characterOutfit');
    const dance = document.getElementById('characterDance');
    const perform = document.getElementById('characterPerform');
    const freeze = document.getElementById('characterPause');
    const timeline = document.getElementById('characterTimeline');
    const canvas = document.getElementById('view');
    const keys = new Set(), touches = new Map(), cache = new Map();
    const spawn = heightfield.spawn || [0,0,10], performance = heightfield.performance || [0,1.195,-.5];
    const position = new THREE.Vector3(...spawn);
    const origin = new THREE.Vector3();
    let avatar = null, active = false, disposed = false, loading = false, sequence = 0;
    let danceName = '', danceTime = 0, danceHeading = 0, elapsed = 0, dancePaused = false, phaseLabel = '';
    let currentOutfit = 'xu';
    let importedClip = null;
    let loadError = false, wantsFollow = false, firstPerson = false;
    const labels = { xu: '朱砂蟒袍', yuan: '粉青对襟褂', fan: '月白儒生褶子', fu: '百花水袖衣', laosheng: '墨绿员外袍', chou: '锦色短打' };
    const accepted = new Set(['w', 'a', 's', 'd', 'arrowup', 'arrowdown', 'arrowleft', 'arrowright']);
    const abort = new AbortController();
    panel.open = false;
    const listen = (target, type, handler, options = {}) => target.addEventListener(type, handler, { ...options, signal: abort.signal });
    function setStatus(message) { status.textContent = message; }
    function clearInput() { keys.clear(); touches.clear(); }
    function stopDance() {
      danceName = '';
      dancePaused = false;
      phaseLabel = '';
      freeze.disabled = true;
      timeline.disabled = true;
      timeline.value = '0';
      freeze.textContent = '定格动作';
      freeze.setAttribute('aria-pressed', 'false');
      perform.textContent = '开始表演';
      perform.setAttribute('aria-pressed', 'false');
    }
    function sync() {
      panel.hidden = !active && !loading && !loadError;
      pad.hidden = !active;
      enter.disabled = loading;
      enter.textContent = loading ? '人物入场中…' : (active ? '人物已入场' : (avatar ? '跟随人物' : '人物入场'));
      enter.setAttribute('aria-pressed', String(active));
      for (const id of ['characterOutfit', 'characterStage', 'characterCourtyard', 'characterDance', 'characterPerform']) document.getElementById(id).disabled = loading || !avatar;
      document.body.classList.toggle('character-active', active);
    }
    function disposeAvatar(item) {
      if (!item) return;
      item.root.removeFromParent();
      runtime.VRMUtils.deepDispose(item.vrm.scene);
    }
    function follow() {
      if (!avatar || disposed) return;
      active = true;
      avatar.root.visible = !firstPerson;
      clearInput();
      sync();
      onFollow();
      canvas.focus({ preventScroll: true });
    }
    async function load(id) {
      const request = ++sequence;
      loading = true;
      loadError = false;
      wantsFollow = true;
      sync();
      setStatus(`正在准备戏装 · ${labels[id]}`);
      try {
        let next = cache.get(id);
        if (!next) {
          const { GLTFLoader, MeshoptDecoder, VRMLoaderPlugin, VRMUtils } = runtime;
          next = await window.loadYueOperaVrm(THREE, GLTFLoader, MeshoptDecoder, VRMLoaderPlugin, VRMUtils, scene, `/assets/3d-stage/vroid/costumes/${id}.web.vrm?v=20260820`, id, compact, 4, event => {
            if (disposed || request !== sequence) return;
            setStatus(`正在准备戏装 · ${labels[id]}${event.total ? ` ${Math.min(99, Math.round(event.loaded / event.total * 100))}%` : ''}`);
          });
          if (disposed || request !== sequence) { disposeAvatar(next); return; }
          cache.set(id, next);
        }
        const rotation = avatar ? avatar.root.rotation.y : Math.PI;
        if (avatar) avatar.root.visible = false;
        avatar = next;
        if(importedClip)avatar.setImportedMotion(importedClip);
        avatar.root.position.copy(position);
        avatar.root.rotation.y = rotation;
        avatar.root.visible = !firstPerson;
        avatar.animateIdle(elapsed, 0);
        currentOutfit = id;
        loading = false;
        // Keep at most two loaded costumes; all six remain available on demand.
        while (cache.size > 2) {
          const victim = [...cache.keys()].find(key => key !== id);
          disposeAvatar(cache.get(victim)); cache.delete(victim);
        }
        setStatus(`已入场 · ${labels[id]}`);
        if (wantsFollow) follow();
        else sync();
      } catch (error) {
        if (disposed || request !== sequence) return;
        loading = false;
        loadError = true;
        panel.open = true;
        outfit.value = currentOutfit;
        setStatus(avatar ? '换装暂未完成，已保留当前人物' : '人物未能载入，请点「人物入场」重试');
        console.warn('戏院人物加载失败', error);
        sync();
      }
      onChange();
    }
    function pause() {
      active = false;
      wantsFollow = false;
      loadError = false;
      clearInput();
      stopDance();
      avatar?.animateIdle(elapsed, 0);
      sync();
    }
    function place(onStage) {
      stopDance();
      clearInput();
      position.set(...(onStage?performance:spawn));
      if (avatar) { avatar.root.position.copy(position); avatar.root.rotation.y = Math.PI; }
      setStatus(onStage ? '已到临水台 · 可演示身段，也可走下石阶' : '已回到月门前 · 可沿曲径自由游园');
      follow();
    }
    function toggleDance() {
      if (!avatar || !active) return;
      if (danceName) stopDance();
      else {
        clearInput();
        danceName = dance.value;
        danceTime = 0;
        dancePaused = false;
        phaseLabel = '';
        freeze.disabled = false;
        timeline.disabled = false;
        timeline.value = '0';
        origin.copy(position);
        danceHeading = avatar.root.rotation.y;
        perform.textContent = '停止表演';
        perform.setAttribute('aria-pressed', 'true');
        setStatus('正在表演 · 走动可恢复自由游览');
      }
      canvas.focus({ preventScroll: true });
      onChange();
    }
    // A small body radius prevents the avatar's centre getting too close to a wall.
    function canStand(x, z, refY) {
      return [[0, 0], [.23, 0], [-.23, 0], [0, .23], [0, -.23]].every(([dx, dz]) => !heightfield.sample(x + dx, z + dz, refY, .55).blocked);
    }
    function tryMove(dx, dz) {
      if (Math.abs(dx) + Math.abs(dz) < 1e-8) return false;
      const x = position.x + dx, z = position.z + dz;
      if (!canStand(x, z, position.y)) return false;
      position.x = x; position.z = z;
      position.y = heightfield.sample(x, z, position.y, .55).ground;
      return true;
    }
    function update(delta, time, yaw, playbackDelta=delta) {
      elapsed = time;
      if (!active || !avatar) return;
      const down = key => keys.has(key);
      const touch = value => [...touches.values()].includes(value);
      const forward = Number(down('w') || down('arrowup') || touch('forward')) - Number(down('s') || down('arrowdown') || touch('back'));
      const side = Number(down('d') || down('arrowright') || touch('right')) - Number(down('a') || down('arrowleft') || touch('left'));
      if (forward || side) {
        stopDance();
        const direction = new THREE.Vector3(-Math.sin(yaw) * forward + Math.cos(yaw) * side, 0, -Math.cos(yaw) * forward - Math.sin(yaw) * side).normalize();
        let moved = false;
        const length = delta * 2.65, steps = Math.max(1, Math.ceil(length / .07));
        for (let i = 0; i < steps; i++) {
          const dx = direction.x * length / steps, dz = direction.z * length / steps;
          moved = (tryMove(dx, dz) || tryMove(dx, 0) || tryMove(0, dz)) || moved;
        }
        avatar.root.position.copy(position);
        const target = Math.atan2(direction.x, direction.z), current = avatar.root.rotation.y;
        const difference = Math.atan2(Math.sin(target - current), Math.cos(target - current));
        avatar.root.rotation.y += difference * (1 - Math.exp(-delta * 12));
        if (moved) avatar.animateWalk(elapsed, 1, delta);
        else avatar.animateIdle(elapsed, delta);
      } else if (danceName) {
        if (!dancePaused) {
          danceTime += ['rehearsal','imported'].includes(danceName)?playbackDelta:delta;
          avatar.animateDance(danceName, danceTime, origin, danceHeading, delta);
        }
        const motion = avatar.getMotionState?.();
        if (motion) {
          canvas.dataset.motionPhase = motion.phase.toFixed(3);
          canvas.dataset.motionName = danceName;
          canvas.dataset.motionTime = danceTime.toFixed(3);
          timeline.value = String(motion.phase * 100);
          timeline.setAttribute('aria-valuetext', `${Math.round(motion.phase * 100)}% · ${motion.label}`);
          const label = `${dancePaused ? '定格 · ' : ''}${motion.name} · ${motion.label}`;
          if (label !== phaseLabel) { setStatus(label); phaseLabel = label; }
        }
        const next = avatar.root.position;
        if (canStand(next.x, next.z, position.y)) {
          position.copy(next);
          position.y = heightfield.sample(next.x, next.z, position.y, .55).ground;
          avatar.root.position.y = position.y;
        } else { avatar.root.position.copy(position); stopDance(); }
      } else {
        avatar.root.position.copy(position);
        avatar.animateIdle(elapsed, delta);
      }
      // Reflected in the canvas for diagnostics without exposing internal scene objects.
      canvas.dataset.characterPosition = `${position.x.toFixed(3)},${position.y.toFixed(3)},${position.z.toFixed(3)}`;
    }
    listen(enter, 'click', () => avatar ? follow() : load(outfit.value));
    listen(outfit, 'change', () => { stopDance(); load(outfit.value); });
    listen(document.getElementById('characterStage'), 'click', () => place(true));
    listen(document.getElementById('characterCourtyard'), 'click', () => place(false));
    listen(document.getElementById('characterLeave'), 'click', () => { pause(); onLeave(); });
    listen(perform, 'click', toggleDance);
    listen(freeze, 'click', () => {
      if (!danceName) return;
      dancePaused = !dancePaused;
      freeze.textContent = dancePaused ? '继续动作' : '定格动作';
      freeze.setAttribute('aria-pressed', String(dancePaused));
      phaseLabel = '';
      onChange();
    });
    listen(timeline, 'input', () => {
      const motion = avatar?.getMotionState?.();
      if (!danceName || !motion?.duration) return;
      danceTime = Number(timeline.value) / 100 * motion.duration;
      dancePaused = true;
      freeze.textContent = '继续动作';
      freeze.setAttribute('aria-pressed', 'true');
      avatar.animateDance(danceName, danceTime, origin, danceHeading, 0);
      avatar.settleMotion?.();
      phaseLabel = '';
      onChange();
    });
    listen(dance, 'change', () => { stopDance(); canvas.focus({ preventScroll: true }); });
    listen(window, 'keydown', event => {
      if (event.ctrlKey || event.metaKey || event.altKey) return;
      if (!active || /^(INPUT|SELECT|TEXTAREA)$/.test(event.target?.tagName) || event.target?.isContentEditable) return;
      const key = event.key.toLowerCase();
      if (accepted.has(key)) { event.preventDefault(); keys.add(key); onChange(); }
    });
    listen(window, 'keyup', event => keys.delete(event.key.toLowerCase()));
    listen(window, 'blur', clearInput);
    listen(document, 'visibilitychange', clearInput);
    document.querySelectorAll('[data-move]').forEach(button => {
      listen(button, 'pointerdown', event => { event.preventDefault(); button.setPointerCapture(event.pointerId); touches.set(event.pointerId, button.dataset.move); onChange(); });
      for (const type of ['pointerup', 'pointercancel', 'lostpointercapture']) listen(button, type, event => touches.delete(event.pointerId));
    });
    sync();
    return {
      get active() { return active; }, get ready() { return !!avatar; }, position,
      get rehearsalTime(){return danceName==='rehearsal'?danceTime:null;},
      get performanceTime(){return danceName==='imported'||danceName==='rehearsal'?danceTime:null;},
      get performanceDuration(){return danceName==='imported'?importedClip.duration:60;},
      get importedReady(){return !!importedClip;},
      get performanceFocus(){return avatar?.getDanceFocus();},
      setImportedMotion(clip){importedClip=clip;avatar?.setImportedMotion(clip);if(!dance.querySelector('option[value="imported"]')){const option=document.createElement('option');option.value='imported';option.textContent='寄明月 · 本地舞蹈';dance.append(option);}},
      async startImported(){
        if(loading||!importedClip)return false;
        if(!avatar){outfit.value='yuan';await load('yuan');}
        if(!avatar||disposed)return false;
        avatar.setImportedMotion(importedClip);place(true);dance.value='imported';toggleDance();return true;
      },
      async startRehearsal(){
        if(loading)return false;
        if(!avatar){outfit.value='fu';await load('fu');}
        if(!avatar||disposed)return false;
        place(true);dance.value='rehearsal';toggleDance();return true;
      },
      stopRehearsal(){stopDance();},
      update, pause, clearInput,
      setFirstPerson(value) { firstPerson=!!value; if(avatar)avatar.root.visible=!firstPerson; },
      dispose() { disposed = true; ++sequence; abort.abort(); clearInput(); cache.forEach(disposeAvatar); cache.clear(); }
    };
  };
})();
