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

/* ===== 极简 Markdown 渲染（详情模式：给标题加 id 锚点） ===== */
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
    const slug = "h-" + (++headingCounter) + "-" +
      text.trim().replace(/\s+/g, "-").replace(/[^\w\u4e00-\u9fa5-]/g, "").slice(0, 30);
    return `<h${level} id="${slug}">${text}</h${level}>`;
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

/* ===== 从已渲染的卡片 DOM 提取 TOC 条目 ===== */
function buildTocItems(cardEl) {
  const headings = cardEl.querySelectorAll("h1[id], h2[id], h3[id]");
  return Array.from(headings).map(h => ({
    id: h.id,
    text: h.textContent.trim(),
    level: parseInt(h.tagName[1], 10)
  }));
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
      <a class="note-toc-link" href="#${item.id}" data-toc-id="${item.id}">${escapeHtml(item.text)}</a>
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
function renderDetailView(note, onBack) {
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
      ${simpleMarkdownToHtml(note.content, true)}
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
  url.searchParams.set("note", encodeURIComponent(note.file));
  url.searchParams.delete("noteIndex"); // 清掉旧参数(如果是老链接带进来的)
  history.pushState({ page: "notes", note: note.file }, "", url.toString());
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

    container.innerHTML = "";
    if (emptyState) container.appendChild(emptyState);

    const allCards = [];

    // 并发加载所有 md,提速
    const notes = await Promise.all(
      notesIndex.map(async (item) => {
        const mdText = await loadNoteMarkdown(item.file);
        return parseMarkdownToNote(mdText, item);
      })
    );

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
          ${simpleMarkdownToHtml(note.content)}
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

  const noteCards = await renderNotesFromJSON();
  bindNotesFilter(noteCards);
}

document.addEventListener("DOMContentLoaded", initNotesPage);
window.initNotesPage = initNotesPage;