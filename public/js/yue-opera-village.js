/* Original, deterministic Three.js architecture. Units: metres; +Z is the audience. */
(function (global) {
  'use strict';
  global.createYueOperaVillage = function (THREE, scene, compact = false) {
    const root = new THREE.Group();
    root.name = 'Yueyun_Jiangnan_Opera_Village';
    scene.add(root);
    let seed = 20261019;
    const rand = () => ((seed = (1664525 * seed + 1013904223) >>> 0) / 4294967296);
    const buildings = [], obstacles = [], surfaces = [], batches = new Map();
    const mat = (name, color, roughness = 0.85, extra = {}) => {
      const m = new THREE.MeshStandardMaterial({ color, roughness, ...extra }); m.name = name; return m;
    };
    const M = {
      wall: mat('Limewash · warm ivory', '#e3ddca'), wall2: mat('Limewash · chalk', '#f1ead8'),
      stone: mat('Bluestone', '#7f8984'), trim: mat('Pale granite coping', '#bbc0b4'),
      ground: mat('Courtyard stone', '#a1aaa1'), earth: mat('Garden earth', '#56684d'),
      timber: mat('Oiled chestnut', '#483025'), dark: mat('Blackened timber', '#292d29'),
      red: mat('Opera vermilion', '#823c34'), gold: mat('Aged brass', '#b99051', 0.46, { metalness: 0.45 }),
      tile: mat('Blue-grey roof tiles', '#8d9fb4'), ridge: mat('Glazed ridge caps', '#687674'),
      curtain: mat('Crimson embroidered silk', '#852f3e', 0.9, { side: THREE.DoubleSide }),
      leaf: mat('Camphor foliage', '#49654d'), leaf2: mat('New foliage', '#64815b'),
      pink: mat('Magnolia blossoms', '#d4b9af'), water: mat('Jade water', '#437e7a', 0.19, { metalness: 0.3 }),
      window: mat('Rice-paper warm windows', '#e2ba7b', 0.65, { emissive: '#b27135', emissiveIntensity: 0.45 }),
      lantern: mat('Amber silk lantern', '#e9ac61', 0.65, { emissive: '#ed923c', emissiveIntensity: 0.8 }),
    };
    function canvasTexture(w, h, paint) {
      const c = document.createElement('canvas'); c.width = w; c.height = h;
      paint(c.getContext('2d'), w, h);
      const tex = new THREE.CanvasTexture(c); tex.colorSpace = THREE.SRGBColorSpace; return tex;
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
    stoneMap.wrapS = stoneMap.wrapT = THREE.RepeatWrapping; stoneMap.repeat.set(18, 16); M.ground.map = stoneMap;
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
      obstacles.push({x0:x-halfX,x1:x+halfX,z0:z-halfZ,z1:z+halfZ});
      buildings.push({name,x,z,width:w,depth:d,levels}); return p;
    }
    // Site: quiet ivory masonry and small warm windows, unified by a bluestone court.
    box(M.stone,0,-.6,0,84,1.1,72);
    box(M.ground,0,-.07,0,82,.12,70);
    for(const x of [-15,15])box(M.trim,x,.012,3,.36,.025,52);
    for(const z of [-14,22])box(M.trim,0,.013,z,30,.025,.36);
    for(const x of [-40.5,40.5]) {box(M.wall,x,1.05,0,.4,2.1,70);box(M.ridge,x,2.15,0,.65,.18,70);}
    box(M.wall,0,1.05,-34.5,81,2.1,.4);box(M.ridge,0,2.15,-34.5,81,.18,.65);
    // Independent buildings create a layered roofscape, small lanes and pocket gardens.
    const layout=[
      ['听雨楼',-21,-3,8,9,2,Math.PI/2],['望月楼',21,-3,8,9,2,-Math.PI/2],
      ['春和茶馆',-21,10,8,8,2,Math.PI/2],['清音茶馆',21,10,8,8,2,-Math.PI/2],
      ['戏曲书院',-13,-23,10,7,2,0],['越韵传习所',0,-24,11,8,2,0],['百戏藏馆',13,-23,10,7,2,0],
      ['染坊',-32,-23,7,7,1,0],['琴房',-31,-12,8,6,1,Math.PI/2],['绣坊',-32,1,7,7,1,Math.PI/2],
      ['南窗小筑',-32,16,7,7,2,Math.PI/2],['乌篷客舍',-23,27,8,6,1,0],['西泠雅舍',-12,28,7,6,1,0],
      ['制扇坊',32,-23,7,7,1,0],['妆造馆',32,-12,8,6,1,-Math.PI/2],['问梅居',32,2,7,7,1,-Math.PI/2],
      ['东篱客舍',32,17,7,7,2,-Math.PI/2],['竹间茶室',23,27,8,6,1,0],['听荷小筑',12,28,7,6,1,0],
    ];
    layout.forEach((a,i)=>house(...a,i));
    function gallery(x,z,length,rot=0) {
      const p=new THREE.Group();p.name='Covered_walkway';p.position.set(x,0,z);p.rotation.y=rot;root.add(p);
      box(M.trim,0,.13,0,length,.26,2.45,p);
      const n=Math.ceil(length/2.8);
      for(let i=0;i<=n;i++)for(const side of [-1,1]){
        const xx=-length/2+i*length/n;cyl(M.timber,xx,1.65,side*.96,.075,3.1,p);
        if(side===1 && i%2===0)lantern(xx,2.55,0,p);
      }
      box(M.timber,0,3.13,0,length,.15,2.2,p);roof(length+1,3.35,.72,3.17,p,false);
      return p;
    }
    gallery(-16,9,22,Math.PI/2);gallery(16,9,22,Math.PI/2);
    gallery(-13,-15,9);gallery(13,-15,9);
    gallery(-27,22,12);gallery(27,22,12);
    // Freestanding central opera stage: generous clear floor, open front, backstage doors.
    const stage=new THREE.Group();stage.name='Central_Yue_Opera_Stage';stage.position.z=-3;root.add(stage);
    box(M.trim,0,.43,0,15,.86,10.4,stage);
    box(M.stone,0,.94,0,14.5,.30,10,stage);
    box(M.timber,0,1.14,0,14.2,.10,9.7,stage);
    // Fine board seams give the performance floor a readable timber scale.
    for(let i=0;i<29;i++)box(M.dark,-6.9+i*.49,1.196,0,.018,.008,9.6,stage);
    for(const x of [-6.5,6.5])for(const z of [-4.2,3.9]){
      cyl(M.stone,x,1.32,z,.34,.26,stage);cyl(M.red,x,3.73,z,.19,4.65,stage);
      box(M.gold,x,5.66,z,1.1,.11,.42,stage);box(M.timber,x,5.86,z,1.6,.12,.65,stage);
    }
    box(M.timber,0,5.98,0,13.4,.26,8.7,stage);
    box(M.red,0,5.55,4.12,13.2,.23,.25,stage);
    roof(16.4,11.8,2.1,6.15,stage,true);
    // Small upper roof gives the theatre its main silhouette without hiding the court.
    box(M.wall,0,7.2,-.6,7.4,.8,3.1,stage);
    const upper=new THREE.Group();upper.position.z=-.6;stage.add(upper);roof(10,5.6,1.35,7.65,upper,true);
    box(M.dark,0,3.4,-4.35,13.3,4.5,.22,stage);
    for(let i=0;i<27;i++){
      const xx=-4.2+i*.323;box(M.curtain,xx,3.19,-4.13+Math.sin(i*.8)*.045,.33,3.8,.11,stage);
    }
    const embroidery=canvasTexture(768,512,(c,w,h)=>{
      c.clearRect(0,0,w,h);c.strokeStyle='#c5a15f';c.lineWidth=6;c.strokeRect(12,12,w-24,h-24);
      c.lineWidth=2;c.strokeRect(28,28,w-56,h-56);c.beginPath();c.arc(w/2,h/2,147,0,Math.PI*2);c.stroke();
      for(let k=0;k<12;k++){const a=k/12*Math.PI*2;c.save();c.translate(w/2,h/2);c.rotate(a);c.beginPath();c.ellipse(0,-110,22,50,0,0,Math.PI*2);c.stroke();c.restore();}
      c.fillStyle='#d7b777';c.textAlign='center';c.textBaseline='middle';c.font='100px "KaiTi",serif';c.fillText('越',w/2,h/2);
    });
    const silk=mat('Curtain embroidery','#ffffff',.85,{map:embroidery,transparent:true,side:THREE.DoubleSide});
    mesh(new THREE.PlaneGeometry(8.35,3.75),silk,[0,3.2,-3.99],[1,1,1],stage);
    for(const side of [-1,1]) {
      box(M.red,side*5.55,2.65,-4.08,1.55,2.85,.2,stage);
      plaque(side<0?'出将':'入相',.48,1.65,stage,side*5.55,2.9,-3.92,true);
      plaque(side<0?'一曲越音传雅韵':'满庭灯影入江南',.43,3.35,stage,side*6.5,3.65,4.14,true);
      lantern(side*4.85,4.73,4.25,stage);
      // Audience-side balustrades stop at the central stairs, leaving a clear stage mouth.
      railing(side*5.75,1.2,4.42,1.6,stage);
    }
    plaque('越 韵 戏 台',4.5,.83,stage,0,5.25,4.25);
    surfaces.push({x0:-7.15,x1:7.15,z0:-8.2,z1:2.2,y:1.195});
    // Six genuinely walkable shallow steps on the main axis.
    for(let i=0;i<6;i++){
      const top=(6-i)*.199,zc=2.4+i*.40;
      box(M.trim,0,top/2,zc,6.2,top,.42);
      surfaces.push({x0:-3.1,x1:3.1,z0:zc-.21,z1:zc+.21,y:top});
    }
    obstacles.push({x0:-6.8,x1:6.8,z0:-7.55,z1:-6.95});
    for(const xx of [-6.5,6.5])for(const zz of [-7.2,.9])obstacles.push({x0:xx-.3,x1:xx+.3,z0:zz-.3,z1:zz+.3});
    // A table and two chairs sit backstage, leaving the front 6 metres for the avatar.
    box(M.red,0,1.98,-5.7,2,.12,.8);for(const xx of [-.8,.8])for(const zz of [-5.95,-5.45])box(M.timber,xx,1.57,zz,.09,.75,.09);
    for(const xx of [-2.2,2.2]) {box(M.timber,xx,1.65,-5.7,.68,.12,.7);box(M.timber,xx,2.05,-6,.68,.9,.09);}
    obstacles.push({x0:-2.6,x1:2.6,z0:-6.3,z1:-5.15});
    buildings.push({name:'越韵戏台',x:0,z:-3,width:15,depth:10.4,levels:2});
    // Tea tables for the audience, kept out of the central promenade.
    for(const side of [-1,1])for(let row=0;row<3;row++)for(let col=0;col<2;col++){
      const x=side*(6.6+col*4.3),z=8+row*4.3;
      box(M.timber,x,.74,z,1.5,.12,1.1);for(const dx of [-.58,.58])for(const dz of [-.38,.38])box(M.timber,x+dx,.36,z+dz,.075,.72,.075);
      for(const dz of [-1.12,1.12]){box(M.timber,x,.45,z+dz,1.9,.12,.36);for(const dx of [-.68,.68])box(M.timber,x+dx,.21,z+dz,.09,.42,.24);}
      obstacles.push({x0:x-1.05,x1:x+1.05,z0:z-1.4,z1:z+1.4});
    }
    // Slim entrance pavilion aligned to the stage and the court.
    const gate=new THREE.Group();gate.name='South_Entrance';gate.position.set(0,0,29);root.add(gate);
    for(const side of [-1,1]){cyl(M.timber,side*3.5,2,0,.17,4,gate);lantern(side*2.7,3.0,.15,gate);}
    box(M.timber,0,3.8,0,7.5,.25,.5,gate);roof(9.5,3.7,1.3,3.95,gate);plaque('越 韵 里',2.9,.65,gate,0,3.36,.32);
    buildings.push({name:'越韵里门楼',x:0,z:29,width:9.5,depth:3.7,levels:1});
    function tree(x,z,size=1,blossom=false) {
      const p=new THREE.Group();p.name=blossom?'Flowering_magnolia':'Camphor_tree';p.position.set(x,0,z);root.add(p);
      box(M.trim,0,.18,0,2.4*size,.36,2.4*size,p);box(M.earth,0,.37,0,2.12*size,.025,2.12*size,p);
      cyl(M.timber,0,1.8*size,0,.16*size,3.6*size,p);
      for(let i=0;i<9;i++){
        const a=i*2.4,r=(.4+rand())*size,yy=(3.1+rand()*1.6)*size;
        const tip=[Math.cos(a)*r,yy,Math.sin(a)*r];beam([0,2.4*size,0],tip,.06*size,M.timber,p);
        mesh(geo.leaf,blossom?M.pink:(i%2?M.leaf:M.leaf2),tip,[(.85+rand()*.6)*size,(.7+rand()*.5)*size,(.9+rand()*.6)*size],p);
      }
      obstacles.push({x0:x-1.2*size,x1:x+1.2*size,z0:z-1.2*size,z1:z+1.2*size});
    }
    tree(-11.6,-11.8,.95,true);tree(11.6,-11.8,.95,true);tree(-11.7,22,1.15);tree(11.7,22,1.15);
    tree(-37,-5,1);tree(37,-5,1);tree(-37,26,1.1);tree(37,26,1.1);tree(-23,-30,1);tree(23,-30,1);
    // Two long reflecting gardens are outside the central viewing space.
    for(const side of [-1,1]) {
      const x=side*26;
      box(M.stone,x,-.04,7,3.8,.15,21);box(M.water,x,.045,7,3.3,.035,20.5);
      for(const dx of [-1.9,1.9])box(M.trim,x+dx,.14,7,.23,.28,21.4);
      for(const z of [-3.6,17.6])box(M.trim,x,.14,z,4,.28,.22);
      obstacles.push({x0:x-1.8,x1:x+1.8,z0:-3.4,z1:17.4});
      // The little bridge is a continuous, traversable axis across the canal.
      box(M.trim,x,.21,6.4,4.4,.25,2.2);
      surfaces.push({x0:x-2.2,x1:x+2.2,z0:5.3,z1:7.5,y:.335});
      for(const zz of [5.3,7.5]){
        box(M.trim,x,.9,zz,4.4,.13,.12);for(let i=0;i<5;i++)cyl(M.trim,x-2.1+i*1.05,.63,zz,.07,.85);
      }
      for(let i=0;i<9;i++){
        const xx=x+(rand()-.5)*2.2,zz=-2+rand()*18;
        if(zz>4.7&&zz<8.1)continue;
        mesh(new THREE.CircleGeometry(.22+rand()*.12,12),M.leaf,[xx,.07,zz],[1,1,1],root,[-Math.PI/2,0,0]);
      }
    }
    // Small pavilions close the northern garden lanes.
    for(const side of [-1,1]){
      const p=new THREE.Group();p.position.set(side*24,0,-17);p.name='Garden_pavilion';root.add(p);
      box(M.trim,0,.16,0,4.1,.32,4.1,p);for(const xx of [-1.45,1.45])for(const zz of [-1.45,1.45])cyl(M.timber,xx,1.8,zz,.08,3.3,p);
      roof(5.1,5.1,1.25,3.5,p);buildings.push({name:side<0?'听风亭':'问月亭',x:side*24,z:-17,width:5.1,depth:5.1,levels:1});
    }
    for(const x of [-14,14])for(const z of [3,13,23]){cyl(M.stone,x,.45,z,.14,.9);box(M.dark,x,.95,z,.35,.45,.35);mesh(geo.ball,M.lantern,[x,.98,z],[.12,.14,.12]);}
    // Consolidate repeated parts into GPU instances, reducing thousands of draws to a few dozen.
    root.updateMatrixWorld(true);
    const sourceMeshes=[];root.traverse(o=>{if(o.isMesh)sourceMeshes.push(o);});
    for(const o of sourceMeshes){
      const key=o.geometry.uuid+'/'+o.material.uuid;
      if(!batches.has(key))batches.set(key,{geometry:o.geometry,material:o.material,items:[]});
      batches.get(key).items.push({matrix:o.matrixWorld.clone(),name:[o.parent.name,o.name||o.material.name].filter(Boolean).join(' / ')});o.removeFromParent();
    }
    root.clear();
    let triangles=0,instances=0;
    for(const batch of batches.values()){
      const inst=new THREE.InstancedMesh(batch.geometry,batch.material,batch.items.length);
      inst.name=batch.material.name;inst.castShadow=batch.material!==M.water;inst.receiveShadow=true;
      inst.userData.instanceNames=batch.items.map(item=>item.name);
      batch.items.forEach((item,i)=>inst.setMatrixAt(i,item.matrix));inst.instanceMatrix.needsUpdate=true;
      inst.computeBoundingSphere();root.add(inst);instances+=batch.items.length;
      triangles+=(batch.geometry.index?batch.geometry.index.count:batch.geometry.attributes.position.count)/3*batch.items.length;
    }
    // Collision uses authored walkable surfaces, avoiding roof undersides being mistaken for floors.
    const inside=(r,x,z)=>x>=r.x0&&x<=r.x1&&z>=r.z0&&z<=r.z1;
    const heightfield={sample(x,z,refY=0,maxStep=.55){
      let ground=0;for(const s of surfaces)if(inside(s,x,z))ground=Math.max(ground,s.y);
      const bridge=Math.abs(Math.abs(x)-26)<2.2 && z>5.3 && z<7.5;
      const blocked=Math.abs(x)>39.7||Math.abs(z)>33.5||ground>refY+maxStep||obstacles.some(r=>inside(r,x,z)&&!(bridge&&r.z0===-3.4));
      return {ground,blocked};
    }};
    const stats={buildings:buildings.length,instances,drawCalls:batches.size,triangles:Math.round(triangles)};
    root.userData={design:'越韵里 · 江南戏院',buildings,stats};
    return {root,heightfield,stats,buildings,maxAnisotropy:1,setScene(){},update(){},installVenue(){},addStageSteps(){}};
  };
})(typeof window!=='undefined'?window:globalThis);
