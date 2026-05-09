import fs from "node:fs/promises";
import path from "node:path";
import vm from "node:vm";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT = path.resolve(__dirname, "..");
const OUTPUT_FILE = "site-tags.md";

const SOURCES = {
  animeData: "js/anime-data.js",
  animeHtml: "html/anime.html",
  notesIndex: "data/notes-index.json",
  notesHtml: "html/notes.html",
  updatesIndex: "data/updates-index.json",
  updateHtml: "html/update.html",
  updateJs: "js/update.js",
  galleryData: "js/gallery-data.js",
  galleryHtml: "html/gallery.html",
  galleryJs: "js/gallery.js",
};

function resolveProjectPath(relativePath) {
  return path.join(ROOT, relativePath);
}

async function readText(relativePath) {
  return fs.readFile(resolveProjectPath(relativePath), "utf8");
}

async function readJson(relativePath) {
  return JSON.parse(await readText(relativePath));
}

async function readDataVariable(relativePath, variableName) {
  const source = await readText(relativePath);
  return vm.runInNewContext(`${source}\n;${variableName};`, Object.create(null), {
    filename: relativePath,
    timeout: 1000,
  });
}

function extractAssignedLiteral(source, name) {
  const marker = `const ${name} =`;
  const markerIndex = source.indexOf(marker);
  if (markerIndex === -1) return null;

  let index = markerIndex + marker.length;
  while (/\s/.test(source[index] || "")) index += 1;

  const open = source[index];
  const close = open === "{" ? "}" : open === "[" ? "]" : "";
  if (!close) return null;

  const start = index;
  let depth = 0;
  let quote = "";
  let escaped = false;

  for (; index < source.length; index += 1) {
    const char = source[index];

    if (quote) {
      if (escaped) {
        escaped = false;
      } else if (char === "\\") {
        escaped = true;
      } else if (char === quote) {
        quote = "";
      }
      continue;
    }

    if (char === '"' || char === "'") {
      quote = char;
      continue;
    }

    if (char === open) {
      depth += 1;
      continue;
    }

    if (char === close) {
      depth -= 1;
      if (depth === 0) return source.slice(start, index + 1);
    }
  }

  return null;
}

function readJsConst(source, name, fallback) {
  const literal = extractAssignedLiteral(source, name);
  if (!literal) return fallback;

  return vm.runInNewContext(`(${literal})`, Object.create(null), {
    filename: `${name}.literal`,
    timeout: 1000,
  });
}

function addCount(map, value, amount = 1) {
  const key = String(value || "").trim();
  if (!key) return;
  map.set(key, (map.get(key) || 0) + amount);
}

function countValues(values) {
  const counts = new Map();
  values.forEach((value) => addCount(counts, value));
  return counts;
}

function sortedCounts(counts) {
  return Array.from(counts.entries()).sort((a, b) => {
    const byCount = b[1] - a[1];
    if (byCount) return byCount;
    return a[0].localeCompare(b[0], "zh-CN");
  });
}

function stripTags(value) {
  return String(value || "")
    .replace(/<[^>]*>/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function parseButtons(html, dataAttr) {
  const pattern = new RegExp(
    `<button\\b[^>]*\\b${dataAttr}="([^"]+)"[^>]*>([\\s\\S]*?)<\\/button>`,
    "g"
  );
  const rows = [];
  let match;

  while ((match = pattern.exec(html))) {
    rows.push({
      value: match[1].trim(),
      label: stripTags(match[2]),
    });
  }

  return rows;
}

function parseAnimeStatusBadges(html) {
  const counts = new Map();
  const pattern = /<span\b[^>]*class="[^"]*\banime-badge\b[^"]*"[^>]*>([\s\S]*?)<\/span>/g;
  let match;

  while ((match = pattern.exec(html))) {
    addCount(counts, stripTags(match[1]));
  }

  return counts;
}

function parseNotesConfiguredCategories(html) {
  const groupsByCategory = new Map();
  let currentGroup = "";

  html.split(/\r?\n/).forEach((line) => {
    const groupMatch = line.match(/\bdata-group="([^"]+)"/);
    if (groupMatch) currentGroup = groupMatch[1].trim();

    const categoryMatch = line.match(/\bdata-category="([^"]+)"/);
    if (!categoryMatch) return;

    const category = categoryMatch[1].trim();
    if (!category) return;

    if (!groupsByCategory.has(category)) groupsByCategory.set(category, new Set());
    if (currentGroup) groupsByCategory.get(category).add(currentGroup);
  });

  return groupsByCategory;
}

function parseAnimeTopics(animeData) {
  const counts = new Map();

  Object.values(animeData || {}).forEach((item) => {
    const info = Array.isArray(item?.info) ? item.info : [];
    info.forEach((line) => {
      const match = String(line).match(/^题材[:：]\s*(.+)$/);
      if (!match) return;

      match[1]
        .split(/[\/、,，]/)
        .map((tag) => tag.trim())
        .filter(Boolean)
        .forEach((tag) => addCount(counts, tag));
    });
  });

  return counts;
}

