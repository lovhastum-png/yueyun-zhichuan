import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFile} from 'node:fs/promises';
import * as THREE from 'three';
import {VRMHumanoid} from '@pixiv/three-vrm-core';
const context={TextDecoder};vm.createContext(context);
vm.runInContext(await readFile(new URL('../public/js/yue-opera-vmd.js',import.meta.url),'utf8'),context);
const data=await readFile(process.argv[2]||new URL('../source/dance-reference/jimingyue/寄明月/jimingyue-motion.vmd',import.meta.url));
const clip=context.YueOperaVMD.parse(data.buffer.slice(data.byteOffset,data.byteOffset+data.byteLength));
assert(clip.duration>=30);assert.throws(()=>context.YueOperaVMD.parse(new ArrayBuffer(70)));
assert.throws(()=>context.YueOperaVMD.parse(data.buffer.slice(data.byteOffset,data.byteOffset+100)));
const mapping={leftThumbProximal:'leftThumbMetacarpal',leftThumbIntermediate:'leftThumbProximal',rightThumbProximal:'rightThumbMetacarpal',rightThumbIntermediate:'rightThumbProximal'};
for(const costume of ['yuan','fu']){
  const bytes=await readFile(new URL(`../public/assets/3d-stage/vroid/costumes/${costume}.web.vrm`,import.meta.url));
  const json=JSON.parse(bytes.subarray(20,20+bytes.readUInt32LE(12)).toString());
  const objects=json.nodes.map(n=>{const o=new THREE.Object3D();if(n.matrix)new THREE.Matrix4().fromArray(n.matrix).decompose(o.position,o.quaternion,o.scale);else{if(n.translation)o.position.fromArray(n.translation);if(n.rotation)o.quaternion.fromArray(n.rotation);if(n.scale)o.scale.fromArray(n.scale);}return o;});
  json.nodes.forEach((n,i)=>(n.children||[]).forEach(child=>objects[i].add(objects[child])));
  const model=new THREE.Group();json.scenes[json.scene||0].nodes.forEach(i=>model.add(objects[i]));model.updateMatrixWorld(true);
  const humanBones={};json.extensions.VRM.humanoid.humanBones.forEach(b=>humanBones[mapping[b.bone]||b.bone]={node:objects[b.node]});
  const humanoid=new VRMHumanoid(humanBones);model.add(humanoid.normalizedHumanBonesRoot);model.rotation.y=Math.PI;
  const root=new THREE.Group();root.add(model);root.updateMatrixWorld(true);
  const engine=context.createYueOperaVMD(THREE,{vrm:{humanoid,update(){humanoid.update();}},model,root,baseY:0});engine.setClip(clip);
  const bounds=new THREE.Box3(),feet=new THREE.Box3();let changed=0,previous=null;
  for(let i=0;i<=clip.lastFrame;i++){
    engine.play(i/30,new THREE.Vector3(),Math.PI,1/30);model.updateMatrixWorld(true);
    for(const [name,{node}]of Object.entries(humanoid.normalizedHumanBones)){
      assert(node.quaternion.toArray().every(Number.isFinite),name);
      const p=node.getWorldPosition(new THREE.Vector3());assert(p.toArray().every(Number.isFinite),name);bounds.expandByPoint(p);
      if(name.endsWith('Foot'))feet.expandByPoint(p);
    }
    const hand=humanoid.getNormalizedBoneNode('rightHand').getWorldPosition(new THREE.Vector3());if(previous&&previous.distanceTo(hand)>.001)changed++;previous=hand;
  }
  assert(changed>1000,'Must contain sustained motion, not a static pose');
  assert(bounds.getSize(new THREE.Vector3()).length()<12,'Motion must remain within stage scale');
  assert.equal(engine.state.phase,1,'Playback must reach its end without looping');
  console.log(JSON.stringify({costume,duration:clip.duration,boneTracks:clip.tracks.size,changedFrames:changed,bounds:[bounds.min.toArray(),bounds.max.toArray()],feet:[feet.min.toArray(),feet.max.toArray()]}));
}
