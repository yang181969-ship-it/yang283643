// ============================================================
// js/stats.js
// 站点统计页 ── Phase F
//
// 渲染策略:
//   1) 拉 data/site-meta.json → 灌 hero 区指标
//   2) 拉 data/stats.json     → 主图(堆叠柱+累计折线) + 6 张静态饼
//   3) 拉 Waline /api/comment → 评论按角色 (admin/guest) 实时饼
//   4) 监听 'theme:change' 事件 ── 主题/色相切换时重渲染所有图表的颜色
//
// 缓存层:与 home-cards.js 同款,y181_ 前缀
// 失败兜底:每张卡独立报错,不影响其他卡
// ============================================================

(function () {
  "use strict";

  // ---------------- 常量 ----------------
  const STORAGE_PREFIX = "y181_";
  const WALINE_API     = "https://yang283643-waline.vercel.app";

  // 聚合数据每月由 CI 跑一次,1 天 TTL 已足够;
  // 建站日靠 site-meta 透传,不写死避免双源
  const TTL = {
    meta:     1000 * 60 * 60 * 24,        // 1 天
    stats:    1000 * 60 * 60 * 24,        // 1 天
    comments: 1000 * 60 * 60,             // 1 小时
  };

  // 同会话内存缓存
  const memCache = new Map();

  // 注册过的图表实例 (id → Chart),供主题切换时统一重渲染
  const charts = new Map();

  // 7 张卡 + 1 张主图共用的源数据快照(主题切换重绘时复用,免重新 fetch)
  const dataState = { meta: null, stats: null, comments: null };
  let chartLoadPromise = null;
  let themeListenerBound = false;

  // ============================================================
  // 缓存
  // ============================================================
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
      console.warn(`[stats] ${key} fetch failed, falling back to stale:`, err);
      if (stored) { memCache.set(key, stored.v); return stored.v; }
      throw err;
    }
  }
  function readStorage(k)  { try { const r = localStorage.getItem(k); return r ? JSON.parse(r) : null; } catch { return null; } }
  function writeStorage(k, v) { try { localStorage.setItem(k, JSON.stringify({ t: Date.now(), v })); } catch {} }

  async function fetchJson(url, opt) {
    const res = await fetch(url, opt);
    if (!res.ok) throw new Error(`${url} → ${res.status}`);
    return res.json();
  }

  function dataUrl(file) {
    const inHtmlDir = window.location.pathname.replace(/\\/g, "/").includes("/html/");
    return `${inHtmlDir ? "../" : ""}data/${file}`;
  }

  function loadChartJs() {
    if (typeof Chart !== "undefined") return Promise.resolve();
    if (chartLoadPromise) return chartLoadPromise;

    chartLoadPromise = new Promise(resolve => {
      const script = document.createElement("script");
      script.src = "https://cdn.jsdelivr.net/npm/chart.js@4.4/dist/chart.umd.min.js";
      script.async = true;
      script.dataset.statsChartjs = "1";
      script.onload = resolve;
      script.onerror = resolve;
      document.head.appendChild(script);
    });

    return chartLoadPromise;
  }

  function escapeHTML(s) {
    return String(s ?? "").replace(/[&<>"']/g, c => ({
      "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"
    }[c]));
  }

  // ============================================================
  // 主题色解析 ── 把 CSS 变量翻成 Chart.js 能吃的具体值
  // 每次重绘都重新读,所以滑色相、切明暗都会生效
  // ============================================================
  function readThemeColors() {
    const cs   = getComputedStyle(document.documentElement);
    const hue  = parseFloat(cs.getPropertyValue('--primary-hue')) || 330;
    const text = (cs.getPropertyValue('--text-main')  || '#1f2937').trim();
    const muted = (cs.getPropertyValue('--text-muted') || '#6b7280').trim();
    const border = (cs.getPropertyValue('--border-soft') || '#d9e2ef').trim();

    // 从主色相均匀偏移 9 个色,饼图最多用得着这么多;
    // 偏移用奇数权重避免相邻 slice 撞色
    const offsets = [0, 60, 180, 240, 30, 120, 200, 300, 90];
    const series = offsets.map((d, i) => `hsl(${(hue + d) % 360}, ${72 - (i % 3) * 4}%, ${68 - (i % 4) * 3}%)`);

    return { hue, text, muted, border, series };
  }

  // ============================================================
  // Hero 区指标灌入
  // ============================================================
  function hydrateHero(meta) {
    document.querySelectorAll('[data-meta]').forEach(el => {
      const key = el.dataset.meta;
      const v = meta?.[key];
      if (v == null) return;
      if (key === 'latestUpdate' && typeof v === 'string') {
        // 2026-05-06 → 5 月 6 日
        const m = v.match(/^(\d{4})-(\d{2})-(\d{2})/);
        el.textContent = m ? `${parseInt(m[2], 10)}月${parseInt(m[3], 10)}日` : v;
      } else {
        el.textContent = String(v);
      }
    });
  }

  // ============================================================
  // 主图:堆叠柱(月度增量) + 累计折线
  // snapshots 是每月末的累积总数,需要 diff 出"本月新增"作为柱
  // ============================================================
  function buildMainChartData(snapshots) {
    if (!snapshots || !snapshots.length) return null;

    // 同月可能多个快照(临时跑了多次),只保留每月最新
    const byMonth = new Map();
    snapshots.forEach(s => byMonth.set(s.month, s));
    const months = [...byMonth.keys()].sort();

    let prev = { notes: 0, anime: 0, gallery: 0, updates: 0 };
    const delta = { notes: [], anime: [], gallery: [], updates: [] };
    const cumulative = [];

    months.forEach(m => {
      const cur = byMonth.get(m);
      delta.notes.push(Math.max(0, cur.notes - prev.notes));
      delta.anime.push(Math.max(0, cur.anime - prev.anime));
      delta.gallery.push(Math.max(0, cur.gallery - prev.gallery));
      delta.updates.push(Math.max(0, cur.updates - prev.updates));
      cumulative.push(cur.total);
      prev = cur;
    });

    return { months, delta, cumulative };
  }

  function renderMainChart(snapshots) {
    const canvas = document.getElementById('stats-main-chart');
    if (!canvas) return;
    const empty = document.querySelector('.stats-chart-empty');

    const built = buildMainChartData(snapshots);
    if (!built || !built.months.length) {
      if (empty) empty.hidden = false;
      canvas.style.display = 'none';
      return;
    }

    const colors = readThemeColors();

    // 销毁旧实例(主题切换会走这条路径)
    const old = charts.get('main');
    if (old) old.destroy();

    const chart = new Chart(canvas, {
      type: 'bar',
      data: {
        labels: built.months,
        datasets: [
          { type: 'bar', label: '笔记',   data: built.delta.notes,    backgroundColor: colors.series[0], stack: 'add', borderRadius: 4, borderSkipped: false },
          { type: 'bar', label: '番剧',   data: built.delta.anime,    backgroundColor: colors.series[1], stack: 'add', borderRadius: 4, borderSkipped: false },
          { type: 'bar', label: '画廊',   data: built.delta.gallery,  backgroundColor: colors.series[2], stack: 'add', borderRadius: 4, borderSkipped: false },
          { type: 'bar', label: '更新',   data: built.delta.updates,  backgroundColor: colors.series[3], stack: 'add', borderRadius: 4, borderSkipped: false },
          {
            type: 'line', label: '累计',  data: built.cumulative,
            borderColor: colors.series[4], backgroundColor: 'transparent',
            borderWidth: 2.5, tension: 0.32, pointRadius: 4, pointHoverRadius: 6,
            pointBackgroundColor: colors.series[4], yAxisID: 'y2', order: -1,
          },
        ],
      },
      options: {
        responsive: true, maintainAspectRatio: false,
        animation: { duration: 600 },
        scales: {
          x: { stacked: true, ticks: { color: colors.muted }, grid: { display: false } },
          y: { stacked: true, beginAtZero: true, ticks: { color: colors.muted, precision: 0 }, grid: { color: colors.border } },
          y2: {
            position: 'right', beginAtZero: true,
            ticks: { color: colors.muted, precision: 0 }, grid: { display: false },
          },
        },
        plugins: {
          legend: { display: false },           // 用自定义图例
          tooltip: {
            backgroundColor: 'rgba(28, 34, 48, 0.92)', padding: 10, titleColor: '#fff', bodyColor: '#fff',
            borderColor: colors.series[0], borderWidth: 1, cornerRadius: 10,
          },
        },
      },
    });
    charts.set('main', chart);

    // 自定义图例
    const legendEl = document.getElementById('stats-main-legend');
    if (legendEl) {
      legendEl.innerHTML = chart.data.datasets.map((ds, i) => `
        <span class="stats-chart-legend-item">
          <span class="stats-legend-dot" style="background:${ds.backgroundColor || ds.borderColor}"></span>
          <span>${escapeHTML(ds.label)}</span>
        </span>
      `).join('');
    }
  }

  // ============================================================
  // 饼图通用渲染(7 张卡共用)
  // ============================================================
  function renderPie(key, items) {
    const canvas  = document.querySelector(`canvas[data-pie="${key}"]`);
    const legend  = document.querySelector(`[data-legend="${key}"]`);
    const wrapper = canvas?.closest('.stats-card');
    if (!canvas || !legend) return;

    if (!Array.isArray(items) || !items.length) {
      legend.innerHTML = `<li class="stats-legend-empty">暂无数据</li>`;
      canvas.style.display = 'none';
      return;
    }
    canvas.style.display = '';

    const colors = readThemeColors();
    const total = items.reduce((s, it) => s + (it.value || 0), 0);

    const old = charts.get(key);
    if (old) old.destroy();

    const chart = new Chart(canvas, {
      type: 'doughnut',
      data: {
        labels: items.map(it => it.label),
        datasets: [{
          data: items.map(it => it.value),
          backgroundColor: items.map((_, i) => colors.series[i % colors.series.length]),
          borderColor: 'transparent', borderWidth: 0, hoverOffset: 6,
        }],
      },
      options: {
        responsive: true, maintainAspectRatio: false,
        cutout: '62%', animation: { duration: 600 },
        plugins: {
          legend: { display: false },
          tooltip: {
            backgroundColor: 'rgba(28, 34, 48, 0.92)', padding: 10,
            titleColor: '#fff', bodyColor: '#fff', cornerRadius: 10,
            callbacks: {
              label: ctx => `${ctx.label}: ${ctx.parsed} (${total ? ((ctx.parsed / total) * 100).toFixed(1) : 0}%)`,
            },
          },
        },
      },
    });
    charts.set(key, chart);

    legend.innerHTML = items.map((it, i) => {
      const pct = total ? (it.value / total) * 100 : 0;
      const color = colors.series[i % colors.series.length];
      return `
        <li class="stats-legend-row" data-idx="${i}">
          <span class="stats-legend-dot" style="background:${color}"></span>
          <span class="stats-legend-label" title="${escapeHTML(it.label)}">${escapeHTML(it.label)}</span>
          <span class="stats-legend-value">${it.value}</span>
          <span class="stats-legend-pct">${pct.toFixed(1)}%</span>
        </li>
      `;
    }).join('');

    // 图例 hover ↔ 高亮对应饼图扇区(轻量 UX 加分项)
    legend.querySelectorAll('.stats-legend-row').forEach(row => {
      row.addEventListener('mouseenter', () => {
        const idx = Number(row.dataset.idx);
        chart.setActiveElements([{ datasetIndex: 0, index: idx }]);
        chart.tooltip.setActiveElements([{ datasetIndex: 0, index: idx }], { x: 0, y: 0 });
        chart.update();
      });
      row.addEventListener('mouseleave', () => {
        chart.setActiveElements([]);
        chart.tooltip.setActiveElements([], { x: 0, y: 0 });
        chart.update();
      });
    });
  }

  // ============================================================
  // 评论分布:Waline 实时拉,按 type 字段 (admin/guest) 分桶
  // ============================================================
  async function fetchCommentsBreakdown() {
    const url = `${WALINE_API}/api/comment?type=recent&pageSize=100`;
    const data = await fetchJson(url);
    const list = Array.isArray(data) ? data : (data?.data || []);
    const bucket = { 管理员: 0, 访客: 0 };
    list.forEach(c => {
      const isAdmin = c.type === 'administrator' || c.type === 'admin' || c.user_id != null;
      bucket[isAdmin ? '管理员' : '访客'] += 1;
    });
    return Object.entries(bucket).map(([label, value]) => ({ label, value }));
  }

  // ============================================================
  // 主题切换响应:用 dataState 里的快照重绘所有图表
  // ============================================================
  function onThemeChange() {
    if (!dataState.stats) return;
    renderMainChart(dataState.stats.snapshots);
    Object.entries(dataState.stats.breakdowns).forEach(([key, val]) => {
      if (key === 'commentsByRole') return;       // 用 dataState.comments
      renderPie(key, val);
    });
    if (dataState.comments) renderPie('commentsByRole', dataState.comments);
  }

  // ============================================================
  // 入口
  // ============================================================
  async function init() {
    if (!document.getElementById('stats-main-chart')) return;

    // Chart.js 没加载完(网络慢)就等一下;失败超 8s 走降级
    if (typeof Chart === 'undefined') {
      const timeout = new Promise(resolve => setTimeout(resolve, 8000));
      await Promise.race([loadChartJs(), timeout]);
    }
    if (!document.getElementById('stats-main-chart')) return;

    if (typeof Chart === 'undefined') {
      console.error('[stats] Chart.js 加载失败');
      document.querySelectorAll('.stats-pie-wrap, .stats-chart-wrap').forEach(el => {
        el.innerHTML = '<p class="stats-chart-empty" style="display:block">图表库加载失败</p>';
      });
      return;
    }

    // Chart.js 全局基线:字体跟随 body
    Chart.defaults.font.family = getComputedStyle(document.body).fontFamily || 'Arial, sans-serif';
    Chart.defaults.font.size   = 12;

    // 1) Hero meta(快,先灌)
    cached('site-meta', TTL.meta, () => fetchJson(dataUrl('site-meta.json')))
      .then(meta => { dataState.meta = meta; hydrateHero(meta); })
      .catch(err => console.warn('[stats] site-meta:', err));

    // 2) 主体 stats(主图 + 6 张静态饼)
    let stats = null;
    try {
      stats = await cached('stats-data', TTL.stats, () => fetchJson(dataUrl('stats.json')));
      dataState.stats = stats;
    } catch (err) {
      console.error('[stats] 主数据加载失败:', err);
      const empty = document.querySelector('.stats-chart-empty');
      if (empty) empty.hidden = false;
      return;
    }

    renderMainChart(stats.snapshots);
    Object.entries(stats.breakdowns).forEach(([key, val]) => {
      if (key === 'commentsByRole') return;       // live-fetch
      renderPie(key, val);
    });

    // 3) 评论实时桶
    cached('comments-by-role', TTL.comments, fetchCommentsBreakdown)
      .then(items => { dataState.comments = items; renderPie('commentsByRole', items); })
      .catch(err => {
        console.warn('[stats] comments:', err);
        renderPie('commentsByRole', []);          // 触发 "暂无数据" 渲染
      });

    // 4) 主题切换:重渲染所有图表
    if (!themeListenerBound) {
      document.addEventListener('theme:change', onThemeChange);
      themeListenerBound = true;
    }
  }

  window.initStatsPage = init;
  document.addEventListener('DOMContentLoaded', init);
})();
