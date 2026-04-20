/* ============================================================
   主题系统
   - 色相：滑块 + 8 个预设
   - 模式：light / dark / auto（跟随系统）
   - 持久化：localStorage
   ============================================================ */

(function initThemeBootstrap() {
  // 尽早应用，避免刷新时闪白屏
  const root = document.documentElement;

  const savedHue = localStorage.getItem("primary-hue");
  if (savedHue) root.style.setProperty("--primary-hue", savedHue);

  const savedMode = localStorage.getItem("theme-mode") || "auto";
  applyMode(savedMode, root);

  // 暴露给 DOMContentLoaded 后的代码复用
  window.__applyMode = applyMode;
})();

function applyMode(mode, root) {
  root = root || document.documentElement;
  if (mode === "auto") {
    const prefersDark = window.matchMedia("(prefers-color-scheme: dark)").matches;
    root.setAttribute("data-theme", prefersDark ? "dark" : "light");
    root.setAttribute("data-theme-mode", "auto");
  } else {
    root.setAttribute("data-theme", mode);
    root.setAttribute("data-theme-mode", mode);
  }
}

document.addEventListener("DOMContentLoaded", () => {
  const themeToggle  = document.getElementById("theme-toggle");
  const themePanel   = document.getElementById("theme-panel");
  const hueSlider    = document.getElementById("hue-slider");
  const modeToggle   = document.getElementById("mode-toggle");
  const modeBtns     = document.querySelectorAll(".theme-mode-btn");
  const presetBtns   = document.querySelectorAll(".theme-preset");
  const root         = document.documentElement;

  if (!themeToggle || !themePanel || !hueSlider) return;

  /* ===== 初始化色相滑块显示值 ===== */
  const savedHue = localStorage.getItem("primary-hue");
  if (savedHue) hueSlider.value = savedHue;

  /* ===== 初始化模式按钮高亮 ===== */
  function syncModeActive() {
    const mode = localStorage.getItem("theme-mode") || "auto";
    modeBtns.forEach(btn => btn.classList.toggle("active", btn.dataset.mode === mode));
  }
  syncModeActive();

  /* ===== 初始化预设颜色高亮 ===== */
  function syncPresetActive() {
    const hue = hueSlider.value;
    presetBtns.forEach(btn => btn.classList.toggle("active", btn.dataset.hue === hue));
  }
  syncPresetActive();

  /* ===== 面板开关 ===== */
  themeToggle.addEventListener("click", (e) => {
    e.stopPropagation();
    themePanel.classList.toggle("show");
  });

  document.addEventListener("click", (e) => {
    if (!e.target.closest(".theme-control")) {
      themePanel.classList.remove("show");
    }
  });

  /* ===== 色相滑块 ===== */
  hueSlider.addEventListener("input", (e) => {
    const hue = e.target.value;
    root.style.setProperty("--primary-hue", hue);
    localStorage.setItem("primary-hue", hue);
    syncPresetActive();
  });

  /* ===== 预设颜色点击 ===== */
  presetBtns.forEach(btn => {
    btn.addEventListener("click", () => {
      const hue = btn.dataset.hue;
      root.style.setProperty("--primary-hue", hue);
      hueSlider.value = hue;
      localStorage.setItem("primary-hue", hue);
      syncPresetActive();
    });
  });

  /* ===== 模式按钮（面板内） ===== */
  modeBtns.forEach(btn => {
    btn.addEventListener("click", () => {
      const mode = btn.dataset.mode;
      localStorage.setItem("theme-mode", mode);
      window.__applyMode(mode);
      syncModeActive();
    });
  });

  /* ===== 快捷模式按钮（调色盘右边）：light -> dark -> auto 循环 ===== */
  if (modeToggle) {
    modeToggle.addEventListener("click", () => {
      const current = localStorage.getItem("theme-mode") || "auto";
      const next = current === "light" ? "dark"
                 : current === "dark"  ? "auto"
                                       : "light";
      localStorage.setItem("theme-mode", next);
      window.__applyMode(next);
      syncModeActive();
    });
  }

  /* ===== 监听系统主题变化（auto 模式下实时跟随） ===== */
  const mql = window.matchMedia("(prefers-color-scheme: dark)");
  const onSystemChange = () => {
    if ((localStorage.getItem("theme-mode") || "auto") === "auto") {
      window.__applyMode("auto");
    }
  };
  if (mql.addEventListener) {
    mql.addEventListener("change", onSystemChange);
  } else if (mql.addListener) {
    mql.addListener(onSystemChange);
  }
});