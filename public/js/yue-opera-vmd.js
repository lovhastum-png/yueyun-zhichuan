/* Local-only VMD playback. No motion or music is uploaded or bundled with the site. */
(function(global){
  'use strict';
  const clamp=(n,a=0,b=1)=>Math.max(a,Math.min(b,n));
  function parse(buffer){
    if(buffer.byteLength<54||buffer.byteLength>24*1024*1024)throw Error('动作文件大小不正确');
    const bytes=new Uint8Array(buffer),view=new DataView(buffer),decoder=new TextDecoder('shift-jis');
    const str=(at,n)=>decoder.decode(bytes.subarray(at,at+n)).split('\0')[0];
    if(!str(0,30).startsWith('Vocaloid Motion Data 0002'))throw Error('请选择 VMD 2 人物动作文件');
    const count=view.getUint32(50,true),tracks=new Map();let lastFrame=0;
    if(count>180000||54+count*111>buffer.byteLength)throw Error('动作数据不完整');
    for(let i=0;i<count;i++){
      const at=54+i*111,name=str(at,15),f=view.getUint32(at+15,true);
      const p=Array.from({length:3},(_,k)=>view.getFloat32(at+19+k*4,true));
      const q=Array.from({length:4},(_,k)=>view.getFloat32(at+31+k*4,true));
      if(![...p,...q].every(Number.isFinite)||f>108000||Math.hypot(...q)<.1)throw Error('动作包含无效关键帧');
      // Reflect the MMD left-handed coordinates into Three.js right-handed coordinates.
      p[2]*=-1;q[0]*=-1;q[1]*=-1;
      const curves=Array.from({length:4},(_,k)=>[0,4,8,12].map(j=>clamp(bytes[at+47+j+k]/127)));
      if(!tracks.has(name))tracks.set(name,[]);
      tracks.get(name).push({f,p,q,curves});lastFrame=Math.max(lastFrame,f);
    }
    if(!tracks.has('センター')||!tracks.has('左腕')||lastFrame<900)throw Error('请选择超过30秒的完整人物动作，不要选择镜头或扇子文件');
    for(const [name,keys]of tracks){keys.sort((a,b)=>a.f-b.f);tracks.set(name,keys.filter((k,i)=>i===keys.length-1||k.f!==keys[i+1].f));}
    return {tracks,duration:lastFrame/30,lastFrame};
  }
  function bezier(x,c){
    if(x<=0||x>=1)return clamp(x);
    const cubic=(t,a,b)=>3*(1-t)**2*t*a+3*(1-t)*t*t*b+t*t*t;
    let lo=0,hi=1,t=x;
    for(let i=0;i<12;i++){t=(lo+hi)/2;if(cubic(t,c[0],c[2])<x)lo=t;else hi=t;}
    return cubic(t,c[1],c[3]);
  }
  function sample(THREE,clip,name,time){
    const keys=clip.tracks.get(name);
    if(!keys?.length)return {p:new THREE.Vector3(),q:new THREE.Quaternion()};
    const frame=clamp(time*30,0,clip.lastFrame);let lo=0,hi=keys.length-1;
    while(lo<hi){const mid=Math.ceil((lo+hi)/2);if(keys[mid].f<=frame)lo=mid;else hi=mid-1;}
    const a=keys[lo],b=keys[Math.min(lo+1,keys.length-1)],u=b.f>a.f?clamp((frame-a.f)/(b.f-a.f)):0;
    const p=new THREE.Vector3(...a.p.map((v,k)=>v+(b.p[k]-v)*bezier(u,b.curves[k])));
    const q=new THREE.Quaternion().fromArray(a.q).normalize().slerp(new THREE.Quaternion().fromArray(b.q).normalize(),bezier(u,b.curves[3]));
    return {p,q};
  }
  global.YueOperaVMD={parse,sample};
  global.createYueOperaVMD=function(THREE,{vrm,model,root,baseY}){
    const bone=n=>vrm.humanoid.getNormalizedBoneNode(n),rig=vrm.humanoid.normalizedHumanBonesRoot;
    const v=()=>new THREE.Vector3(),q=()=>new THREE.Quaternion();
    vrm.humanoid.resetNormalizedPose();model.updateMatrixWorld(true);
    const point=n=>rig.worldToLocal(n.getWorldPosition(v()));
    const hipsRest=bone('hips').position.clone(),scale=point(bone('hips')).y/12;
    const legs=['left','right'].map(side=>({side,upper:bone(side+'UpperLeg'),lower:bone(side+'LowerLeg'),foot:bone(side+'Foot'),rest:point(bone(side+'Foot')),a:bone(side+'LowerLeg').position.clone(),b:bone(side+'Foot').position.clone()}));
    const mappings=[['spine','上半身'],['chest','上半身2'],['neck','首'],['head','頭']];
    for(const [side,jp]of [['left','左'],['right','右']]){
      mappings.push([side+'Shoulder',jp+'肩'],[side+'UpperArm',jp+'腕'],[side+'LowerArm',jp+'ひじ'],[side+'Hand',jp+'手首']);
      for(const [finger,label]of [['Index','人指'],['Middle','中指'],['Ring','薬指'],['Little','小指']])['Proximal','Intermediate','Distal'].forEach((joint,i)=>mappings.push([side+finger+joint,jp+label+'１２３'[i]]));
      ['Metacarpal','Proximal','Distal'].forEach((joint,i)=>mappings.push([side+'Thumb'+joint,jp+'親指'+'０１２'[i]]));
    }
    // Original fan geometry; the downloaded accessory is not redistributed.
    const fan=new THREE.Group(),fanMaterial=new THREE.MeshStandardMaterial({color:0xa52c42,roughness:.8,side:THREE.DoubleSide});
    const ribMaterial=new THREE.MeshStandardMaterial({color:0xd8b473,roughness:.5});
    const shape=new THREE.Shape();shape.moveTo(0,0);const radius=.38;
    for(let i=0;i<=24;i++){const a=-1.2+i/24*2.4;shape.lineTo(Math.sin(a)*radius,Math.cos(a)*radius);}shape.lineTo(0,0);
    const silk=new THREE.Mesh(new THREE.ShapeGeometry(shape),fanMaterial);fan.add(silk);
    for(let i=0;i<=12;i++){const a=-1.2+i/12*2.4,rib=new THREE.Mesh(new THREE.CylinderGeometry(.002,.003,radius,4),ribMaterial);rib.position.set(Math.sin(a)*radius/2,Math.cos(a)*radius/2,.003);rib.rotation.z=-a;fan.add(rib);}
    fan.visible=false;bone('rightHand').add(fan);fan.position.set(-.025,-.015,0);fan.rotation.set(0,0,-Math.PI/2);
    let clip=null,state=null,initialCenter=v();
    function setClip(next){clip=next;initialCenter.copy(sample(THREE,clip,'センター',0).p);}
    function aim(node,rest,vector){
      const local=vector.normalize().applyQuaternion(rig.getWorldQuaternion(q())).applyQuaternion(node.parent.getWorldQuaternion(q()).invert());
      node.quaternion.setFromUnitVectors(rest.clone().normalize(),local);node.updateWorldMatrix(false,true);
    }
    function solve(leg,target,pole){
      const start=point(leg.upper),offset=target.clone().sub(start),a=leg.a.length(),b=leg.b.length();
      const distance=clamp(offset.length(),Math.abs(a-b)+.001,a+b-.0001),axis=offset.normalize();
      const bend=pole.clone().sub(start);bend.addScaledVector(axis,-bend.dot(axis));
      if(bend.lengthSq()<1e-8)bend.set(0,0,1);bend.normalize();
      const along=(a*a-b*b+distance*distance)/(2*distance),height=Math.sqrt(Math.max(0,a*a-along*along));
      const knee=start.clone().addScaledVector(axis,along).addScaledVector(bend,height);
      aim(leg.upper,leg.a,knee.clone().sub(start));aim(leg.lower,leg.b,target.clone().sub(knee));
    }
    function play(time,origin,heading,delta){
      if(!clip)return;
      vrm.humanoid.resetNormalizedPose();model.position.y=baseY;root.position.copy(origin);root.rotation.y=heading;
      const get=n=>sample(THREE,clip,n,time),all=get('全ての親'),center=get('センター'),groove=get('グルーブ'),waist=get('腰'),lower=get('下半身');
      const movement=center.p.clone().sub(initialCenter).add(groove.p).multiplyScalar(scale);
      const base=all.q.clone().multiply(center.q).multiply(groove.q).multiply(waist.q);
      bone('hips').position.copy(hipsRest).add(movement).addScaledVector(all.p,scale);
      bone('hips').quaternion.copy(base).multiply(lower.q);
      for(const [target,source]of mappings)if(bone(target))bone(target).quaternion.copy(get(source).q);
      // MMD upper/lower body are siblings; VRM spine is below hips, so cancel lower-body rotation.
      bone('spine').quaternion.premultiply(lower.q.clone().invert());
      for(const [side,jp]of [['left','左'],['right','右']]){
        bone(side+'Shoulder').quaternion.premultiply(get(jp+'肩P').q);
        bone(side+'UpperArm').quaternion.multiply(get(jp+'腕捩').q);
        bone(side+'LowerArm').quaternion.multiply(get(jp+'手捩').q);
      }
      model.updateMatrixWorld(true);
      for(const leg of legs){
        const jp=leg.side==='left'?'左':'右',ik=get(jp+'足ＩＫ'),parent=get(jp+'足IK親');
        const target=leg.rest.clone().addScaledVector(ik.p,scale).applyQuaternion(parent.q).addScaledVector(parent.p,scale).applyQuaternion(all.q).addScaledVector(all.p,scale);
        const pole=point(leg.upper).add(new THREE.Vector3(0,0,1).applyQuaternion(base).multiplyScalar(.6));
        solve(leg,target,pole);
        leg.foot.quaternion.copy(leg.foot.parent.getWorldQuaternion(q()).invert()).multiply(rig.getWorldQuaternion(q())).multiply(all.q).multiply(parent.q).multiply(ik.q);
      }
      fan.visible=true;
      const hand=time*30>=3099&&time*30<3375?'leftHand':'rightHand';
      if(fan.parent!==bone(hand)){bone(hand).add(fan);fan.rotation.z=hand==='leftHand'?Math.PI/2:-Math.PI/2;}
      const blink=time%4.8;vrm.expressionManager?.setValue('blink',blink>4.6?Math.sin((blink-4.6)/.2*Math.PI):0);
      vrm.update(delta);
      state={name:'寄明月 · 国风扇舞',label:'动作 Nivsha',phase:clamp(time/clip.duration),duration:clip.duration};
    }
    return {setClip,play,get state(){return state;},hide(){fan.visible=false;}};
  };
})(typeof window!=='undefined'?window:globalThis);
