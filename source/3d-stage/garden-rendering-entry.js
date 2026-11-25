import * as THREE from 'three';
import {Reflector} from 'three/addons/objects/Reflector.js';
import {EffectComposer} from 'three/addons/postprocessing/EffectComposer.js';
import {OutputPass} from 'three/addons/postprocessing/OutputPass.js';
import {SMAAPass} from 'three/addons/postprocessing/SMAAPass.js';
import {N8AOPass} from 'n8ao';

// PCSS blocker search and Poisson filtering adapted for a directional light's
// orthographic shadow volume from Three.js r180 / spidersharma03 (MIT).
function installSoftSun(){
 if(THREE.ShaderChunk.shadowmap_pars_fragment.includes('yueSoftShadow'))return;
 const code=`
float yueSoftShadow(sampler2D sm,vec4 sc,vec2 mapSize){
 float sumDepth=0.0,count=0.0;
 float angle=rand(floor(sc.xy*mapSize))*6.2831853;
 for(int i=0;i<12;i++){
   float a=angle+float(i)*2.3999632,r=sqrt((float(i)+.5)/12.0);
   float d=unpackRGBAToDepth(textureLod(sm,sc.xy+vec2(cos(a),sin(a))*r*.015,0.0));
   if(d<sc.z){sumDepth+=d;count+=1.0;}
 }
 if(count<.5)return 1.0;
 float separation=max(0.0,(sc.z-sumDepth/count)*420.0);
 float radius=clamp(separation*.023/220.0,1.2/mapSize.x,.018);
 float visibility=0.0;
 for(int i=0;i<12;i++){
   float a=angle+float(i)*2.3999632,r=sqrt((float(i)+.5)/12.0);
   vec2 p=vec2(cos(a),sin(a))*r*radius;
   visibility+=step(sc.z,unpackRGBAToDepth(textureLod(sm,sc.xy+p,0.0)));
   visibility+=step(sc.z,unpackRGBAToDepth(textureLod(sm,sc.xy-p.yx,0.0)));
 }
 return visibility/24.0;
}
`;
 THREE.ShaderChunk.shadowmap_pars_fragment=THREE.ShaderChunk.shadowmap_pars_fragment
  .replace('#ifdef USE_SHADOWMAP','#ifdef USE_SHADOWMAP\n'+code)
  .replace(/#if defined\( SHADOWMAP_TYPE_PCF \)[\s\S]*?#elif defined\( SHADOWMAP_TYPE_PCF_SOFT \)/,'#if defined( SHADOWMAP_TYPE_PCF )\nshadow=yueSoftShadow(shadowMap,shadowCoord,shadowMapSize);\n#elif defined( SHADOWMAP_TYPE_PCF_SOFT )');
}

window.createYueOperaMorningRendering=function({renderer,scene,camera,garden,skyKoi,compact=false}){
 if(!compact)installSoftSun();
 const density={value:.0065},tint={value:new THREE.Color('#dce4d8')};
 let night=false,frame=0,elapsed=0,disposed=false;
 const fogMaterials=new Set();
 function attachMist(material){
  if(!material||fogMaterials.has(material)||!material.fog||material.isShaderMaterial)return;
  fogMaterials.add(material);const previous=material.onBeforeCompile,oldKey=material.customProgramCacheKey?.bind(material);
  material.onBeforeCompile=function(shader,...args){
   previous.call(this,shader,...args);shader.uniforms.uMorningDensity=density;shader.uniforms.uMorningTint=tint;
   shader.vertexShader='varying vec3 vMorningWorld;\n'+shader.vertexShader;
   shader.vertexShader=shader.vertexShader.replace('#include <worldpos_vertex>',`#include <worldpos_vertex>
vec4 morningP=vec4(transformed,1.0);
#ifdef USE_INSTANCING
morningP=instanceMatrix*morningP;
#endif
vMorningWorld=(modelMatrix*morningP).xyz;`);
   shader.fragmentShader='uniform float uMorningDensity; uniform vec3 uMorningTint; varying vec3 vMorningWorld;\n'+shader.fragmentShader;
   shader.fragmentShader=shader.fragmentShader.replace('#include <fog_fragment>',`
float morningDistance=length(cameraPosition-vMorningWorld);
float morningDelta=(vMorningWorld.y-cameraPosition.y)*.11;
float morningIntegral=abs(morningDelta)<.01?exp(-max(0.0,cameraPosition.y)*.11):
 (exp(-max(0.0,cameraPosition.y)*.11)-exp(-max(0.0,vMorningWorld.y)*.11))/morningDelta;
float morningFog=1.0-exp(-max(0.0,morningDistance-6.0)*uMorningDensity*max(0.0,morningIntegral));
gl_FragColor.rgb=mix(gl_FragColor.rgb,uMorningTint,clamp(morningFog,0.0,.72));`);
  };
  material.customProgramCacheKey=()=> (oldKey?oldKey():'')+'-height-mist-v1';material.needsUpdate=true;
 }
 scene.traverse(o=>{if(o.material)for(const m of Array.isArray(o.material)?o.material:[o.material])attachMist(m);});
 skyKoi.ready.then(asset=>{if(!disposed&&asset)asset.scene.traverse(o=>{if(o.material)attachMist(o.material);});}).catch(()=>{});
 // A soft sky gives both the water reflection and the scene a coherent horizon.
 const skyMaterial=new THREE.ShaderMaterial({side:THREE.BackSide,depthWrite:false,uniforms:{uNight:{value:0},uSun:{value:new THREE.Vector3(-75,128,35).normalize()}},vertexShader:'varying vec3 vSky; void main(){vSky=position;gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.0);}',fragmentShader:`
uniform float uNight;uniform vec3 uSun;varying vec3 vSky;
void main(){vec3 d=normalize(vSky);float h=pow(max(d.y,0.0),.55);
vec3 day=mix(vec3(.73,.80,.71),vec3(.38,.58,.67),h);
day+=vec3(.28,.20,.10)*pow(max(dot(d,uSun),0.0),48.0);
gl_FragColor=vec4(mix(day,mix(vec3(.035,.065,.085),vec3(.008,.022,.045),h),uNight),1.0);
#include <tonemapping_fragment>
#include <colorspace_fragment>
}`});
 const sky=new THREE.Mesh(new THREE.SphereGeometry(440,24,12),skyMaterial);sky.name='清晨天空';sky.frustumCulled=false;scene.add(sky);
 // Reflector is used only to capture the mirrored scene; the visible pond
 // stays a lit StandardMaterial so it can receive the swimming fish's shadow.
 const reflector=new Reflector(new THREE.PlaneGeometry(1,1),{textureWidth:compact?384:768,textureHeight:compact?384:768,multisample:0,clipBias:.003});
 reflector.rotation.x=-Math.PI/2;reflector.position.y=-.012;reflector.updateMatrixWorld(true);
 const reflectionProjection=new THREE.Matrix4(),waterMeshes=[];
 garden.root.traverse(o=>{if(o.material===garden.materials.water)waterMeshes.push(o);});
 garden.configureReflection(reflector.getRenderTarget().texture,reflectionProjection);
 const composer=compact?null:new EffectComposer(renderer);
 let ao=null;
 if(composer){
  ao=new N8AOPass(scene,camera,1,1);ao.configuration.aoRadius=.85;ao.configuration.distanceFalloff=.8;ao.configuration.intensity=.75;
  ao.configuration.halfRes=true;ao.configuration.gammaCorrection=false;ao.configuration.accumulate=false;
  ao.setQualityMode('Low');composer.addPass(ao);composer.addPass(new SMAAPass());composer.addPass(new OutputPass());
 }
 if(compact)garden.root.traverse(o=>{if(o.isMesh&&o.castShadow)o.castShadow=o.material===garden.materials.tile;});
 const stats={reference:'Three.js Reflector / PCSS + N8AO',reflectionSize:compact?384:768,ambientOcclusion:!compact,softShadows:!compact,heightMist:true};
 return {
  stats,attachMist,
  resize(w,h){composer?.setSize(w,h);},
  setNight(value){const mix=THREE.MathUtils.clamp(Number(value),0,1);night=mix>.5;skyMaterial.uniforms.uNight.value=mix;density.value=THREE.MathUtils.lerp(.0065,.004,mix);tint.value.set('#dce4d8').lerp(new THREE.Color('#1d323b'),mix);},
  render(delta=0){
   camera.updateMatrixWorld(true);
   frame++;elapsed+=delta;
   // The capture is shared by all pond/creek meshes and updated at a reduced
   // cadence, rather than rendering a separate reflection for each water patch.
   if(frame===1||frame%(compact?5:2)===0){
    const visible=waterMeshes.map(o=>o.visible);waterMeshes.forEach(o=>o.visible=false);
    reflector.onBeforeRender(renderer,scene,camera);
    waterMeshes.forEach((o,i)=>o.visible=visible[i]);
    reflectionProjection.copy(reflector.material.uniforms.textureMatrix.value).multiply(new THREE.Matrix4().copy(reflector.matrixWorld).invert());
   }
   if(composer)composer.render(delta);else renderer.render(scene,camera);
  },
  dispose(){disposed=true;reflector.dispose();reflector.geometry.dispose();composer?.dispose();for(const pass of composer?.passes||[])pass.dispose?.();sky.removeFromParent();sky.geometry.dispose();sky.material.dispose();}
 };
};
