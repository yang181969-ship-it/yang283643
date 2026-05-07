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
//   - data/music-stats.json        (音乐,可选,直接透传)
//
// 写出:
//   - data/stats.json   ── snapshots[] 累积式 + breakdowns(7 张卡数据源)
//   - data/site-meta.json ── 总条目/累计天数/最新更新等单点指标
//
// 评论/Waline 数据不在这聚合,前端 stats.js 实时拉(月度快照对评论意义不大)
// ============================================================

const SITE_BIRTHDAY = '2026-04-13';
const NEW_TAG_DAYS  = 7;

const NOTES_INDEX_PATH    = './data/notes-index.json';
const ANIME_DATA_PATH     = './js/anime-data.js';
const GALLERY_CANDIDATES  = ['./data/gallery-data.js', './js/gallery-data.js', './data/gallery.json'];
const UPDATES_INDEX_PATH  = './data/updates-index.json';
const MUSIC_STATS_PATH    = './data/music-stats.json';

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

// ============================================================
// 主流程
// ============================================================
console.log('▶ 站点统计聚合 ──────────────');

const notes      = safeReadJson(NOTES_INDEX_PATH, []);
const animeData  = loadJsGlobal(ANIME_DATA_PATH, 'animeData') || {};
const animeIds   = Object.keys(animeData);
const gallery    = loadGallery() || [];
const updates    = safeReadJson(UPDATES_INDEX_PATH, []);
const musicStats = safeReadJson(MUSIC_STATS_PATH, null);
const prevStats  = safeReadJson(STATS_OUTPUT, { snapshots: [], breakdowns: {} });

console.log(`  笔记:${notes.length}  番剧:${animeIds.length}  画廊:${gallery.length}  更新:${updates.length}`);

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
    let cat = g.category;
    if (!cat) {
      if (/\/real\//.test(g.src || '')) cat = '真实';
      else if (/\/anime\//.test(g.src || '')) cat = '动漫';
      else cat = '其他';
    }
    bucket[cat] = (bucket[cat] || 0) + 1;
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
// 直接透传 music-stats.json 的 topArtists 字段(由 add-music.mjs 维护)
// 没有数据源就给占位,前端会渲染 "暂无数据" 状态
{
  const arr = musicStats?.topArtists;
  breakdowns.musicTopArtists = Array.isArray(arr) && arr.length
    ? arr.slice(0, 8).map(x => ({ label: x.name || x.label, value: x.count ?? x.value ?? 0 }))
    : [];
}

// 7. 评论分布 ─────────────────────────────────
// 占位,前端 stats.js 在运行时 fetch Waline 后填充
// 这里只放一个标记,告诉前端要走 live-fetch
breakdowns.commentsByRole = { __live: 'waline-by-role' };

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
  ...gallery.map(g => g.date || ''),
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
  JSON.stringify({ snapshots, breakdowns, generatedAt: siteMeta.generatedAt }, null, 2) + '\n',
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
