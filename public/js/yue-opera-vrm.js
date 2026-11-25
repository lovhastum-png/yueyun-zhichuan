/* Original VRoid characters with authored opera choreography and damped sleeve dynamics. */
    window.loadYueOperaVrm = async function (THREE, GLTFLoader, MeshoptDecoder, VRMLoaderPlugin, VRMUtils, scene, modelUrl, modelId, compactDevice, anisotropy, onProgress) {
      const vrmLoader = new GLTFLoader();
      if (MeshoptDecoder) vrmLoader.setMeshoptDecoder(MeshoptDecoder);
      vrmLoader.register((parser) => new VRMLoaderPlugin(parser));

      const gltf = await vrmLoader.loadAsync(modelUrl, onProgress);
      const vrm = gltf.userData.vrm;
      if (!vrm) throw new Error('文件中未找到 VRM 人形数据');

      if (typeof VRMUtils.rotateVRM0 === 'function') VRMUtils.rotateVRM0(vrm);
      const model = vrm.scene;
      // The original sleeve chains had a zero gravity direction, leaving fabric floating in loops.
      for (const joint of vrm.springBoneManager?.joints || []) {
        if (!/shui/i.test(joint.bone.name)) continue;
        joint.settings.gravityDir.set(0, -1, 0);
        joint.settings.gravityPower = 1.15;
        joint.settings.stiffness = .38;
        joint.settings.dragForce = .74;
      }
      model.name = `Yueju_VRoid_${modelId}`;
      model.traverse((object) => {
        if (!object.isMesh) return;
        object.castShadow = !compactDevice;
        object.receiveShadow = true;
        object.frustumCulled = false;
        const materials = Array.isArray(object.material) ? object.material : [object.material];
        materials.forEach((material) => {
          if (!material) return;
          if (material.map) material.map.anisotropy = anisotropy;
          // three-vrm 会为 MToon 自动追加背面描边材质；描边若被改成双面，会从正面盖黑脸部。
          if (material.isOutline || /\(Outline\)$/i.test(material.name)) material.side = THREE.BackSide;
          material.needsUpdate = true;
        });
      });

      model.updateMatrixWorld(true);
      const originalBounds = new THREE.Box3().setFromObject(model);
      const originalSize = originalBounds.getSize(new THREE.Vector3());
      const modelScale = 2.18 / Math.max(0.1, originalSize.y);
      model.scale.setScalar(modelScale);
      model.updateMatrixWorld(true);
      const scaledBounds = new THREE.Box3().setFromObject(model);
      const modelBaseY = model.position.y - scaledBounds.min.y;
      model.position.y = modelBaseY;

      const root = new THREE.Group();
      root.name = `Yueju_VRoid_Controller_${modelId}`;
      root.visible = false;
      root.add(model);
      scene.add(root);

      const humanoid = vrm.humanoid;
      const expressionManager = vrm.expressionManager;
      const bone = (name) => humanoid.getNormalizedBoneNode(name);
      const rotate = (name, x = 0, y = 0, z = 0) => {
        const node = bone(name);
        if (node) node.rotation.set(x, y, z);
      };

      const resetPose = () => {
        humanoid.resetNormalizedPose();
        model.position.y = modelBaseY;
      };

      const motion = window.createYueOperaMotion(THREE, { vrm, model, root, baseY: modelBaseY });
      const imported = window.createYueOperaVMD(THREE, { vrm, model, root, baseY: modelBaseY });
      let importedPlaying = false;
      const updateFaceAndPhysics = (elapsed, delta) => vrm.update(delta);
      const poseTracked = (tracked, elapsed, delta) => {
        resetPose();
        const solveArm = (side, upperName, lowerName, handName) => {
          const limb = tracked[side];
          const sign = side === 'left' ? 1 : -1;
          const upperDx = limb.elbow.x - limb.shoulder.x;
          const upperDy = limb.elbow.y - limb.shoulder.y;
          const upperDepth = THREE.MathUtils.clamp((limb.shoulder.z - limb.elbow.z) * 1.2, -0.72, 0.72);
          const lift = THREE.MathUtils.clamp(-upperDy, -1.15, 1.35);
          const outward = THREE.MathUtils.clamp(Math.abs(upperDx), 0, 1.2);
          const upperZ = sign * THREE.MathUtils.clamp(1.18 - lift * 0.72 - outward * 0.28, -0.28, 1.46);
          const firstX = limb.shoulder.x - limb.elbow.x;
          const firstY = limb.shoulder.y - limb.elbow.y;
          const secondX = limb.wrist.x - limb.elbow.x;
          const secondY = limb.wrist.y - limb.elbow.y;
          const dot = firstX * secondX + firstY * secondY;
          const lengths = Math.max(0.001, Math.hypot(firstX, firstY) * Math.hypot(secondX, secondY));
          const bend = Math.PI - Math.acos(THREE.MathUtils.clamp(dot / lengths, -1, 1));
          rotate(upperName, upperDepth, 0, upperZ);
          rotate(lowerName, sign * bend * 0.34, 0, sign * bend * 0.72);
          rotate(handName, 0, sign * 0.12, sign * 0.12);
        };
        solveArm('left', 'leftUpperArm', 'leftLowerArm', 'leftHand');
        solveArm('right', 'rightUpperArm', 'rightLowerArm', 'rightHand');
        const tilt = THREE.MathUtils.clamp(tracked.shoulderTilt || 0, -0.55, 0.55);
        rotate('spine', 0.02, 0, -tilt * 0.28);
        rotate('chest', -0.015, 0, -tilt * 0.42);
        if (tracked.nose) {
          rotate('head', -0.03, THREE.MathUtils.clamp(-tracked.nose.x * 0.22, -0.35, 0.35), -tilt * 0.18);
        }
        model.position.y = modelBaseY + Math.sin(elapsed * 1.5) * 0.004;
        updateFaceAndPhysics(elapsed, delta);
      };

      const settleMotion = () => {
        model.updateMatrixWorld(true);
        vrm.springBoneManager?.reset();
        for (let frame = 0; frame < 45; frame++) vrm.update(1 / 60);
      };
      motion.idle(0, 0);
      settleMotion();
      return {
        root, vrm, modelId,
        getDanceFocus: () => bone('hips').getWorldPosition(new THREE.Vector3()),
        setImportedMotion: imported.setClip,
        animateIdle(...args) { importedPlaying=false;imported.hide();motion.idle(...args); },
        animateWalk(...args) { importedPlaying=false;imported.hide();motion.walk(...args); },
        animateTrackedPose: poseTracked,
        animateDance(name,...args) { importedPlaying=name==='imported';if(importedPlaying)imported.play(...args);else{imported.hide();motion.dance(name,...args);} },
        getMotionState: () => importedPlaying?imported.state:motion.state,
        settleMotion
      };
    };
