// ============================================================
// js/home-cards.js
// 主页 9 张主卡的数据注入入口
//
// Commit 5：intro / about-me / notes / update（4 张）
// Commit 6：anime / gallery / stats（3 张，stats 留言数留 commit 7）
// 待办  ：mood（commit 7 天气 API）+ stats 留言数（commit 7 Waline API）
//
// 数据源：
//   data/about.json          —— 文案
//   data/notes-index.json    —— 笔记索引
//   data/updates-index.json  —— 更新索引
//   window.animeData         —— anime-data.js 注入的全局变量
//   window.galleryData       —— gallery-data.js 注入的全局变量
// ============================================================

(function () {
  'use strict';

  const NEW_THRESHOLD_DAYS = 7;
  const SITE_LAUNCH_DATE = '2026-04-13'; // 建站日，stats 卡建站天数基准

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
    if (grid.dataset.cardsInjected === '1') return;
    grid.dataset.cardsInjected = '1';

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
      commentCount: NaN, // Commit 7 接 Waline 后填
      daysCount: computeDaysSince(SITE_LAUNCH_DATE),
    });
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
      { label: '留言', value: data.commentCount }, // Commit 7 填
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