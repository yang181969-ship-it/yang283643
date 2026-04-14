document.addEventListener("DOMContentLoaded", () => {
  const themeToggle = document.getElementById("theme-toggle");
  const themePanel = document.getElementById("theme-panel");
  const hueSlider = document.getElementById("hue-slider");
  const root = document.documentElement;

  if (!themeToggle || !themePanel || !hueSlider) {
    console.error("调色盘元素未找到");
    return;
  }

  // 打开 / 关闭调色盘
  themeToggle.addEventListener("click", (e) => {
    e.stopPropagation();
    themePanel.classList.toggle("show");
  });

  // 拖动滑块时实时改颜色
  hueSlider.addEventListener("input", (e) => {
    root.style.setProperty("--primary-hue", e.target.value);
  });

  // 点击外部关闭
  document.addEventListener("click", (e) => {
    if (!e.target.closest(".theme-control")) {
      themePanel.classList.remove("show");
    }
  });
});