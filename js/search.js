/* ===== 全局搜索 search.js ===== */

/* ---------- 固定页面条目 ---------- */
const STATIC_PAGES = [
  { title: "画廊",   desc: "我的图片收藏与展示",       page: "gallery", type: "页面" },
  { title: "动漫",   desc: "我看过和想看的动漫作品",   page: "anime",   type: "页面" },
  { title: "笔记",   desc: "数学与物理学习笔记",       page: "notes",   type: "页面" },
  { title: "留言",   desc: "留言与交流",               page: "comment", type: "页面" },
  { title: "更新",   desc: "网站更新日志",             page: "update",  type: "页面" },
  { title: "关于",   desc: "关于这个网站和站主",       page: "about",   type: "页面" },
];

/* ---------- 动漫数据（与 anime-detail.js 保持同步） ---------- */
const ANIME_DATA = [
  { id: "majo",      title: "魔女之旅",       desc: "魔女伊蕾娜在世界各地旅行，经历相逢与离别", tags: "奇幻 公路 旅行" },
  { id: "frieren",   title: "葬送的芙莉莲",   desc: "精灵魔法使芙莉莲重新踏上旅程，理解生命意义", tags: "奇幻 冒险 治愈" },
  { id: "garden",    title: "紫罗兰永恒花园", desc: "薇尔莉特·伊芙加登的故事",                   tags: "治愈 奇幻 日常" },
  { id: "slayer",    title: "鬼灭之刃",       desc: "炭治郎为让妹妹恢复原状踏上旅程",            tags: "热血 战斗 奇幻" },
  { id: "spy",       title: "间谍过家家",     desc: "间谍黄昏、超能力少女阿尼亚、暗杀者约尔的家庭喜剧", tags: "战斗 搞笑 日常" },
  { id: "titan",     title: "进击的巨人",     desc: "那一天，人类想起了被他们支配的恐惧",        tags: "热血 奇幻 神作" },
  { id: "datebattle",title: "约会大作战",     desc: "间谍为拯救精灵与其约会的故事",              tags: "奇幻 战斗 后宫" },
];

