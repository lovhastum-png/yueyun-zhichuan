import {build} from 'esbuild';
import * as THREE from 'three';
// Reuse the shipped VRM runtime's Three.js. Bundling another copy would split
// shader chunks and renderer state between the garden and its postprocessing.
await build({entryPoints:['source/3d-stage/garden-rendering-entry.js'],bundle:true,format:'iife',outfile:'public/js/yue-opera-morning-runtime.js',minify:true,target:'es2020',legalComments:'linked',plugins:[{
 name:'existing-three-runtime',setup(builder){
  builder.onResolve({filter:/^three$/},()=>({path:'three',namespace:'stage-three'}));
  builder.onLoad({filter:/.*/,namespace:'stage-three'},()=>({contents:Object.keys(THREE).filter(k=>/^[$A-Z_a-z][$\w]*$/.test(k)).map(k=>`export const ${k}=window.Yueju3D.THREE.${k};`).join('\n'),loader:'js'}));
 }
}]});
console.log('Morning rendering bundled against the existing Three.js runtime.');
