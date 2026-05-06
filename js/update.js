/* =============================================================
 * 更新日志页 (Phase update 改造版)
 *
 * 列表渲染:
 *   1. 拉取 data/updates-index.json (富索引,聚合脚本预生成)
 *   2. chip 筛选 + sort 排序 → 计算可见列表
 *   3. 按月份分组,渲染 sticky header + timeline 卡片
 *   4. NEW 徽章:7 天阈值
 *
 * 更新日历:
 *   popover (PC) / bottom sheet (移动),响应当前 chip 筛选
 *   点击有更新日 → 关闭日历 + 滚动定位 + 卡片闪光
 *
 * 详情视图:
 *   沿用旧版 renderUpdateDetailView,SPA 内替换 #main-content
 *   只在用户点详情按钮或卡片时才 fetch 单个 md
 * ============================================================= */

/* ===== 常量 ===== */
const NEW_BADGE_DAYS = 7;
const TAG_LABELS = {
  feature: '功能更新',
  visual:  '视觉优化',
  perf:    '性能优化',
  fix:     '修复问题',
  mobile:  '移动端适配',
};
const CHIP_ORDER = ['all', 'feature', 'visual', 'perf', 'fix', 'mobile'];

/* ===== 小工具 ===== */
function updateEscapeHtml(str) {
  return String(str ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

function updateNormalizeLineEndings(text) {
  return String(text || "").replace(/\r\n/g, "\n").replace(/\r/g, "\n");
}

function formatUpdateDate(dateStr) {
  if (!dateStr) return "";
  const m = dateStr.match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/);
  if (!m) return dateStr;
  return `${m[1]}年${parseInt(m[2], 10)}月${parseInt(m[3], 10)}日`;
}

// "2026-05-04" → { mmdd: "05-04", year: "2026" }
function splitDateForCard(dateStr) {
  const m = (dateStr || '').match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!m) return { mmdd: '--', year: '' };
  return { mmdd: `${m[2]}-${m[3]}`, year: m[1] };
}

// "2026-05-04" → "2026年5月" (用于月份分组 header)
function monthHeaderText(dateStr) {
  const m = (dateStr || '').match(/^(\d{4})-(\d{1,2})/);
  if (!m) return '';
  return `${m[1]} 年 ${parseInt(m[2], 10)} 月`;
}

function isWithinDays(dateStr, days) {
  if (!dateStr) return false;
  const d = new Date(dateStr + 'T00:00:00');
  if (Number.isNaN(d.getTime())) return false;
  const now = Date.now();
  return (now - d.getTime()) / 86400000 <= days;
}

/* =============================================================
 * Markdown 渲染 (完整保留旧版)
 * ============================================================= */
