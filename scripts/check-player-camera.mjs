import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFile} from 'node:fs/promises';
import * as THREE from 'three';
const sandbox={window:{}};vm.createContext(sandbox);
vm.runInContext(await readFile(new URL('../public/js/yue-opera-player-camera.js',import.meta.url),'utf8'),sandbox);
const camera=new THREE.PerspectiveCamera(43,1.5,.2,650);
const control=sandbox.window.createYueOperaPlayerCamera(THREE,camera,{sample(x,z){return {blocked:z>12};}});
const player=new THREE.Vector3(0,0,10),direction=new THREE.Vector3(),target=new THREE.Vector3(24,60,-18);
control.update(player);assert(control.boom<2,'Camera shortens its arm before a wall');
control.setMode('first');control.update(player);assert(camera.position.distanceTo(new THREE.Vector3(0,1.78,10))<1e-9);
control.rotate(0,-500);control.update(player);camera.getWorldDirection(direction);
assert(direction.y>.99,'First person can look nearly straight up');
control.rotate(0,1000);control.update(player);camera.getWorldDirection(direction);assert(direction.y<-.96,'Can also look down');
for(const mode of ['first','third']){
 control.setMode(mode);control.lookAt(target,player);control.update(player);camera.getWorldDirection(direction);
 assert(direction.dot(target.clone().sub(camera.position).normalize())>.9999,'Look-up shortcut aims at the flying fish in both views');
 const heading=control.yaw;control.setMode(mode==='first'?'third':'first');control.update(player);assert.equal(control.yaw,heading,'Switching preserves the walking heading');
}
control.setMode('first');control.update(player);const fp=camera.position.clone();control.zoom(10000);control.update(player);assert(camera.position.equals(fp),'First person cannot zoom into an orbit view');
control.setMode('third');control.zoom(10000);assert.equal(control.distance,8);control.zoom(-10000);assert.equal(control.distance,2.6);
control.level();control.update(player);camera.getWorldDirection(direction);assert(Math.abs(direction.y)<.1);
player.y=1.195;control.setMode('first');control.update(player);assert(Math.abs(camera.position.y-2.975)<1e-9,'Eye height follows the stage elevation');
const pondCamera=new THREE.PerspectiveCamera(55,1,.2,650);
const pondControl=sandbox.window.createYueOperaPlayerCamera(THREE,pondCamera,{sample(){return {blocked:true}},cameraBlocked(){return false}});
pondControl.update(new THREE.Vector3(0,0,0));assert(pondControl.boom>5,'Water collision does not collapse the third-person camera boom');
const html=await readFile(new URL('../public/3d-stage.html',import.meta.url),'utf8');
assert.equal((html.match(/data-player-view=/g)||[]).length,2);assert(!html.includes('data-view='),'Production has only two player-view choices');
console.log('First/third person, full look-up/down, fish aiming, camera wall clearance, zoom limits, heading preservation and stage eye height passed.');
