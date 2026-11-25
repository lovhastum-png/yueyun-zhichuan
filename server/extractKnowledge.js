// 资料库批量提取 + 向量化入库脚本
// 扫描「资料」文件夹，提取 docx 和 htm 文本，分块后向量化写入 knowledge_chunks 表
// 使用：node server/extractKnowledge.js
import 'dotenv/config';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import mammoth from 'mammoth';
import iconv from 'iconv-lite';
import pool from './db.js';
import { getEmbeddings } from './services/aiGrade.js';
import { getKnowledgeStats } from './services/ragRetrieval.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const DATA_ROOT = path.join(__dirname, '..', '资料');

// 向量序列化
function vectorToBuffer(vec) {
  return Buffer.from(new Float32Array(vec).buffer);
}

// ============================================================
// 文本清洗工具
// ============================================================

// 从 HTML 提取纯文本（支持 GB2312 编码）
function extractHtmlText(filePath) {
  try {
    const buf = fs.readFileSync(filePath);
    // 先用 iconv-lite 按 GB2312 解码（学长资料多为 GB2312）
    let html = iconv.decode(buf, 'gb2312');
    // 提取 title
    let title = '';
    const titleMatch = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
    if (titleMatch) title = titleMatch[1].trim();
    // 去 script/style
    html = html.replace(/<script[\s\S]*?<\/script>/gi, '');
    html = html.replace(/<style[\s\S]*?<\/style>/gi, '');
    // 去标签
    let text = html.replace(/<[^>]+>/g, '\n');
    // 解码常见实体
    text = text.replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"');
    // 清理空白
    text = text.split('\n').map(l => l.trim()).filter(l => l.length > 0).join('\n');
    return { title, text };
  } catch (err) {
    return { title: '', text: '' };
  }
}

// 从 DOCX 提取纯文本
async function extractDocxText(filePath) {
  try {
    const result = await mammoth.extractRawText({ path: filePath });
    let text = result.value || '';
    // 清理多余空行
    text = text.split('\n').map(l => l.trim()).filter(l => l.length > 0).join('\n');
    return { title: '', text };
  } catch (err) {
    console.error(`  ✗ docx解析失败 ${path.basename(filePath)}: ${err.message}`);
    return { title: '', text: '' };
  }
}

// 长文本分块（按段落，每块约 600-900 字）
function chunkText(text, maxLen = 800) {
  if (text.length <= maxLen) return [text];
  const chunks = [];
  // 先按双换行分段
  const paragraphs = text.split(/\n{2,}/);
  let current = '';
  for (const para of paragraphs) {
    if ((current + '\n\n' + para).length <= maxLen) {
      current = current ? current + '\n\n' + para : para;
    } else {
      if (current) chunks.push(current);
      // 单段超长则按句号切
      if (para.length > maxLen) {
        const sentences = para.split(/(?<=[。！？；])/);
        current = '';
        for (const s of sentences) {
          if ((current + s).length <= maxLen) {
            current += s;
          } else {
            if (current) chunks.push(current);
            current = s;
          }
        }
      } else {
        current = para;
      }
    }
  }
  if (current) chunks.push(current);
  return chunks.filter(c => c.trim().length > 20); // 过滤太短的块
}

// ============================================================
// 目录路径 → source_type 映射
// ============================================================
function inferSourceType(relPath) {
  if (relPath.includes('经典剧目原文')) return 'play';
  if (relPath.includes('越剧流派原始资料')) return 'school';
  if (relPath.includes('行当角色档案')) return 'role';
  if (relPath.includes('服饰妆容')) return 'makeup';
  if (relPath.includes('非遗传承人')) return 'heritage';
  if (relPath.includes('学长资料')) return 'history';
  return 'document';
}

// 从文件路径生成标题
function inferTitle(relPath, fileName, htmlTitle) {
  // 优先用文件名（去掉扩展名）
  let base = fileName.replace(/\.(docx|htm|html)$/i, '');
  // 去掉书名号包裹的已经是好的
  // 如果是 index 目录下的htm，用上级目录名
  if (base === 'index' || base === 'content' || base === 'Index') {
    const parts = relPath.split(path.sep).filter(Boolean);
    if (parts.length >= 2) base = parts[parts.length - 2];
  }
  // 如果有htm的title且更具体
  if (htmlTitle && htmlTitle.length > 1 && htmlTitle.length < 40) {
    base = htmlTitle;
  }
  return base.slice(0, 100);
}

// 生成 source_id（确保唯一）
let idCounter = 0;
function genSourceId(type, filePath) {
  idCounter++;
  const hash = Buffer.from(filePath).toString('base64').replace(/[/+=]/g, '').slice(0, 20);
  return `${type}_${hash}_${idCounter}`.slice(0, 60);
}

