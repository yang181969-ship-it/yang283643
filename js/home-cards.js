// ============================================================
// js/home-cards.js
// 主页 9 张主卡的数据注入入口(Phase B2 / Commit 5)
//
// 本刀只接 4 张卡:intro, about-me, notes, update
// 其余 5 张(mood / stats / anime / gallery / comment)留 skeleton,后续 commit 处理
//
// 数据源:
//   data/about.json          —— { intro: "...", aboutMe: "..." } 写死文案
//   data/notes-index.json    —— [{ title, category, file, date }, ...] 按 date 倒序取 3
//   data/updates-index.json  —— [{ file: "content/updates/YYYY-MM-DD.md" }, ...]
//                                日期从 filename 解析,title 从 MD 第一行 # H1 提取
// ============================================================

(function () {
  'use strict';

  const NEW_THRESHOLD_DAYS = 7;

  // 监听:主页可能是初始加载就有 .bento-grid,也可能是 SPA 切回来时插入
  // 简单保险:DOMContentLoaded 后跑一次;之后由 main.js 切页时再跑由它自己判断
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initHomeCards, { once: true });
  } else {
    initHomeCards();
  }

  // 暴露给 main.js,SPA 切回主页时可以再调一次
  window.initHomeCards = initHomeCards;

  // -------------------- 主流程 --------------------

  async function initHomeCards() {
    const grid = document.querySelector('.bento-grid');
    if (!grid) return;

    // 防止重复注入(SPA 切页时)
    if (grid.dataset.cardsInjected === '1') return;
    grid.dataset.cardsInjected = '1';

    // 4 个数据源并行,任一失败不影响其他卡
    const [aboutRes, notesRes, updatesRes] = await Promise.allSettled([
      fetchJSON('data/about.json'),
      fetchJSON('data/notes-index.json'),
      fetchJSON('data/updates-index.json'),
    ]);

    // intro / about-me
    if (aboutRes.status === 'fulfilled' && aboutRes.value) {
      if (aboutRes.value.intro)   fillTextCard('intro',    aboutRes.value.intro);
      if (aboutRes.value.aboutMe) fillTextCard('about-me', aboutRes.value.aboutMe);
    }

    // notes
    if (notesRes.status === 'fulfilled' && Array.isArray(notesRes.value)) {
      fillNotesCard(notesRes.value);
    }

    // updates(异步:还要 fetch 每个 MD 取标题)
    if (updatesRes.status === 'fulfilled' && Array.isArray(updatesRes.value)) {
      fillUpdatesCard(updatesRes.value).catch(err => {
        console.warn('[home-cards] updates render failed:', err);
      });
    }
  }

  // -------------------- 各卡渲染 --------------------

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
      .sort((a, b) => b._ts - a._ts) // NaN 自动沉底
      .slice(0, 3);

    renderList(body, sorted.map(it => ({
      title: it.title || '(无标题)',
      date: it.date,
      ts: it._ts,
      isNew: false, // 笔记不打 NEW 标签
    })));
  }

  async function fillUpdatesCard(list) {
    const body = getBody('update');
    if (!body) return;

    // updates-index 按 file 名自然倒序(最新在前),直接取前 3;再按解析出的日期保险排一次
    const top = [...list]
      .map(it => ({ file: it.file, date: parseUpdateDateFromFile(it.file) }))
      .sort((a, b) => parseDate(b.date) - parseDate(a.date))
      .slice(0, 3);

    // 并行 fetch 每个 MD 取首个 # H1
    const items = await Promise.all(top.map(async it => {
      let title = it.date; // fallback:用日期当标题
      try {
        const md = await fetch(it.file).then(r => r.ok ? r.text() : '');
        const h1 = extractFirstHeading(md);
        if (h1) title = h1;
      } catch { /* fallback to date */ }
      return {
        title,
        date: it.date,
        ts: parseDate(it.date),
        isNew: isWithinDays(it.date, NEW_THRESHOLD_DAYS),
      };
    }));

    renderList(body, items);
  }

  // -------------------- 公共渲染 --------------------

  function renderList(body, items) {
    body.classList.remove('is-skeleton');
    body.innerHTML = '';

    if (!items.length) {
      const p = document.createElement('p');
      p.className = 'bento-empty';
      p.textContent = '暂无内容';
      body.appendChild(p);
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
})();