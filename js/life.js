/* =============================================================
 * js/life.js —— Life 生活页
 *
 * 分区状态全部来自 URL：?page=life&tab=…&type=…&status=…&entry=…
 *   tab     overview | works | collections | journey | journal（未知值回退 overview）
 *   type    分区内的子分类（works: anime/film/book，collections: gallery/cards/devices，
 *           journey: timeline/travel/milestones）
 *   status  作品状态筛选 all | done | doing | want
 *   entry   日记 id（content/life/journal/<id>.md）
 *
 * 生命周期：main.js 每次把 html/life.html 放进 #main-content 后调用 initLifePage()。
 * 所有监听都绑定在本次挂载的 DOM 上（委托），离开页面随 DOM 一起销毁，不会叠加。
 * 分区内容按需渲染：第一次进入某分区才读取对应数据；同一次挂载内切换分区保留已渲染的状态。
 *
 * 数据：js/anime-data.js（动漫）、data/life.json（其余扩展数据）、
 *       data/image-index.json（统一图片索引）、data/journal-index.json（日记索引）
 * ============================================================= */
(() => {
  "use strict";

  const TABS = ["overview", "works", "collections", "journey", "journal"];
  const SUBTYPES = {
    works: ["anime", "film", "book"],
    collections: ["gallery", "cards", "devices"],
    journey: ["timeline", "travel", "milestones"],
  };
  const STATUSES = ["all", "done", "doing", "want"];

  const TYPE_LABELS = { anime: "动漫", film: "影视", book: "书籍" };
  const STATUS_LABELS = {
    anime: { done: "已看", doing: "在看", want: "想看" },
    film: { done: "已看", doing: "在看", want: "想看" },
    book: { done: "已读", doing: "在读", want: "想读" },
  };
  const ANIME_STATUS = { watched: "done", watching: "doing", wishlist: "want" };
  const BADGE_LABELS = { upcoming: "待更新", ongoing: "连载中", finished: "已完结", movie: "电影" };
  const CARD_STATUS = { collected: "已收藏", using: "使用中", retired: "已停用", want: "想要" };
  const DEVICE_STATUS = { using: "使用中", retired: "已退役", collected: "收藏" };
  const WISH_TYPES = { work: "作品", travel: "旅行", device: "设备", goal: "目标" };
  const JOURNEY_TYPES = { timeline: "经历", travel: "旅行", milestone: "里程碑" };

  const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)");

  /* ---------- 数据（跨多次进入 Life 复用，只请求一次） ---------- */
  const cache = {};
  function fetchJson(key, url, fallback) {
    if (!cache[key]) {
      cache[key] = fetch(url, { cache: "no-cache" })
        .then((res) => (res.ok ? res.json() : Promise.reject(new Error(`${url} ${res.status}`))))
        .catch((err) => {
          console.warn("Life 数据加载失败：", err);
          delete cache[key]; // 下次进入再试
          return fallback;
        });
    }
    return cache[key];
  }
  const loadLife = () => fetchJson("life", "data/life.json", {});
  const loadJournal = () => fetchJson("journal", "data/journal-index.json", { entries: [] });
  const loadImages = () => fetchJson("images", "data/image-index.json", null);
  const journalText = new Map();

  const list = (value) => (Array.isArray(value) ? value : []);

  /* ---------- 小工具 ---------- */
  function esc(value) {
    return String(value ?? "")
      .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;").replace(/'/g, "&#39;");
  }
  // "../assets/x.webp" → "assets/x.webp"（Life 在站点根目录渲染）
  const src = (path) => String(path || "").trim().replace(/^(\.\.?\/)+/, "").replace(/^\/+/, "");
  function formatDate(text) {
    const m = String(text || "").match(/^(\d{4})-(\d{2})(?:-(\d{2}))?/);
    if (!m) return "";
    return m[3] ? `${m[1]}.${m[2]}.${m[3]}` : `${m[1]}.${m[2]}`;
  }
  const byDateDesc = (a, b) => String(b.date || "").localeCompare(String(a.date || ""));

  function empty(title, text, compact = false) {
    return `
      <div class="life-empty${compact ? " life-empty--compact" : ""}">
        <span class="life-empty__icon" aria-hidden="true">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M12 3l1.9 5.8H20l-4.9 3.6 1.9 5.8L12 14.6l-5 3.6 1.9-5.8L4 8.8h6.1z"></path></svg>
        </span>
        <strong>${esc(title)}</strong>
        ${text ? `<span>${esc(text)}</span>` : ""}
      </div>`;
  }

  function lifeUrl(params) {
    if (typeof window._lifeUrl === "function") return window._lifeUrl(params);
    const q = new URLSearchParams({ page: "life", ...params });
    return `index.html?${q}`;
  }

  /* ---------- 作品数据：动漫来自 anime-data.js，影视/书籍来自 life.json ---------- */
  function animeWorks() {
    if (typeof animeData !== "object" || !animeData) return [];
    return Object.entries(animeData)
      .map(([id, a], index) => ({
        key: `anime:${id}`,
        type: "anime",
        title: a.title || id,
        cover: src(a.image),
        status: ANIME_STATUS[a.watchStatus] || "done",
        badge: a.badge || "",
        rating: Number.isFinite(a.rating) ? a.rating : null,
        href: `html/anime-detail.html?id=${encodeURIComponent(id)}`,
        order: Number.isFinite(a.order) ? a.order : 1000 + index,
      }))
      .sort((x, y) => x.order - y.order);
  }

  function otherWorks(life) {
    return list(life.works)
      .filter((w) => w && SUBTYPES.works.includes(w.type) && w.type !== "anime" && w.title)
      .map((w, index) => ({
        key: `${w.type}:${w.id || index}`,
        type: w.type,
        title: w.title,
        cover: src(w.cover || w.image),
        status: STATUSES.includes(w.status) && w.status !== "all" ? w.status : "done",
        badge: "",
        rating: Number.isFinite(w.rating) ? w.rating : null,
        href: w.link || "",
        summary: w.summary || "",
        order: index,
      }));
  }

  /* =============================================================
   * 挂载状态
   * ============================================================= */
  let root = null;
  let state = null;
  let rendered = new Set();
  let journalTag = "";
  // 各分区最近一次的子分类：从别的分区切回来时恢复（跨挂载保留）
  const memory = {};

  const isMounted = () => Boolean(root && root.isConnected);
  const $ = (selector) => root.querySelector(selector);
  const $$ = (selector) => [...root.querySelectorAll(selector)];

  function normalize(raw = {}) {
    const tab = TABS.includes(raw.tab) ? raw.tab : "overview";
    const types = SUBTYPES[tab];
    return {
      tab,
      type: types ? (types.includes(raw.type) ? raw.type : types[0]) : "",
      status: tab === "works" && STATUSES.includes(raw.status) ? raw.status : "all",
      entry: tab === "journal" && /^[\w.-]{1,120}$/.test(raw.entry || "") ? raw.entry : "",
    };
  }

  function toParams(s) {
    const params = { tab: s.tab };
    if (s.type) params.type = s.type;
    if (s.status && s.status !== "all") params.status = s.status;
    if (s.entry) params.entry = s.entry;
    return params;
  }

  function readUrl() {
    const params = new URLSearchParams(window.location.search);
    return Object.fromEntries(["tab", "type", "status", "entry"].map((k) => [k, params.get(k) || ""]));
  }

  // 切换分区：状态与当前 URL 一致时不写历史（点击已激活的标签不会产生新记录）
  function go(raw, { push = true } = {}) {
    if (!isMounted()) return;
    const next = normalize({ ...(state ? { tab: state.tab } : {}), ...raw });
    const url = lifeUrl(toParams(next));
    const current = `index.html${window.location.search}`;
    apply(next);
    if (current === url) return;
    const historyState = { page: "life", life: toParams(next) };
    if (push) history.pushState(historyState, "", url);
    else history.replaceState(historyState, "", url);
  }

  function syncFromUrl() {
    if (isMounted()) apply(normalize(readUrl()));
  }

  /* ---------- 应用状态到 DOM ---------- */
  function apply(next) {
    const prev = state;
    state = next;

    // 离开画廊时关闭灯箱与弹出面板，避免残留的滚动锁
    const wasGallery = prev && prev.tab === "collections" && prev.type === "gallery";
    if (wasGallery && !(next.tab === "collections" && next.type === "gallery")) closeGalleryOverlays();

    $$("[data-life-tab]").forEach((tab) => {
      const active = tab.dataset.lifeTab === next.tab;
      tab.setAttribute("aria-selected", String(active));
      tab.tabIndex = active ? 0 : -1;
      tab.classList.toggle("is-active", active);
    });
    $$("[data-life-panel]").forEach((panel) => {
      panel.hidden = panel.dataset.lifePanel !== next.tab;
    });
    root.dataset.lifeCurrent = next.tab;
    if (SUBTYPES[next.tab]) memory[next.tab] = next.type;
    revealActiveTab();

    if (next.tab === "overview") renderOnce("overview", renderOverview);
    if (next.tab === "works") renderWorks();
    if (next.tab === "collections") renderCollections();
    if (next.tab === "journey") renderJourney();
    if (next.tab === "journal") renderJournal();

    if (prev && prev.tab !== next.tab) keepPanelInView();
  }

  function renderOnce(key, fn) {
    if (rendered.has(key)) return;
    rendered.add(key);
    fn();
  }

  function syncSubnav(tab) {
    const subnav = $(`[data-life-subnav="${tab}"]`);
    if (!subnav) return;
    subnav.querySelectorAll("[data-life-type]").forEach((chip) => {
      chip.setAttribute("aria-pressed", String(chip.dataset.lifeType === state.type));
    });
  }

  // 标签栏横向滚动时，让当前标签保持可见（只滚动标签栏自身，不带动页面）
  function revealActiveTab() {
    const track = $("[data-life-tablist]");
    const active = track?.querySelector('[aria-selected="true"]');
    if (!track || !active || track.scrollWidth <= track.clientWidth + 1) return;
    const left = active.offsetLeft - (track.clientWidth - active.offsetWidth) / 2;
    track.scrollTo({ left: Math.max(0, left), behavior: reducedMotion.matches ? "auto" : "smooth" });
  }

  function syncTabFades() {
    const nav = $(".life-tabs");
    const track = $("[data-life-tablist]");
    if (!nav || !track) return;
    const max = track.scrollWidth - track.clientWidth;
    nav.classList.toggle("has-more-left", track.scrollLeft > 2);
    nav.classList.toggle("has-more-right", max - track.scrollLeft > 2);
  }

  // 用户已经滚过标签栏时，切换分区后把新内容的开头放到标签栏下方
  function keepPanelInView() {
    const tabs = $(".life-tabs");
    const panel = $(`[data-life-panel="${state.tab}"]`);
    if (!tabs || !panel) return;
    const gap = panel.getBoundingClientRect().top - tabs.getBoundingClientRect().bottom;
    if (gap >= 0) return;
    const scroller = window.matchMedia("(max-width: 900px)").matches
      ? document.querySelector(".layout")
      : panel.closest(".page-card, .content-scroll");
    scroller?.scrollBy({ top: gap - 8 });
  }

  function closeGalleryOverlays() {
    if (typeof closeLightbox === "function") closeLightbox();
    if (typeof closeGalleryPanels === "function") closeGalleryPanels();
  }

  /* =============================================================
   * 总览 Overview
   * ============================================================= */
  function renderOverview() {
    const slot = (name) => $(`[data-life-slot="${name}"]`);

    // 看过的作品：已有排序中的已看动漫（没有真实观看时间，不显示「最近观看时间」）
    const watched = animeWorks().filter((w) => w.status === "done").slice(0, 4);
    slot("works").innerHTML = watched.length
      ? `<ul class="life-mini-covers">${watched.map((w) => `
          <li>
            <a class="life-mini-cover" href="${esc(w.href)}">
              <span class="life-mini-cover__img"><img src="${esc(w.cover)}" alt="" loading="lazy" decoding="async"></span>
              <span class="life-mini-cover__title">${esc(w.title)}</span>
              <span class="life-mini-cover__meta">${esc(BADGE_LABELS[w.badge] || STATUS_LABELS.anime[w.status])}</span>
            </a>
          </li>`).join("")}</ul>`
      : empty("还没有作品记录", "", true);

    // 精选收藏：复用已加载的 gallery-data.js，只取少量缩略图
    const gallery = typeof galleryData !== "undefined" && Array.isArray(galleryData)
      ? [...galleryData].sort((a, b) => (a.order || 0) - (b.order || 0)).slice(0, 6) : [];
    const galleryHref = lifeUrl({ tab: "collections", type: "gallery" });
    slot("collections").innerHTML = gallery.length
      ? `<div class="life-mini-gallery">${gallery.map((g) => `
          <a class="life-mini-gallery__item" href="${esc(galleryHref)}" aria-label="打开图片画廊：${esc(g.title || "")}">
            <img src="${esc(src(g.thumb || g.src))}" alt="" loading="lazy" decoding="async">
          </a>`).join("")}</div>`
      : empty("还没有收藏图片", "", true);

    loadLife().then((life) => {
      if (!isMounted()) return;
      const milestones = list(life.journey).filter((e) => e && e.type === "milestone").sort(byDateDesc).slice(0, 3);
      slot("milestones").innerHTML = milestones.length
        ? `<ol class="life-mini-list">${milestones.map((e) => `
            <li><time>${esc(formatDate(e.date))}</time><span>${esc(e.title)}</span></li>`).join("")}</ol>`
        : empty("里程碑还是空白", "重要的节点会记录在这里。", true);

      const wishes = wishlistItems(life).slice(0, 5);
      slot("wishlist").innerHTML = wishes.length
        ? `<ul class="life-wish-list">${wishes.map(wishItem).join("")}</ul>`
        : empty("暂时没有愿望", "", true);
    });

    loadJournal().then((index) => {
      if (!isMounted()) return;
      const entries = list(index?.entries).slice(0, 3);
      slot("journal").innerHTML = entries.length
        ? `<ul class="life-mini-list life-mini-list--journal">${entries.map((e) => `
            <li><a href="${esc(lifeUrl({ tab: "journal", entry: e.id }))}">
              <time>${esc(formatDate(e.date))}</time><span>${esc(e.title)}</span>
            </a></li>`).join("")}</ul>`
        : empty("还没有日记", "生活里的小事，会慢慢写在这里。", true);
    });
  }

  // 愿望：想看的动漫 + life.json 中想看/想读的作品 + 通用愿望（未完成）
  function wishlistItems(life) {
    const fromWorks = [...animeWorks(), ...otherWorks(life)]
      .filter((w) => w.status === "want")
      .map((w) => ({
        title: w.title,
        kind: `${TYPE_LABELS[w.type]} · ${STATUS_LABELS[w.type].want}`,
        href: w.href || lifeUrl({ tab: "works", type: w.type, status: "want" }),
        cover: w.cover,
      }));
    const general = list(life.wishlist)
      .filter((w) => w && w.title && !w.done)
      .map((w) => ({ title: w.title, kind: WISH_TYPES[w.type] || "愿望", href: w.link || "", note: w.note || "" }));
    return [...fromWorks, ...general];
  }

  function wishItem(w) {
    const thumb = w.cover
      ? `<img src="${esc(w.cover)}" alt="" loading="lazy" decoding="async">`
      : `<span aria-hidden="true">✦</span>`;
    const inner = `
      <span class="life-wish__thumb">${thumb}</span>
      <span class="life-wish__text"><span class="life-wish__title">${esc(w.title)}</span>
      <span class="life-wish__kind">${esc(w.kind)}${w.note ? ` · ${esc(w.note)}` : ""}</span></span>`;
    return `<li>${w.href ? `<a class="life-wish" href="${esc(w.href)}">${inner}</a>` : `<div class="life-wish">${inner}</div>`}</li>`;
  }

  /* =============================================================
   * 作品 Works
   * ============================================================= */
  function renderWorks() {
    syncSubnav("works");
    const grid = $("[data-life-works]");
    const statusGroup = $("[data-life-status]");
    const labels = STATUS_LABELS[state.type];

    statusGroup.querySelectorAll("[data-life-status-value]").forEach((chip) => {
      const value = chip.dataset.lifeStatusValue;
      chip.setAttribute("aria-pressed", String(value === state.status));
      if (labels[value]) chip.textContent = labels[value];
    });

    const draw = (life) => {
      if (!isMounted()) return;
      const all = [...animeWorks(), ...otherWorks(life)];
      SUBTYPES.works.forEach((type) => {
        const count = all.filter((w) => w.type === type).length;
        const el = $(`[data-life-count="${type}"]`);
        if (el) el.textContent = count ? String(count) : "";
      });

      const ofType = all.filter((w) => w.type === state.type);
      const shown = state.status === "all" ? ofType : ofType.filter((w) => w.status === state.status);

      if (!ofType.length) {
        grid.innerHTML = empty(
          state.type === "book" ? "这里还没有书籍记录" : "这里还没有影视记录",
          state.type === "book" ? "读过和想读的书会慢慢整理到这里。" : "看过的电影和剧集会慢慢整理到这里。"
        );
        return;
      }
      if (!shown.length) {
        grid.innerHTML = empty(`没有「${labels[state.status]}」的${TYPE_LABELS[state.type]}`, "");
        return;
      }
      grid.innerHTML = shown.map(workCard).join("");
    };

    // 动漫数据是同步的，先画出来；影视/书籍等 life.json 到达后补全计数
    if (state.type === "anime") draw({});
    loadLife().then(draw);
  }

  function workCard(w) {
    const status = STATUS_LABELS[w.type][w.status];
    const badge = BADGE_LABELS[w.badge];
    const rating = w.rating !== null ? ` · ★ ${esc(w.rating)}` : "";
    const cover = w.cover
      ? `<img src="${esc(w.cover)}" alt="${esc(w.title)}" loading="lazy" decoding="async">`
      : `<span class="life-work__placeholder" aria-hidden="true">${esc(w.title.slice(0, 1))}</span>`;
    const inner = `
      <span class="life-work__cover">
        ${cover}
        ${badge ? `<span class="life-work__badge" data-badge="${esc(w.badge)}">${esc(badge)}</span>` : ""}
      </span>
      <span class="life-work__meta">
        <span class="life-work__title">${esc(w.title)}</span>
        <span class="life-work__sub">${esc(TYPE_LABELS[w.type])} · ${esc(status)}${rating}</span>
      </span>`;
    return w.href
      ? `<a class="life-work" href="${esc(w.href)}">${inner}</a>`
      : `<article class="life-work">${inner}</article>`;
  }

  /* =============================================================
   * 收藏 Collections
   * ============================================================= */
  function renderCollections() {
    syncSubnav("collections");
    $$("[data-life-sub]").forEach((sub) => {
      sub.hidden = sub.dataset.lifeSub !== state.type;
    });
    if (state.type === "gallery") renderOnce("gallery", mountGallery);
    if (state.type === "cards") renderOnce("cards", renderCards);
    if (state.type === "devices") renderOnce("devices", renderDevices);
  }

  // Gallery：读取统一图片索引交给原 gallery.js；索引不可用时退回 gallery-data.js
  function mountGallery() {
    const grid = $("[data-gallery-list]");
    loadImages().then((index) => {
      if (!isMounted() || typeof initGalleryPage !== "function") return;
      const images = Array.isArray(index?.images) && index.images.length ? index.images : undefined;
      initGalleryPage(images);
      grid?.removeAttribute("aria-busy");
    });
  }

  function renderCards() {
    loadLife().then((life) => {
      if (!isMounted()) return;
      const cards = list(life.cards).filter((c) => c && (c.name || c.bank));
      const box = $('[data-life-list="cards"]');
      box.innerHTML = cards.length
        ? cards.map((c) => `
            <article class="life-bank-card">
              <div class="life-bank-card__face">
                ${c.image
                  ? `<img src="${esc(src(c.image))}" alt="${esc([c.bank, c.name].filter(Boolean).join(" "))}" loading="lazy" decoding="async">`
                  : `<span class="life-bank-card__plain"><strong>${esc(c.bank || "")}</strong><em>${esc(c.network || "")}</em></span>`}
              </div>
              <div class="life-bank-card__meta">
                <h3>${esc(c.name || c.bank)}</h3>
                <p>${esc([c.bank, c.network, c.region].filter(Boolean).join(" · "))}</p>
                ${c.summary ? `<p class="life-bank-card__note">${esc(c.summary)}</p>` : ""}
                ${CARD_STATUS[c.status] ? `<span class="life-tag">${esc(CARD_STATUS[c.status])}</span>` : ""}
              </div>
            </article>`).join("")
        : empty("银行卡图鉴还在整理中", "收藏的卡面会以图鉴的形式陈列在这里。");
    });
  }

  function renderDevices() {
    loadLife().then((life) => {
      if (!isMounted()) return;
      const devices = list(life.devices).filter((d) => d && d.name);
      const box = $('[data-life-list="devices"]');
      box.innerHTML = devices.length
        ? devices.map((d) => `
            <article class="life-device">
              <div class="life-device__img">
                ${d.image
                  ? `<img src="${esc(src(d.image))}" alt="${esc(d.name)}" loading="lazy" decoding="async">`
                  : `<span aria-hidden="true">${esc(d.name.slice(0, 1))}</span>`}
              </div>
              <div class="life-device__meta">
                <h3>${esc(d.name)}</h3>
                <p>${esc([d.brand, d.model].filter(Boolean).join(" · "))}</p>
                <div class="life-device__tags">
                  ${DEVICE_STATUS[d.status] ? `<span class="life-tag">${esc(DEVICE_STATUS[d.status])}</span>` : ""}
                  ${d.date ? `<span class="life-tag life-tag--quiet">入手 ${esc(formatDate(d.date))}</span>` : ""}
                </div>
                ${d.review ? `<p class="life-device__review">${esc(d.review)}</p>` : ""}
              </div>
            </article>`).join("")
        : empty("数码设备档案还在整理中", "用过和收藏的设备会陆续记录在这里。");
    });
  }

  /* =============================================================
   * 足迹 Journey：同一份事件数据，按 type 区分三种视图
   * ============================================================= */
  function renderJourney() {
    syncSubnav("journey");
    const type = state.type;
    loadLife().then((life) => {
      if (!isMounted() || state.tab !== "journey" || state.type !== type) return;
      const events = list(life.journey).filter((e) => e && e.title).sort(byDateDesc);
      const shown = type === "timeline" ? events
        : events.filter((e) => e.type === (type === "travel" ? "travel" : "milestone"));
      const box = $('[data-life-list="journey"]');
      if (!shown.length) {
        const copy = {
          timeline: ["时间轴还是空白", "成长中的重要经历，会按时间顺序记录在这里。"],
          travel: ["还没有旅行记录", "去过的地方和路上的照片，会整理成旅行记录。"],
          milestones: ["还没有里程碑", "值得纪念的节点，会被单独标记出来。"],
        }[type];
        box.innerHTML = empty(copy[0], copy[1]);
        return;
      }
      box.innerHTML = `<ol class="life-timeline">${shown.map(journeyItem).join("")}</ol>`;
    });
  }

  function journeyItem(e) {
    const images = list(e.images).slice(0, 4);
    return `
      <li class="life-timeline__item" data-kind="${esc(e.type || "timeline")}">
        <span class="life-timeline__dot" aria-hidden="true"></span>
        <div class="life-timeline__card">
          <div class="life-timeline__head">
            ${e.date ? `<time>${esc(formatDate(e.date))}</time>` : ""}
            <span class="life-tag life-tag--quiet">${esc(JOURNEY_TYPES[e.type] || "经历")}</span>
            ${e.location ? `<span class="life-timeline__place">${esc(e.location)}</span>` : ""}
          </div>
          <h3>${esc(e.title)}</h3>
          ${e.summary ? `<p>${esc(e.summary)}</p>` : ""}
          ${images.length ? `<div class="life-timeline__images">${images.map((img) => `<img src="${esc(src(img))}" alt="" loading="lazy" decoding="async">`).join("")}</div>` : ""}
          ${list(e.tags).length ? `<div class="life-timeline__tags">${list(e.tags).map((t) => `<span class="life-tag life-tag--quiet">${esc(t)}</span>`).join("")}</div>` : ""}
          ${e.journal ? `<a class="life-link" href="${esc(lifeUrl({ tab: "journal", entry: e.journal }))}">阅读相关日记 →</a>` : ""}
        </div>
      </li>`;
  }

  /* =============================================================
   * 日记 Journal：列表（年月分组 + 标签筛选）与正文阅读
   * ============================================================= */
  function renderJournal() {
    const listView = $("[data-life-journal-list]");
    const reader = $("[data-life-journal-reader]");
    const entryId = state.entry;
    listView.hidden = Boolean(entryId);
    reader.hidden = !entryId;

    loadJournal().then((index) => {
      if (!isMounted() || state.tab !== "journal" || state.entry !== entryId) return;
      const entries = list(index?.entries);
      if (entryId) renderJournalEntry(entries.find((e) => e.id === entryId), reader);
      else renderJournalList(entries);
    });
  }

  function renderJournalList(entries) {
    const box = $('[data-life-list="journal"]');
    const tagsBox = $("[data-life-journal-tags]");
    const tags = [...new Set(entries.flatMap((e) => list(e.tags)))];
    if (journalTag && !tags.includes(journalTag)) journalTag = "";

    tagsBox.hidden = tags.length === 0;
    tagsBox.innerHTML = tags.length
      ? ["", ...tags].map((tag) => `
          <button type="button" class="life-chip" data-life-journal-tag="${esc(tag)}" aria-pressed="${tag === journalTag}">${esc(tag || "全部")}</button>`).join("")
      : "";

    const shown = journalTag ? entries.filter((e) => list(e.tags).includes(journalTag)) : entries;
    if (!shown.length) {
      box.innerHTML = empty("还没有日记", "生活里的小事，会慢慢写在这里。");
      return;
    }

    const groups = new Map();
    shown.forEach((e) => {
      const m = String(e.date || "").match(/^(\d{4})-(\d{2})/);
      const key = m ? `${m[1]} 年 ${Number(m[2])} 月` : "未标注日期";
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key).push(e);
    });

    box.innerHTML = [...groups].map(([month, items]) => `
      <section class="life-journal-group no-card" aria-label="${esc(month)}">
        <h3 class="life-journal-group__title">${esc(month)}</h3>
        <div class="life-journal-grid">
          ${items.map((e) => `
            <a class="life-journal-card" href="${esc(lifeUrl({ tab: "journal", entry: e.id }))}">
              ${e.cover ? `<span class="life-journal-card__cover"><img src="${esc(src(e.cover))}" alt="" loading="lazy" decoding="async"></span>` : ""}
              <span class="life-journal-card__body">
                <time>${esc(formatDate(e.date) || "未标注日期")}</time>
                <span class="life-journal-card__title">${esc(e.title)}</span>
                ${e.summary ? `<span class="life-journal-card__summary">${esc(e.summary)}</span>` : ""}
                ${list(e.tags).length ? `<span class="life-journal-card__tags">${list(e.tags).map((t) => `<span class="life-tag life-tag--quiet">${esc(t)}</span>`).join("")}</span>` : ""}
              </span>
            </a>`).join("")}
        </div>
      </section>`).join("");
  }

  async function renderJournalEntry(entry, reader) {
    const back = `
      <button type="button" class="life-reader__back" data-life-journal-back>
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><polyline points="15 6 9 12 15 18"></polyline></svg>
        返回日记列表
      </button>`;
    if (!entry) {
      reader.innerHTML = `${back}${empty("没有找到这篇日记", "它可能已被移动或删除。")}`;
      return;
    }
    reader.innerHTML = `${back}<div class="life-reader__loading">正在打开日记…</div>`;

    let text = journalText.get(entry.file);
    if (text === undefined) {
      try {
        const res = await fetch(entry.file, { cache: "no-cache" });
        if (!res.ok) throw new Error(String(res.status));
        text = await res.text();
        journalText.set(entry.file, text);
      } catch (err) {
        console.warn("日记加载失败：", err);
        text = null;
      }
    }
    if (!isMounted() || state.entry !== entry.id) return;
    if (text === null) {
      reader.innerHTML = `${back}${empty("日记加载失败", "请稍后刷新重试。")}`;
      return;
    }

    // 去掉标题与 @字段，正文复用更新日志的 Markdown 渲染器（js/update.js）
    const body = text.replace(/\r\n?/g, "\n").split("\n")
      .filter((line, i, all) => !/^@(date|summary|tags|cover):/.test(line.trim())
        && !(line.trim().startsWith("# ") && all.slice(0, i).every((l) => !l.trim().startsWith("# "))))
      .join("\n");
    const html = typeof updateRenderMarkdown === "function"
      ? updateRenderMarkdown(body)
      : body.split(/\n\s*\n/).map((p) => `<p>${esc(p.trim())}</p>`).join("");

    reader.innerHTML = `
      ${back}
      <header class="life-reader__head">
        <time>${esc(formatDate(entry.date) || "未标注日期")}</time>
        <h2>${esc(entry.title)}</h2>
        ${list(entry.tags).length ? `<div class="life-reader__tags">${list(entry.tags).map((t) => `<span class="life-tag life-tag--quiet">${esc(t)}</span>`).join("")}</div>` : ""}
      </header>
      ${entry.cover ? `<figure class="life-reader__cover"><img src="${esc(src(entry.cover))}" alt="" decoding="async"></figure>` : ""}
      <div class="life-reader__body update-markdown-full">${html}</div>`;
  }

  /* =============================================================
   * 事件（委托在本次挂载的根节点上）
   * ============================================================= */
  function bind() {
    const tablist = $("[data-life-tablist]");

    root.addEventListener("click", (event) => {
      const target = event.target instanceof Element ? event.target : null;
      if (!target) return;

      const tab = target.closest("[data-life-tab]");
      if (tab) {
        const next = tab.dataset.lifeTab;
        // 回到已打开的分区时沿用该分区当前的子分类
        go(next === state.tab ? state : { tab: next, type: memory[next] });
        return;
      }

      const sub = target.closest("[data-life-subnav] [data-life-type]");
      if (sub) {
        go({ tab: state.tab, type: sub.dataset.lifeType, status: state.tab === "works" ? state.status : "" });
        return;
      }

      const status = target.closest("[data-life-status-value]");
      if (status) {
        go({ tab: "works", type: state.type, status: status.dataset.lifeStatusValue });
        return;
      }

      const tag = target.closest("[data-life-journal-tag]");
      if (tag) {
        journalTag = tag.dataset.lifeJournalTag || "";
        loadJournal().then((index) => isMounted() && renderJournalList(list(index?.entries)));
        return;
      }

      if (target.closest("[data-life-journal-back]")) {
        go({ tab: "journal" });
        return;
      }

      // 站内 Life 链接：原地切换分区，不重新加载页面（新标签页打开等修饰键保持默认行为）
      const link = target.closest('a[href^="index.html?page=life"]');
      if (link && !event.defaultPrevented && event.button === 0
        && !event.metaKey && !event.ctrlKey && !event.shiftKey && !event.altKey) {
        event.preventDefault();
        const params = new URLSearchParams(link.getAttribute("href").split("?")[1]);
        go(Object.fromEntries(["tab", "type", "status", "entry"].map((k) => [k, params.get(k) || ""])));
      }
    });

    // 方向键 / Home / End 在标签间移动并切换（WAI-ARIA tabs 自动激活模式）
    tablist.addEventListener("keydown", (event) => {
      const tabs = $$("[data-life-tab]");
      const index = tabs.indexOf(document.activeElement);
      if (index < 0) return;
      const map = { ArrowRight: index + 1, ArrowLeft: index - 1, Home: 0, End: tabs.length - 1 };
      if (!(event.key in map)) return;
      event.preventDefault();
      const next = tabs[(map[event.key] + tabs.length) % tabs.length];
      next.focus();
      next.click();
    });

    tablist.addEventListener("scroll", syncTabFades, { passive: true });
    new ResizeObserver(() => {
      if (!isMounted()) return;
      syncTabFades();
    }).observe(tablist);
  }

  function initLifePage() {
    const next = document.querySelector("[data-life-root]");
    if (!next || next.dataset.lifeBound === "1") return;
    next.dataset.lifeBound = "1";

    // 骨架不完整（例如开发服务器截断了 html/life.html）时明确报错，而不是留下空白分区
    const missing = TABS.filter((tab) => !next.querySelector(`[data-life-panel="${tab}"]`));
    if (missing.length) {
      console.error(`Life 页面骨架不完整，缺少分区：${missing.join(", ")}。请检查 html/life.html 是否被完整加载。`);
      next.insertAdjacentHTML("beforeend", empty("页面加载不完整", "请刷新后重试。"));
      return;
    }
    root = next;
    state = null;
    rendered = new Set();
    journalTag = "";
    bind();
    go(readUrl(), { push: false });
    syncTabFades();
  }

  window.initLifePage = initLifePage;
  window.LifePage = { isMounted, go, syncFromUrl };
})();
