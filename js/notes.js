/* ===== 动态加载 KaTeX 和 p5.js（只在笔记页面需要时才加载） ===== */
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

// ===== KaTeX：全局只加载一次 =====
let _katexPromise = null;

function loadKaTeX() {
  if (_katexPromise) return _katexPromise;
  _katexPromise = loadScript("https://cdn.bootcdn.net/ajax/libs/KaTeX/0.16.9/katex.min.js")
    .then(() =>
      loadScript("https://cdn.bootcdn.net/ajax/libs/KaTeX/0.16.9/contrib/auto-render.min.js")
    );
  return _katexPromise;
}

function loadP5() {
  return loadScript("https://cdn.bootcdn.net/ajax/libs/p5.js/1.11.3/p5.min.js");
}

// ===== 提前预加载 KaTeX =====
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

/* ===== 极简 Markdown 渲染 ===== */
function simpleMarkdownToHtml(md) {
  const text = normalizeLineEndings(md).trim();
  if (!text) return "";

  const lines = text.split("\n");
  const html = [];

  let paragraphBuffer = [];
  let listBuffer = [];
  let inCodeBlock = false;
  let codeBuffer = [];

  function flushParagraph() {
    if (!paragraphBuffer.length) return;
    const content = paragraphBuffer.join("<br>");
    html.push(`<p>${content}</p>`);
    paragraphBuffer = [];
  }

  function flushList() {
    if (!listBuffer.length) return;
    html.push("<ul>");
    listBuffer.forEach((item) => {
      html.push(`<li>${item}</li>`);
    });
    html.push("</ul>");
    listBuffer = [];
  }

  function flushCodeBlock() {
    if (!codeBuffer.length) return;
    html.push(
      `<pre><code>${escapeHtml(codeBuffer.join("\n"))}</code></pre>`
    );
    codeBuffer = [];
  }

  function isDisplayMathLine(line) {
    const t = line.trim();
    return (
      t.startsWith("\\[") ||
      t.endsWith("\\]") ||
      t.startsWith("$$") ||
      t.endsWith("$$")
    );
  }

  let mathBlockBuffer = [];
  let inMathBlock = false;

  function flushMathBlock() {
    if (!mathBlockBuffer.length) return;
    html.push(`<div class="note-formula">${mathBlockBuffer.join("\n")}</div>`);
    mathBlockBuffer = [];
  }

  for (let i = 0; i < lines.length; i++) {
    const rawLine = lines[i];
    const line = rawLine.trim();

    if (line.startsWith("```")) {
      flushParagraph();
      flushList();
      if (!inCodeBlock) {
        inCodeBlock = true;
      } else {
        inCodeBlock = false;
        flushCodeBlock();
      }
      continue;
    }

    if (inCodeBlock) {
      codeBuffer.push(rawLine);
      continue;
    }

    if (!inMathBlock && (line === "\\[" || line === "$$")) {
      flushParagraph();
      flushList();
      inMathBlock = true;
      mathBlockBuffer.push(rawLine);
      continue;
    }

    if (inMathBlock) {
      mathBlockBuffer.push(rawLine);
      if (line === "\\]" || line === "$$") {
        inMathBlock = false;
        flushMathBlock();
      }
      continue;
    }

    if (!line) {
      flushParagraph();
      flushList();
      continue;
    }

    if (isDisplayMathLine(rawLine) && !inMathBlock) {
      flushParagraph();
      flushList();
      html.push(`<div class="note-formula">${rawLine}</div>`);
      continue;
    }

    if (line.startsWith("### ")) {
      flushParagraph();
      flushList();
      html.push(`<h3>${line.slice(4)}</h3>`);
      continue;
    }

    if (line.startsWith("## ")) {
      flushParagraph();
      flushList();
      html.push(`<h2>${line.slice(3)}</h2>`);
      continue;
    }

    if (line.startsWith("# ")) {
      flushParagraph();
      flushList();
      html.push(`<h1>${line.slice(2)}</h1>`);
      continue;
    }

    if (line.startsWith("- ") || line.startsWith("* ")) {
      flushParagraph();
      listBuffer.push(line.slice(2));
      continue;
    }

    paragraphBuffer.push(rawLine);
  }

  flushParagraph();
  flushList();
  flushCodeBlock();
  flushMathBlock();

  return html.join("\n");
}

