// ============================================================
// 笔记拆分脚本
// ------------------------------------------------------------
// 把 data/notes-index.json 里每个"合集 md"拆成"一文件一篇"。
// 规则:
//   1. 读原 md → 按 \n---\n 分块 → 每块提取 # 标题 / @category / @date / 正文
//   2. 写到同父目录下的**同名子目录**里,例如:
//        content/math/calculus.md  →  content/math/calculus/{标题}.md
//   3. 文件名用第一行 # 标题清洗后的 slug(中文保留,禁字符 → -)
//   4. 同目录重名时追加 -2 / -3
//   5. 原合集 md 删除
//   6. 重写 data/notes-index.json,每个拆出的文件一条
//
// 用法(在项目根目录):
//   node scripts/split-notes.mjs
//
// 依赖:纯 Node 内置模块(fs/path),不需要任何 npm 包
// ============================================================

import fs from 'node:fs';
import path from 'node:path';

// -------------------- 常量 --------------------
const PROJECT_ROOT = process.cwd();
const INDEX_PATH = path.join(PROJECT_ROOT, 'data', 'notes-index.json');

// -------------------- 工具 --------------------

/** 清洗标题 → 安全文件名(中文保留,禁字符和空白 → -) */
function titleToFilename(title) {
  let s = String(title || '').trim();
  // Windows 文件系统禁用字符 + 路径分隔 + 引号
  s = s.replace(/[\/\\:*?"<>|]/g, '-');
  // 控制字符
  s = s.replace(/[\x00-\x1f]/g, '');
  // 连续空白 → 单个空格(允许空格,更自然)
  s = s.replace(/\s+/g, ' ');
  // 去首尾空白和点(Windows 不允许文件名以 . 结尾)
  s = s.replace(/^[.\s]+|[.\s]+$/g, '');
  return s || '未命名';
}

/** 规范化行尾 */
function normalizeLineEndings(text) {
  return String(text || '').replace(/\r\n/g, '\n').replace(/\r/g, '\n');
}

/**
 * 解析一个合集 md → 一组 {title, category, date, meta, body}
 * 按 \n---\n 分块,每块从头部取 # 标题和 @xxx 元数据
 */
function parseCollection(rawMd, fallback = {}) {
  const raw = normalizeLineEndings(rawMd).trim();
  const blocks = raw.split(/\n---+\n/g).map((s) => s.trim()).filter(Boolean);

  return blocks.map((block) => {
    const lines = block.split('\n');
    let title = '';
    let category = fallback.category || '';
    let meta = '';
    let date = '';
    const bodyLines = [];

    for (const rawLine of lines) {
      const line = rawLine.trim();
      if (!title && line.startsWith('# ')) {
        title = line.replace(/^#\s+/, '').trim();
        continue;
      }
      if (line.startsWith('@category:')) { category = line.replace('@category:', '').trim(); continue; }
      if (line.startsWith('@meta:'))     { meta     = line.replace('@meta:', '').trim(); continue; }
      if (line.startsWith('@date:'))     { date     = line.replace('@date:', '').trim(); continue; }
      bodyLines.push(rawLine);
    }

    return {
      title: title || fallback.title || '未命名',
      category: category || '未分类',
      meta,
      date,
      body: bodyLines.join('\n').trim(),
    };
  });
}

/**
 * 给定目录,返回"未占用"的文件名(如果 name.md 已存在,返回 name-2.md / name-3.md ...)
 */
function uniqueFilename(dir, baseName) {
  let candidate = `${baseName}.md`;
  let full = path.join(dir, candidate);
  let n = 2;
  while (fs.existsSync(full)) {
    candidate = `${baseName}-${n}.md`;
    full = path.join(dir, candidate);
    n += 1;
  }
  return candidate;
}

/** 重新拼装 md 内容(标题 + 元数据 + 正文) */
function composeSingleMd({ title, category, meta, date, body }) {
  const lines = [];
  lines.push(`# ${title}`);
  if (category) lines.push(`@category: ${category}`);
  if (meta)     lines.push(`@meta: ${meta}`);
  if (date)     lines.push(`@date: ${date}`);
  lines.push(''); // 元数据与正文之间空行
  lines.push(body);
  return lines.join('\n') + '\n';
}

// -------------------- 主流程 --------------------

function main() {
  // 1. 读索引
  if (!fs.existsSync(INDEX_PATH)) {
    console.error(`✗ 找不到索引文件: ${INDEX_PATH}`);
    process.exit(1);
  }
  const indexRaw = fs.readFileSync(INDEX_PATH, 'utf-8');
  const indexArr = JSON.parse(indexRaw);
  console.log(`📖 索引里共有 ${indexArr.length} 个合集\n`);

  const newIndex = [];           // 拆分后新索引
  const filesToDelete = [];      // 待删的原合集文件
  let totalSplit = 0;

  // 2. 逐个合集处理
  for (const entry of indexArr) {
    const collectionFile = entry.file;
    const absPath = path.join(PROJECT_ROOT, collectionFile);

    if (!fs.existsSync(absPath)) {
      console.warn(`  ⚠ 跳过:合集文件不存在 → ${collectionFile}`);
      continue;
    }

    const md = fs.readFileSync(absPath, 'utf-8');
    const notes = parseCollection(md, entry);

    if (!notes.length) {
      console.warn(`  ⚠ 跳过:合集为空 → ${collectionFile}`);
      continue;
    }

    // 目标子目录 = 原文件名(去 .md)
    const parentDir = path.dirname(absPath);
    const stem = path.basename(absPath, '.md');
    const targetDir = path.join(parentDir, stem);

    // 建目标子目录
    fs.mkdirSync(targetDir, { recursive: true });

    console.log(`📂 ${collectionFile}  →  ${path.relative(PROJECT_ROOT, targetDir)}/`);

    for (const note of notes) {
      const baseName = titleToFilename(note.title);
      const filename = uniqueFilename(targetDir, baseName);
      const outPath = path.join(targetDir, filename);
      const outRel = path.relative(PROJECT_ROOT, outPath).replaceAll('\\', '/');

      fs.writeFileSync(outPath, composeSingleMd(note), 'utf-8');

      console.log(`     ✓ ${filename}`);

      // 加入新索引
      newIndex.push({
        title: note.title,
        category: note.category,
        file: outRel,
        ...(note.meta ? { meta: note.meta } : {}),
        ...(note.date ? { date: note.date } : {}),
      });

      totalSplit += 1;
    }

    filesToDelete.push(absPath);
    console.log('');
  }

  // 3. 删除原合集文件
  for (const f of filesToDelete) {
    fs.unlinkSync(f);
    console.log(`🗑  已删除原合集: ${path.relative(PROJECT_ROOT, f)}`);
  }

  // 4. 重写索引
  fs.writeFileSync(INDEX_PATH, JSON.stringify(newIndex, null, 2) + '\n', 'utf-8');
  console.log(`\n📝 已重写索引: data/notes-index.json(${newIndex.length} 条)`);

  console.log(`\n✅ 完成:共拆出 ${totalSplit} 篇笔记,删除 ${filesToDelete.length} 个旧合集文件`);
}

main();
