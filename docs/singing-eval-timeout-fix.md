# 演唱测评超时修复与上线

## 已确认的代码问题

- 原分析器按 10ms 帧移创建完整 DTW 矩阵。两段 120 秒音频各约 12001 帧，单张 float64 矩阵约 1.07GiB；距离和累计代价矩阵就超过 2GiB，尚不含回溯矩阵和带宽遮罩的临时索引。部署配置 `yueyun-singing.service` 仅允许 800MB，存在明显的内存不足风险。尚未取得线上日志，不能断言线上唯一原因。
- 新算法仅保留两行累计代价和带内单字节回溯方向，保留原 10ms 精度、距离函数、25% 带宽和步长规则，避免完整矩阵分配。
- 原 FastAPI 在异步接口直接执行 CPU 分析，阻塞请求处理；现在转到线程执行，并串行限制计算。
- 原任务首次读取后立即删除结果，公网响应丢失后无法重取；现在结果保留 30 分钟并禁止缓存。重复 complete 请求也不会重复加入计算队列。
- 前端原来把排队时间算入计算超时，且部分请求无超时上限；现已分开提示排队/分析/上传问题，并允许短暂网络失败后继续获取同一份结果。
- Python 上传上限统一到 60MB；唱段时长仍为 3–120 秒，前端上传前与 Python 解码前均验证。

## 验证

- 原 librosa 算法与新算法：等长、不同长度、随机音高及同分路径结果一致。
- 12001 帧完整对齐、音高偏差检测、超长音频提前拒绝、完整 WAV 分析均通过。
- Node 分片上传、并发重复提交、计算超时终态、报告重复读取通过。
- 本机独立进程用两段各 120 秒合成音频执行完整分析：约 3.65 秒，峰值进程内存约 527MB。此数据不是云端性能承诺，也不代替真实越剧录音验证。

## 云端更新

按本仓库 systemd 部署方案，默认目录为 `/opt/yueyun`，服务用户为 `yueyun`。实际目录/服务名不同时相应替换。

1. 同步本次修改的 `server/python/singing-eval/` 下源代码和依赖清单、`server/routes/singingEval.js`、`src/app/SingingEvalPage.tsx`，以及重新构建的整个 `public/app/`。不要把 Windows `.venv` 上传到 Linux。
2. 在云端项目根目录执行：

```sh
cd /opt/yueyun
sudo -u yueyun server/python/singing-eval/.venv/bin/python -m pip install -r server/python/singing-eval/requirements.txt
sudo systemctl restart yueyun-singing yueyun-web
curl --fail http://127.0.0.1:8765/health
```

健康检查应显示 `version: 1.1.0`。只更新网页、只延长反向代理超时，或只重启 Node，均不能更新 Python 的计算算法。

3. 刷新浏览器，上传两段 3–120 秒 WAV，确认出现测评报告。当前前端应调用 `/api/singing-eval/chunk/...` 和 `/api/singing-eval/task/...`；若仍调用同步 `/analyze`，检查浏览器/CDN 缓存及前端文件是否更新。
4. 若仍失败，收集以下日志和资源状态，可区分服务未启动、计算异常及内存终止：

```sh
sudo systemctl status yueyun-singing yueyun-web --no-pager
sudo journalctl -u yueyun-singing -u yueyun-web --since '15 minutes ago' --no-pager
sudo systemctl show yueyun-singing -p MemoryCurrent -p MemoryPeak -p MemoryMax -p NRestarts
sudo journalctl -k --since '15 minutes ago' --no-pager
```

任务状态目前保存在单个 Node 进程内存中，适用于仓库现有单进程部署；更新重启时正在进行的任务需要重新提交。若实际采用多实例负载均衡，需要共享任务存储或将同一任务固定到同一实例。