function getLabelMapFromButtons(buttons, skipValues = []) {
  const skip = new Set(skipValues);
  const labels = {};

  buttons.forEach(({ value, label }) => {
    if (!value || skip.has(value)) return;
    labels[value] = label || value;
  });

  return labels;
}

function mergeLabelMaps(...maps) {
  return Object.assign({}, ...maps.filter(Boolean));
}

function missingConfiguredRows(labels, counts) {
  return Object.entries(labels)
    .filter(([value]) => value !== "all" && !counts.has(value))
    .sort((a, b) => a[0].localeCompare(b[0], "zh-CN"));
}

function formatDateShanghai(date = new Date()) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Shanghai",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(date);

  const byType = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${byType.year}-${byType.month}-${byType.day}`;
}

function mdCell(value) {
  return String(value ?? "").replace(/\|/g, "\\|").replace(/\n/g, "<br>");
}

function code(value) {
  return `\`${mdCell(value)}\``;
}

function table(headers, rows, rightAlignIndexes = []) {
  if (!rows.length) return "\n暂无。\n";

  const rightAlign = new Set(rightAlignIndexes);
  const align = headers.map((_, index) => (rightAlign.has(index) ? "---:" : "---"));
  const lines = [
    `| ${headers.map(mdCell).join(" | ")} |`,
    `| ${align.join(" | ")} |`,
    ...rows.map((row) => `| ${row.map(mdCell).join(" | ")} |`),
  ];

  return `\n${lines.join("\n")}\n`;
}

function countTable(headers, counts, mapRow) {
  return table(headers, sortedCounts(counts).map(mapRow), [headers.length - 1]);
}

function buildMarkdown(report) {
  const lines = [];

  lines.push("# 网站标签参考");
  lines.push("");
  lines.push(`整理日期：${formatDateShanghai()}`);
  lines.push("");
  lines.push("> 这个文件由 `npm run tags:sync` 自动生成，请不要手动编辑。");
  lines.push("");
  lines.push("这个文件用于记录当前网站里已经出现或已经配置好的标签，方便以后新增内容时保持命名统一。统计来源以现有数据文件和页面筛选项为准。");
  lines.push("");

  lines.push("## 动漫");
  lines.push("");
  lines.push("数据来源：");
  lines.push("");
  lines.push("- `js/anime-data.js` 的 `info` 字段，主要来自 `题材：...`");
  lines.push("- `html/anime.html` 的卡片状态徽章");
  lines.push("");
  lines.push("### 已使用题材标签");
  lines.push(countTable(["标签", "使用次数"], report.anime.topicCounts, ([tag, count]) => [tag, count]));
  lines.push("### 卡片状态徽章");
  lines.push(countTable(["标签", "使用次数"], report.anime.statusCounts, ([tag, count]) => [tag, count]));
  lines.push("");

  lines.push("## 笔记");
  lines.push("");
  lines.push("数据来源：");
  lines.push("");
  lines.push("- `data/notes-index.json` 的 `category`");
  lines.push("- `html/notes.html` 的侧边栏分类筛选");
  lines.push("");
  lines.push("### 当前已有内容分类");
  lines.push(countTable(["分类", "使用次数"], report.notes.categoryCounts, ([tag, count]) => [tag, count]));
  lines.push("### 页面已配置但暂无内容的分类");
  lines.push(table(
    ["分类", "所属分组"],
    report.notes.unusedConfigured.map(([category, groups]) => [category, groups])
  ));
  lines.push("");

  lines.push("## 更新");
  lines.push("");
  lines.push("数据来源：");
  lines.push("");
  lines.push("- `data/updates-index.json` 的 `category`、`tags`、`primary`");
  lines.push("- `html/update.html` 的筛选按钮");
  lines.push("- `js/update.js` 的标签显示文案");
  lines.push("");
  lines.push("### 当前已有内容分类");
  lines.push(countTable(["分类", "使用次数"], report.updates.categoryCounts, ([tag, count]) => [tag, count]));
  lines.push("### 当前已使用标签");
  lines.push(countTable(
    ["标签值", "显示文案", "使用次数"],
    report.updates.tagCounts,
    ([tag, count]) => [code(tag), report.updates.tagLabels[tag] || tag, count]
  ));
  lines.push("### 当前已使用 primary");
  lines.push(countTable(["primary", "使用次数"], report.updates.primaryCounts, ([tag, count]) => [code(tag), count]));
  lines.push("### 页面已配置但暂无内容的筛选项");
  lines.push(table(
    ["标签值", "显示文案"],
    report.updates.unusedConfigured.map(([value, label]) => [code(value), label])
  ));
  lines.push("");

  lines.push("## 画廊");
  lines.push("");
  lines.push("数据来源：");
  lines.push("");
  lines.push("- `js/gallery-data.js` 的 `category` 和 `tags`");
  lines.push("- `html/gallery.html` 的分类筛选按钮");
  lines.push("- `js/gallery.js` 的分类与标签显示文案");
  lines.push("");
  lines.push("### 当前已有内容分类");
  lines.push(countTable(
    ["分类值", "显示文案", "使用次数"],
    report.gallery.categoryCounts,
    ([category, count]) => [code(category), report.gallery.categoryLabels[category] || category, count]
  ));
  lines.push("### 当前已使用标签");
  lines.push(countTable(["标签", "使用次数"], report.gallery.tagCounts, ([tag, count]) => [tag, count]));
  lines.push("### 页面/代码已配置但暂无内容的分类值");
  lines.push(table(
    ["分类值", "显示文案"],
    report.gallery.unusedConfigured.map(([value, label]) => [code(value), label])
  ));
  lines.push("### 备注");
  lines.push("");
  lines.push("- `js/gallery.js` 里也保留了英文标签映射，例如 `night` -> `夜景`、`city` -> `城市`、`sky` -> `天空` 等；当前 `js/gallery-data.js` 直接使用中文标签。");
  lines.push("- 更新页的 `tags` 用英文值存储，页面显示时再映射成中文文案；新增更新日志时优先复用现有英文值。");
  lines.push("");

  return `${lines.join("\n").replace(/\n{3,}/g, "\n\n")}\n`;
}

