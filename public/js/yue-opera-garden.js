/* Original Zhuiyu-inspired private garden. All landscape geometry and textures are authored locally. */
(function (global) {
  'use strict';
  global.createYueOperaGarden = function (THREE, scene, compact = false) {
    const root = new THREE.Group();
    root.name = 'Zhuiyu_Bibo_Private_Garden';
    scene.add(root);
    let seed = 20261022;
    const rand = () => ((seed = (1664525 * seed + 1013904223) >>> 0) / 4294967296);
    const buildings = [], obstacles = [], surfaces = [], batches = new Map(), railBarriers=[], gateOpenings=[];
    const mat = (name, color, roughness = 0.85, extra = {}) => {
      const m = new THREE.MeshStandardMaterial({ color, roughness, ...extra }); m.name = name; return m;
    };
    const M = {
      wall: mat('Limewash · warm ivory', '#e3ddca'), wall2: mat('Limewash · chalk', '#f1ead8'),
      stone: mat('Bluestone', '#7f8984'), trim: mat('Pale granite coping', '#bbc0b4'),
      ground: mat('Courtyard stone', '#86917b'), earth: mat('Garden earth', '#56684d'),
      timber: mat('Oiled chestnut', '#483025'), dark: mat('Blackened timber', '#292d29'),
      red: mat('Opera vermilion', '#823c34'), gold: mat('Aged brass', '#b99051', 0.46, { metalness: 0.45 }),
      tile: mat('Blue-grey roof tiles', '#8d9fb4'), ridge: mat('Glazed ridge caps', '#687674'),
      curtain: mat('Crimson embroidered silk', '#852f3e', 0.9, { side: THREE.DoubleSide }),
      leaf: mat('Camphor foliage', '#49654d'), leaf2: mat('New foliage', '#64815b'),
      pink: mat('Magnolia blossoms', '#d4b9af'), water: mat('Jade water', '#417e76', 0.27, { metalness: 0.12, side: THREE.DoubleSide }),
      window: mat('Rice-paper warm windows', '#e2ba7b', 0.65, { emissive: '#b27135', emissiveIntensity: 0.45 }),
      lantern: mat('Amber silk lantern', '#e9ac61', 0.65, { emissive: '#ed923c', emissiveIntensity: 0.8 }),
    };
    function canvasTexture(w, h, paint) {
      const c = document.createElement('canvas'); c.width = w; c.height = h;
      paint(c.getContext('2d'), w, h);
      const tex = new THREE.CanvasTexture(c); tex.colorSpace = THREE.SRGBColorSpace; tex.anisotropy = compact?2:8; return tex;
    }
    const stoneMap = canvasTexture(512, 512, (c) => {
      c.fillStyle = '#a0aaa2'; c.fillRect(0, 0, 512, 512);
      for (let r = 0; r < 8; r++) for (let col = -1; col < 5; col++) {
        const x = col * 128 + (r % 2) * 64, y = r * 64;
        const v = Math.round(145 + rand() * 25); c.fillStyle = `rgb(${v},${v + 7},${v + 3})`;
        c.fillRect(x + 1.5, y + 1.5, 125, 61);
        c.fillStyle = 'rgba(255,255,240,.13)'; c.fillRect(x + 3, y + 3, 120, 1);
      }
      for (let i = 0; i < 6500; i++) { c.fillStyle = rand() > .5 ? '#ffffff09' : '#00000009'; c.fillRect(rand()*512, rand()*512, 1, 1); }
    });
    stoneMap.wrapS = stoneMap.wrapT = THREE.RepeatWrapping; stoneMap.repeat.set(1, 1); M.stone.map = stoneMap;
    const roofMap = canvasTexture(256, 256, (c) => {
      c.fillStyle = '#67716e'; c.fillRect(0,0,256,256);
      for(let x = 0; x < 256; x += 16) {
        const grad = c.createLinearGradient(x,0,x+16,0); grad.addColorStop(0,'#394846'); grad.addColorStop(.38,'#84918a'); grad.addColorStop(1,'#44534f');
        c.fillStyle = grad; c.fillRect(x,0,15,256);
        for(let y=0;y<256;y+=32) { c.fillStyle='#263c3855'; c.fillRect(x,y+(x%32),16,2); }
      }
    });
    roofMap.wrapS = roofMap.wrapT = THREE.RepeatWrapping; M.tile.map = roofMap; M.tile.bumpMap = roofMap; M.tile.bumpScale = .055;
    const geo = {
      box: new THREE.BoxGeometry(1,1,1), cyl: new THREE.CylinderGeometry(1,1,1,compact?8:12),
      ball: new THREE.SphereGeometry(1,compact?8:12,compact?6:8),
      leaf: new THREE.IcosahedronGeometry(1,compact?0:1),
    };
    function mesh(g, m, pos, scale=[1,1,1], parent=root, rotation=[0,0,0]) {
      const o = new THREE.Mesh(g,m); o.position.set(...pos); o.scale.set(...scale); o.rotation.set(...rotation);
      o.castShadow = true; o.receiveShadow = true; parent.add(o); return o;
    }
    const box = (m,x,y,z,w,h,d,p=root,rot=0) => mesh(geo.box,m,[x,y,z],[w,h,d],p,[0,rot,0]);
    const cyl = (m,x,y,z,r,h,p=root) => mesh(geo.cyl,m,[x,y,z],[r,h,r],p);
    function beam(a,b,r,m,p=root) {
      const start=new THREE.Vector3(...a), end=new THREE.Vector3(...b), delta=end.clone().sub(start);
      const o=mesh(geo.cyl,m,start.add(end).multiplyScalar(.5).toArray(),[r,delta.length(),r],p);
      o.quaternion.setFromUnitVectors(new THREE.Vector3(0,1,0),delta.normalize()); return o;
    }
    function plaque(text,w,h,p,x,y,z,vertical=false) {
      const tex=canvasTexture(vertical?128:768,vertical?768:192,(c,cw,ch)=>{
        c.fillStyle='#26332e';c.fillRect(0,0,cw,ch);c.strokeStyle='#c3a365';c.lineWidth=5;c.strokeRect(8,8,cw-16,ch-16);
        c.fillStyle='#ebd8ab';c.textAlign='center';c.textBaseline='middle';c.font=`${vertical?86:110}px "KaiTi", "STKaiti", serif`;
        if(vertical) [...text].forEach((ch,i)=>c.fillText(ch,cw/2,60+(i+.5)*(648/text.length)));
        else c.fillText(text,cw/2,ch/2+4);
      });
      const material=mat(text,'#ffffff',.8,{map:tex});
      const o=mesh(geo.box,material,[x,y,z],[w,h,.06],p);o.name='Plaque_'+text; return o;
    }
    const roofCache=new Map();
    function roof(w,d,h,y,p,hip=true) {
      const key=[w,d,h,hip].join('/'); let g=roofCache.get(key);
      if(!g) {
        const positions=[],uv=[],indices=[],uN=compact?16:28,vN=compact?14:22;
        for(let j=0;j<=vN;j++) for(let i=0;i<=uN;i++) {
          const u=i/uN*2-1,v=j/vN*2-1;
          const span=hip ? Math.max(0,Math.abs(u)-.66)/.34 : 0;
          const slope=Math.max(Math.abs(v),span);
          const rise=h*Math.pow(1-Math.min(1,slope),1.65);
          const lift=.33*Math.pow(Math.abs(u),7)*Math.pow(Math.abs(v),5)+.10*Math.pow(Math.abs(v),10);
          positions.push(u*w/2,rise+lift,v*d/2);uv.push(i/uN*w/2.4,j/vN*d/2.4);
          if(i<uN && j<vN) { const a=j*(uN+1)+i,b=a+1,c=a+uN+1,e=c+1;indices.push(a,c,b,b,c,e); }
        }
        g=new THREE.BufferGeometry();g.setAttribute('position',new THREE.Float32BufferAttribute(positions,3));g.setAttribute('uv',new THREE.Float32BufferAttribute(uv,2));g.setIndex(indices);g.computeVertexNormals();roofCache.set(key,g);
      }
      const o=mesh(g,M.tile,[0,y,0],[1,1,1],p);o.name='Curved_tiled_roof';o.material.side=THREE.DoubleSide;
      box(M.dark,0,y-.11,0,w-.08,.16,d-.08,p);
      // Narrow ridge and continuous curving fascia; no oversized ornamental horns.
      const ridgeWidth=w*(hip?.67:1);
      box(M.ridge,0,y+h+.08,0,ridgeWidth,.16,.20,p);
      for(const side of [-1,1]) {
        beam([side*ridgeWidth/2,y+h+.08,0],[side*(ridgeWidth/2+.28),y+h+.38,0],.075,M.ridge,p);
        for(let i=0;i<12;i++) {
          const u0=i/12*2-1,u1=(i+1)/12*2-1;
          beam([u0*w/2,y+.1+.33*Math.pow(Math.abs(u0),7),side*d/2], [u1*w/2,y+.1+.33*Math.pow(Math.abs(u1),7),side*d/2],.065,M.ridge,p);
        }
      }
      return o;
    }
    function lantern(x,y,z,p=root) {
      cyl(M.dark,x,y+.48,z,.018,.6,p);
      mesh(geo.ball,M.lantern,[x,y,z],[.22,.32,.22],p);
      cyl(M.gold,x,y+.30,z,.17,.055,p);cyl(M.gold,x,y-.30,z,.14,.06,p);
      cyl(M.red,x,y-.48,z,.022,.28,p);
    }
    function railing(x,y,z,length,p=root) {
      box(M.timber,x,y+.85,z,length,.10,.11,p);box(M.timber,x,y+.24,z,length,.09,.10,p);
      for(let i=0;i<=Math.floor(length/.5);i++) box(M.timber,x-length/2+i*length/Math.floor(length/.5),y+.53,z,.055,.60,.055,p);
    }
    function windowPanel(x,y,z,w,h,p) {
      box(M.dark,x,y,z,w+.16,h+.16,.12,p);box(M.window,x,y,z+.07,w,h,.035,p);
      for(let i=1;i<5;i++)box(M.timber,x-w/2+i*w/5,y,z+.10,.038,h,.035,p);
      for(let i=1;i<4;i++)box(M.timber,x,y-h/2+i*h/4,z+.11,w,.035,.035,p);
    }
    function house(name,x,z,w,d,levels=1,rotation=0,index=0) {
      const p=new THREE.Group();p.name=name;p.position.set(x,0,z);p.rotation.y=rotation;root.add(p);
      const h=levels===2?6.4:3.65;
      box(M.stone,0,.15,0,w+.5,.30,d+.5,p);
      box(index%3?M.wall:M.wall2,0,h/2+.3,0,w,h,d,p);
      box(M.stone,0,.53,0,w+.03,.46,d+.03,p);
      box(M.timber,0,1.68,d/2+.08,1.4,2.7,.14,p);
      for(const side of [-1,1]) for(let k=0;k<2;k++){
        const xx=side*(1.8+k*(w/2-2.4)/1.6);
        if(Math.abs(xx)<w/2-.7) windowPanel(xx,2.1,d/2+.1,1.05,1.65,p);
      }
      for(const xx of [-w/2+.18,w/2-.18]) box(M.timber,xx,h/2+.3,d/2+.15,.13,h,.13,p);
      box(M.dark,0,h+.18,d/2+.12,w,.16,.18,p);
      if(levels===2) {
        box(M.timber,0,3.75,d/2+.45,w+.7,.22,1.6,p);
        for(let i=0;i<Math.floor(w/2);i++) windowPanel(-w/2+1.1+i*2,5.1,d/2+.1,1.25,1.75,p);
        for(let i=0;i<=4;i++)cyl(M.timber,-w/2+i*w/4,3.65,d/2+1,.09,6.7,p);
        railing(0,3.9,d/2+1,w,p);
        roof(w+1.8,2.3,.6,3.72,p,false).position.z=d/2+.1;
      }
      roof(w+1.5,d+1.7,levels===2?1.65:1.35,h+.28,p,index%4!==0);
      for(const side of [-1,1]) lantern(side*(w/2-.8),levels===2?3.15:2.9,d/2+.65,p);
      if(index%3===0)plaque(name,2.2,.5,p,0,3.15,d/2+.14);
      // Foundations are solid: walls remain impassable from every direction.
      const halfX=(rotation%Math.PI===0?w:d)/2+.2,halfZ=(rotation%Math.PI===0?d:w)/2+.2;
      obstacles.push({x0:x-halfX,x1:x+halfX,z0:z-halfZ,z1:z+halfZ,y1:h+2});
      buildings.push({name,x,z,width:w,depth:d,levels}); return p;
    }
    const timeUniform={value:0};
    const reflection={texture:{value:null},projection:{value:new THREE.Matrix4()},strength:{value:0}};
    M.moss=mat('Moss on limestone','#63775a');
    M.rock=mat('Weathered Taihu limestone','#93998d');
    M.rockDark=mat('Wet limestone','#555f59');
    M.bamboo=mat('Bamboo jade culms','#526e42');
    M.node=mat('Bamboo pale nodes','#9aa77c');
    M.bambooLeaf=mat('Bamboo lanceolate leaves','#426844',.9,{side:THREE.DoubleSide});
    M.path=mat('Warm worn flagstones','#b4b5a2',.93,{map:stoneMap});
    M.foam=mat('Pale water foam','#dbece1',.35,{transparent:true,opacity:.6,depthWrite:false});
    M.petal=mat('Lotus ivory petals','#f1d6ca',.85,{side:THREE.DoubleSide});
    M.water.color.set('#2a544b');
    const grassMap=canvasTexture(256,256,c=>{
      c.fillStyle='#7e8d70';c.fillRect(0,0,256,256);
      for(let i=0;i<6000;i++){c.fillStyle=i%3?'#c2c29b22':'#394f3828';c.fillRect(rand()*256,rand()*256,1+rand()*2,1+rand()*3);}
    });
    grassMap.wrapS=grassMap.wrapT=THREE.RepeatWrapping;grassMap.repeat.set(32,26);M.ground.map=grassMap;
    const rockMap=canvasTexture(256,256,c=>{
      c.fillStyle='#a5a99b';c.fillRect(0,0,256,256);
      for(let i=0;i<2000;i++){const v=100+Math.floor(rand()*80);c.fillStyle=`rgba(${v},${v+4},${v},.25)`;c.fillRect(rand()*256,rand()*256,rand()*5+1,rand()*12+2);}
    });
    rockMap.wrapS=rockMap.wrapT=THREE.RepeatWrapping;M.rock.map=rockMap;M.rock.bumpMap=rockMap;M.rock.bumpScale=.07;
    const pebbleMap=canvasTexture(256,256,c=>{
      c.fillStyle='#a3a797';c.fillRect(0,0,256,256);
      for(let i=0;i<2600;i++){const v=145+Math.floor(rand()*50);c.fillStyle=`rgb(${v},${v+2},${v-3})`;c.beginPath();c.ellipse(rand()*256,rand()*256,1+rand()*2,.8+rand()*1.4,rand()*Math.PI,0,Math.PI*2);c.fill();}
    });
    pebbleMap.wrapS=pebbleMap.wrapT=THREE.RepeatWrapping;pebbleMap.repeat.set(.5,.5);
    M.pebble=mat('Pebble mosaic courtyard','#c0c0ad',.95,{map:pebbleMap,side:THREE.DoubleSide});
    function pointIn(poly,x,z){let hit=false;for(let i=0,j=poly.length-1;i<poly.length;j=i++){
      const a=poly[i],b=poly[j];if((a.y>z)!==(b.y>z)&&x<(b.x-a.x)*(z-a.y)/(b.y-a.y)+a.x)hit=!hit;
    }return hit;}
    function shapeAt(points,m,y,name){
      const shape=new THREE.Shape(points),g=new THREE.ShapeGeometry(shape,compact?16:24);g.rotateX(Math.PI/2);
      for(let i=0;i<g.index.count;i+=3){const a=g.index.getX(i);g.index.setX(i,g.index.getX(i+2));g.index.setX(i+2,a);}g.computeVertexNormals();
      // A shape's local Y becomes world Z. Correct winding is double-sided for water.
      const o=mesh(g,m,[0,y,0]);o.name=name;return o;
    }
    const pondCurve=new THREE.CatmullRomCurve3([
      [-21,0,-15],[-17,0,-22],[-7,0,-25],[4,0,-24],[14,0,-19],[19,0,-13],
      [18,0,-5],[14,0,0],[5,0,4],[-6,0,3],[-14,0,0],[-22,0,-5],[-24,0,-11]
    ].map(p=>new THREE.Vector3(...p)),true,'centripetal');
    const pond=pondCurve.getPoints(compact?90:130).map(p=>new THREE.Vector2(p.x,p.z));
    const creekCurves=[
      new THREE.CatmullRomCurve3([[-23,0,-17],[-25.1,0,-18.1],[-25.5,0,-21],[-25.5,0,-24]].map(p=>new THREE.Vector3(...p))),
      new THREE.CatmullRomCurve3([[16,0,-9],[22,0,-8],[27,0,-3],[27,0,5],[24,0,10],[20,0,12]].map(p=>new THREE.Vector3(...p)))
    ];
    const creeks=creekCurves.map(c=>c.getPoints(70));
    function nearCurve(points,x,z,width){for(let i=1;i<points.length;i++){
      const a=points[i-1],b=points[i],dx=b.x-a.x,dz=b.z-a.z,t=THREE.MathUtils.clamp(((x-a.x)*dx+(z-a.z)*dz)/(dx*dx+dz*dz),0,1);
      if(Math.hypot(x-a.x-t*dx,z-a.z-t*dz)<width)return true;
    }return false;}
    function waterAt(x,z){return pointIn(pond,x,z)||creeks.some((c,i)=>nearCurve(c,x,z,i?1.7:1.25));}
    function ribbon(curve,width,y,material,name,segments=70){
      const positions=[],uv=[],index=[];
      for(let i=0;i<=segments;i++){
        const t=i/segments,p=curve.getPoint(t),v=curve.getTangent(t),len=Math.hypot(v.x,v.z),nx=-v.z/len,nz=v.x/len;
        for(const side of [-1,1]){positions.push(p.x+nx*width*.5*side,y,p.z+nz*width*.5*side);uv.push((side+1)*.5,t*curve.getLength()/3);}
        if(i<segments&&!(name.startsWith('曲径')&&waterAt(p.x,p.z))){const a=i*2;index.push(a,a+1,a+2,a+1,a+3,a+2);}
      }
      const g=new THREE.BufferGeometry();g.setAttribute('position',new THREE.Float32BufferAttribute(positions,3));g.setAttribute('uv',new THREE.Float32BufferAttribute(uv,2));g.setIndex(index);g.computeVertexNormals();
      const o=mesh(g,material,[0,0,0]);o.name=name;return o;
    }
    box(M.earth,0,-.55,0,83,1,71);
    const groundPositions=[],groundUV=[],groundIndices=[],cols=122,rows=104;
    for(let j=0;j<=rows;j++)for(let i=0;i<=cols;i++){const x=-41+i*82/cols,z=-35+j*70/rows;groundPositions.push(x,0,z);groundUV.push(i/cols,j/rows);}
    for(let j=0;j<rows;j++)for(let i=0;i<cols;i++){
      const x=-41+(i+.5)*82/cols,z=-35+(j+.5)*70/rows;if(waterAt(x,z))continue;
      const a=j*(cols+1)+i,b=a+1,c=a+cols+1,d=c+1;groundIndices.push(a,c,b,b,c,d);
    }
    const groundGeometry=new THREE.BufferGeometry();groundGeometry.setAttribute('position',new THREE.Float32BufferAttribute(groundPositions,3));groundGeometry.setAttribute('uv',new THREE.Float32BufferAttribute(groundUV,2));groundGeometry.setIndex(groundIndices);groundGeometry.computeVertexNormals();
    mesh(groundGeometry,M.ground,[0,0,0]).name='有真实水体开口的园地';
    shapeAt([[-18,27],[-14,18],[-6,17],[0,18],[9,16],[19,18],[20,25],[13,29],[-11,29]].map(([x,z])=>new THREE.Vector2(x,z)),M.pebble,.003,'月门前 · 卵石铺院');
    // The pond occupies the heart of the garden; the scene is composed around
    // its empty water surface, rather than around rows of buildings.
    shapeAt(pond,M.water,-.015,'碧波潭 · 不规则池岸');
    creekCurves.forEach((c,i)=>ribbon(c,i?3.4:2.5,-.01,M.water,'曲水溪涧',60));
    M.water.onBeforeCompile=shader=>{
      shader.uniforms.uGardenTime=timeUniform;shader.uniforms.tGardenReflection=reflection.texture;shader.uniforms.uGardenReflectionMatrix=reflection.projection;shader.uniforms.uGardenReflectionStrength=reflection.strength;
      shader.vertexShader='varying vec2 vGardenWater; varying vec3 vGardenWaterWorld;\n'+shader.vertexShader;
      shader.vertexShader=shader.vertexShader.replace('#include <worldpos_vertex>',`#include <worldpos_vertex>
vec4 gardenP=vec4(transformed,1.0);
#ifdef USE_INSTANCING
gardenP=instanceMatrix*gardenP;
#endif
vGardenWaterWorld=(modelMatrix*gardenP).xyz;
vGardenWater=vGardenWaterWorld.xz;`);
      shader.fragmentShader='uniform float uGardenTime; uniform sampler2D tGardenReflection; uniform mat4 uGardenReflectionMatrix; uniform float uGardenReflectionStrength; varying vec2 vGardenWater; varying vec3 vGardenWaterWorld;\n'+shader.fragmentShader;
      shader.fragmentShader=shader.fragmentShader.replace('#include <shadowmap_pars_fragment>','#include <shadowmap_pars_fragment>\n#include <shadowmask_pars_fragment>');
      shader.fragmentShader=shader.fragmentShader.replace('#include <color_fragment>',`#include <color_fragment>
float gardenWave=sin(vGardenWater.x*1.7+sin(vGardenWater.y*.8+uGardenTime*.35)*1.6-uGardenTime*.65);
float gardenGlint=pow(max(0.0,gardenWave),24.0)*(.5+.5*sin(vGardenWater.y*3.1+uGardenTime*.4));
diffuseColor.rgb=mix(diffuseColor.rgb,vec3(.57,.72,.63),gardenGlint*.065);
diffuseColor.rgb*=.98+.02*sin(vGardenWater.y*2.3+vGardenWater.x*.8+uGardenTime*.6);`);
      shader.fragmentShader=shader.fragmentShader.replace('#include <opaque_fragment>',`
if(uGardenReflectionStrength>.0){
 vec4 reflectedUV=uGardenReflectionMatrix*vec4(vGardenWaterWorld,1.0);
 vec2 ripple=vec2(sin(vGardenWater.y*2.7+uGardenTime*.7),cos(vGardenWater.x*2.2-uGardenTime*.55))*.0013;
 vec2 uv=reflectedUV.xy/reflectedUV.w+ripple;
 vec3 reflected=texture2D(tGardenReflection,clamp(uv,vec2(.002),vec2(.998))).rgb;
 float facing=clamp(normalize(cameraPosition-vGardenWaterWorld).y,0.0,1.0);
 float fresnel=.16+.55*pow(1.0-facing,3.0);
 float waterShadow=.48+.52*getShadowMask();
 outgoingLight=mix(outgoingLight,reflected*vec3(.84,.96,.91)*waterShadow,fresnel*uGardenReflectionStrength);
}
#include <opaque_fragment>`);
    };
    M.water.customProgramCacheKey=()=> 'zhuiyu-water-v1';
    // Bank stones are sculpted variants, reused as GPU instances.
    const rockGeometries=[];
    for(let k=0;k<5;k++){
      const g=new THREE.IcosahedronGeometry(1,compact?1:2),p=g.attributes.position;
      for(let i=0;i<p.count;i++){
        const x=p.getX(i),y=p.getY(i),z=p.getZ(i),n=1+.12*Math.sin(x*7+k)*Math.cos(y*8-z*4)+.08*Math.sin(z*13+y*5+k);
        p.setXYZ(i,x*n,y*n,z*n);
      }g.computeVertexNormals();
      const averaged=new Map(),n=g.attributes.normal;
      for(let i=0;i<p.count;i++){const key=[p.getX(i),p.getY(i),p.getZ(i)].map(v=>v.toFixed(4)).join('/');if(!averaged.has(key))averaged.set(key,new THREE.Vector3());averaged.get(key).add(new THREE.Vector3().fromBufferAttribute(n,i));}
      for(let i=0;i<p.count;i++){const key=[p.getX(i),p.getY(i),p.getZ(i)].map(v=>v.toFixed(4)).join('/'),v=averaged.get(key).normalize();n.setXYZ(i,v.x,v.y,v.z);}
      rockGeometries.push(g);
    }
    function rock(x,y,z,sx,sy,sz,k=0,m=M.rock){const o=mesh(rockGeometries[k%5],m,[x,y,z],[sx,sy,sz],root,[rand()*.2,rand()*6.28,rand()*.18]);return o;}
    pond.forEach((p,i)=>{if(i%2)return;const size=.4+rand()*.35;rock(p.x,.05,p.y,size,.22+rand()*.32,size*.8,i);});
    creekCurves.forEach((c,j)=>{for(let i=0;i<30;i++){
      const t=i/29,p=c.getPoint(t),v=c.getTangent(t),n=new THREE.Vector3(-v.z,0,v.x).normalize();
      for(const side of [-1,1])rock(p.x+n.x*(j?1.85:1.35)*side,.06,p.z+n.z*(j?1.85:1.35)*side,.32+rand()*.22,.24+rand()*.26,.35+rand()*.2,i);
    }});
    // Winding paths stay close to the water and open into small, quiet courts.
    const paths=[
      [[0,30],[0,23],[0,18],[9,16],[18,12],[21,5],[22,-2],[24,-14],[20,-24],[4,-28],[-14,-27],[-31,-17],[-29,0],[-24,10],[-24,20],[-20,23],[0,23]],
      [[-24,17],[-20,15],[-14,11],[-7,14],[0,18]],
      [[21,4],[31,4],[34,12],[30,23],[17,25],[0,23]],
      [[-31,-12],[-27,-8],[-19,0],[-14,7],[-7,14]],
      [[20,-24],[29,-23],[34,-13],[34,-1],[31,4]]
    ];
    const walkCurves=[];
    paths.forEach(points=>{
      const c=new THREE.CatmullRomCurve3(points.map(([x,z])=>new THREE.Vector3(x,0,z)));
      walkCurves.push(c.getPoints(140));
      ribbon(c,2.85,.005,M.earth,'曲径 · 土色镶边',75);
      ribbon(c,2.4,.016,M.path,'曲径 · 青石铺地',75);
    });
    // A moon gate frames the first view into the garden. The circular opening
    // is real geometry, not a dark circle pasted on a wall.
    function moonGate(x,z,rotation=0,label='碧 波 园'){
      const p=new THREE.Group();p.position.set(x,0,z);p.rotation.y=rotation;p.name='月洞门';root.add(p);
      const radius=2.4,cy=2.25,foot=Math.sqrt(radius*radius-cy*cy),start=Math.atan2(-cy,foot);
      const shape=new THREE.Shape();shape.moveTo(-4.3,0);shape.lineTo(-4.3,5.8);shape.quadraticCurveTo(0,5.55,4.3,5.8);shape.lineTo(4.3,0);shape.lineTo(foot,0);shape.absarc(0,cy,radius,start,Math.PI-start,false);shape.closePath();
      const g=new THREE.ExtrudeGeometry(shape,{depth:.5,bevelEnabled:false,curveSegments:compact?24:40});
      mesh(g,M.wall2,[0,0,-.25],[1,1,1],p);
      mesh(new THREE.TorusGeometry(radius,.085,6,compact?40:64),M.stone,[0,cy,.29],[1,1,1],p);
      box(M.ridge,0,5.8,0,8.8,.15,.8,p);plaque(label,2.4,.55,p,0,5.05,.3);
      buildings.push({name:'月洞门',x,z,width:8.6,depth:.6,levels:1});
      gateOpenings.push({x,z,rotation,radius,cy});
    }
    moonGate(0,30);moonGate(29,21,0,'竹 影 清 风');
    for(const x of [-39,39]){box(M.wall,x,1.55,-1,.45,3.1,66);box(M.ridge,x,3.14,-1,.75,.15,66.3);}
    for(const x of [-22,22]){box(M.wall,x,1.55,30,35,3.1,.45);box(M.ridge,x,3.15,30,35.3,.17,.75);}
    obstacles.push({x0:-39,x1:-4.3,z0:29.7,z1:30.3,y1:3.3},{x0:4.3,x1:39,z0:29.7,z1:30.3,y1:3.3});
    box(M.wall,0,1.65,-33,78,3.3,.45);box(M.ridge,0,3.35,-33,78.4,.18,.8);
    for(const x of [-24,-13,1,14,27]){
      // Dark geometric lattice windows articulate the white enclosing wall.
      box(M.dark,x,1.85,-32.74,1.85,1.5,.035);
      for(let k=-2;k<=2;k++){
        box(M.trim,x+k*.28,1.85,-32.69,.05,1.5,.04);
        box(M.trim,x,1.85+k*.25,-32.68,1.85,.045,.04);
      }
    }
    // A restrained study and three open garden pavilions; no street of houses.
    house('潭畔书斋',-30,13,8,6,1,Math.PI/2,0);
    function pavilion(name,x,z,w=5,d=5){
      const p=new THREE.Group();p.position.set(x,0,z);p.name=name;root.add(p);
      box(M.trim,0,.18,0,w,.36,d,p);
      for(const xx of [-w/2+.55,w/2-.55])for(const zz of [-d/2+.55,d/2-.55])cyl(M.timber,xx,1.9,zz,.105,3.45,p);
      box(M.timber,0,3.56,0,w-.4,.17,d-.4,p);roof(w+1.3,d+1.3,1.35,3.66,p,true);
      plaque(name,2.2,.45,p,0,3.14,d/2-.43);
      for(const xx of [-w/2+.55,w/2-.55]){box(M.timber,xx,.69,0,.38,.10,d-1,p);lantern(xx,2.65,d/2-.6,p);}
      buildings.push({name,x,z,width:w+1.3,depth:d+1.3,levels:1});
      surfaces.push({x0:x-w/2,x1:x+w/2,z0:z-d/2,z1:z+d/2,y:.36});
      for(const xx of [-w/2+.55,w/2-.55])for(const zz of [-d/2+.55,d/2-.55])obstacles.push({x0:x+xx-.12,x1:x+xx+.12,z0:z+zz-.12,z1:z+zz+.12,y1:3.7});
    }
    pavilion('听 瀑 亭',-32,-13,5.2,4.8);pavilion('待 月 水 榭',12,6.5,7,5.5);pavilion('竹 隐 亭',28,-20,5,5);
    // An uncovered waterside performance terrace keeps opera gestures available
    // without reinstating the large theatre that dominated the previous scene.
    box(M.trim,0,.15,8.5,6.8,.3,4.8);box(M.timber,0,.35,8.5,6.5,.096,4.5);
    surfaces.push({x0:-3.4,x1:3.4,z0:6.1,z1:10.9,y:.398});
    for(let i=0;i<2;i++){
      const top=.398-i*.199,z=11.15+i*.45;box(M.trim,0,top/2,z,3.5,top,.48);
      surfaces.push({x0:-1.75,x1:1.75,z0:z-.24,z1:z+.24,y:top});
    }
    for(let i=0;i<14;i++)box(M.dark,-3.16+i*.49,.401,8.5,.012,.005,4.4);
    // East: a genuinely arched stone bridge across the narrow creek.
    const arch={x0:21,x1:31,z0:2.5,z1:5.5};
    const archY=x=>.12+1.12*Math.sin(THREE.MathUtils.clamp((x-21)/10,0,1)*Math.PI);
    const bridgePositions=[],bridgeUV=[],bridgeIndex=[];
    for(let i=0;i<=40;i++){
      const x=21+i/4,y=archY(x);
      for(const [z,dy] of [[2.5,0],[5.5,0],[2.5,-.28],[5.5,-.28]]){bridgePositions.push(x,y+dy,z);bridgeUV.push(i/10,z/3);}
      if(i<40){const a=i*4,b=a+4;bridgeIndex.push(a,b,a+1,a+1,b,b+1,a+2,b+2,a,a,b+2,b,a+1,b+1,a+3,a+3,b+1,b+3,a+2,a+3,b+2,a+3,b+3,b+2);}
    }
    for(let i=0;i<bridgeIndex.length;i+=3)[bridgeIndex[i+1],bridgeIndex[i+2]]=[bridgeIndex[i+2],bridgeIndex[i+1]];
    const archGeometry=new THREE.BufferGeometry();archGeometry.setAttribute('position',new THREE.Float32BufferAttribute(bridgePositions,3));archGeometry.setAttribute('uv',new THREE.Float32BufferAttribute(bridgeUV,2));archGeometry.setIndex(bridgeIndex);archGeometry.computeVertexNormals();
    mesh(archGeometry,M.path,[0,0,0]).name='弧月石桥 · 连续可行走桥面';
    for(const z of [2.5,5.5])for(let i=0;i<=10;i++){
      const x=21+i,y=archY(x);cyl(M.trim,x,y+.45,z,.095,.9);mesh(geo.ball,M.trim,[x,y+.94,z],[.13,.13,.13]);
      if(i<10)beam([x,y+.75,z],[x+1,archY(x+1)+.75,z],.065,M.trim);
    }
    for(const z of [2.5,5.5])railBarriers.push({points:[{x:21,z},{x:31,z}],radius:.09,top:2.2});
    // West: a low zigzag bridge follows the inlet, separating water into
    // intimate and open views while keeping the whole pool connected.
    const zigPoints=[[-29,-12],[-23,-12],[-23,-7],[-19,-7],[-19,0]];
    const zigEdges=[-1,1].map(side=>zigPoints.map((p,i)=>{
      const a=zigPoints[Math.max(0,i-1)],b=zigPoints[Math.min(zigPoints.length-1,i+1)];
      const prev=new THREE.Vector2(-(p[1]-a[1]),p[0]-a[0]).normalize(),next=new THREE.Vector2(-(b[1]-p[1]),b[0]-p[0]).normalize();
      if(i===0)prev.copy(next);if(i===zigPoints.length-1)next.copy(prev);
      const m=prev.add(next).normalize(),offset=1.05/Math.max(.5,m.dot(next));
      return new THREE.Vector2(p[0]+m.x*offset*side,p[1]+m.y*offset*side);
    }));
    const zigPolygon=[...zigEdges[0],...zigEdges[1].slice().reverse()];
    const zigGeometry=new THREE.ExtrudeGeometry(new THREE.Shape(zigPolygon),{depth:.3,bevelEnabled:false});zigGeometry.rotateX(Math.PI/2);
    mesh(zigGeometry,M.trim,[0,.35,0]).name='曲桥 · 统一桥面与连续转角';
    for(const edge of zigEdges){
      const points=edge.map(p=>({x:p.x,z:p.y}));railBarriers.push({points,radius:.075,top:1.03});
      for(let i=1;i<edge.length;i++){
        const a=edge[i-1],b=edge[i],len=a.distanceTo(b),count=Math.ceil(len);
        beam([a.x,.91,a.y],[b.x,.91,b.y],.055,M.trim);
        for(let k=0;k<=count;k++){const t=k/count;cyl(M.trim,a.x+(b.x-a.x)*t,.64,a.y+(b.y-a.y)*t,.065,.65);}
      }
    }
    // Limestone rockery is built in terraces around a three-stage cascade.
    for(let i=0;i<28;i++){
      const a=i*2.4,r=rand()*4.5,z=-25+Math.sin(a)*r;let x=-26+Math.cos(a)*r;
      if(z> -25&&Math.abs(x+25.5)<1.65)x+=x< -25.5?-2.15:2.15;
      const h=1.4+Math.max(0,1-r/5)*3.5+rand()*1.3;
      rock(x,h*.44,z,1.2+rand()*1.2,h*.60,.9+rand()*1.25,i,i%6===0?M.rockDark:M.rock);
    }
    // Implicit volumetric limestone, including through-holes. Smooth unioned
    // lobes and eroded voids avoid the flat silhouette of an extruded outline.
    const ell=(x,y,z,cx,cy,cz,rx,ry,rz)=>(Math.hypot((x-cx)/rx,(y-cy)/ry,(z-cz)/rz)-1)*Math.min(rx,ry,rz);
    const smoothMin=(a,b,k)=>{const h=Math.max(k-Math.abs(a-b),0)/k;return Math.min(a,b)-h*h*k*.25;};
    function stoneField(x,y,z){
      let d=ell(x,y,z,0,.45,0,.95,.75,.72);
      for(const e of [[-.2,1.9,0,1.1,1.6,.86],[-.65,3.25,.08,1.08,1.0,.88],[-.18,4.6,-.12,1.0,1.4,.8],[.65,3.65,0,.86,.9,.82]])d=smoothMin(d,ell(x,y,z,...e),.42);
      d+=.075*Math.sin(x*7+y*3)*Math.cos(z*8-y*2)+.035*Math.sin(y*15+z*8+x*3);
      for(const e of [[-.4,3.3,0,.50,.65,2],[.35,1.75,0,.35,.48,2],[.15,4.8,0,.25,.36,2]])d=Math.max(d,-ell(x,y,z,...e));
      return d;
    }
    const stoneVertices=[],stoneNormals=[],stoneColours=[];
    const stoneGradient=p=>{const e=.012;return new THREE.Vector3(stoneField(p[0]+e,p[1],p[2])-stoneField(p[0]-e,p[1],p[2]),stoneField(p[0],p[1]+e,p[2])-stoneField(p[0],p[1]-e,p[2]),stoneField(p[0],p[1],p[2]+e)-stoneField(p[0],p[1],p[2]-e)).normalize();};
    function stoneTriangle(a,b,c){
      const cross=new THREE.Vector3(b[0]-a[0],b[1]-a[1],b[2]-a[2]).cross(new THREE.Vector3(c[0]-a[0],c[1]-a[1],c[2]-a[2]));
      if(cross.dot(stoneGradient(a))<0)[b,c]=[c,b];
      for(const p of [a,b,c]){
        stoneVertices.push(...p);stoneNormals.push(...stoneGradient(p).toArray());
        const v=.68+.06*Math.sin(p[1]*10+p[0]*3)*Math.cos(p[2]*5),moss=THREE.MathUtils.smoothstep(-p[1],-1.1,0)*.09;
        stoneColours.push(v-moss,v+.015,v-.035-moss);
      }
    }
    const nx=compact?18:25,ny=compact?28:38,nz=compact?12:18,corners=[[0,0,0],[1,0,0],[1,1,0],[0,1,0],[0,0,1],[1,0,1],[1,1,1],[0,1,1]],tets=[[0,5,1,6],[0,1,2,6],[0,2,3,6],[0,3,7,6],[0,7,4,6],[0,4,5,6]];
    for(let iy=0;iy<ny;iy++)for(let iz=0;iz<nz;iz++)for(let ix=0;ix<nx;ix++){
      const p=corners.map(([a,b,c])=>[-2.2+(ix+a)*4.4/nx,-.4+(iy+b)*6.8/ny,-1.35+(iz+c)*2.7/nz]),v=p.map(q=>stoneField(...q));
      if(v.every(d=>d>0)||v.every(d=>d<0))continue;
      const edge=(a,b)=>{const t=v[a]/(v[a]-v[b]);return p[a].map((n,k)=>n+(p[b][k]-n)*t);};
      for(const t of tets){const ins=t.filter(k=>v[k]<0),out=t.filter(k=>v[k]>=0);
        if(ins.length===1)stoneTriangle(...out.map(b=>edge(ins[0],b)));
        if(ins.length===3)stoneTriangle(...ins.map(a=>edge(a,out[0])));
        if(ins.length===2){const a=edge(ins[0],out[0]),b=edge(ins[0],out[1]),c=edge(ins[1],out[0]),d=edge(ins[1],out[1]);stoneTriangle(a,b,c);stoneTriangle(b,d,c);}
      }
    }
    const scholarGeometry=new THREE.BufferGeometry();scholarGeometry.setAttribute('position',new THREE.Float32BufferAttribute(stoneVertices,3));scholarGeometry.setAttribute('normal',new THREE.Float32BufferAttribute(stoneNormals,3));scholarGeometry.setAttribute('color',new THREE.Float32BufferAttribute(stoneColours,3));
    const scholarMaterial=mat('Sculpted porous Taihu limestone','#a6a99e',.94,{vertexColors:true});
    function scholarStone(x,z,s=1,rotation=0){
      mesh(scholarGeometry,scholarMaterial,[x,0,z],[s,s,s],root,[.08,rotation,-.06]).name='玲珑湖石 · 立体侵蚀孔洞';
      obstacles.push({x0:x-s*1.7,x1:x+s*1.7,z0:z-s*.9,z1:z+s*.9,y1:s*6.2});
    }
    scholarStone(-29,-25,1.35,.5);scholarStone(-22,-25,1,.8);scholarStone(-33,5,.65,-.4);scholarStone(21,18,.55,1.0);
    obstacles.push({x0:-31.8,x1:-21,z0:-28.5,z1:-20.0,y1:9});
    const falling=mat('Moving veil of spring water','#79b7af',.24,{transparent:true,opacity:.60,depthWrite:false,side:THREE.DoubleSide});
    falling.onBeforeCompile=shader=>{
      shader.uniforms.uGardenTime=timeUniform;shader.vertexShader='uniform float uGardenTime; varying vec2 vFallUV;\n'+shader.vertexShader;
      shader.vertexShader=shader.vertexShader.replace('#include <begin_vertex>','#include <begin_vertex>\nvFallUV=uv;\ntransformed.x+=sin(uv.y*12.0-uGardenTime*3.0)*.035*uv.y;\ntransformed.z+=sin(uv.y*18.0+uv.x*6.0-uGardenTime*2.0)*.035*uv.y;');
      shader.fragmentShader='uniform float uGardenTime; varying vec2 vFallUV;\n'+shader.fragmentShader;
      shader.fragmentShader=shader.fragmentShader.replace('#include <color_fragment>',`#include <color_fragment>
float strand=fract(sin(floor(vFallUV.x*83.0)*127.1)*43758.5453);
float streak=smoothstep(.18,.78,strand)*(.75+.25*sin(vFallUV.y*19.0-uGardenTime*5.0+strand*12.0));
float drops=pow(.5+.5*sin(vFallUV.y*27.0+uGardenTime*7.0+strand*31.0),12.0);
diffuseColor.rgb=mix(diffuseColor.rgb,vec3(.92,.98,.94),streak*.6+drops*.22);
diffuseColor.a*=(.32+streak*.60+drops*.15)*smoothstep(0.0,.12,vFallUV.x)*smoothstep(0.0,.12,1.0-vFallUV.x);`);
    };falling.customProgramCacheKey=()=> 'zhuiyu-cascade-v1';
    rock(-25.5,6.0,-24.2,1.7,.35,1,1,M.rockDark);rock(-25.5,3.2,-21.8,1.8,.3,1.1,2,M.rockDark);rock(-25.4,1.15,-19.8,1.9,.3,.9,3,M.rockDark);
    const cascadeTiers=[[-25.5,-24,6.4,-25.5,-21.7,3.5,1.65],[-25.5,-21.7,3.55,-25.4,-19.5,1.5,2.1],[-25.4,-19.5,1.55,-25.1,-17.8,.02,2.4]];
    for(const [x0,z0,y0,x1,z1,y1,width] of cascadeTiers){
      const pos=[],uv=[],idx=[];
      for(let j=0;j<=18;j++)for(let i=0;i<=8;i++){
        const t=j/18,u=i/8,x=x0+(x1-x0)*t+(u-.5)*width*(.8+.2*t),z=z0+(z1-z0)*t+.12*Math.sin(t*Math.PI);
        pos.push(x,y0+(y1-y0)*Math.pow(t,.8),z);uv.push(u,t);
        if(j<18&&i<8){const a=j*9+i;idx.push(a,a+9,a+1,a+1,a+9,a+10);}
      }
      const g=new THREE.BufferGeometry();g.setAttribute('position',new THREE.Float32BufferAttribute(pos,3));g.setAttribute('uv',new THREE.Float32BufferAttribute(uv,2));g.setIndex(idx);g.computeVertexNormals();mesh(g,falling,[0,0,0]).name='叠瀑 · 流动水帘';
      mesh(new THREE.TorusGeometry(.7,.02,5,32),M.foam,[x1,y1+.03,z1],[1,.5,1],root,[Math.PI/2,0,0]);
    }
    // Slender bamboo has visible nodes, branches and individual lanceolate leaves.
    const leafShape=new THREE.Shape();leafShape.moveTo(0,0);leafShape.quadraticCurveTo(.16,.4,0,.95);leafShape.quadraticCurveTo(-.13,.37,0,0);
    const bambooLeafGeometry=new THREE.ShapeGeometry(leafShape,3);
    let bambooCount=0;
    const groves=[[-35,-23,5,7,26],[33,-8,5,14,38],[31,14,8,7,32],[-33,25,8,3,18],[13,-29,12,2.4,24],[-12,23,4,5,18],[16,21,3,3,16]];
    for(const [gx,gz,wx,wz,count] of groves)for(let i=0;i<(compact?Math.ceil(count*.63):count);i++){
      const x=gx+(rand()-.5)*wx,z=gz+(rand()-.5)*wz;
      if(waterAt(x,z)||walkCurves.some(c=>nearCurve(c,x,z,2.5))||surfaces.some(r=>x>r.x0-1&&x<r.x1+1&&z>r.z0-1&&z<r.z1+1)||pointIn(zigPolygon,x,z))continue;
      const h=3.5+rand()*3.2,r=.045+rand()*.035,leanX=(rand()-.5)*.55,leanZ=(rand()-.5)*.55;
      beam([x,0,z],[x+leanX,h,z+leanZ],r,M.bamboo);bambooCount++;
      for(let j=1;j<8;j++){
        const y=h*j/8,px=x+leanX*j/8,pz=z+leanZ*j/8;cyl(M.node,px,y,pz,r*1.12,.055);
        if(j<3)continue;const a=j*2.4+i*1.1,tx=px+Math.cos(a)*(.55+rand()*.6),tz=pz+Math.sin(a)*(.55+rand()*.6),ty=y+.25;
        beam([px,y,pz],[tx,ty,tz],.016,M.bamboo);
        for(let k=0;k<7;k++){
          const t=.25+k*.105;
          mesh(bambooLeafGeometry,M.bambooLeaf,[px+(tx-px)*t,y+(ty-y)*t,tz+(pz-tz)*(1-t)],[1,.65+rand()*.28,1],root,[1.1+rand()*.6,a+(k%2?-.5:.6),k%2?-.8:.8]);
        }
      }
      obstacles.push({x0:Math.min(x,x+leanX*.5)-r,x1:Math.max(x,x+leanX*.5)+r,z0:Math.min(z,z+leanZ*.5)-r,z1:Math.max(z,z+leanZ*.5)+r,y1:h});
    }
    // Two weeping willows soften the water's edge; hanging leaves are thin
    // fronds rather than large spherical foliage clumps.
    function willow(x,z,scale=1){
      beam([x,0,z],[x+.3,4.5*scale,z],.20*scale,M.timber);
      for(let j=0;j<8;j++){
        const a=j*Math.PI/4,tx=x+Math.cos(a)*2.3*scale,tz=z+Math.sin(a)*2.3*scale;
        beam([x+.2,3.5*scale,z],[tx,4.8*scale,tz],.065*scale,M.timber);
        mesh(geo.leaf,M.leaf2,[tx,(4.5+.4*Math.sin(j*1.7))*scale,tz],[(.95+.2*Math.cos(j))*scale,(.8+.15*Math.sin(j))*scale,1.1*scale]);
        for(let k=0;k<5;k++){
          const px=tx+(rand()-.5)*1.2,pz=tz+(rand()-.5)*1.2,drop=1.7+rand()*1.8;
          beam([px,4.7*scale,pz],[px+.2,(4.7-drop)*scale,pz+.18],.014,M.leaf2);
          for(let q=0;q<7;q++)mesh(bambooLeafGeometry,M.bambooLeaf,[px+.2*q/7,(4.7-drop*q/7)*scale,pz+.18*q/7],[.9,-.65,.9],root,[.3,a,.22]);
        }
      }
      obstacles.push({x0:x-.45,x1:x+.45,z0:z-.45,z1:z+.45,y1:4.5*scale});
    }
    willow(-13,6,.85);willow(15,-22,1.0);
    const beds=[[-35,1,2.5,6],[-17,19,3,2],[10,20,3,1.6],[30,-28,5,1.5],[-8,-30,4,1.3],[35,26,2.4,2]];
    for(const [x,z,sx,sz] of beds){
      mesh(geo.leaf,M.moss,[x,.10,z],[sx,.45,sz]);
      for(let i=0;i<12;i++){
        const a=i*2.4,r=Math.sqrt(rand()),px=x+Math.cos(a)*sx*r,pz=z+Math.sin(a)*sz*r;
        mesh(geo.leaf,i%5===0?M.pink:i%2?M.leaf:M.leaf2,[px,.45+rand()*.25,pz],[.65,.45+rand()*.3,.65]);
        if(i%4===0)rock(px,.12,pz,.45,.35,.4,i);
      }
      obstacles.push({x0:x-sx*.8,x1:x+sx*.8,z0:z-sz*.8,z1:z+sz*.8,y1:1.2});
    }
    // Mossy pockets, flowering shrubs and sparse lotus leave the central water open.
    for(let i=0;i<95;i++){
      const x=(rand()-.5)*74,z=(rand()-.5)*61;
      if(waterAt(x,z)||Math.abs(x)<6&&z>6||walkCurves.some(c=>nearCurve(c,x,z,3.1))||surfaces.some(r=>x>r.x0-1.4&&x<r.x1+1.4&&z>r.z0-1.4&&z<r.z1+1.4)||nearCurve(zigPoints.map(([x,z])=>({x,z})),x,z,2.5))continue;
      const sx=.65+rand()*.7,sz=.7+rand()*.7;
      mesh(geo.leaf,i%9===0?M.pink:M.leaf,[x,.35+rand()*.3,z],[sx,.45+rand()*.4,sz]);
      obstacles.push({x0:x-sx*.8,x1:x+sx*.8,z0:z-sz*.8,z1:z+sz*.8,y1:1.2});
    }
    const padShape=new THREE.Shape();padShape.moveTo(0,0);for(let i=0;i<=30;i++){const a=.14+i/30*(Math.PI*2-.28);padShape.lineTo(Math.cos(a),Math.sin(a));}padShape.closePath();
    const padGeometry=new THREE.ShapeGeometry(padShape,8);padGeometry.rotateX(-Math.PI/2);
    for(let i=0;i<32;i++){
      const a=i*2.4,x=10+Math.cos(a)*(2+rand()*4),z=-12+Math.sin(a)*(2+rand()*5);if(!waterAt(x,z))continue;
      mesh(padGeometry,M.leaf2,[x,.025,z],[.3+rand()*.24,1,.3+rand()*.24],root,[0,a,0]);
      if(i%7===0)for(let k=0;k<7;k++)mesh(bambooLeafGeometry,M.petal,[x,.18,z],[.9,.4,.9],root,[.8,Math.PI*2*k/7,0]);
    }
    for(const [x,z] of [[-8,20],[8,20],[-23,17],[21,12],[-32,-7],[31,-15],[-15,-28],[16,-27]]){
      cyl(M.stone,x,.45,z,.19,.9);box(M.dark,x,.98,z,.48,.52,.48);mesh(geo.ball,M.lantern,[x,.98,z],[.15,.19,.15]);box(M.ridge,x,1.3,z,.7,.12,.7);
      obstacles.push({x0:x-.29,x1:x+.29,z0:z-.29,z1:z+.29,y1:1.4});
    }
    // Open lattice wings frame the waterfront performance without blocking
    // the central approach from the moon gate or the dancer's floor space.
    for(const side of [-1,1]){
      const x=side*3.15;
      cyl(M.stone,x,.55,10.65,.22,.3);
      cyl(M.timber,x,2.02,10.65,.11,2.8);
      box(M.gold,x,3.25,10.65,.27,.09,.27);
      box(M.timber,side*2.65,2,10.8,1.0,2.35,.12);
      box(M.window,side*2.65,2,10.72,.86,2.15,.035);
      for(let k=0;k<5;k++)box(M.timber,side*2.65,1.05+k*.46,10.68,.91,.04,.05);
      for(let k=0;k<3;k++)box(M.timber,side*2.65-.3+k*.3,2,10.67,.035,2.2,.05);
      lantern(x,2.75,10.1);
      obstacles.push({x0:x-.23,x1:x+.23,z0:10.4,z1:10.95,y1:3.5});
      obstacles.push({x0:side*2.65-.52,x1:side*2.65+.52,z0:10.63,z1:10.9,y1:3.2});
    }
    box(M.timber,0,3.48,10.65,6.7,.18,.25);
    box(M.gold,0,3.38,10.48,6.45,.035,.03);
    plaque('临 水 清 音',2.15,.48,root,0,3.12,10.48);
    // Fine shoreline reeds and veins on lotus leaves share existing materials.
    // They stay below the walkable bank and do not introduce new obstacles.
    const reedGeometry=new THREE.PlaneGeometry(.045,1,1,3);
    const rp=reedGeometry.attributes.position;
    for(let i=0;i<rp.count;i++){const y=rp.getY(i)+.5;rp.setXYZ(i,rp.getX(i)*(1-y*.8),y,y*y*.22);}reedGeometry.computeVertexNormals();
    pond.forEach((p,i)=>{
      if(i%5!==0)return;
      const x=p.x*.975,z=p.y*.975;
      for(let k=0;k<(compact?4:8);k++)mesh(reedGeometry,M.bambooLeaf,[x+Math.sin(k*2.4)*.3,.02,z+Math.cos(k*2.4)*.3],[1,.45+rand()*.5,1],root,[0,k*2.4,0]);
    });
    // Timber grain catches grazing light, plaster has a fine mineral relief.
    const woodMap=canvasTexture(128,256,c=>{
      c.fillStyle='#b6a38e';c.fillRect(0,0,128,256);
      for(let i=0;i<180;i++){c.strokeStyle=i%3?'#584d3b22':'#f2dec333';c.beginPath();const x=rand()*128;c.moveTo(x,0);c.bezierCurveTo(x+8,90,x-6,170,x+3,256);c.stroke();}
    });
    woodMap.wrapS=woodMap.wrapT=THREE.RepeatWrapping;M.timber.bumpMap=woodMap;M.timber.bumpScale=.025;
    M.wall.bumpMap=rockMap;M.wall.bumpScale=.016;M.wall2.bumpMap=rockMap;M.wall2.bumpScale=.012;
    M.tile.bumpMap=roofMap;M.tile.bumpScale=.035;
    // Preserve the instanced-mesh export contract used by the project.
    root.updateMatrixWorld(true);const sourceMeshes=[];root.traverse(o=>{if(o.isMesh)sourceMeshes.push(o);});
    for(const o of sourceMeshes){
      const key=o.geometry.uuid+'/'+o.material.uuid;
      if(!batches.has(key))batches.set(key,{geometry:o.geometry,material:o.material,items:[]});
      batches.get(key).items.push({matrix:o.matrixWorld.clone(),name:[o.parent.name,o.name||o.material.name].filter(Boolean).join(' / ')});o.removeFromParent();
    }
    root.clear();let triangles=0,instances=0;
    for(const batch of batches.values()){
      const inst=new THREE.InstancedMesh(batch.geometry,batch.material,batch.items.length);inst.name=batch.material.name;inst.castShadow=!batch.material.transparent&&batch.material!==M.water&&batch.material!==M.pebble&&batch.material!==M.path&&batch.material!==M.ground;inst.receiveShadow=true;
      batch.items.forEach((item,i)=>inst.setMatrixAt(i,item.matrix));inst.instanceMatrix.needsUpdate=true;inst.computeBoundingSphere();root.add(inst);
      instances+=batch.items.length;triangles+=(batch.geometry.index?.count||batch.geometry.attributes.position.count)/3*batch.items.length;
    }
    // Subtle spray is separate from the exported static garden geometry.
    const mistCount=compact?16:30,mistPositions=new Float32Array(mistCount*3),mistGeometry=new THREE.BufferGeometry();
    mistGeometry.setAttribute('position',new THREE.BufferAttribute(mistPositions,3));
    const mistMaterial=new THREE.PointsMaterial({color:'#e4eee4',size:.17,transparent:true,opacity:.28,depthWrite:false});
    mistMaterial.onBeforeCompile=shader=>{shader.fragmentShader=shader.fragmentShader.replace('#include <color_fragment>','#include <color_fragment>\nif(length(gl_PointCoord-vec2(.5))>.5)discard;');};
    const mist=new THREE.Points(mistGeometry,mistMaterial);mist.name='叠瀑水雾';root.add(mist);
    const inside=(r,x,z)=>x>=r.x0&&x<=r.x1&&z>=r.z0&&z<=r.z1;
    function gateBlocked(x,y,z){return gateOpenings.some(g=>{
      const dx=x-g.x,dz=z-g.z,lx=dx*Math.cos(g.rotation)-dz*Math.sin(g.rotation),lz=dx*Math.sin(g.rotation)+dz*Math.cos(g.rotation);
      return Math.abs(lx)<4.35&&Math.abs(lz)<.33&&y<5.85&&(y>4.65||lx*lx+(y-g.cy)**2>g.radius*g.radius);
    });}
    const heightfield={spawn:[0,0,23],performance:[0,.398,8.5],sample(x,z,refY=0,maxStep=.55){
      let ground=0,onBridge=false;
      for(const s of surfaces)if(inside(s,x,z))ground=Math.max(ground,s.y);
      if(inside(arch,x,z)){ground=Math.max(ground,archY(x));onBridge=true;}
      if(pointIn(zigPolygon,x,z)){ground=Math.max(ground,.35);onBridge=true;}
      const blocked=Math.abs(x)>38.4||Math.abs(z)>32.5||ground>refY+maxStep||(!onBridge&&waterAt(x,z))||obstacles.some(r=>inside(r,x,z))||gateBlocked(x,.18,z)||railBarriers.some(r=>nearCurve(r.points,x,z,r.radius));
      return {ground,blocked,water:waterAt(x,z),bridge:onBridge};
    },cameraBlocked(x,y,z){
      return Math.abs(x)>38.6||Math.abs(z)>33||obstacles.some(r=>inside(r,x,z)&&y<(r.y1??3.5))||gateBlocked(x,y,z)||railBarriers.some(r=>y<r.top&&nearCurve(r.points,x,z,r.radius));
    }};
    function update(time=0){
      timeUniform.value=time;
      for(let i=0;i<mistCount;i++){
        const p=(time*.23+i*.618)%1,a=i*2.4;
        mistPositions[i*3]=-25.1+Math.cos(a)*p*1.8;mistPositions[i*3+1]=.12+Math.sin(p*Math.PI)*.9;mistPositions[i*3+2]=-17.8+Math.sin(a)*p*1.4;
      }mistGeometry.attributes.position.needsUpdate=true;
    }update(0);
    const stats={name:'碧波园 · 追鱼意境',buildings:buildings.length,instances,drawCalls:batches.size+1,triangles:Math.round(triangles),bamboo:bambooCount,bridges:2,waterfalls:3};
    root.userData={design:'原创《追鱼》意境后花园 · 苏州园林布局参考',buildings,stats};
    return {root,heightfield,stats,buildings,update,waterAt,materials:M,pond,railBarriers,
      configureReflection(texture,projection){reflection.texture.value=texture;reflection.projection.value=projection;reflection.strength.value=1;},
      maxAnisotropy:1,setScene(){},installVenue(){},addStageSteps(){}};
  };
})(typeof window!=='undefined'?window:globalThis);
