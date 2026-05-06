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

const SEARCH_SITE_ROOT_URL = getSearchSiteRootUrl();

function getSearchSiteRootUrl() {
  const script = document.currentScript
    || document.querySelector('script[src$="search.js"]');
  return script?.src ? new URL("../", script.src) : new URL("./", document.baseURI);
}

function resolveSearchUrl(path) {
  return new URL(path, SEARCH_SITE_ROOT_URL).href;
}

/* ---------- 动漫数据:优先复用 anime-data.js,缺失时使用兜底 ---------- */
const ANIME_DATA_FALLBACK = [
  { id: "majo",      title: "魔女之旅",       desc: "魔女伊蕾娜在世界各地旅行,经历相逢与离别", tags: "奇幻 公路 旅行" },
  { id: "frieren",   title: "葬送的芙莉莲",   desc: "精灵魔法使芙莉莲重新踏上旅程,理解生命意义", tags: "奇幻 冒险 治愈" },
  { id: "garden",    title: "紫罗兰永恒花园", desc: "薇尔莉特·伊芙加登的故事",                   tags: "治愈 奇幻 日常" },
  { id: "slayer",    title: "鬼灭之刃",       desc: "炭治郎为让妹妹恢复原状踏上旅程",            tags: "热血 战斗 奇幻" },
  { id: "spy",       title: "间谍过家家",     desc: "间谍黄昏、超能力少女阿尼亚、暗杀者约尔的家庭喜剧", tags: "战斗 搞笑 日常" },
  { id: "titan",     title: "进击的巨人",     desc: "那一天,人类想起了被他们支配的恐惧",        tags: "热血 奇幻 神作" },
  { id: "datebattle",title: "约会大作战",     desc: "间谍为拯救精灵与其约会的故事",              tags: "奇幻 战斗 后宫" },
  { id: "suzuya",    title: "铃芽之旅",       desc: "铃芽与闭门师宗像草太一起关闭灾难源头之门",  tags: "青春 恋爱 治愈 电影" },
  { id: "xiaoyuan",  title: "魔法少女小圆",   desc: "鹿目圆与晓美焰面对魔法少女命运的故事",      tags: "奇幻 战斗 百合" },
];

function getAnimeSearchData() {
  if (typeof animeData === "object" && animeData) {
    return Object.entries(animeData).map(([id, item]) => ({
      id,
      title: item.title || id,
      desc: item.description || "",
      tags: Array.isArray(item.info) ? item.info.join(" ") : "",
    }));
  }
  return ANIME_DATA_FALLBACK;
}

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

function normalizeSearchText(value) {
  return String(value ?? "").normalize("NFKC").toLowerCase();
}

function match(text, kw) {
  return normalizeSearchText(text).includes(normalizeSearchText(kw));
}

/* ---------- 音乐搜索 ---------- */
let _musicCache = null; // [{ id, title, artist, lyric, index }]

async function loadMusicTracks() {
  if (_musicCache) return _musicCache;

  try {
    const res = await fetch(resolveSearchUrl("data/playlist.json"), { cache: "no-cache" });
    if (!res.ok) throw new Error("playlist.json 加载失败");

    const data = await res.json();
    const tracks = Array.isArray(data) ? data : data.tracks;
    if (!Array.isArray(tracks)) {
      _musicCache = [];
      return _musicCache;
    }

    _musicCache = tracks.map((track, index) => ({
      id: track.id || `track-${index + 1}`,
      title: track.title || "未命名歌曲",
      artist: track.artist || "",
      lyric: track.lyric || "",
      index,
    }));
    return _musicCache;
  } catch {
    _musicCache = [];
    return _musicCache;
  }
}

/* ---------- 笔记全文搜索 ---------- */
let _notesCache = null; // [{ title, category, file, content }]

