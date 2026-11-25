import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFile} from 'node:fs/promises';
import * as THREE from 'three';
import {GLTFLoader} from 'three/addons/loaders/GLTFLoader.js';
const bytes=await readFile(new URL('../public/assets/3d-stage/sky-koi/yueyun-sky-koi.glb',import.meta.url));
assert.equal(bytes.readUInt32LE(0),0x46546c67);assert.equal(bytes.readUInt32LE(8),bytes.length);
const doc=JSON.parse(bytes.subarray(20,20+bytes.readUInt32LE(12)).toString());
assert(doc.asset.extras.author.startsWith('7PLUS'));assert(doc.asset.extras.license.startsWith('CC-BY-4.0'));
assert.equal(doc.meshes[0].primitives[0].targets.length,150);assert.equal(doc.images.length,2);assert.equal(doc.animations[0].name,'MorphBake');
assert(doc.buffers.every(b=>!b.uri),'Production GLB embeds all buffers');
// Keep the real geometry, morph targets and animation. Only omit image decoding
// in Node; the web deliberately replaces the original photographic materials.
const cpuDoc=structuredClone(doc),bin=bytes.subarray(28+bytes.readUInt32LE(12));
cpuDoc.buffers[0].uri=`data:application/octet-stream;base64,${bin.toString('base64')}`;
cpuDoc.images=[];cpuDoc.textures=[];cpuDoc.samplers=[];
cpuDoc.materials=cpuDoc.materials.map(m=>({name:m.name,pbrMetallicRoughness:{baseColorFactor:[1,1,1,1],metallicFactor:0,roughnessFactor:.4}}));
globalThis.ProgressEvent??=class{constructor(type,options){this.type=type;Object.assign(this,options);}};
const sandbox={TextEncoder,TextDecoder,window:{Yueju3D:{GLTFLoader:class{loadAsync(){return new GLTFLoader().parseAsync(JSON.stringify(cpuDoc),'');}}}}};
vm.createContext(sandbox);vm.runInContext(await readFile(new URL('../public/js/yue-opera-public-koi.js',import.meta.url),'utf8'),sandbox);
for(const compact of [false,true]){
  const scene=new THREE.Scene(),koi=sandbox.window.createYueOperaSkyKoi(THREE,scene,compact);await koi.ready;
  assert.equal(koi.stats.original,false);assert.equal(koi.stats.morphTargets,150);assert.equal(koi.stats.swimSeconds,6.25);
  assert.equal(koi.stats.meshes,1);assert.equal(koi.stats.triangles,522);
  const mesh=koi.asset.scene.getObjectByName('mesh_0'),vertex=new THREE.Vector3();
  assert.equal(mesh.material.map,null);assert.equal(mesh.material.normalMap,null);assert(mesh.material.roughness>.9);
  const outline=koi.asset.scene.getObjectByName('mesh_0_softOutline');
  assert.equal(mesh.castShadow,true,'Animated source mesh casts the fish shadow');
  assert.equal(outline.castShadow,false,'Outline does not add an inflated shadow');
  assert.equal(outline.morphTargetInfluences,mesh.morphTargetInfluences,'Outline follows exactly the same authored animation');
  assert.equal(koi.stats.style,'ink');
  const inkColours=mesh.geometry.attributes.color.array.slice();koi.setStyle('white');
  const whiteColours=mesh.geometry.attributes.color.array.slice();koi.setStyle('pastel');
  assert.notDeepEqual(mesh.geometry.attributes.color.array,whiteColours);koi.setStyle('white');
  assert.deepEqual(mesh.geometry.attributes.color.array,whiteColours,'Style changes leave animation and vertex identity intact');
  koi.setStyle('ink');assert.deepEqual(mesh.geometry.attributes.color.array,inkColours);
  assert(Math.max(...inkColours)-Math.min(...inkColours)>.6,'Ink palette has deep washes and paper-white areas');
  for(const style of ['ink','white','pastel']){
    koi.setStyle(style);const exported=Buffer.from(koi.exportStyledGLB(bytes.buffer.slice(bytes.byteOffset,bytes.byteOffset+bytes.byteLength)));
    assert.equal(exported.readUInt32LE(8),exported.length);const jsonLength=exported.readUInt32LE(12);
    const exportedDoc=JSON.parse(exported.subarray(20,20+jsonLength).toString());
    assert.deepEqual(exportedDoc.animations,doc.animations,'Styled GLB retains author animation tracks');
    assert.equal(exportedDoc.materials[0].normalTexture,undefined);assert.equal(exportedDoc.materials[0].pbrMetallicRoughness.baseColorTexture,undefined);
    assert.equal(exportedDoc.asset.extras.renderStyle,style);assert(exportedDoc.asset.extras.author.startsWith('7PLUS'));
    assert(exported.subarray(28+jsonLength,28+jsonLength+bin.length).equals(bin),'Original morph and animation binary remains byte-exact');
  }
  koi.setStyle('white');
  function pose(){const p=[];for(let i=0;i<mesh.geometry.attributes.position.count;i++){mesh.getVertexPosition(i,vertex);p.push(...vertex.toArray());}return p;}
  function maxDistance(a,b){let max=0;for(let i=0;i<a.length;i+=3)max=Math.max(max,Math.hypot(a[i]-b[i],a[i+1]-b[i+1],a[i+2]-b[i+2]));return max;}
  const first=pose(),weights=mesh.morphTargetInfluences.slice(),start=koi.position.clone();
  for(let i=0;i<10;i++)koi.update(.1);
  assert(koi.position.distanceTo(start)>1,'Orbit advances');
  const swim=maxDistance(first,pose());assert(swim>.1,'Original authored animation deforms the fish');
  assert.notDeepEqual(mesh.morphTargetInfluences,weights,'AnimationMixer drives the original morph track');
  koi.setPaused(true);const frozenPose=pose(),frozenPosition=koi.position.clone(),frozenTime=koi.mixer.time;
  koi.update(.1);assert.deepEqual(pose(),frozenPose);assert(koi.position.equals(frozenPosition));assert.equal(koi.mixer.time,frozenTime);
  koi.setPaused(false);koi.update(.1);assert(koi.mixer.time>frozenTime);
  const duration=koi.stats.orbitSeconds;
  assert(koi.sampleFlight(0).position.distanceTo(koi.sampleFlight(duration).position)<1e-8);
  const sun=new THREE.DirectionalLight();sun.position.set(-75,128,35);Object.assign(sun.shadow.camera,{left:-110,right:110,top:110,bottom:-110,near:1,far:421});sun.shadow.camera.updateProjectionMatrix();sun.updateMatrixWorld(true);sun.target.updateMatrixWorld(true);sun.shadow.updateMatrices(sun);
  const shadowPoint=new THREE.Vector3();let shadowClipped=0;
  let lowest=Infinity,maxHeight=-Infinity,minHeight=Infinity,maxBank=0,fullRoll=false;
  const quaternion=new THREE.Quaternion(),previousQuaternion=new THREE.Quaternion();let maxRotationStep=0;
  const heading=new THREE.Vector3(1,0,0),velocity=new THREE.Vector3();
  for(let i=0;i<=1360;i++){
    const t=i*duration/1360; koi.mixer.setTime(t*.85);const path=koi.sampleFlight(t);
    koi.root.position.copy(path.position);koi.root.rotation.set(0,path.yaw,0);koi.model.rotation.set(path.bank+path.roll,0,path.pitch,'ZYX');koi.root.updateMatrixWorld(true);
    koi.model.getWorldQuaternion(quaternion);
    if(i)maxRotationStep=Math.max(maxRotationStep,quaternion.angleTo(previousQuaternion));previousQuaternion.copy(quaternion);
    velocity.copy(koi.sampleFlight(t+.01).position).sub(koi.sampleFlight(t-.01).position).normalize();
    assert(heading.set(1,0,0).applyQuaternion(quaternion).dot(velocity)>.999,'Fish faces its movement even during a roll');
    maxHeight=Math.max(maxHeight,path.position.y);minHeight=Math.min(minHeight,path.position.y);maxBank=Math.max(maxBank,Math.abs(path.bank));fullRoll ||= path.roll>Math.PI*1.95;
    for(let v=0;v<mesh.geometry.attributes.position.count;v++){
      mesh.getVertexPosition(v,vertex);assert(vertex.toArray().every(Number.isFinite));vertex.applyMatrix4(mesh.matrixWorld);lowest=Math.min(lowest,vertex.y);shadowPoint.copy(vertex).applyMatrix4(sun.shadow.matrix);if(shadowPoint.x<0||shadowPoint.x>1||shadowPoint.y<0||shadowPoint.y>1||shadowPoint.z<0||shadowPoint.z>1)shadowClipped++;
    }
  }
  assert.equal(shadowClipped,0,'Entire animated fish stays inside the sun shadow volume throughout the route');
  assert(lowest>12,'Animated fins clear roofs throughout the route');
  assert(maxHeight-minHeight>30);assert(maxBank>.3);assert(fullRoll);assert(maxRotationStep<.25,'All route and roll transitions remain continuous');
  // Manual roll is continuous, lifts into clear air, respects pause and cannot
  // be restarted midway. It returns to the route without a position jump.
  const manualScene=new THREE.Scene(),manualKoi=sandbox.window.createYueOperaSkyKoi(THREE,manualScene,true);await manualKoi.ready;
  assert(manualKoi.requestRoll());assert(!manualKoi.requestRoll());
  let manualLowest=Infinity,manualMaxStep=0;const previous=new THREE.Quaternion();manualKoi.model.getWorldQuaternion(previous);
  const manualMesh=manualKoi.asset.scene.getObjectByName('mesh_0');
  for(let i=0;i<180;i++){
    manualKoi.update(.05);manualKoi.model.getWorldQuaternion(quaternion);manualMaxStep=Math.max(manualMaxStep,previous.angleTo(quaternion));previous.copy(quaternion);
    for(let v=0;v<manualMesh.geometry.attributes.position.count;v++){
      manualMesh.getVertexPosition(v,vertex);vertex.applyMatrix4(manualMesh.matrixWorld);manualLowest=Math.min(manualLowest,vertex.y);
    }
    if(i===50){manualKoi.setPaused(true);const rotation=manualKoi.model.quaternion.clone();manualKoi.update(.1);assert(manualKoi.model.quaternion.equals(rotation));manualKoi.setPaused(false);}
  }
  assert(manualLowest>12);assert(manualMaxStep<.16);manualKoi.dispose();
  koi.mixer.setTime(0);const loopStart=pose();koi.mixer.setTime(6.2499);const seam=maxDistance(loopStart,pose());assert(seam<.4,'Original swim loop has no large pose jump');
  koi.setNight(true);assert(mesh.material.emissiveIntensity>0);koi.setNight(false);assert.equal(mesh.material.emissiveIntensity,0);
  koi.dispose();assert.equal(scene.children.length,0);
  console.log(compact?'Mobile':'Desktop',JSON.stringify({triangles:koi.stats.triangles,morphTargets:koi.stats.morphTargets,bodyDeformation:swim,loopSeam:seam,lowestVertex:lowest,heightRange:maxHeight-minHeight,maxRotationStep,manualLowest,manualMaxStep}),'ink styles, native swim, flight tangents, automatic/manual rolls, pause, roof clearance and disposal passed');
}
