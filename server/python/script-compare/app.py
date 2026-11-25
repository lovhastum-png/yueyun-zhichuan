"""
越剧剧本多版本比对 · Python 分析服务（FastAPI sidecar）
=====================================================================
【定位】教学辅助工具，用于越剧教学中的剧本版本研读。
按越剧剧本体例（先对场次、再对场内唱段念白）做多版本比对；
唱词以整句为单位比对；所有比对结果均为「参考差异」，
差异判定请以专业教师为准。

【部署】仅绑定 127.0.0.1:8766，由 Node 网关（server/routes/scriptCompare.js）
转发调用，不直接暴露给浏览器 / 公网隧道。

【启动】
  uvicorn app:app --host 127.0.0.1 --port 8766
（start-all.ps1 会自动完成 venv 创建、依赖安装与本服务拉起）
=====================================================================
"""
from pathlib import Path

from fastapi import FastAPI, File, HTTPException, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel

import comparator
import preprocessor
from adapters import get_search_keywords

app = FastAPI(
    title='越剧剧本版本比对服务',
    description='场次对齐 · 唱段念白比对 · 差异标签 · 溯源关键词（教学辅助，参考差异）',
    version='1.0.0',
)

# Node 网关与本机调试直连均可访问（服务只绑 127.0.0.1，无公网暴露风险）
app.add_middleware(
    CORSMiddleware,
    allow_origins=['*'],
    allow_methods=['*'],
    allow_headers=['*'],
)

MAX_FILE_BYTES = 2 * 1024 * 1024   # 2MB（纯文本剧本足够宽裕）
ALLOWED_EXT = ('.txt',)
MIN_SENTENCES = 3                  # 有效剧本的最少唱念句数

SAMPLES_DIR = Path(__file__).parent / 'samples'
SAMPLE_OLD = SAMPLES_DIR / '梁祝_民国手抄本_1936.txt'
SAMPLE_NEW = SAMPLES_DIR / '梁祝_80年代舞台版_1982.txt'


class KeywordQuery(BaseModel):
    """溯源关键词查询体：传入一个差异片段的上下文。

    【预留接口】供后续 RAG 史料库 / 其他模块按差异片段检索史料时调用。
    """

    playTitle: str = ''
    sceneTitle: str = ''
    role: str = ''
    oldText: str = ''
    newText: str = ''


@app.get('/health')
def health():
    return {'status': 'ok', 'service': 'script-compare', 'version': '1.0.0'}


async def _read_script(file: UploadFile):
    """校验扩展名 / 大小 → 解码 → 结构化解析（清洗 + 繁简 + 分场分段分句）。"""
    name = file.filename or ''
    if not name.lower().endswith(ALLOWED_EXT):
        raise HTTPException(status_code=400, detail='仅支持 TXT 格式剧本文本')
    data = await file.read()
    if not data:
        raise HTTPException(status_code=400, detail='剧本文本文件为空')
    if len(data) > MAX_FILE_BYTES:
        raise HTTPException(status_code=400, detail='剧本文件过大（限制 2MB）')

    script = preprocessor.parse_script(
        preprocessor.decode_txt_bytes(data), filename=name)
    if script.sentence_count < MIN_SENTENCES:
        raise HTTPException(
            status_code=400,
            detail='未解析到足够的唱词或念白：请确认文本按【场次】【唱段】【念白】分段，'
                   '且每句以角色名开头（如「祝英台（唱）：……」）',
        )
    return script


@app.post('/compare')
async def compare(
    old_script: UploadFile = File(..., alias='oldScript'),
    new_script: UploadFile = File(..., alias='newScript'),
):
    """
    剧本版本比对主接口。

    - oldScript / newScript: 两个版本的剧本文本（字段名与 Node 网关一致，alias 映射）
    - 文件名遵循「剧目名_版本_年代.txt」约定（用于报告版本信息，不符时自动降级）
    - 返回结构化比对报告 JSON（含差异标签、溯源关键词与 Markdown 导出文本）
    - 错误以 400 返回，detail 为可直接展示的客观描述
    """
    try:
        old = await _read_script(old_script)
        new = await _read_script(new_script)
    except HTTPException:
        raise
    except Exception as e:  # noqa: BLE001 —— 上传读取阶段统一兜底
        raise HTTPException(status_code=500, detail=f'剧本文件读取出现未预期的问题：{type(e).__name__}')

    try:
        return comparator.build_report(old, new)
    except Exception as e:  # noqa: BLE001 —— 未预期异常统一兜底，避免堆栈外泄
        raise HTTPException(status_code=500, detail=f'比对过程出现未预期的问题：{type(e).__name__}')


@app.get('/demo')
def demo():
    """演示接口：直接比对自带样本（梁祝 民国手抄本 ↔ 80年代舞台版），无需上传。"""
    try:
        old = preprocessor.parse_script(
            SAMPLE_OLD.read_text(encoding='utf-8'), filename=SAMPLE_OLD.name)
        new = preprocessor.parse_script(
            SAMPLE_NEW.read_text(encoding='utf-8'), filename=SAMPLE_NEW.name)
        return comparator.build_report(old, new)
    except FileNotFoundError:
        raise HTTPException(status_code=500, detail='演示样本文件缺失，请联系管理员检查 samples 目录')
    except Exception as e:  # noqa: BLE001
        raise HTTPException(status_code=500, detail=f'演示比对出现未预期的问题：{type(e).__name__}')


@app.post('/keywords')
def keywords(q: KeywordQuery):
    """【预留接口】差异片段 → 史料文献检索关键词。

    供后续 RAG 史料库 / 作业批改等模块调用；RAG / 知识图谱检索本体
    （adapters.query_rag_corpus / query_knowledge_graph）仍为预留空实现。
    """
    return {
        'keywords': get_search_keywords(
            q.playTitle, q.sceneTitle, q.role, [q.oldText, q.newText]),
        'rag_status': 'reserved',
        'kg_status': 'reserved',
    }
