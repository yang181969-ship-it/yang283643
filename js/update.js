/* =============================================================
 * 更新日志页
 * 从 data/updates-index.json 加载 md 索引 → 渲染卡片 → 点击跳详情
 * 架构参考 js/notes.js,但砍掉分类筛选/排序/TOC
 * ============================================================= */

/* ===== 小工具 ===== */
function updateEscapeHtml(str) {
  return String(str ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

function updateNormalizeLineEndings(text) {
  return String(text || "").replace(/\r\n/g, "\n").replace(/\r/g, "\n");
}

/** 把 "2026-04-22" 格式化成 "2026年4月22日" */
function formatUpdateDate(dateStr) {
  if (!dateStr) return "";
  const m = dateStr.match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/);
  if (!m) return dateStr;
  return `${m[1]}年${parseInt(m[2], 10)}月${parseInt(m[3], 10)}日`;
}

/* =============================================================
 * 极简 Markdown 渲染（保持原样）
 * ============================================================= */
function updateRenderMarkdown(md) {
  const text = updateNormalizeLineEndings(md).trim();
  if (!text) return "";

  const lines = text.split("\n");
  const html = [];

  let paragraphBuffer = [];
  let listBuffer = [];
  let inCodeBlock = false;
  let codeBuffer = [];
  let tableBuffer = [];
  let inTable = false;

  function flushParagraph() {
    if (!paragraphBuffer.length) return;
    html.push(`<p>${paragraphBuffer.map(inlineFormat).join("<br>")}</p>`);
    paragraphBuffer = [];
  }
  function flushList() {
    if (!listBuffer.length) return;
    html.push(
      "<ul>" +
      listBuffer.map((i) => `<li>${inlineFormat(i)}</li>`).join("") +
      "</ul>"
    );
    listBuffer = [];
  }
  function flushCodeBlock() {
    if (!codeBuffer.length) return;
    html.push(`<pre><code>${updateEscapeHtml(codeBuffer.join("\n"))}</code></pre>`);
    codeBuffer = [];
  }
  function flushTable() {
    if (!tableBuffer.length) return;
    const rows = tableBuffer
      .map((l) => l.trim().replace(/^\|/, "").replace(/\|$/, ""))
      .filter(Boolean);
    if (rows.length >= 2) {
      const headers = rows[0].split("|").map((c) => c.trim());
      const bodyRows = rows.slice(2).map((r) => r.split("|").map((c) => c.trim()));
      const thead =
        "<thead><tr>" +
        headers.map((h) => `<th>${inlineFormat(h)}</th>`).join("") +
        "</tr></thead>";
      const tbody =
        "<tbody>" +
        bodyRows
          .map(
            (r) =>
              "<tr>" +
              r.map((c) => `<td>${inlineFormat(c)}</td>`).join("") +
              "</tr>"
          )
          .join("") +
        "</tbody>";
      html.push(`<div class="update-table-wrap"><table class="update-table">${thead}${tbody}</table></div>`);
    }
    tableBuffer = [];
  }

  function inlineFormat(raw) {
    let s = updateEscapeHtml(raw);
    s = s.replace(/`([^`]+)`/g, (_, code) => `<code>${code}</code>`);
    s = s.replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>");
    return s;
  }

  for (const rawLine of lines) {
    const line = rawLine.trim();

    if (line.startsWith("```")) {
      flushParagraph();
      flushList();
      flushTable();
      inTable = false;
      inCodeBlock = inCodeBlock ? (flushCodeBlock(), false) : true;
      continue;
    }
    if (inCodeBlock) {
      codeBuffer.push(rawLine);
      continue;
    }

    if (line.startsWith("|")) {
      if (!inTable) {
        flushParagraph();
        flushList();
        inTable = true;
      }
      tableBuffer.push(line);
      continue;
    } else if (inTable) {
      flushTable();
      inTable = false;
    }

    if (!line) {
      flushParagraph();
      flushList();
      continue;
    }

    if (line.startsWith("### ")) { flushParagraph(); flushList(); html.push(`<h3>${inlineFormat(line.slice(4))}</h3>`); continue; }
    if (line.startsWith("## "))  { flushParagraph(); flushList(); html.push(`<h2>${inlineFormat(line.slice(3))}</h2>`); continue; }
    if (line.startsWith("# "))   { flushParagraph(); flushList(); html.push(`<h1>${inlineFormat(line.slice(2))}</h1>`); continue; }

    if (line === "---" || line === "***") {
      flushParagraph(); flushList();
      html.push(`<hr>`);
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
  flushTable();
  return html.join("\n");
}

/* =============================================================
 * 解析单个 md 文件 → 一条更新条目
 * ============================================================= */
function parseUpdateMarkdown(md, fallback = {}) {
  const raw = updateNormalizeLineEndings(md).trim();
  const lines = raw.split("\n");

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
    if (line.startsWith("@category:")) { category = line.replace("@category:", "").trim(); continue; }
    if (line.startsWith("@meta:"))     { meta = line.replace("@meta:", "").trim(); continue; }
    if (line.startsWith("@date:"))     { date = line.replace("@date:", "").trim(); continue; }
    contentLines.push(rawLine);
  }

  return {
    title: title || fallback.title || "未命名更新",
    category: category || "建站日志",
    meta: meta || "",
    date: date || "",
    content: contentLines.join("\n").trim(),
    file: fallback.file || "",
  };
}

