import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFile } from 'node:fs/promises';
import * as THREE from 'three';

class Element extends EventTarget {
  constructor() { super(); this.dataset={}; this.value=''; this.hidden=false; this.classList={toggle(){}}; }
  setAttribute() {} focus() {} setPointerCapture() {}
}
const elements=new Map();
const element=id=>{if(!elements.has(id))elements.set(id,new Element());return elements.get(id);};
element('characterOutfit').value='xu';element('characterDance').value='salute';
const noop=()=>{};
const context2d=new Proxy({createLinearGradient:()=>({addColorStop:noop})},{get:(o,k)=>o[k]||noop});
const document=new EventTarget();
Object.assign(document,{getElementById:element,querySelectorAll:()=>[],body:{classList:{toggle(){}}},createElement:()=>({width:0,height:0,getContext:()=>context2d})});
const window=new EventTarget();
const context=vm.createContext({window,document,console,AbortController});
vm.runInContext(await readFile(new URL('../public/js/yue-opera-village.js',import.meta.url),'utf8'),context);
vm.runInContext(await readFile(new URL('../public/js/yue-opera-character.js',import.meta.url),'utf8'),context);
const scene=new THREE.Scene();
const village=window.createYueOperaVillage(THREE,scene,true);
let avatar;
let lastDanceTime=0;
window.loadYueOperaVrm=async()=>{
  const root=new THREE.Group();scene.add(root);
  avatar={root,vrm:{scene:root},animateIdle(){},animateWalk(){},animateDance(name,time){lastDanceTime=time;},getMotionState(){return {phase:lastDanceTime/12,duration:12,name:'测试身段',label:'亮相'};}};return avatar;
};
const actor=window.createYueOperaCharacter({THREE,runtime:{VRMUtils:{deepDispose(){}}},scene,heightfield:village.heightfield,compact:false,onChange(){},onFollow(){},onLeave(){}});
element('enterCharacter').dispatchEvent(new Event('click'));
await new Promise(resolve=>setImmediate(resolve));
assert(actor.active,'Actor entered the courtyard');
actor.setFirstPerson(true);assert.equal(avatar.root.visible,false,'First person hides the avatar to prevent face and hair clipping');
actor.setFirstPerson(false);assert.equal(avatar.root.visible,true,'Third person restores the avatar');
function key(type,value){const e=new Event(type,{cancelable:true});Object.defineProperty(e,'key',{value});window.dispatchEvent(e);}
key('keydown','w');
for(let frame=0;frame<70;frame++)actor.update(.05,frame*.05,0);
key('keyup','w');
console.log('After walking up the stairs:',actor.position.toArray());
assert(Math.abs(actor.position.y-1.195)<.001,'Feet must reach the stage floor');
assert(actor.position.z<2.15,'Actor must pass the top of the stairs');
// Continued walking must stop at the backstage table or wall.
key('keydown','w');for(let i=0;i<160;i++)actor.update(.05,4+i*.05,0);key('keyup','w');
assert(actor.position.z>-5.15,'Actor cannot walk through backstage props');
// Blur releases held keys, preventing movement after switching browser tabs.
key('keydown','s');window.dispatchEvent(new Event('blur'));const before=actor.position.clone();actor.update(.05,13,0);assert(actor.position.equals(before));
// The stage shortcut, pause and courtyard reset preserve legal foot positions.
element('characterStage').dispatchEvent(new Event('click'));assert.equal(actor.position.y,1.195);
element('characterPerform').dispatchEvent(new Event('click'));actor.update(.05,13.1,0);
element('characterPause').dispatchEvent(new Event('click'));const frozen=lastDanceTime;actor.update(.05,13.2,0);assert.equal(lastDanceTime,frozen,'Pause freezes the motion clock');
element('characterTimeline').value='50';element('characterTimeline').dispatchEvent(new Event('input'));assert.equal(lastDanceTime,6,'Seeking shows the selected frame');
element('characterPause').dispatchEvent(new Event('click'));actor.update(.05,13.3,0);assert(lastDanceTime>6,'Resume continues from the selected frame');
key('keydown','w');actor.update(.05,13.4,0);key('keyup','w');assert(element('characterPause').disabled,'Walking stops the performance');
element('characterCourtyard').dispatchEvent(new Event('click'));assert.equal(actor.position.y,0);assert.equal(actor.position.z,10);
actor.pause();assert(!actor.active);actor.dispose();
console.log('Actor entry, stair traversal, collisions, input release, pause, seeking and reset passed.');
