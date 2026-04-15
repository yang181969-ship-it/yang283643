function initAnimePage() {
  const tabs = document.querySelectorAll(".anime-tabs button");
  const sections = document.querySelectorAll(".anime-section");

  if (!tabs.length || !sections.length) return;

  tabs.forEach((btn) => {
    btn.addEventListener("click", () => {
      const targetId = btn.dataset.target;

      // 切换按钮高亮
      tabs.forEach((b) => b.classList.remove("active"));
      btn.classList.add("active");

      // 切换内容显示
      sections.forEach((section) => {
        if (section.id === targetId) {
          section.classList.add("active");
        } else {
          section.classList.remove("active");
        }
      });
    });
  });
}