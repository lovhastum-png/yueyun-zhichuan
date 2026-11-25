/* Koi Fish by 7PLUS, CC BY 4.0. Plays the artist's original baked swim clip.
 * Attribution: /assets/3d-stage/sky-koi/ASSET-SOURCE.md
 */
(function () {
  'use strict';
  window.createYueOperaSkyKoi = function (THREE, scene, compact = false) {
    const assetUrl = '/assets/3d-stage/sky-koi/yueyun-sky-koi.glb?v=7plus-20261022';
    const root = new THREE.Group(); root.name = '云游锦鲤 · 7PLUS';
    const model = new THREE.Group(); model.name = '公开锦鲤 · 作者原版游泳动画';
    root.add(model); scene.add(root);
    const stats = { name: root.name, author: '7PLUS', license: 'CC BY 4.0', original: false,
      length: 78, orbitSeconds: 136, loaded: false, style: 'ink', animationType: 'author-baked morph animation',
      flightAction: '巡天盘旋', flightPattern: 'closed multi-pass spline with bank, climb, glide and barrel roll' };
    let elapsed = 0, paused = false, night = false, disposed = false, mixer = null, asset = null;
    let manualRollStart = -Infinity;
    const materials = new Set(), geometries = new Set(), textures = new Set();
    const styledMeshes = [];
    const eyes = [];
    const axis = new THREE.Vector3(0, 1, 0);
    // One continuous route: outer orbit, a high crossing, a low courtyard pass,
    // then a rising return. Arc-length sampling avoids speed jumps at waypoints.
    const flightCurve = new THREE.CatmullRomCurve3([
      [-34,49,-38],[8,53,-60],[55,61,-32],[62,69,18],[24,73,51],
      [-20,59,35],[-54,45,12],[-42,44,-28],[-8,53,-20],[28,67,8],
      [36,78,40],[2,79,54],[-38,68,30],[-60,56,-8],[-44,50,-48],
      [0,54,-56],[44,48,-30],[45,45,14],[0,49,30],[-32,55,6]
    ].map(p => new THREE.Vector3(...p)), true, 'centripetal');
    flightCurve.arcLengthDivisions = 1600;
    const smooth = x => { x = THREE.MathUtils.clamp(x, 0, 1); return x*x*x*(x*(x*6-15)+10); };
    const wrap = x => ((x % 1) + 1) % 1;
    const angleDelta = x => Math.atan2(Math.sin(x), Math.cos(x));
    const rollWindows = [[.04,.095],[.39,.445],[.735,.79]];
    function automaticRoll(u) {
      for (const [start,end] of rollWindows) if (u >= start && u < end) return { active: true, angle: smooth((u-start)/(end-start))*Math.PI*2 };
      return { active: false, angle: 0 };
    }
    function sampleFlight(seconds) {
      const u = wrap(seconds / stats.orbitSeconds);
      const position = flightCurve.getPointAt(u), tangent = flightCurve.getTangentAt(u);
      const next = flightCurve.getTangentAt(wrap(u+.001));
      const yaw = Math.atan2(-tangent.z,tangent.x), nextYaw = Math.atan2(-next.z,next.x);
      const bank = THREE.MathUtils.clamp(-angleDelta(nextYaw-yaw) / (.001*stats.orbitSeconds) * 1.1, -.48, .48);
      const roll = automaticRoll(u);
      return { position, yaw, pitch: Math.atan2(tangent.y,Math.hypot(tangent.x,tangent.z)),
        bank, roll: roll.angle, speed: .78 + .28*Math.pow(Math.sin(u*Math.PI*4),2),
        action: roll.active ? '腾空翻滚' : tangent.y > .18 ? '抬头攀升' : tangent.y < -.16 ? '俯身掠游' : Math.abs(bank)>.24 ? '侧身回旋' : '巡天盘旋' };
    }
    function requestRoll() {
      if (elapsed-manualRollStart < 7.5 || automaticRoll(wrap(elapsed/stats.orbitSeconds)).active) return false;
      manualRollStart = elapsed; return true;
    }
    const eyeNormal = new THREE.Vector3(), morphNormal = new THREE.Vector3();
    function update(delta = 0) {
      const step = Math.max(0, Math.min(delta, .1));
      if (!paused) { elapsed += step; mixer?.update(step * sampleFlight(elapsed).speed); }
      const pose = sampleFlight(elapsed);
      const manual = (elapsed-manualRollStart)/7.5, manualActive = manual >= 0 && manual < 1;
      const u = wrap(elapsed/stats.orbitSeconds), lapStart = elapsed-u*stats.orbitSeconds;
      const suppressAuto = rollWindows.some(([a,b]) => u>=a && u<b && lapStart+a*stats.orbitSeconds>=manualRollStart && lapStart+a*stats.orbitSeconds<manualRollStart+9);
      const roll = manualActive ? smooth(manual)*Math.PI*2 : suppressAuto ? 0 : pose.roll;
      // Banking is about the fish's forward (+X) axis, after pitching into the path.
      // The camera keeps a level horizon during the full body roll.
      if (manualActive) pose.position.y += Math.sin(manual*Math.PI)**2*9;
      root.position.copy(pose.position); root.quaternion.setFromAxisAngle(axis, pose.yaw);
      model.rotation.set(pose.bank+roll, 0, pose.pitch, 'ZYX'); root.updateMatrixWorld(true);
      stats.flightAction = manualActive ? '腾空翻滚' : suppressAuto ? '巡天盘旋' : pose.action;
      stats.flightTime = +elapsed.toFixed(2); stats.roll = +roll.toFixed(3); stats.bank = +pose.bank.toFixed(3);
      for (const eye of eyes) {
        eye.mesh.getVertexPosition(eye.vertex, eye.object.position);
        const normal = eyeNormal.fromBufferAttribute(eye.mesh.geometry.attributes.normal, eye.vertex);
        const targets = eye.mesh.geometry.morphAttributes.normal || [];
        for (let i = 0; i < targets.length; i++) if (eye.mesh.morphTargetInfluences[i]) normal.addScaledVector(morphNormal.fromBufferAttribute(targets[i], eye.vertex), eye.mesh.morphTargetInfluences[i]);
        eye.object.position.addScaledVector(normal.normalize(), .03);
      }
    }
    function setNight(value) {
      night = !!value;
      materials.forEach(material => {
        if (material.userData.koiRole === 'outline') {
          material.emissive.copy(material.color); material.emissiveIntensity = night ? .18 : 0;
        } else {
          material.emissive?.set(stats.style === 'ink' ? '#63736f' : '#f1e6ce'); material.emissiveIntensity = night ? .20 : 0;
        }
      });
    }
    function setStyle(value) {
      stats.style = ['ink','white','pastel'].includes(value) ? value : 'ink';
      for (const item of styledMeshes) {
        const colours = item.mesh.geometry.getAttribute('color');
        if (colours) { colours.array.set(item.colours[stats.style]); colours.needsUpdate = true; }
        else item.mesh.geometry.setAttribute('color', new THREE.Float32BufferAttribute(item.colours[stats.style], 3));
        item.inkUniform.value = stats.style === 'ink' ? 1 : 0;
        item.outline.material.color.set(stats.style === 'ink' ? '#344540' : stats.style === 'white' ? '#bdc5bc' : '#71877c');
      }
      eyes.forEach(eye => { eye.object.visible = stats.style !== 'white'; eye.object.material.color.set(stats.style === 'ink' ? '#142522' : '#61756b'); });
      setNight(night);
    }
    function softenMesh(mesh) {
      const position = mesh.geometry.attributes.position, white = [], pastel = [], inkColours = [];
      const ivory = new THREE.Color('#f3eee2'), peach = new THREE.Color('#e8b58c'), mint = new THREE.Color('#b4cec5');
      const paper = new THREE.Color('#f0ecdd'), wash = new THREE.Color('#79918b'), deepInk = new THREE.Color('#172e2d');
      for (let i = 0; i < position.count; i++) {
        const x = position.getX(i), y = position.getY(i), z = position.getZ(i);
        const upper = THREE.MathUtils.smoothstep(y, -.15, 1.3);
        const lower = 1 - THREE.MathUtils.smoothstep(y, -.9, .1);
        const fins = Math.max(THREE.MathUtils.smoothstep(Math.abs(x), 1.7, 3.4), THREE.MathUtils.smoothstep(Math.abs(z), .65, 1.2));
        const a = ivory.clone().lerp(peach, upper * .045).lerp(mint, lower * .035);
        const b = ivory.clone().lerp(peach, Math.max(upper * .52, fins * .65)).lerp(mint, lower * (1-fins*.65) * .34);
        white.push(a.r, a.g, a.b); pastel.push(b.r, b.g, b.b);
        // Broad hand-placed washes: a dark dorsal stroke, separate shoulder and
        // tail strokes, and a large unpainted belly. Not photographic scales.
        const cloud = Math.sin(x*2.6+z*3.4)*.14+Math.sin(x*5.7-y*3.9+z)*.07;
        const back = THREE.MathUtils.smoothstep(y+cloud, -.08, .95);
        const shoulder = Math.exp(-((x-1.1)**2/.40+(y-.28)**2/.65+(z+.14)**2/2.4));
        const tail = (1-THREE.MathUtils.smoothstep(x,-2.8,-1.1))*(.45+.25*Math.sin(y*6+z*2));
        const amount = THREE.MathUtils.clamp(back*.89+shoulder*.53+tail*.75,0,.97);
        const c = paper.clone().lerp(wash,Math.min(1,amount*2)).lerp(deepInk,THREE.MathUtils.smoothstep(amount,.20,.92));
        inkColours.push(c.r,c.g,c.b);
      }
      // The photographic maps and scale normal map are intentionally unused.
      // Soft colours are attached to the original vertices, so all 150 authored
      // morph poses retain their native motion without texture swimming.
      const body = new THREE.MeshStandardMaterial({ color: '#ffffff', vertexColors: true, roughness: .94, metalness: 0 });
      body.name = '锦鲤 · 水墨 / 奶油白 / 淡彩哑光'; body.userData.koiRole = 'body'; materials.add(body); mesh.material = body;
      const inkUniform = { value: 1 };
      body.onBeforeCompile = shader => {
        shader.uniforms.uKoiInk = inkUniform;
        shader.vertexShader = 'varying vec3 vKoiRest;\n'+shader.vertexShader;
        shader.vertexShader = shader.vertexShader.replace('#include <begin_vertex>', '#include <begin_vertex>\nvKoiRest = position;');
        shader.fragmentShader = `uniform float uKoiInk;
varying vec3 vKoiRest;
float koiHash(vec3 p){return fract(sin(dot(p,vec3(127.1,311.7,74.7)))*43758.5453);}
float koiNoise(vec3 p){vec3 i=floor(p),f=fract(p);f=f*f*(3.0-2.0*f);
return mix(mix(mix(koiHash(i),koiHash(i+vec3(1,0,0)),f.x),mix(koiHash(i+vec3(0,1,0)),koiHash(i+vec3(1,1,0)),f.x),f.y),mix(mix(koiHash(i+vec3(0,0,1)),koiHash(i+vec3(1,0,1)),f.x),mix(koiHash(i+vec3(0,1,1)),koiHash(i+vec3(1,1,1)),f.x),f.y),f.z);}
`+shader.fragmentShader;
        shader.fragmentShader = shader.fragmentShader.replace('#include <color_fragment>', `#include <color_fragment>
if(uKoiInk>0.5){
  float wash=koiNoise(vKoiRest*vec3(3.0,5.0,4.0));
  float fibres=koiNoise(vKoiRest*vec3(30.0,95.0,55.0));
  float dry=smoothstep(0.62,0.82,koiNoise(vKoiRest*vec3(12.0,95.0,45.0)));
  float pigment=(1.0-smoothstep(0.25,0.72,diffuseColor.r));
  diffuseColor.rgb*=mix(0.78,1.12,wash)*mix(0.93,1.035,fibres);
  diffuseColor.rgb=mix(diffuseColor.rgb,vec3(0.42,0.48,0.44),dry*pigment*0.12);
}`);
      };
      body.customProgramCacheKey = () => 'yueyun-ink-wash-v1';
      const ink = new THREE.MeshStandardMaterial({ color: '#bdc5bc', roughness: 1, metalness: 0, side: THREE.BackSide });
      ink.name = '锦鲤 · 柔和细描边'; ink.userData.koiRole = 'outline';
      ink.onBeforeCompile = shader => {
        shader.vertexShader = shader.vertexShader.replace('#include <displacementmap_vertex>', '#include <displacementmap_vertex>\ntransformed += normalize(objectNormal) * 0.008;');
      };
      ink.customProgramCacheKey = () => 'yueyun-soft-koi-outline-v1'; materials.add(ink);
      const outline = mesh.clone(false); outline.name = mesh.name + '_softOutline'; outline.material = ink;
      outline.morphTargetInfluences = mesh.morphTargetInfluences;
      outline.frustumCulled = false; outline.castShadow = false; outline.receiveShadow = false;
      mesh.parent.add(outline);
      styledMeshes.push({ mesh, outline, inkUniform, colours: { white, pastel, ink: inkColours } });
      const eyeGeometry = new THREE.SphereGeometry(.065, 12, 8);
      const eyeMaterial = new THREE.MeshStandardMaterial({ color: '#61756b', roughness: 1, metalness: 0 });
      eyeMaterial.userData.koiRole = 'eye'; geometries.add(eyeGeometry); materials.add(eyeMaterial);
      for (const side of [-1, 1]) {
        const target = new THREE.Vector3(2.4, .1, side*.60); let vertex = 0, best = Infinity;
        for (let i = 0; i < position.count; i++) {
          const distance = new THREE.Vector3().fromBufferAttribute(position, i).distanceToSquared(target);
          if (distance < best) { best = distance; vertex = i; }
        }
        const eye = new THREE.Mesh(eyeGeometry, eyeMaterial); eye.name = '锦鲤·小圆眼'; eye.visible = false; mesh.add(eye);
        eyes.push({ mesh, object: eye, vertex });
      }
    }
    function exportStyledGLB(source) {
      const input = new DataView(source), jsonLength = input.getUint32(12, true);
      const doc = JSON.parse(new TextDecoder().decode(new Uint8Array(source, 20, jsonLength)));
      const binOffset = 28 + jsonLength, originalLength = input.getUint32(20 + jsonLength, true);
      const aligned = Math.ceil(originalLength / 4) * 4;
      const colours = new Float32Array(styledMeshes[0].colours[stats.style]);
      const binary = new Uint8Array(aligned + colours.byteLength);
      binary.set(new Uint8Array(source, binOffset, originalLength)); binary.set(new Uint8Array(colours.buffer), aligned);
      const view = doc.bufferViews.length; doc.bufferViews.push({ buffer: 0, byteOffset: aligned, byteLength: colours.byteLength, target: 34962 });
      const attribute = doc.accessors.length; doc.accessors.push({ bufferView: view, componentType: 5126, count: colours.length / 3, type: 'VEC3' });
      doc.meshes[0].primitives[0].attributes.COLOR_0 = attribute;
      doc.materials = [{ name: {ink:'水墨锦鲲 · 顶点色',white:'奶油白模 · 哑光',pastel:'淡橙浅青 · 哑光'}[stats.style], pbrMetallicRoughness: { baseColorFactor: [1,1,1,1], roughnessFactor: .94, metallicFactor: 0 } }];
      doc.meshes[0].primitives[0].material = 0;
      doc.buffers[0].byteLength = binary.byteLength;
      doc.asset.extras = { ...doc.asset.extras, changes: 'Yueyun: photographic maps disabled; matte vertex colours added; original MorphBake animation preserved. Web ink grain, outlines, eyes and world flight choreography are runtime effects.', renderStyle: stats.style };
      const json = new TextEncoder().encode(JSON.stringify(doc)), length = Math.ceil(json.length / 4) * 4;
      const result = new ArrayBuffer(28 + length + binary.byteLength), out = new DataView(result), bytes = new Uint8Array(result);
      out.setUint32(0,0x46546c67,true); out.setUint32(4,2,true); out.setUint32(8,result.byteLength,true);
      out.setUint32(12,length,true); out.setUint32(16,0x4e4f534a,true); bytes.fill(32,20,20+length); bytes.set(json,20);
      out.setUint32(20+length,binary.byteLength,true); out.setUint32(24+length,0x004e4942,true); bytes.set(binary,28+length);
      return result;
    }
    function release(object) {
      object.traverse(o => {
        if (o.geometry) geometries.add(o.geometry);
        for (const m of o.material ? (Array.isArray(o.material) ? o.material : [o.material]) : []) materials.add(m);
      });
      for (const material of materials) for (const value of Object.values(material)) if (value?.isTexture) textures.add(value);
      geometries.forEach(g => g.dispose()); materials.forEach(m => m.dispose()); textures.forEach(t => t.dispose());
    }
    // A union of 150 morph bounds overestimates the fish; measure a real pose.
    function posedBounds(object) {
      const box = new THREE.Box3(), vertex = new THREE.Vector3(); object.updateMatrixWorld(true);
      object.traverse(mesh => {
        if (!mesh.isMesh) return;
        for (let i = 0; i < mesh.geometry.attributes.position.count; i++) {
          mesh.getVertexPosition(i, vertex); box.expandByPoint(vertex.applyMatrix4(mesh.matrixWorld));
        }
      });
      return box;
    }
    const ready = new window.Yueju3D.GLTFLoader().loadAsync(assetUrl).then(gltf => {
      if (disposed) { release(gltf.scene); return null; }
      const clip = gltf.animations.find(c => /morphbake|swim/i.test(c.name)) || gltf.animations[0];
      if (!clip || !clip.tracks.length) { release(gltf.scene); throw new Error('锦鲤文件缺少游泳动画'); }
      asset = gltf; mixer = new THREE.AnimationMixer(gltf.scene);
      mixer.clipAction(clip).setLoop(THREE.LoopRepeat, Infinity).play(); mixer.update(0);
      const bounds = posedBounds(gltf.scene), size = bounds.getSize(new THREE.Vector3());
      const normalization = new THREE.Group(); normalization.name = '巨型比例与居中';
      normalization.scale.setScalar(stats.length / size.x);
      gltf.scene.position.sub(bounds.getCenter(new THREE.Vector3())); normalization.add(gltf.scene); model.add(normalization);
      let triangles = 0, vertices = 0, meshes = 0, morphTargets = 0, skins = 0;
      const sourceMeshes = [];
      gltf.scene.traverse(mesh => {
        if (!mesh.isMesh) return;
        mesh.frustumCulled = false;
        mesh.castShadow = true;
        triangles += (mesh.geometry.index?.count || mesh.geometry.attributes.position.count) / 3;
        vertices += mesh.geometry.attributes.position.count; meshes++;
        morphTargets += mesh.morphTargetInfluences?.length || 0; if (mesh.isSkinnedMesh) skins++;
        geometries.add(mesh.geometry);
        sourceMeshes.push(mesh);
        for (const m of Array.isArray(mesh.material) ? mesh.material : [mesh.material]) {
          materials.add(m);
        }
      });
      sourceMeshes.forEach(softenMesh); setStyle(stats.style);
      Object.assign(stats, { loaded: true, triangles, vertices, meshes, morphTargets, skins,
        outlineMeshes: styledMeshes.length, photographicMaps: false,
        swimClip: clip.name, swimSeconds: clip.duration, animationClips: gltf.animations.length,
        wingSpan: +(size.z * normalization.scale.x).toFixed(2), height: +(size.y * normalization.scale.x).toFixed(2) });
      root.userData = { ...stats, source: 'https://sketchfab.com/3d-models/koi-fish-236859b809984f52b70c94fd040b9c59' };
      setNight(night); update(0); return gltf;
    });
    update(0);
    return { root, model, stats, ready, assetUrl, sampleFlight,
      get position() { return root.position; }, get paused() { return paused; },
      get mixer() { return mixer; }, get asset() { return asset; },
      update, requestRoll, setPaused(value) { paused = !!value; }, setNight, setStyle, exportStyledGLB,
      dispose() { disposed = true; mixer?.stopAllAction(); if (asset) mixer?.uncacheRoot(asset.scene); scene.remove(root); release(model); }
    };
  };
})();
