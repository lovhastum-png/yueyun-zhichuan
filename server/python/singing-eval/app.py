"""
越剧演唱测评 · Python 分析服务（FastAPI sidecar）
=====================================================================
【定位】教学演示辅助工具，不是专业戏曲评测。
仅评估音准与节奏板眼；不识别咬字、润腔、尖团字、气息；
所有分数均为【参考分】，不能替代专业教师听辨打分。

【部署】仅绑定 127.0.0.1:8765，由 Node 网关（server/routes/singingEval.js）
转发调用，不直接暴露给浏览器 / 公网隧道。

【启动】
  uvicorn app:app --host 127.0.0.1 --port 8765
（start-all.ps1 会自动完成 venv 创建、依赖安装与本服务拉起）
=====================================================================
"""
import os
import tempfile
import asyncio
import logging
import time

from fastapi import FastAPI, File, HTTPException, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from starlette.concurrency import run_in_threadpool

import analyzer

app = FastAPI(
    title='越剧演唱测评分析服务',
    description='音准 · 板眼节奏比对（教学演示参考，非专业戏曲评测）',
    version='1.1.0',
)

# Node 网关与本机调试直连均可访问（服务只绑 127.0.0.1，无公网暴露风险）
app.add_middleware(
    CORSMiddleware,
    allow_origins=['*'],
    allow_methods=['*'],
    allow_headers=['*'],
)

MAX_FILE_BYTES = 60 * 1024 * 1024   # 与 Node / 页面一致；时长仍限 3-120 秒
ALLOWED_EXT = ('.wav',)
analysis_lock = asyncio.Lock()  # 包括旧同步入口在内，每次只运行一份计算
log = logging.getLogger('uvicorn.error')


@app.get('/health')
def health():
    return {'status': 'ok', 'service': 'singing-eval', 'version': '1.1.0',
            'busy': analysis_lock.locked()}


async def _save_temp(file: UploadFile) -> str:
    """校验大小/扩展名并落临时文件，返回路径（调用方负责删除）"""
    name = file.filename or ''
    if not name.lower().endswith(ALLOWED_EXT):
        raise HTTPException(status_code=400, detail='仅支持 WAV 格式音频')
    tmp = tempfile.NamedTemporaryFile(suffix='.wav', delete=False)
    try:
        size = 0
        while data := await file.read(1024 * 1024):
            size += len(data)
            if size > MAX_FILE_BYTES:
                raise HTTPException(status_code=400, detail='音频文件过大（限制 60MB）')
            tmp.write(data)
        if not size:
            raise HTTPException(status_code=400, detail='音频文件为空')
        tmp.close()
        return tmp.name
    except BaseException:
        tmp.close()
        os.unlink(tmp.name)
        raise


@app.post('/analyze')
async def analyze(
    student_audio: UploadFile = File(..., alias='studentAudio'),
    ref_audio: UploadFile = File(..., alias='refAudio'),
):
    """
    演唱测评主接口。

    - studentAudio: 学生演唱 WAV（字段名与 Node 网关保持一致，alias 映射）
    - refAudio: 标准范本 WAV
    - 返回结构化报告 JSON（契约见 analyzer.analyze）
    - 错误以 400 返回，detail 为可直接展示的客观描述
    """
    stu_path = ref_path = None
    try:
        stu_path = await _save_temp(student_audio)
        ref_path = await _save_temp(ref_audio)
        async with analysis_lock:
            started = time.monotonic()
            log.info('Singing analysis started')
            # CPU 计算不能阻塞事件循环，否则 /health 和后续请求也一起超时。
            report = await run_in_threadpool(analyzer.analyze, stu_path, ref_path)
            log.info('Singing analysis finished in %.2fs', time.monotonic() - started)
        return report
    except analyzer.AnalysisError as e:
        raise HTTPException(status_code=400, detail=str(e))
    except HTTPException:
        raise
    except Exception as e:  # noqa: BLE001 —— 未预期异常统一兜底，避免堆栈外泄
        log.exception('Singing analysis failed')
        raise HTTPException(status_code=500, detail=f'分析过程出现未预期的问题：{type(e).__name__}')
    finally:
        for p in (stu_path, ref_path):
            if p and os.path.exists(p):
                try:
                    os.unlink(p)
                except OSError:
                    pass
