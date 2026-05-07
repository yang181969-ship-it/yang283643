// ============================================================
// js/stats.js
// 站点统计页:轻量 SVG/HTML 渲染
// ============================================================

(function () {
  "use strict";

  const SVG_NS = "http://www.w3.org/2000/svg";

  const statsData = {
    summary: {
      total: 45,
      days: 24,
      lastUpdated: "5月6日",
    },
    growth: [
      { month: "2026-02", notes: 4, anime: 3, gallery: 3, updates: 2, total: 12 },
      { month: "2026-03", notes: 6, anime: 6, gallery: 6, updates: 3, total: 21 },
      { month: "2026-04", notes: 8, anime: 7, gallery: 8, updates: 5, total: 28 },
      { month: "2026-05", notes: 9, anime: 9, gallery: 10, updates: 9, total: 37 },
      { month: "2026-06", notes: 11, anime: 11, gallery: 11, updates: 12, total: 45 },
    ],
    recentChanges: [
      { date: "05-06", title: "更新页大改,右上角三个按钮合并成两个", type: "更新" },
      { date: "05-04", title: "移动端加灵动岛,调色盘补上光晕开关", type: "更新" },
      { date: "05-01", title: "主页大改:从静态欢迎页到 Bento 仪表盘", type: "笔记" },
      { date: "04-22", title: "性能优化五步收官,让站点加载更轻快", type: "优化" },
    ],
    activity: [
      { date: "2026-04-07", count: 0 },
      { date: "2026-04-08", count: 1 },
      { date: "2026-04-09", count: 2 },
      { date: "2026-04-10", count: 0 },
      { date: "2026-04-11", count: 1 },
      { date: "2026-04-12", count: 2 },
      { date: "2026-04-13", count: 1 },
      { date: "2026-04-14", count: 0 },
      { date: "2026-04-15", count: 3 },
      { date: "2026-04-16", count: 1 },
      { date: "2026-04-17", count: 0 },
      { date: "2026-04-18", count: 2 },
      { date: "2026-04-19", count: 1 },
      { date: "2026-04-20", count: 1 },
      { date: "2026-04-21", count: 3 },
      { date: "2026-04-22", count: 0 },
      { date: "2026-04-23", count: 1 },
      { date: "2026-04-24", count: 2 },
      { date: "2026-04-25", count: 1 },
      { date: "2026-04-26", count: 0 },
      { date: "2026-04-27", count: 2 },
      { date: "2026-04-28", count: 1 },
      { date: "2026-04-29", count: 3 },
      { date: "2026-04-30", count: 0 },
      { date: "2026-05-01", count: 1 },
      { date: "2026-05-02", count: 2 },
      { date: "2026-05-03", count: 1 },
      { date: "2026-05-04", count: 0 },
      { date: "2026-05-05", count: 2 },
      { date: "2026-05-06", count: 3 },
    ],
    categories: [
      { name: "笔记", value: 18 },
      { name: "动漫", value: 14 },
      { name: "画廊", value: 9 },
      { name: "更新", value: 7 },
      { name: "留言", value: 5 },
    ],
    archive: {
      siteBirthday: "2026年4月13日",
      lastUpdated: "2026年5月6日 13:44",
      version: "v1.1.0",
      stack: [
        "HTML · CSS/SCSS · JavaScript",
        "Waline · KaTeX · 原生 SVG",
      ],
    },
  };

  const growthSeries = [
    { key: "notes", label: "笔记", color: "#4f8cff" },
    { key: "anime", label: "动漫", color: "#9b7cff" },
    { key: "gallery", label: "画廊", color: "#7bdff2" },
    { key: "updates", label: "更新", color: "#f6b26b" },
  ];

  const categoryColors = ["#4f8cff", "#9b7cff", "#7bdff2", "#f6b26b", "#75d6a5"];

  let heroFrame = 0;
  let pageChangeBound = false;

  function escapeHTML(value) {
    return String(value ?? "").replace(/[&<>"']/g, c => ({
      "&": "&amp;",
      "<": "&lt;",
      ">": "&gt;",
      '"': "&quot;",
      "'": "&#39;",
    }[c]));
  }

  function svgEl(tag, attrs = {}) {
    const el = document.createElementNS(SVG_NS, tag);
    Object.entries(attrs).forEach(([key, value]) => {
      if (value != null) el.setAttribute(key, String(value));
    });
    return el;
  }

  function stopHeroAnimation() {
    if (!heroFrame) return;
    window.cancelAnimationFrame(heroFrame);
    heroFrame = 0;
  }

  function renderSummary() {
    document.querySelector('[data-stats-summary="total"]')?.replaceChildren(
      document.createTextNode(String(statsData.summary.total))
    );
    document.querySelector('[data-stats-summary="days"]')?.replaceChildren(
      document.createTextNode(String(statsData.summary.days))
    );
    document.querySelector('[data-stats-summary="lastUpdated"]')?.replaceChildren(
      document.createTextNode(statsData.summary.lastUpdated)
    );
  }

  function renderGrowthLegend() {
    const host = document.querySelector("[data-stats-growth-legend]");
    if (!host) return;

    const items = [
      ...growthSeries.map(item => ({ ...item, kind: "bar" })),
      { key: "total", label: "累计", color: "#4f8cff", kind: "line" },
    ];

    host.innerHTML = items.map(item => `
      <span class="stats-legend-item">
        <span class="stats-legend-mark stats-legend-mark--${item.kind}" style="--legend-color:${item.color}"></span>
        <span>${escapeHTML(item.label)}</span>
      </span>
    `).join("");
  }

  function renderGrowthChart() {
    const host = document.querySelector("[data-stats-growth-chart]");
    if (!host) return;

    renderGrowthLegend();

    const data = statsData.growth;
    const width = 780;
    const height = 320;
    const margin = { top: 28, right: 44, bottom: 42, left: 38 };
    const plotW = width - margin.left - margin.right;
    const plotH = height - margin.top - margin.bottom;
    const bottom = margin.top + plotH;
    const maxValue = Math.ceil(Math.max(...data.map(item => item.total)) / 10) * 10;
    const groupGap = plotW / data.length;
    const barW = Math.min(62, groupGap * 0.44);

    const svg = svgEl("svg", {
      viewBox: `0 0 ${width} ${height}`,
      role: "img",
      "aria-label": "内容增长总览图表",
      class: "stats-growth-svg",
    });

    const defs = svgEl("defs");
    growthSeries.forEach(item => {
      const gradient = svgEl("linearGradient", {
        id: `stats-bar-${item.key}`,
        x1: "0",
        y1: "0",
        x2: "0",
        y2: "1",
      });
      gradient.append(
        svgEl("stop", { offset: "0%", "stop-color": item.color, "stop-opacity": "0.78" }),
        svgEl("stop", { offset: "100%", "stop-color": item.color, "stop-opacity": "0.42" })
      );
      defs.appendChild(gradient);
    });
    const lineGradient = svgEl("linearGradient", {
      id: "stats-total-line",
      x1: "0",
      y1: "0",
      x2: "1",
      y2: "0",
    });
    lineGradient.append(
      svgEl("stop", { offset: "0%", "stop-color": "#4f8cff" }),
      svgEl("stop", { offset: "100%", "stop-color": "#9b7cff" })
    );
    defs.appendChild(lineGradient);
    svg.appendChild(defs);

    for (let i = 0; i <= 5; i += 1) {
      const value = (maxValue / 5) * i;
      const y = bottom - (value / maxValue) * plotH;
      svg.appendChild(svgEl("line", {
        x1: margin.left,
        y1: y,
        x2: width - margin.right,
        y2: y,
        class: "stats-grid-line",
      }));
      svg.appendChild(svgEl("text", {
        x: margin.left - 10,
        y: y + 4,
        "text-anchor": "end",
        class: "stats-chart-label",
      })).textContent = String(value);
    }

    const linePoints = [];

    data.forEach((item, index) => {
      const xCenter = margin.left + groupGap * index + groupGap / 2;
      let yCursor = bottom;

      growthSeries.forEach(series => {
        const value = item[series.key] || 0;
        const rectH = Math.max(2, (value / maxValue) * plotH);
        yCursor -= rectH;
        svg.appendChild(svgEl("rect", {
          x: xCenter - barW / 2,
          y: yCursor,
          width: barW,
          height: rectH,
          rx: 7,
          ry: 7,
          fill: `url(#stats-bar-${series.key})`,
          class: "stats-bar-segment",
        }));
      });

      const lineY = bottom - (item.total / maxValue) * plotH;
      linePoints.push([xCenter, lineY]);

      svg.appendChild(svgEl("text", {
        x: xCenter,
        y: height - 13,
        "text-anchor": "middle",
        class: "stats-chart-label stats-chart-month",
      })).textContent = item.month;
    });

    const linePath = linePoints.map((point, index) => {
      const [x, y] = point;
      return `${index === 0 ? "M" : "L"} ${x.toFixed(2)} ${y.toFixed(2)}`;
    }).join(" ");

    svg.appendChild(svgEl("path", {
      d: linePath,
      fill: "none",
      stroke: "url(#stats-total-line)",
      "stroke-width": "3",
      "stroke-linecap": "round",
      "stroke-linejoin": "round",
      class: "stats-total-path",
    }));

    linePoints.forEach(([x, y], index) => {
      svg.appendChild(svgEl("circle", {
        cx: x,
        cy: y,
        r: 5,
        class: "stats-total-point",
      }));
      svg.appendChild(svgEl("text", {
        x,
        y: y - 12,
        "text-anchor": "middle",
        class: "stats-total-value",
      })).textContent = String(data[index].total);
    });

    host.replaceChildren(svg);
  }

  function renderRecentChanges() {
    const list = document.querySelector("[data-stats-recent]");
    if (!list) return;

    list.innerHTML = statsData.recentChanges.slice(0, 4).map(item => `
      <li class="stats-change-item" data-type="${escapeHTML(item.type)}">
        <time>${escapeHTML(item.date)}</time>
        <span class="stats-change-dot" aria-hidden="true"></span>
        <span class="stats-change-title">${escapeHTML(item.title)}</span>
        <span class="stats-change-type">${escapeHTML(item.type)}</span>
      </li>
    `).join("");
  }

  function renderHeatmap() {
    const host = document.querySelector("[data-stats-heatmap]");
    if (!host) return;

    host.innerHTML = statsData.activity.map(item => {
      const level = Math.max(0, Math.min(3, Number(item.count) || 0));
      const date = item.date.slice(5).replace("-", "/");
      const label = `${item.date}: ${item.count} 次更新`;
      return `
        <span class="stats-heat-cell" data-level="${level}" title="${escapeHTML(label)}" aria-label="${escapeHTML(label)}">
          <span>${escapeHTML(date)}</span>
        </span>
      `;
    }).join("");
  }

  function renderCategories() {
    const host = document.querySelector("[data-stats-categories]");
    if (!host) return;

    const max = Math.max(...statsData.categories.map(item => item.value), 1);
    host.innerHTML = statsData.categories.map((item, index) => {
      const pct = Math.max(6, (item.value / max) * 100);
      const color = categoryColors[index % categoryColors.length];
      return `
        <div class="stats-category-row">
          <span class="stats-category-name">${escapeHTML(item.name)}</span>
          <span class="stats-category-track">
            <span class="stats-category-fill" style="--bar-width:${pct.toFixed(1)}%;--bar-color:${color}"></span>
          </span>
          <strong>${item.value}</strong>
        </div>
      `;
    }).join("");
  }

  function renderArchive() {
    const host = document.querySelector("[data-stats-archive]");
    if (!host) return;

    const items = [
      { label: "建站日期", value: statsData.archive.siteBirthday, icon: "calendar" },
      { label: "最后更新", value: statsData.archive.lastUpdated, icon: "clock" },
      { label: "当前版本", value: statsData.archive.version, icon: "version" },
      { label: "技术栈", value: statsData.archive.stack.join("<br>"), icon: "stack" },
    ];

    host.innerHTML = items.map(item => `
      <div class="stats-archive-item" data-icon="${item.icon}">
        <dt>${escapeHTML(item.label)}</dt>
        <dd>${item.icon === "stack" ? item.value : escapeHTML(item.value)}</dd>
      </div>
    `).join("");
  }

  function columnPoints(x, y, h, w, d) {
    const top = [
      [x, y - h],
      [x + w, y - h + d],
      [x, y - h + d * 2],
      [x - w, y - h + d],
    ];
    const left = [
      [x - w, y - h + d],
      [x, y - h + d * 2],
      [x, y + d * 2],
      [x - w, y + d],
    ];
    const right = [
      [x + w, y - h + d],
      [x, y - h + d * 2],
      [x, y + d * 2],
      [x + w, y + d],
    ];

    const fmt = points => points.map(point => point.map(v => v.toFixed(2)).join(",")).join(" ");
    return { top: fmt(top), left: fmt(left), right: fmt(right) };
  }

  function renderHeroVisual() {
    const host = document.querySelector("[data-stats-hero-visual]");
    if (!host) return;

    stopHeroAnimation();
    host.innerHTML = "";

    const svg = svgEl("svg", {
      viewBox: "0 0 640 280",
      class: "stats-hero-svg",
      "aria-hidden": "true",
      focusable: "false",
    });

    const defs = svgEl("defs");
    const glow = svgEl("filter", {
      id: "stats-column-glow",
      x: "-35%",
      y: "-35%",
      width: "170%",
      height: "170%",
    });
    glow.append(
      svgEl("feGaussianBlur", { stdDeviation: "4", result: "blur" }),
      svgEl("feColorMatrix", {
        in: "blur",
        type: "matrix",
        values: "0 0 0 0 0.31 0 0 0 0 0.55 0 0 0 0 1 0 0 0 0.75 0",
        result: "glow",
      }),
      svgEl("feMerge")
    );
    glow.querySelector("feMerge").append(
      svgEl("feMergeNode", { in: "glow" }),
      svgEl("feMergeNode", { in: "SourceGraphic" })
    );
    defs.appendChild(glow);

    const left = svgEl("linearGradient", { id: "stats-column-left", x1: "0", y1: "0", x2: "1", y2: "1" });
    left.append(
      svgEl("stop", { offset: "0%", "stop-color": "#86c5ff", "stop-opacity": "0.44" }),
      svgEl("stop", { offset: "100%", "stop-color": "#4f8cff", "stop-opacity": "0.7" })
    );
    defs.appendChild(left);

    const right = svgEl("linearGradient", { id: "stats-column-right", x1: "0", y1: "0", x2: "1", y2: "1" });
    right.append(
      svgEl("stop", { offset: "0%", "stop-color": "#b6a0ff", "stop-opacity": "0.68" }),
      svgEl("stop", { offset: "100%", "stop-color": "#6fa8ff", "stop-opacity": "0.42" })
    );
    defs.appendChild(right);

    const top = svgEl("linearGradient", { id: "stats-column-top", x1: "0", y1: "0", x2: "1", y2: "1" });
    top.append(
      svgEl("stop", { offset: "0%", "stop-color": "#ffffff", "stop-opacity": "0.82" }),
      svgEl("stop", { offset: "100%", "stop-color": "#9b7cff", "stop-opacity": "0.58" })
    );
    defs.appendChild(top);
    svg.appendChild(defs);

    svg.appendChild(svgEl("ellipse", {
      cx: "370",
      cy: "226",
      rx: "210",
      ry: "42",
      class: "stats-hero-base stats-hero-base--wide",
    }));
    svg.appendChild(svgEl("ellipse", {
      cx: "370",
      cy: "226",
      rx: "150",
      ry: "26",
      class: "stats-hero-base",
    }));

    [
      [112, 46, 2.3],
      [220, 30, 1.8],
      [318, 62, 1.4],
      [508, 38, 2.5],
      [574, 104, 1.7],
      [156, 152, 1.5],
      [444, 84, 1.2],
      [602, 178, 1.1],
    ].forEach(([cx, cy, r], index) => {
      const spark = svgEl("circle", {
        cx,
        cy,
        r,
        class: "stats-hero-spark",
        style: `--spark-delay:${index * 0.42}s`,
      });
      svg.appendChild(spark);
    });

    const columns = [];
    const positions = [];
    for (let row = 0; row < 5; row += 1) {
      for (let col = 0; col < 8; col += 1) {
        positions.push({
          row,
          col,
          x: 322 + (col - row) * 37,
          y: 82 + (col + row) * 14,
        });
      }
    }
    positions.sort((a, b) => a.y - b.y);

    positions.forEach((item, index) => {
      const group = svgEl("g", {
        class: "stats-column",
        filter: "url(#stats-column-glow)",
      });
      const leftFace = svgEl("polygon", { class: "stats-column-face stats-column-face--left" });
      const rightFace = svgEl("polygon", { class: "stats-column-face stats-column-face--right" });
      const topFace = svgEl("polygon", { class: "stats-column-face stats-column-face--top" });
      group.append(leftFace, rightFace, topFace);
      svg.appendChild(group);

      columns.push({
        x: item.x,
        y: item.y,
        w: 15,
        d: 8,
        base: 32 + ((item.col * 9 + item.row * 13) % 58),
        amplitude: 5 + ((item.col + item.row * 2) % 7),
        speed: 1.0 + ((item.col * 3 + item.row) % 7) * 0.085,
        phase: index * 0.55 + item.row * 0.32,
        left: leftFace,
        right: rightFace,
        top: topFace,
      });
    });

    host.appendChild(svg);

    const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const update = time => {
      const seconds = time / 1000;

      columns.forEach(column => {
        const h = column.base + Math.sin(seconds * column.speed + column.phase) * column.amplitude;
        const points = columnPoints(column.x, column.y, h, column.w, column.d);
        column.left.setAttribute("points", points.left);
        column.right.setAttribute("points", points.right);
        column.top.setAttribute("points", points.top);
      });

      if (reducedMotion || !svg.isConnected) {
        heroFrame = 0;
        return;
      }

      heroFrame = window.requestAnimationFrame(update);
    };

    update(performance.now());
  }

  function bindUpdateLink() {
    const link = document.querySelector("[data-stats-update-link]");
    if (!link || link.dataset.statsBound === "1") return;

    link.dataset.statsBound = "1";
    link.addEventListener("click", event => {
      if (document.body.dataset.standalone === "true") return;
      if (typeof window._loadPage !== "function") return;
      event.preventDefault();
      window._loadPage("update", true);
    });
  }

  function bindPageChangeStopper() {
    if (pageChangeBound) return;
    pageChangeBound = true;
    window.addEventListener("y181:pagechange", event => {
      if (event.detail?.page !== "stats") stopHeroAnimation();
    });
  }

  function init() {
    const page = document.querySelector(".stats-page");
    if (!page) {
      stopHeroAnimation();
      return;
    }

    renderSummary();
    renderHeroVisual();
    renderGrowthChart();
    renderRecentChanges();
    renderHeatmap();
    renderCategories();
    renderArchive();
    bindUpdateLink();
    bindPageChangeStopper();
  }

  window.initStatsPage = init;

  document.addEventListener("DOMContentLoaded", init);
})();
