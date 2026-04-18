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

/* ===== 极简 Markdown 渲染 =====
   说明：
   1. 保留空行分段
   2. 数学公式块 \[ \] / $$ $$ 原样保留给 KaTeX
   3. 行内公式 \( \) / $ $ 也原样保留
   4. 支持最基础的标题、列表、段落、代码块
*/
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

    // 代码块
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

    // 数学块
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

    // 空行
    if (!line) {
      flushParagraph();
      flushList();
      continue;
    }

    // 单独一行显示公式（宽松处理）
    if (isDisplayMathLine(rawLine) && !inMathBlock) {
      flushParagraph();
      flushList();
      html.push(`<div class="note-formula">${rawLine}</div>`);
      continue;
    }

    // 标题
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

    // 列表
    if (line.startsWith("- ") || line.startsWith("* ")) {
      flushParagraph();
      listBuffer.push(line.slice(2));
      continue;
    }

    // 普通段落
    paragraphBuffer.push(rawLine);
  }

  flushParagraph();
  flushList();
  flushCodeBlock();
  flushMathBlock();

  return html.join("\n");
}

/* ===== 将一个 Markdown 文件拆成多篇笔记 =====
   约定格式示例：

   # 傅里叶级数的基本形式
   @category: 微积分
   @meta: 示例笔记

   正文...

   ---
   # 收敛性问题
   @category: 微积分

   正文...
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

      contentLines.push(rawLine);
    }

    const content = contentLines.join("\n").trim();

    return {
      id: `${fallback.file || "note"}-${index}`,
      title: title || fallback.title || "未命名笔记",
      category: category || "未分类",
      meta: meta || "",
      content
    };
  });
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

    // 清空旧卡片，但保留 empty 元素
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

        article.innerHTML = `
          <div class="note-card-top">
            <span class="note-tag">${escapeHtml(note.category)}</span>
            <span class="note-meta">${escapeHtml(note.meta)}</span>
          </div>
          <h2>${escapeHtml(note.title)}</h2>
          <div class="note-markdown">
            ${simpleMarkdownToHtml(note.content)}
          </div>
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

/* ===== 绑定分类筛选 ===== */
function bindNotesFilter(noteCards) {
  const notesPage = document.querySelector(".notes-page");
  if (!notesPage) return;

  const groupToggles = notesPage.querySelectorAll(".notes-group-toggle");
  const categoryButtons = notesPage.querySelectorAll(".notes-category");
  const emptyState = notesPage.querySelector("#notes-empty");

  function clearActiveStates() {
    groupToggles.forEach((btn) => btn.classList.remove("active"));
    categoryButtons.forEach((btn) => btn.classList.remove("active"));
  }

  function filterAllNotes() {
    noteCards.forEach((card) => card.classList.remove("is-hidden"));
    if (emptyState) emptyState.hidden = true;
    renderMathInCards(noteCards);
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
  }

  groupToggles.forEach((toggle) => {
    toggle.addEventListener("click", () => {
      const parentGroup = toggle.closest(".notes-group");
      const mode = toggle.dataset.mode;
      const groupName = toggle.dataset.group;

      if (mode === "all") {
        clearActiveStates();
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
      clearActiveStates();
      button.classList.add("active");

      const parentGroup = button.closest(".notes-group");
      if (parentGroup) {
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

  const defaultOverview = notesPage.querySelector('.notes-group-toggle[data-mode="all"]');
  if (defaultOverview) {
    clearActiveStates();
    defaultOverview.classList.add("active");
    filterAllNotes();
  } else {
    renderMathInCards(noteCards);
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