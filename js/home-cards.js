// ============================================================
// js/home-cards.js
// 主页 9 张 bento 卡数据灌入 —— Phase E
//
// 渲染策略:9 卡并发请求,各自渲染,骨架屏 200-800ms 内逐个褪色
// 缓存层:内存 Map(同会话零延迟) + localStorage(y181_ 前缀,跨会话)
// 失败兜底:用过期 localStorage 缓存
// ============================================================

(function () {
  "use strict";

  // ---------------- 常量 ----------------
  const SITE_BIRTHDAY  = "2026-04-13";                          // 建站日
  const NEW_TAG_DAYS   = 7;                                     // anime NEW 阈值
  const TOKYO_LAT      = 35.6762;
  const TOKYO_LNG      = 139.6503;
  const MOOD_REFRESH_MS = 1000 * 60 * 60;                       // 60 分钟
  const PORTRAIT_REFRESH_BUFFER_MS = 1000;                      // 零点后 1 秒刷新
  const WALINE_API     = "https://yang283643-waline.vercel.app";
  const STORAGE_PREFIX = "y181_";

  const TTL = {
    about:    1000 * 60 * 60 * 24,   // 静态 1 天
    notes:    1000 * 60 * 60 * 24,
    updates:  1000 * 60 * 60 * 24,
    moodMap:  1000 * 60 * 60 * 24,
    mood:     MOOD_REFRESH_MS,
    comments: 1000 * 60 * 60,        // 1 小时
  };

  const COUNT = {
    notes:    4,
    anime:    3,
    gallery:  4,
    update:   3,
    comment:  3,
  };

  // 同会话内存缓存
  const memCache = new Map();
  let moodRefreshTimer = null;
  let portraitRefreshTimer = null;

  // ---------------- 缓存核心 ----------------
  /**
   * 三段式取数据:内存 → 未过期 localStorage → 网络;失败回退过期 localStorage
   */
  async function cached(key, ttl, fetcher) {
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
      if (stored) {
        memCache.set(key, stored.v);
        return stored.v;
      }
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
  function $card(name) {
    return document.querySelector(`.bento-card[data-card="${name}"]`);
  }
  function setBody(card, html) {
    if (!card) return;
    const body = card.querySelector(".bento-card-body");
    if (!body) return;
    body.classList.remove("is-skeleton");
    body.innerHTML = html;
  }
  function fmtDate(s) {
    if (!s) return "";
    const m = String(s).match(/^(\d{4})-(\d{2})-(\d{2})/);
    return m ? `${m[2]}-${m[3]}` : String(s).slice(0, 10);
  }
  function daysSince(d) {
    if (!d) return Infinity;
    const t = new Date(d).getTime();
    if (Number.isNaN(t)) return Infinity;
    return (Date.now() - t) / (1000 * 60 * 60 * 24);
  }
  function escapeHTML(s) {
    return String(s ?? "").replace(/[&<>"']/g, c => ({
      "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"
    }[c]));
  }
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

  // ---------------- 数据源 ----------------
  async function fetchJson(url) {
    const res = await fetch(url);
    if (!res.ok) throw new Error(`${url} → ${res.status}`);
    return res.json();
  }

  const fetchAbout    = () => fetchJson("data/about.json");
  const fetchMoodMap  = () => fetchJson("data/mood-map.json");
  const fetchNotes    = () => fetchJson("data/notes-index.json");
  const fetchPortraitRotation = () => fetchJson("data/portrait-rotation.json");

  async function fetchUpdates() {
  const index = await fetchJson("data/updates-index.json");

  // 并发拿每个 md 的 title 和 date(单个失败不影响其他)
  const items = await Promise.all(
    index.map(async (entry) => {
      const fallbackDate = (entry.file.match(/(\d{4}-\d{2}-\d{2})/) || [])[1] || "";
      try {
        const res = await fetch(entry.file);
        if (!res.ok) throw new Error(`fetch ${entry.file} failed`);
        const md = (await res.text()).replace(/\r\n/g, "\n");
        let title = "";
        let date = "";
        for (const raw of md.split("\n")) {
          const line = raw.trim();
          if (!title && line.startsWith("# ")) title = line.slice(2).trim();
          if (line.startsWith("@date:"))      date = line.replace("@date:", "").trim();
          if (title && date) break;
        }
        return { ...entry, title, date: date || fallbackDate };
      } catch {
        return { ...entry, title: "", date: fallbackDate };
      }
    })
  );

  return items;
}

  async function fetchMood() {
    const url = `https://api.open-meteo.com/v1/forecast`
              + `?latitude=${TOKYO_LAT}&longitude=${TOKYO_LNG}`
              + `&current=temperature_2m,weather_code&timezone=Asia/Tokyo`;
    const data = await fetchJson(url);
    return {
      temp: data.current?.temperature_2m,
      code: data.current?.weather_code,
    };
  }

  async function fetchCommentsRecent() {
    // 一次拿 100 条:comment 卡用前 N 条,stats 卡数 length
    const url = `${WALINE_API}/api/comment?type=recent&pageSize=100`;
    const data = await fetchJson(url);
    // Waline 可能返回数组或 { data: [...] } 包裹
    return Array.isArray(data) ? data : (data?.data || []);
  }

  // ---------------- 各卡渲染 ----------------

  // 1. intro - 关于这个网页
  async function renderIntro() {
    const card = $card("intro");
    if (!card) return;
    try {
      const data = await cached("about", TTL.about, fetchAbout);
      setBody(card, `<p class="bento-text">${escapeHTML(data.intro || "").replace(/\n/g, "<br>")}</p>`);
    } catch {
      setBody(card, `<p class="bento-text bento-text--muted">介绍加载失败</p>`);
    }
  }

  // 2. mood - 今日心情
  async function renderMood() {
    const card = $card("mood");
    if (!card) return;
    try {
      const [mood, map] = await Promise.all([
        cached("mood", TTL.mood, fetchMood),
        cached("mood-map", TTL.moodMap, fetchMoodMap),
      ]);
      const code  = String(mood.code ?? "default");
      const entry = map[code] || map.default || {
        emoji: "🌸",
        text: "天气",
        image: "relaxed.webp",
        mood: "今天也慢慢来",
      };
      const temp  = mood.temp != null ? `${Math.round(mood.temp)}°C` : "--°C";
      const image = moodImagePath(entry.image || map.default?.image);
      setBody(card, `
        <div class="mood-display">
          <div class="mood-info">
            <div class="mood-weather">
              <div class="mood-emoji" aria-hidden="true">${escapeHTML(entry.emoji || "🌸")}</div>
              <div class="mood-meta">
                <div class="mood-temp">${temp}</div>
                <div class="mood-weather-text">今日东京：${escapeHTML(entry.text || "天气")}</div>
              </div>
            </div>
            <div class="mood-note">${escapeHTML(entry.mood || "今天也慢慢来")}</div>
          </div>
          <img class="mood-avatar" src="${escapeHTML(image)}" alt="" loading="lazy">
        </div>
      `);
    } catch {
      setBody(card, `<p class="bento-text bento-text--muted">东京天气获取失败</p>`);
    }
  }

  async function renderPortraitRotation() {
    const qImg = document.querySelector(".bento-card-deco--portrait-q img");
    const halfImg = document.querySelector(".bento-card-deco--portrait-half img");
    if (!qImg && !halfImg) return;

    try {
      const data = await fetchPortraitRotation();
      const qSrc = pickDailyImage(data.sets?.q, data.startDate);
      const halfSrc = pickDailyImage(data.sets?.half, data.startDate);

      if (qImg && qSrc && qImg.getAttribute("src") !== qSrc) qImg.src = qSrc;
      if (halfImg && halfSrc && halfImg.getAttribute("src") !== halfSrc) halfImg.src = halfSrc;
    } catch (err) {
      console.warn("[home-cards] portrait rotation fetch failed:", err);
    }
  }

  // 3. stats - 站点统计
  const STATS_ICONS = {
    notes:   `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 20h9"/><path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z"/></svg>`,
    anime:   `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="2" y="7" width="20" height="15" rx="2"/><polyline points="17 2 12 7 7 2"/></svg>`,
    comment: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg>`,
    days:    `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="4" width="18" height="18" rx="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/></svg>`,
  };

  async function renderStats() {
    const card = $card("stats");
    if (!card) return;
    try {
      const [notes, comments] = await Promise.all([
        cached("notes", TTL.notes, fetchNotes),
        cached("comments-recent", TTL.comments, fetchCommentsRecent),
      ]);
      const animeCount = (typeof animeData === "object" && animeData)
        ? Object.keys(animeData).length : 0;
      const days = Math.max(1, Math.floor(daysSince(SITE_BIRTHDAY)));

      // 笔记 / 追番 / 留言 三项互相对比(以三者最大值为基准)
      // 建站固定 100%,不参与归一化(避免天数膨胀后压扁其他三项)
      const notesCount    = notes.length;
      const commentsCount = comments.length;
      const normMax = Math.max(notesCount, animeCount, commentsCount, 1);

      const items = [
        { label: "笔记", value: notesCount,    pct: (notesCount    / normMax) * 100, icon: STATS_ICONS.notes   },
        { label: "追番", value: animeCount,    pct: (animeCount    / normMax) * 100, icon: STATS_ICONS.anime   },
        { label: "留言", value: commentsCount, pct: (commentsCount / normMax) * 100, icon: STATS_ICONS.comment },
        { label: "建站", value: days,          pct: 100,                              icon: STATS_ICONS.days    },
      ];

      const html = items.map(it => {
        const pct = Math.min(100, Math.max(0, it.pct));
        return `
          <li class="stats-row">
            <span class="stats-row-icon" aria-hidden="true">${it.icon}</span>
            <span class="stats-row-label">${it.label}</span>
            <span class="stats-row-bar">
              <span class="stats-row-bar-fill" style="--fill:${pct.toFixed(1)}%"></span>
            </span>
            <span class="stats-row-value">${it.value}</span>
          </li>
        `;
      }).join("");
      setBody(card, `<ul class="stats-list">${html}</ul>`);
    } catch {
      setBody(card, `<p class="bento-text bento-text--muted">统计加载失败</p>`);
    }
  }

  // 4. notes - 笔记更新
  async function renderNotes() {
    const card = $card("notes");
    if (!card) return;
    try {
      const notes = await cached("notes", TTL.notes, fetchNotes);
      const recent = [...notes]
        .sort((a, b) => (b.date || "").localeCompare(a.date || ""))
        .slice(0, COUNT.notes);
      const html = recent.map(n => `
        <li class="bento-list-item">
          <a class="bento-list-link" href="index.html?page=notes">
            <span class="bento-list-title">${escapeHTML(n.title)}</span>
            <span class="bento-list-meta">${escapeHTML(n.category || "")} · ${fmtDate(n.date)}</span>
          </a>
        </li>
      `).join("");
      setBody(card, `<ul class="bento-list">${html}</ul>`);
    } catch {
      setBody(card, `<p class="bento-text bento-text--muted">笔记加载失败</p>`);
    }
  }

  // 5. anime - 动漫追番(同步,数据来自 anime-data.js)
  function renderAnime() {
    const card = $card("anime");
    if (!card) return;
    if (typeof animeData !== "object" || !animeData) {
      setBody(card, `<p class="bento-text bento-text--muted">动漫数据缺失</p>`);
      return;
    }
    // 末尾 N 个 reverse(顺序约定:新增追加到末尾)
    const recent = Object.keys(animeData).slice(-COUNT.anime).reverse();
    const html = recent.map(id => {
      const a = animeData[id];
      const cover = (a.image || "").replace(/^\.\.\//, "");  // 详情页是 ../,主页去掉
      const isNew = daysSince(a.updateDate) <= NEW_TAG_DAYS;
      const newTag = isNew ? `<span class="bento-tag-new">NEW</span>` : "";
      return `
        <li class="bento-anime-item">
          <a href="html/anime-detail.html?id=${encodeURIComponent(id)}" class="bento-anime-link">
            <span class="bento-anime-cover-wrap">
              <img class="bento-anime-cover" src="${escapeHTML(cover)}" alt="${escapeHTML(a.title)}" loading="lazy">
              ${newTag}
            </span>
            <span class="bento-anime-title">${escapeHTML(a.title)}</span>
          </a>
        </li>
      `;
    }).join("");
    setBody(card, `<ul class="bento-anime-list">${html}</ul>`);
  }

  // 6. gallery - 画廊更新(同步,数据来自 gallery-data.js)
  function renderGallery() {
    const card = $card("gallery");
    if (!card) return;
    if (typeof galleryData !== "object" || !Array.isArray(galleryData)) {
      setBody(card, `<p class="bento-text bento-text--muted">画廊数据缺失</p>`);
      return;
    }
    // 按 order 倒序取最新
    const recent = [...galleryData]
      .sort((a, b) => (b.order || 0) - (a.order || 0))
      .slice(0, COUNT.gallery);
    const html = recent.map(g => `
      <a href="index.html?page=gallery" class="bento-gallery-item">
        <img src="${escapeHTML(g.src)}" alt="" loading="lazy">
      </a>
    `).join("");
    setBody(card, `<div class="bento-gallery-grid">${html}</div>`);
  }

  // 7. update - 更新公告
  async function renderUpdate() {
    const card = $card("update");
    if (!card) return;
    try {
      // cache key 升级到 v2，让旧缓存(只有 file 字段的)自动失效
      const list = await cached("updates-v2", TTL.updates, fetchUpdates);
      const recent = list.slice(0, COUNT.update);  // updates-index 已倒序
      const html = recent.map(u => {
        const slug = u.file ? u.file.split("/").pop().replace(/\.md$/, "") : "";
        const title = u.title || "未命名更新";
        return `
          <li class="bento-list-item">
            <a class="bento-list-link"
              href="index.html?page=update&update=${encodeURIComponent(slug)}">
              <span class="bento-list-title">${escapeHTML(title)}</span>
              <span class="bento-list-meta">${fmtDate(u.date)}</span>
            </a>
          </li>
        `;
      }).join("");
      setBody(card, `<ul class="bento-list">${html}</ul>`);
    } catch {
      setBody(card, `<p class="bento-text bento-text--muted">更新加载失败</p>`);
    }
  }

  // 8. comment - 留言板
  async function renderComment() {
    const card = $card("comment");
    if (!card) return;
    try {
      const items = await cached("comments-recent", TTL.comments, fetchCommentsRecent);
      const recent = items.slice(0, COUNT.comment);
      if (!recent.length) {
        setBody(card, `<p class="bento-text bento-text--muted">还没有留言,过来聊聊吧 ~</p>`);
        return;
      }
      const tmp = document.createElement("div");
      const html = recent.map(c => {
        tmp.innerHTML = c.comment || "";
        const text = (tmp.textContent || "").trim().slice(0, 32);
        return `
          <li class="bento-list-item">
            <a class="bento-list-link" href="index.html?page=comment">
              <span class="bento-list-title">
                <strong>${escapeHTML(c.nick || "匿名")}</strong>: ${escapeHTML(text)}
              </span>
            </a>
          </li>
        `;
      }).join("");
      setBody(card, `<ul class="bento-list">${html}</ul>`);
    } catch {
      setBody(card, `<p class="bento-text bento-text--muted">留言加载失败</p>`);
    }
  }

  // 9. about-me - 关于我
  async function renderAboutMe() {
    const card = $card("about-me");
    if (!card) return;
    try {
      const data = await cached("about", TTL.about, fetchAbout);
      setBody(card, `<p class="bento-text">${escapeHTML(data.aboutMe || "").replace(/\n/g, "<br>")}</p>`);
    } catch {
      setBody(card, `<p class="bento-text bento-text--muted">介绍加载失败</p>`);
    }
  }

  // ---------------- 入口 ----------------
  function initHomeCards() {
    renderPortraitRotation();
    schedulePortraitRefresh();
    renderIntro();
    renderMood();
    scheduleMoodRefresh();
    renderStats();
    renderNotes();
    renderAnime();
    renderGallery();
    renderUpdate();
    renderComment();
    renderAboutMe();
  }

  function scheduleMoodRefresh() {
    if (moodRefreshTimer) window.clearInterval(moodRefreshTimer);
    moodRefreshTimer = window.setInterval(() => {
      memCache.delete("mood");
      renderMood();
    }, MOOD_REFRESH_MS);
  }

  function schedulePortraitRefresh() {
    if (portraitRefreshTimer) window.clearTimeout(portraitRefreshTimer);

    const now = new Date();
    const nextMidnight = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1);
    const delay = Math.max(1000, nextMidnight.getTime() - now.getTime() + PORTRAIT_REFRESH_BUFFER_MS);

    portraitRefreshTimer = window.setTimeout(() => {
      renderPortraitRotation();
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
