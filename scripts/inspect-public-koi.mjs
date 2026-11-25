import {readFile} from 'node:fs/promises';
const b=await readFile(new URL('../public/assets/3d-stage/sky-koi/yueyun-sky-koi.glb',import.meta.url));
const g=JSON.parse(b.subarray(20,20+b.readUInt32LE(12)).toString());
const bin=b.subarray(28+b.readUInt32LE(12));
function attribute(index){const a=g.accessors[index],v=g.bufferViews[a.bufferView];return new Float32Array(bin.buffer,bin.byteOffset+(v.byteOffset||0)+(a.byteOffset||0),a.count*({SCALAR:1,VEC2:2,VEC3:3,VEC4:4}[a.type]));}
const primitive=g.meshes[0].primitives[0],p=attribute(primitive.attributes.POSITION);
const head=[],shoulder=[];for(let i=0;i<p.length/3;i++){if(p[i*3]<-2.2)head.push(i);if(p[i*3]>-1.6&&p[i*3]<-.6)shoulder.push(i);}
function centroid(list,delta){const out=[0,0,0];for(const i of list)for(let k=0;k<3;k++)out[k]+=p[i*3+k]+(delta?.[i*3+k]||0);return out.map(v=>v/list.length);}
console.log('Base head / shoulder',centroid(head),centroid(shoulder));
for(const i of [0,15,30,45,60,75,90,105,120,135,149]){
 const d=attribute(primitive.targets[i].POSITION),h=centroid(head,d),s=centroid(shoulder,d);
 const min=[Infinity,Infinity,Infinity],max=[-Infinity,-Infinity,-Infinity];for(let v=0;v<p.length;v++){min[v%3]=Math.min(min[v%3],p[v]+d[v]);max[v%3]=Math.max(max[v%3],p[v]+d[v]);}
 console.log(i,{head:h.map(v=>+v.toFixed(3)),direction:[h[0]-s[0],h[1]-s[1],h[2]-s[2]].map(v=>+v.toFixed(3)),size:max.map((v,k)=>+(v-min[k]).toFixed(3))});
}
