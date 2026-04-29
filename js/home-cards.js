// ============================================================
// js/home-cards.js
// 主页 9 张主卡的数据注入入口
//
// Commit 5：intro / about-me / notes / update（4 张同步/JSON 卡）
// Commit 6：anime / gallery / stats（3 张本地数据卡 + count-up 动画）
// Commit 7：去除 cardsInjected 守卫，修 SPA 切回主页数据丢失
// Commit 8：mood 天气 API + stats 留言数 Waline API（最后 2 个异步源，9 张卡全部活了）
//
// 数据源：
//   data/about.json          —— 关于网页 + 关于我 文案
//   data/notes-index.json    —— 笔记索引
//   data/updates-index.json  —— 更新索引
//   data/mood-map.json       —— Open-Meteo weather code → emoji+文案
//   window.animeData         —— anime-data.js 注入的全局变量
//   window.galleryData       —— gallery-data.js 注入的全局变量
//   Open-Meteo API           —— 东京当前天气（30min localStorage 缓存）
//   Waline recent API        —— 全站留言数（1h localStorage 缓存）
// ============================================================

(function () {
  'use strict';

  // -------------------- 常量 --------------------

  const NEW_THRESHOLD_DAYS = 7;
  const SITE_LAUNCH_DATE = '2026-04-13';

  // Commit 8: 外部 API 配置
  const WALINE_SERVER_URL = 'https://yang283643-waline.vercel.app';
  const TOKYO_LAT = 35.6762;
  const TOKYO_LNG = 139.6503;
  const TOKYO_LABEL = '东京';

  // localStorage 缓存（前缀 y181_ 沿用既有约定）
  const MOOD_CACHE_KEY = 'y181_mood_cache';
  const MOOD_CACHE_TTL_MS = 30 * 60 * 1000;        // 30 min
  const COMMENT_CACHE_KEY = 'y181_comment_count_cache';
  const COMMENT_CACHE_TTL_MS = 60 * 60 * 1000;     // 1 hour

  // mood 卡终极 fallback（缓存也没有 + API 失败）
  const MOOD_FALLBACK = { emoji: '🌸', text: '今日心情未知', temp: null };

  // -------------------- 自启动 --------------------

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initHomeCards, { once: true });
  } else {
    initHomeCards();
  }

  // 暴露给 main.js，SPA 切回主页时再调一次
  window.initHomeCards = initHomeCards;

  // -------------------- 主流程 --------------------

  async function initHomeCards() {
    const grid = document.querySelector('.bento-grid');
    if (!grid) return;

    // 注意：这里曾有 grid.dataset.cardsInjected 守卫，已删除。
    // 原因：该 flag 在 await 前同步写入 DOM。main.js 在 DOMContentLoaded 时
    // 抓的 homeContent 字符串里会带上 data-cards-injected="1"，但内容还是骨架
    // （因为 fetch 还没回来）。SPA 切回主页时 main.innerHTML 会还原这份"带 flag
    // 的骨架"，再次调用 initHomeCards 会被 flag 直接拦截，导致主页卡片永远
    // 停留在 "介绍文案待 Phase E 注入..." 这种占位态。
    // 现改为每次调用都全量重渲染（幂等：所有 fillXxxCard 都先清空 body 再写）。

    // 3 个 JSON 并行
    const [aboutRes, notesRes, updatesRes] = await Promise.allSettled([
      fetchJSON('data/about.json'),
      fetchJSON('data/notes-index.json'),
      fetchJSON('data/updates-index.json'),
    ]);

    // ---------- Commit 5：4 张同步/JSON 卡 ----------

    if (aboutRes.status === 'fulfilled' && aboutRes.value) {
      if (aboutRes.value.intro)   fillTextCard('intro',    aboutRes.value.intro);
      if (aboutRes.value.aboutMe) fillTextCard('about-me', aboutRes.value.aboutMe);
    }

    if (notesRes.status === 'fulfilled' && Array.isArray(notesRes.value)) {
      fillNotesCard(notesRes.value);
    }

    if (updatesRes.status === 'fulfilled' && Array.isArray(updatesRes.value)) {
      fillUpdatesCard(updatesRes.value).catch(err => {
        console.warn('[home-cards] updates render failed:', err);
      });
    }

    // ---------- Commit 6：anime / gallery / stats ----------

    const hasAnime   = typeof animeData   !== 'undefined' && animeData;
    const hasGallery = typeof galleryData !== 'undefined' && Array.isArray(galleryData);

    if (hasAnime)   fillAnimeCard(animeData);
    if (hasGallery) fillGalleryCard(galleryData);

    fillStatsCard({
      notesCount:
        notesRes.status === 'fulfilled' && Array.isArray(notesRes.value)
          ? notesRes.value.length
          : NaN,
      animeCount: hasAnime ? Object.keys(animeData).length : NaN,
      commentCount: NaN, // Commit 8: 占位 ─，下面 loadCommentCount() 异步补
      daysCount: computeDaysSince(SITE_LAUNCH_DATE),
    });

    // ---------- Commit 8：异步外部 API（不 await，让它们后台跑）----------

    loadMoodCard();
    loadCommentCount();
  }

  // -------------------- Commit 5：文本 / 列表卡 --------------------

  function fillTextCard(cardKey, text) {
    const body = getBody(cardKey);
    if (!body) return;
    body.classList.remove('is-skeleton');
    body.innerHTML = '';
    text.split(/\n+/).forEach(line => {
      const t = line.trim();
      if (!t) return;
      const p = document.createElement('p');
      p.className = 'bento-text-line';
      p.textContent = t;
      body.appendChild(p);
    });
  }

  function fillNotesCard(list) {
    const body = getBody('notes');
    if (!body) return;
    const sorted = [...list]
      .map(it => ({ ...it, _ts: parseDate(it.date) }))
      .sort((a, b) => b._ts - a._ts)
      .slice(0, 3);
    renderList(body, sorted.map(it => ({
      title: it.title || '(无标题)',
      ts: it._ts,
      isNew: false,
    })));
  }

  async function fillUpdatesCard(list) {
    const body = getBody('update');
    if (!body) return;
    const top = [...list]
      .map(it => ({ file: it.file, date: parseUpdateDateFromFile(it.file) }))
      .sort((a, b) => parseDate(b.date) - parseDate(a.date))
      .slice(0, 3);
    const items = await Promise.all(top.map(async it => {
      let title = it.date;
      try {
        const md = await fetch(it.file).then(r => r.ok ? r.text() : '');
        const h1 = extractFirstHeading(md);
        if (h1) title = h1;
      } catch { /* fallback to date */ }
      return {
        title,
        ts: parseDate(it.date),
        isNew: isWithinDays(it.date, NEW_THRESHOLD_DAYS),
      };
    }));
    renderList(body, items);
  }

  // -------------------- Commit 6：anime --------------------

  function fillAnimeCard(animeMap) {
    const body = getBody('anime');
    if (!body) return;

    // 取末尾 3 个 reverse —— 末尾追加约定下，等价"最近"
    const ids = Object.keys(animeMap);
    const recent = ids.slice(-3).reverse();

    body.classList.remove('is-skeleton');
    body.innerHTML = '';

    if (!recent.length) {
      appendEmpty(body);
      return;
    }

    const ul = document.createElement('ul');
    ul.className = 'bento-list bento-list--anime';

    recent.forEach(id => {
      const item = animeMap[id];
      if (!item) return;

      const li = document.createElement('li');
      li.className = 'bento-list-item';

      const a = document.createElement('a');
      a.className = 'bento-anime-row';
      a.href = `html/anime-detail.html?id=${encodeURIComponent(id)}`;

      const img = document.createElement('img');
      img.className = 'bento-anime-thumb';
      img.src = stripParentPath(item.image);
      img.alt = item.title;
      img.loading = 'lazy';
      img.decoding = 'async';
      a.appendChild(img);

      const title = document.createElement('span');
      title.className = 'bento-list-title';
      title.textContent = item.title;
      a.appendChild(title);

      li.appendChild(a);
      ul.appendChild(li);
    });

    body.appendChild(ul);
  }

  // -------------------- Commit 6：gallery --------------------

  function fillGalleryCard(list) {
    const card = document.querySelector('.bento-card[data-card="gallery"]');
    const body = card && card.querySelector('.bento-card-body');
    if (!body) return;

    // 按 order 倒序取 4
    const sorted = [...list]
      .filter(it => it && it.src)
      .sort((a, b) => (b.order || 0) - (a.order || 0))
      .slice(0, 4);

    body.classList.remove('is-skeleton');
    body.innerHTML = '';

    // 删掉装饰图位 —— mosaic 自身就是装饰，避免 :has() 让 body 缩水
    // SPA 切回主页时 main.innerHTML 还原骨架会把 deco 带回来，这里再次 remove
    // 是幂等的（找不到就 no-op）。
    const deco = card.querySelector('.bento-card-deco');
    if (deco) deco.remove();

    if (!sorted.length) {
      appendEmpty(body);
      return;
    }

    const mosaic = document.createElement('div');
    mosaic.className = 'bento-gallery-mosaic';

    sorted.forEach(it => {
      const a = document.createElement('a');
      a.className = 'bento-gallery-tile';
      a.href = `index.html?page=gallery`;
      a.setAttribute('aria-label', '查看完整画廊');

      const img = document.createElement('img');
      img.src = it.src;
      img.alt = '';
      img.loading = 'lazy';
      img.decoding = 'async';
      a.appendChild(img);

      mosaic.appendChild(a);
    });

    body.appendChild(mosaic);
  }

  // -------------------- Commit 6：stats --------------------

  function fillStatsCard(data) {
    const body = getBody('stats');
    if (!body) return;

    body.classList.remove('is-skeleton');
    body.innerHTML = '';

    const cells = [
      { label: '笔记', value: data.notesCount },
      { label: '追番', value: data.animeCount },
      { label: '留言', value: data.commentCount }, // Commit 8 异步补
      { label: '建站', value: data.daysCount, suffix: '天' },
    ];

    const grid = document.createElement('div');
    grid.className = 'bento-stats-grid';

    cells.forEach(c => {
      const cell = document.createElement('div');
      cell.className = 'bento-stat';

      const num = document.createElement('span');
      num.className = 'bento-stat-num';
      num.textContent = '0'; // 起始
      cell.appendChild(num);

      const label = document.createElement('span');
      label.className = 'bento-stat-label';
      label.textContent = c.label + (c.suffix ? '·' + c.suffix : '');
      cell.appendChild(label);

      grid.appendChild(cell);

      // 触发滚动动画（视口内立即；非有限值显示 ─）
      if (window.observeCountUp) {
        window.observeCountUp(num, c.value);
      } else {
        num.textContent = Number.isFinite(c.value) ? String(c.value) : '─';
      }
    });

    body.appendChild(grid);
  }

  // -------------------- Commit 8：mood 天气卡 --------------------

  async function loadMoodCard() {
    // 1. 命中未过期缓存：直接渲染，不发请求
    const cached = readCache(MOOD_CACHE_KEY);
    if (cached && (Date.now() - cached.ts) < MOOD_CACHE_TTL_MS) {
      fillMoodCard(cached.data);
      return;
    }

    // 2. 缓存过期或没有：先把"什么"垫到屏幕上，避免 1-2s 空白
    if (cached) {
      fillMoodCard(cached.data); // 显示过期数据，下面 fetch 成功再覆盖
    } else {
      fillMoodCard(MOOD_FALLBACK); // 第一次访问：先显示 🌸 占位
    }

    // 3. 异步 fetch 真实数据
    try {
      const [weather, moodMap] = await Promise.all([
        fetchWeather(),
        fetchMoodMap(),
      ]);
      const mood = mapWeatherToMood(weather, moodMap);
      fillMoodCard(mood);
      writeCache(MOOD_CACHE_KEY, mood);
    } catch (err) {
      console.warn('[home-cards] mood fetch failed:', err);
      // fetch 失败：保持步骤 2 已经渲染的过期缓存或 fallback，no-op
    }
  }

  function fillMoodCard(mood) {
    const body = getBody('mood');
    if (!body) return;
    body.classList.remove('is-skeleton');
    body.innerHTML = '';

    const wrap = document.createElement('div');
    wrap.className = 'bento-mood';

    const emoji = document.createElement('div');
    emoji.className = 'bento-mood-emoji';
    emoji.textContent = mood.emoji || '🌸';
    wrap.appendChild(emoji);

    const text = document.createElement('div');
    text.className = 'bento-mood-text';
    text.textContent = formatMoodText(mood);
    wrap.appendChild(text);

    body.appendChild(wrap);
  }

  function formatMoodText(mood) {
    // "东京・多云・22°"，缺哪部分跳过哪部分
    const parts = [TOKYO_LABEL];
    if (mood.text) parts.push(mood.text);
    if (Number.isFinite(mood.temp)) parts.push(mood.temp + '°');
    return parts.join('・');
  }

  async function fetchWeather() {
    const url = 'https://api.open-meteo.com/v1/forecast'
      + '?latitude=' + TOKYO_LAT
      + '&longitude=' + TOKYO_LNG
      + '&current=temperature_2m,weather_code'
      + '&timezone=Asia%2FTokyo';
    const res = await fetch(url);
    if (!res.ok) throw new Error('open-meteo ' + res.status);
    const json = await res.json();
    const cur = json && json.current;
    if (!cur) throw new Error('open-meteo: no .current');
    return {
      code: Number.isFinite(cur.weather_code) ? cur.weather_code : NaN,
      temp: Number.isFinite(cur.temperature_2m) ? Math.round(cur.temperature_2m) : NaN,
    };
  }

  async function fetchMoodMap() {
    const res = await fetch('data/mood-map.json');
    if (!res.ok) throw new Error('mood-map ' + res.status);
    return res.json();
  }

  function mapWeatherToMood(weather, map) {
    const key = String(weather.code);
    const found = map[key] || map.default || MOOD_FALLBACK;
    return {
      emoji: found.emoji,
      text: found.text,
      temp: weather.temp,
    };
  }

  // -------------------- Commit 8：stats 留言数 --------------------

  async function loadCommentCount() {
    // 1. 命中未过期缓存：直接渲染（不重渲整张 stats，只动留言这一格）
    const cached = readCache(COMMENT_CACHE_KEY);
    if (cached && (Date.now() - cached.ts) < COMMENT_CACHE_TTL_MS) {
      refreshStatsComment(cached.data);
      return;
    }

    // 过期缓存先垫一下（如果有），避免一直显示 ─
    if (cached) {
      refreshStatsComment(cached.data);
    }

    // 2. 异步 fetch
    try {
      const count = await fetchCommentCount();
      refreshStatsComment(count);
      writeCache(COMMENT_CACHE_KEY, count);
    } catch (err) {
      console.warn('[home-cards] comment count fetch failed:', err);
      // 保持现状（过期缓存或 ─ 占位）
    }
  }

  async function fetchCommentCount() {
    // Waline recent API：取最近评论列表，长度即为已发表评论数
    // pageSize 默认上限 100，对独立站点足够；超过则显示 "99+"
    const url = WALINE_SERVER_URL + '/api/comment?type=recent&pageSize=100';
    const res = await fetch(url);
    if (!res.ok) throw new Error('waline ' + res.status);
    const json = await res.json();
    // Waline v3 返回结构: { errno, errmsg, data: [...] }
    // 兼容性写法（旧版本/不同部署可能 data.data 嵌套）
    const list = Array.isArray(json.data) ? json.data
               : (json.data && Array.isArray(json.data.data)) ? json.data.data
               : [];
    return list.length;
  }

  function refreshStatsComment(count) {
    const body = getBody('stats');
    if (!body) return;

    // 在 4 个 stat cell 里找 label 含"留言"的那个
    const cells = body.querySelectorAll('.bento-stat');
    if (!cells.length) return;
    let target = null;
    cells.forEach(cell => {
      const label = cell.querySelector('.bento-stat-label');
      if (label && label.textContent.indexOf('留言') !== -1) {
        target = cell;
      }
    });
    if (!target) return;

    const num = target.querySelector('.bento-stat-num');
    if (!num) return;

    // ≥ 100 直接文字显示，count-up 动画到 99 再跳到 "99+" 视觉差
    if (count >= 100) {
      num.textContent = '99+';
      return;
    }

    // 重置为 0 让 observeCountUp 从 0 滚到目标，复刻 commit 6 的视觉效果
    // 其他 3 个 cell（笔记/追番/建站）不受影响
    num.textContent = '0';
    if (window.observeCountUp) {
      window.observeCountUp(num, count);
    } else {
      num.textContent = String(count);
    }
  }

  // -------------------- Commit 8：localStorage 缓存工具 --------------------

  function readCache(key) {
    try {
      const raw = localStorage.getItem(key);
      if (!raw) return null;
      const obj = JSON.parse(raw);
      if (!obj || typeof obj.ts !== 'number') return null;
      return obj;
    } catch {
      return null;
    }
  }

  function writeCache(key, data) {
    try {
      localStorage.setItem(key, JSON.stringify({ ts: Date.now(), data }));
    } catch {
      /* localStorage 满或被禁，忽略 */
    }
  }

  // -------------------- 公共：列表渲染（notes / update 用） --------------------

  function renderList(body, items) {
    body.classList.remove('is-skeleton');
    body.innerHTML = '';

    if (!items.length) {
      appendEmpty(body);
      return;
    }

    const ul = document.createElement('ul');
    ul.className = 'bento-list';

    items.forEach(it => {
      const li = document.createElement('li');
      li.className = 'bento-list-item';

      const main = document.createElement('span');
      main.className = 'bento-list-main';

      const title = document.createElement('span');
      title.className = 'bento-list-title';
      title.textContent = it.title;
      main.appendChild(title);

      if (it.isNew) {
        const tag = document.createElement('span');
        tag.className = 'bento-list-tag';
        tag.textContent = 'NEW';
        main.appendChild(tag);
      }

      li.appendChild(main);

      const time = document.createElement('time');
      time.className = 'bento-list-date';
      time.textContent = formatMonthDay(it.ts);
      li.appendChild(time);

      ul.appendChild(li);
    });

    body.appendChild(ul);
  }

  function appendEmpty(body) {
    const p = document.createElement('p');
    p.className = 'bento-empty';
    p.textContent = '暂无内容';
    body.appendChild(p);
  }

  // -------------------- 工具 --------------------

  function getBody(cardKey) {
    const card = document.querySelector(`.bento-card[data-card="${cardKey}"]`);
    return card ? card.querySelector('.bento-card-body') : null;
  }

  function fetchJSON(url) {
    return fetch(url).then(r => {
      if (!r.ok) throw new Error(`${url} ${r.status}`);
      return r.json();
    });
  }

  function parseDate(s) {
    if (!s) return NaN;
    const t = new Date(s).getTime();
    return Number.isFinite(t) ? t : NaN;
  }

  function parseUpdateDateFromFile(filePath) {
    const m = String(filePath || '').match(/(\d{4}-\d{2}-\d{2})/);
    return m ? m[1] : '';
  }

  function extractFirstHeading(md) {
    if (!md) return null;
    const m = md.match(/^\s*#\s+(.+?)\s*$/m);
    return m ? m[1].trim() : null;
  }

  function isWithinDays(dateStr, days) {
    const t = parseDate(dateStr);
    if (!Number.isFinite(t)) return false;
    return Date.now() - t < days * 24 * 60 * 60 * 1000;
  }

  function formatMonthDay(ts) {
    if (!Number.isFinite(ts)) return '';
    const d = new Date(ts);
    const m = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    return `${m}/${day}`;
  }

  function computeDaysSince(launchDateStr) {
    const launch = parseDate(launchDateStr);
    if (!Number.isFinite(launch)) return NaN;
    const days = Math.floor((Date.now() - launch) / (24 * 60 * 60 * 1000));
    return days >= 0 ? days : 0;
  }

  // anime-data.js 用的是详情页相对路径 ../assets/...
  // 主页要去掉 ../，否则 404
  function stripParentPath(p) {
    return String(p || '').replace(/^(\.\.\/)+/, '');
  }
})();