async function loadAllNotes() {
  if (_notesCache) return _notesCache;
  try {
    const res = await fetch(resolveSearchUrl("data/notes-index.json"));
    if (!res.ok) throw new Error("notes-index.json 加载失败");
    const index = await res.json();

    const loaded = await Promise.all(index.map(async item => {
      try {
        const r = await fetch(resolveSearchUrl(item.file));
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
  getAnimeSearchData().forEach(a => {
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

  /* 3. 音乐 */
  const tracks = await loadMusicTracks();
  tracks.forEach(track => {
    const artistDesc = track.artist ? `歌手:${track.artist}` : "音乐播放器里的歌曲";
    if (match(track.title, q) || match(track.artist, q) || match(track.lyric, q)) {
      results.push({
        type: "音乐",
        title: track.title,
        desc: artistDesc,
        tag: "音乐",
        action: () => {
          window.dispatchEvent(new CustomEvent("y181:music-play-track", {
            detail: {
              id: track.id,
              index: track.index,
              title: track.title,
            },
          }));
        },
        titleHl: highlight(track.title, q),
        descHl:  highlight(artistDesc, q),
      });
    }
  });

  /* 4. 笔记(全文) */
  const notes = await loadAllNotes();
  notes.forEach(note => {
    // 把 Markdown 拆成多篇(以 --- 分隔)
    const blocks = note.content.split(/\n---+\n/g).filter(Boolean);
    blocks.forEach((block, idx) => {
      // 提取标题
      const titleMatch = block.match(/^#\s+(.+)/m);
      const blockTitle = titleMatch ? titleMatch[1].trim() : note.title;

      // 提取 @date
      const dateMatch  = block.match(/@date:\s*(.+)/);
      const dateStr    = dateMatch ? dateMatch[1].trim() : "";

      // 提取正文摘要(去掉 metadata 行和公式)
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
            // 跳转笔记详情(复用 main.js 的 SPA 路由 + notes.js 的详情渲染)
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

/* ---------- 搜索浮层 ---------- */
const SEARCH_SUGGESTIONS = ["音乐", "倒数", "F1", "动漫", "笔记", "画廊"];
const SEARCH_FILTERS = [
  { key: "all", label: "全部" },
  { key: "页面", label: "页面" },
  { key: "动漫", label: "动漫" },
  { key: "音乐", label: "音乐" },
  { key: "笔记", label: "笔记" },
];

const searchViewState = {
  keyword: "",
  results: [],
  activeType: "all",
};

function getSearchPanel() {
  let panel = document.getElementById("search-popover");
  if (panel) return panel;

  const control = document.querySelector(".search-control");
  panel = document.createElement("section");
  panel.id = "search-popover";
  panel.className = "search-popover";
  panel.hidden = true;
  panel.setAttribute("role", "dialog");
  panel.setAttribute("aria-label", "搜索结果");
  panel.innerHTML = `
    <header class="search-popover__header">
      <div>
        <p class="search-popover__eyebrow">搜索结果</p>
        <h2 class="search-popover__title" data-search-panel-title></h2>
      </div>
      <button class="search-popover__close" type="button" data-search-panel-close aria-label="关闭搜索结果" title="关闭">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
          <line x1="6" y1="6" x2="18" y2="18"></line>
          <line x1="18" y1="6" x2="6" y2="18"></line>
        </svg>
      </button>
    </header>
    <div class="search-popover__filters" data-search-panel-filters></div>
    <div class="search-popover__body" data-search-panel-body></div>
  `;

  panel.addEventListener("click", (event) => {
    event.stopPropagation();

    const filterBtn = event.target.closest("[data-search-filter]");
    if (filterBtn) {
      searchViewState.activeType = filterBtn.dataset.searchFilter || "all";
      renderSearchPanel();
      return;
    }

    const suggestionBtn = event.target.closest("[data-search-suggestion]");
    if (suggestionBtn) {
      const input = document.getElementById("search-input");
      input.value = suggestionBtn.dataset.searchSuggestion || "";
      input.dispatchEvent(new Event("input", { bubbles: true }));
      doSearchFromInput();
      return;
    }

    const resultBtn = event.target.closest("[data-result-idx]");
    if (resultBtn) {
      const idx = Number(resultBtn.dataset.resultIdx);
      const result = searchViewState.results[idx];
      if (result?.action) {
        closeSearchPanel();
        closeSearchControl();
        window.dispatchEvent(new CustomEvent("site-search:close"));
        result.action();
      }
    }
  });

  panel.querySelector("[data-search-panel-close]")?.addEventListener("click", () => {
    closeSearchPanel();
    closeSearchControl();
    window.dispatchEvent(new CustomEvent("site-search:close"));
  });

  (control || document.body).appendChild(panel);
  return panel;
}

function openSearchControl() {
  document.querySelector(".search-bar")?.classList.add("is-open");
  document.getElementById("search-toggle")?.classList.add("is-open");
  document.getElementById("search-backdrop")?.classList.add("is-open");
}

function closeSearchControl() {
  document.querySelector(".search-bar")?.classList.remove("is-open");
  document.getElementById("search-toggle")?.classList.remove("is-open");
  document.getElementById("search-backdrop")?.classList.remove("is-open");
}

function openSearchPanel() {
  const panel = getSearchPanel();
  panel.hidden = false;
  requestAnimationFrame(() => panel.classList.add("is-open"));
}

function closeSearchPanel() {
  const panel = document.getElementById("search-popover");
  if (!panel) return;

  panel.classList.remove("is-open");
  window.setTimeout(() => {
    if (!panel.classList.contains("is-open")) panel.hidden = true;
  }, 180);
}

function getCounts(results) {
  return results.reduce((counts, item) => {
    counts.all += 1;
    counts[item.type] = (counts[item.type] || 0) + 1;
    return counts;
  }, { all: 0 });
}

function getFilteredResults() {
  if (searchViewState.activeType === "all") return searchViewState.results;
  return searchViewState.results.filter(item => item.type === searchViewState.activeType);
}

function renderSearchPanelLoading(kw) {
  searchViewState.keyword = kw;
  searchViewState.results = [];
  searchViewState.activeType = "all";
  openSearchPanel();

  const panel = getSearchPanel();
  panel.querySelector("[data-search-panel-title]").textContent = `正在搜索「${kw}」`;
  panel.querySelector("[data-search-panel-filters]").innerHTML = "";
  panel.querySelector("[data-search-panel-body]").innerHTML = `
    <div class="search-loading">
      <span class="search-loading__dot"></span>
      <span>搜索中...</span>
    </div>
  `;
}

function renderSearchPanel() {
  const panel = getSearchPanel();
  const kw = searchViewState.keyword;
  const counts = getCounts(searchViewState.results);

  if (searchViewState.activeType !== "all" && !counts[searchViewState.activeType]) {
    searchViewState.activeType = "all";
  }

  const filtered = getFilteredResults();
  panel.querySelector("[data-search-panel-title]").textContent =
    `关键词「${kw}」共找到 ${searchViewState.results.length} 条结果`;

  panel.querySelector("[data-search-panel-filters]").innerHTML = SEARCH_FILTERS.map(filter => {
    const count = counts[filter.key] || 0;
    const active = searchViewState.activeType === filter.key ? " is-active" : "";
    return `
      <button class="search-filter${active}" type="button" data-search-filter="${escapeHtml(filter.key)}" ${count ? "" : "disabled"}>
        <span>${escapeHtml(filter.label)}</span>
        <strong>${count}</strong>
      </button>
    `;
  }).join("");

  if (!searchViewState.results.length) {
    panel.querySelector("[data-search-panel-body]").innerHTML = `
      <div class="search-empty">
        <p>没有找到相关内容</p>
        <div class="search-empty__suggestions">
          ${SEARCH_SUGGESTIONS.map(item => `
            <button type="button" data-search-suggestion="${escapeHtml(item)}">${escapeHtml(item)}</button>
          `).join("")}
        </div>
      </div>
    `;
    openSearchPanel();
    return;
  }

  panel.querySelector("[data-search-panel-body]").innerHTML = `
    <div class="search-results-list">
      ${filtered.map((r) => {
        const originalIndex = searchViewState.results.indexOf(r);
        return `
          <button class="search-result-card" type="button" data-result-idx="${originalIndex}">
            <span class="search-result-meta">
              <span class="search-result-tag">${escapeHtml(r.tag)}</span>
              ${r.date ? `<span class="search-result-date">${escapeHtml(r.date)}</span>` : ""}
            </span>
            <span class="search-result-title">${r.titleHl}</span>
            <span class="search-result-desc">${r.descHl}</span>
          </button>
        `;
      }).join("")}
    </div>
  `;
  openSearchPanel();
}

function renderSearchResults(kw, results) {
  searchViewState.keyword = kw;
  searchViewState.results = results;
  renderSearchPanel();
}

function updateSearchUrl(kw) {
  const url = new URL(window.location.href);
  url.searchParams.set("search", kw);
  history.pushState({ search: kw }, "", url.toString());
}

function clearSearchUrl() {
  const url = new URL(window.location.href);
  url.searchParams.delete("search");
  history.replaceState({ page: url.searchParams.get("page") || "home" }, "", url.toString());
}

function doSearchFromInput() {
  const input = document.getElementById("search-input");
  const clear = document.getElementById("search-clear");
  if (!input) return;

  const kw = input.value.trim();
  if (!kw) return;

  updateSearchUrl(kw);
  renderSearchPanelLoading(kw);
  openSearchControl();

  runSearch(kw).then(results => {
    renderSearchResults(kw, results);
  });

  if (clear) clear.style.display = "flex";
}

/* ---------- 初始化搜索框 ---------- */
function initSearch() {
  const input    = document.getElementById("search-input");
  const toggle   = document.getElementById("search-toggle");
  const clear    = document.getElementById("search-clear");
  const legacyBtn = document.getElementById("search-btn"); // 旧的隐藏提交按钮(如果存在)
  if (!input) return;

  // 暴露给 main.js 使用的 loadPage 引用
  // main.js 在 DOMContentLoaded 后把 loadPage 挂到 window._loadPage

  // 回车触发提交
  input.addEventListener("keydown", e => {
    if (e.key === "Enter") doSearchFromInput();
  });

  // 旧的隐藏 search-btn(兼容,可能不存在)
  if (legacyBtn) {
    legacyBtn.addEventListener("click", doSearchFromInput);
  }

  // 主搜索按钮:三段逻辑
  // - 未展开 → 展开 + focus
  // - 已展开 + 有内容 → 提交搜索
  // - 已展开 + 无内容 → 收起
  if (toggle) {
    toggle.addEventListener("click", (event) => {
      event.stopPropagation();
      const isOpen = document.querySelector(".search-bar")?.classList.contains("is-open");

      if (!isOpen) {
        openSearchControl();
        // 展开动画结束后再 focus,避免抖动
        setTimeout(() => input.focus(), 60);
      } else if (input.value.trim()) {
        doSearchFromInput();
      } else {
        closeSearchControl();
        closeSearchPanel();
      }
    });
  }

  // 清空
  if (clear) {
    clear.addEventListener("click", () => {
      input.value = "";
      clear.style.display = "none";
      input.focus();
      closeSearchPanel();
      clearSearchUrl();
    });
  }

  // 实时显示清空按钮
  input.addEventListener("input", () => {
    if (clear) clear.style.display = input.value ? "flex" : "none";
  });

  // 页面加载时如果 URL 带 search 参数,自动执行
  const urlKw = new URLSearchParams(window.location.search).get("search");
  if (urlKw) {
    input.value = urlKw;
    if (clear) clear.style.display = "flex";
    openSearchControl();
    renderSearchPanelLoading(urlKw);
    runSearch(urlKw).then(results => renderSearchResults(urlKw, results));
  }

  // 点击外部:同时关闭浮层和搜索框
  document.addEventListener("click", (event) => {
    if (!event.target.closest(".search-control")) {
      closeSearchPanel();
      closeSearchControl();
    }
  });

  // Esc:关闭浮层和搜索框,焦点回到搜索按钮
  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape") {
      const wasOpen = document.querySelector(".search-bar")?.classList.contains("is-open");
      closeSearchPanel();
      closeSearchControl();
      if (wasOpen) toggle?.focus();
    }
  });

  window.addEventListener("site-search:close", () => {
    closeSearchPanel();
    closeSearchControl();
  });

  window.addEventListener("popstate", () => {
    const kw = new URLSearchParams(window.location.search).get("search");
    if (!kw) {
      closeSearchPanel();
      return;
    }

    input.value = kw;
    if (clear) clear.style.display = "flex";
    openSearchControl();
    renderSearchPanelLoading(kw);
    runSearch(kw).then(results => renderSearchResults(kw, results));
  });
}

document.addEventListener("DOMContentLoaded", initSearch);