// ============================================================
// 主流程
// ============================================================
async function main() {
  console.log('========================================');
  console.log('  越韵智传 · 资料库批量提取入库');
  console.log('========================================\n');

  // 1. 数据库连接
  console.log('[1/5] 检查数据库连接...');
  try {
    await pool.query('SELECT 1');
    console.log('  ✓ 数据库连接正常');
  } catch (err) {
    console.error('  ✗ 数据库连接失败:', err.message);
    process.exit(1);
  }

  // 2. 扩展 source_type ENUM（兼容已存在的表）
  console.log('\n[2/5] 扩展 source_type 枚举...');
  try {
    await pool.query(`ALTER TABLE knowledge_chunks MODIFY COLUMN source_type ENUM('card','course','play','document','school','role','makeup','heritage','history') NOT NULL DEFAULT 'card'`);
    console.log('  ✓ source_type 枚举已扩展');
  } catch (err) {
    console.log('  (枚举已是最新或扩展失败，继续):', err.message);
  }

  // 3. 扫描文件
  console.log('\n[3/5] 扫描资料文件夹...');
  const docxFiles = [];
  const htmFiles = [];

  function scanDir(dir) {
    const entries = fs.readdirSync(dir, { withFileTypes: true });
    for (const entry of entries) {
      const fullPath = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        scanDir(fullPath);
      } else if (entry.isFile()) {
        const ext = path.extname(entry.name).toLowerCase();
        if (ext === '.docx') {
          docxFiles.push(fullPath);
        } else if (ext === '.htm' || ext === '.html') {
          // 排除 fake 目录和空文件
          if (!fullPath.includes('fake') && fs.statSync(fullPath).size > 200) {
            htmFiles.push(fullPath);
          }
        }
      }
    }
  }
  scanDir(DATA_ROOT);
  console.log(`  ✓ 发现 ${docxFiles.length} 个 docx 文件，${htmFiles.length} 个有内容的 htm 文件`);

  // 4. 提取文本 + 分块
  console.log('\n[4/5] 提取文本并分块...');
  const allChunks = [];

  // 处理 docx
  for (let i = 0; i < docxFiles.length; i++) {
    const filePath = docxFiles[i];
    const relPath = path.relative(DATA_ROOT, filePath);
    const fileName = path.basename(filePath);
    process.stdout.write(`  [docx ${i + 1}/${docxFiles.length}] ${fileName.slice(0, 30)}... `);
    const { title: htmlTitle, text } = await extractDocxText(filePath);
    if (!text || text.length < 50) {
      console.log('跳过（内容过少）');
      continue;
    }
    const sourceType = inferSourceType(relPath);
    const title = inferTitle(relPath, fileName, htmlTitle);
    const chunks = chunkText(text, 800);
    chunks.forEach((chunk, idx) => {
      allChunks.push({
        source_id: genSourceId(sourceType, filePath + '_' + idx),
        source_type: sourceType,
        title: chunks.length > 1 ? `${title}（${idx + 1}/${chunks.length}）` : title,
        content: chunk,
        keywords: [sourceType, title.split(/[（(]/)[0]],
        _file: relPath,
      });
    });
    console.log(`${chunks.length} 块`);
  }

  // 处理 htm
  for (let i = 0; i < htmFiles.length; i++) {
    const filePath = htmFiles[i];
    const relPath = path.relative(DATA_ROOT, filePath);
    const fileName = path.basename(filePath);
    process.stdout.write(`  [htm ${i + 1}/${htmFiles.length}] ${fileName.slice(0, 30)}... `);
    const { title: htmlTitle, text } = extractHtmlText(filePath);
    if (!text || text.length < 50) {
      console.log('跳过（内容过少）');
      continue;
    }
    const sourceType = inferSourceType(relPath);
    const title = inferTitle(relPath, fileName, htmlTitle);
    const chunks = chunkText(text, 800);
    chunks.forEach((chunk, idx) => {
      allChunks.push({
        source_id: genSourceId(sourceType, filePath + '_' + idx),
        source_type: sourceType,
        title: chunks.length > 1 ? `${title}（${idx + 1}/${chunks.length}）` : title,
        content: chunk,
        keywords: [sourceType, title.split(/[（(]/)[0]],
        _file: relPath,
      });
    });
    console.log(`${chunks.length} 块`);
  }

  console.log(`\n  总计生成 ${allChunks.length} 个知识块`);

  // 5. 向量化 + 入库（分批，每批20条）
  console.log('\n[5/5] 向量化并入库（每批20条）...');
  let ok = 0, fail = 0;
  const batchSize = 10; // 百炼 embedding API 限制批量不超过10
  for (let i = 0; i < allChunks.length; i += batchSize) {
    const batch = allChunks.slice(i, i + batchSize);
    process.stdout.write(`  批次 ${Math.floor(i / batchSize) + 1}/${Math.ceil(allChunks.length / batchSize)}（${batch.length}条）... `);
    try {
      // 批量 embedding
      const texts = batch.map(c => `${c.title}。${c.content}`);
      const embeddings = await getEmbeddings(texts);
      // 逐条入库
      for (let j = 0; j < batch.length; j++) {
        const c = batch[j];
        try {
          await pool.query(
            `INSERT INTO knowledge_chunks (source_id, source_type, title, content, keywords, embedding)
             VALUES (?, ?, ?, ?, ?, ?)
             ON DUPLICATE KEY UPDATE title=VALUES(title), content=VALUES(content), keywords=VALUES(keywords), embedding=VALUES(embedding)`,
            [c.source_id, c.source_type, c.title, c.content, JSON.stringify(c.keywords || []), vectorToBuffer(embeddings[j])]
          );
          ok++;
        } catch (err) {
          console.error(`\n    ✗ 入库失败 ${c.source_id}: ${err.message}`);
          fail++;
        }
      }
      console.log('✓');
    } catch (err) {
      console.error(`✗ embedding失败: ${err.message}`);
      fail += batch.length;
    }
    // 批次间小憩，避免 API 限流
    await new Promise(r => setTimeout(r, 500));
  }

  console.log(`\n  入库完成：成功 ${ok}，失败 ${fail}`);

  // 6. 统计
  const stats = await getKnowledgeStats();
  console.log(`\n========================================`);
  console.log(`  知识库统计：共 ${stats.total} 条已向量化知识`);
  for (const t of stats.byType) {
    console.log(`    - ${t.source_type}: ${t.cnt} 条`);
  }
  console.log(`========================================`);

  process.exit(0);
}

main().catch(err => {
  console.error('\n✗ 执行失败:', err);
  process.exit(1);
});
