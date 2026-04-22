import fs from 'fs';
import path from 'path';

// ========================================================
// 读取编译好的 critical.css,内联进三个 HTML 的 <head>
// 并把原 style.css 的 <link> 改成异步加载
// ========================================================

const CRITICAL_CSS_PATH = './css/critical.css';
const HTML_FILES = [
  './index.html',
  './html/anime-detail.html',
  './html/notes-detail.html',
];

// 每个 HTML 文件中,style.css 的引用可能是 ./css/style.css 或 ../css/style.css
const STYLE_LINK_PATTERNS = [
  /<link\s+rel="stylesheet"\s+href="\.\/css\/style\.css"\s*\/?>/,
  /<link\s+rel="stylesheet"\s+href="\.\.\/css\/style\.css"\s*\/?>/,
  /<link\s+rel="stylesheet"\s+href="css\/style\.css"\s*\/?>/,
];

// 1. 读取 critical.css
if (!fs.existsSync(CRITICAL_CSS_PATH)) {
  console.error(`✗ 未找到 ${CRITICAL_CSS_PATH},请先跑 npm run build:critical`);
  process.exit(1);
}

const criticalCSS = fs.readFileSync(CRITICAL_CSS_PATH, 'utf-8').trim();
console.log(`✓ 读取 critical.css (${(criticalCSS.length / 1024).toFixed(1)} KB)`);

// 2. 处理每个 HTML 文件
for (const htmlPath of HTML_FILES) {
  if (!fs.existsSync(htmlPath)) {
    console.log(`⚠ 跳过(文件不存在):${htmlPath}`);
    continue;
  }

  let html = fs.readFileSync(htmlPath, 'utf-8');

  // 备份原文件
  fs.writeFileSync(`${htmlPath}.bak`, html);

  // 判断是根目录还是 html/ 子目录(决定 href 路径)
  const isSubdir = htmlPath.includes('/html/');
  // 保持和原 HTML 风格一致:子目录用 ../,根目录用裸路径
  const cssHref = isSubdir ? '../css/style.css' : 'css/style.css';

  // 构造要替换进去的内容
  const replacement = `<!-- 关键 CSS:内联,首屏渲染零阻塞 -->
  <style>${criticalCSS}</style>
  <!-- 完整 CSS:异步加载,不阻塞渲染 -->
  <link rel="stylesheet" href="${cssHref}" media="print" onload="this.media='all'">
  <noscript><link rel="stylesheet" href="${cssHref}"></noscript>`;

  // 匹配并替换(同时支持 ./ 和 ../ 前缀)
  let replaced = false;
  for (const pattern of STYLE_LINK_PATTERNS) {
    if (pattern.test(html)) {
      html = html.replace(pattern, replacement);
      replaced = true;
      break;
    }
  }

  if (!replaced) {
    console.log(`⚠ 跳过(未找到 <link rel="stylesheet" href="...style.css">):${htmlPath}`);
    continue;
  }

  fs.writeFileSync(htmlPath, html);
  console.log(`✓ 已处理:${htmlPath}`);
}

console.log('\n完成!测试无误后可删除 .bak 文件:');
console.log('  del index.html.bak html\\anime-detail.html.bak html\\notes-detail.html.bak');