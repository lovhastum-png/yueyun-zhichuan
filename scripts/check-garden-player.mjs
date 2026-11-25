import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFile} from 'node:fs/promises';
import * as THREE from 'three';
class Element extends EventTarget{constructor(){super();this.dataset={};this.value='';this.hidden=false;}setAttribute(){}focus(){}setPointerCapture(){}}
const elements=new Map(),element=id=>{if(!elements.has(id))elements.set(id,new Element());return elements.get(id);};
element('characterOutfit').value='xu';element('characterDance').value='salute';
const noop=()=>{},context2d=new Proxy({createLinearGradient:()=>({addColorStop:noop})},{get:(o,k)=>o[k]||noop});
const document=new EventTarget(),window=new EventTarget();
Object.assign(document,{getElementById:element,querySelectorAll:()=>[],body:{classList:{toggle(){}}},createElement:()=>({width:0,height:0,getContext:()=>context2d})});
const sandbox={window,document,console,AbortController};vm.createContext(sandbox);
for(const f of ['yue-opera-garden.js','yue-opera-character.js'])vm.runInContext(await readFile(new URL('../public/js/'+f,import.meta.url),'utf8'),sandbox);
const scene=new THREE.Scene(),garden=window.createYueOperaGarden(THREE,scene,true);let model;
window.loadYueOperaVrm=async()=>{const root=new THREE.Group();scene.add(root);return model={root,vrm:{scene:root},animateIdle(){},animateWalk(){},animateDance(){}};};
const actor=window.createYueOperaCharacter({THREE,runtime:{VRMUtils:{deepDispose(){}}},scene,heightfield:garden.heightfield,compact:true,onChange(){},onFollow(){},onLeave(){}});
element('enterCharacter').dispatchEvent(new Event('click'));await new Promise(r=>setImmediate(r));assert.deepEqual(actor.position.toArray(),[0,0,23]);
function key(type,value){const e=new Event(type,{cancelable:true});Object.defineProperty(e,'key',{value});window.dispatchEvent(e);}
let time=0;
function walk(value,frames){key('keydown',value);for(let i=0;i<frames;i++){time+=.05;actor.update(.05,time,0);}key('keyup',value);}
walk('w',90);assert.equal(actor.position.y,.398);assert(actor.position.z<12,'Player actually walks up the terrace steps');
walk('w',130);assert(actor.position.z>3.9,'Player stops before entering the pond');
actor.position.set(20,0,4);walk('d',92);assert(actor.position.x>31,'Player actually crosses the stone arch bridge');
actor.position.set(-29,0,-12);walk('d',45);walk('s',38);walk('d',30);walk('s',53);assert(actor.position.z>-.2,'Player can turn all corners of the zigzag bridge');
actor.setFirstPerson(true);element('characterStage').dispatchEvent(new Event('click'));assert.equal(model.root.visible,false);assert.equal(actor.position.y,.398);assert.equal(actor.position.z,8.5);
element('characterCourtyard').dispatchEvent(new Event('click'));assert.deepEqual(actor.position.toArray(),[0,0,23]);actor.dispose();
console.log('Real character controls: garden spawn, terrace steps, pond barrier, arch bridge, zigzag turns, first-person teleport and reset passed.');