function updateRenderMarkdown(md) {
  const text = updateNormalizeLineEndings(md).trim();
  if (!text) return "";

  const lines = text.split("\n");
  const html = [];

  let paragraphBuffer = [];
  let listBuffer = [];
  let inCodeBlock = false;
  let codeBuffer = [];
  let tableBuffer = [];
  let inTable = false;

  function flushParagraph() {
    if (!paragraphBuffer.length) return;
    html.push(`<p>${paragraphBuffer.map(inlineFormat).join("<br>")}</p>`);
    paragraphBuffer = [];
  }
  function flushList() {
    if (!listBuffer.length) return;
    html.push(
      "<ul>" +
      listBuffer.map((i) => `<li>${inlineFormat(i)}</li>`).join("") +
      "</ul>"
    );
    listBuffer = [];
  }
  function flushCodeBlock() {
    if (!codeBuffer.length) return;
    html.push(`<pre><code>${updateEscapeHtml(codeBuffer.join("\n"))}</code></pre>`);
    codeBuffer = [];
  }
  function flushTable() {
    if (!tableBuffer.length) return;
    const rows = tableBuffer
      .map((l) => l.trim().replace(/^\|/, "").replace(/\|$/, ""))
      .filter(Boolean);
    if (rows.length >= 2) {
      const headers = rows[0].split("|").map((c) => c.trim());
      const bodyRows = rows.slice(2).map((r) => r.split("|").map((c) => c.trim()));
      const thead =
        "<thead><tr>" +
        headers.map((h) => `<th>${inlineFormat(h)}</th>`).join("") +
        "</tr></thead>";
      const tbody =
        "<tbody>" +
        bodyRows
          .map((r) => "<tr>" + r.map((c) => `<td>${inlineFormat(c)}</td>`).join("") + "</tr>")
          .join("") +
        "</tbody>";
      html.push(`<div class="update-table-wrap"><table class="update-table">${thead}${tbody}</table></div>`);
    }
    tableBuffer = [];
  }

  function inlineFormat(raw) {
    let s = updateEscapeHtml(raw);
    s = s.replace(/`([^`]+)`/g, (_, code) => `<code>${code}</code>`);
    s = s.replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>");
    return s;
  }

  for (const rawLine of lines) {
    const line = rawLine.trim();

    if (line.startsWith("```")) {
      flushParagraph();
      flushList();
      flushTable();
      inTable = false;
      inCodeBlock = inCodeBlock ? (flushCodeBlock(), false) : true;
      continue;
    }
    if (inCodeBlock) {
      codeBuffer.push(rawLine);
      continue;
    }

    if (line.startsWith("|")) {
      if (!inTable) {
        flushParagraph();
        flushList();
        inTable = true;
      }
      tableBuffer.push(line);
      continue;
    } else if (inTable) {
      flushTable();
      inTable = false;
    }

    if (!line) {
      flushParagraph();
      flushList();
      continue;
    }

    if (line.startsWith("### ")) { flushParagraph(); flushList(); html.push(`<h3>${inlineFormat(line.slice(4))}</h3>`); continue; }
    if (line.startsWith("## "))  { flushParagraph(); flushList(); html.push(`<h2>${inlineFormat(line.slice(3))}</h2>`); continue; }
    if (line.startsWith("# "))   { flushParagraph(); flushList(); html.push(`<h1>${inlineFormat(line.slice(2))}</h1>`); continue; }

    if (line === "---" || line === "***") {
      flushParagraph(); flushList();
      html.push(`<hr>`);
      continue;
    }

    if (line.startsWith("- ") || line.startsWith("* ")) {
      flushParagraph();
      listBuffer.push(line.slice(2));
      continue;
    }

    paragraphBuffer.push(rawLine);
  }

  flushParagraph();
  flushList();
  flushCodeBlock();
  flushTable();
  return html.join("\n");
}

/* =============================================================
 * 解析单个 md → 详情条目 (供详情页使用)
 * ============================================================= */
function parseUpdateMarkdown(md, fallback = {}) {
  const raw = updateNormalizeLineEndings(md).trim();
  const lines = raw.split("\n");

  let title = "";
  let category = fallback.category || "";
  let date = fallback.date || "";
  const contentLines = [];

  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (!title && line.startsWith("# ")) {
      title = line.replace(/^#\s+/, "").trim();
      continue;
    }
    // 跳过所有 metadata 行(@xxx:)
    if (line.startsWith("@")) continue;
    contentLines.push(rawLine);
  }

  return {
    title:    title || fallback.title || "未命名更新",
    category: category || "建站日志",
    date:     date || "",
    content:  contentLines.join("\n").trim(),
  };
}

async function loadUpdateMarkdown(file) {
  const res = await fetch(file);
  if (!res.ok) throw new Error(`加载失败: ${file}`);
  return res.text();
}

/* =============================================================
 * 详情视图 (沿用旧版,SPA 内替换 #main-content)
 * ============================================================= */
async function renderUpdateDetailView(item) {
  const main = document.getElementById("main-content");
  if (!main) return;

  // item 是来自富索引的元数据,正文要现 fetch
  let detail = item;
  if (!item.content) {
    try {
      const md = await loadUpdateMarkdown(item.file);
      detail = parseUpdateMarkdown(md, item);
    } catch (err) {
      console.error('详情加载失败', err);
      return;
    }
  }

  const wrapper = document.createElement("section");
  wrapper.className = "update-page update-detail-page no-card";
  wrapper.innerHTML = `
    <article class="update-detail-card">
      <div class="update-detail-top">
        <span class="update-tag">${updateEscapeHtml(detail.category)}</span>
        <span class="update-detail-date">${updateEscapeHtml(formatUpdateDate(detail.date))}</span>
      </div>
      <h2 class="update-detail-title">${updateEscapeHtml(detail.title)}</h2>
      <div class="update-detail-body update-markdown-full">
        ${updateRenderMarkdown(detail.content)}
      </div>
    </article>
  `;

  main.innerHTML = "";
  main.appendChild(wrapper);

  const scrollEl = document.querySelector(".content-scroll");
  if (scrollEl) scrollEl.scrollTo({ top: 0, behavior: "smooth" });
}

