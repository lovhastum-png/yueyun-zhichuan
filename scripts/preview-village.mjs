import http from 'node:http';
import { readFile, writeFile, mkdir, stat } from 'node:fs/promises';
import { resolve, extname, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
const root=resolve(fileURLToPath(new URL('../public/',import.meta.url)));
const exportsDir=resolve(root,'assets/3d-stage/venue/village-v2');
const types={'.html':'text/html; charset=utf-8','.js':'text/javascript','.css':'text/css','.json':'application/json','.svg':'image/svg+xml','.png':'image/png','.webp':'image/webp','.vrm':'model/gltf-binary','.glb':'model/gltf-binary','.mp3':'audio/mpeg','.ogg':'audio/ogg','.wav':'audio/wav','.m4a':'audio/mp4'};
http.createServer(async(req,res)=>{
  try {
    const url=new URL(req.url,'http://127.0.0.1');
    if(req.method==='POST'&&['/save-village-model','/save-village-preview','/save-garden-model','/save-garden-preview','/save-sky-koi-model','/save-soft-koi-model','/save-ink-koi-model'].includes(url.pathname)){
      const parts=[];let size=0;for await(const chunk of req){size+=chunk.length;if(size>30e6)throw Error('File too large');parts.push(chunk);}
      const targetDir=url.pathname.startsWith('/save-garden-')?resolve(root,'assets/3d-stage/venue/garden-v3'):['/save-sky-koi-model','/save-soft-koi-model','/save-ink-koi-model'].includes(url.pathname)?resolve(root,'assets/3d-stage/sky-koi'):exportsDir;
      await mkdir(targetDir,{recursive:true});
      const filename=url.pathname==='/save-garden-model'?'yueyun-zhuiyu-garden.glb':url.pathname==='/save-garden-preview'?'yueyun-zhuiyu-garden-preview.png':url.pathname==='/save-ink-koi-model'?'yueyun-ink-koi.glb':url.pathname==='/save-soft-koi-model'?'yueyun-soft-koi.glb':url.pathname==='/save-sky-koi-model'?'yueyun-sky-koi.glb':url.pathname.endsWith('model')?'yueyun-opera-village.glb':'yueyun-opera-village-preview.png';
      await writeFile(resolve(targetDir,filename),Buffer.concat(parts));res.writeHead(200,{'Content-Type':'application/json'});res.end(JSON.stringify({saved:filename}));return;
    }
    let filename=resolve(root,'.'+decodeURIComponent(url.pathname==='/'?'/village-preview.html':url.pathname));
    if(!filename.startsWith(root+sep)&&filename!==root){res.writeHead(403);res.end();return;}
    // Match the production SPA fallback so /app/stage can be checked locally.
    if(url.pathname==='/app'||url.pathname.startsWith('/app/')){
      try { if(!(await stat(filename)).isFile()) filename=resolve(root,'app/index.html'); }
      catch { filename=resolve(root,'app/index.html'); }
    }
    const data=await readFile(filename);
    const headers={'Content-Type':types[extname(filename)]||'application/octet-stream','Cache-Control':'no-store','Accept-Ranges':'bytes'};
    const range=req.headers.range;
    if(range){
      const match=/^bytes=(\d*)-(\d*)$/.exec(range);
      let start=match?.[1]?Number(match[1]):0, end=match?.[2]?Number(match[2]):data.length-1;
      if(match&&!match[1]&&match[2]){start=Math.max(0,data.length-Number(match[2]));end=data.length-1;}
      if(!match||(!match[1]&&!match[2])||!Number.isSafeInteger(start)||!Number.isSafeInteger(end)||start<0||start>=data.length||end<start){res.writeHead(416,{...headers,'Content-Range':`bytes */${data.length}`});res.end();return;}
      end=Math.min(end,data.length-1);
      res.writeHead(206,{...headers,'Content-Range':`bytes ${start}-${end}/${data.length}`,'Content-Length':end-start+1});
      res.end(req.method==='HEAD'?undefined:data.subarray(start,end+1));return;
    }
    res.writeHead(200,{...headers,'Content-Length':data.length});res.end(req.method==='HEAD'?undefined:data);
  }catch(error){res.writeHead(404);res.end('Not found');}
}).listen(Number(process.env.VILLAGE_PREVIEW_PORT||4175),'127.0.0.1',()=>console.log(`Village preview: http://127.0.0.1:${process.env.VILLAGE_PREVIEW_PORT||4175}/3d-stage.html`));
