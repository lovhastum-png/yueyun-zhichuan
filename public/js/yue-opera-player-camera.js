/* Player views share one heading, so switching view never changes walking direction. */
(function () {
  'use strict';
  window.createYueOperaPlayerCamera = function (THREE, camera, heightfield) {
    let mode = 'third', yaw = 0, elevation = -.12, distance = 5.2, boom = distance;
    const eye = new THREE.Vector3(), forward = new THREE.Vector3(), probe = new THREE.Vector3();
    const minElevation = -Math.PI* .42, maxElevation = Math.PI* .48;
    function setMode(value) { mode = value === 'first' ? 'first' : 'third'; }
    function rotate(dx,dy) { yaw -= dx*.006; elevation = THREE.MathUtils.clamp(elevation-dy*.005,minElevation,maxElevation); }
    function zoom(delta) { if(mode === 'third') distance = THREE.MathUtils.clamp(distance+delta*.012,2.6,8); }
    function place(position) {
      eye.copy(position); eye.y += 1.78;
      if (mode === 'first') { camera.position.copy(eye); boom = 0; }
      else {
        boom = distance;
        // Shorten the camera arm at the existing authored building boundaries.
        // Never put the camera on the far side of a courtyard wall or house.
        for(let d=.25;d<=distance;d+=.25) {
          probe.set(eye.x+Math.sin(yaw)*d,eye.y+.55,eye.z+Math.cos(yaw)*d);
          const blocked=heightfield.cameraBlocked?
            [[0,0],[.18,0],[-.18,0],[0,.18],[0,-.18]].some(([dx,dz])=>heightfield.cameraBlocked(probe.x+dx,probe.y,probe.z+dz)):
            heightfield?.sample(probe.x,probe.z,position.y,100).blocked;
          if(blocked) { boom=Math.max(.35,d-.3); break; }
        }
        camera.position.set(eye.x+Math.sin(yaw)*boom,eye.y+.55,eye.z+Math.cos(yaw)*boom);
      }
    }
    function update(position) {
      const fov=mode==='first'?70:55;
      if(camera.fov!==fov){camera.fov=fov;camera.updateProjectionMatrix();}
      place(position);
      forward.set(-Math.sin(yaw)*Math.cos(elevation),Math.sin(elevation),-Math.cos(yaw)*Math.cos(elevation));
      probe.copy(camera.position).add(forward); camera.lookAt(probe);
      camera.updateMatrixWorld(true);
    }
    function lookAt(target,position) {
      eye.copy(position);eye.y+=1.78;
      yaw=Math.atan2(eye.x-target.x,eye.z-target.z);place(position);
      elevation=THREE.MathUtils.clamp(Math.atan2(target.y-camera.position.y,Math.hypot(target.x-camera.position.x,target.z-camera.position.z)),minElevation,maxElevation);
    }
    return {
      get mode(){return mode;},get yaw(){return yaw;},get elevation(){return elevation;},get distance(){return distance;},get boom(){return boom;},
      setMode,rotate,zoom,update,lookAt,
      level(){elevation=-.08;},
      reset(){yaw=0;elevation=-.12;distance=5.2;},
      snapshot(){return {mode,yaw:+yaw.toFixed(3),elevation:+elevation.toFixed(3),distance:+boom.toFixed(2),position:camera.position.toArray().map(n=>+n.toFixed(3))};}
    };
  };
})();