/* ---------- 工具函数 ---------- */
function escapeHtml(str) {
  return String(str ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

function highlight(text, kw) {
  if (!kw) return escapeHtml(text);
  const escaped = kw.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return escapeHtml(text).replace(
    new RegExp(`(${escaped})`, "gi"),
    '<mark>$1</mark>'
  );
}

function match(text, kw) {
  return String(text ?? "").toLowerCase().includes(kw.toLowerCase());
}

/* ---------- 笔记全文搜索 ---------- */
let _notesCache = null; // [{ title, category, file, content }]

async function loadAllNotes() {
  if (_notesCache) return _notesCache;
  try {
    const res = await fetch("data/notes-index.json");
    if (!res.ok) throw new Error("notes-index.json 加载失败");
    const index = await res.json();

    const loaded = await Promise.all(index.map(async item => {
      try {
        const r = await fetch(item.file);
        const text = r.ok ? await r.text() : "";
        return { ...item, content: text };
      } catch {
        return { ...item, content: "" };
      }
    }));

    _notesCache = loaded;
    return loaded;
  } catch {
    return [];
  }
}

/* ---------- 搜索入口 ---------- */
async function runSearch(kw) {
  const q = kw.trim();
  if (!q) return [];

  const results = [];

  /* 1. 固定页面 */
  STATIC_PAGES.forEach(p => {
    if (match(p.title, q) || match(p.desc, q)) {
      results.push({
        type: "页面",
        title: p.title,
        desc: p.desc,
        tag: "页面",
        action: () => {
          window._loadPage?.(p.page);
        },
        titleHl: highlight(p.title, q),
        descHl:  highlight(p.desc,  q),
      });
    }
  });

  /* 2. 动漫 */
  ANIME_DATA.forEach(a => {
    if (match(a.title, q) || match(a.desc, q) || match(a.tags, q)) {
      results.push({
        type: "动漫",
        title: a.title,
        desc: a.desc,
        tag: "动漫",
        action: () => {
          window.open(`html/anime-detail.html?id=${a.id}`, "_self");
        },
        titleHl: highlight(a.title, q),
        descHl:  highlight(a.desc,  q),
      });
    }
  });

  /* 3. 笔记（全文） */
  const notes = await loadAllNotes();
  notes.forEach(note => {
    // 把 Markdown 拆成多篇（以 --- 分隔）
    const blocks = note.content.split(/\n---+\n/g).filter(Boolean);
    blocks.forEach((block, idx) => {
      // 提取标题
      const titleMatch = block.match(/^#\s+(.+)/m);
      const blockTitle = titleMatch ? titleMatch[1].trim() : note.title;

      // 提取 @date
      const dateMatch  = block.match(/@date:\s*(.+)/);
      const dateStr    = dateMatch ? dateMatch[1].trim() : "";

      // 提取正文摘要（去掉 metadata 行和公式）
      const bodyLines  = block.split("\n")
        .filter(l => !l.startsWith("#") && !l.startsWith("@") && !l.startsWith("$$") && l.trim())
        .slice(0, 4)
        .join(" ")
        .replace(/\*\*/g, "")
        .slice(0, 120);

      if (match(blockTitle, q) || match(block, q)) {
        results.push({
          type: "笔记",
          title: blockTitle,
          desc:  bodyLines || note.title,
          tag:   note.category,
          date:  dateStr,
          action: () => {
            // 跳转笔记详情（复用 main.js 的 SPA 路由 + notes.js 的详情渲染）
            if (typeof window._loadPage === "function") {
              window._loadPage("notes");
              // 等笔记页加载完毕后再打开详情
              const waitForNotes = setInterval(() => {
                if (document.getElementById("notes-content")) {
                  clearInterval(waitForNotes);
                  // 通过 notes-index 找到对应卡片并模拟点击
                  const cards = document.querySelectorAll(".note-card");
                  for (const card of cards) {
                    if (card.querySelector("h2")?.textContent?.trim() === blockTitle) {
                      card.click();
                      break;
                    }
                  }
                }
              }, 80);
            }
          },
          titleHl: highlight(blockTitle, q),
          descHl:  highlight(bodyLines,  q),
        });
      }
    });
  });

  return results;
}

/* ---------- 渲染结果页 ---------- */
function renderSearchResults(kw, results) {
  const main = document.getElementById("main-content");
  if (!main) return;

  const count = results.length;
  const isEmpty = count === 0;

  const cardsHtml = results.map((r, i) => `
    <article class="card search-result-card" data-result-idx="${i}" style="cursor:pointer">
      <div class="search-result-meta">
        <span class="note-tag">${escapeHtml(r.tag)}</span>
        ${r.date ? `<span class="note-date">${escapeHtml(r.date)}</span>` : ""}
      </div>
      <h2 class="search-result-title">${r.titleHl}</h2>
      <p class="search-result-desc">${r.descHl}</p>
    </article>
  `).join("");

  main.innerHTML = `
    <section class="no-card search-page">
      <div class="home-hero">
        <h2 class="page-title">搜索结果</h2>
        <p class="page-desc">
          关键词「<strong>${escapeHtml(kw)}</strong>」共找到 ${count} 条结果
        </p>
      </div>
      ${isEmpty
        ? `<div class="card search-empty">
             <p>没有找到相关内容，试试其他关键词？</p>
           </div>`
        : cardsHtml
      }
    </section>
  `;

  // 绑定点击
  results.forEach((r, i) => {
    const el = main.querySelector(`[data-result-idx="${i}"]`);
    el?.addEventListener("click", () => r.action());
  });
}

/* ---------- 初始化搜索框 ---------- */
function initSearch() {
  const input  = document.getElementById("search-input");
  const btn    = document.getElementById("search-btn");
  const clear  = document.getElementById("search-clear");
  if (!input) return;

  // 暴露给 main.js 使用的 loadPage 引用
  // main.js 在 DOMContentLoaded 后把 loadPage 挂到 window._loadPage
  // 这里直接用即可（search.js 在 main.js 之后加载）

  function doSearch() {
    const kw = input.value.trim();
    if (!kw) return;

    // 更新 URL（不走 SPA，只改 search 参数）
    const url = new URL(window.location.href);
    url.searchParams.set("search", kw);
    url.searchParams.delete("page");
    history.pushState({ search: kw }, "", url.toString());

    // 显示 loading
    const main = document.getElementById("main-content");
    if (main) {
      main.innerHTML = `
        <section class="no-card search-page">
          <div class="home-hero">
            <h2 class="page-title">搜索中…</h2>
          </div>
        </section>`;
    }

    runSearch(kw).then(results => {
      renderSearchResults(kw, results);
    });

    // 更新 clear 按钮可见性
    clear.style.display = kw ? "flex" : "none";
  }

  // 回车触发
  input.addEventListener("keydown", e => {
    if (e.key === "Enter") doSearch();
  });

  // 按钮触发
  btn.addEventListener("click", doSearch);

  // 清空
  clear.addEventListener("click", () => {
    input.value = "";
    clear.style.display = "none";
    input.focus();
    // 回到主页
    if (typeof window._loadPage === "function") {
      window._loadPage("home");
    }
  });

  // 实时显示清空按钮
  input.addEventListener("input", () => {
    clear.style.display = input.value ? "flex" : "none";
  });

  // 页面加载时如果 URL 带 search 参数，自动执行
  const urlKw = new URLSearchParams(window.location.search).get("search");
  if (urlKw) {
    input.value = urlKw;
    clear.style.display = "flex";
    runSearch(urlKw).then(results => renderSearchResults(urlKw, results));
  }
}

document.addEventListener("DOMContentLoaded", initSearch);