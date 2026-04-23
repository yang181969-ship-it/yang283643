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
 * 滚动位置保存：跳详情前存 scrollY，返回时恢复
 * ============================================================= */
let _updateListScrollY = 0;

function saveUpdateListScroll() {
  const scroller = document.querySelector(".content-scroll");
  if (scroller) _updateListScrollY = scroller.scrollTop;
}

function restoreUpdateListScroll() {
  const scroller = document.querySelector(".content-scroll");
  if (!scroller) return;
  // 在 DOM 渲染完成后恢复
  requestAnimationFrame(() => {
    scroller.scrollTop = _updateListScrollY;
  });
}

/* =============================================================
 * 详情视图(SPA 内渲染,复用 #main-content)
 *
 * 关键修复：
 *   - 返回按钮用 history.back() 而不是再 pushState 一条新历史
 *     （原来的 pushState 会把历史栈搞成 [..., 列表, 详情, 列表(新)]，
 *      用户再按浏览器后退会回到 [..., 列表, 详情]，又进了详情页）
 *   - 返回时恢复列表滚动位置
 * ============================================================= */
function renderUpdateDetailView(item, onBack) {
  const main = document.getElementById("main-content");
  if (!main) return;

  const wrapper = document.createElement("section");
  wrapper.className = "update-page update-detail-page no-card";
  wrapper.innerHTML = `
    <div class="update-detail-back">
      <button type="button" class="update-back-btn" id="update-back-btn">
        <span aria-hidden="true">←</span>
        <span>返回更新日志</span>
      </button>
    </div>
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

  /* 返回按钮：直接走浏览器历史 back，这样跟浏览器后退键行为一致 */
  const backBtn = wrapper.querySelector("#update-back-btn");
  if (backBtn) {
    backBtn.addEventListener("click", () => {
      history.back();
    });
  }

  /* 更新 URL(便于刷新/分享保持在详情页) */
  const url = new URL(window.location.href);
  const currentUpdateParam = url.searchParams.get("update");
  url.searchParams.set("update", item.file);

  if (currentUpdateParam === item.file) {
    // 当前 URL 已经是这个详情（例如从外部直接打开 ?update=xxx），用 replace 避免多推
    history.replaceState(
      { page: "update", update: item.file },
      "",
      url.toString()
    );
  } else {
    history.pushState(
      { page: "update", update: item.file },
      "",
      url.toString()
    );
  }
}

/* =============================================================
 * 渲染列表:从 JSON 索引 → 一组卡片
 * ============================================================= */
let _updateRendering = false;
let _updateItemsCache = null;  // 缓存所有条目，返回时不用重新 fetch 所有 md

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
        // 跳详情前先存滚动位置
        saveUpdateListScroll();
        renderUpdateDetailView(item);
      });

      listEl.appendChild(card);
    });

    // 若 URL 里带 ?update=xxx,自动进入对应详情（直接打开链接的场景）
    const url = new URL(window.location.href);
    const targetFile = url.searchParams.get("update");
    if (targetFile) {
      const target = items.find((i) => i.file === targetFile);
      if (target) {
        renderUpdateDetailView(target);
      }
    }
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
        <div class="update-hero">
          <h2 class="page-title">更新日志</h2>
          <p class="page-desc">这里记录这个网站每一次较重要的功能新增与页面优化</p>
        </div>
        <div class="update-list" id="update-list"></div>
      </section>
    `;
  }

  await renderUpdatesFromJSON();
}

/* =============================================================
 * 浏览器前进/后退
 *
 * 场景处理：
 *   1. 从详情页 back → URL 变成 ?page=update（无 update 参数）
 *      → 重建列表 + 恢复滚动位置
 *   2. 从列表页 back 到其他页 → URL 的 page 变成别的 → 不干预（main.js 处理）
 *   3. 前进到详情 → 重新渲染详情视图
 * ============================================================= */
window.addEventListener("popstate", () => {
  const url = new URL(window.location.href);
  const onUpdatePage = url.searchParams.get("page") === "update";
  if (!onUpdatePage) return; // 不在更新页就不干预,交给 main.js 的 SPA 路由

  const targetFile = url.searchParams.get("update");

  if (targetFile) {
    // 前进到详情（或 forward 到详情）：如果当前不是对应详情视图，重新渲染
    const currentDetailTitle = document
      .querySelector(".update-detail-title")
      ?.textContent?.trim();
    if (_updateItemsCache) {
      const target = _updateItemsCache.find((i) => i.file === targetFile);
      if (target && target.title !== currentDetailTitle) {
        renderUpdateDetailView(target);
      }
    } else {
      // 没缓存就老老实实走 init
      initUpdatePage();
    }
  } else {
    // 回到列表：重建列表骨架 + 恢复滚动
    (async () => {
      await initUpdatePage();
      restoreUpdateListScroll();
    })();
  }
});

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
  // 注意：这里不再主动调 initUpdatePage()。
  // 原因：main.js 是 defer，这个脚本可能先跑（index.html 里 update.js 没加 defer），
  // 如果直接访问 ?page=update 时这里先把 #main-content 替换掉，
  // main.js 抓 homeContent 就会抓到错误内容（问题 3 的根因）。
  //
  // 初始化交给两个路径来做：
  //   (a) main.js 的 loadPage 会调用 runPageInit("update") → window.initUpdatePage()
  //   (b) watchForUpdatePage 的 MutationObserver 会在骨架被塞进来时自动触发
});

window.initUpdatePage = initUpdatePage;