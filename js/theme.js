document.addEventListener("DOMContentLoaded", () => {
  const themeToggle = document.getElementById("theme-toggle");
  const themePanel = document.getElementById("theme-panel");
  const hueSlider = document.getElementById("hue-slider");
  const root = document.documentElement;

  if (!themeToggle || !themePanel || !hueSlider) return;

  // 读取上次保存的颜色
  const savedHue = localStorage.getItem("primary-hue");
  if (savedHue) {
    root.style.setProperty("--primary-hue", savedHue);
    hueSlider.value = savedHue;
  }

  themeToggle.addEventListener("click", (e) => {
    e.stopPropagation();
    themePanel.classList.toggle("show");
  });

  hueSlider.addEventListener("input", (e) => {
    const hue = e.target.value;
    root.style.setProperty("--primary-hue", hue);
    localStorage.setItem("primary-hue", hue);
  });

  document.addEventListener("click", (e) => {
    if (!e.target.closest(".theme-control")) {
      themePanel.classList.remove("show");
    }
  });
});