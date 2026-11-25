# 清晨薄雾渲染来源与接入

2026-10-22。实现源码：source/3d-stage/garden-rendering-entry.js；构建：npm run build:garden-rendering。生成的 public/js/yue-opera-morning-runtime.js 与现有 Yueju3D.THREE 共用 Three.js 0.180.0，不另外加载引擎副本。

- [Three.js r180 PCSS 示例](https://github.com/mrdoob/three.js/blob/r180/examples/webgl_shadowmap_pcss.html)，Three.js / spidersharma03，MIT。参考遮挡物搜索与泊松采样，为本场景平行光正交阴影体改写接触硬、远处软的阴影滤波。保留普通 PCFSoft 作为移动版路径。
- [Three.js Reflector](https://github.com/mrdoob/three.js/blob/r180/examples/jsm/objects/Reflector.js) 与 [Water2](https://github.com/mrdoob/three.js/blob/r180/examples/jsm/objects/Water2.js)，MIT。使用 Reflector 实现共享平面反射，参考 Water2 的流动水面思路；可见池水仍使用可接收阴影的 StandardMaterial，自定义反射、菲涅耳与细微波纹。没有直接替换为 Water2 材质。
- [N8AO](https://github.com/N8python/n8ao) 2.0.1，N8python。桌面使用半分辨率、低采样的接触遮蔽。发行包 LICENSE 为 CC0 1.0，包内 package.json 的 license 字段标为 ISC；本目录保留其实际发行 LICENSE 全文。
- [postprocessing](https://github.com/pmndrs/postprocessing) 6.37.8，MIT，为 N8AO 依赖；主合成流程使用 Three.js EffectComposer、SMAAPass 与 OutputPass。

本目录保留以上发行包许可。原始项目及作者权利按各许可处理；新增园林几何与清晨天空、低处高度雾、水面着色、性能分档由本项目编写。鱼体阴影使用原始变形目标随摆尾/翻滚投射，描边不投影。

桌面：4096 太阳阴影、768 反射、N8AO 和 SMAA；移动：2048 阴影、384 反射、关闭 N8AO。反射隔帧更新，所有池水共享一次捕获。运行时效果不包含在静态 GLB 内。