/* =============================================================
 * 列表渲染:状态机 + DOM
 * ============================================================= */
const updateState = {
  items: [],            // 全量富索引
  activeChip: 'all',    // 当前筛选 tag,'all' 表示不筛
  sortOrder: 'newest',  // 'newest' | 'oldest'
  calOpen: false,
  calYear: null,        // 日历当前显示的年/月
  calMonth: null,
};

async function loadUpdatesIndex() {
  if (updateState.items.length) return updateState.items;

  // 兼容 GitHub Pages、自定义域名、本地 Live Server，以及被 SPA 注入后的相对路径。
  const candidates = [
    'data/updates-index.json',
    './data/updates-index.json',
    new URL('data/updates-index.json', window.location.href).pathname,
    // 兜底：有些时候 updates-index.json 会被误放在项目根目录
    'updates-index.json',
    './updates-index.json',
    new URL('updates-index.json', window.location.href).pathname,
  ];

  let res = null;
  let lastErr = null;
  for (const url of [...new Set(candidates)]) {
    try {
      res = await fetch(url, { cache: 'no-cache' });
      if (res.ok) {
        console.info(`[update] 已加载更新索引：${url}`);
        break;
      }
      lastErr = new Error(`${url} 返回 ${res.status}`);
    } catch (err) {
      lastErr = err;
    }
  }

  if (!res || !res.ok) {
    throw new Error(`updates-index.json 加载失败：${lastErr?.message || '未知错误'}`);
  }

  const items = await res.json();

  // 兼容老索引(只有 file 字段)→ 报错提示
  if (items.length && !items[0].title) {
    throw new Error(
      'updates-index.json 缺少富字段(title/date/tags 等)。请运行 npm run aggregate:updates 重新生成。'
    );
  }

  updateState.items = items;
  return items;
}

// chip + sort → 当前可见列表
function getVisibleItems() {
  let list = updateState.items;
  if (updateState.activeChip !== 'all') {
    list = list.filter(it => Array.isArray(it.tags) && it.tags.includes(updateState.activeChip));
  }
  list = [...list].sort((a, b) => {
    const cmp = (a.date || '').localeCompare(b.date || '');
    return updateState.sortOrder === 'newest' ? -cmp : cmp;
  });
  return list;
}

// ============================================================
// Hero stats
// ============================================================
function renderHeroStats() {
  const items = updateState.items;
  const latestEl = document.querySelector('[data-stat="latest"]');
  const totalEl  = document.querySelector('[data-stat="total"]');

  if (!items.length) {
    if (latestEl) latestEl.textContent = '—';
    if (totalEl)  totalEl.textContent  = '0';
    return;
  }

  // 最新一条(items 已按日期降序排)
  const latest = [...items].sort((a, b) => (b.date || '').localeCompare(a.date || ''))[0];
  if (latestEl && latest) {
    latestEl.textContent = (latest.date || '').replace(/-/g, '.');
  }
  if (totalEl) {
    totalEl.textContent = String(items.length);
  }
}