async function collectReport() {
  const [
    animeData,
    animeHtml,
    notesIndex,
    notesHtml,
    updatesIndex,
    updateHtml,
    updateJs,
    galleryData,
    galleryHtml,
    galleryJs,
  ] = await Promise.all([
    readDataVariable(SOURCES.animeData, "animeData"),
    readText(SOURCES.animeHtml),
    readJson(SOURCES.notesIndex),
    readText(SOURCES.notesHtml),
    readJson(SOURCES.updatesIndex),
    readText(SOURCES.updateHtml),
    readText(SOURCES.updateJs),
    readDataVariable(SOURCES.galleryData, "galleryData"),
    readText(SOURCES.galleryHtml),
    readText(SOURCES.galleryJs),
  ]);

  const updateButtons = parseButtons(updateHtml, "data-chip");
  const updateTagLabels = mergeLabelMaps(
    readJsConst(updateJs, "TAG_LABELS", {}),
    getLabelMapFromButtons(updateButtons, ["all"])
  );

  const galleryCategoryLabels = mergeLabelMaps(
    readJsConst(galleryJs, "GALLERY_CATEGORY_LABELS", {}),
    getLabelMapFromButtons(parseButtons(galleryHtml, "data-category"), ["all"])
  );

  const notesConfigured = parseNotesConfiguredCategories(notesHtml);
  const notesCategoryCounts = countValues(notesIndex.map((item) => item.category));

  const updateTagCounts = new Map();
  const updatePrimaryCounts = new Map();
  updatesIndex.forEach((item) => {
    (Array.isArray(item.tags) ? item.tags : []).forEach((tag) => addCount(updateTagCounts, tag));
    addCount(updatePrimaryCounts, item.primary);
  });

  const galleryCategoryCounts = countValues(galleryData.map((item) => item.category));
  const galleryTagCounts = new Map();
  galleryData.forEach((item) => {
    (Array.isArray(item.tags) ? item.tags : []).forEach((tag) => addCount(galleryTagCounts, tag));
  });

  return {
    anime: {
      topicCounts: parseAnimeTopics(animeData),
      statusCounts: parseAnimeStatusBadges(animeHtml),
    },
    notes: {
      categoryCounts: notesCategoryCounts,
      unusedConfigured: Array.from(notesConfigured.entries())
        .filter(([category]) => !notesCategoryCounts.has(category))
        .map(([category, groups]) => [category, Array.from(groups).join(" / ")])
        .sort((a, b) => a[0].localeCompare(b[0], "zh-CN")),
    },
    updates: {
      categoryCounts: countValues(updatesIndex.map((item) => item.category)),
      tagCounts: updateTagCounts,
      primaryCounts: updatePrimaryCounts,
      tagLabels: updateTagLabels,
      unusedConfigured: missingConfiguredRows(updateTagLabels, updateTagCounts),
    },
    gallery: {
      categoryCounts: galleryCategoryCounts,
      tagCounts: galleryTagCounts,
      categoryLabels: galleryCategoryLabels,
      unusedConfigured: missingConfiguredRows(galleryCategoryLabels, galleryCategoryCounts),
    },
  };
}

const report = await collectReport();
const markdown = buildMarkdown(report);
await fs.writeFile(resolveProjectPath(OUTPUT_FILE), markdown, "utf8");

console.log(`[tags] 已更新 ${OUTPUT_FILE}`);
console.log(`[tags] 动漫题材 ${report.anime.topicCounts.size} 个，笔记分类 ${report.notes.categoryCounts.size} 个，更新标签 ${report.updates.tagCounts.size} 个，画廊标签 ${report.gallery.tagCounts.size} 个。`);
