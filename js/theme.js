/* ============================================================
   外观系统(调色盘 2.0)
   - 主题:明亮 / 黑暗 / 跟随系统 + 8 个预设色 + 自定义色相
   - 纸张:轻薄 / 描边 / 层叠 + 卡片不透明度(45–100%)+ 坐标纸浓度(0–65%)
   - 持久化:localStorage(primary-hue / theme-mode / paper-style / paper-opacity / grid-opacity),
     读到的值全部校验类型与范围;存储不可用时按默认值正常显示
   - 旧的 ambient-glow 键已废弃:不再读取,也不主动删除
   面板的打开/关闭/定位由 site-shell.js 管理,这里只负责状态与面板内交互。
   ============================================================ */

(function initThemeBootstrap() {
  // 同步脚本,在 <head> 里尽早应用,避免刷新时闪屏
  const root = document.documentElement;

  const DEFAULTS = Object.freeze({ mode: "light", hue: 210, paperStyle: "outline", paperOpacity: 82, gridOpacity: 23 });
  const KEYS = { mode: "theme-mode", hue: "primary-hue", paperStyle: "paper-style", paperOpacity: "paper-opacity", gridOpacity: "grid-opacity" };
  const RANGES = { hue: [0, 360], paperOpacity: [45, 100], gridOpacity: [0, 65] };
  const CHOICES = { mode: ["light", "dark", "auto"], paperStyle: ["thin", "outline", "layered"] };

  function readStore(key) {
    try { return localStorage.getItem(key); } catch (_) { return null; }
  }
  function writeStore(key, value) {
    try { localStorage.setItem(key, String(value)); } catch (_) { /* 存储被禁用时只影响记忆,不影响显示 */ }
  }
  // 返回合法值,否则 null
  function validate(name, value) {
    if (CHOICES[name]) return CHOICES[name].includes(value) ? value : null;
    if (value === null || value === undefined || value === "") return null;
    const n = Number(value);
    const [min, max] = RANGES[name];
    return Number.isInteger(n) && n >= min && n <= max ? n : null;
  }

  const state = {};
  for (const name in DEFAULTS) {
    const saved = validate(name, readStore(KEYS[name]));
    state[name] = saved === null ? DEFAULTS[name] : saved;
  }

  function resolvedMode(mode) {
    if (mode !== "auto") return mode;
    return window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
  }
  function apply(names) {
    if (names.includes("mode")) {
      root.setAttribute("data-theme", resolvedMode(state.mode));
      root.setAttribute("data-theme-mode", state.mode);
    }
    if (names.includes("hue")) root.style.setProperty("--primary-hue", String(state.hue));
    if (names.includes("paperStyle")) root.setAttribute("data-paper", state.paperStyle);
    if (names.includes("paperOpacity")) root.style.setProperty("--paper-alpha", (state.paperOpacity / 100).toFixed(2));
    if (names.includes("gridOpacity")) root.style.setProperty("--paper-grid-alpha", (state.gridOpacity / 100).toFixed(2));
  }
  apply(Object.keys(DEFAULTS));
  root.removeAttribute("data-glow");

  // 只接受合法值;改变了的项立即应用、写入存储并广播 theme:change
  function set(patch) {
    const changed = [];
    for (const name in patch) {
      if (!(name in DEFAULTS)) continue;
      const value = validate(name, patch[name]);
      if (value === null || value === state[name]) continue;
      state[name] = value;
      changed.push(name);
    }
    if (!changed.length) return changed;
    apply(changed);
    changed.forEach(name => writeStore(KEYS[name], state[name]));
    document.dispatchEvent(new CustomEvent("theme:change", { detail: { kind: changed.length === 1 ? changed[0] : "multiple", changed } }));
    return changed;
  }

  window.siteTheme = {
    DEFAULTS,
    RANGES,
    get: name => state[name],
    set,
    // 跟随系统时,系统明暗变化只重新解析 data-theme,不写存储
    refreshMode: () => { apply(["mode"]); document.dispatchEvent(new CustomEvent("theme:change", { detail: { kind: "mode", changed: ["mode"] } })); },
  };
  // 兼容旧调用方
  window.__applyMode = mode => set({ mode });
})();

