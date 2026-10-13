/* ===== 全局搜索 search.js ===== */

/* ---------- 固定页面条目 ---------- */
const STATIC_PAGES = [
  { title: "生活",   desc: "个人介绍、作品、收藏、足迹与日记", page: "life", type: "页面" },
  { title: "画廊",   desc: "生活 · 收藏中的图片画廊",   page: "gallery", type: "页面" },
  { title: "动漫",   desc: "生活 · 看过和想看的动漫作品", page: "anime",   type: "页面" },
  { title: "笔记",   desc: "数学与物理学习笔记",       page: "notes",   type: "页面" },
  { title: "关于",   desc: "网站简介、建站信息与声明", page: "about",   type: "页面" },
  { title: "统计",   desc: "关于 · 站点数据与内容增长", page: "stats",   type: "页面" },
  { title: "更新",   desc: "关于 · 网站更新日志",      page: "update",  type: "页面" },
];

const SEARCH_SITE_ROOT_URL = getSearchSiteRootUrl();

function getSearchSiteRootUrl() {
  const script = document.currentScript
    || document.querySelector('script[src*="js/search.js"]');
  return script?.src ? new URL("../", script.src) : new URL("./", document.baseURI);
}

function resolveSearchUrl(path) {
  return new URL(path, SEARCH_SITE_ROOT_URL).href;
}

