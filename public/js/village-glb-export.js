/* Portable GLB 2.0 export with embedded canvas textures and shared instanced meshes. */
window.exportVillageGLB = function (THREE, root) {
  const doc={asset:{version:'2.0',generator:'Yueyun original architecture 2026-10'},scene:0,scenes:[{name:root.name,extras:root.userData,nodes:[]}],nodes:[],meshes:[],materials:[],accessors:[],bufferViews:[],buffers:[{byteLength:0}],images:[],textures:[],samplers:[]};
  const parts=[];let offset=0;
  const geometries=new Map(),materials=new Map(),textures=new Map(),meshCache=new Map();
  function bufferView(bytes,target) {
    const aligned=new Uint8Array(Math.ceil(bytes.byteLength/4)*4);aligned.set(bytes);parts.push(aligned);
    const index=doc.bufferViews.length;doc.bufferViews.push({buffer:0,byteOffset:offset,byteLength:bytes.byteLength,...(target?{target}:{})});offset+=aligned.length;return index;
  }
  function accessor(attr,semantic) {
    let a=attr.array;
    // CanvasTexture uses flipY=true in Three; glTF textures use flipY=false.
    if(semantic==='TEXCOORD_0'){a=new Float32Array(a);for(let i=1;i<a.length;i+=2)a[i]=1-a[i];}
    const componentType=a instanceof Float32Array?5126:a instanceof Uint32Array?5125:a instanceof Uint16Array?5123:5121;
    const info={bufferView:bufferView(new Uint8Array(a.buffer,a.byteOffset,a.byteLength),semantic==='INDEX'?34963:34962),componentType,count:attr.count,type:({1:'SCALAR',2:'VEC2',3:'VEC3',4:'VEC4'})[attr.itemSize]};
    if(semantic==='POSITION') {
      info.min=[Infinity,Infinity,Infinity];info.max=[-Infinity,-Infinity,-Infinity];
      for(let i=0;i<a.length;i++) {const k=i%3;info.min[k]=Math.min(info.min[k],a[i]);info.max[k]=Math.max(info.max[k],a[i]);}
    }
    const index=doc.accessors.length;doc.accessors.push(info);return index;
  }
  function texture(tex) {
    if(textures.has(tex.uuid))return textures.get(tex.uuid);
    const data=atob(tex.image.toDataURL('image/png').split(',')[1]),bytes=Uint8Array.from(data,ch=>ch.charCodeAt(0));
    const view=bufferView(bytes),image=doc.images.length;doc.images.push({bufferView:view,mimeType:'image/png'});
    const sampler=doc.samplers.length;doc.samplers.push({magFilter:9729,minFilter:9987,wrapS:tex.wrapS===THREE.RepeatWrapping?10497:33071,wrapT:tex.wrapT===THREE.RepeatWrapping?10497:33071});
    const index=doc.textures.length;doc.textures.push({source:image,sampler});textures.set(tex.uuid,index);return index;
  }
  function material(m) {
    if(materials.has(m.uuid))return materials.get(m.uuid);
    const pbr={baseColorFactor:[m.color.r,m.color.g,m.color.b,m.opacity],metallicFactor:m.metalness||0,roughnessFactor:m.roughness??1};
    if(m.map){
      pbr.baseColorTexture={index:texture(m.map)};
      if(m.map.repeat.x!==1||m.map.repeat.y!==1){
        pbr.baseColorTexture.extensions={KHR_texture_transform:{scale:[m.map.repeat.x,m.map.repeat.y]}};
        doc.extensionsUsed=['KHR_texture_transform'];
      }
    }
    const data={name:m.name,pbrMetallicRoughness:pbr,doubleSided:m.side===THREE.DoubleSide};
    if(m.emissive) {data.emissiveFactor=m.emissive.toArray().map(v=>Math.min(1,v*(m.emissiveIntensity||0)));}
    if(m.transparent)data.alphaMode='BLEND';
    const index=doc.materials.length;doc.materials.push(data);materials.set(m.uuid,index);return index;
  }
  root.updateMatrixWorld(true);
  root.traverse(o=>{
    if(!o.isMesh||!o.visible)return;
    const g=o.geometry,m=o.material,key=g.uuid+'/'+m.uuid;
    let meshIndex=meshCache.get(key);
    if(meshIndex===undefined){
      let attributes=geometries.get(g.uuid);
      if(!attributes){attributes={};for(const [key,semantic] of [['position','POSITION'],['normal','NORMAL'],['uv','TEXCOORD_0'],['color','COLOR_0']])if(g.attributes[key])attributes[semantic]=accessor(g.attributes[key],semantic);geometries.set(g.uuid,attributes);}
      const primitive={attributes,material:material(m)};if(g.index)primitive.indices=accessor(g.index,'INDEX');
      meshIndex=doc.meshes.length;doc.meshes.push({name:o.name,primitives:[primitive]});meshCache.set(key,meshIndex);
    }
    const local=new THREE.Matrix4(),world=new THREE.Matrix4();
    const count=o.isInstancedMesh?o.count:1;
    for(let i=0;i<count;i++){
      if(o.isInstancedMesh){o.getMatrixAt(i,local);world.multiplyMatrices(o.matrixWorld,local);}else world.copy(o.matrixWorld);
      doc.scenes[0].nodes.push(doc.nodes.length);doc.nodes.push({name:o.userData.instanceNames?.[i]||o.name,mesh:meshIndex,matrix:world.toArray()});
    }
  });
  doc.buffers[0].byteLength=offset;
  const json=new TextEncoder().encode(JSON.stringify(doc)),jsonLength=Math.ceil(json.length/4)*4;
  const result=new ArrayBuffer(12+8+jsonLength+8+offset),view=new DataView(result),bytes=new Uint8Array(result);
  view.setUint32(0,0x46546c67,true);view.setUint32(4,2,true);view.setUint32(8,result.byteLength,true);
  view.setUint32(12,jsonLength,true);view.setUint32(16,0x4e4f534a,true);bytes.fill(32,20,20+jsonLength);bytes.set(json,20);
  view.setUint32(20+jsonLength,offset,true);view.setUint32(24+jsonLength,0x004e4942,true);
  let cursor=28+jsonLength;for(const part of parts){bytes.set(part,cursor);cursor+=part.length;}
  return result;
};
