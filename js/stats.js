// ============================================================
// js/stats.js
// 站点统计页:轻量 SVG/HTML 渲染
// ============================================================

(function () {
  "use strict";

  const SVG_NS = "http://www.w3.org/2000/svg";
  const RECENT_CHANGES_LIMIT = 8;

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
      { date: "05-06", title: "更新页大改,右上角三个按钮合并成两个", type: "更新", page: "update" },
      { date: "05-04", title: "移动端加灵动岛,调色盘补上光晕开关", type: "更新", page: "update" },
      { date: "05-01", title: "主页大改:从静态欢迎页到 Bento 仪表盘", type: "更新", page: "update" },
      { date: "04-22", title: "性能优化五步收官,让站点加载更轻快", type: "更新", page: "update" },
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

  const dataCenterColors = [
    "#5b6ff2",
    "#8b63f4",
    "#56a7f7",
    "#f59b45",
    "#62c99a",
    "#cf5f9f",
    "#a6b1e1",
    "#80cbc4",
  ];

  const dataCenterState = {
    groups: [],
    activeGroupId: "",
    activeChildId: "",
  };

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

  function changeTargetPage(item) {
    const pageByType = {
      更新: "update",
      笔记: "notes",
      动漫: "anime",
      画廊: "gallery",
      留言: "comment",
      数据: "stats",
      关于: "about",
      首页: "home",
    };
    pageByType["音乐"] = "home";
    pageByType["动漫"] = "anime";
    pageByType["画廊"] = "gallery";
    pageByType["图片"] = "gallery";
    pageByType["笔记"] = "notes";
    pageByType["更新"] = "update";
    return item.page || pageByType[item.type] || "update";
  }

  function pageHref(page) {
    const prefix = document.body.dataset.standalone === "true" ? "../" : "";
    return page === "home"
      ? `${prefix}index.html`
      : `${prefix}index.html?page=${encodeURIComponent(page)}`;
  }

  function assetHref(path) {
    const prefix = document.body.dataset.standalone === "true" ? "../" : "";
    return `${prefix}${path}`;
  }

  function formatShortDate(value) {
    const text = String(value || "").trim();
    const match = text.match(/^\d{4}-(\d{2})-(\d{2})/);
    if (match) return `${match[1]}-${match[2]}`;
    return text || "--";
  }

  async function loadStatsPayload() {
    try {
      const res = await fetch(assetHref("data/stats.json"), { cache: "no-cache" });
      if (!res.ok) throw new Error(`stats.json ${res.status}`);

      const data = await res.json();
      const changes = Array.isArray(data.recentChanges)
        ? data.recentChanges
        : [];

      if (changes.length) {
        statsData.recentChanges = changes;
        renderRecentChanges();
      }

      const groups = data?.dataCenter?.groups;
      if (Array.isArray(groups) && groups.length) {
        dataCenterState.groups = normalizeDataCenterGroups(groups);
        if (dataCenterState.groups.length) {
          const defaultGroup = defaultDataCenterGroup(dataCenterState.groups);
          dataCenterState.activeGroupId = defaultGroup?.id || "";
          dataCenterState.activeChildId = defaultGroup?.children?.[0]?.id || "";
          renderDataCenter();
        } else {
          renderDataCenterEmpty("暂无可用统计数据");
        }
      } else {
        renderDataCenterEmpty("暂无可用统计数据");
      }
    } catch (err) {
      console.warn("[stats] stats payload fallback:", err);
      renderDataCenterEmpty("统计数据暂不可用");
    }
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

    list.innerHTML = statsData.recentChanges.slice(0, RECENT_CHANGES_LIMIT).map(item => {
      const page = changeTargetPage(item);
      const href = item.href || pageHref(page);
      return `
      <li class="stats-change-item" data-type="${escapeHTML(item.type)}" data-page="${escapeHTML(page)}">
        <a class="stats-change-link" href="${escapeHTML(href)}" data-stats-change-link data-stats-page="${escapeHTML(page)}">
          <time>${escapeHTML(formatShortDate(item.date))}</time>
          <span class="stats-change-dot" aria-hidden="true"></span>
          <span class="stats-change-title">${escapeHTML(item.title)}</span>
          <span class="stats-change-type">${escapeHTML(item.type)}</span>
        </a>
      </li>
    `;
    }).join("");

    list.querySelectorAll("[data-stats-change-link]").forEach(link => {
      link.addEventListener("click", event => {
        const page = link.dataset.statsPage;
        if (!page || document.body.dataset.standalone === "true") return;
        if (typeof window._loadPage !== "function") return;
        event.preventDefault();
        window._loadPage(page, true);
      });
    });
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

  function normalizeDataCenterGroups(groups) {
    return groups
      .map(group => ({
        id: String(group.id || group.name || "").trim(),
        name: String(group.name || group.id || "").trim(),
        children: Array.isArray(group.children)
          ? group.children
              .map(child => ({
                id: String(child.id || child.name || "").trim(),
                name: String(child.name || child.id || "").trim(),
                total: Number(child.total) || 0,
                unit: String(child.unit || "项").trim() || "项",
                items: Array.isArray(child.items)
                  ? child.items
                      .map(item => ({
                        name: String(item.name || item.label || "").trim(),
                        value: Number(item.value) || 0,
                      }))
                      .filter(item => item.name && item.value > 0)
                  : [],
              }))
              .filter(child => child.id && child.name && child.items.length)
          : [],
      }))
      .filter(group => group.id && group.name && group.children.length);
  }

  function formatCompactNumber(value) {
    return new Intl.NumberFormat("zh-CN").format(Number(value) || 0);
  }

  function defaultDataCenterGroup(groups) {
    return groups.find(group => group.id === "notes") || groups[0];
  }

  function renderDataCenter() {
    const groups = dataCenterState.groups;
    if (!groups.length) {
      renderDataCenterEmpty("暂无可用统计数据");
      return;
    }

    const activeGroup = groups.find(group => group.id === dataCenterState.activeGroupId) || groups[0];
    dataCenterState.activeGroupId = activeGroup.id;

    if (!activeGroup.children.some(child => child.id === dataCenterState.activeChildId)) {
      dataCenterState.activeChildId = activeGroup.children[0]?.id || "";
    }

    renderDataCenterPrimaryTabs(groups, activeGroup.id);
    renderDataCenterSecondaryTabs(activeGroup);
    renderDataCenterChart(activeGroup);
  }

  function renderDataCenterPrimaryTabs(groups, activeId) {
    const host = document.querySelector("[data-stats-primary-tabs]");
    if (!host) return;

    host.innerHTML = groups.map(group => `
      <button class="stats-data-tab${group.id === activeId ? " is-active" : ""}"
        type="button"
        aria-pressed="${group.id === activeId ? "true" : "false"}"
        data-stats-primary-tab="${escapeHTML(group.id)}">
        ${escapeHTML(group.name)}
      </button>
    `).join("");

    host.querySelectorAll("[data-stats-primary-tab]").forEach(button => {
      button.addEventListener("click", () => {
        dataCenterState.activeGroupId = button.dataset.statsPrimaryTab || "";
        const nextGroup = dataCenterState.groups.find(group => group.id === dataCenterState.activeGroupId);
        dataCenterState.activeChildId = nextGroup?.children?.[0]?.id || "";
        renderDataCenter();
      });
    });
  }

  function renderDataCenterSecondaryTabs(group) {
    const host = document.querySelector("[data-stats-secondary-tabs]");
    if (!host) return;

    host.innerHTML = group.children.map(child => `
      <button class="stats-data-subtab${child.id === dataCenterState.activeChildId ? " is-active" : ""}"
        type="button"
        aria-pressed="${child.id === dataCenterState.activeChildId ? "true" : "false"}"
        data-stats-secondary-tab="${escapeHTML(child.id)}">
        ${escapeHTML(child.name)}
      </button>
    `).join("");

    host.querySelectorAll("[data-stats-secondary-tab]").forEach(button => {
      button.addEventListener("click", () => {
        dataCenterState.activeChildId = button.dataset.statsSecondaryTab || "";
        renderDataCenter();
      });
    });
  }

  function renderDataCenterChart(group) {
    const host = document.querySelector("[data-stats-data-chart]");
    if (!host) return;

    const child = group.children.find(item => item.id === dataCenterState.activeChildId) || group.children[0];
    if (!child || !child.items.length) {
      renderDataCenterEmpty("这个分类暂时没有可展示的数据");
      return;
    }

    dataCenterState.activeChildId = child.id;
    const total = child.items.reduce((sum, item) => sum + item.value, 0);
    if (!total) {
      renderDataCenterEmpty("这个分类暂时没有可展示的数据");
      return;
    }

    host.innerHTML = `
      <div class="stats-donut-wrap">
        ${renderDonutSvg(child, total)}
      </div>
    `;
  }

  function spreadDonutLabels(labels, minY, maxY) {
    if (labels.length < 2) return;

    labels.sort((a, b) => a.y - b.y);
    const gap = Math.min(78, (maxY - minY) / (labels.length - 1));

    labels[0].y = Math.max(labels[0].y, minY);
    for (let index = 1; index < labels.length; index += 1) {
      labels[index].y = Math.max(labels[index].y, labels[index - 1].y + gap);
    }

    const overflow = labels[labels.length - 1].y - maxY;
    if (overflow > 0) {
      labels.forEach(label => {
        label.y -= overflow;
      });
    }

    if (labels[0].y < minY) {
      const shift = minY - labels[0].y;
      labels.forEach(label => {
        label.y += shift;
      });
    }
  }

  function donutPoint(cx, cy, radius, angle) {
    return {
      x: cx + Math.cos(angle) * radius,
      y: cy + Math.sin(angle) * radius,
    };
  }

  function donutSegmentPath(cx, cy, innerRadius, outerRadius, startAngle, endAngle) {
    const fullCircle = Math.PI * 2;
    const safeEndAngle = Math.min(endAngle, startAngle + fullCircle - 0.0001);
    const largeArc = safeEndAngle - startAngle > Math.PI ? 1 : 0;
    const outerStart = donutPoint(cx, cy, outerRadius, startAngle);
    const outerEnd = donutPoint(cx, cy, outerRadius, safeEndAngle);
    const innerEnd = donutPoint(cx, cy, innerRadius, safeEndAngle);
    const innerStart = donutPoint(cx, cy, innerRadius, startAngle);

    return [
      `M ${outerStart.x.toFixed(1)} ${outerStart.y.toFixed(1)}`,
      `A ${outerRadius} ${outerRadius} 0 ${largeArc} 1 ${outerEnd.x.toFixed(1)} ${outerEnd.y.toFixed(1)}`,
      `L ${innerEnd.x.toFixed(1)} ${innerEnd.y.toFixed(1)}`,
      `A ${innerRadius} ${innerRadius} 0 ${largeArc} 0 ${innerStart.x.toFixed(1)} ${innerStart.y.toFixed(1)}`,
      "Z",
    ].join(" ");
  }

  function renderDonutCallout(label, child, total) {
    const pct = total > 0 ? (label.value / total) * 100 : 0;
    const anchor = label.side === "right" ? "start" : "end";
    const valueText = `${formatCompactNumber(label.value)} ${child.unit || "项"}`;

    return `
      <g class="stats-donut-callout" data-side="${label.side}">
        <path
          class="stats-donut-callout-line"
          d="M ${label.startX} ${label.startY} L ${label.routeX} ${label.startY} L ${label.routeX} ${label.dotY} L ${label.dotX} ${label.dotY}"
          stroke="${label.color}"
        />
        <circle class="stats-donut-callout-halo" cx="${label.dotX}" cy="${label.dotY}" r="6" fill="${label.color}" />
        <circle class="stats-donut-callout-dot" cx="${label.dotX}" cy="${label.dotY}" r="3.6" fill="${label.color}" />
        <text x="${label.textX}" y="${label.y}" text-anchor="${anchor}" class="stats-donut-label-title">${escapeHTML(label.name)}</text>
        <text x="${label.textX}" y="${label.y + 23}" text-anchor="${anchor}" class="stats-donut-label-value">${escapeHTML(valueText)}</text>
        <text x="${label.textX}" y="${label.y + 46}" text-anchor="${anchor}" class="stats-donut-label-percent">${pct.toFixed(1)}%</text>
      </g>
    `;
  }

  function renderDonutSvg(child, total) {
    const width = 760;
    const outerRadius = 126;
    const innerRadius = 84;
    const calloutStartRadius = outerRadius + 4;
    const routeOffset = outerRadius + 64;
    const labelGap = 78;
    const labelMinY = 54;
    const labelBottomSpace = 100;
    let angleOffset = -Math.PI / 2;
    const labelSides = child.items.reduce((counts, item) => {
      const value = Number(item.value) || 0;
      const angle = total > 0 ? (value / total) * Math.PI * 2 : 0;
      const side = Math.cos(angleOffset + angle / 2) >= 0 ? "right" : "left";
      counts[side] += 1;
      angleOffset += angle;
      return counts;
    }, { left: 0, right: 0 });
    const maxSideCount = Math.max(labelSides.left, labelSides.right, 1);
    const height = Math.max(360, labelMinY + (maxSideCount - 1) * labelGap + labelBottomSpace);
    const cx = width / 2;
    const cy = height / 2;
    const labelMaxY = height - 86;
    angleOffset = -Math.PI / 2;

    const segments = child.items.map((item, index) => {
      const value = Number(item.value) || 0;
      const angle = total > 0 ? (value / total) * Math.PI * 2 : 0;
      const startAngle = angleOffset;
      const endAngle = angleOffset + angle;
      const color = dataCenterColors[index % dataCenterColors.length];
      const path = `
        <path
          class="stats-donut-segment"
          d="${donutSegmentPath(cx, cy, innerRadius, outerRadius, startAngle, endAngle)}"
          fill="${color}"
        />
      `;
      angleOffset = endAngle;
      return path;
    }).join("");

    angleOffset = -Math.PI / 2;
    const labels = child.items.map((item, index) => {
      const value = Number(item.value) || 0;
      const angle = total > 0 ? (value / total) * Math.PI * 2 : 0;
      const midAngle = angleOffset + angle / 2;
      const side = Math.cos(midAngle) >= 0 ? "right" : "left";
      const startPoint = donutPoint(cx, cy, calloutStartRadius, midAngle);
      const routeX = cx + (side === "right" ? routeOffset : -routeOffset);
      const dotX = routeX + (side === "right" ? 24 : -24);
      const targetY = Math.min(labelMaxY, Math.max(labelMinY, cy + Math.sin(midAngle) * 150));

      angleOffset += angle;

      return {
        name: item.name,
        value,
        color: dataCenterColors[index % dataCenterColors.length],
        side,
        startX: startPoint.x.toFixed(1),
        startY: startPoint.y.toFixed(1),
        routeX: routeX.toFixed(1),
        dotX: dotX.toFixed(1),
        dotY: 0,
        textX: (dotX + (side === "right" ? 22 : -22)).toFixed(1),
        y: targetY,
      };
    });

    ["left", "right"].forEach(side => {
      spreadDonutLabels(labels.filter(label => label.side === side), labelMinY, labelMaxY);
    });

    const callouts = labels.map(label => {
      label.dotY = (label.y - 6).toFixed(1);
      return renderDonutCallout(label, child, total);
    }).join("");

    return `
      <svg class="stats-donut-svg" viewBox="0 0 ${width} ${height}" role="img" aria-label="${escapeHTML(child.name)}分类分布">
        <circle cx="${cx}" cy="${cy}" r="${(outerRadius + innerRadius) / 2}" fill="none" stroke="rgba(105,145,220,0.12)" stroke-width="${outerRadius - innerRadius}" />
        ${segments}
        ${callouts}
        <circle class="stats-donut-hole" cx="${cx}" cy="${cy}" r="68" />
        <text x="${cx}" y="${cy - 7}" text-anchor="middle" class="stats-donut-center-title">${escapeHTML(child.name)}</text>
        <text x="${cx}" y="${cy + 24}" text-anchor="middle" class="stats-donut-center-value">${formatCompactNumber(total)} ${escapeHTML(child.unit || "项")}</text>
      </svg>
    `;
  }

  function renderDataCenterEmpty(message) {
    const host = document.querySelector("[data-stats-data-chart]");
    if (!host) return;
    host.innerHTML = `<p class="stats-empty">${escapeHTML(message)}</p>`;
  }

  function renderArchive() {
    const host = document.querySelector("[data-stats-archive]");
    if (!host) return;

    const archive = statsData.archive || {};
    const baseItems = [
      { label: "建站日期", value: archive.siteBirthday || "--" },
      { label: "最后更新", value: archive.lastUpdated || "--" },
      { label: "当前版本", value: archive.version || "--" },
    ];
    const techItems = (Array.isArray(archive.stack) ? archive.stack : [])
      .flatMap(item => String(item || "").replace(/CSS\/SCSS/g, "CSS · SCSS").split("·"))
      .map(item => item.trim())
      .filter(Boolean);
    const statusItems = Array.isArray(archive.status) && archive.status.length
      ? archive.status
      : [
          { label: "内容统计", value: "自动生成", type: "auto" },
          { label: "留言系统", value: "迁移中", type: "migrating" },
          { label: "移动端适配", value: "优化中", type: "progress" },
          { label: "数据中心", value: "已启用", type: "enabled" },
        ];
    const normalizedStatusItems = statusItems.map(item => ({
      label: item.label,
      value: item.value,
      type: String(item.type || "enabled").replace(/[^a-z0-9_-]/gi, "") || "enabled",
    }));

    host.innerHTML = `
      <section class="stats-archive-section">
        <h3 class="stats-archive-section-title">基础档案</h3>
        <div class="stats-archive-info-list">
          ${baseItems.map(item => `
            <div class="stats-archive-info-row">
              <span class="stats-archive-info-label">${escapeHTML(item.label)}</span>
              <span class="stats-archive-info-value">${escapeHTML(item.value)}</span>
            </div>
          `).join("")}
        </div>
      </section>

      <section class="stats-archive-section">
        <h3 class="stats-archive-section-title">技术能力</h3>
        <div class="stats-archive-tags">
          ${techItems.map(item => `<span>${escapeHTML(item)}</span>`).join("")}
        </div>
      </section>

      <section class="stats-archive-section stats-archive-section--status">
        <h3 class="stats-archive-section-title">运行状态</h3>
        <div class="stats-archive-status-list">
          ${normalizedStatusItems.map(item => `
            <div class="stats-archive-status-row">
              <span class="stats-archive-status-name">${escapeHTML(item.label)}</span>
              <span class="stats-archive-status-badge is-${item.type}">${escapeHTML(item.value)}</span>
            </div>
          `).join("")}
        </div>
      </section>

      <svg class="stats-archive-bg-mark" viewBox="0 0 200 200" aria-hidden="true">
        <path d="M42 62h48l14 18h54v74H42z" fill="none" stroke="currentColor" stroke-width="10" stroke-linejoin="round"></path>
        <path d="M68 104h64M68 128h44" fill="none" stroke="currentColor" stroke-width="10" stroke-linecap="round"></path>
      </svg>
    `;
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
    loadStatsPayload();
    renderArchive();
    bindPageChangeStopper();
  }

  window.initStatsPage = init;

  document.addEventListener("DOMContentLoaded", init);
})();
