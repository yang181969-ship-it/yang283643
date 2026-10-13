/* =============================================================
 * js/about.js —— About 关于页（网站信息中心）
 *
 * 分区状态全部来自 URL：?page=about&tab=…[&update=…]
 *   overview  概览：网站简介、统计 / 更新入口、建站信息与声明（html/about.html 自带）
 *   stats     统计：首次进入时取 html/stats.html 的原统计页骨架挂载，交给 js/stats.js
 *   update    更新：首次进入时取 html/update.html 的原更新日志骨架挂载，交给 js/update.js
 *   update=…  单条更新详情（在更新分区内与列表切换，标识即 content/updates/<标识>.md）
 * 旧地址 ?page=stats / ?page=update[&update=…] 由 index.html 头部脚本与 main.js 规范化到这里。
 *
 * 生命周期：main.js 每次把 html/about.html 放进 #main-content 后调用 initAboutPage()。
 * 所有监听都绑定在本次挂载的 DOM 上（委托），离开页面随 DOM 一起销毁，不会叠加。
 * 统计 / 更新分区在同一次挂载内只挂载、初始化一次；切走再切回保留原有状态。
 * 异步结果晚到（已离开 About，或 About 已被重新挂载）时直接丢弃。
 * ============================================================= */
(() => {
  "use strict";

  const TABS = ["overview", "stats", "update"];
  const SOURCES = {
    stats: { file: "html/stats.html", selector: ".stats-page" },
    update: { file: "html/update.html", selector: ".update-page" },
  };
  const SOURCE_NAMES = { stats: "站点统计", update: "更新日志" };

  /* ---------- 挂载状态 ---------- */
  let root = null;
  let state = null;
  let mountId = 0;          // 每次挂载递增；异步回调据此判断结果是否过期
  let pending = {};         // 本次挂载中正在进行的分区挂载（tab → Promise）
  let overviewRendered = false;

  const isMounted = () => Boolean(root && root.isConnected);
  const $ = (selector) => root.querySelector(selector);
  const $$ = (selector) => [...root.querySelectorAll(selector)];

  /* ---------- 小工具 ---------- */
  function esc(value) {
    return String(value ?? "")
      .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;").replace(/'/g, "&#39;");
  }

  function parseDate(value) {
    const m = String(value || "").match(/^(\d{4})-(\d{2})-(\d{2})/);
    return m ? { y: m[1], m: m[2], d: m[3], iso: m[0] } : null;
  }

  function scroller() {
    return window.matchMedia("(max-width: 900px)").matches
      ? document.querySelector(".layout")
      : root?.closest(".page-card, .content-scroll");
  }

  function normalize(raw = {}) {
    const tab = TABS.includes(raw.tab) ? raw.tab : "overview";
    const update = tab === "update" && /^[\w.-]{1,120}$/.test(raw.update || "") ? raw.update : "";
    return update ? { tab, update } : { tab, update: "" };
  }

  function readUrl() {
    if (typeof window._aboutParamsFromUrl === "function") return window._aboutParamsFromUrl();
    const params = new URLSearchParams(window.location.search);
    return { tab: params.get("tab") || "", update: params.get("update") || "" };
  }

  function aboutUrl(s) {
    if (typeof window._aboutUrl === "function") return window._aboutUrl(s);
    const params = new URLSearchParams({ page: "about", tab: s.tab });
    if (s.update) params.set("update", s.update);
    return `index.html?${params}`;
  }

  /* =============================================================
   * 路由：go 写地址（与当前一致时不写历史），apply 把状态落到 DOM
   * ============================================================= */
  function go(raw, { push = true } = {}) {
    if (!isMounted()) return;
    const next = normalize(raw);
    const url = aboutUrl(next);
    if (`index.html${window.location.search}` !== url) {
      const about = next.update ? { tab: next.tab, update: next.update } : { tab: next.tab };
      // 从列表打开详情时记下来源：「返回更新列表」直接后退，不叠加历史
      if (push && next.update && state && state.tab === "update" && !state.update) about.fromList = true;
      const historyState = { page: "about", about };
      // 新的历史记录 = 新的导航意图：作废 main.js 中尚未完成的跨页请求
      if (push) window._beginNavigation?.();
      if (push) history.pushState(historyState, "", url);
      else history.replaceState(historyState, "", url);
    }
    apply(next);
  }

  // 浏览器前进 / 后退：URL 是唯一状态来源（旧地址会被原位规范化）
  function syncFromUrl() {
    if (isMounted()) go(readUrl(), { push: false });
  }

  // 详情 → 列表。返回 false 表示当前不在详情，调用方可走默认行为（如 history.back）
  function closeUpdateDetail() {
    if (!isMounted() || !state || state.tab !== "update" || !state.update) return false;
    if (history.state?.about?.fromList) history.back();
    else go({ tab: "update" });
    return true;
  }

  function apply(next) {
    const prev = state;
    state = next;

    $$("[data-about-tab]").forEach((tab) => {
      const active = tab.dataset.aboutTab === next.tab;
      tab.setAttribute("aria-selected", String(active));
      tab.tabIndex = active ? 0 : -1;
    });
    $$("[data-about-panel]").forEach((panel) => {
      panel.hidden = panel.dataset.aboutPanel !== next.tab;
    });
    root.dataset.aboutCurrent = next.tab;
    // 导航文字（关于 · 统计 / 关于 · 更新）与统计分区的宽屏布局都读这个状态
    if (typeof window._syncAboutTab === "function") window._syncAboutTab(next.tab);
    else document.documentElement.dataset.aboutSection = next.tab;

    if (prev && prev.tab === "stats" && next.tab !== "stats") window.StatsPage?.pause();
    if (prev && prev.tab === "update" && next.tab !== "update") {
      // 切离更新分区：作废还在加载的详情，它回来时不能再改滚动或焦点
      window.cancelUpdateDetail?.();
      closeUpdateOverlays();
    }

    if (next.tab === "overview") renderOverview();
    if (next.tab === "stats") {
      mountPanel("stats").then((ok) => {
        if (ok && isMounted() && state.tab === "stats") window.StatsPage?.resume();
      });
    }
    if (next.tab === "update") {
      mountPanel("update").then((ok) => {
        if (!ok || !isMounted() || state.tab !== "update") return;
        // 以完成时的最新状态为准（等待期间可能已切换详情或返回列表）
        if (state.update) window.openUpdateDetail?.(state.update);
        else window.closeUpdateDetail?.();
      });
    }

    if (prev && prev.tab !== next.tab) keepPanelInView();
  }

  // 用户已经滚过标签栏时，切换分区后把新内容的开头放到标签栏下方
  function keepPanelInView() {
    const tabs = $(".about-tabs");
    const panel = $(`[data-about-panel="${state.tab}"]`);
    if (!tabs || !panel) return;
    const gap = panel.getBoundingClientRect().top - tabs.getBoundingClientRect().bottom;
    if (gap >= 0) return;
    scroller()?.scrollBy({ top: gap - 8 });
  }

  // 离开更新分区时收起日历与筛选菜单（它们是浮层，留着会挡住其他分区）
  function closeUpdateOverlays() {
    const calendarTrigger = document.getElementById("update-calendar-trigger");
    if (calendarTrigger?.getAttribute("aria-expanded") === "true") calendarTrigger.click();
    const filter = document.getElementById("update-filter-toggle");
    if (filter?.getAttribute("aria-expanded") === "true") filter.click();
  }

  /* =============================================================
   * 统计 / 更新分区：按需取原页面骨架挂载（单一实现，不复制标记）
   * ============================================================= */
  const fragments = new Map(); // file → Promise<HTML>，跨挂载复用

  function loadFragment(file, selector) {
    if (!fragments.has(file)) {
      const fetchHtml = typeof window._fetchPageHtml === "function"
        ? window._fetchPageHtml(file)
        : Promise.reject(new Error("main.js 未就绪"));
      fragments.set(file, fetchHtml.then((html) => {
        const template = document.createElement("template");
        template.innerHTML = html;
        const node = template.content.querySelector(selector);
        if (!node) throw new Error(`${file} 中没有找到 ${selector}`);
        return node.outerHTML;
      }).catch((err) => {
        fragments.delete(file); // 失败不缓存，重试时重新请求
        throw err;
      }));
    }
    return fragments.get(file);
  }

  function mountPanel(tab) {
    const host = $(`[data-about-mount="${tab}"]`);
    if (!host) return Promise.resolve(false);
    if (pending[tab]) return pending[tab];
    if (host.dataset.mounted === "1") return Promise.resolve(true);

    const id = mountId;
    const { file, selector } = SOURCES[tab];
    host.setAttribute("aria-busy", "true");

    // 只有骨架挂上且组件初始化成功才算就绪（mounted="1"）；
    // 任何一步失败都留在「可重试」状态：显示重新加载按钮，下次进入该分区也会重新挂载
    pending[tab] = loadFragment(file, selector)
      .then(async (html) => {
        if (id !== mountId || !host.isConnected) return false;
        host.innerHTML = html;
        let ready = true;
        if (tab === "stats" && typeof window.initStatsPage === "function") {
          window.initStatsPage();
          // 骨架晚到时用户可能已经切走：按此刻的活动分区决定动画状态
          if (state?.tab !== "stats") window.StatsPage?.pause();
        }
        if (tab === "update" && typeof window.initUpdatePage === "function") ready = await window.initUpdatePage();
        if (id !== mountId || !host.isConnected) return false;
        if (!ready) throw new Error(`${SOURCE_NAMES[tab]}初始化失败`);
        host.dataset.mounted = "1";
        host.removeAttribute("aria-busy");
        return true;
      })
      .catch((err) => {
        console.error(`About ${SOURCE_NAMES[tab]}加载失败：`, err);
        if (id !== mountId || !host.isConnected) return false;
        delete host.dataset.mounted;
        host.removeAttribute("aria-busy");
        host.innerHTML = `
          <div class="about-mount-state">
            <p>${esc(SOURCE_NAMES[tab])}加载失败，请检查网络后重试。</p>
            <button type="button" class="about-card__more" data-about-retry="${esc(tab)}">重新加载</button>
          </div>`;
        return false;
      })
      .finally(() => {
        if (id === mountId) delete pending[tab];
      });
    return pending[tab];
  }

  /* =============================================================
   * 概览：统计 / 更新两张入口卡（只放摘要，完整内容在各自分区）
   * ============================================================= */
  function renderOverview() {
    if (overviewRendered) return;
    overviewRendered = true;
    const id = mountId;
    const alive = () => id === mountId && isMounted();
    const slot = (name) => $(`[data-about-slot="${name}"]`);

    const loadMeta = typeof window.y181Json === "function"
      ? window.y181Json("data/site-meta.json")
      : fetch("data/site-meta.json", { cache: "no-cache" }).then((res) => res.json());
    const loadUpdates = typeof window.loadUpdatesIndex === "function"
      ? window.loadUpdatesIndex()
      : fetch("data/updates-index.json", { cache: "no-cache" }).then((res) => res.json());

    Promise.all([loadMeta.catch(() => null), loadUpdates.catch(() => null)]).then(([meta, updates]) => {
      if (!alive()) return;
      if (!meta || !Array.isArray(updates)) overviewRendered = false; // 有数据没取到：下次进入概览再试
      const list = Array.isArray(updates)
        ? [...updates].sort((a, b) => String(b.date || "").localeCompare(String(a.date || "")))
        : null;

      slot("stats").innerHTML = meta
        ? renderStatsEntry(meta, list)
        : `<p class="about-entry__empty">统计数据暂不可用，可以直接打开统计分区查看。</p>`;
      slot("update").innerHTML = list && list.length
        ? renderUpdateEntry(list)
        : `<p class="about-entry__empty">${list ? "还没有更新记录。" : "更新日志暂不可用，可以直接打开更新分区查看。"}</p>`;
    });
  }

  function renderStatsEntry(meta, updates) {
    const birthday = new Date(meta.siteBirthday).getTime();
    const days = Number.isNaN(birthday) ? "--" : Math.max(1, Math.floor((Date.now() - birthday) / 86400000));
    const metrics = [
      ["笔记", meta.totals?.notes],
      ["内容总数", meta.totalContent],
      ["建站天数", days],
      ["累计更新", updates ? updates.length : meta.totals?.updates],
    ];
    return `
      <dl class="about-entry__metrics">
        ${metrics.map(([label, value]) => `
          <div><dt>${esc(label)}</dt><dd>${esc(value ?? "--")}</dd></div>`).join("")}
      </dl>`;
  }

  function renderUpdateEntry(list) {
    const latest = parseDate(list[0].date);
    const recent = list.slice(0, 2);
    const token = (item) => String(item.file || "").split("/").pop().replace(/\.md$/i, "");
    return `
      <p class="about-entry__lead">
        最近更新 <time datetime="${esc(latest?.iso || "")}">${esc(latest ? `${latest.y}.${latest.m}.${latest.d}` : "--")}</time>
        <span aria-hidden="true">·</span> 共 ${esc(list.length)} 条
      </p>
      <ul class="about-entry__list">
        ${recent.map((item) => {
          const date = parseDate(item.date);
          return `
            <li>
              <a href="${esc(aboutUrl({ tab: "update", update: token(item) }))}">
                <time>${esc(date ? `${date.m}-${date.d}` : "--")}</time>
                <span>${esc(item.title || "未命名更新")}</span>
              </a>
            </li>`;
        }).join("")}
      </ul>`;
  }

  /* =============================================================
   * 事件（委托在本次挂载的根节点上）
   * ============================================================= */
  function bind() {
    const tablist = $("[data-about-tablist]");

    root.addEventListener("click", (event) => {
      const target = event.target instanceof Element ? event.target : null;
      if (!target) return;

      const tab = target.closest('[role="tab"][data-about-tab]');
      if (tab) {
        // 点击当前分区：在详情中时回到列表，否则不产生新记录
        const next = tab.dataset.aboutTab;
        if (next === state.tab && state.update) closeUpdateDetail();
        else go({ tab: next });
        return;
      }

      const retry = target.closest("[data-about-retry]");
      if (retry) {
        const host = retry.closest("[data-about-mount]");
        if (host) host.innerHTML = `<p class="about-mount-state">正在重新加载…</p>`;
        apply(state);
        return;
      }

      // 站内 About 链接（概览入口卡、最近变化等）：原地切换分区；修饰键保持默认行为
      const link = target.closest('a[href^="index.html?page=about"]');
      if (link && !event.defaultPrevented && event.button === 0
        && !event.metaKey && !event.ctrlKey && !event.shiftKey && !event.altKey) {
        event.preventDefault();
        const params = new URLSearchParams(link.getAttribute("href").split("?")[1]);
        go({ tab: params.get("tab") || "", update: params.get("update") || "" });
      }
    });

    // 方向键 / Home / End 在标签间移动并切换（WAI-ARIA tabs 自动激活模式）
    tablist.addEventListener("keydown", (event) => {
      const tabs = $$("[data-about-tab]");
      const index = tabs.indexOf(document.activeElement);
      if (index < 0) return;
      const map = { ArrowRight: index + 1, ArrowLeft: index - 1, Home: 0, End: tabs.length - 1 };
      if (!(event.key in map)) return;
      event.preventDefault();
      const next = tabs[(map[event.key] + tabs.length) % tabs.length];
      next.focus();
      next.click();
    });
  }

  function initAboutPage() {
    const next = document.querySelector("[data-about-root]");
    if (!next || next.dataset.aboutBound === "1") return;

    // 骨架不完整（例如开发服务器截断了 html/about.html）时明确报错，而不是留下空白分区
    const missing = TABS.filter((tab) => !next.querySelector(`[data-about-panel="${tab}"]`));
    if (missing.length) {
      console.error(`About 页面骨架不完整，缺少分区：${missing.join(", ")}。请检查 html/about.html 是否被完整加载。`);
      return;
    }
    next.dataset.aboutBound = "1";
    root = next;
    state = null;
    mountId += 1;
    pending = {};
    overviewRendered = false;
    bind();
    go(readUrl(), { push: false });
  }

  window.initAboutPage = initAboutPage;
  // getState：供 update.js 在异步详情落地前核对「当前仍是这条更新」
  const getState = () => (isMounted() && state ? { ...state } : null);
  window.AboutPage = { isMounted, go, syncFromUrl, closeUpdateDetail, getState };
})();