/* ---------- 动漫数据:优先复用 anime-data.js,缺失时使用兜底 ---------- */
const ANIME_DATA_FALLBACK = [
  { id: "majo",      title: "魔女之旅",       desc: "魔女伊蕾娜在世界各地旅行，经历相逢与离别", tags: "奇幻 公路 旅行" },
  { id: "frieren",   title: "葬送的芙莉莲",   desc: "精灵魔法使芙莉莲重新踏上旅程，理解生命意义", tags: "奇幻 冒险 治愈" },
  { id: "garden",    title: "紫罗兰永恒花园", desc: "薇尔莉特·伊芙加登的故事",                   tags: "治愈 奇幻 日常" },
  { id: "slayer",    title: "鬼灭之刃",       desc: "炭治郎为让妹妹恢复原状踏上旅程",            tags: "热血 战斗 奇幻" },
  { id: "spy",       title: "间谍过家家",     desc: "间谍黄昏、超能力少女阿尼亚、暗杀者约尔的家庭喜剧", tags: "战斗 搞笑 日常" },
  { id: "titan",     title: "进击的巨人",     desc: "那一天，人类想起了被他们支配的恐惧",        tags: "热血 奇幻 神作" },
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
          if (window._loadPage) window._loadPage(p.page);
          else location.href = resolveSearchUrl(`index.html?page=${p.page}`);
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
          window.open(resolveSearchUrl(`html/anime-detail.html?id=${a.id}`), "_self");
        },
        titleHl: highlight(a.title, q),
        descHl:  highlight(a.desc,  q),
      });
    }
  });

  /* 3. 音乐 */
  const tracks = await loadMusicTracks();
  tracks.forEach(track => {
    const artistDesc = track.artist ? `歌手：${track.artist}` : "音乐播放器里的歌曲";
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
              revealPlaylist: true,
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
              const deadline = Date.now() + 10000;
              const waitForNotes = setInterval(() => {
                if (Date.now() > deadline) {
                  clearInterval(waitForNotes);
                  return;
                }
                if (document.querySelector(".note-card")) {
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
            } else {
              const target = new URL('html/notes-detail.html', SEARCH_SITE_ROOT_URL);
              target.searchParams.set('file', resolveSearchUrl(note.file));
              target.searchParams.set('index', String(idx));
              location.href = target.href;
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

/* ---------- 搜索面板(Command Palette)----------
   索引与 runSearch 不变;这里只负责展示与交互:
   - 输入即搜(防抖),分类筛选,↑/↓ 选择,Enter 打开,Esc/外部点击关闭(site-shell.js)
   - 输入法组字期间的 Enter 不触发打开 */
const SEARCH_SUGGESTIONS = ["音乐", "倒数", "F1", "动漫", "笔记", "画廊"];
const SEARCH_FILTERS = [
  { key: "all", label: "全部" },
  { key: "页面", label: "页面" },
  { key: "动漫", label: "动漫" },
  { key: "音乐", label: "音乐" },
  { key: "笔记", label: "笔记" },
];
const SEARCH_DEBOUNCE = 160;

const searchViewState = {
  keyword: "",
  results: [],
  activeType: "all",
  activeIndex: -1,  // 在当前筛选结果中的位置
  seq: 0,
  pending: null,    // 当前关键词的搜索 Promise(Enter 时等待它)
};

function getSearchPanel() {
  let panel = document.getElementById("search-popover");
  if (panel) return panel;

  const control = document.querySelector(".search-control");
  panel = document.createElement("section");
  panel.id = "search-popover";
  panel.className = "search-popover";
  panel.setAttribute("aria-label", "搜索结果");
  panel.innerHTML = `
    <div class="search-popover__filters" data-search-panel-filters></div>
    <p class="search-popover__status" data-search-panel-title aria-live="polite"></p>
    <div class="search-popover__body" id="search-results" role="listbox" aria-label="搜索结果" data-search-panel-body></div>
    <footer class="search-popover__footer" aria-hidden="true">
      <span><kbd>↑</kbd><kbd>↓</kbd> 选择</span>
      <span><kbd>Enter</kbd> 打开</span>
      <span><kbd>Esc</kbd> 关闭</span>
      <span class="search-popover__shortcut"><kbd>${/Mac|iPhone|iPad/.test(navigator.platform) ? "⌘" : "Ctrl"}</kbd><kbd>K</kbd> 随时唤起</span>
    </footer>
  `;

  panel.addEventListener("click", (event) => {
    const input = document.getElementById("search-input");
    const filterBtn = event.target.closest("[data-search-filter]");
    if (filterBtn) {
      searchViewState.activeType = filterBtn.dataset.searchFilter || "all";
      searchViewState.activeIndex = 0;
      renderSearchPanel();
      input?.focus({ preventScroll: true });
      return;
    }

    const suggestionBtn = event.target.closest("[data-search-suggestion]");
    if (suggestionBtn && input) {
      input.value = suggestionBtn.dataset.searchSuggestion || "";
      syncClearButton();
      performSearch(input.value);
      input.focus({ preventScroll: true });
      return;
    }

    const resultBtn = event.target.closest("[data-result-idx]");
    if (resultBtn) activateResult(searchViewState.results[Number(resultBtn.dataset.resultIdx)]);
  });

  // 鼠标悬停同步键盘高亮(触摸不触发,避免滚动时跳动)
  panel.addEventListener("pointermove", (event) => {
    if (event.pointerType !== "mouse") return;
    const option = event.target.closest("[data-option-idx]");
    if (option) setActiveOption(Number(option.dataset.optionIdx), false);
  });

  (control || document.body).appendChild(panel);
  return panel;
}

function activateResult(result) {
  if (!result?.action) return;
  closeSearchControl();
  result.action();
}

function openSearchControl() {
  window.sitePanels?.open("search", document.getElementById("search-toggle"));
}

function closeSearchControl() {
  window.sitePanels?.close("search");
}

function syncClearButton() {
  const input = document.getElementById("search-input");
  const clear = document.getElementById("search-clear");
  if (clear && input) clear.style.display = input.value ? "flex" : "none";
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

function setListboxExpanded(expanded) {
  const input = document.getElementById("search-input");
  input?.setAttribute("aria-expanded", String(expanded));
  if (!expanded) input?.removeAttribute("aria-activedescendant");
}

function renderSearchIdle() {
  const panel = getSearchPanel();
  panel.dataset.state = "idle";
  panel.querySelector("[data-search-panel-title]").textContent = "输入关键词，实时搜索笔记、动漫、音乐和页面";
  panel.querySelector("[data-search-panel-filters]").innerHTML = "";
  panel.querySelector("[data-search-panel-body]").innerHTML = `
    <div class="search-empty search-empty--idle">
      <p>试试搜索</p>
      <div class="search-empty__suggestions">
        ${SEARCH_SUGGESTIONS.map(item => `
          <button type="button" data-search-suggestion="${escapeHtml(item)}">${escapeHtml(item)}</button>
        `).join("")}
      </div>
    </div>
  `;
  setListboxExpanded(false);
}

function renderSearchPanelLoading(kw) {
  const panel = getSearchPanel();
  panel.querySelector("[data-search-panel-title]").textContent = `正在搜索「${kw}」…`;
  // 已有结果时保留旧列表,避免边输入边闪烁
  if (searchViewState.results.length) return;
  panel.dataset.state = "loading";
  panel.querySelector("[data-search-panel-filters]").innerHTML = "";
  panel.querySelector("[data-search-panel-body]").innerHTML = `
    <div class="search-loading">
      <span class="search-loading__dot"></span>
      <span>搜索中...</span>
    </div>
  `;
  setListboxExpanded(false);
}

function renderSearchPanel() {
  const panel = getSearchPanel();
  const kw = searchViewState.keyword;
  const counts = getCounts(searchViewState.results);

  if (searchViewState.activeType !== "all" && !counts[searchViewState.activeType]) {
    searchViewState.activeType = "all";
  }

  const filtered = getFilteredResults();
  panel.dataset.state = filtered.length ? "results" : "empty";
  panel.querySelector("[data-search-panel-title]").textContent =
    `「${kw}」共找到 ${searchViewState.results.length} 条结果`;

  panel.querySelector("[data-search-panel-filters]").innerHTML = SEARCH_FILTERS.map(filter => {
    const count = counts[filter.key] || 0;
    const active = searchViewState.activeType === filter.key;
    return `
      <button class="search-filter${active ? " is-active" : ""}" type="button" data-search-filter="${escapeHtml(filter.key)}" aria-pressed="${active}" ${count ? "" : "disabled"}>
        <span>${escapeHtml(filter.label)}</span>
        <strong>${count}</strong>
      </button>
    `;
  }).join("");

  if (!searchViewState.results.length) {
    panel.querySelector("[data-search-panel-body]").innerHTML = `
      <div class="search-empty">
        <p>没有找到「${escapeHtml(kw)}」相关内容</p>
        <span class="search-empty__hint">换个关键词,或试试:</span>
        <div class="search-empty__suggestions">
          ${SEARCH_SUGGESTIONS.map(item => `
            <button type="button" data-search-suggestion="${escapeHtml(item)}">${escapeHtml(item)}</button>
          `).join("")}
        </div>
      </div>
    `;
    setListboxExpanded(false);
    return;
  }

  panel.querySelector("[data-search-panel-body]").innerHTML = `
    <div class="search-results-list">
      ${filtered.map((r, i) => {
        const originalIndex = searchViewState.results.indexOf(r);
        return `
          <button class="search-result-card" type="button" role="option" id="search-opt-${i}" tabindex="-1"
            aria-selected="false" data-option-idx="${i}" data-result-idx="${originalIndex}">
            <span class="search-result-meta">
              <span class="search-result-tag">${escapeHtml(r.tag)}</span>
              ${r.date ? `<span class="search-result-date">${escapeHtml(r.date)}</span>` : ""}
            </span>
            <span class="search-result-title">${r.titleHl}</span>
            ${r.descHl ? `<span class="search-result-desc">${r.descHl}</span>` : ""}
            <span class="search-result-enter" aria-hidden="true">↵</span>
          </button>
        `;
      }).join("")}
    </div>
  `;
  setListboxExpanded(true);
  const max = filtered.length - 1;
  setActiveOption(Math.min(Math.max(searchViewState.activeIndex, 0), max), false);
}

function setActiveOption(index, scroll) {
  const panel = getSearchPanel();
  const options = panel.querySelectorAll("[data-option-idx]");
  if (!options.length) return;
  const next = (index + options.length) % options.length;
  searchViewState.activeIndex = next;
  options.forEach((el, i) => {
    el.classList.toggle("is-active", i === next);
    el.setAttribute("aria-selected", String(i === next));
  });
  document.getElementById("search-input")?.setAttribute("aria-activedescendant", options[next].id);
  if (scroll) options[next].scrollIntoView({ block: "nearest" });
}

function setSearchUrl(kw) {
  const url = new URL(window.location.href);
  if (kw) url.searchParams.set("search", kw);
  else url.searchParams.delete("search");
  if (url.href !== window.location.href) history.replaceState(history.state, "", url.toString());
}

function performSearch(raw) {
  const kw = String(raw ?? "").trim();
  const seq = ++searchViewState.seq;
  if (!kw) {
    searchViewState.keyword = "";
    searchViewState.results = [];
    searchViewState.activeIndex = -1;
    searchViewState.pending = null;
    setSearchUrl("");
    renderSearchIdle();
    return Promise.resolve();
  }
  if (kw !== searchViewState.keyword) searchViewState.activeIndex = 0;
  searchViewState.keyword = kw;
  renderSearchPanelLoading(kw);
  searchViewState.pending = runSearch(kw).then(results => {
    if (seq !== searchViewState.seq) return; // 已有更新的输入
    searchViewState.results = results;
    searchViewState.pending = null;
    setSearchUrl(kw);
    renderSearchPanel();
  });
  return searchViewState.pending;
}

/* ---------- 初始化搜索框 ---------- */
function initSearch() {
  const input = document.getElementById("search-input");
  const clear = document.getElementById("search-clear");
  const dialog = document.getElementById("tool-search");
  if (!input) return;

  getSearchPanel();
  renderSearchIdle();

  let timer = 0;
  const flush = () => {
    clearTimeout(timer);
    timer = 0;
    return performSearch(input.value);
  };

  input.addEventListener("input", () => {
    syncClearButton();
    clearTimeout(timer);
    timer = setTimeout(flush, input.value.trim() ? SEARCH_DEBOUNCE : 0);
  });

  input.addEventListener("keydown", async (e) => {
    if (e.isComposing || e.keyCode === 229) return; // 输入法组字中
    if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      e.preventDefault();
      setActiveOption(searchViewState.activeIndex + (e.key === "ArrowDown" ? 1 : -1), true);
    } else if (e.key === "Enter") {
      e.preventDefault();
      const kw = input.value.trim();
      if (!kw) return;
      if (timer || kw !== searchViewState.keyword) await flush();
      else if (searchViewState.pending) await searchViewState.pending;
      const filtered = getFilteredResults();
      activateResult(filtered[Math.max(searchViewState.activeIndex, 0)]);
    }
  });

  clear?.addEventListener("click", () => {
    input.value = "";
    syncClearButton();
    clearTimeout(timer);
    performSearch("");
    input.focus({ preventScroll: true });
  });

  // 移动端软键盘:按可见视口限制面板高度,结果区在剩余空间内滚动
  const viewport = window.visualViewport;
  const fitViewport = () => {
    if (!dialog || !viewport) return;
    dialog.style.setProperty("--vv-height", `${Math.round(viewport.height)}px`);
    dialog.style.setProperty("--vv-top", `${Math.round(viewport.offsetTop)}px`);
  };

  // 按钮/快捷键由 site-shell.js 打开弹窗;重新打开时保留上次的关键词和结果
  window.addEventListener("site-panel:open", (event) => {
    if (event.detail?.key !== "search") return;
    fitViewport();
    viewport?.addEventListener("resize", fitViewport);
    viewport?.addEventListener("scroll", fitViewport);
    if (input.value.trim() && input.value.trim() === searchViewState.keyword && searchViewState.results.length) {
      setSearchUrl(searchViewState.keyword);
      renderSearchPanel();
    } else if (input.value.trim()) {
      performSearch(input.value);
    } else {
      renderSearchIdle();
    }
    syncClearButton();
    requestAnimationFrame(() => input.select());
  });

  // 关闭(Esc、关闭按钮、外部点击)由 site-shell.js 处理;这里释放临时状态
  window.addEventListener("site-panel:close", (event) => {
    if (event.detail?.key !== "search") return;
    clearTimeout(timer);
    timer = 0;
    viewport?.removeEventListener("resize", fitViewport);
    viewport?.removeEventListener("scroll", fitViewport);
    setListboxExpanded(false);
    setSearchUrl("");
  });

  // 兼容旧的外部关闭事件
  window.addEventListener("site-search:close", closeSearchControl);

  // 页面加载时如果 URL 带 search 参数,自动执行
  const urlKw = new URLSearchParams(window.location.search).get("search");
  if (urlKw) {
    input.value = urlKw;
    openSearchControl();
  }

  window.addEventListener("popstate", () => {
    const kw = new URLSearchParams(window.location.search).get("search");
    if (!kw) {
      if (document.getElementById("tool-search")?.open) closeSearchControl();
      return;
    }
    input.value = kw;
    if (document.getElementById("tool-search")?.open) performSearch(kw);
    else openSearchControl();
  });
}

document.addEventListener("DOMContentLoaded", initSearch);
