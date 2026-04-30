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
  const WALINE_API     = "https://yang283643-waline.vercel.app";
  const STORAGE_PREFIX = "y181_";

  const TTL = {
    about:    1000 * 60 * 60 * 24,   // 静态 1 天
    notes:    1000 * 60 * 60 * 24,
    updates:  1000 * 60 * 60 * 24,
    moodMap:  1000 * 60 * 60 * 24,
    mood:     1000 * 60 * 30,        // 30 分钟
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

  // ---------------- 数据源 ----------------
  async function fetchJson(url) {
    const res = await fetch(url);
    if (!res.ok) throw new Error(`${url} → ${res.status}`);
    return res.json();
  }

  const fetchAbout    = () => fetchJson("data/about.json");
  const fetchMoodMap  = () => fetchJson("data/mood-map.json");
  const fetchNotes    = () => fetchJson("data/notes-index.json");
  const fetchUpdates  = () => fetchJson("data/updates-index.json");

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
      const entry = map[code] || map.default || { emoji: "🌸", text: "" };
      const temp  = mood.temp != null ? `${Math.round(mood.temp)}°C` : "--°C";
      setBody(card, `
        <div class="mood-display">
          <div class="mood-emoji" aria-hidden="true">${entry.emoji}</div>
          <div class="mood-meta">
            <div class="mood-temp">${temp}</div>
            <div class="mood-text">${escapeHTML(entry.text || "")}</div>
          </div>
        </div>
      `);
    } catch {
      setBody(card, `<p class="bento-text bento-text--muted">心情获取失败</p>`);
    }
  }

  // 3. stats - 站点统计
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

      setBody(card, `
        <ul class="stats-list">
          <li><span class="stats-num">${notes.length}</span><span class="stats-label">笔记</span></li>
          <li><span class="stats-num">${animeCount}</span><span class="stats-label">追番</span></li>
          <li><span class="stats-num">${comments.length}</span><span class="stats-label">留言</span></li>
          <li><span class="stats-num">${days}</span><span class="stats-label">天</span></li>
        </ul>
      `);
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
      const list = await cached("updates", TTL.updates, fetchUpdates);
      const recent = list.slice(0, COUNT.update);  // updates-index 已倒序
      const html = recent.map(u => {
        const m = u.file && u.file.match(/(\d{4}-\d{2}-\d{2})/);
        const date = m ? m[1] : "";
        const slug = u.file ? u.file.split("/").pop().replace(/\.md$/, "") : "";
        return `
          <li class="bento-list-item">
            <a class="bento-list-link"
               href="index.html?page=update&update=${encodeURIComponent(slug)}">
              <span class="bento-list-title">${escapeHTML(date)} 更新</span>
              <span class="bento-list-meta">${fmtDate(date)}</span>
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
    renderIntro();
    renderMood();
    renderStats();
    renderNotes();
    renderAnime();
    renderGallery();
    renderUpdate();
    renderComment();
    renderAboutMe();
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