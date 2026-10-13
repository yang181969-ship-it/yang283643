import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import sharp from 'sharp';

// ========================================================
// Life 数据构建
//
// 1. data/image-index.json —— 全站公开图片的统一索引（Gallery 读取）
//    来源：js/gallery-data.js（原画廊，保留全部元数据）
//         js/anime-data.js（详情页封面与插图）
//         data/life.json（足迹、收藏、作品中的图片）
//         content/life/journal/*.md（日记 @cover）
//    同一路径只收录一次；其他位置对它的使用记为 refs，不复制文件、不重复收藏。
//    没有可靠日期的图片 date 留空，不用文件时间伪造。
//
// 2. data/journal-index.json —— 生活日记索引（按日期倒序）
//
// 只读源文件，输出内容与运行时间无关，重复运行结果一致。
// ========================================================

const ROOT = process.cwd();
const GALLERY_DATA = 'js/gallery-data.js';
const ANIME_DATA = 'js/anime-data.js';
const LIFE_DATA = 'data/life.json';
const JOURNAL_DIR = 'content/life/journal';
const IMAGE_INDEX_OUT = 'data/image-index.json';
const JOURNAL_INDEX_OUT = 'data/journal-index.json';

function loadJsGlobal(file, name) {
  const code = fs.readFileSync(file, 'utf8');
  return vm.runInNewContext(`${code}\n;${name};`, Object.create(null), { filename: file, timeout: 1000 });
}

// "../assets/a.webp" / "./assets/a.webp" / "/assets/a.webp" → "assets/a.webp"
function normalizeSrc(src) {
  return String(src || '').trim().replace(/\\/g, '/').replace(/^(\.\.?\/)+/, '').replace(/^\/+/, '');
}

const dimensionCache = new Map();
async function readSize(src) {
  if (dimensionCache.has(src)) return dimensionCache.get(src);
  let size = null;
  try {
    const meta = await sharp(path.join(ROOT, src)).metadata();
    if (meta.width && meta.height) size = { width: meta.width, height: meta.height };
  } catch {
    size = null;
  }
  dimensionCache.set(src, size);
  return size;
}

function slug(text) {
  return String(text).replace(/\.[^.]+$/, '').replace(/[^a-zA-Z0-9_-]+/g, '-').replace(/^-+|-+$/g, '') || 'image';
}

const images = [];
const bySrc = new Map();
const missing = [];

function addRef(item, ref) {
  if (!ref) return;
  const exists = item.refs.some(r => r.type === ref.type && r.id === ref.id);
  if (!exists) item.refs.push(ref);
}

// 已收录的路径只追加引用；新路径读取尺寸后入库。读不到的文件跳过并提示。
async function addImage(rawSrc, fields, ref) {
  const src = normalizeSrc(rawSrc);
  if (!src) return null;
  if (bySrc.has(src)) {
    const item = bySrc.get(src);
    addRef(item, ref);
    return item;
  }
  const size = fields.width && fields.height ? { width: fields.width, height: fields.height } : await readSize(src);
  if (!size) { missing.push(src); return null; }
  const item = {
    id: fields.id,
    title: fields.title || slug(path.basename(src)),
    src,
    thumb: normalizeSrc(fields.thumb) || src,
    category: fields.category || 'other',
    album: fields.album || '',
    tags: Array.isArray(fields.tags) ? fields.tags : [],
    note: fields.note || '',
    width: size.width,
    height: size.height,
    order: 0,
    updatedAt: fields.updatedAt || '',
    date: fields.date || '',
    source: fields.source,
    refs: [],
  };
  addRef(item, ref);
  images.push(item);
  bySrc.set(src, item);
  return item;
}

// ---------- 1. 原画廊（保持原顺序与元数据） ----------
const galleryData = loadJsGlobal(GALLERY_DATA, 'galleryData') || [];
for (const g of [...galleryData].sort((a, b) => (a.order || 0) - (b.order || 0))) {
  await addImage(g.src, { ...g, source: 'gallery' }, null);
}
const galleryCount = images.length;

// ---------- 2. 动漫详情页图片 ----------
const animeData = loadJsGlobal(ANIME_DATA, 'animeData') || {};
const animeEntries = Object.entries(animeData)
  .sort(([, a], [, b]) => (a.order ?? 999) - (b.order ?? 999));
for (const [id, anime] of animeEntries) {
  const ref = { type: 'anime', id, title: anime.title || id, href: `html/anime-detail.html?id=${encodeURIComponent(id)}` };
  const list = [anime.image, ...(Array.isArray(anime.gallery) ? anime.gallery : [])].filter(Boolean);
  let n = 0;
  for (const src of list) {
    const isCover = normalizeSrc(src) === normalizeSrc(anime.image);
    if (!isCover) n += 1;
    await addImage(src, {
      id: `anime-art-${slug(path.basename(normalizeSrc(src)))}`,
      title: isCover ? `${anime.title} · 封面` : `${anime.title} · 插图 ${n}`,
      category: 'anime',
      album: anime.title || '',
      tags: ['动漫', '作品插图'],
      source: 'anime',
    }, ref);
  }
}

