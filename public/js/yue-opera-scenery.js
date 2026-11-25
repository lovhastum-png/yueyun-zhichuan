/* Locally authored landscape extension; no remote models or textures. */
(function () {
  'use strict';
  window.createYueOperaScenery = function (THREE, scene, compact) {
    const root = new THREE.Group(); root.name = '碧波园 · 山林借景'; scene.add(root);
    const mats = [], day = [], moon = [];
    function material(color, night) {
      const m = new THREE.MeshStandardMaterial({ color, roughness: 1 });
      mats.push(m); day.push(new THREE.Color(color)); moon.push(new THREE.Color(night)); return m;
    }
    const mountainMats = [material('#8eaaa1','#263e4b'),material('#78968b','#203b45'),material('#668575','#1c3536')];
    // Three irregular, closed ridgelines. Grounded volumes instead of backdrop cards.
    for (let layer = 0; layer < 3; layer++) {
      const n = compact ? 120 : 220, positions = [], indices = [], radius = 145 - layer * 27;
      for (let i = 0; i <= n; i++) {
        const a = i / n * Math.PI * 2;
        const peak = 9 + 16 * Math.pow(.5 + .5 * Math.sin(a * 5 + layer), 2) + 8 * Math.sin(a * 11 + layer * 3) ** 2;
        for (const [r, y] of [[radius + 23,-2],[radius,peak],[radius - 19,-2]]) positions.push(Math.sin(a)*r,y,Math.cos(a)*r);
        if(i<n)for(let j=0;j<2;j++){const k=i*3+j;indices.push(k,k+3,k+1,k+1,k+3,k+4);}
      }
      const g=new THREE.BufferGeometry();g.setAttribute('position',new THREE.Float32BufferAttribute(positions,3));g.setIndex(indices);g.computeVertexNormals();
      const m=new THREE.Mesh(g,mountainMats[layer]);m.receiveShadow=true;root.add(m);
    }
    // Trees beyond the enclosure give the garden a setting without obstructing walks.
    const bark=material('#575548','#27352c'), foliage=material('#506e58','#1b3930');
    const count=compact?48:96, dummy=new THREE.Object3D();
    const trunks=new THREE.InstancedMesh(new THREE.CylinderGeometry(.18,.3,1,5),bark,count);
    const crownGeometry=new THREE.IcosahedronGeometry(1,compact?1:2);
    const cp=crownGeometry.attributes.position;
    for(let i=0;i<cp.count;i++){const x=cp.getX(i),y=cp.getY(i),z=cp.getZ(i),s=1+.07*Math.sin(x*11+z*9)*Math.cos(y*12);cp.setXYZ(i,x*s,y*s,z*s);}crownGeometry.computeVertexNormals();
    const crowns=new THREE.InstancedMesh(crownGeometry,foliage,count*3);
    for(let i=0;i<count;i++){
      const a=i*2.39996,r=51+(i%7)*2.4,x=Math.sin(a)*r,z=Math.cos(a)*r,h=4+(i%5)*.65;
      dummy.position.set(x,h/2-1,z);dummy.scale.set(1,h,1);dummy.rotation.set(0,a,0);dummy.updateMatrix();trunks.setMatrixAt(i,dummy.matrix);
      for(let k=0;k<3;k++){dummy.position.set(x+Math.sin(k*2.4+i)*1.25,h*.8+k*.45,z+Math.cos(k*2.4+i)*1.25);dummy.scale.set(1.8-k*.2,1.55+k*.13,1.8-k*.2);dummy.updateMatrix();crowns.setMatrixAt(i*3+k,dummy.matrix);}
    }
    root.add(trunks,crowns);
    // Warm pools of light around the pavilion, rather than extra shadow maps.
    const lamps=[];
    for(const [x,z] of [[-8,20],[8,20],[12,6.5],[-30,13]]){
      const light=new THREE.PointLight('#ffc580',0,12,2);light.position.set(x,2,z);root.add(light);lamps.push(light);
    }
    const countFire=compact?22:60, pos=new Float32Array(countFire*3),geom=new THREE.BufferGeometry();geom.setAttribute('position',new THREE.BufferAttribute(pos,3));
    const fireMat=new THREE.PointsMaterial({color:'#e4f5ae',size:.09,transparent:true,opacity:0,depthWrite:false,blending:THREE.AdditiveBlending});
    fireMat.onBeforeCompile=s=>{s.fragmentShader=s.fragmentShader.replace('#include <color_fragment>','#include <color_fragment>\nfloat glow=max(0.0,1.0-length(gl_PointCoord-vec2(.5))*2.0);diffuseColor.a*=glow*glow;');};
    const fire=new THREE.Points(geom,fireMat);fire.frustumCulled=false;root.add(fire);
    return {root, update(time,night){
      mats.forEach((m,i)=>m.color.copy(day[i]).lerp(moon[i],night));
      lamps.forEach(l=>l.intensity=night*17);fireMat.opacity=night*.8;fire.visible=night>.01;
      for(let i=0;i<countFire;i++){const a=i*2.39996;pos[i*3]=Math.sin(a)*18+Math.sin(time*.23+i)*.7;pos[i*3+1]=.6+(i%9)*.21+Math.sin(time*.7+i)*.3;pos[i*3+2]=8+Math.cos(a)*14+Math.cos(time*.3+i)*.6;}geom.attributes.position.needsUpdate=true;
    }};
  };
})();
