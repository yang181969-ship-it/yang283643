// js/calendar-widget.js
// 日历弹窗:月历 + 选中日期信息 + 重要日子 —— Phase C Commit 1 / Phase 1.5
//
// 行为:
//   - 默认显示当月,今天高亮;点击任意日期选中(今天与选中日期样式不同)
//   - 上下月翻页;"今天" 按钮回到今天(仅在非当月或未选中今天时显示)
//   - 方向键在日期间移动,PageUp/PageDown 翻月
//   - 全部使用访问者本地日期;跨午夜/从后台恢复由 site-shell.js 派发 site:datechange
//   - 重要日子来自 data/important-days.json(没有数据时显示空状态)
//
// DOM 约定 (.calendar-panel 内):
//   [data-cal-title] [data-cal-prev] [data-cal-next] [data-cal-today] [data-cal-grid]
//   [data-cal-sel-day] [data-cal-sel-date] [data-cal-sel-weekday] [data-cal-sel-today] [data-cal-goto-today]
//   [data-cal-day-events] [data-cal-day-empty] [data-cal-upcoming] [data-cal-upcoming-empty]
//
// important-days.json:
//   { "events": [ { "title": "…", "date": "YYYY-MM-DD", "repeat": "yearly" | "none", "note": "…" } ] }

