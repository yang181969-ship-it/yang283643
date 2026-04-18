function initAnimePage() {
  const tabs = document.querySelectorAll(".anime-tabs button");
  const sections = document.querySelectorAll(".anime-section");

  if (!tabs.length || !sections.length) return;

  // 防止重复绑定（页面切换时可能多次调用）
  tabs.forEach((btn) => {
    if (btn.dataset.animeInit) return;
    btn.dataset.animeInit = "1";

    btn.addEventListener("click", () => {
      const targetId = btn.dataset.target;

      tabs.forEach((b) => b.classList.remove("active"));
      btn.classList.add("active");

      sections.forEach((section) => {
        section.classList.toggle("active", section.id === targetId);
      });
    });
  });

  // 默认激活第一个tab（如果没有active的话）
  const hasActive = [...tabs].some((b) => b.classList.contains("active"));
  if (!hasActive && tabs[0]) {
    tabs[0].click();
  }
}