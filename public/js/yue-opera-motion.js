/* Authored opera phrases: hand trajectories, two-bone IK, planted feet and pose blending. */
(function (global) {
  'use strict';
  const neutralL = [.48, -.86, .12], neutralR = [-.48, -.86, .12];
  function hand(position, direction, roll = 0, orchid = .25) {
    const side = position[0] < 0 ? -1 : 1;
    direction ||= position[1] < -.72 ? [side * .06, -1, .06] : Math.abs(position[0]) > .8 ? [side * .85, .30, .08] : [side * .28, .88, .18];
    return [...position, ...direction, roll, orchid];
  }
  function pose(l = neutralL, r = neutralR, body = [], options = {}) {
    return { left: hand(l, options.ld, options.lr, options.lf), right: hand(r, options.rd, options.rr, options.rf), body: Array.from({ length: 8 }, (_, i) => body[i] || 0) };
  }
  const neutral = pose();
  const folded = pose([.43, -.43, .48], [-.43, -.43, .48], [0, .014, 0, 0, .01, 0, -.025], { lr: -.12, rr: .12 });
  const halfOpen = pose([.82, -.29, .40], [-.82, -.29, .40], [0, .022, 0, 0, .018, .04, .015], { lr: -.12, rr: .12 });
  const opened = pose([1.11, -.06, .27], [-1.11, -.06, .27], [0, .016, -.025, .045, .01, .10, .015], { lr: -.20, rr: .20, lf: .55, rf: .55 });
  const leftSalute = pose([.72, .60, .37], [-.12, -.32, .64], [-.026, .025, .045, -.085, .018, .21, .12], { ld: [.24, .96, .08], rd: [-.90, .20, .14], lr: -.18, rr: .12, lf: .65, rf: .45 });
  const salutePrep = pose([.38, -.12, .60], [-.44, -.39, .50], [.018, .025, -.055, .065, .022, -.09, .025], { lr: .10, rr: .08 });
  const sleevePrepL = pose([.26, -.30, .68], [-.43, -.38, .52], [.025, .032, -.055, .065, .024, -.11, -.015], { lr: .28, rr: .10 });
  const sleeveLeft = pose([.93, .42, .38], [-.40, -.38, .55], [-.026, .018, .035, -.07, -.012, .22, .10], { ld: [.45, .87, .12], lr: -.30, rr: .13, lf: .38 });
  const sleevePrepR = pose([.43, -.38, .52], [-.26, -.30, .68], [-.025, .032, .055, -.065, .024, .11, -.015], { lr: -.10, rr: -.28 });
  const sleeveRight = pose([.40, -.38, .55], [-.93, .42, .38], [.026, .018, -.035, .07, -.012, -.22, .10], { rd: [-.45, .87, .12], lr: -.13, rr: .30, rf: .38 });
  const orchidLeft = pose([.62, .10, .54], [-.26, -.42, .54], [-.020, .018, -.035, .065, .01, .18, .025], { ld: [-.10, .97, .12], rd: [-.65, .55, .12], lr: -.22, rr: .10, lf: 1, rf: .35 });
  const orchidRight = pose([.26, -.42, .54], [-.62, .10, .54], [.020, .018, .035, -.065, .01, -.18, .025], { rd: [.10, .97, .12], ld: [.65, .55, .12], lr: -.10, rr: .22, lf: .35, rf: 1 });
  const phrases = {
    salute: { name: '托按掌亮相', duration: 11.6, keys: [[0,neutral,'垂袖静立'],[.13,folded,'提腕起势'],[.27,salutePrep,'转腰蓄势'],[.44,leftSalute,'托按亮相'],[.67,leftSalute,'亮相停顿'],[.84,folded,'含胸收势'],[.96,neutral,'垂袖归位'],[1,neutral,'静立']] },
    water: { name: '水袖抛扬', duration: 15.2, keys: [[0,neutral,'垂袖静立'],[.12,folded,'提腕起势'],[.23,sleevePrepL,'左袖蓄势'],[.36,sleeveLeft,'左袖舒展'],[.43,sleeveLeft,'袖势稍停'],[.54,folded,'圆腕收袖'],[.64,sleevePrepR,'右袖蓄势'],[.76,sleeveRight,'右袖舒展'],[.82,sleeveRight,'袖势稍停'],[.90,folded,'圆腕收袖'],[1,neutral,'垂袖归位']] },
    cloud: { name: '双山膀展袖', duration: 13.2, keys: [[0,neutral,'垂袖静立'],[.15,folded,'抱袖起势'],[.31,halfOpen,'圆肘开膀'],[.48,opened,'舒展山膀'],[.68,opened,'沉肩定势'],[.83,halfOpen,'圆腕回收'],[.96,neutral,'垂袖归位'],[1,neutral,'静立']] },
    orchid: { name: '兰指顾盼', duration: 13.6, keys: [[0,neutral,'垂袖静立'],[.14,folded,'含腕起势'],[.30,orchidLeft,'左指顾盼'],[.45,orchidLeft,'眼随手定'],[.56,folded,'含腕过门'],[.71,orchidRight,'右指顾盼'],[.81,orchidRight,'眼随手定'],[.88,folded,'敛指收势'],[1,neutral,'垂袖归位']] }
  };
  // Rehearsal only: four authored phrases, not a captured complete Chinese dance.
  phrases.rehearsal={name:'临水清音 · 身段预演',duration:60,keys:[]};
  ['salute','orchid','water','cloud'].forEach((name,index)=>{
    phrases[name].keys.forEach(([t,p,label],k)=>{if(index&&k===0)return;phrases.rehearsal.keys.push([(index+t)/4,p,label]);});
  });
  const clamp = (v, min = 0, max = 1) => Math.max(min, Math.min(max, v));
  const ease = v => { v = clamp(v); return v * v * v * (10 + v * (-15 + v * 6)); };
  function sample(name, time) {
    const phrase = phrases[name] || phrases.salute;
    const phase = name==='rehearsal'?Math.min(1,Math.max(0,time)/60):((Math.max(0,time) % phrase.duration) / phrase.duration);
    let i = 0;
    while (i < phrase.keys.length - 2 && phase >= phrase.keys[i + 1][0]) i++;
    const [start, a] = phrase.keys[i], [end, b, label] = phrase.keys[i + 1];
    const u = clamp((phase - start) / (end - start)), blend = ease(u);
    const result = { name: phrase.name, phase, duration: phrase.duration, label };
    for (const key of ['left','right','body']) {
      result[key] = a[key].map((v, index) => v + (b[key][index] - v) * blend);
      if (key !== 'body') {
        const travel = Math.hypot(...a[key].slice(0,3).map((v,k)=>v-b[key][k]));
        // The wrist travels on a forward arc; the polynomial has zero velocity and acceleration at both ends.
        const arc = 64 * u ** 3 * (1-u) ** 3 * Math.min(1,travel*3);
        result[key][1] += .055 * arc;
        result[key][2] += .095 * arc;
        const wristBlend = ease(clamp((u-.035)/.965));
        const from=a[key].slice(3,6),to=b[key].slice(3,6),fromLength=Math.hypot(...from),toLength=Math.hypot(...to);
        const av=from.map(v=>v/fromLength),bv=to.map(v=>v/toLength);
        const angle=Math.acos(clamp(av.reduce((sum,v,k)=>sum+v*bv[k],0),-1,1));
        const denominator=Math.sin(angle);
        for(let k=0;k<3;k++)result[key][3+k]=Math.abs(denominator)>.0001?(av[k]*Math.sin((1-wristBlend)*angle)+bv[k]*Math.sin(wristBlend*angle))/denominator:av[k]+(bv[k]-av[k])*wristBlend;
        result[key][6] = a[key][6] + (b[key][6] - a[key][6]) * wristBlend;
      }
    }
    return result;
  }
  global.YueOperaPhrases = { sample, names: Object.keys(phrases), duration: name => (phrases[name]||phrases.salute).duration };
  global.createYueOperaMotion = function (THREE, { vrm, model, root, baseY }) {
    const humanoid = vrm.humanoid, rig = humanoid.normalizedHumanBonesRoot;
    const bone = name => humanoid.getNormalizedBoneNode(name);
    const vector = (x=0,y=0,z=0) => new THREE.Vector3(x,y,z);
    const point = node => rig.worldToLocal(node.getWorldPosition(vector()));
    model.updateMatrixWorld(true);
    const left = point(bone('leftUpperArm')).sub(point(bone('rightUpperArm'))).normalize();
    const up = point(bone('head')).sub(point(bone('hips'))).normalize();
    const front = left.clone().cross(up).normalize();
    const orientationSign = front.z >= 0 ? 1 : -1;
    const chain = prefix => {
      const upper = bone(prefix+'UpperArm'), lower = bone(prefix+'LowerArm'), end = bone(prefix+'Hand');
      return {upper,lower,end,first:lower.position.clone(),second:end.position.clone(),length:lower.position.length()+end.position.length()};
    };
    const arms = { left: chain('left'), right: chain('right') };
    const unit = (arms.left.length + arms.right.length) / 2;
    const feet = ['left','right'].map(side => {
      const upper=bone(side+'UpperLeg'), lower=bone(side+'LowerLeg'),end=bone(side+'Foot');
      return {upper,lower,end,first:lower.position.clone(),second:end.position.clone(),target:point(end),side:side==='left'?1:-1};
    });
    const nodes = Object.values(humanoid.normalizedHumanBones).map(item => ({ node:item.node, q:new THREE.Quaternion(), p:vector() }));
    let state = { name:'静立',phase:0,label:'静立',duration:0 };
    const rotate = (name,x=0,y=0,z=0) => bone(name)?.rotation.set(x,y,z);
    const basis = (x,y,z) => left.clone().multiplyScalar(x).addScaledVector(up,y).addScaledVector(front,z);
    function begin() {
      nodes.forEach(item => {item.q.copy(item.node.quaternion);item.p.copy(item.node.position);});
      humanoid.resetNormalizedPose();
      model.position.y = baseY;
      model.updateMatrixWorld(true);
    }
    function direction(node, rest, target) {
      const rootRotation=rig.getWorldQuaternion(new THREE.Quaternion());
      const parentRotation=node.parent.getWorldQuaternion(new THREE.Quaternion()).invert();
      const localTarget=target.clone().normalize().applyQuaternion(rootRotation).applyQuaternion(parentRotation).normalize();
      node.quaternion.setFromUnitVectors(rest.clone().normalize(),localTarget);
      node.updateWorldMatrix(false,true);
    }
    function solve(limb, target, pole) {
      const start=point(limb.upper), offset=target.clone().sub(start);
      const a=limb.first.length(), b=limb.second.length();
      const distance=clamp(offset.length(),Math.abs(a-b)+.002,a+b-.001);
      const axis=offset.normalize();
      let bend=pole.clone().sub(start);bend.addScaledVector(axis,-bend.dot(axis));
      if(bend.lengthSq()<1e-8)bend=up.clone().addScaledVector(axis,-up.dot(axis));
      bend.normalize();
      const along=(a*a-b*b+distance*distance)/(2*distance);
      const height=Math.sqrt(Math.max(0,a*a-along*along));
      const elbow=start.clone().addScaledVector(axis,along).addScaledVector(bend,height);
      direction(limb.upper,limb.first,elbow.clone().sub(start));
      direction(limb.lower,limb.second,target.clone().sub(elbow));
    }
    function fingers(side, amount) {
      const sign = side==='left'?1:-1;
      const curlAxis=basis(sign,0,0).cross(front).normalize();
      const values={Index:[.07,.05,.02],Middle:[.16+.38*amount,.12+.28*amount,.05+.10*amount],Ring:[.23+.48*amount,.15+.32*amount,.08+.12*amount],Little:[.30+.50*amount,.18+.34*amount,.10+.14*amount]};
      for(const [finger,angles] of Object.entries(values)) ['Proximal','Intermediate','Distal'].forEach((joint,i)=>bone(side+finger+joint)?.quaternion.setFromAxisAngle(curlAxis,angles[i]));
      rotate(side+'ThumbMetacarpal',0,-sign*.20,sign*(.12+.18*amount));
      rotate(side+'ThumbProximal',0,-sign*(.12+.12*amount),sign*.12);
      rotate(side+'ThumbDistal',0,-sign*.16,0);
    }
    function placeArm(side, values, center) {
      const sign=side==='left'?1:-1,limb=arms[side];
      const target=center.clone().addScaledVector(left,values[0]*unit).addScaledVector(up,values[1]*unit).addScaledVector(front,values[2]*unit);
      const pole=center.clone().addScaledVector(left,sign*.88*unit).addScaledVector(up,-.42*unit).addScaledVector(front,.25*unit);
      solve(limb,target,pole);
      const finger=bone(side+'MiddleProximal') || bone(side+'IndexProximal');
      const restFinger=finger?.position.lengthSq()>1e-8?finger.position:limb.second;
      direction(limb.end,restFinger,basis(values[3],values[4],values[5]));
      limb.end.quaternion.multiply(new THREE.Quaternion().setFromAxisAngle(restFinger.clone().normalize(),values[6]));
      fingers(side,values[7]);
    }
    function upperBody(pose) {
      const b=pose.body;
      bone('hips').position.addScaledVector(left,b[0]*unit).addScaledVector(up,-b[1]*unit);
      rotate('hips',0,b[2]*.35,0);
      rotate('spine',b[4]*orientationSign,b[2]*.45,b[7]*orientationSign);
      rotate('chest',-b[4]*orientationSign*.3,b[3],-b[7]*orientationSign*.5);
      rotate('upperChest',0,b[3]*.25,0);
      rotate('neck',0,b[5]*.20,0);
      model.updateMatrixWorld(true);
      const gaze=front.clone().multiplyScalar(Math.cos(b[5])).addScaledVector(left,Math.sin(b[5])).addScaledVector(up,b[6]).normalize();
      direction(bone('head'),front,gaze);
      const center=point(arms.left.upper).add(point(arms.right.upper)).multiplyScalar(.5);
      placeArm('left',pose.left,center);placeArm('right',pose.right,center);
    }
    function finish(elapsed,delta,plant=true) {
      const amount=delta>0?1-Math.exp(-delta*12):1;
      nodes.forEach(({node,q,p})=>{
        const goal=node.quaternion.clone();node.quaternion.copy(q).slerp(goal,amount);
        node.position.lerpVectors(p,node.position.clone(),amount);
      });
      model.updateMatrixWorld(true);
      if(plant)feet.forEach(limb=>{
        const pole=limb.target.clone().addScaledVector(front,.55*unit).addScaledVector(up,.80*unit).addScaledVector(left,limb.side*.06*unit);
        solve(limb,limb.target,pole);
        const rootRotation=rig.getWorldQuaternion(new THREE.Quaternion());
        limb.end.quaternion.copy(limb.end.parent.getWorldQuaternion(new THREE.Quaternion()).invert()).multiply(rootRotation);
      });
      const blinkPhase=elapsed%4.8;
      vrm.expressionManager?.setValue('blink',blinkPhase>4.58?Math.max(0,Math.sin((blinkPhase-4.58)/.22*Math.PI)):0);
      vrm.update(delta);
    }
    return {
      get state(){return state;},
      idle(elapsed,delta){
        begin();
        const p={left:[...neutral.left],right:[...neutral.right],body:[...neutral.body]};
        p.body[4]=Math.sin(elapsed*1.15)*.006;p.body[5]=Math.sin(elapsed*.32)*.025;
        upperBody(p);finish(elapsed,delta);state={name:'静立',phase:0,label:'静立',duration:0};
      },
      walk(elapsed,strength,delta){
        begin();
        const gait=Math.sin(elapsed*7.4)*clamp(strength),p={left:[...neutral.left],right:[...neutral.right],body:[...neutral.body]};
        p.left[2]+=.12*gait;p.right[2]-=.12*gait;p.body[2]=gait*.018;p.body[3]=-gait*.025;
        upperBody(p);
        rotate('leftUpperLeg',gait*.40*orientationSign);rotate('rightUpperLeg',-gait*.40*orientationSign);
        rotate('leftLowerLeg',Math.max(0,-gait)*.48*orientationSign);rotate('rightLowerLeg',Math.max(0,gait)*.48*orientationSign);
        finish(elapsed,delta,false);state={name:'行走',phase:0,label:'行走',duration:0};
      },
      dance(name,elapsed,origin,heading,delta){
        begin();
        root.position.copy(origin);root.rotation.y=heading;
        const p=sample(name,elapsed);upperBody(p);finish(elapsed,delta);state=p;
      }
    };
  };
})(typeof window!=='undefined'?window:globalThis);
