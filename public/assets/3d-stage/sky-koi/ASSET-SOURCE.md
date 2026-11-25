# 当前锦鲤模型：Koi Fish / 7PLUS

- 作者：7PLUS（https://sketchfab.com/7plus）。
- 原始发布页：https://sketchfab.com/3d-models/koi-fish-236859b809984f52b70c94fd040b9c59
- 许可：Creative Commons Attribution 4.0 International（CC BY 4.0）。
- 许可链接：https://creativecommons.org/licenses/by/4.0/
- 获取日期：2026-10-22。
- 本次获取的公开镜像：https://github.com/riki-k-dev/mini-aquarium/blob/main/public/Models/koi.glb
- 镜像原始文件：https://raw.githubusercontent.com/riki-k-dev/mini-aquarium/main/public/Models/koi.glb

GLB 自带 asset.extras 作者、原发布页和 CC-BY-4.0 许可记录，与发布页核对一致。项目没有将其声明为自建或原创模型；正式舞台和制作预览页都显示作者和来源。

`yueyun-sky-koi.glb` 保存作者原始 GLB 字节：522 个三角面、519 个顶点，1 套 6.25 秒的 MorphBake 游泳动画，150 个烘焙变形目标，内嵌颜色与法线贴图。这是作者烘焙的网格变形动画，文件不含骨骼蒙皮；没有重新声称绑定了骨骼。

接入脚本：`public/js/yue-opera-public-koi.js`。使用 Three.js AnimationMixer 播放原版游泳动画；网页中将真实动画姿态居中并放大至约 78 个场景单位，支持暂停和夜景亮度。

2026-10-22 的风格改动：原始 GLB 保持不变，网页显示时停用摄影颜色贴图与法线贴图。当前默认「水墨鱼」：用原创顶点色绘制浓墨鱼背、淡墨侧身和留白鱼腹；自定义表面着色添加细微墨晕、干笔和纸纹，纹样固定在原始网格坐标上，随鱼身变形而动。工具栏可依次切换水墨鱼、奶油白模、淡彩鱼，均为高粗糙度哑光材质和细描边；水墨和淡彩版带小圆眼。描边共享原版变形权重，小圆眼跟随动画顶点；作者的原始鱼身几何和游泳动作保持不变。

新增飞行编排：一条 136 秒闭合、按弧长取样的 20 控制点平滑路线，包含外围盘旋、穿场掠游、升降和回旋。鱼头沿轨迹切线俯仰，转弯时侧倾；每轮三次自动完整翻滚，亦可点击「腾空翻滚」触发 7.5 秒的抬升翻滚。翻滚与原版摆尾叠加，暂停同时冻结全部动作，连续点击不重新开始正在进行的翻滚。原生游泳播放速度在约 0.78～1.06 倍间平滑变化。路线编排参考末影龙绕中心飞行和掠过后回旋的节奏，未复制游戏代码或模型：官方行为参考 https://learn.microsoft.com/en-us/minecraft/creator/reference/content/entityreference/examples/entitygoals/minecraftbehavior_dragonholdingpattern 。风格、飞行和灯光适配属于本项目接入改动。

`yueyun-soft-koi.glb` 为从原文件派生的奶油白模版本，包含哑光材质、顶点色、原版 MorphBake 动画和作者／许可／修改元数据。材质不再引用摄影和法线贴图；原始二进制数据仍保留在文件中。网页的实时描边与淡彩小圆眼没有写入此导出文件。制作预览页的「保存当前风格鱼」可以导出当前白模或淡彩材质。

`yueyun-ink-koi.glb` 为水墨顶点色版本，保留原版游泳动画和署名信息。水墨表面细纹、实时描边、小圆眼、飞行轨迹和翻滚属于网页实时效果，不写入 GLB；导入三维软件可获得水墨大色块及原版摆尾动画。预览页选择水墨风格后，「保存当前风格鱼」会保存到此文件。

验证：桌面与移动版在整条路线取 1361 个时间样本，检查鱼头朝向、连续转弯、完整自动翻滚和鱼鳍净空；采样最低鱼身顶点约为场景高度 17.39。另验证手动翻滚的姿态连续性、暂停冻结、原版动画循环和三种配色导出保留原始动画二进制。

原先程序生成的鱼已退出正式页和预览页；旧版制作代码与静态模型保留在 `source-assets/3d-stage/legacy/sky-koi-procedural.*` 作为历史备份。

2026-10-22 清晨版：原始鱼体启用真实太阳投影，原有 MorphBake 摆尾与网页翻滚共同影响阴影形状；描边不投影。鱼模型和动画原始数据未替换。
