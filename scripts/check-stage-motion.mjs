import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFile} from 'node:fs/promises';
import * as THREE from 'three';
import {VRMHumanoid} from '@pixiv/three-vrm-core';
const sandbox={};vm.createContext(sandbox);vm.runInContext(await readFile(new URL('../public/js/yue-opera-motion.js',import.meta.url),'utf8'),sandbox);
const mapping={leftThumbProximal:'leftThumbMetacarpal',leftThumbIntermediate:'leftThumbProximal',rightThumbProximal:'rightThumbMetacarpal',rightThumbIntermediate:'rightThumbProximal'};
const start=performance.now();
for(const costume of ['xu','fu']){
  const data=await readFile(new URL(`../public/assets/3d-stage/vroid/costumes/${costume}.web.vrm`,import.meta.url));
  const json=JSON.parse(data.subarray(20,20+data.readUInt32LE(12)).toString());
  const objects=json.nodes.map(n=>{const o=new THREE.Object3D();o.name=n.name||'';if(n.matrix)new THREE.Matrix4().fromArray(n.matrix).decompose(o.position,o.quaternion,o.scale);else{if(n.translation)o.position.fromArray(n.translation);if(n.rotation)o.quaternion.fromArray(n.rotation);if(n.scale)o.scale.fromArray(n.scale);}return o;});
  json.nodes.forEach((n,i)=>(n.children||[]).forEach(child=>objects[i].add(objects[child])));
  const model=new THREE.Group();(json.scenes[json.scene||0].nodes||[]).forEach(i=>model.add(objects[i]));model.updateMatrixWorld(true);
  const humanBones={};json.extensions.VRM.humanoid.humanBones.forEach(b=>humanBones[mapping[b.bone]||b.bone]={node:objects[b.node]});
  const humanoid=new VRMHumanoid(humanBones);model.add(humanoid.normalizedHumanBonesRoot);model.rotation.y=Math.PI;
  const root=new THREE.Group();root.add(model);root.position.y=1.195;root.updateMatrixWorld(true);
  const vrm={humanoid,update(){humanoid.update();},expressionManager:{setValue(){}}};
  const engine=sandbox.createYueOperaMotion(THREE,{vrm,model,root,baseY:0});
  engine.idle(0,0);model.updateMatrixWorld(true);
  const feet=['leftFoot','rightFoot'].map(n=>humanoid.getNormalizedBoneNode(n));
  const planted=feet.map(n=>n.getWorldPosition(new THREE.Vector3()));
  let maxFootError=0,maxStep=0,maxJoint='';
  for(const name of sandbox.YueOperaPhrases.names){
    const duration=sandbox.YueOperaPhrases.duration(name),origin=root.position.clone();
    let previous=new Map();
    for(let i=0;i<=Math.ceil(duration*30);i++){
      engine.dance(name,i/30,origin,0,1/30);model.updateMatrixWorld(true);
      feet.forEach((n,k)=>{maxFootError=Math.max(maxFootError,n.getWorldPosition(new THREE.Vector3()).distanceTo(planted[k]));});
      for(const [n,b]of Object.entries(humanoid.normalizedHumanBones)){
        const q=b.node.quaternion;assert(q.toArray().every(Number.isFinite));
        if(previous.has(n)){const change=q.angleTo(previous.get(n));if(change>maxStep){maxStep=change;maxJoint=`${name}:${n}:${i}`;}}
        previous.set(n,q.clone());
      }
      assert(root.position.distanceTo(origin)<1e-8,'Dance must not slide the root');
    }
    const a=sandbox.YueOperaPhrases.sample(name,0),b=sandbox.YueOperaPhrases.sample(name,duration-1e-5);
    for(const key of ['left','right','body'])a[key].forEach((v,k)=>assert(Math.abs(v-b[key][k])<1e-4,'Loop must close without snapping'));
  }
  console.log(costume,JSON.stringify({maxFootError,maxJointStep:maxStep,maxJoint}));
  assert(maxFootError<.008,'Feet should stay planted through the phrase');
  assert(maxStep<.2,'Joint changes must stay smooth at 30fps');
}
console.log(`Motion cycles and actual VRM skeletons passed in ${(performance.now()-start).toFixed(0)} ms`);
