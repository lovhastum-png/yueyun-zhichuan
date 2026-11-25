import vm from 'node:vm';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import * as THREE from 'three';
const noop=()=>{},context2d=new Proxy({createLinearGradient:()=>({addColorStop:noop})},{get:(o,k)=>o[k]||noop});
const sandbox={window:{},document:{createElement:()=>({width:0,height:0,getContext:()=>context2d})}};
vm.createContext(sandbox);vm.runInContext(await readFile(new URL('../public/js/yue-opera-garden.js',import.meta.url),'utf8'),sandbox);
for(const compact of [false,true]){
 const scene=new THREE.Scene(),garden=sandbox.window.createYueOperaGarden(THREE,scene,compact);scene.updateMatrixWorld(true);
 assert.equal(garden.stats.bridges,2);assert.equal(garden.stats.waterfalls,3);assert(garden.stats.bamboo>60);
 assert(garden.stats.drawCalls<100);assert(garden.stats.triangles<350000);
 garden.root.traverse(o=>{if(!o.geometry)return;for(const attr of Object.values(o.geometry.attributes))for(const n of attr.array)assert(Number.isFinite(n));if(o.isInstancedMesh){const m=new THREE.Matrix4();for(let i=0;i<o.count;i++){o.getMatrixAt(i,m);assert(m.elements.every(Number.isFinite));}}});
 const hit=(x,z,y=0)=>garden.heightfield.sample(x,z,y,.55);
 assert(!hit(0,23).blocked);assert(hit(0,-8).blocked&&hit(0,-8).water,'Pond cannot be walked into');
 let feet=0;for(let z=23;z>8.4;z-=.03){const h=hit(0,z,feet);assert(!h.blocked,`Terrace path blocked at ${z}`);feet=h.ground;}assert.equal(feet,.398);
 feet=0;for(let x=20;x<32;x+=.025){const h=hit(x,4,feet);assert(!h.blocked,`Arched bridge blocked at ${x}`);assert(h.ground-feet<.55);feet=h.ground;}
 assert(hit(27,4,1.25).bridge);assert(hit(27,0).blocked,'Water alongside the bridge stays blocked');
 const zig=[[-29,-12],[-23,-12],[-23,-7],[-19,-7],[-19,0]];feet=0;
 for(let i=1;i<zig.length;i++)for(let k=0;k<=100;k++){const a=zig[i-1],b=zig[i],t=k/100,h=hit(a[0]+(b[0]-a[0])*t,a[1]+(b[1]-a[1])*t,feet);assert(!h.blocked,'Zigzag bridge is continuously walkable');feet=h.ground;}
 assert(!garden.heightfield.cameraBlocked(0,2,-8),'Camera can pass above pond water');
 assert(garden.heightfield.cameraBlocked(-30,2,13),'Camera still avoids study walls');
 assert(!hit(0,30).blocked,'Moon gate has a ground-level opening');
 assert(hit(6,30).blocked,'South enclosure walls are solid');
 assert(hit(-24.05,-9,.35).blocked,'Zigzag side rail blocks stepping sideways');
 assert(garden.heightfield.cameraBlocked(-24.05,.8,-9),'Low camera avoids the bridge rail');
 assert(!garden.heightfield.cameraBlocked(-24.05,2,-9),'Camera can look above the bridge rail');
 assert(garden.materials.pebble.map.anisotropy>=2);
 const groundRay=new THREE.Raycaster(new THREE.Vector3(5,2,23),new THREE.Vector3(0,-1,0));
 const pavement=groundRay.intersectObject(garden.root,true).find(h=>h.object.material===garden.materials.pebble);
 assert(pavement&&pavement.face.normal.y>.99,'Courtyard paving normals face upward, avoiding self-shadow acne');
 assert(hit(-30,13).blocked,'Study walls remain solid');assert(hit(-26,-24).blocked,'Rockery remains solid');assert(hit(40,0).blocked);
 const ray=new THREE.Raycaster(new THREE.Vector3(0,10,-8),new THREE.Vector3(0,-1,0));
 const intersections=ray.intersectObject(garden.root,true).filter(h=>h.object.isMesh);
 assert.equal(intersections[0]?.object.material.name,'Jade water','Water is visible through a real opening in the ground');
 const spray=garden.root.getObjectByName('叠瀑水雾'),before=spray.geometry.attributes.position.array.slice();garden.update(3);assert.notDeepEqual(spray.geometry.attributes.position.array,before);
 console.log(compact?'Mobile':'Desktop',JSON.stringify(garden.stats),'finite geometry, visible water, pond safety, both bridges, terrace route and animated spray passed');
}