async function loadUpdateMarkdown(file) {
  const res = await fetch(file);
  if (!res.ok) throw new Error(`加载失败: ${file}`);
  return res.text();
}

/* =============================================================
 * 详情视图(SPA 内渲染,复用 #main-content)
 * 详情页是纯展示,没有返回按钮、不操作 history、不操作 URL。
 * 用户回列表靠 nav 链接或浏览器原生后退键。
 * ============================================================= */
function renderUpdateDetailView(item) {
  const main = document.getElementById("main-content");
  if (!main) return;

  const wrapper = document.createElement("section");
  wrapper.className = "update-page update-detail-page no-card";
  wrapper.innerHTML = `
    <article class="update-detail-card">
      <div class="update-detail-top">
        <span class="update-tag">${updateEscapeHtml(item.category)}</span>
        <span class="update-detail-date">${updateEscapeHtml(formatUpdateDate(item.date))}</span>
      </div>
      <h2 class="update-detail-title">${updateEscapeHtml(item.title)}</h2>
      <div class="update-detail-body update-markdown-full">
        ${updateRenderMarkdown(item.content)}
      </div>
    </article>
  `;

  main.innerHTML = "";
  main.appendChild(wrapper);

  // 详情页滚到顶
  const scrollEl = document.querySelector(".content-scroll");
  if (scrollEl) scrollEl.scrollTo({ top: 0, behavior: "smooth" });
}

/* =============================================================
 * 渲染列表:从 JSON 索引 → 一组卡片
 * ============================================================= */
let _updateRendering = false;
let _updateItemsCache = null;  // 缓存所有条目

async function renderUpdatesFromJSON() {
  const listEl = document.getElementById("update-list");
  if (!listEl) return;
  if (_updateRendering) return;
  _updateRendering = true;

  try {
    let items = _updateItemsCache;

    if (!items) {
      const indexRes = await fetch("data/updates-index.json");
      if (!indexRes.ok) throw new Error("updates-index.json 加载失败");
      const index = await indexRes.json();

      items = await Promise.all(
        index.map(async (entry) => {
          const md = await loadUpdateMarkdown(entry.file);
          return parseUpdateMarkdown(md, entry);
        })
      );

      items.sort((a, b) => (b.date || "").localeCompare(a.date || ""));
      _updateItemsCache = items;
    }

    listEl.innerHTML = "";

    items.forEach((item) => {
      const card = document.createElement("article");
      card.className = "update-card";
      card.dataset.file = item.file;
      card.dataset.date = item.date || "";

      card.innerHTML = `
        <div class="update-card-header">${updateEscapeHtml(formatUpdateDate(item.date))} 更新内容</div>
        <div class="update-card-body">
          <h3>${updateEscapeHtml(item.title)}</h3>
          <span class="update-read-more">查看详情 →</span>
        </div>
      `;

      card.addEventListener("click", () => {
        renderUpdateDetailView(item);
      });

      listEl.appendChild(card);
    });
  } catch (err) {
    console.error(err);
    listEl.innerHTML = `
      <p class="notes-empty">
        更新日志加载失败,请检查 <code>data/updates-index.json</code> 路径及各 md 文件路径,或查看控制台报错。
      </p>
    `;
  } finally {
    _updateRendering = false;
  }
}

/* =============================================================
 * 页面初始化
 *
 * 守卫规则:只有当前真的在"更新页"上下文下才执行。
 * ============================================================= */
async function initUpdatePage() {
  const main = document.getElementById("main-content");
  if (!main) return;

  const urlParams = new URL(window.location.href).searchParams;
  const onUpdatePage =
    document.querySelector(".update-page") !== null ||
    urlParams.get("page") === "update";
  if (!onUpdatePage) return;

  // 如果骨架已被详情视图替换（返回时会遇到），重建列表骨架
  if (!document.getElementById("update-list")) {
    main.innerHTML = `
      <section class="update-page no-card">
        <div class="update-list" id="update-list"></div>
      </section>
    `;
  }

  await renderUpdatesFromJSON();
}

/* =============================================================
 * SPA 切页自动响应
 * ============================================================= */
function watchForUpdatePage() {
  const main = document.getElementById("main-content");
  if (!main) return;

  const check = () => {
    const page = main.querySelector(".update-page");
    if (!page) return;
    if (page.dataset.updateInitialized === "1") return;
    if (page.classList.contains("update-detail-page")) return;
    const list = main.querySelector("#update-list");
    if (list && !list.children.length) {
      page.dataset.updateInitialized = "1";
      initUpdatePage();
    }
  };

  check();

  const mo = new MutationObserver(check);
  mo.observe(main, { childList: true, subtree: true });
}

document.addEventListener("DOMContentLoaded", () => {
  watchForUpdatePage();
  // 初始化交给两个路径来做：
  //   (a) main.js 的 loadPage 会调用 runPageInit("update") → window.initUpdatePage()
  //   (b) watchForUpdatePage 的 MutationObserver 会在骨架被塞进来时自动触发
});

window.initUpdatePage = initUpdatePage;