// ============================================================
// Timeline 卡片
// ============================================================
function renderTimeline() {
  const listEl = document.getElementById('update-list');
  if (!listEl) return;

  const visible = getVisibleItems();
  listEl.innerHTML = '';

  if (!visible.length) {
    listEl.innerHTML = `<div class="update-empty"><p>没有匹配当前筛选的更新条目</p></div>`;
    return;
  }

  let lastMonth = '';

  visible.forEach((item) => {
    const monthKey = (item.date || '').slice(0, 7); // "2026-05"
    if (monthKey !== lastMonth) {
      const header = document.createElement('div');
      header.className = 'update-month-header';
      header.textContent = monthHeaderText(item.date);
      listEl.appendChild(header);
      lastMonth = monthKey;
    }

    const wrap = document.createElement('div');
    wrap.className = 'update-card-wrap';
    wrap.dataset.primary = item.primary || 'feature';
    wrap.dataset.file = item.file;

    const { mmdd, year } = splitDateForCard(item.date);
    const isNew = isWithinDays(item.date, NEW_BADGE_DAYS);

    const tags = (item.tags || []).slice(0, 3); // 最多 3 个徽章
    const tagsHtml = tags.map(t => `
      <span class="update-tag-badge" data-tag="${updateEscapeHtml(t)}">
        ${updateEscapeHtml(TAG_LABELS[t] || t)}
      </span>
    `).join('');

    wrap.innerHTML = `
      <article class="update-card" data-file="${updateEscapeHtml(item.file)}" data-date="${updateEscapeHtml(item.date || '')}">
        <div class="update-card-date">
          <span class="update-card-date-mmdd">${mmdd}</span>
          <span class="update-card-date-year">${year}</span>
        </div>
        <div class="update-card-main">
          <div class="update-card-titlerow">
            ${isNew ? '<span class="update-new-badge">NEW</span>' : ''}
            <h3 class="update-card-title">${updateEscapeHtml(item.title)}</h3>
          </div>
          <p class="update-card-summary">${updateEscapeHtml(item.summary || '')}</p>
        </div>
        <div class="update-card-side">
          <div class="update-card-tags">${tagsHtml}</div>
          <button class="update-card-detail-btn" type="button" tabindex="-1">
            查看详情
            <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
              <path d="M6 4l4 4-4 4"/>
            </svg>
          </button>
        </div>
      </article>
    `;

    // 整卡可点 → 跳详情
    wrap.querySelector('.update-card').addEventListener('click', () => {
      renderUpdateDetailView(item);
    });

    listEl.appendChild(wrap);
  });
}

// ============================================================
// chips + sort 绑定
// ============================================================
function initChipsAndSort() {
  document.querySelectorAll('[data-update-chips] .update-chip').forEach(chip => {
    if (chip.dataset.bound === '1') return;
    chip.dataset.bound = '1';

    chip.addEventListener('click', () => {
      const value = chip.dataset.chip;
      if (!value || value === updateState.activeChip) return;

      updateState.activeChip = value;

      document.querySelectorAll('[data-update-chips] .update-chip')
        .forEach(c => {
          const active = c.dataset.chip === value;
          c.classList.toggle('is-active', active);
          c.setAttribute('aria-selected', active ? 'true' : 'false');
        });

      renderTimeline();

      // 日历开着的话，重新渲染让色块跟筛选走
      if (updateState.calOpen) renderCalendar();
    });
  });

  const sortBtn = document.getElementById('update-sort-toggle');
  const sortText = sortBtn?.querySelector('.update-sort-text');

  if (sortBtn && sortBtn.dataset.bound !== '1') {
    sortBtn.dataset.bound = '1';

    sortBtn.addEventListener('click', () => {
      const nextOrder = updateState.sortOrder === 'newest' ? 'oldest' : 'newest';

      updateState.sortOrder = nextOrder;
      sortBtn.dataset.sort = nextOrder;
      sortBtn.classList.toggle('is-oldest', nextOrder === 'oldest');
      if (sortText) {
        sortText.textContent = nextOrder === 'newest' ? '最新优先' : '最早优先';
      }

      sortBtn.setAttribute(
        'aria-label',
        nextOrder === 'newest'
          ? '当前为最新优先，点击切换为最早优先'
          : '当前为最早优先，点击切换为最新优先'
      );

      renderTimeline();
    });
  }
}

// ============================================================
// 更新日历
// ============================================================
function getCalendarItems() {
  // 日历也响应当前 chip 筛选
  if (updateState.activeChip === 'all') return updateState.items;
  return updateState.items.filter(it => Array.isArray(it.tags) && it.tags.includes(updateState.activeChip));
}

// 站点开站日(用于日历翻页限制)= 索引里最早一条的月份
function getEarliestMonth() {
  if (!updateState.items.length) {
    const now = new Date();
    return { year: now.getFullYear(), month: now.getMonth() };
  }
  const earliest = [...updateState.items]
    .filter(it => it.date)
    .sort((a, b) => (a.date || '').localeCompare(b.date || ''))[0];
  if (!earliest) {
    const now = new Date();
    return { year: now.getFullYear(), month: now.getMonth() };
  }
  const m = earliest.date.match(/^(\d{4})-(\d{2})/);
  return { year: +m[1], month: +m[2] - 1 };
}

