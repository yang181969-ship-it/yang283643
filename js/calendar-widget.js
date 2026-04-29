// js/calendar-widget.js
// 侧栏月历组件 —— Phase C Commit 1
//
// 行为:
//   - 默认显示当月,今日高亮
//   - 上下月翻页按钮,翻到非当月时今日不再高亮
//   - "今天" 按钮回到当月 (仅在非当月时显示)
//   - 周一为每周第一天 (中国习惯;如要周日开头改 WEEK_START = 0)
//   - 不依赖任何外部数据,纯前端
//
// DOM 约定 (rail-widget--calendar 内):
//   [data-cal-title]   月份标题文本
//   [data-cal-prev]    上月按钮
//   [data-cal-next]    下月按钮
//   [data-cal-today]   今天按钮 (可缺省)
//   [data-cal-grid]    日期格子容器 (会被 innerHTML 重写)

(function () {
  'use strict';

  const WEEK_START = 0; // 0=周日, 1=周一
  const MONTH_NAMES = [
    '1 月', '2 月', '3 月', '4 月', '5 月', '6 月',
    '7 月', '8 月', '9 月', '10 月', '11 月', '12 月',
  ];

  const root = document.querySelector('.rail-widget--calendar');
  if (!root) return; // 没找到组件,主页之外的页面直接退出

  const titleEl = root.querySelector('[data-cal-title]');
  const gridEl  = root.querySelector('[data-cal-grid]');
  const prevBtn = root.querySelector('[data-cal-prev]');
  const nextBtn = root.querySelector('[data-cal-next]');
  const todayBtn = root.querySelector('[data-cal-today]');

  if (!titleEl || !gridEl) return;

  const today = new Date();
  const todayKey = ymd(today);

  // 当前显示的月份 (year, month-0-indexed)
  let viewYear  = today.getFullYear();
  let viewMonth = today.getMonth();

  function ymd(d) {
    return `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`;
  }

  function render() {
    titleEl.textContent = `${viewYear} 年 ${MONTH_NAMES[viewMonth]}`;

    const firstOfMonth = new Date(viewYear, viewMonth, 1);
    const daysInMonth  = new Date(viewYear, viewMonth + 1, 0).getDate();
    const daysInPrev   = new Date(viewYear, viewMonth, 0).getDate();

    // 第一格对应的星期: WEEK_START=1 时, 周一为 0
    let firstDay = firstOfMonth.getDay() - WEEK_START;
    if (firstDay < 0) firstDay += 7;

    const cells = [];

    // 上月尾部填充
    for (let i = firstDay - 1; i >= 0; i--) {
      cells.push({ day: daysInPrev - i, out: true });
    }
    // 当月
    for (let d = 1; d <= daysInMonth; d++) {
      const isToday = ymd(new Date(viewYear, viewMonth, d)) === todayKey;
      cells.push({ day: d, out: false, today: isToday });
    }
    // 下月头部填充到 6 行 (42 格)
    while (cells.length < 42) {
      const d = cells.length - firstDay - daysInMonth + 1;
      cells.push({ day: d, out: true });
    }

    gridEl.innerHTML = cells.map(c => {
      const cls = ['cal-day'];
      if (c.out) cls.push('cal-day--out');
      if (c.today) cls.push('cal-day--today');
      return `<span class="${cls.join(' ')}">${c.day}</span>`;
    }).join('');

    // "今天" 按钮可见性: 仅在非当月时显示
    if (todayBtn) {
      const isCurrent = (viewYear === today.getFullYear() && viewMonth === today.getMonth());
      todayBtn.hidden = isCurrent;
    }
  }

  function shiftMonth(delta) {
    viewMonth += delta;
    if (viewMonth < 0)   { viewMonth = 11; viewYear--; }
    if (viewMonth > 11)  { viewMonth = 0;  viewYear++; }
    render();
  }

  function goToday() {
    viewYear  = today.getFullYear();
    viewMonth = today.getMonth();
    render();
  }

  if (prevBtn)  prevBtn.addEventListener('click', () => shiftMonth(-1));
  if (nextBtn)  nextBtn.addEventListener('click', () => shiftMonth(+1));
  if (todayBtn) todayBtn.addEventListener('click', goToday);

  render();
})();