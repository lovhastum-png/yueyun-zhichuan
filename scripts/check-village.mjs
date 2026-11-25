import vm from 'node:vm';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
const runtime=await readFile(new URL('../public/js/3d-stage-runtime.js',import.meta.url),'utf8');
const villageSource=await readFile(new URL('../public/js/yue-opera-village.js',import.meta.url),'utf8');
const noop=()=>{};
const context2d=new Proxy({createLinearGradient:()=>({addColorStop:noop})},{get:(obj,key)=>obj[key]||noop});
const document={createElement:()=>({width:0,height:0,getContext:()=>context2d})};
const sandbox={console,TextDecoder,TextEncoder,URL,Blob,performance,setTimeout,clearTimeout,WebAssembly,AbortController,document};
vm.createContext(sandbox);
try {vm.runInContext(runtime,sandbox);vm.runInContext(villageSource,sandbox);}catch(error){console.error(error.message);process.exit(1);}
const {THREE}=sandbox.Yueju3D;
for(const mobile of [false,true]){
  const village=sandbox.createYueOperaVillage(THREE,new THREE.Scene(),mobile);
  assert.equal(village.stats.buildings,23);
  assert(village.stats.drawCalls<100);
  assert(village.stats.triangles<200000);
  village.root.traverse(o=>{
    if(!o.isMesh)return;
    for(const attribute of Object.values(o.geometry.attributes))for(const n of attribute.array)assert(Number.isFinite(n),'Non-finite geometry');
    const matrix=new THREE.Matrix4();for(let i=0;i<o.count;i++){o.getMatrixAt(i,matrix);assert(matrix.elements.every(Number.isFinite));}
  });
  const sample=(x,z,y=0)=>village.heightfield.sample(x,z,y,.55);
  assert(!sample(0,8).blocked,'Audience spawn is clear');
  assert(!sample(0,0,1.195).blocked,'Centre of performance floor is clear');
  assert.equal(sample(0,0,1.195).ground,1.195);
  assert(sample(7,0).blocked,'Cannot jump onto side of stage');
  let feet=0;
  for(let z=7;z>=-.1;z-=.01){const hit=sample(0,z,feet);assert(!hit.blocked,`Stair path blocked at ${z}`);assert(hit.ground-feet<=.55);if(z<4.6&&z>2)assert(hit.ground>0,'No gaps between the stairs and stage');feet=hit.ground;}
  assert.equal(feet,1.195,'Actor reached stage');
  assert(sample(-21,-3).blocked,'House is solid');
  assert(sample(26,0).blocked,'Canal cannot be walked into');
  assert(!sample(26,6.4).blocked,'Canal bridge is walkable');
  assert(sample(41,0).blocked,'Site boundary blocks walking');
  console.log(mobile?'Mobile':'Desktop',JSON.stringify(village.stats),'geometry and walking checks passed');
}
const preview=await readFile(new URL('../public/village-preview.html',import.meta.url),'utf8');
const inline=[...preview.matchAll(/<script>([\s\S]*?)<\/script>/g)];inline.forEach(s=>new vm.Script(s[1]));
console.log('Preview inline script syntax passed');
