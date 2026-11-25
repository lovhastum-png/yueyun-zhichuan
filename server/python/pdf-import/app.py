# -*- coding: utf-8 -*-
"""
PDF → 课程导入 OCR sidecar
=====================================================================
接收任意 PDF，用 RapidOCR 逐页识别文字，返回 JSON：{pages:[{page,text}]}
仅绑 127.0.0.1:8768，由 Node 网关（routes/courseImport.js）调用，不直接暴露公网。

启动（复用 pose-eval venv，已含 rapidocr/pymupdf/onnxruntime）：
  <pose-eval .venv>/python.exe -m uvicorn app:app --host 127.0.0.1 --port 8768
=====================================================================
"""
from __future__ import annotations

import asyncio
import os
import time

# 4 核机器默认只让 OCR 使用 2 个计算线程，为 Node、MySQL 和系统保留余量。
def _env_int(name, default, minimum, maximum):
    try:
        return max(minimum, min(maximum, int(os.getenv(name, str(default)))))
    except ValueError:
        return default


OCR_THREADS = _env_int('PDF_OCR_THREADS', 2, 1, 4)
os.environ.setdefault('OMP_NUM_THREADS', str(OCR_THREADS))
os.environ.setdefault('MKL_NUM_THREADS', str(OCR_THREADS))
os.environ.setdefault('OPENBLAS_NUM_THREADS', str(OCR_THREADS))

import numpy as np
from fastapi import FastAPI, File, HTTPException, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from starlette.concurrency import run_in_threadpool

import pymupdf as fitz
from rapidocr import RapidOCR

MAX_PDF_MB = _env_int('PDF_IMPORT_MAX_MB', 100, 10, 400)
MAX_PDF_BYTES = MAX_PDF_MB * 1024 * 1024
MIN_PDF_BYTES = 512
OCR_DPI = _env_int('PDF_OCR_DPI', 180, 120, 240)
OCR_CONCURRENCY = _env_int('PDF_OCR_CONCURRENCY', 1, 1, 2)

app = FastAPI(title='PDF OCR 服务', description='把 PDF 逐页识别为文字（教学课程导入用）', version='1.0.0')
app.add_middleware(
    CORSMiddleware, allow_origins=['*'], allow_methods=['*'], allow_headers=['*'])

_engine = None
_ocr_slots = asyncio.Semaphore(OCR_CONCURRENCY)
_active_jobs = 0
_waiting_jobs = 0


def _get_engine() -> RapidOCR:
    global _engine
    if _engine is None:
        print('[pdf-import] 初始化 RapidOCR...')
        _engine = RapidOCR(params={
            'EngineConfig.onnxruntime.intra_op_num_threads': OCR_THREADS,
            'EngineConfig.onnxruntime.inter_op_num_threads': 1,
        })
    return _engine


def _clean(text: str) -> str:
    lines = []
    for raw in text.split('\n'):
        line = raw.replace('\u00b7', '').strip()
        if not line:
            continue
        if line.isdigit() and len(line) <= 3:  # 页脚页码
            continue
        lines.append(''.join(ch for ch in line if not ch.isspace()))
    return '\n'.join(lines)


@app.get('/health')
def health():
    return {
        'status': 'ok', 'service': 'pdf-import', 'version': '1.0.0',
        'active_jobs': _active_jobs, 'waiting_jobs': _waiting_jobs,
        'concurrency': OCR_CONCURRENCY, 'dpi': OCR_DPI, 'threads': OCR_THREADS,
        'max_pdf_mb': MAX_PDF_MB,
    }


def _recognize_pdf(data: bytes) -> dict:
    """执行 CPU 密集的逐页 OCR；由线程池调用，避免阻塞健康检查。"""
    try:
        doc = fitz.open(stream=data, filetype='pdf')
    except Exception as exc:
        raise HTTPException(status_code=400, detail=f'无法解析 PDF: {exc}')

    try:
        if doc.needs_pass:
            raise HTTPException(status_code=400, detail='PDF 已加密，请先解除密码保护')
        total = len(doc)
        if total == 0:
            raise HTTPException(status_code=400, detail='PDF 没有可读取的页面')
        pages = []
        t0 = time.time()
        for i, page in enumerate(doc, 1):
            # 文字型 PDF 直接提取；扫描页才运行 OCR，保留混合文档的逐页回退。
            text = page.get_text('text', sort=True)
            readable = sum(ch.isalnum() for ch in text)
            if readable < 40 or text.count('\ufffd') > max(2, len(text) // 20):
                # 超大页面限制像素面积，避免一张工程图耗尽 4GB 内存。
                scale = min(OCR_DPI / 72, (12_000_000 / max(1, page.rect.width * page.rect.height)) ** 0.5)
                pix = page.get_pixmap(matrix=fitz.Matrix(scale, scale), colorspace=fitz.csRGB, alpha=False)
                img = np.frombuffer(pix.samples, dtype=np.uint8).reshape(pix.height, pix.width, 3)
                res = _get_engine()(img)
                text = '\n'.join(str(b) for b in (getattr(res, 'txts', None) or []))
                del img, pix, res
            pages.append({'page': i, 'text': _clean(text)})
            if i % 10 == 0 or i == total:
                el = time.time() - t0
                eta = el / i * (total - i)
                print(f'[pdf-import] OCR {i}/{total} 页, 已用 {el:.0f}s, 预计还需 {eta:.0f}s', flush=True)
        return {'pages': pages, 'total': total, 'elapsed_sec': round(time.time() - t0, 1)}
    finally:
        doc.close()


@app.post('/ocr')
async def ocr(file: UploadFile = File(...)):
    global _active_jobs, _waiting_jobs
    entered = False
    _waiting_jobs += 1
    try:
        async with _ocr_slots:
            _waiting_jobs -= 1
            entered = True
            _active_jobs += 1
            try:
                data = await file.read(MAX_PDF_BYTES + 1)
                if len(data) < MIN_PDF_BYTES:
                    raise HTTPException(status_code=400, detail='文件过小或为空')
                if len(data) > MAX_PDF_BYTES:
                    raise HTTPException(status_code=400, detail=f'文件过大（限制 {MAX_PDF_MB}MB）')

                # RapidOCR/ONNX 是同步 CPU 工作。放入线程池后，/health 可在识别期间正常响应。
                return await run_in_threadpool(_recognize_pdf, data)
            finally:
                _active_jobs -= 1
    finally:
        if not entered:
            _waiting_jobs -= 1
        await file.close()