function openCalendar() {
  const cal = document.getElementById('update-calendar');
  const trigger = document.getElementById('update-calendar-trigger');
  const backdrop = document.getElementById('update-calendar-backdrop');
  if (!cal) return;

  // 默认显示最新一条更新所在月
  if (updateState.calYear === null) {
    const items = updateState.items;
    if (items.length && items[0].date) {
      const m = items[0].date.match(/^(\d{4})-(\d{2})/);
      if (m) {
        updateState.calYear = +m[1];
        updateState.calMonth = +m[2] - 1;
      }
    } else {
      const now = new Date();
      updateState.calYear = now.getFullYear();
      updateState.calMonth = now.getMonth();
    }
  }

  cal.hidden = false;
  if (backdrop) backdrop.hidden = false;

  // 桌面端:popover 锚定在触发器下方
  if (window.matchMedia('(min-width: 641px)').matches && trigger) {
    const rect = trigger.getBoundingClientRect();
    const pageRect = document.querySelector('.update-page')?.getBoundingClientRect();
    cal.style.position = 'absolute';
    if (pageRect) {
      // 相对 .update-page 计算；.update-page 需要 position: relative
      cal.style.top = `${rect.bottom - pageRect.top + 8}px`;
      cal.style.left = `${rect.left - pageRect.left}px`;
      cal.style.right = 'auto';
    }
  } else {
    // 移动端:bottom sheet,清空 inline 样式让 CSS 接管
    cal.style.position = '';
    cal.style.top = '';
    cal.style.left = '';
    cal.style.right = '';
  }

  // requestAnimationFrame 确保 hidden=false 已经生效再加 .is-open 触发过渡
  requestAnimationFrame(() => {
    cal.classList.add('is-open');
    if (backdrop) backdrop.classList.add('is-open');
  });

  trigger?.classList.add('is-open');
  trigger?.setAttribute('aria-expanded', 'true');
  updateState.calOpen = true;
  renderCalendar();
}

function closeCalendar() {
  const cal = document.getElementById('update-calendar');
  const trigger = document.getElementById('update-calendar-trigger');
  const backdrop = document.getElementById('update-calendar-backdrop');
  if (!cal) return;

  cal.classList.remove('is-open');
  if (backdrop) backdrop.classList.remove('is-open');
  trigger?.classList.remove('is-open');
  trigger?.setAttribute('aria-expanded', 'false');
  updateState.calOpen = false;

  setTimeout(() => {
    if (!cal.classList.contains('is-open')) {
      cal.hidden = true;
      if (backdrop) backdrop.hidden = true;
    }
  }, 280);
}

