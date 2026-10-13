/* ===== 动态加载 KaTeX 和 p5.js ===== */
function loadScript(src) {
  return new Promise((resolve, reject) => {
    if (document.querySelector(`script[src="${src}"]`)) {
      resolve();
      return;
    }
    const s = document.createElement("script");
    s.src = src;
    s.onload = resolve;
    s.onerror = reject;
    document.head.appendChild(s);
  });
}

let _katexPromise = null;
function loadKaTeX() {
  if (_katexPromise) return _katexPromise;
  _katexPromise = loadScript("https://cdn.bootcdn.net/ajax/libs/KaTeX/0.16.9/katex.min.js")
    .then(() => loadScript("https://cdn.bootcdn.net/ajax/libs/KaTeX/0.16.9/contrib/auto-render.min.js"));
  return _katexPromise;
}

function loadP5() {
  return loadScript("https://cdn.bootcdn.net/ajax/libs/p5.js/1.11.3/p5.min.js");
}

loadKaTeX().catch(() => {});

/* ===== 只渲染尚未处理过的卡片 ===== */
function renderMathInCards(cards) {
  const unrendered = [...cards].filter(
    (card) => !card.dataset.mathRendered && !card.classList.contains("is-hidden")
  );
  if (!unrendered.length) return;

  function doRender() {
    unrendered.forEach((card) => {
      if (!window.renderMathInElement) return;
      renderMathInElement(card, {
        delimiters: [
          { left: "$$", right: "$$", display: true },
          { left: "$", right: "$", display: false },
          { left: "\\(", right: "\\)", display: false },
          { left: "\\[", right: "\\]", display: true }
        ],
        throwOnError: false
      });
      card.dataset.mathRendered = "1";
    });
  }

  if (window.renderMathInElement) {
    requestAnimationFrame(doRender);
  } else {
    loadKaTeX()
      .then(() => requestAnimationFrame(doRender))
      .catch(() => console.warn("KaTeX 加载失败"));
  }
}

