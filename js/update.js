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
 * 极简 Markdown 渲染
 * 支持:# ## ### 标题、- * 列表、``` 代码块、段落、行内 `code`、**bold**
 * 不支持:图片、表格(表格是今天 md 里唯一用到的进阶语法,加一个极简解析)
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
    // 第一行表头,第二行分隔线(|---|---|),其余是数据
    const rows = tableBuffer
      .map((l) => l.trim().replace(/^\|/, "").replace(/\|$/, ""))
      .filter(Boolean);
    if (rows.length >= 2) {
      const headers = rows[0].split("|").map((c) => c.trim());
      // rows[1] 是分隔线,跳过
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

  /** 行内格式:**bold**, `code` */
  function inlineFormat(raw) {
    // 先 escape,再处理 `code` 和 **bold**(用占位符避免转义冲突)
    let s = updateEscapeHtml(raw);
    // 行内代码
    s = s.replace(/`([^`]+)`/g, (_, code) => `<code>${code}</code>`);
    // 粗体
    s = s.replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>");
    return s;
  }

  for (const rawLine of lines) {
    const line = rawLine.trim();

    // 代码块 ```
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

    // 表格行:以 | 开头
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

    // 空行
    if (!line) {
      flushParagraph();
      flushList();
      continue;
    }

    // 标题
    if (line.startsWith("### ")) { flushParagraph(); flushList(); html.push(`<h3>${inlineFormat(line.slice(4))}</h3>`); continue; }
    if (line.startsWith("## "))  { flushParagraph(); flushList(); html.push(`<h2>${inlineFormat(line.slice(3))}</h2>`); continue; }
    if (line.startsWith("# "))   { flushParagraph(); flushList(); html.push(`<h1>${inlineFormat(line.slice(2))}</h1>`); continue; }

    // 水平分隔线
    if (line === "---" || line === "***") {
      flushParagraph(); flushList();
      html.push(`<hr>`);
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
  flushTable();
  return html.join("\n");
}

/* =============================================================
 * 解析单个 md 文件 → 一条更新条目
 * 格式:
 *   # 标题
 *   @category: 建站日志
 *   @meta: 可选关键词
 *   @date: 2026-04-22
 *
 *   正文...
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

  const scrollEl = document.querySelector(".content-scroll");
  if (scrollEl) scrollEl.scrollTo({ top: 0, behavior: "smooth" });

  /* 返回按钮:恢复列表视图 */
  const backBtn = wrapper.querySelector("#update-back-btn");
  if (backBtn) {
    backBtn.addEventListener("click", () => {
      // 清除 URL 上的 update 参数,保留 page=update
      const url = new URL(window.location.href);
      url.searchParams.delete("update");
      history.pushState({ page: "update" }, "", url.toString());
      if (typeof onBack === "function") onBack();
    });
  }

  /* 更新 URL(便于刷新/分享保持在详情页) */
  const url = new URL(window.location.href);
  const currentUpdateParam = url.searchParams.get("update");
  url.searchParams.set("update", item.file);
  // 如果当前 URL 已经匹配当前 item(例如从外部 URL 直接打开),用 replaceState 避免多推一条历史
  if (currentUpdateParam === item.file) {
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
 * 用布尔锁避免 MutationObserver 和显式调用同时触发导致的双重渲染
 * ============================================================= */
let _updateRendering = false;
async function renderUpdatesFromJSON() {
  const listEl = document.getElementById("update-list");
  if (!listEl) return;
  if (_updateRendering) return;
  _updateRendering = true;

  try {
    const indexRes = await fetch("data/updates-index.json");
    if (!indexRes.ok) throw new Error("updates-index.json 加载失败");
    const index = await indexRes.json();

    // 并发加载所有 md,提速
    const items = await Promise.all(
      index.map(async (entry) => {
        const md = await loadUpdateMarkdown(entry.file);
        return parseUpdateMarkdown(md, entry);
      })
    );

    // 按日期倒序(最新在上),索引里顺序如果已排好也不会错
    items.sort((a, b) => (b.date || "").localeCompare(a.date || ""));

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
        renderUpdateDetailView(item, () => initUpdatePage());
      });

      listEl.appendChild(card);
    });

    // 若 URL 里带 ?update=xxx,自动进入对应详情
    const url = new URL(window.location.href);
    const targetFile = url.searchParams.get("update");
    if (targetFile) {
      const target = items.find((i) => i.file === targetFile);
      if (target) {
        renderUpdateDetailView(target, () => initUpdatePage());
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
 * 守卫规则:只有当前真的在"更新页"上下文下才执行,否则立即退出。
 * 判断依据:
 *   (a) 页面里存在 .update-page 容器(SPA 加载 update.html 片段后就会有)
 *   (b) 或 URL 里 ?page=update(用于 popstate 和直接访问场景)
 * 缺一不可——如果用户现在在主页,#main-content 里只有主页内容,
 * 这里绝不能主动插入更新页骨架,否则会把主页内容冲掉。
 * ============================================================= */
async function initUpdatePage() {
  const main = document.getElementById("main-content");
  if (!main) return;

  const urlParams = new URL(window.location.href).searchParams;
  const onUpdatePage =
    document.querySelector(".update-page") !== null ||
    urlParams.get("page") === "update";
  if (!onUpdatePage) return;

  // 如果骨架已被详情视图替换(返回时会遇到),重建列表骨架
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
 * 用户在详情页按后退 → URL 变回 ?page=update(没有 update 参数) → 回到列表
 * ============================================================= */
window.addEventListener("popstate", () => {
  const url = new URL(window.location.href);
  const onUpdatePage = url.searchParams.get("page") === "update";
  if (!onUpdatePage) return; // 不在更新页就不干预,交给 main.js 的 SPA 路由

  // 无论 update 参数在不在都重新走一遍 init:它会根据 URL 决定渲列表还是详情
  initUpdatePage();
});

/* =============================================================
 * SPA 切页自动响应
 *
 * main.js 切换到更新页时,会把 update.html 片段塞进 #main-content——
 * 此时 DOM 里会出现 .update-page 容器,但 main.js 未必主动调用 initUpdatePage。
 * 为了不依赖 main.js 的配合,这里用 MutationObserver 观察 #main-content:
 * 一旦发现 .update-page 出现且还没渲染过(#update-list 是空的),就自动初始化。
 *
 * 用 dataset.updateInitialized 做去重,避免重复渲染。
 * ============================================================= */
function watchForUpdatePage() {
  const main = document.getElementById("main-content");
  if (!main) return;

  const check = () => {
    const page = main.querySelector(".update-page");
    if (!page) return;
    // 已经初始化过、或当前是详情视图,都不要再跑
    if (page.dataset.updateInitialized === "1") return;
    if (page.classList.contains("update-detail-page")) return;
    const list = main.querySelector("#update-list");
    // 列表容器存在且为空时才初始化
    if (list && !list.children.length) {
      page.dataset.updateInitialized = "1";
      initUpdatePage();
    }
  };

  // 初次检查(DOMContentLoaded 时片段可能已经在了)
  check();

  const mo = new MutationObserver(check);
  mo.observe(main, { childList: true, subtree: true });
}

document.addEventListener("DOMContentLoaded", () => {
  watchForUpdatePage();
  // 保留原来的 init 调用:处理直接打开 ?page=update 的场景
  initUpdatePage();
});

window.initUpdatePage = initUpdatePage;