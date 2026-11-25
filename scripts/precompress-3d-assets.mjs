import { readFile, writeFile } from 'node:fs/promises';
import { constants, brotliCompress } from 'node:zlib';
import { promisify } from 'node:util';

const compress = promisify(brotliCompress);
const files = [
  'public/assets/3d-stage/vroid/yueju-base.fast.vrm',
  'public/assets/3d-stage/vroid/costumes/xu.web.vrm',
  'public/assets/3d-stage/vroid/costumes/yuan.web.vrm',
  'public/assets/3d-stage/vroid/costumes/fan.web.vrm',
  'public/assets/3d-stage/vroid/costumes/fu.web.vrm',
  'public/assets/3d-stage/vroid/costumes/laosheng.web.vrm',
  'public/assets/3d-stage/vroid/costumes/chou.web.vrm',
  'public/assets/3d-stage/venue/chinese-pavilion-mobile.glb',
  'public/assets/3d-stage/venue/chinese-pavilion-web.glb',
  // 主戏台场地模型：桌面端 18MB / 移动端 16MB，是全站最大的两个资源。
  // 必须预压缩，否则每次请求都由 Node 实时 brotli（单核阻塞数秒，4C4G 机器上会明显拖慢并发）。
  'public/assets/3d-stage/venue/yue-opera-stage.glb',
  'public/assets/3d-stage/venue/yue-opera-stage-mobile.glb',
  'public/js/3d-stage-runtime.js'
];

for (const file of files) {
  const source = await readFile(file);
  const output = await compress(source, {
    params: {
      [constants.BROTLI_PARAM_QUALITY]: 9,
      [constants.BROTLI_PARAM_MODE]: constants.BROTLI_MODE_GENERIC
    }
  });
  await writeFile(`${file}.br`, output);
  console.log(`${file}: ${source.length} -> ${output.length} bytes`);
}