// ---------- 3. data/life.json ----------
let life = {};
try { life = JSON.parse(fs.readFileSync(LIFE_DATA, 'utf8')); } catch (err) {
  console.warn(`⚠ 无法读取 ${LIFE_DATA}：${err.message}`);
}
const lifeSources = [
  ['journey', 'journey', 'life'],
  ['cards', 'cards', 'collection'],
  ['devices', 'devices', 'collection'],
  ['works', 'works', 'works'],
];
for (const [key, source, category] of lifeSources) {
  for (const entry of Array.isArray(life[key]) ? life[key] : []) {
    if (!entry || entry.inGallery === false) continue;
    const list = [entry.image, entry.cover, ...(Array.isArray(entry.images) ? entry.images : [])].filter(Boolean);
    const ref = { type: source, id: String(entry.id || entry.title || ''), title: entry.title || entry.name || '' };
    for (const src of list) {
      await addImage(src, {
        id: `${source}-${slug(path.basename(normalizeSrc(src)))}`,
        title: entry.title || entry.name || '',
        category,
        album: entry.title || entry.name || '',
        tags: Array.isArray(entry.tags) ? entry.tags : [],
        note: entry.summary || '',
        date: entry.date || '',
        updatedAt: entry.date || '',
        source,
      }, ref);
    }
  }
}

// ---------- 4. 日记 ----------
function parseJournal(file) {
  const raw = fs.readFileSync(file, 'utf8').replace(/\r\n?/g, '\n');
  const id = path.basename(file, '.md');
  const meta = { title: '', date: '', summary: '', tags: [], cover: '' };
  const body = [];
  for (const line of raw.split('\n')) {
    const t = line.trim();
    if (!meta.title && t.startsWith('# ')) { meta.title = t.slice(2).trim(); continue; }
    const m = t.match(/^@(date|summary|tags|cover):\s*(.*)$/);
    if (m) {
      if (m[1] === 'tags') meta.tags = m[2].split(/[,，]/).map(s => s.trim()).filter(Boolean);
      else meta[m[1]] = m[2].trim();
      continue;
    }
    body.push(line);
  }
  if (!meta.date) meta.date = (id.match(/^(\d{4}-\d{2}-\d{2})/) || [])[1] || '';
  if (!meta.summary) {
    const para = body.join('\n').split(/\n\s*\n/)
      .map(p => p.trim())
      .find(p => p && !/^(#|!\[|```|\||- |\* )/.test(p)) || '';
    const text = para.replace(/\s+/g, ' ').replace(/\*\*|`/g, '');
    meta.summary = text.length > 120 ? `${text.slice(0, 120)}…` : text;
  }
  return {
    id,
    title: meta.title || id,
    date: meta.date,
    summary: meta.summary,
    tags: meta.tags,
    cover: normalizeSrc(meta.cover),
    file: `${JOURNAL_DIR}/${path.basename(file)}`,
  };
}

const journal = fs.existsSync(JOURNAL_DIR)
  ? fs.readdirSync(JOURNAL_DIR)
    .filter(name => name.endsWith('.md') && !name.startsWith('_') && name.toLowerCase() !== 'readme.md')
    .map(name => parseJournal(path.join(JOURNAL_DIR, name)))
  : [];
// 日期倒序；无日期的排在最后，同日按 id 排序保证稳定
journal.sort((a, b) => (b.date || '').localeCompare(a.date || '') || a.id.localeCompare(b.id));

for (const entry of journal) {
  if (!entry.cover) continue;
  await addImage(entry.cover, {
    id: `journal-${slug(path.basename(entry.cover))}`,
    title: entry.title,
    category: 'life',
    album: entry.title,
    tags: entry.tags,
    note: entry.summary,
    date: entry.date,
    updatedAt: entry.date,
    source: 'journal',
  }, { type: 'journal', id: entry.id, title: entry.title });
}

// ---------- 输出 ----------
// 原画廊保持原 order；其他来源依次排在后面
const usedIds = new Set();
images.forEach((item, index) => {
  item.order = index + 1;
  let id = item.id || `image-${index + 1}`;
  while (usedIds.has(id)) id = `${item.id}-${index + 1}`;
  usedIds.add(id);
  item.id = id;
});

const sourceCounts = images.reduce((acc, item) => ((acc[item.source] = (acc[item.source] || 0) + 1), acc), {});
fs.writeFileSync(IMAGE_INDEX_OUT, `${JSON.stringify({ version: 1, count: images.length, sources: sourceCounts, images }, null, 2)}\n`);
fs.writeFileSync(JOURNAL_INDEX_OUT, `${JSON.stringify({ version: 1, count: journal.length, entries: journal }, null, 2)}\n`);

console.log(`✓ ${IMAGE_INDEX_OUT}：${images.length} 张图片（画廊 ${galleryCount}，其他来源 ${images.length - galleryCount}）`);
console.log(`  来源分布：${Object.entries(sourceCounts).map(([k, v]) => `${k} ${v}`).join('，')}`);
console.log(`✓ ${JOURNAL_INDEX_OUT}：${journal.length} 篇日记`);
if (missing.length) console.warn(`⚠ 跳过 ${missing.length} 个无法读取的图片：\n  ${missing.join('\n  ')}`);
