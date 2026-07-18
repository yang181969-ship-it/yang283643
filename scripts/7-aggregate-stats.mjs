import fs from 'fs';
import path from 'path';
import vm from 'vm';

// ============================================================
// 站点统计聚合 → data/stats.json + data/site-meta.json
//
// 读源:
//   - data/notes-index.json        (笔记)
//   - js/anime-data.js             (番剧,vm sandbox 取 animeData)
//   - data/gallery-data.js | data/gallery.json (画廊,自动探测)
//   - data/updates-index.json      (更新,需先跑 aggregate:updates)
//   - data/playlist.json           (音乐与艺术家统计的真实数据源)
//   - data/comments-stats.json     (公开留言聚合,可选)
//
// 写出:
//   - data/stats.json   ── snapshots[] 累积式 + breakdowns(7 张卡数据源)
//   - data/site-meta.json ── 总条目/累计天数/最新更新等单点指标
//
// 评论统计由本地 data/comments-stats.json 提供(可选),不在线 fetch
// ============================================================

const SITE_BIRTHDAY = '2026-04-13';
const NEW_TAG_DAYS  = 7;

const NOTES_INDEX_PATH    = './data/notes-index.json';
const ANIME_DATA_PATH     = './js/anime-data.js';
const GALLERY_CANDIDATES  = ['./data/gallery-data.js', './js/gallery-data.js', './data/gallery.json'];
const UPDATES_INDEX_PATH  = './data/updates-index.json';
const PLAYLIST_PATH       = './data/playlist.json';
const COMMENTS_STATS_PATH = './data/comments-stats.json';

const STATS_OUTPUT        = './data/stats.json';
const META_OUTPUT         = './data/site-meta.json';

// ============================================================
// 工具
// ============================================================
function safeReadJson(filePath, fallback = null) {
  if (!fs.existsSync(filePath)) return fallback;
  try { return JSON.parse(fs.readFileSync(filePath, 'utf-8')); }
  catch (err) { console.warn(`⚠ ${filePath} 解析失败:`, err.message); return fallback; }
}

function addCount(bucket, key, amount = 1) {
  const name = String(key || '').trim() || '其他';
  const value = Number(amount) || 0;
  if (!value) return;
  bucket[name] = (bucket[name] || 0) + value;
}

function toItems(bucket, limit = 8) {
  const sorted = Object.entries(bucket)
    .map(([name, value]) => [name, Number(value) || 0])
    .filter(([, value]) => value > 0)
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0], 'zh-CN'));

  if (sorted.length <= limit) {
    return sorted.map(([name, value]) => ({ name, value }));
  }

  const head = sorted.slice(0, limit - 1);
  const rest = sorted.slice(limit - 1).reduce((sum, [, value]) => sum + value, 0);
  return [
    ...head.map(([name, value]) => ({ name, value })),
    { name: '其他', value: rest },
  ];
}

function makeChild(id, name, bucket, unit = '项') {
  const items = toItems(bucket);
  const total = items.reduce((sum, item) => sum + item.value, 0);
  if (!total || !items.length) return null;
  return { id, name, total, unit, items };
}

function makeGroup(id, name, children) {
  const validChildren = children.filter(Boolean).filter(child => child.total > 0 && child.items?.length);
  if (!validChildren.length) return null;
  return { id, name, children: validChildren };
}

