# 越剧戏装 VRM 来源与网页版本

网页运行文件由项目根目录 `服装(1)/服装/` 中用户提供的六个 VRM 模型生成。处理过程仅缩小过大的内嵌贴图，保留 VRM 骨骼、表情、网格和材质结构。

| 原文件 | 网页文件 | 衣谱名称 |
| --- | --- | --- |
| 服装1.vrm | laosheng.web.vrm | 墨绿员外袍 |
| 服装2.vrm | chou.web.vrm | 锦色短打 |
| 服装3.vrm | xu.web.vrm | 朱砂蟒袍 |
| 服装4.vrm | fan.web.vrm | 月白儒生褶子 |
| 服装5.vrm | fu.web.vrm | 百花水袖衣 |
| 服装6.vrm | yuan.web.vrm | 粉青对襟褂 |

生成命令使用 `scripts/optimize-vrm-glb.py`，可见贴图最大边长为 1024 像素。网页按需加载单套 VRM，并在换装后释放上一套模型。