function renderCalendar() {
  const titleEl = document.querySelector('[data-calendar-title]');
  const gridEl  = document.querySelector('[data-calendar-grid]');
  const prevBtn = document.querySelector('[data-calendar-nav="prev"]');
  const nextBtn = document.querySelector('[data-calendar-nav="next"]');
  if (!gridEl || !titleEl) return;

  const year  = updateState.calYear;
  const month = updateState.calMonth; // 0-indexed
  titleEl.textContent = `${year} 年 ${month + 1} 月`;

  // 翻页边界
  const earliest = getEarliestMonth();
  const today = new Date();
  const isAtEarliest = year < earliest.year || (year === earliest.year && month <= earliest.month);
  const isAtLatest   = year > today.getFullYear() || (year === today.getFullYear() && month >= today.getMonth());
  if (prevBtn) prevBtn.disabled = isAtEarliest;
  if (nextBtn) nextBtn.disabled = isAtLatest;

  // 该月所有有更新的日期 → Map<"YYYY-MM-DD", count>
  const calItems = getCalendarItems();
  const byDate = new Map();
  calItems.forEach(it => {
    if (!it.date) return;
    byDate.set(it.date, (byDate.get(it.date) || 0) + 1);
  });

  // 6 × 7 格子
  const firstOfMonth = new Date(year, month, 1);
  const startWeekday = firstOfMonth.getDay(); // 0 = 周日
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const daysInPrevMonth = new Date(year, month, 0).getDate();

  const todayStr = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`;

  const cells = [];

  // 上个月填充
  for (let i = startWeekday - 1; i >= 0; i--) {
    const day = daysInPrevMonth - i;
    cells.push({ day, outside: true, dateStr: '' });
  }
  // 当前月
  for (let day = 1; day <= daysInMonth; day++) {
    const dateStr = `${year}-${String(month + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
    cells.push({
      day,
      outside: false,
      dateStr,
      hasUpdate: byDate.has(dateStr),
      count: byDate.get(dateStr) || 0,
      isToday: dateStr === todayStr,
    });
  }
  // 下个月填充到 42 格
  while (cells.length < 42) {
    const day = cells.length - (startWeekday + daysInMonth) + 1;
    cells.push({ day, outside: true, dateStr: '' });
  }

  gridEl.innerHTML = cells.map(c => {
    const classes = ['update-calendar-cell'];
    if (c.outside)   classes.push('update-calendar-cell--outside');
    else             classes.push('update-calendar-cell--current');
    if (c.isToday)   classes.push('update-calendar-cell--today');
    if (c.hasUpdate) classes.push('update-calendar-cell--has-update');

    const title = c.hasUpdate
      ? `${formatUpdateDate(c.dateStr)} · ${c.count} 条更新`
      : (c.dateStr ? formatUpdateDate(c.dateStr) : '');

    return `
      <button type="button" class="${classes.join(' ')}"
              data-cal-date="${updateEscapeHtml(c.dateStr)}"
              ${title ? `title="${updateEscapeHtml(title)}"` : ''}
              ${c.outside || !c.hasUpdate ? 'tabindex="-1"' : ''}>
        ${c.day}
      </button>
    `;
  }).join('');
}

function initCalendar() {
  const trigger = document.getElementById('update-calendar-trigger');
  const cal     = document.getElementById('update-calendar');
  const backdrop = document.getElementById('update-calendar-backdrop');

  if (!trigger || !cal || trigger.dataset.bound === '1') return;
  trigger.dataset.bound = '1';

  trigger.addEventListener('click', (e) => {
    e.stopPropagation();
    if (updateState.calOpen) {
      closeCalendar();
    } else {
      openCalendar();
    }
  });

  // 翻页
  document.querySelectorAll('[data-calendar-nav]').forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      const dir = btn.dataset.calendarNav === 'prev' ? -1 : 1;
      let m = updateState.calMonth + dir;
      let y = updateState.calYear;
      if (m < 0)       { m = 11; y -= 1; }
      else if (m > 11) { m = 0;  y += 1; }
      updateState.calMonth = m;
      updateState.calYear = y;
      renderCalendar();
    });
  });

  // 点格子
  cal.addEventListener('click', (e) => {
    e.stopPropagation();
    const cell = e.target.closest('.update-calendar-cell--has-update');
    if (!cell) return;
    const dateStr = cell.dataset.calDate;
    if (!dateStr) return;
    closeCalendar();
    setTimeout(() => scrollToUpdateAndFlash(dateStr), 200); // 等 sheet 收完
  });

  // 遮罩点击关闭(移动端)
  backdrop?.addEventListener('click', closeCalendar);

  // 点外部关闭
  document.addEventListener('click', (e) => {
    if (!updateState.calOpen) return;
    if (e.target.closest('.update-calendar')) return;
    if (e.target.closest('#update-calendar-trigger')) return;
    closeCalendar();
  });

  // Esc 关闭
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && updateState.calOpen) {
      closeCalendar();
      trigger.focus();
    }
  });
}

function scrollToUpdateAndFlash(dateStr) {
  // 找到该日期对应的卡片(可能多条)
  const wraps = document.querySelectorAll(`.update-card-wrap`);
  let target = null;
  for (const w of wraps) {
    const card = w.querySelector('.update-card');
    if (card?.dataset.date === dateStr) {
      target = card;
      break;
    }
  }
  if (!target) {
    // 当前筛选下没有该日条目 → 切回 all 再试一次
    if (updateState.activeChip !== 'all') {
      const allChip = document.querySelector('[data-update-chips] [data-chip="all"]');
      allChip?.click();
      setTimeout(() => scrollToUpdateAndFlash(dateStr), 80);
    }
    return;
  }

  const scrollEl = document.querySelector('.content-scroll') || window;
  const rect = target.getBoundingClientRect();
  const offset = 80; // 让卡片不要贴顶,留点视觉余量

  if (scrollEl === window) {
    window.scrollTo({ top: window.scrollY + rect.top - offset, behavior: 'smooth' });
  } else {
    scrollEl.scrollTo({ top: scrollEl.scrollTop + rect.top - offset, behavior: 'smooth' });
  }

  target.classList.remove('is-flash');
  // 强制 reflow,确保动画重启
  void target.offsetWidth;
  target.classList.add('is-flash');
  setTimeout(() => target.classList.remove('is-flash'), 1600);
}