/* ===== 小工具 ===== */
function escapeHtml(str) {
  return String(str ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

function normalizeLineEndings(text) {
  return String(text || "").replace(/\r\n/g, "\n").replace(/\r/g, "\n");
}

function formatDate(dateStr) {
  if (!dateStr) return "";
  const d = new Date(dateStr + "T00:00:00");
  if (isNaN(d.getTime())) return dateStr;
  return d.toLocaleDateString("zh-CN", { year: "numeric", month: "2-digit", day: "2-digit" });
}

/* ===== Markdown 渲染：markdown-it + 公式保护 =====
 * 公式由两条 markdown-it 规则整段接管，原样（仅做 HTML 转义）输出，
 * 之后交给 KaTeX 的 renderMathInElement；公式内部的 * _ \ 等不会被 Markdown 处理。
 * 代码块 / 行内代码里的 $ 不受影响（由 markdown-it 自己的规则先消费）。 */
const MARKDOWN_IT_SOURCES = [
  "https://cdn.bootcdn.net/ajax/libs/markdown-it/13.0.2/markdown-it.min.js",
  "https://cdn.jsdelivr.net/npm/markdown-it@13.0.2/dist/markdown-it.min.js"
];
const MATH_INLINE_DELIMITERS = [["$$", "$$"], ["$", "$"], ["\\(", "\\)"], ["\\[", "\\]"]];
const MATH_BLOCK_DELIMITERS  = [["$$", "$$"], ["\\[", "\\]"]];

let _noteMarkdown = null;       // 加载完成后的 markdown-it 实例；加载失败时保持 null，走简易渲染
let _markdownItPromise = null;

function loadMarkdownIt() {
  if (_markdownItPromise) return _markdownItPromise;
  _markdownItPromise = MARKDOWN_IT_SOURCES
    .reduce((chain, src) => chain.catch(() => loadScript(src).then(() => {
      if (typeof window.markdownit !== "function") throw new Error(`markdown-it 未就绪：${src}`);
    })), Promise.reject(new Error("start")))
    .then(() => (_noteMarkdown = createNoteMarkdown(window.markdownit)))
    .catch((err) => {
      console.warn("markdown-it 加载失败，改用简易渲染：", err);
      return null;
    });
  return _markdownItPromise;
}

// 直接打开 / 刷新笔记页（含文章深链接）时立刻开始加载，与笔记索引、Markdown 请求并行
if (new URLSearchParams(location.search).get("page") === "notes") loadMarkdownIt();

// 与 KaTeX auto-render 的 findEndOfMath 同一算法（花括号配平 + 反斜杠转义），保证两边认定的公式范围一致
function findMathEnd(src, delimiter, start, max) {
  let braceLevel = 0;
  for (let i = start; i < max; i++) {
    const ch = src[i];
    if (braceLevel <= 0 && i + delimiter.length <= max && src.startsWith(delimiter, i)) return i;
    if (ch === "\\") i++;
    else if (ch === "{") braceLevel++;
    else if (ch === "}") braceLevel--;
  }
  return -1;
}

function createNoteMarkdown(markdownit) {
  const md = markdownit({ html: true, breaks: true, linkify: false, typographer: false });

  // 行内公式：$...$、$$...$$、\(...\)、\[...\]（排在 escape 之前，\( \[ 不会被当成转义字符）
  md.inline.ruler.before("escape", "math_inline", (state, silent) => {
    const { src, pos } = state;
    const ch = src.charCodeAt(pos);
    if (ch !== 0x24 /* $ */ && ch !== 0x5c /* \ */) return false;
    const delimiter = MATH_INLINE_DELIMITERS.find(([left]) => src.startsWith(left, pos));
    if (!delimiter) return false;
    const [left, right] = delimiter;
    const end = findMathEnd(src, right, pos + left.length, state.posMax);
    if (end === -1) return false;
    if (!silent) {
      state.push("math_inline", "", 0).content = src.slice(pos, end + right.length);
    }
    state.pos = end + right.length;
    return true;
  });

  // 块级公式：以 $$ 或 \[ 开头的行，到对应结束符所在行为止（结束符后只能是空白）
  md.block.ruler.before("fence", "math_block", (state, startLine, endLine, silent) => {
    if (state.sCount[startLine] - state.blkIndent >= 4) return false;
    const start = state.bMarks[startLine] + state.tShift[startLine];
    const delimiter = MATH_BLOCK_DELIMITERS.find(([left]) => state.src.startsWith(left, start));
    if (!delimiter) return false;
    const [left, right] = delimiter;
    const end = findMathEnd(state.src, right, start + left.length, state.eMarks[endLine - 1]);
    if (end === -1) return false;
    const close = end + right.length;

    let line = startLine;
    while (line < endLine && state.eMarks[line] < close) line++;
    if (state.src.slice(close, state.eMarks[line]).trim()) return false;
    if (silent) return true;

    const token = state.push("math_block", "div", 0);
    token.block = true;
    token.content = state.src.slice(start, close);
    token.map = [startLine, line + 1];
    state.line = line + 1;
    return true;
  }, { alt: ["paragraph", "reference", "blockquote", "list"] });

  // 表格包一层，窄屏时横向滚动而不是撑破卡片
  md.renderer.rules.table_open  = () => '<div class="note-table-wrap"><table>\n';
  md.renderer.rules.table_close = () => "</table></div>\n";

  md.renderer.rules.math_inline = (tokens, idx) => escapeHtml(tokens[idx].content);
  md.renderer.rules.math_block  = (tokens, idx) =>
    `<div class="note-formula">${escapeHtml(tokens[idx].content)}</div>\n`;

  // 详情模式给 h1–h3 加锚点 id；规则与旧解析器一致（按出现顺序编号 + 标题原文），旧锚点不失效
  md.renderer.rules.heading_open = (tokens, idx, options, env, self) => {
    const token = tokens[idx];
    const level = Number(token.tag.slice(1));
    if (env && env.withIds && level <= 3) {
      env.headingCounter = (env.headingCounter || 0) + 1;
      token.attrSet("id", headingSlug(env.headingCounter, tokens[idx + 1]?.content || ""));
    }
    return self.renderToken(tokens, idx, options);
  };

  return md;
}

function headingSlug(counter, text) {
  return "h-" + counter + "-" +
    text.trim().replace(/\s+/g, "-").replace(/[^\w一-龥-]/g, "").slice(0, 30);
}

/* 正文与列表摘要共用的渲染入口；调用前先 await loadMarkdownIt() */
function renderNoteMarkdown(md, withIds = false) {
  const text = normalizeLineEndings(md).trim();
  if (!text) return "";
  if (!_noteMarkdown) return simpleMarkdownToHtml(text, withIds);
  return _noteMarkdown.render(text, { withIds, headingCounter: 0 });
}

/* ===== 极简 Markdown 渲染（仅在 markdown-it 加载失败时兜底；详情模式给标题加 id 锚点） ===== */
function simpleMarkdownToHtml(md, withIds = false) {
  const text = normalizeLineEndings(md).trim();
  if (!text) return "";

  const lines = text.split("\n");
  const html = [];

  let paragraphBuffer = [];
  let listBuffer = [];
  let inCodeBlock = false;
  let codeBuffer = [];
  let mathBlockBuffer = [];
  let inMathBlock = false;
  let headingCounter = 0;

  function flushParagraph() {
    if (!paragraphBuffer.length) return;
    html.push(`<p>${paragraphBuffer.join("<br>")}</p>`);
    paragraphBuffer = [];
  }
  function flushList() {
    if (!listBuffer.length) return;
    html.push("<ul>" + listBuffer.map(i => `<li>${i}</li>`).join("") + "</ul>");
    listBuffer = [];
  }
  function flushCodeBlock() {
    if (!codeBuffer.length) return;
    html.push(`<pre><code>${escapeHtml(codeBuffer.join("\n"))}</code></pre>`);
    codeBuffer = [];
  }
  function flushMathBlock() {
    if (!mathBlockBuffer.length) return;
    html.push(`<div class="note-formula">${mathBlockBuffer.join("\n")}</div>`);
    mathBlockBuffer = [];
  }
  function isDisplayMathLine(line) {
    const t = line.trim();
    return t.startsWith("\\[") || t.endsWith("\\]") || t.startsWith("$$") || t.endsWith("$$");
  }
  function headingTag(level, text) {
    if (!withIds) return `<h${level}>${text}</h${level}>`;
    return `<h${level} id="${headingSlug(++headingCounter, text)}">${text}</h${level}>`;
  }

  for (const rawLine of lines) {
    const line = rawLine.trim();

    if (line.startsWith("```")) {
      flushParagraph(); flushList();
      inCodeBlock ? (inCodeBlock = false, flushCodeBlock()) : (inCodeBlock = true);
      continue;
    }
    if (inCodeBlock) { codeBuffer.push(rawLine); continue; }

    if (!inMathBlock && (line === "\\[" || line === "$$")) {
      flushParagraph(); flushList();
      inMathBlock = true; mathBlockBuffer.push(rawLine); continue;
    }
    if (inMathBlock) {
      mathBlockBuffer.push(rawLine);
      if (line === "\\]" || line === "$$") { inMathBlock = false; flushMathBlock(); }
      continue;
    }

    if (!line) { flushParagraph(); flushList(); continue; }

    if (isDisplayMathLine(rawLine) && !inMathBlock) {
      flushParagraph(); flushList();
      html.push(`<div class="note-formula">${rawLine}</div>`); continue;
    }

    if (line.startsWith("### ")) { flushParagraph(); flushList(); html.push(headingTag(3, line.slice(4))); continue; }
    if (line.startsWith("## "))  { flushParagraph(); flushList(); html.push(headingTag(2, line.slice(3))); continue; }
    if (line.startsWith("# "))   { flushParagraph(); flushList(); html.push(headingTag(1, line.slice(2))); continue; }
    if (line.startsWith("- ") || line.startsWith("* ")) { flushParagraph(); listBuffer.push(line.slice(2)); continue; }

    paragraphBuffer.push(rawLine);
  }

  flushParagraph(); flushList(); flushCodeBlock(); flushMathBlock();
  return html.join("\n");
}

/* ===== 解析 Markdown 为单篇笔记(不再分篇) ===== */
function parseMarkdownToNote(md, fallback = {}) {
  const raw = normalizeLineEndings(md).trim();
  const lines = raw.split("\n");

  let title = "";
  let category = fallback.category || "";
  let meta = fallback.meta || "";
  let date = fallback.date || "";
  const contentLines = [];

  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (!title && line.startsWith("# ")) { title = line.replace(/^#\s+/, "").trim(); continue; }
    if (line.startsWith("@category:")) { category = line.replace("@category:", "").trim(); continue; }
    if (line.startsWith("@meta:"))     { meta = line.replace("@meta:", "").trim(); continue; }
    if (line.startsWith("@date:"))     { date = line.replace("@date:", "").trim(); continue; }
    contentLines.push(rawLine);
  }

  return {
    id: fallback.file || "note",
    title: title || fallback.title || "未命名笔记",
    category: category || "未分类",
    meta: meta || "",
    date: date || "",
    content: contentLines.join("\n").trim(),
    file: fallback.file || "",
  };
}

/* ===== 加载单个 Markdown 文件 ===== */
async function loadNoteMarkdown(file) {
  const res = await fetch(file);
  if (!res.ok) throw new Error(`加载失败: ${file}`);
  return res.text();
}

/* ===== 从已渲染的卡片 DOM 提取 TOC 条目 =====
 * 直接沿用标题里渲染好的公式：去掉 KaTeX 给读屏用的隐藏 MathML（否则 textContent 会把公式重复取三遍），
 * 读屏文字另取 LaTeX 源码，放在 aria-label 里 */
function buildTocItems(cardEl) {
  const headings = cardEl.querySelectorAll("h1[id], h2[id], h3[id]");
  return Array.from(headings).map(h => {
    const visual = h.cloneNode(true);
    visual.querySelectorAll(".katex-mathml").forEach(el => el.remove());
    visual.querySelectorAll("[id]").forEach(el => el.removeAttribute("id"));

    const spoken = h.cloneNode(true);
    spoken.querySelectorAll(".katex").forEach(el => {
      el.replaceWith(el.querySelector("annotation")?.textContent || "");
    });

    return {
      id: h.id,
      html: visual.innerHTML.trim(),
      text: spoken.textContent.replace(/\s+/g, " ").trim(),
      level: parseInt(h.tagName[1], 10)
    };
  });
}

/* ===== 生成并返回 TOC aside 节点 ===== */
function renderTocSidebar(tocItems, scrollContainer) {
  const aside = document.createElement("aside");
  aside.className = "notes-sidebar note-toc-sidebar";
  aside.id = "note-toc-sidebar";

  if (!tocItems.length) {
    aside.innerHTML = `
      <div class="notes-sidebar-card note-toc-card">
        <h2>目录</h2>
        <p class="note-toc-empty">本篇暂无章节目录。</p>
      </div>`;
    return aside;
  }

  const listHtml = tocItems.map(item => `
    <li class="note-toc-item note-toc-level-${item.level}">
      <a class="note-toc-link" href="#${item.id}" data-toc-id="${item.id}" aria-label="${escapeHtml(item.text).replace(/"/g, "&quot;")}">${item.html}</a>
    </li>`).join("");

  aside.innerHTML = `
    <div class="notes-sidebar-card note-toc-card">
      <h2>目录</h2>
      <ul class="note-toc-list">${listHtml}</ul>
    </div>`;

  /* 平滑滚动 */
  aside.querySelectorAll(".note-toc-link").forEach(link => {
    link.addEventListener("click", e => {
      e.preventDefault();
      const target = document.getElementById(link.dataset.tocId);
      if (!target) return;
      const container = scrollContainer || document.querySelector(".content-scroll");
      if (container) {
        const offset = target.getBoundingClientRect().top
          - container.getBoundingClientRect().top
          + container.scrollTop - 20;
        container.scrollTo({ top: offset, behavior: "smooth" });
      } else {
        target.scrollIntoView({ behavior: "smooth", block: "start" });
      }
    });
  });

  /* 滚动高亮当前章节 */
  if (typeof IntersectionObserver !== "undefined") {
    const links = aside.querySelectorAll(".note-toc-link");
    const linkMap = new Map(Array.from(links).map(l => [l.dataset.tocId, l]));

    const obs = new IntersectionObserver(entries => {
      entries.forEach(entry => {
        if (entry.isIntersecting) {
          links.forEach(l => l.classList.remove("is-active"));
          const active = linkMap.get(entry.target.id);
          if (active) active.classList.add("is-active");
        }
      });
    }, {
      root: scrollContainer || null,
      rootMargin: "-8% 0px -78% 0px",
      threshold: 0
    });

    tocItems.forEach(item => {
      const el = document.getElementById(item.id);
      if (el) obs.observe(el);
    });

    aside._observer = obs; // 离开详情时 disconnect
  }

  return aside;
}

/* ===== 详情页视图（在 SPA 内渲染） ===== */
function renderDetailView(note, onBack, pushHistory = true) {
  const dateDisplay = note.date
    ? `<span class="note-date">${formatDate(note.date)}</span>` : "";

  /* 复用 notes-layout 两栏网格：左侧正文，右侧 TOC */
  const wrapper = document.createElement("section");
  wrapper.className = "notes-page no-card";
  wrapper.innerHTML = `
    <div class="notes-layout">
      <div class="notes-main">
        <article class="note-detail-card" id="note-detail-card">
          <div class="note-detail-loading" id="note-detail-loading">
            <span class="note-loading-dot"></span>
            <span class="note-loading-dot"></span>
            <span class="note-loading-dot"></span>
          </div>
        </article>
      </div>
      <!-- TOC 由 JS 追加到 .notes-layout -->
    </div>
  `;

  const main = document.getElementById("main-content");
  if (!main) return;

  const savedContent = main.innerHTML;
  main.innerHTML = "";
  main.appendChild(wrapper);

  const scrollEl = document.querySelector(".content-scroll");
  if (scrollEl) scrollEl.scrollTo({ top: 0, behavior: "smooth" });

  const card    = document.getElementById("note-detail-card");
  const loading = document.getElementById("note-detail-loading");
  const grid    = wrapper.querySelector(".notes-layout");

  /* 注入正文（withIds=true 给标题加锚点） */
  if (loading) loading.remove();
  card.innerHTML = `
    <div class="note-card-top">
      <span class="note-tag">${escapeHtml(note.category)}</span>
      ${dateDisplay}
    </div>
    <h2 class="note-detail-title">${escapeHtml(note.title)}</h2>
    <div class="note-detail-body note-markdown-full">
      ${renderNoteMarkdown(note.content, true)}
    </div>
  `;

  /* KaTeX → 再提取 TOC（避免公式 LaTeX 混入标题文字） */
  const attachToc = () => {
    const tocItems  = buildTocItems(card);
    const tocAside  = renderTocSidebar(tocItems, scrollEl);
    grid.appendChild(tocAside);
  };

  loadKaTeX().then(() => {
    if (window.renderMathInElement) {
      renderMathInElement(card, {
        delimiters: [
          { left: "$$", right: "$$", display: true  },
          { left: "$",  right: "$",  display: false },
          { left: "\\(", right: "\\)", display: false },
          { left: "\\[", right: "\\]", display: true  }
        ],
        throwOnError: false
      });
    }
    attachToc();
  }).catch(() => attachToc());

  /* 更新 URL */
  const url = new URL(window.location.href);
  url.searchParams.set("note", note.file); // searchParams 自己会编码一次，不再手动 encodeURIComponent
  url.searchParams.delete("noteIndex"); // 清掉旧参数(如果是老链接带进来的)
  if (pushHistory) {
    window._beginNavigation?.(); // 新的导航意图：作废尚未完成的跨页请求
    history.pushState({ page: "notes", note: note.file }, "", url.toString());
  }
}

/* ===== 从 JSON 索引渲染所有笔记卡片 ===== */
async function renderNotesFromJSON(allNotesCache) {
  const notesPage = document.querySelector(".notes-page");
  if (!notesPage) return [];

  const container = document.getElementById("notes-content");
  const emptyState = document.getElementById("notes-empty");
  if (!container) return [];

  if (allNotesCache && allNotesCache.length) {
    return allNotesCache;
  }

  try {
    const indexRes = await fetch("data/notes-index.json");
    if (!indexRes.ok) throw new Error("notes-index.json 加载失败");
    const notesIndex = await indexRes.json();

    // 并发加载所有 md 和 markdown-it,提速
    const [notes] = await Promise.all([
      Promise.all(
        notesIndex.map(async (item) => {
          const mdText = await loadNoteMarkdown(item.file);
          return parseMarkdownToNote(mdText, item);
        })
      ),
      loadMarkdownIt()
    ]);
    if (!container.isConnected) return [];

    container.innerHTML = "";
    if (emptyState) container.appendChild(emptyState);

    const allCards = [];

    notes.forEach((note) => {
      const article = document.createElement("article");
      article.className = "note-card";
      article.dataset.category = note.category;
      article.dataset.date     = note.date || "";
      article.dataset.noteId   = note.id;

      const dateDisplay = note.date
        ? `<span class="note-date">${formatDate(note.date)}</span>` : "";

      article.innerHTML = `
        <div class="note-card-top">
          <span class="note-tag">${escapeHtml(note.category)}</span>
          ${dateDisplay}
        </div>
        <h2>${escapeHtml(note.title)}</h2>
        <div class="note-markdown">
          ${renderNoteMarkdown(note.content)}
        </div>
        <span class="note-read-more">阅读全文 →</span>
      `;

      article.addEventListener("click", () => {
        renderDetailView(note, () => initNotesPage());
      });

      container.insertBefore(article, emptyState || null);
      allCards.push(article);
    });

    renderMathInCards(allCards);

    if (notesPage.querySelector(".p5-canvas")) {
      loadP5().catch(() => console.warn("p5.js 加载失败"));
    }

    return allCards;
  } catch (error) {
    console.error(error);
    container.innerHTML = `
      <p class="notes-empty">
        笔记加载失败，请检查 data/notes-index.json 路径、Markdown 文件路径，或查看控制台报错。
      </p>
    `;
    return [];
  }
}

/* ===== 按日期排序 ===== */
function sortCardsByDate(noteCards, direction) {
  const container  = document.getElementById("notes-content");
  const emptyState = document.getElementById("notes-empty");
  if (!container) return;

  const visible = noteCards.filter(c => !c.classList.contains("is-hidden"));
  const sorted  = [...visible].sort((a, b) => {
    const da = a.dataset.date || "", db = b.dataset.date || "";
    if (!da && !db) return 0;
    if (!da) return 1;
    if (!db) return -1;
    return direction === "asc" ? da.localeCompare(db) : db.localeCompare(da);
  });
  sorted.forEach(card => container.insertBefore(card, emptyState || null));
}

/* ===== 绑定分类筛选 + 排序 ===== */
function bindNotesFilter(noteCards) {
  const notesPage = document.querySelector(".notes-page");
  if (!notesPage) return;

  const groupToggles    = notesPage.querySelectorAll(".notes-group-toggle");
  const categoryButtons = notesPage.querySelectorAll(".notes-category");
  const sortButtons     = notesPage.querySelectorAll(".notes-sort");
  const emptyState      = notesPage.querySelector("#notes-empty");

  let activeSortDirection = null;

  function clearNavActiveStates() {
    groupToggles.forEach(btn => btn.classList.remove("active"));
    categoryButtons.forEach(btn => btn.classList.remove("active"));
  }
  function clearSortActiveStates() {
    sortButtons.forEach(btn => btn.classList.remove("active"));
  }
  function applyCurrentSort() {
    if (activeSortDirection) sortCardsByDate(noteCards, activeSortDirection);
  }
  function filterAllNotes() {
    noteCards.forEach(card => card.classList.remove("is-hidden"));
    if (emptyState) emptyState.hidden = true;
    renderMathInCards(noteCards);
    applyCurrentSort();
  }
  function filterNotesByCategory(category) {
    let visibleCount = 0;
    const nowVisible = [];
    noteCards.forEach(card => {
      if (card.dataset.category === category) {
        card.classList.remove("is-hidden");
        nowVisible.push(card);
        visibleCount++;
      } else {
        card.classList.add("is-hidden");
      }
    });
    if (emptyState) emptyState.hidden = visibleCount !== 0;
    renderMathInCards(nowVisible);
    applyCurrentSort();
  }

  groupToggles.forEach(toggle => {
    toggle.addEventListener("click", () => {
      const parentGroup = toggle.closest(".notes-group");
      const mode        = toggle.dataset.mode;
      const groupName   = toggle.dataset.group;

      if (mode === "all") {
        clearNavActiveStates();
        toggle.classList.add("active");
        notesPage.querySelectorAll(".notes-group").forEach(group => {
          group.classList.toggle("is-open", !!group.querySelector('[data-mode="all"]'));
        });
        filterAllNotes();
        return;
      }

      if (groupName && parentGroup) {
        const isOpen = parentGroup.classList.contains("is-open");
        notesPage.querySelectorAll(".notes-group").forEach(group => {
          if (group !== parentGroup && !group.querySelector('[data-mode="all"]')) {
            group.classList.remove("is-open");
          }
        });
        parentGroup.classList.toggle("is-open", !isOpen);
      }
    });
  });

  categoryButtons.forEach(button => {
    button.addEventListener("click", () => {
      clearNavActiveStates();
      button.classList.add("active");
      const parentGroup = button.closest(".notes-group");
      if (parentGroup) {
        const parentToggle = parentGroup.querySelector(".notes-group-toggle");
        if (parentToggle) parentToggle.classList.add("active");
        notesPage.querySelectorAll(".notes-group").forEach(group => {
          if (group !== parentGroup && !group.querySelector('[data-mode="all"]')) {
            group.classList.remove("is-open");
          }
        });
        parentGroup.classList.add("is-open");
      }
      filterNotesByCategory(button.dataset.category);
    });
  });

  sortButtons.forEach(button => {
    button.addEventListener("click", () => {
      if (button.classList.contains("active")) return;
      const direction = button.dataset.sort;
      clearSortActiveStates();
      button.classList.add("active");
      activeSortDirection = direction;
      sortCardsByDate(noteCards, direction);
    });
  });

  const defaultOverview = notesPage.querySelector('.notes-group-toggle[data-mode="all"]');
  if (defaultOverview) {
    clearNavActiveStates();
    defaultOverview.classList.add("active");
    filterAllNotes();
  } else {
    renderMathInCards(noteCards);
  }

  const defaultSortBtn = notesPage.querySelector('.notes-sort[data-sort="desc"]');
  if (defaultSortBtn) {
    clearSortActiveStates();
    defaultSortBtn.classList.add("active");
    activeSortDirection = "desc";
    sortCardsByDate(noteCards, "desc");
  }
}

/* ===== 页面初始化 ===== */
async function initNotesPage() {
  const notesPage = document.querySelector(".notes-page");
  if (!notesPage) return;
  loadMarkdownIt(); // 站内切到笔记页时同样尽早开始，与下面的索引请求并行

  const encodedFile = new URLSearchParams(location.search).get('note');
  if (encodedFile) {
    let file = encodedFile;
    try { file = decodeURIComponent(encodedFile); } catch (_) {}
    // Resolve only a known note from the site's index, including legacy double-encoded URLs.
    try {
      const index = await fetch('data/notes-index.json').then(res => res.json());
      const item = index.find(note => note.file === file);
      if (item) {
        const [markdown] = await Promise.all([loadNoteMarkdown(file), loadMarkdownIt()]);
        if (notesPage.isConnected && new URLSearchParams(location.search).get('note') === encodedFile) {
          renderDetailView(parseMarkdownToNote(markdown, item), () => initNotesPage(), false);
        }
        return;
      }
    } catch (err) {
      // A failed deep link falls back to the list instead of leaving the page empty.
      console.warn('笔记深链接恢复失败：', err);
    }
  }

  const noteCards = await renderNotesFromJSON();
  if (!notesPage.isConnected) return; // 加载期间已离开笔记页：不要把筛选绑到新页面上
  bindNotesFilter(noteCards);
}

document.addEventListener("DOMContentLoaded", initNotesPage);
window.initNotesPage = initNotesPage;
