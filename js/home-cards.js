// ============================================================
// js/home-cards.js
// 主页:轻量欢迎区 + 两层五张卡 —— Phase 4
//
//   今日一隅  东京天气(Open-Meteo)+ data/mood-map.json 的每日一句
//   最近更新  data/updates-index.json(与 About 共用 loadUpdatesIndex,不下载日志正文)
//   站点速览  data/site-meta.json(与 About 概览同一口径)+ 更新索引条数
//   数学与笔记 data/notes-index.json + 最新几篇的首段预览
//   生活片段  js/anime-data.js(作品)、js/gallery-data.js(收藏)、data/journal-index.json(日记)
//
// 生命周期:首次进入主页由本脚本的 DOMContentLoaded 初始化;SPA 回到主页时
// main.js 的 runPageInit("home") 再次调用 initHomeCards()。每次挂载领取新编号,
// 异步结果落地前核对编号与 DOM 是否仍在,离开主页后的过期回调不会改动页面。
// 站内链接统一交给 main.js 的 _loadPage,沿用全站路由与导航令牌。
// ============================================================

(function () {
  "use strict";

  // ---------------- 常量 ----------------
  const FALLBACK_BIRTHDAY = "2026-04-13";                       // site-meta 缺失时的建站日
  const TOKYO_LAT      = 35.6762;
  const TOKYO_LNG      = 139.6503;
  const MOOD_REFRESH_MS = 1000 * 60 * 60;                       // 60 分钟
  const WEATHER_TIMEOUT_MS = 8000;                              // 天气接口无响应时按失败降级
  const WEATHER_MAX_STALE_MS = 1000 * 60 * 60 * 12;             // 失败时最多沿用 12 小时内的旧天气
  const PORTRAIT_REFRESH_BUFFER_MS = 1000;                      // 零点后 1 秒刷新
  const STORAGE_PREFIX = "y181_";

  const TTL = {
    moodMap:  1000 * 60 * 60 * 24,
    mood:     MOOD_REFRESH_MS,
  };

  const COUNT = {
    notes:    3,
    updates:  3,
    works:    2,
    gallery:  2,
  };

  // 清理已退役模块与旧版主页卡片留下的缓存键，保留其他功能的所有偏好。
  try {
    ["y181_comments-recent", "yang_comment_voter_id", "y181_about", "y181_notes"]
      .forEach((key) => localStorage.removeItem(key));
    for (let i = localStorage.length - 1; i >= 0; i -= 1) {
      const key = localStorage.key(i);
      if (key && key.startsWith("y181_updates-v3-")) localStorage.removeItem(key);
    }
  } catch {}

  // 天气与心情映射的同会话内存缓存
  const memCache = new Map();
  let moodRefreshTimer = null;
  let portraitRefreshTimer = null;

  // 当前挂载:{ root, alive() }
  let mount = null;

  // ---------------- 缓存核心(仅天气 / 心情映射) ----------------
  /**
   * 三段式取数据:内存 → 未过期 localStorage → 网络;失败回退不太旧的 localStorage
   */
  async function cached(key, ttl, fetcher, maxStale = Infinity) {
    if (memCache.has(key)) return memCache.get(key);

    const fullKey = STORAGE_PREFIX + key;
    const stored = readStorage(fullKey);

    if (stored && Date.now() - stored.t < ttl) {
      memCache.set(key, stored.v);
      return stored.v;
    }

    try {
      const v = await fetcher();
      writeStorage(fullKey, v);
      memCache.set(key, v);
      return v;
    } catch (err) {
      console.warn(`[home-cards] ${key} fetch failed, falling back to stale cache:`, err);
      if (stored && Date.now() - stored.t < maxStale) return stored.v;
      throw err;
    }
  }

  function readStorage(k) {
    try {
      const raw = localStorage.getItem(k);
      return raw ? JSON.parse(raw) : null;
    } catch { return null; }
  }
  function writeStorage(k, v) {
    try { localStorage.setItem(k, JSON.stringify({ t: Date.now(), v })); }
    catch {}
  }

  // ---------------- 工具 ----------------
  function escapeHTML(s) {
    return String(s ?? "").replace(/[&<>"']/g, c => ({
      "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"
    }[c]));
  }
  function parseDate(s) {
    const m = String(s || "").match(/^(\d{4})-(\d{2})-(\d{2})/);
    return m ? { y: m[1], m: m[2], d: m[3], iso: `${m[1]}-${m[2]}-${m[3]}` } : null;
  }
  function fmtDate(s) {
    const d = parseDate(s);
    return d ? `${d.y}.${d.m}.${d.d}` : "";
  }
  // 与 About 概览 / 统计分区(stats.js daysSinceBirthday)同一算法,三处天数始终一致
  function daysSince(s) {
    const time = new Date(s).getTime();
    if (Number.isNaN(time)) return null;
    return Math.max(1, Math.floor((Date.now() - time) / 86400000));
  }
  // "../assets/x.webp" → "assets/x.webp"(主页在站点根目录渲染)
  const assetPath = (p) => String(p || "").trim().replace(/^(\.\.?\/)+/, "").replace(/^\/+/, "");
  const list = (value) => (Array.isArray(value) ? value : []);

  function moodImagePath(image) {
    const file = String(image || "relaxed.webp").replace(/[^a-z0-9._-]/gi, "");
    return `assets/mood/${file || "relaxed.webp"}`;
  }
  function localDayNumber(date) {
    return Math.floor(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()) / 86400000);
  }
  function parseDateKey(key) {
    const m = String(key || "").match(/^(\d{4})-(\d{2})-(\d{2})$/);
    if (!m) return null;
    return new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  }
  function pickDailyImage(images, startDate) {
    if (!Array.isArray(images) || !images.length) return "";
    const start = parseDateKey(startDate) || new Date();
    const offset = Math.max(0, localDayNumber(new Date()) - localDayNumber(start));
    return images[offset % images.length] || "";
  }

  function lifeUrl(params) {
    if (typeof window._lifeUrl === "function") return window._lifeUrl(params);
    return `index.html?${new URLSearchParams({ page: "life", ...params })}`;
  }
  function aboutUpdateUrl(token) {
    const params = new URLSearchParams({ page: "about", tab: "update" });
    if (token) params.set("update", token);
    return `index.html?${params}`;
  }
  // 与 notes.js 详情页写入地址栏的格式一致:note = encodeURIComponent(文件路径)
  function noteUrl(file) {
    const params = new URLSearchParams({ page: "notes" });
    params.set("note", encodeURIComponent(file));
    return `index.html?${params}`;
  }
  // 更新标识即 content/updates/<标识>.md(与 About 更新分区一致)
  const updateToken = (item) => String(item.file || "").split("/").pop().replace(/\.md$/i, "");

  function emptyState(text) {
    return `<p class="home-empty">${escapeHTML(text)}</p>`;
  }

  // ---------------- 数据源 ----------------
  async function fetchJson(url, options) {
    const res = await fetch(url, options);
    if (!res.ok) throw new Error(`${url} → ${res.status}`);
    return res.json();
  }

  // 同一会话同一地址只请求一次(main.js 提供,About 也在用)
  function sharedJson(url) {
    if (typeof window.y181Json === "function") return window.y181Json(url);
    return fetchJson(url, { cache: "no-cache" });
  }
  function loadUpdates() {
    return typeof window.loadUpdatesIndex === "function"
      ? window.loadUpdatesIndex()
      : sharedJson("data/updates-index.json");
  }
  const loadMeta    = () => sharedJson("data/site-meta.json");
  const loadNotes   = () => sharedJson("data/notes-index.json");
  const loadJournal = () => sharedJson("data/journal-index.json");
  const loadPortraitRotation = () => sharedJson("data/portrait-rotation.json");
  const fetchMoodMap = () => fetchJson("data/mood-map.json");

  async function fetchMood() {
    const url = `https://api.open-meteo.com/v1/forecast`
              + `?latitude=${TOKYO_LAT}&longitude=${TOKYO_LNG}`
              + `&current=temperature_2m,weather_code&timezone=Asia/Tokyo`;
    const controller = typeof AbortController === "function" ? new AbortController() : null;
    const timer = controller ? window.setTimeout(() => controller.abort(), WEATHER_TIMEOUT_MS) : null;
    try {
      const data = await fetchJson(url, controller ? { signal: controller.signal } : undefined);
      if (data.current?.weather_code == null) throw new Error("weather payload missing current");
      return {
        temp: data.current?.temperature_2m,
        code: data.current?.weather_code,
      };
    } finally {
      if (timer) window.clearTimeout(timer);
    }
  }

  // 笔记首段预览:只请求主页展示的几篇,同一会话复用
  const notePreviewCache = new Map();
  function loadNotePreview(file) {
    if (!notePreviewCache.has(file)) {
      notePreviewCache.set(file, fetch(encodeURI(file))
        .then((res) => (res.ok ? res.text() : Promise.reject(new Error(`${file} ${res.status}`))))
        .then(extractPreview)
        .catch((err) => {
          notePreviewCache.delete(file);
          console.warn("[home-cards] note preview failed:", err);
          return "";
        }));
    }
    return notePreviewCache.get(file);
  }

  // 取正文第一段文字(跳过标题、元数据、代码块、块级公式、列表、表格、图片)
  function extractPreview(md) {
    const lines = String(md || "").replace(/\r\n?/g, "\n").split("\n");
    const para = [];
    let fence = false;
    let mathBlock = false;
    for (const raw of lines) {
      const line = raw.trim();
      if (line.startsWith("```")) { fence = !fence; if (para.length) break; continue; }
      if (fence) continue;
      if (line === "$$" || line === "\\[" || line === "\\]") { mathBlock = !mathBlock; if (para.length) break; continue; }
      if (mathBlock) continue;
      if (!line) { if (para.length) break; continue; }
      if (/^(#|@|>|[-*+]\s|\d+\.\s|\||<|!\[|-{3,}|\$\$)/.test(line)) { if (para.length) break; continue; }
      para.push(line);
    }
    let text = para.join(" ")
      .replace(/\*\*|__|`/g, "")
      .replace(/\[([^\]]*)\]\([^)]*\)/g, "$1")
      .replace(/\s+/g, " ")
      .trim();
    const LIMIT = 120;
    if (text.length > LIMIT) {
      let cut = text.slice(0, LIMIT);
      // 不在行内公式中间截断:$ 个数为奇数时退回到最后一个 $ 之前
      if ((cut.replace(/\\\$/g, "").match(/\$/g) || []).length % 2) cut = cut.slice(0, cut.lastIndexOf("$"));
      text = `${cut.trimEnd()}…`;
    }
    return text;
  }

  function renderMath(el) {
    if (!el || !el.textContent.includes("$")) return;
    const run = () => {
      if (!el.isConnected || typeof window.renderMathInElement !== "function") return;
      window.renderMathInElement(el, {
        delimiters: [
          { left: "$", right: "$", display: false },
          { left: "\\(", right: "\\)", display: false },
        ],
        throwOnError: false,
      });
    };
    if (typeof window.renderMathInElement === "function") run();
    else if (typeof window.loadKaTeX === "function") window.loadKaTeX().then(run).catch(() => {});
  }

  // ---------------- 挂载内工具 ----------------
  function $card(ctx, name) {
    return ctx.root.querySelector(`.bento-card[data-card="${name}"]`);
  }
  function setBody(ctx, name, html) {
    if (!ctx.alive()) return null;
    const body = $card(ctx, name)?.querySelector(".bento-card-body");
    if (!body) return null;
    body.classList.remove("is-skeleton");
    body.removeAttribute("aria-busy");
    body.innerHTML = html;
    return body;
  }

  // ---------------- 欢迎区:Q 版人物每日轮换 ----------------
  async function renderPortrait(ctx) {
    const img = ctx.root.querySelector("[data-home-portrait]");
    if (!img) return;
    try {
      const data = await loadPortraitRotation();
      if (!ctx.alive()) return;
      const next = pickDailyImage(data.sets?.q, data.startDate);
      if (next && img.getAttribute("src") !== next) img.src = next;
    } catch (err) {
      console.warn("[home-cards] portrait rotation fetch failed:", err);
    }
  }

  // ---------------- 今日一隅 ----------------
  // 东京当天日期,如「10月13日 · 周一」(随每小时的天气刷新一起更新)
  function tokyoDate() {
    try {
      const day = new Intl.DateTimeFormat("zh-CN", { timeZone: "Asia/Tokyo", month: "long", day: "numeric" }).format(new Date());
      const week = new Intl.DateTimeFormat("zh-CN", { timeZone: "Asia/Tokyo", weekday: "short" }).format(new Date());
      return `${day} · ${week}`;
    } catch {
      return "";
    }
  }

  async function renderToday(ctx) {
    if (!$card(ctx, "today")) return;
    const [mood, map] = await Promise.all([
      cached("mood", TTL.mood, fetchMood, WEATHER_MAX_STALE_MS).catch(() => null),
      cached("mood-map", TTL.moodMap, fetchMoodMap).catch(() => null),
    ]);
    const fallback = map?.default || { emoji: "🌸", text: "天气", image: "relaxed.webp", mood: "今天也慢慢来" };
    const entry = mood ? (map?.[String(mood.code)] || fallback) : fallback;
    const temp  = mood && Number.isFinite(mood.temp) ? `${Math.round(mood.temp)}°C` : "--°C";
    const place = mood ? `今日东京 · ${entry.text || "天气"}` : "东京天气暂时没有回应";
    const image = moodImagePath(entry.image || fallback.image);
    const body = setBody(ctx, "today", `
      <div class="mood-display${mood ? "" : " is-offline"}">
        <div class="mood-info">
          <p class="mood-date">${escapeHTML(tokyoDate())}</p>
          <div class="mood-weather">
            <span class="mood-emoji" aria-hidden="true">${escapeHTML(mood ? entry.emoji || "🌸" : "🌸")}</span>
            <div class="mood-meta">
              <span class="mood-temp">${temp}</span>
              <span class="mood-weather-text">${escapeHTML(place)}</span>
            </div>
          </div>
          <p class="mood-note">${escapeHTML(entry.mood || "今天也慢慢来")}</p>
        </div>
        <img class="mood-avatar" src="${escapeHTML(image)}" alt="" width="76" height="76" loading="lazy" decoding="async">
      </div>
    `);
    if (body && !mood) body.setAttribute("title", "天气数据会在稍后自动重试");
    else if (body) body.removeAttribute("title");
  }

  // ---------------- 最近更新 ----------------
  async function renderUpdates(ctx) {
    if (!$card(ctx, "update")) return;
    let items;
    try {
      items = list(await loadUpdates());
    } catch (err) {
      console.warn("[home-cards] updates index failed:", err);
      setBody(ctx, "update", `
        ${emptyState("更新日志暂时加载失败")}
        <p class="home-card-foot"><a class="home-card-more" href="${aboutUpdateUrl()}">打开更新日志 →</a></p>`);
      return;
    }
    const sorted = [...items].sort((a, b) => String(b.date || "").localeCompare(String(a.date || "")));
    if (!sorted.length) {
      setBody(ctx, "update", emptyState("还没有更新记录"));
      return;
    }
    const html = sorted.slice(0, COUNT.updates).map((u) => {
      const d = parseDate(u.date);
      const title = u.title || "未命名更新";
      const note = u.meta || u.summary || "";
      return `
        <li class="home-update">
          <a class="bento-list-link home-update__link" href="${escapeHTML(aboutUpdateUrl(updateToken(u)))}">
            <time class="home-update__date" datetime="${escapeHTML(d?.iso || "")}">
              <span class="home-update__day">${d ? `${d.m}.${d.d}` : "--"}</span>
              <span class="home-update__year">${d ? d.y : ""}</span>
            </time>
            <span class="home-update__text">
              <span class="home-update__title" title="${escapeHTML(title)}">${escapeHTML(title)}</span>
              ${note ? `<span class="home-update__summary">${escapeHTML(note)}</span>` : ""}
            </span>
          </a>
        </li>`;
    }).join("");
    setBody(ctx, "update", `
      <ol class="home-updates">${html}</ol>
      <p class="home-card-foot">
        <span>共 ${sorted.length} 条日志</span>
        <a class="home-card-more" href="${aboutUpdateUrl()}">完整更新日志 →</a>
      </p>`);
  }

  // ---------------- 站点速览 ----------------
  // 口径与 About 概览一致:笔记 / 作品(动漫)/ 收藏(画廊图片)取自 site-meta 聚合,
  // 累计更新取自更新索引条数(索引不可用时退回 site-meta),建站天数按本地日期实时计算。
  // 注意:Life 统一图片索引(data/image-index.json)含动漫详情配图,不与这里的「收藏」混算。
  async function renderStats(ctx) {
    if (!$card(ctx, "stats")) return;
    const [meta, updates] = await Promise.all([
      loadMeta().catch(() => null),
      loadUpdates().catch(() => null),
    ]);
    if (!meta) {
      setBody(ctx, "stats", emptyState("统计数据暂不可用，可在关于页查看"));
      return;
    }
    const totals = meta.totals || {};
    const updateCount = Array.isArray(updates) ? updates.length : totals.updates;
    const birthday = meta.siteBirthday || FALLBACK_BIRTHDAY;
    const days = daysSince(birthday);
    const metrics = [
      { label: "笔记", value: totals.notes, hint: "数学与物理笔记" },
      { label: "作品", value: totals.anime, hint: "Life · 动漫作品" },
      { label: "收藏", value: totals.gallery, hint: "Life · 画廊图片" },
      { label: "更新", value: updateCount, hint: "累计更新日志" },
    ];
    setBody(ctx, "stats", `
      <dl class="home-stats">
        ${metrics.map((m) => `
          <div class="home-stat" title="${escapeHTML(m.hint)}">
            <dt>${escapeHTML(m.label)}</dt>
            <dd>${escapeHTML(m.value ?? "--")}</dd>
          </div>`).join("")}
      </dl>
      <p class="home-stats__days">
        建站第 <strong>${escapeHTML(days ?? "--")}</strong> 天
        <span aria-hidden="true">·</span> 始于 ${escapeHTML(fmtDate(birthday) || "--")}
      </p>`);
  }

  // ---------------- 数学与笔记 ----------------
  async function renderNotes(ctx) {
    if (!$card(ctx, "notes")) return;
    let notes;
    try {
      notes = list(await loadNotes()).filter((n) => n && n.file && n.title);
    } catch (err) {
      console.warn("[home-cards] notes index failed:", err);
      setBody(ctx, "notes", emptyState("笔记暂时加载失败，可以直接进入笔记页查看"));
      return;
    }
    if (!notes.length) {
      setBody(ctx, "notes", emptyState("还没有笔记"));
      return;
    }
    const recent = [...notes]
      .sort((a, b) => String(b.date || "").localeCompare(String(a.date || "")))
      .slice(0, COUNT.notes);
    const categories = new Set(notes.map((n) => n.category).filter(Boolean));
    const html = recent.map((n) => {
      const d = parseDate(n.date);
      return `
        <li class="home-note">
          <a class="home-note__link" href="${escapeHTML(noteUrl(n.file))}">
            <span class="home-note__head">
              <span class="home-note__title">${escapeHTML(n.title)}</span>
              <span class="home-note__meta">
                ${n.category ? `<span class="home-note__tag">${escapeHTML(n.category)}</span>` : ""}
                ${d ? `<time datetime="${d.iso}">${fmtDate(n.date)}</time>` : ""}
              </span>
            </span>
            <span class="home-note__preview" data-note-preview="${escapeHTML(n.file)}"></span>
          </a>
        </li>`;
    }).join("");
    const body = setBody(ctx, "notes", `
      <ol class="home-notes">${html}</ol>
      <p class="home-card-foot home-card-foot--note">
        <span>共 ${notes.length} 篇笔记 · ${categories.size} 个分类</span>
      </p>`);
    if (!body) return;

    // 预览逐篇落地,失败只留空,不影响列表
    body.querySelectorAll("[data-note-preview]").forEach((el) => {
      loadNotePreview(el.dataset.notePreview).then((text) => {
        if (!ctx.alive() || !el.isConnected) return;
        if (!text) { el.hidden = true; return; }
        el.textContent = text;
        el.classList.add("is-ready");
        renderMath(el);
      });
    });
  }

  // ---------------- 生活片段 ----------------
  function recentWorks() {
    if (typeof animeData !== "object" || !animeData) return [];
    return Object.entries(animeData)
      .map(([id, a], index) => ({ id, ...a, index }))
      .filter((a) => a.image)
      .sort((x, y) => String(y.updateDate || "").localeCompare(String(x.updateDate || ""))
        || (x.order ?? x.index) - (y.order ?? y.index))
      .slice(0, COUNT.works)
      .map((a) => ({
        kind: "作品",
        title: a.title || a.id,
        alt: `${a.title || a.id} 封面`,
        src: assetPath(a.image),
        href: `html/anime-detail.html?id=${encodeURIComponent(a.id)}`,
        label: `查看作品：${a.title || a.id}`,
      }));
  }

  // 与 Life 总览「精选收藏」同一排序(order 小在前);缩略图是竖向裁切,优先取竖图,少裁人物
  function featuredGallery() {
    if (typeof galleryData === "undefined" || !Array.isArray(galleryData)) return [];
    const href = lifeUrl({ tab: "collections", type: "gallery" });
    const sorted = [...galleryData]
      .filter((g) => g && (g.thumb || g.src))
      .sort((a, b) => (a.order || 0) - (b.order || 0));
    const portrait = (g) => !(g.width > 0 && g.height > 0) || g.height >= g.width;
    return [...sorted.filter(portrait), ...sorted.filter((g) => !portrait(g))]
      .slice(0, COUNT.gallery)
      .map((g) => ({
        kind: "收藏",
        title: "",
        alt: g.note || "收藏图片",
        src: assetPath(g.thumb || g.src),
        href,
        label: `打开收藏画廊${g.note ? `：${g.note}` : ""}`,
      }));
  }

  function renderLife(ctx) {
    if (!$card(ctx, "life")) return;
    const tiles = [...recentWorks(), ...featuredGallery()];
    const sections = [
      { label: "作品", href: lifeUrl({ tab: "works", type: "anime" }) },
      { label: "收藏", href: lifeUrl({ tab: "collections", type: "gallery" }) },
      { label: "足迹", href: lifeUrl({ tab: "journey" }) },
      { label: "日记", href: lifeUrl({ tab: "journal" }) },
    ];
    const tilesHtml = tiles.length
      ? `<ul class="home-life-tiles">${tiles.map((t) => `
          <li>
            <a class="home-life-tile" href="${escapeHTML(t.href)}" aria-label="${escapeHTML(t.label)}">
              <img src="${escapeHTML(t.src)}" alt="${escapeHTML(t.alt)}" loading="lazy" decoding="async">
              <span class="home-life-tile__badge" aria-hidden="true">${escapeHTML(t.kind)}</span>
              ${t.title ? `<span class="home-life-tile__caption" aria-hidden="true">${escapeHTML(t.title)}</span>` : ""}
            </a>
          </li>`).join("")}</ul>`
      : emptyState("作品与收藏还在整理中");
    const body = setBody(ctx, "life", `
      ${tilesHtml}
      <div class="home-life-journal" data-home-journal hidden></div>
      <nav class="home-life-links" aria-label="生活分区">
        ${sections.map((s) => `<a class="home-life-chip" href="${escapeHTML(s.href)}">${escapeHTML(s.label)}</a>`).join("")}
      </nav>`);
    if (!body) return;

    // 最新日记:有记录才出现,失败静默
    loadJournal().then((index) => {
      const entry = list(index?.entries).filter((e) => e && e.id && e.title)
        .sort((a, b) => String(b.date || "").localeCompare(String(a.date || "")))[0];
      const slot = body.querySelector("[data-home-journal]");
      if (!entry || !ctx.alive() || !slot) return;
      slot.innerHTML = `
        <a class="home-life-journal__link" href="${escapeHTML(lifeUrl({ tab: "journal", entry: entry.id }))}">
          <span class="home-life-journal__kind">最新日记</span>
          <span class="home-life-journal__title">${escapeHTML(entry.title)}</span>
          ${entry.date ? `<time datetime="${escapeHTML(parseDate(entry.date)?.iso || "")}">${escapeHTML(fmtDate(entry.date))}</time>` : ""}
        </a>`;
      slot.hidden = false;
    }).catch(() => {});
  }

  // ---------------- 站内跳转:交给 main.js 的统一路由 ----------------
  function bindRoutes(root) {
    root.addEventListener("click", (event) => {
      const target = event.target instanceof Element ? event.target : null;
      const link = target?.closest('a[href^="index.html?page="]');
      if (!link || !root.contains(link) || event.defaultPrevented || event.button !== 0
        || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
      if (typeof window._loadPage !== "function") return; // 路由不可用时按普通链接整页跳转

      const params = new URLSearchParams(link.getAttribute("href").split("?")[1] || "");
      const page = params.get("page");
      let options;
      if (page === "about") {
        options = { about: { tab: params.get("tab") || "", update: params.get("update") || "" } };
      } else if (page === "life") {
        const life = {};
        ["tab", "type", "status", "entry"].forEach((key) => {
          if (params.get(key)) life[key] = params.get(key);
        });
        options = { life };
      } else if (page === "notes") {
        options = { note: params.get("note") || "" };
      } else {
        return;
      }
      event.preventDefault();
      window._loadPage(page, true, options);
    });
  }

  // ---------------- 入口 ----------------
  function initHomeCards() {
    const root = document.querySelector("[data-home-root]");
    if (!root || root.dataset.homeBound === "1") return;
    root.dataset.homeBound = "1";

    const ctx = { root };
    ctx.alive = () => mount === ctx && root.isConnected;
    mount = ctx;

    bindRoutes(root);
    renderPortrait(ctx);
    renderNotes(ctx);
    renderLife(ctx);
    renderUpdates(ctx);
    renderToday(ctx);
    renderStats(ctx);
    scheduleMoodRefresh();
    schedulePortraitRefresh();
  }

  function scheduleMoodRefresh() {
    if (moodRefreshTimer) window.clearInterval(moodRefreshTimer);
    moodRefreshTimer = window.setInterval(() => {
      memCache.delete("mood");
      if (mount && mount.alive()) renderToday(mount);
    }, MOOD_REFRESH_MS);
  }

  function schedulePortraitRefresh() {
    if (portraitRefreshTimer) window.clearTimeout(portraitRefreshTimer);

    const now = new Date();
    const nextMidnight = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1);
    const delay = Math.max(1000, nextMidnight.getTime() - now.getTime() + PORTRAIT_REFRESH_BUFFER_MS);

    portraitRefreshTimer = window.setTimeout(() => {
      if (mount && mount.alive()) {
        renderPortrait(mount);
        renderStats(mount); // 建站天数跨天 +1
      }
      schedulePortraitRefresh();
    }, delay);
  }

  window.initHomeCards = initHomeCards;

  // 首次进入主页时,main.js 不主动调 runPageInit,所以本脚本自己绑定
  document.addEventListener("DOMContentLoaded", () => {
    if (document.body.dataset.standalone === "true") return;
    const page = new URLSearchParams(window.location.search).get("page") || "home";
    if (page !== "home") return;
    initHomeCards();
  });
})();
