import fs from 'fs';
import path from 'path';

// ========================================================
// 扫 content/updates/*.md → 解析 frontmatter + 标题 + 摘要
// → 推断缺失的 tags / primary → 输出富索引到 data/updates-index.json
//
// 老 md 零修改即可通过(用 @meta 关键词推断 tags),
// 新 md 可显式声明 @summary / @tags / @primary 来覆盖默认。
// ========================================================

const UPDATES_DIR = './content/updates';
const OUTPUT_PATH = './data/updates-index.json';

// ----- 5 种细分 tag,对应 chips 顺序 -----
// feature / visual / perf / fix / mobile
// → 大类(primary,给统计页饼图用): feature / optimization / fix

const META_KEYWORDS = [
  // 顺序敏感:先匹配的优先
  { tag: 'fix',     re: /修复|bug|fix|hotfix/i },
  { tag: 'perf',    re: /性能|加载|压缩|优化(?!.*视觉).*?(速度|响应)/ },
  { tag: 'mobile',  re: /移动端|手机|响应式|灵动岛/ },
  { tag: 'visual',  re: /视觉|界面|UI|主题|配色|样式|玻璃/ },
  { tag: 'feature', re: /新增|功能|加|上线/ },
];

const PRIMARY_OF = {
  feature: 'feature',
  fix:     'fix',
  visual:      'optimization',
  perf:        'optimization',
  mobile:      'optimization',
};

// ============================================================
// 解析单个 md 文件 → 元数据对象
// ============================================================
function parseUpdate(filePath) {
  const raw = fs.readFileSync(filePath, 'utf-8').replace(/\r\n/g, '\n');
  const lines = raw.split('\n');

  let title    = '';
  let category = '';
  let meta     = '';
  let date     = '';
  let summary  = '';
  let tags     = null;     // null = 未声明,等推断
  let primary  = null;
  const bodyLines = [];

  for (const line of lines) {
    const trimmed = line.trim();
    if (!title && trimmed.startsWith('# ')) {
      title = trimmed.replace(/^#\s+/, '').trim();
      continue;
    }
    if (trimmed.startsWith('@category:')) { category = trimmed.slice(10).trim(); continue; }
    if (trimmed.startsWith('@meta:'))     { meta     = trimmed.slice(6).trim();  continue; }
    if (trimmed.startsWith('@date:'))     { date     = trimmed.slice(6).trim();  continue; }
    if (trimmed.startsWith('@summary:'))  { summary  = trimmed.slice(9).trim();  continue; }
    if (trimmed.startsWith('@tags:')) {
      // 形如:  @tags: feature, mobile
      tags = trimmed.slice(6).split(',').map(s => s.trim()).filter(Boolean);
      continue;
    }
    if (trimmed.startsWith('@primary:')) { primary = trimmed.slice(9).trim(); continue; }
    bodyLines.push(line);
  }

  // 文件名兜底日期(2026-04-22.md → 2026-04-22)
  if (!date) {
    const m = path.basename(filePath, '.md').match(/^(\d{4}-\d{2}-\d{2})/);
    if (m) date = m[1];
  }

  // ----- 推断缺失字段 -----
  if (!tags || !tags.length) tags = inferTagsFromMeta(meta, title);
  if (!primary) primary = inferPrimary(tags);
  if (!summary) summary = extractSummary(bodyLines);

  return {
    file:     path.relative('.', filePath).replace(/\\/g, '/'),
    title:    title || '未命名更新',
    date:     date || '',
    category: category || '建站日志',
    meta:     meta || '',
    summary,
    tags,
    primary,
  };
}

// ============================================================
// @meta 关键词 → tags 数组(老 md fallback)
// ============================================================
function inferTagsFromMeta(meta, title) {
  const haystack = `${meta} ${title}`;
  const hits = [];
  for (const { tag, re } of META_KEYWORDS) {
    if (re.test(haystack)) hits.push(tag);
  }
  return hits.length ? hits : ['feature']; // 兜底:当作功能更新
}

// ============================================================
// tags → primary(三大类)
// fix > feature > optimization
// ============================================================
function inferPrimary(tags) {
  if (tags.includes('fix')) return 'fix';
  if (tags.includes('feature')) return 'feature';
  return 'optimization';
}

// ============================================================
// 从正文抽 1-2 句作为摘要(去标题/metadata/列表标号)
// ============================================================
function extractSummary(bodyLines) {
  const text = bodyLines
    .filter(l => {
      const t = l.trim();
      if (!t) return false;
      if (t.startsWith('#'))  return false;       // 标题
      if (t.startsWith('@'))  return false;       // metadata
      if (t.startsWith('---')) return false;      // 分割线
      if (t.startsWith('|'))  return false;       // 表格
      if (t.startsWith('```')) return false;      // 代码块
      if (t.startsWith('- ') || t.startsWith('* ')) return false; // 列表
      if (/^[一二三四五六七八九十]、|^\d+\./.test(t)) return false;
      return true;
    })
    .join(' ')
    .replace(/\*\*([^*]+)\*\*/g, '$1')   // 去粗体
    .replace(/`([^`]+)`/g, '$1')         // 去行内 code
    .replace(/\s+/g, ' ')
    .trim();

  // 取前 100 字 + 自动断句到句号
  if (text.length <= 100) return text;
  const cut = text.slice(0, 100);
  const lastDot = Math.max(cut.lastIndexOf('。'), cut.lastIndexOf('.'));
  if (lastDot > 40) return cut.slice(0, lastDot + 1);
  return cut + '…';
}

// ============================================================
// 主流程
// ============================================================
if (!fs.existsSync(UPDATES_DIR)) {
  console.error(`✗ 未找到目录:${UPDATES_DIR}`);
  process.exit(1);
}

const mdFiles = fs.readdirSync(UPDATES_DIR)
  .filter(f => f.endsWith('.md'))
  .map(f => path.join(UPDATES_DIR, f));

if (!mdFiles.length) {
  console.error(`✗ ${UPDATES_DIR} 下没有 .md 文件`);
  process.exit(1);
}

console.log(`✓ 扫描到 ${mdFiles.length} 个 md 文件`);

const items = mdFiles.map(parseUpdate);
items.sort((a, b) => (b.date || '').localeCompare(a.date || ''));

// 输出目录确保存在
fs.mkdirSync(path.dirname(OUTPUT_PATH), { recursive: true });
fs.writeFileSync(OUTPUT_PATH, JSON.stringify(items, null, 2) + '\n', 'utf-8');

console.log(`✓ 已写入:${OUTPUT_PATH}`);
console.log(`  共 ${items.length} 条更新,日期范围 ${items[items.length - 1].date} → ${items[0].date}`);

// 统计每个 tag 的命中数,方便检查推断是否合理
const tagCount = {};
items.forEach(item => item.tags.forEach(t => { tagCount[t] = (tagCount[t] || 0) + 1; }));
console.log('  tag 分布:', Object.entries(tagCount).map(([t, n]) => `${t}=${n}`).join(' '));

const primaryCount = {};
items.forEach(item => { primaryCount[item.primary] = (primaryCount[item.primary] || 0) + 1; });
console.log('  primary 分布:', Object.entries(primaryCount).map(([t, n]) => `${t}=${n}`).join(' '));