document.addEventListener("DOMContentLoaded", () => {
  const theme = window.siteTheme;
  const dialog = document.getElementById("tool-theme");
  const themePanel = document.getElementById("theme-panel");
  const hueSlider = document.getElementById("hue-slider");
  if (!theme || !dialog || !themePanel || !hueSlider) return;

  const modeBtns = dialog.querySelectorAll(".theme-mode-btn");
  const presetBtns = dialog.querySelectorAll(".theme-preset");
  const styleBtns = dialog.querySelectorAll("[data-paper-style]");
  const ranges = [...dialog.querySelectorAll("input[data-paper-setting]")];
  const tabs = [...dialog.querySelectorAll("[data-appearance-tab]")];
  const panes = [...dialog.querySelectorAll("[data-appearance-pane]")];
  const mobile = window.matchMedia("(max-width: 900px)");

  /* ===== 面板 UI 与状态同步 ===== */
  function syncMode() {
    const mode = theme.get("mode");
    modeBtns.forEach(btn => {
      const on = btn.dataset.mode === mode;
      btn.classList.toggle("active", on);
      btn.setAttribute("aria-checked", String(on));
    });
  }
  function syncPresets() {
    const hue = String(theme.get("hue"));
    presetBtns.forEach(btn => {
      const on = btn.dataset.hue === hue;
      btn.classList.toggle("active", on);
      btn.setAttribute("aria-checked", String(on));
    });
  }
  function syncHue() {
    const hue = String(theme.get("hue"));
    if (hueSlider.value !== hue) {
      hueSlider.value = hue;
      // 让 main.js 的色相条 thumb 跟随(它只渲染,不会再写回)
      hueSlider.dispatchEvent(new Event("input", { bubbles: true }));
    }
    syncPresets();
  }
  function syncStyle() {
    const style = theme.get("paperStyle");
    styleBtns.forEach(btn => {
      const on = btn.dataset.paperStyle === style;
      btn.classList.toggle("active", on);
      btn.setAttribute("aria-checked", String(on));
    });
  }
  function syncRange(input) {
    const value = theme.get(input.dataset.paperSetting);
    if (Number(input.value) !== value) input.value = String(value);
    const min = Number(input.min), max = Number(input.max);
    input.style.setProperty("--ratio", ((value - min) / (max - min)).toFixed(4));
    input.setAttribute("aria-valuetext", `${value}%`);
    const output = dialog.querySelector(`output[for="${input.id}"]`);
    if (output) output.textContent = `${value}%`;
    input.closest(".appearance-range")?.querySelectorAll("[data-value]").forEach(node => {
      node.classList.toggle("active", Number(node.dataset.value) === value);
    });
  }
  function syncAll() {
    syncMode();
    syncHue();
    syncStyle();
    ranges.forEach(syncRange);
  }
  syncAll();

  /* ===== 分页:主题 | 纸张 =====
     两个分页叠放在同一个网格单元里,面板高度取两者较高者,切换时外框不跳动。
     非当前分页用 inert + visibility:hidden,不可聚焦也不会被读屏读到。 */
  function selectTab(key, focus) {
    preview.stop(0);
    tabs.forEach(tab => {
      const on = tab.dataset.appearanceTab === key;
      tab.setAttribute("aria-selected", String(on));
      tab.tabIndex = on ? 0 : -1;
      if (on && focus) tab.focus();
    });
    panes.forEach(pane => {
      const on = pane.dataset.appearancePane === key;
      pane.toggleAttribute("inert", !on);
    });
    dialog.querySelector(".appearance-body")?.scrollTo({ top: 0 });
  }
  tabs.forEach((tab, index) => {
    tab.addEventListener("click", () => selectTab(tab.dataset.appearanceTab, false));
    tab.addEventListener("keydown", event => {
      const step = { ArrowRight: 1, ArrowLeft: -1, Home: -index, End: tabs.length - 1 - index }[event.key];
      if (step === undefined) return;
      event.preventDefault();
      selectTab(tabs[(index + step + tabs.length) % tabs.length].dataset.appearanceTab, true);
    });
  });

  /* ===== 沉浸式实时预览 =====
     拖动色相 / 不透明度 / 坐标纸滑块时,面板只留下当前滑块与数值,其余内容、面板底色、
     阴影和移动端遮罩淡出,让后面的网页完整可见。只切换类名,不改布局、不重建滑块。 */
  const preview = (() => {
    let source = null;
    let timer = 0;
    let pointer = null; // 正在拖动的 pointerId
    function start(group) {
      clearTimeout(timer);
      if (source && source !== group) source.removeAttribute("data-preview-source");
      source = group;
      group.setAttribute("data-preview-source", "");
      dialog.classList.add("is-previewing");
    }
    function stop(delay) {
      clearTimeout(timer);
      const done = () => {
        dialog.classList.remove("is-previewing");
        source?.removeAttribute("data-preview-source");
        source = null;
      };
      if (delay > 0) timer = setTimeout(done, delay);
      else done();
    }
    function end(event, delay) {
      if (pointer === null || (event && event.pointerId !== pointer)) return;
      pointer = null;
      stop(delay);
    }
    dialog.querySelectorAll("[data-preview-slider]").forEach(slider => {
      slider.addEventListener("pointerdown", event => {
        if (event.button !== 0 || !event.isPrimary) return;
        const group = slider.closest("[data-preview-group]");
        if (!group) return;
        pointer = event.pointerId;
        start(group);
      });
      // 捕获意外丢失(例如系统手势打断)时也要恢复
      slider.addEventListener("lostpointercapture", event => end(event, 350));
    });
    window.addEventListener("pointerup", event => end(event, 350), true);
    window.addEventListener("pointercancel", event => end(event, 0), true);
    window.addEventListener("blur", () => { pointer = null; stop(0); });
    document.addEventListener("visibilitychange", () => { if (document.hidden) { pointer = null; stop(0); } });
    window.addEventListener("resize", () => { if (pointer === null) stop(0); });
    return {
      start, stop,
      flash(group, duration) { if (pointer === null) { start(group); stop(duration); } },
      cancel() { pointer = null; stop(0); },
    };
  })();

  /* ===== 面板开关:按钮与弹窗由 site-shell.js 统一管理,这里只同步面板状态 ===== */
  window.addEventListener("site-panel:open", event => {
    if (event.detail?.key !== "theme") return;
    syncAll();
    themePanel.classList.add("show");
  });
  window.addEventListener("site-panel:close", event => {
    if (event.detail?.key !== "theme") return;
    preview.cancel();
    sheet.reset();
    themePanel.classList.remove("show");
  });

  /* ===== 主题分页 ===== */
  hueSlider.addEventListener("input", () => {
    theme.set({ hue: Number(hueSlider.value) });
    syncPresets();
  });
  presetBtns.forEach(btn => {
    btn.addEventListener("click", () => {
      theme.set({ hue: Number(btn.dataset.hue) });
      syncHue();
    });
  });
  modeBtns.forEach(btn => {
    btn.addEventListener("click", () => {
      theme.set({ mode: btn.dataset.mode });
      syncMode();
    });
  });

  /* ===== 纸张分页 ===== */
  styleBtns.forEach(btn => {
    btn.addEventListener("click", () => {
      theme.set({ paperStyle: btn.dataset.paperStyle });
      syncStyle();
    });
  });

  // 原生 range 的 thumb 中心不在 0% / 100%,滑轨刻度按同一公式定位(见 _theme-panel.scss 的 --thumb)
  const THUMB = 20;
  function tickX(input, value) {
    const rect = input.getBoundingClientRect();
    const ratio = (value - Number(input.min)) / (Number(input.max) - Number(input.min));
    return rect.left + THUMB / 2 + (rect.width - THUMB) * ratio;
  }
  function applyRange(input, value) {
    theme.set({ [input.dataset.paperSetting]: value });
    syncRange(input);
  }
  ranges.forEach(input => {
    const group = input.closest("[data-preview-group]");
    const values = [...group.querySelectorAll(".range-preset[data-value]")].map(node => Number(node.dataset.value));
    input.addEventListener("input", () => applyRange(input, Number(input.value)));

    // 轻点滑轨上的刻度节点:跳到精确的预设值。预设只是点击跳转,不吸附拖动结果。
    // 只有同时满足以下条件才算"点刻度",否则一律保留原生滑块给出的值:
    //   - 按下点不在 thumb 上(按住 thumb 必然是拖动,哪怕只调了 1%)
    //   - 本次指针操作里数值最多因"点轨道跳转"变化一次,之后没有任何拖动产生的变化
    //   - 指针按下后基本没有移动
    let gesture = null;
    input.addEventListener("pointerdown", event => {
      const onThumb = Math.abs(event.clientX - tickX(input, Number(input.value))) <= THUMB / 2 + 2;
      gesture = { id: event.pointerId, x: event.clientX, y: event.clientY, onThumb, changes: 0, moved: false };
    });
    input.addEventListener("input", () => { if (gesture) gesture.changes += 1; });
    input.addEventListener("pointermove", event => {
      if (gesture && event.pointerId === gesture.id && Math.hypot(event.clientX - gesture.x, event.clientY - gesture.y) > 4) gesture.moved = true;
    });
    input.addEventListener("pointerup", event => {
      if (!gesture || event.pointerId !== gesture.id) return;
      const { x, onThumb, changes, moved } = gesture;
      gesture = null;
      if (onThumb || moved || changes > 1) return;
      const hit = values.find(value => Math.abs(tickX(input, value) - x) <= 14);
      if (hit !== undefined) applyRange(input, hit);
    });
    input.addEventListener("pointercancel", () => { gesture = null; });

    // 刻度下方的数字标签:同样是预设节点,可点击、可用键盘操作
    group.querySelectorAll(".range-preset[data-value]").forEach(node => {
      node.addEventListener("click", () => {
        applyRange(input, Number(node.dataset.value));
        preview.flash(group, 600);
      });
    });
  });

  /* ===== 恢复默认(两个分页共用)===== */
  dialog.querySelector("[data-appearance-reset]")?.addEventListener("click", () => {
    preview.cancel();
    theme.set({ ...theme.DEFAULTS });
    syncAll();
  });

  /* ===== 移动端底部抽屉:从把手 / 标题栏下滑关闭 =====
     只在抽屉顶部区域响应,不会和滑块拖动或内容滚动冲突。 */
  const sheet = (() => {
    const area = dialog.querySelector("[data-sheet-drag]");
    let drag = null;
    function reset() {
      drag = null;
      dialog.classList.remove("is-dragging");
      dialog.style.removeProperty("transform");
    }
    if (!area) return { reset };
    area.addEventListener("pointerdown", event => {
      if (dialog.dataset.mode !== "sheet" || !event.isPrimary || event.button !== 0) return;
      if (event.target.closest("button, a, input")) return;
      drag = { id: event.pointerId, y: event.clientY, t: performance.now(), dy: 0 };
      area.setPointerCapture?.(event.pointerId);
      dialog.classList.add("is-dragging");
    });
    area.addEventListener("pointermove", event => {
      if (!drag || event.pointerId !== drag.id) return;
      drag.dy = Math.max(0, event.clientY - drag.y);
      dialog.style.transform = `translateY(${drag.dy}px)`;
    });
    function release(event, cancelled) {
      if (!drag || event.pointerId !== drag.id) return;
      const { dy, t } = drag;
      const fast = dy > 30 && dy / Math.max(1, performance.now() - t) > 0.6;
      reset();
      if (!cancelled && (dy > 90 || fast)) window.sitePanels?.close("theme");
    }
    area.addEventListener("pointerup", event => release(event, false));
    area.addEventListener("pointercancel", event => release(event, true));
    area.addEventListener("lostpointercapture", event => release(event, true));
    return { reset };
  })();
  // 断点切换时 site-shell.js 会关闭面板;这里再兜底清理拖动残留
  mobile.addEventListener?.("change", () => { preview.cancel(); sheet.reset(); });

  /* ===== 监听系统主题变化(auto 模式下实时跟随) ===== */
  const mql = window.matchMedia("(prefers-color-scheme: dark)");
  const onSystemChange = () => { if (theme.get("mode") === "auto") theme.refreshMode(); };
  if (mql.addEventListener) mql.addEventListener("change", onSystemChange);
  else if (mql.addListener) mql.addListener(onSystemChange);
});