(function () {
  'use strict';

  const WEEK_START = 0; // 0=周日, 1=周一
  const WEEKDAYS = ['星期日', '星期一', '星期二', '星期三', '星期四', '星期五', '星期六'];
  const UPCOMING_LIMIT = 5;
  const UPCOMING_DAYS = 366;

  const root = document.querySelector('.rail-widget--calendar');
  if (!root) return;
  const panel = root.closest('.calendar-panel') || document;
  const $ = (sel) => panel.querySelector(sel);

  const titleEl  = root.querySelector('[data-cal-title]');
  const gridEl   = root.querySelector('[data-cal-grid]');
  const prevBtn  = root.querySelector('[data-cal-prev]');
  const nextBtn  = root.querySelector('[data-cal-next]');
  const todayBtn = root.querySelector('[data-cal-today]');
  if (!titleEl || !gridEl) return;

  const selDayEl     = $('[data-cal-sel-day]');
  const selDateEl    = $('[data-cal-sel-date]');
  const selWeekdayEl = $('[data-cal-sel-weekday]');
  const selTodayEl   = $('[data-cal-sel-today]');
  const gotoTodayBtn = $('[data-cal-goto-today]');
  const dayEventsEl  = $('[data-cal-day-events]');
  const dayEmptyEl   = $('[data-cal-day-empty]');
  const upcomingEl   = $('[data-cal-upcoming]');
  const upcomingEmptyEl = $('[data-cal-upcoming-empty]');

  let today = startOfDay(new Date());
  let selected = today;
  let viewYear  = today.getFullYear();
  let viewMonth = today.getMonth();
  let events = [];

  // ---------- 日期工具(全部本地时间,不经过 UTC 解析) ----------
  function startOfDay(d) { return new Date(d.getFullYear(), d.getMonth(), d.getDate()); }
  function pad(n) { return String(n).padStart(2, '0'); }
  function keyOf(d) { return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`; }
  function sameDay(a, b) { return keyOf(a) === keyOf(b); }
  // 用 UTC 日序号相减,夏令时切换日也不会差一天
  function dayDiff(from, to) {
    return Math.round((Date.UTC(to.getFullYear(), to.getMonth(), to.getDate())
      - Date.UTC(from.getFullYear(), from.getMonth(), from.getDate())) / 864e5);
  }
  function parseDate(str) {
    const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(str || '').trim());
    if (!m) return null;
    const d = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
    return d.getMonth() === Number(m[2]) - 1 ? d : null; // 拒绝 2026-02-30 之类
  }
  function label(d) { return `${d.getFullYear()}年${d.getMonth() + 1}月${d.getDate()}日 ${WEEKDAYS[d.getDay()]}`; }

  // ---------- 重要日子 ----------
  // 每年重复:2 月 29 日在平年落在 2 月 28 日
  function occurrenceIn(event, year) {
    const m = event.start.getMonth();
    const last = new Date(year, m + 1, 0).getDate();
    return new Date(year, m, Math.min(event.start.getDate(), last));
  }
  function occursOn(event, date) {
    if (event.repeat === 'yearly') return date >= event.start && sameDay(occurrenceIn(event, date.getFullYear()), date);
    return sameDay(event.start, date);
  }
  function nextOccurrence(event, from) {
    if (event.repeat !== 'yearly') return event.start >= from ? event.start : null;
    if (event.start >= from) return event.start;
    const d = occurrenceIn(event, from.getFullYear());
    return d >= from ? d : occurrenceIn(event, from.getFullYear() + 1);
  }
  function describe(event, date) {
    if (event.repeat === 'yearly') {
      const years = date.getFullYear() - event.start.getFullYear();
      return years > 0 ? `${years} 周年` : '第一天';
    }
    const diff = dayDiff(today, date);
    if (diff === 0) return '今天';
    return diff > 0 ? `还有 ${diff} 天` : `已过去 ${-diff} 天`;
  }

  function eventItem(title, meta, note) {
    const li = document.createElement('li');
    li.className = 'cal-event';
    const name = document.createElement('span');
    name.className = 'cal-event__title';
    name.textContent = title;
    const tag = document.createElement('span');
    tag.className = 'cal-event__meta';
    tag.textContent = meta;
    li.append(name, tag);
    if (note) {
      const p = document.createElement('span');
      p.className = 'cal-event__note';
      p.textContent = note;
      li.append(p);
    }
    return li;
  }

  function renderEvents() {
    if (dayEventsEl) {
      const onDay = events.filter((e) => occursOn(e, selected));
      dayEventsEl.replaceChildren(...onDay.map((e) => eventItem(e.title, describe(e, selected), e.note)));
      if (dayEmptyEl) dayEmptyEl.hidden = onDay.length > 0;
    }
    if (upcomingEl) {
      const upcoming = events
        .map((e) => ({ e, date: nextOccurrence(e, today) }))
        .filter((x) => x.date && dayDiff(today, x.date) <= UPCOMING_DAYS)
        .sort((a, b) => a.date - b.date)
        .slice(0, UPCOMING_LIMIT);
      upcomingEl.replaceChildren(...upcoming.map(({ e, date }) => {
        const diff = dayDiff(today, date);
        return eventItem(e.title, `${date.getMonth() + 1}月${date.getDate()}日 · ${diff === 0 ? '就是今天' : `还有 ${diff} 天`}`);
      }));
      if (upcomingEmptyEl) upcomingEmptyEl.hidden = upcoming.length > 0;
    }
  }

  function loadEvents() {
    const script = document.currentScript || document.querySelector('script[src*="js/calendar-widget.js"]');
    const base = script?.src ? new URL('../', script.src) : new URL('./', document.baseURI);
    fetch(new URL('data/important-days.json', base), { cache: 'no-cache' })
      .then((res) => (res.ok ? res.json() : { events: [] }))
      .then((data) => {
        const list = Array.isArray(data) ? data : data?.events;
        events = (Array.isArray(list) ? list : [])
          .map((e) => ({ title: String(e?.title || '').trim(), note: e?.note ? String(e.note) : '', start: parseDate(e?.date), repeat: e?.repeat === 'yearly' ? 'yearly' : 'none' }))
          .filter((e) => e.title && e.start);
        renderEvents();
        render();
      })
      .catch(() => { /* 没有数据时保留空状态 */ });
  }

  // ---------- 渲染 ----------
  function render() {
    titleEl.textContent = `${viewYear} 年 ${viewMonth + 1} 月`;

    const first = new Date(viewYear, viewMonth, 1);
    let offset = first.getDay() - WEEK_START;
    if (offset < 0) offset += 7;
    const start = new Date(viewYear, viewMonth, 1 - offset);
    const selectedInView = selected.getFullYear() === viewYear && selected.getMonth() === viewMonth;

    const frag = document.createDocumentFragment();
    for (let i = 0; i < 42; i++) {
      const d = new Date(start.getFullYear(), start.getMonth(), start.getDate() + i);
      const out = d.getMonth() !== viewMonth;
      const isToday = sameDay(d, today);
      const isSelected = sameDay(d, selected);
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'cal-day';
      if (out) btn.classList.add('cal-day--out');
      if (isToday) btn.classList.add('cal-day--today');
      if (isSelected) btn.classList.add('cal-day--selected');
      if (events.some((e) => occursOn(e, d))) btn.classList.add('cal-day--event');
      btn.dataset.date = keyOf(d);
      btn.textContent = d.getDate();
      btn.setAttribute('aria-label', label(d) + (isToday ? '，今天' : ''));
      btn.setAttribute('aria-pressed', String(isSelected));
      if (isToday) btn.setAttribute('aria-current', 'date');
      // 漫游 tabindex:网格只占一个 Tab 位
      const focusable = selectedInView ? isSelected : (!out && d.getDate() === 1);
      btn.tabIndex = focusable ? 0 : -1;
      frag.appendChild(btn);
    }
    gridEl.replaceChildren(frag);

    const isCurrentMonth = viewYear === today.getFullYear() && viewMonth === today.getMonth();
    const onToday = sameDay(selected, today);
    if (todayBtn) todayBtn.hidden = isCurrentMonth && onToday;
    if (gotoTodayBtn) gotoTodayBtn.disabled = isCurrentMonth && onToday;

    if (selDayEl) selDayEl.textContent = selected.getDate();
    if (selDateEl) selDateEl.textContent = `${selected.getFullYear()}年${selected.getMonth() + 1}月`;
    if (selWeekdayEl) selWeekdayEl.textContent = WEEKDAYS[selected.getDay()];
    if (selTodayEl) selTodayEl.hidden = !onToday;
    renderEvents();
  }

  function select(date, focus) {
    selected = startOfDay(date);
    viewYear = selected.getFullYear();
    viewMonth = selected.getMonth();
    render();
    if (focus) gridEl.querySelector('[tabindex="0"]')?.focus({ preventScroll: true });
  }

  function shiftMonth(delta) {
    const d = new Date(viewYear, viewMonth + delta, 1);
    viewYear = d.getFullYear();
    viewMonth = d.getMonth();
    render();
  }

  function goToday() {
    select(today, false);
  }

  prevBtn?.addEventListener('click', () => shiftMonth(-1));
  nextBtn?.addEventListener('click', () => shiftMonth(+1));
  todayBtn?.addEventListener('click', goToday);
  gotoTodayBtn?.addEventListener('click', goToday);

  // 一次性委托:重渲染网格不会重复绑定
  gridEl.addEventListener('click', (e) => {
    const btn = e.target.closest('.cal-day');
    if (btn) select(parseDate(btn.dataset.date), false);
  });
  gridEl.addEventListener('keydown', (e) => {
    const btn = e.target.closest('.cal-day');
    if (!btn) return;
    const d = parseDate(btn.dataset.date);
    const step = { ArrowLeft: -1, ArrowRight: 1, ArrowUp: -7, ArrowDown: 7 }[e.key];
    if (step) {
      e.preventDefault();
      select(new Date(d.getFullYear(), d.getMonth(), d.getDate() + step), true);
    } else if (e.key === 'PageUp' || e.key === 'PageDown') {
      e.preventDefault();
      const target = new Date(d.getFullYear(), d.getMonth() + (e.key === 'PageUp' ? -1 : 1), 1);
      const last = new Date(target.getFullYear(), target.getMonth() + 1, 0).getDate();
      select(new Date(target.getFullYear(), target.getMonth(), Math.min(d.getDate(), last)), true);
    }
  });

  // 导航日期按钮与跨午夜检测由 site-shell.js 负责;这里只跟随"今天"重绘
  function refreshDate(date = new Date()) {
    const next = startOfDay(date);
    if (sameDay(next, today) && gridEl.childElementCount) return;
    const wasCurrent = viewYear === today.getFullYear() && viewMonth === today.getMonth();
    const wasTodaySelected = sameDay(selected, today);
    today = next;
    // 正在看当月/选中今天时跟着跨日;翻到别处时保持用户的位置
    if (wasTodaySelected) selected = today;
    if (wasCurrent) {
      viewYear = today.getFullYear();
      viewMonth = today.getMonth();
    }
    render();
  }
  window.addEventListener('site:datechange', (event) => refreshDate(event.detail?.date));
  refreshDate();
  loadEvents();
})();