/* ===== 将一个 Markdown 文件拆成多篇笔记 =====
   支持字段：
     @category: 分类
     @meta:     说明文字
     @date:     写入时间，格式 YYYY-MM-DD
*/
function parseMarkdownToNotes(md, fallback = {}) {
  const raw = normalizeLineEndings(md);

  const blocks = raw
    .split(/\n---+\n/g)
    .map((s) => s.trim())
    .filter(Boolean);

  return blocks.map((block, index) => {
    const lines = block.split("\n");

    let title = "";
    let category = fallback.category || "";
    let meta = fallback.meta || "";
    let date = fallback.date || "";
    const contentLines = [];

    for (const rawLine of lines) {
      const line = rawLine.trim();

      if (!title && line.startsWith("# ")) {
        title = line.replace(/^#\s+/, "").trim();
        continue;
      }

      if (line.startsWith("@category:")) {
        category = line.replace("@category:", "").trim();
        continue;
      }

      if (line.startsWith("@meta:")) {
        meta = line.replace("@meta:", "").trim();
        continue;
      }

      if (line.startsWith("@date:")) {
        date = line.replace("@date:", "").trim();
        continue;
      }

      contentLines.push(rawLine);
    }

    const content = contentLines.join("\n").trim();

    return {
      id: `${fallback.file || "note"}-${index}`,
      title: title || fallback.title || "未命名笔记",
      category: category || "未分类",
      meta: meta || "",
      date: date || "",
      content,
      // 保留原始文件路径，供详情页使用
      file: fallback.file || "",
      blockIndex: index
    };
  });
}

/* ===== 格式化日期显示（YYYY-MM-DD → 本地短日期） ===== */
function formatDate(dateStr) {
  if (!dateStr) return "";
  const d = new Date(dateStr + "T00:00:00");
  if (isNaN(d.getTime())) return dateStr;
  return d.toLocaleDateString("zh-CN", { year: "numeric", month: "2-digit", day: "2-digit" });
}

/* ===== 加载单个 Markdown 文件 ===== */
async function loadNoteMarkdown(file) {
  const res = await fetch(file);
  if (!res.ok) {
    throw new Error(`加载失败: ${file}`);
  }
  return await res.text();
}

/* ===== 从 JSON 索引动态渲染所有笔记 ===== */
async function renderNotesFromJSON() {
  const notesPage = document.querySelector(".notes-page");
  if (!notesPage) return [];

  const container = document.getElementById("notes-content");
  const emptyState = document.getElementById("notes-empty");

  if (!container) return [];

  try {
    const indexRes = await fetch("data/notes-index.json");
    if (!indexRes.ok) {
      throw new Error("notes-index.json 加载失败");
    }

    const notesIndex = await indexRes.json();

    container.innerHTML = "";
    if (emptyState) container.appendChild(emptyState);

    const allCards = [];

    for (const item of notesIndex) {
      const mdText = await loadNoteMarkdown(item.file);
      const notes = parseMarkdownToNotes(mdText, item);

      notes.forEach((note) => {
        const article = document.createElement("article");
        article.className = "note-card";
        article.dataset.category = note.category;
        article.dataset.date = note.date || "";
        article.dataset.noteId = note.id;

        // 点击卡片跳转到详情页
        article.addEventListener("click", () => {
          const params = new URLSearchParams({
            file: note.file,
            index: note.blockIndex
          });
          window.location.href = `notes-detail.html?${params.toString()}`;
        });

        const dateDisplay = note.date
          ? `<span class="note-date">${formatDate(note.date)}</span>`
          : "";

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

        container.insertBefore(article, emptyState || null);
        allCards.push(article);
      });
    }

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

/* ===== 按日期对【当前可见】卡片重新排序（纯 DOM 操作） ===== */
function sortCardsByDate(noteCards, direction) {
  const container = document.getElementById("notes-content");
  const emptyState = document.getElementById("notes-empty");
  if (!container) return;

  const visible = noteCards.filter((c) => !c.classList.contains("is-hidden"));

  const sorted = [...visible].sort((a, b) => {
    const da = a.dataset.date || "";
    const db = b.dataset.date || "";
    if (!da && !db) return 0;
    if (!da) return 1;
    if (!db) return -1;
    return direction === "asc"
      ? da.localeCompare(db)
      : db.localeCompare(da);
  });

  sorted.forEach((card) => container.insertBefore(card, emptyState || null));
}

/* ===== 绑定分类筛选 + 内容区时间排序 ===== */
function bindNotesFilter(noteCards) {
  const notesPage = document.querySelector(".notes-page");
  if (!notesPage) return;

  const groupToggles = notesPage.querySelectorAll(".notes-group-toggle");
  const categoryButtons = notesPage.querySelectorAll(".notes-category");
  const sortButtons = notesPage.querySelectorAll(".notes-sort");
  const emptyState = notesPage.querySelector("#notes-empty");

  let activeSortDirection = null;

  function clearNavActiveStates() {
    groupToggles.forEach((btn) => btn.classList.remove("active"));
    categoryButtons.forEach((btn) => btn.classList.remove("active"));
  }

  function clearSortActiveStates() {
    sortButtons.forEach((btn) => btn.classList.remove("active"));
  }

  function applyCurrentSort() {
    if (activeSortDirection) {
      sortCardsByDate(noteCards, activeSortDirection);
    }
  }

  function filterAllNotes() {
    noteCards.forEach((card) => card.classList.remove("is-hidden"));
    if (emptyState) emptyState.hidden = true;
    renderMathInCards(noteCards);
    applyCurrentSort();
  }

  function filterNotesByCategory(category) {
    let visibleCount = 0;
    const nowVisible = [];

    noteCards.forEach((card) => {
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

  groupToggles.forEach((toggle) => {
    toggle.addEventListener("click", () => {
      const parentGroup = toggle.closest(".notes-group");
      const mode = toggle.dataset.mode;
      const groupName = toggle.dataset.group;

      if (mode === "all") {
        clearNavActiveStates();
        toggle.classList.add("active");

        notesPage.querySelectorAll(".notes-group").forEach((group) => {
          if (group.querySelector('[data-mode="all"]')) {
            group.classList.add("is-open");
          } else {
            group.classList.remove("is-open");
          }
        });

        filterAllNotes();
        return;
      }

      if (groupName && parentGroup) {
        const isOpen = parentGroup.classList.contains("is-open");

        notesPage.querySelectorAll(".notes-group").forEach((group) => {
          if (group !== parentGroup && !group.querySelector('[data-mode="all"]')) {
            group.classList.remove("is-open");
          }
        });

        parentGroup.classList.toggle("is-open", !isOpen);
      }
    });
  });

  categoryButtons.forEach((button) => {
    button.addEventListener("click", () => {
      clearNavActiveStates();
      button.classList.add("active");

      const parentGroup = button.closest(".notes-group");
      if (parentGroup) {
        const parentToggle = parentGroup.querySelector(".notes-group-toggle");
        if (parentToggle) parentToggle.classList.add("active");

        notesPage.querySelectorAll(".notes-group").forEach((group) => {
          if (group !== parentGroup && !group.querySelector('[data-mode="all"]')) {
            group.classList.remove("is-open");
          }
        });
        parentGroup.classList.add("is-open");
      }

      filterNotesByCategory(button.dataset.category);
    });
  });

  sortButtons.forEach((button) => {
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