function stripMarkdown(text) {
  return String(text || '')
    .replace(/---[\s\S]*?---/g, ' ')
    .replace(/```[\s\S]*?```/g, ' ')
    .replace(/`[^`]*`/g, ' ')
    .replace(/!\[[^\]]*\]\([^)]*\)/g, ' ')
    .replace(/\[[^\]]*\]\([^)]*\)/g, ' ')
    .replace(/[>#*_~|\-]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function countTextChars(text) {
  return stripMarkdown(text).replace(/\s/g, '').length;
}

function countFileChars(filePath) {
  if (!filePath) return 0;
  const resolved = path.resolve(String(filePath));
  if (!fs.existsSync(resolved)) return 0;
  return countTextChars(fs.readFileSync(resolved, 'utf-8'));
}

function slugify(value) {
  const raw = String(value || 'item').trim();
  return encodeURIComponent(raw).replace(/%/g, '').toLowerCase() || 'item';
}

function noteMajorCategory(note) {
  const explicit = note.major || note.group || note.section;
  if (explicit) return explicit;

  const file = String(note.file || '').replace(/\\/g, '/').toLowerCase();
  if (file.includes('/math/')) return '数学';
  if (file.includes('/physics/')) return '物理';
  if (file.includes('/tools/') || file.includes('/tool/')) return '工具';
  if (file.includes('/site/') || file.includes('/website/')) return '网站';
  if (file.includes('/english/')) return '英语';
  if (file.includes('/diary/')) return '日记';
  return '杂谈';
}

function noteSubCategory(note) {
  return note.subcategory || note.category || '其他';
}

function animeGenres(anime) {
  if (Array.isArray(anime.genres)) return anime.genres.map(String).filter(Boolean);
  if (Array.isArray(anime.tags)) return anime.tags.map(String).filter(Boolean);

  const info = Array.isArray(anime.info) ? anime.info : [];
  const line = info.find(item => /题材[:：]/.test(String(item)));
  if (!line) return [];

  const raw = String(line).replace(/^.*?题材[:：]\s*/, '');
  return raw.split(/[\/、,，]/).map(item => item.trim()).filter(Boolean);
}

function animeWatchStatus(anime) {
  return anime.watchStatus || anime.status || anime.state || '';
}

function animeWorkStatus(anime) {
  return anime.workStatus || anime.releaseStatus || anime.airStatus || '';
}

function animeYear(anime) {
  const value = anime.year || anime.releaseYear || anime.date || anime.updateDate || '';
  const match = String(value).match(/^(\d{4})/);
  return match ? match[1] : '';
}

function updateTypeName(update) {
  return update.primary || update.type || update.category || '其他';
}

function imageFormat(src) {
  return path.extname(String(src || '').split(/[?#]/)[0]).replace('.', '').toLowerCase() || '其他';
}

function loadJsGlobal(filePath, varName) {
  // 用 vm sandbox 取出 const/let/var {varName} = ...
  // 注意:Node vm 里 const/let 不挂 sandbox(块作用域),所以包一层 IIFE 把变量
  // 显式赋到 sandbox 上,这样源文件零修改即可读
  if (!fs.existsSync(filePath)) return null;
  const code = fs.readFileSync(filePath, 'utf-8');
  const wrapped = `(function () {\n${code}\n;this.__exported = (typeof ${varName} !== 'undefined') ? ${varName} : null;\n}).call(this);`;
  const sandbox = {};
  try {
    vm.createContext(sandbox);
    vm.runInContext(wrapped, sandbox, { timeout: 1000 });
    return sandbox.__exported ?? null;
  } catch (err) {
    console.warn(`⚠ ${filePath} 执行失败:`, err.message);
    return null;
  }
}

function loadGallery() {
  for (const p of GALLERY_CANDIDATES) {
    if (!fs.existsSync(p)) continue;
    if (p.endsWith('.json')) return safeReadJson(p, []);
    const data = loadJsGlobal(p, 'galleryData');
    if (Array.isArray(data)) return data;
  }
  return null;
}

function ymKey(dateStr) {
  // "2026-05-06" → "2026-05"
  const m = String(dateStr || '').match(/^(\d{4})-(\d{2})/);
  return m ? `${m[1]}-${m[2]}` : null;
}

function daysSince(dateStr) {
  if (!dateStr) return 0;
  const t = new Date(dateStr).getTime();
  if (Number.isNaN(t)) return 0;
  return Math.max(0, Math.floor((Date.now() - t) / 86400000));
}

function todayISO() {
  return new Date().toISOString().slice(0, 10);
}

function thisMonthKey() {
  return todayISO().slice(0, 7);
}

function toISODate(value) {
  if (!value) return '';
  const text = String(value).trim();
  const direct = text.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (direct) return `${direct[1]}-${direct[2]}-${direct[3]}`;
  const time = new Date(text).getTime();
  if (Number.isNaN(time)) return '';
  return new Date(time).toISOString().slice(0, 10);
}

function fileDateFromSrc(src) {
  if (!src) return '';
  const cleanSrc = String(src).replace(/\\/g, '/').replace(/^(\.\.\/)+/, '').split(/[?#]/)[0];
  const filePath = path.resolve(cleanSrc);
  if (!fs.existsSync(filePath)) return '';
  try {
    return fs.statSync(filePath).mtime.toISOString().slice(0, 10);
  } catch {
    return '';
  }
}

function filenameFromSrc(src) {
  const cleanSrc = String(src || '').replace(/\\/g, '/').split(/[?#]/)[0];
  return cleanSrc.split('/').filter(Boolean).pop() || '图片';
}

function galleryCategoryLabel(item) {
  const name = galleryCategoryName(item);
  if (name === '动漫') return '动漫图';
  if (name === '现实') return '照片';
  return '图片';
}

function galleryCategoryName(item) {
  const category = typeof item === 'string' ? item : item?.category;
  const src = typeof item === 'string' ? '' : item?.src;
  const raw = String(category || '').trim();
  const normalized = raw.toLowerCase();
  const cleanSrc = String(src || '').replace(/\\/g, '/').toLowerCase();

  if (normalized === 'anime' || raw === '动漫' || cleanSrc.includes('/anime/')) return '动漫';
  if (normalized === 'real' || raw === '现实' || raw === '真实' || raw === '照片' || cleanSrc.includes('/real/')) return '现实';
  return raw || '其他';
}

function galleryTags(item, categoryName) {
  const tags = Array.isArray(item.tags) ? item.tags : [];
  const blocked = new Set([
    categoryName,
    '动漫',
    '现实',
    '真实',
    '照片',
    'anime',
    'real',
    '画廊',
    '图片',
  ]);
  const seen = new Set();

  const values = tags
    .map(tag => String(tag || '').trim())
    .filter(tag => {
      if (!tag || blocked.has(tag) || seen.has(tag)) return false;
      seen.add(tag);
      return true;
    });

  return values.length ? values : ['未标注'];
}

function playlistTracks(data) {
  if (Array.isArray(data)) return data;
  if (Array.isArray(data?.tracks)) return data.tracks;
  return [];
}

function normalizeArtistName(value) {
  return String(value ?? '').trim().replace(/\s+/g, ' ') || '未知歌手';
}

function buildMusicArtistStats(tracks) {
  const counts = new Map();
  tracks.forEach(track => {
    const artist = normalizeArtistName(track?.artist);
    counts.set(artist, (counts.get(artist) || 0) + 1);
  });

  const collator = new Intl.Collator('zh-CN');
  return [...counts.entries()]
    .sort(([nameA, countA], [nameB, countB]) =>
      countB - countA
      || collator.compare(nameA, nameB)
      || (nameA < nameB ? -1 : nameA > nameB ? 1 : 0)
    )
    .map(([name, count]) => ({ name, count }));
}

function isNonNegativeNumber(value) {
  return Number.isFinite(value) && value >= 0;
}

function loadCommentsStats() {
  if (!fs.existsSync(COMMENTS_STATS_PATH)) {
    console.warn(`⚠ ${COMMENTS_STATS_PATH} 不存在,留言统计保持为空;可运行 npm run stats:comments 同步`);
    return null;
  }

  const data = safeReadJson(COMMENTS_STATS_PATH, null);
  const summaryKeys = ['total', 'topLevel', 'replies', 'likes', 'today'];
  const validGroups = Array.isArray(data?.groups)
    && data.groups.every(group =>
      group
      && typeof group === 'object'
      && Array.isArray(group.items)
      && group.items.every(item =>
        item
        && typeof item === 'object'
        && String(item.name || '').trim()
        && isNonNegativeNumber(item.value)
      )
    );
  const valid = data
    && typeof data === 'object'
    && summaryKeys.every(key => isNonNegativeNumber(data.summary?.[key]))
    && isNonNegativeNumber(data.roles?.guest)
    && isNonNegativeNumber(data.roles?.admin)
    && validGroups;

  if (!valid) {
    console.warn(`⚠ ${COMMENTS_STATS_PATH} 结构无效,留言统计保持为空`);
    return null;
  }
  return data;
}

function compactChange(item, order) {
  const date = toISODate(item.date);
  const title = String(item.title || '').trim();
  const type = String(item.type || '').trim();
  if (!date || !title || !type) return null;

  return {
    date,
    title,
    type,
    page: item.page || '',
    href: item.href || '',
    order,
  };
}

function buildRecentChanges({ notes, animeData, animeIds, gallery, updates, tracks }) {
  const changes = [];

  updates.forEach((item, index) => {
    changes.push(compactChange({
      date: item.date,
      title: item.title || '站点更新',
      type: item.type || '更新',
      page: item.page || 'update',
    }, 100000 + index));
  });

  notes.forEach((item, index) => {
    changes.push(compactChange({
      date: item.date,
      title: `新增笔记：${item.title || filenameFromSrc(item.file)}`,
      type: '笔记',
      page: 'notes',
    }, 200000 + index));
  });

  animeIds.forEach((id, index) => {
    const item = animeData[id] || {};
    changes.push(compactChange({
      date: item.updateDate || item.date || item.addedAt,
      title: `新增动漫：${item.title || id}`,
      type: '动漫',
      page: 'anime',
    }, 300000 + index));
  });

  gallery.forEach((item, index) => {
    const label = galleryCategoryLabel(item);
    const name = filenameFromSrc(item.src);
    changes.push(compactChange({
      date: item.date || item.addedAt || item.updateDate || fileDateFromSrc(item.src),
      title: `新增${label}：${name}`,
      type: '画廊',
      page: 'gallery',
    }, 400000 + (Number(item.order) || index)));
  });

  tracks.forEach((item, index) => {
    const title = item.artist
      ? `${item.title || filenameFromSrc(item.src)} - ${item.artist}`
      : `${item.title || filenameFromSrc(item.src)}`;
    changes.push(compactChange({
      date: item.dateAdded || item.addedAt || item.date || fileDateFromSrc(item.src),
      title: `新增音乐：${title}`,
      type: '音乐',
      page: 'home',
    }, 500000 + index));
  });

  return changes
    .filter(Boolean)
    .sort((a, b) => b.date.localeCompare(a.date) || b.order - a.order)
    .map(({ order, ...item }) => item);
}

// ============================================================
// 主流程
// ============================================================
console.log('▶ 站点统计聚合 ──────────────');

const notes      = safeReadJson(NOTES_INDEX_PATH, []);
const animeData  = loadJsGlobal(ANIME_DATA_PATH, 'animeData') || {};
const animeIds   = Object.keys(animeData);
const gallery    = loadGallery() || [];
const updates    = safeReadJson(UPDATES_INDEX_PATH, []);
const tracks     = playlistTracks(safeReadJson(PLAYLIST_PATH, { tracks: [] }));
const musicArtists = buildMusicArtistStats(tracks);
const commentsStats = loadCommentsStats();
const prevStats  = safeReadJson(STATS_OUTPUT, { snapshots: [], breakdowns: {} });

console.log(`  笔记:${notes.length}  番剧:${animeIds.length}  画廊:${gallery.length}  更新:${updates.length}  音乐:${tracks.length}`);

// ============================================================
// breakdowns:7 张详情卡的源数据
// 每个 breakdown 都是 [{label, value}] 的扁平数组,前端拿去画饼+图例
// ============================================================
const breakdowns = {};

// 1. 笔记按学科 ───────────────────────────────
{
  const bucket = {};
  notes.forEach(n => {
    const k = n.category || '未分类';
    bucket[k] = (bucket[k] || 0) + 1;
  });
  breakdowns.notesByCategory = toPie(bucket);
}

// 2. 番剧按状态 ───────────────────────────────
// Phase K 之前 animeData 没 status 字段,降级:用 updateDate 推断
//   ≤ 30 天 → 在追,> 30 天 → 看完
//   Phase K 加完 status 字段后,这段会自动用真值
{
  const bucket = {};
  animeIds.forEach(id => {
    const a = animeData[id];
    let status = a.status; // Phase K 后的字段
    if (!status) {
      const d = daysSince(a.updateDate);
      status = d <= 30 ? '在追' : '看完';
    }
    bucket[status] = (bucket[status] || 0) + 1;
  });
  breakdowns.animeByStatus = toPie(bucket);
}

// 3. 番剧按题材 Top N ─────────────────────────
// 题材在 info[0]:"题材:奇幻 / 公路 / 旅行"
{
  const bucket = {};
  animeIds.forEach(id => {
    const info0 = (animeData[id].info || [])[0] || '';
    const m = info0.match(/题材[:：]\s*(.+)/);
    if (!m) return;
    m[1].split(/[\/、,，]/).map(t => t.trim()).filter(Boolean)
      .forEach(t => { bucket[t] = (bucket[t] || 0) + 1; });
  });
  // 取 Top 8,其余合并 "其他"
  const sorted = Object.entries(bucket).sort((a, b) => b[1] - a[1]);
  const top = sorted.slice(0, 8);
  const rest = sorted.slice(8).reduce((s, [, v]) => s + v, 0);
  if (rest) top.push(['其他', rest]);
  breakdowns.animeByTag = top.map(([label, value]) => ({ label, value }));
}

// 4. 画廊按分类 ───────────────────────────────
// 优先读 g.category,没有则按 src 路径推断 (assets/gallery/real/, /anime/)
{
  const bucket = {};
  gallery.forEach(g => {
    addCount(bucket, galleryCategoryName(g));
  });
  breakdowns.galleryByCategory = toPie(bucket);
}

// 5. 更新按月份 ───────────────────────────────
{
  const bucket = {};
  updates.forEach(u => {
    const k = ymKey(u.date);
    if (k) bucket[k] = (bucket[k] || 0) + 1;
  });
  // 按月份排序,不限 Top
  const sorted = Object.entries(bucket).sort((a, b) => a[0].localeCompare(b[0]));
  breakdowns.updatesByMonth = sorted.map(([label, value]) => ({ label, value }));
}

// 6. 音乐 Top 艺术家 ───────────────────────────
// 直接从 playlist.json 聚合;联合艺人名称保持为一个整体
breakdowns.musicTopArtists = musicArtists
  .slice(0, 8)
  .map(({ name, count }) => ({ label: name, value: count }));

// 7. 评论分布 ─────────────────────────────────
// 只读取本地公开聚合文件,aggregate:stats 本身不访问网络
breakdowns.commentsByRole = commentsStats
  ? [
      { label: '访客', value: commentsStats.roles.guest },
      { label: '站长', value: commentsStats.roles.admin },
    ]
  : [];

const recentChanges = buildRecentChanges({
  notes,
  animeData,
  animeIds,
  gallery,
  updates,
  tracks,
});

// ============================================================
// dataCenter:统计页左下「网站数据中心」
// 一级/二级/三级数据都在构建期生成,浏览器端只负责渲染与切换
// ============================================================
const dataCenterGroups = [];

// 总览 ───────────────────────────────────────
{
  const content = {};
  addCount(content, '笔记', notes.length);
  addCount(content, '更新日志', updates.length);
  addCount(content, '动漫', animeIds.length);
  addCount(content, '画廊图片', gallery.length);
  addCount(content, '音乐', tracks.length);

  const updateTypes = {};
  updates.forEach(update => addCount(updateTypes, updateTypeName(update)));

  dataCenterGroups.push(makeGroup('overview', '总览', [
    makeChild('overview-content', '内容构成', content),
    makeChild('overview-updates', '更新概况', updateTypes, '条'),
  ]));
}

// 笔记 ───────────────────────────────────────
{
  const buckets = {};
  notes.forEach(note => {
    const major = noteMajorCategory(note);
    buckets[major] ||= {};
    addCount(buckets[major], noteSubCategory(note));
  });

  dataCenterGroups.push(makeGroup(
    'notes',
    '笔记',
    Object.entries(buckets).map(([major, bucket]) =>
      makeChild(`notes-${slugify(major)}`, major, bucket, '篇')
    )
  ));
}

// 动漫 ───────────────────────────────────────
{
  const watchStatus = {};
  const workStatus = {};
  const genres = {};
  const years = {};

  animeIds.forEach(id => {
    const anime = animeData[id] || {};
    const watch = animeWatchStatus(anime);
    const work = animeWorkStatus(anime);
    const year = animeYear(anime);

    if (watch) addCount(watchStatus, watch);
    if (work) addCount(workStatus, work);
    if (year) addCount(years, year);
    animeGenres(anime).forEach(genre => addCount(genres, genre));
  });

  dataCenterGroups.push(makeGroup('anime', '动漫', [
    makeChild('anime-watch-status', '观看状态', watchStatus, '部'),
    makeChild('anime-work-status', '作品状态', workStatus, '部'),
    makeChild('anime-genres', '题材分布', genres, '部'),
    makeChild('anime-years', '年份分布', years, '部'),
  ]));
}

// 画廊 ───────────────────────────────────────
{
  const animeTags = {};
  const realTags = {};

  gallery.forEach(item => {
    const category = galleryCategoryName(item);
    const bucket = category === '动漫'
      ? animeTags
      : category === '现实'
        ? realTags
        : null;

    if (!bucket) return;
    galleryTags(item, category).forEach(tag => addCount(bucket, tag));
  });

  dataCenterGroups.push(makeGroup('gallery', '画廊', [
    makeChild('gallery-anime', '动漫', animeTags, '次'),
    makeChild('gallery-real', '现实', realTags, '次'),
  ]));
}

// 资源 ───────────────────────────────────────
{
  const galleryCategories = {};
  const musicArtistBucket = {};
  const imageFormats = {};

  gallery.forEach(item => {
    addCount(galleryCategories, galleryCategoryName(item));
    addCount(imageFormats, imageFormat(item.src));
  });
  musicArtists.forEach(({ name, count }) => addCount(musicArtistBucket, name, count));

  dataCenterGroups.push(makeGroup('resources', '资源', [
    makeChild('resources-gallery', '画廊', galleryCategories, '张'),
    makeChild('resources-music', '音乐', musicArtistBucket, '首'),
    makeChild('resources-image-format', '图片格式', imageFormats, '张'),
  ]));
}

// 写作 ───────────────────────────────────────
{
  const totalWords = {};
  const noteWords = {};
  const updateWords = {};
  const animeWords = {};

  notes.forEach(note => {
    const count = countFileChars(note.file);
    if (!count) return;
    addCount(totalWords, '笔记字数', count);
    addCount(noteWords, noteMajorCategory(note), count);
  });

  updates.forEach(update => {
    const count = countFileChars(update.file);
    if (!count) return;
    addCount(totalWords, '更新日志字数', count);
    addCount(updateWords, updateTypeName(update), count);
  });

  animeIds.forEach(id => {
    const anime = animeData[id] || {};
    const count = countTextChars([anime.description, ...(anime.info || [])].join(' '));
    if (!count) return;
    addCount(totalWords, '动漫详情字数', count);
    addCount(animeWords, animeWatchStatus(anime) || '其他', count);
  });

  dataCenterGroups.push(makeGroup('writing', '写作', [
    makeChild('writing-total', '总字数构成', totalWords, '字'),
    makeChild('writing-notes', '笔记字数', noteWords, '字'),
    makeChild('writing-updates', '更新日志字数', updateWords, '字'),
    makeChild('writing-anime', '动漫详情字数', animeWords, '字'),
  ]));
}

// 留言:仅在本地公开聚合文件有效时启用,普通构建不依赖在线接口
{
  if (commentsStats) {
    dataCenterGroups.push(makeGroup('comments', '留言', commentsStats.groups.map(group =>
      makeChild(
        group.id || `comments-${slugify(group.name)}`,
        group.name || '留言',
        Object.fromEntries((group.items || []).map(item => [item.name, item.value])),
        group.unit || '条'
      )
    )));
  }
}

const dataCenter = {
  groups: dataCenterGroups.filter(Boolean),
};

// ============================================================
// snapshots:月度累积快照(用于顶部堆叠柱+累计折线)
// 同月重复跑会原地覆盖,不会重复累加
// ============================================================
const currentMonth = thisMonthKey();
const todaySnapshot = {
  date:    todayISO(),
  month:   currentMonth,
  notes:   notes.length,
  anime:   animeIds.length,
  gallery: gallery.length,
  updates: updates.length,
  total:   notes.length + animeIds.length + gallery.length + updates.length,
};

const snapshots = (prevStats.snapshots || []).filter(s => s.month !== currentMonth);
snapshots.push(todaySnapshot);
snapshots.sort((a, b) => a.month.localeCompare(b.month));

// ============================================================
// site-meta:Hero 区单点指标
// ============================================================
const allDates = [
  ...notes.map(n => n.date),
  ...animeIds.map(id => animeData[id].updateDate),
  ...gallery.map(g => g.date || fileDateFromSrc(g.src)),
  ...tracks.map(t => t.dateAdded || t.addedAt || t.date || fileDateFromSrc(t.src)),
  ...updates.map(u => u.date),
].filter(Boolean).sort();

const newAnime = animeIds.filter(id => daysSince(animeData[id].updateDate) <= NEW_TAG_DAYS).length;

const siteMeta = {
  generatedAt:    new Date().toISOString(),
  siteBirthday:   SITE_BIRTHDAY,
  totalDays:      Math.max(1, daysSince(SITE_BIRTHDAY)),
  totalContent:   notes.length + animeIds.length + gallery.length + updates.length,
  totals: {
    notes:   notes.length,
    anime:   animeIds.length,
    gallery: gallery.length,
    updates: updates.length,
    music: tracks.length,
    musicArtists: musicArtists.length,
  },
  latestUpdate:   allDates[allDates.length - 1] || '',
  newAnimeCount:  newAnime,
};

// ============================================================
// 写出
// ============================================================
fs.mkdirSync(path.dirname(STATS_OUTPUT), { recursive: true });

fs.writeFileSync(
  STATS_OUTPUT,
  JSON.stringify({ snapshots, breakdowns, dataCenter, recentChanges, generatedAt: siteMeta.generatedAt }, null, 2) + '\n',
  'utf-8'
);
fs.writeFileSync(
  META_OUTPUT,
  JSON.stringify(siteMeta, null, 2) + '\n',
  'utf-8'
);

console.log(`✓ 已写入 ${STATS_OUTPUT}`);
console.log(`✓ 已写入 ${META_OUTPUT}`);
console.log(`  快照数:${snapshots.length}  最新月份:${currentMonth}`);
console.log(`  最近变化:${recentChanges.length} 条`);
console.log(`  dataCenter:${dataCenter.groups.length} 组`);
console.log(`  breakdowns:`);
Object.entries(breakdowns).forEach(([k, v]) => {
  if (Array.isArray(v)) console.log(`    ${k}: ${v.length} 项`);
  else console.log(`    ${k}: <live>`);
});

// ============================================================
function toPie(bucket) {
  return Object.entries(bucket)
    .sort((a, b) => b[1] - a[1])
    .map(([label, value]) => ({ label, value }));
}