/* =============================================================
 * 页面初始化
 * v4: 彻底避免 SPA / MutationObserver / 初始化锁之间互相抢跑。
 * - 不再依赖 updateInitialized 预标记
 * - main.js 调用、DOMContentLoaded、y181:pagechange、手动调用都可以重复安全执行
 * - 如果数据已加载，会直接重渲染统计与时间线
 * ============================================================= */
let updateInitRunning = false;
let updateObserverStarted = false;
let updateBoundOnce = false;

function isUpdatePageInDom() {
  const urlParams = new URL(window.location.href).searchParams;
  return document.querySelector('.update-page') !== null || urlParams.get('page') === 'update';
}

function getUpdateDomRefs() {
  const main = document.getElementById('main-content');
  const page = main?.querySelector('.update-page') || document.querySelector('.update-page');
  const listEl = main?.querySelector('#update-list') || document.getElementById('update-list');
  return { main, page, listEl };
}

async function initUpdatePage(options = {}) {
  const force = !!options.force;
  const { main, page, listEl } = getUpdateDomRefs();

  if (!main || !isUpdatePageInDom()) return;
  if (!page) return;

  // 如果 HTML 版本没有放 update-list，直接在控制台报清楚，避免静默失败。
  if (!listEl) {
    console.warn('[update] 初始化中止：当前 update.html 里没有 #update-list。请确认 html/update.html 是完整版本。');
    return;
  }

  // 已经有卡片且非强制刷新时，避免重复绑定导致多次点击。
  if (!force && listEl.querySelector('.update-card-wrap')) return;
  if (updateInitRunning) return;

  updateInitRunning = true;
  try {
    await loadUpdatesIndex();

    // 重新渲染前，清空可能的旧内容，防止重复卡片。
    if (force) listEl.innerHTML = '';

    renderHeroStats();

    // 这些绑定函数内部会通过元素存在性兜底；即使重复执行也不影响渲染结果。
    initChipsAndSort();
    initCalendar();
    renderTimeline();

    page.dataset.updateInitialized = '1';
    console.info(`[update] 初始化完成：${updateState.items.length} 条更新`);
  } catch (err) {
    console.error('[update] 初始化失败：', err);
    page.dataset.updateInitialized = '0';
    listEl.innerHTML = `
      <div class="update-empty">
        <p>更新日志加载失败</p>
        <p style="font-size: 12px;">${updateEscapeHtml(err.message)}</p>
      </div>
    `;
  } finally {
    updateInitRunning = false;
  }
}

/* =============================================================
 * SPA 切页自动响应
 * ============================================================= */
function watchForUpdatePage() {
  const main = document.getElementById('main-content');
  if (!main || updateObserverStarted) return;
  updateObserverStarted = true;

  const check = () => {
    if (!main.querySelector('.update-page')) return;
    requestAnimationFrame(() => initUpdatePage({ force: false }));
  };

  check();

  const mo = new MutationObserver(check);
  mo.observe(main, { childList: true, subtree: true });
}

function bootUpdateModule() {
  if (updateBoundOnce) return;
  updateBoundOnce = true;

  watchForUpdatePage();

  // main.js 里 syncCurrentPage 会派发这个事件；切到 update 时主动初始化。
  window.addEventListener('y181:pagechange', (e) => {
    if (e.detail?.page === 'update') {
      requestAnimationFrame(() => initUpdatePage({ force: false }));
    }
  });

  // 非 SPA / 脚本晚于 DOMContentLoaded 加载时，也要主动跑一次。
  requestAnimationFrame(() => initUpdatePage({ force: false }));
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', bootUpdateModule, { once: true });
} else {
  bootUpdateModule();
}

window.initUpdatePage = initUpdatePage;
window.forceInitUpdatePage = () => initUpdatePage({ force: true });
window.__updateDebug = () => ({
  hasMain: !!document.getElementById('main-content'),
  hasPage: !!document.querySelector('.update-page'),
  hasList: !!document.getElementById('update-list'),
  latestText: document.querySelector('[data-stat="latest"]')?.textContent,
  totalText: document.querySelector('[data-stat="total"]')?.textContent,
  itemCount: updateState.items.length,
  listChildren: document.getElementById('update-list')?.children.length || 0,
  initialized: document.querySelector('.update-page')?.dataset.updateInitialized || '',
});
