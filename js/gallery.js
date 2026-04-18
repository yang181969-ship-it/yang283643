function initGalleryPage() {
  const grid = document.getElementById("gallery-grid");
  const filterBtn = document.getElementById("filter-btn");
  const sortBtn = document.getElementById("sort-btn");
  const filterMenu = document.getElementById("filter-menu");
  const sortMenu = document.getElementById("sort-menu");
  const lightbox = document.getElementById("lightbox");
  const lightboxImg = document.getElementById("lightbox-img");

  if (!grid || !filterBtn || !sortBtn || !filterMenu || !sortMenu || !lightbox || !lightboxImg) {
    return;
  }

  let currentFilter = "all";
  let currentSort = "default";

  function closeMenus() {
    filterMenu.style.display = "none";
    sortMenu.style.display = "none";
  }

  function updateMenuActiveState() {
    filterMenu.querySelectorAll("[data-filter]").forEach((item) => {
      item.classList.toggle("active", item.dataset.filter === currentFilter);
    });
    sortMenu.querySelectorAll("[data-sort]").forEach((item) => {
      item.classList.toggle("active", item.dataset.sort === currentSort);
    });
  }

  function updateButtonText() {
    const filterTextMap = { all: "分类 ▼", real: "分类：现实 ▼", anime: "分类：动漫 ▼" };
    const sortTextMap = { default: "排列 ▼", random: "排列：随机 ▼" };
    filterBtn.textContent = filterTextMap[currentFilter] || "分类 ▼";
    sortBtn.textContent = sortTextMap[currentSort] || "排列 ▼";
  }

  function openLightbox(src) {
    lightboxImg.src = src;
    lightbox.style.display = "flex";
    // 聚焦以便接受键盘事件
    lightbox.focus?.();
  }

  function closeLightbox() {
    lightbox.style.display = "none";
    lightboxImg.src = "";
  }

  function render() {
    let data = [...galleryData];

    if (currentFilter !== "all") {
      data = data.filter((item) => item.category === currentFilter);
    }

    if (currentSort === "default") {
      data.sort((a, b) => a.order - b.order);
    } else if (currentSort === "random") {
      data.sort(() => Math.random() - 0.5);
    }

    // 使用懒加载：loading="lazy" 让浏览器只加载视口内的图片
    grid.innerHTML = data
      .map(
        (item) => `
        <div class="gallery-item">
          <img src="${item.src}" alt="" loading="lazy" decoding="async">
        </div>
      `
      )
      .join("");

    // 事件委托：只绑定一次，不需要每次render都重新绑定
    updateMenuActiveState();
    updateButtonText();
  }

  // 事件委托处理图片点击（替代原来每张图单独绑定）
  grid.addEventListener("click", (e) => {
    const img = e.target.closest(".gallery-item img");
    if (img) openLightbox(img.src);
  });

  filterBtn.addEventListener("click", (e) => {
    e.stopPropagation();
    const isOpen = filterMenu.style.display === "flex";
    closeMenus();
    if (!isOpen) filterMenu.style.display = "flex";
  });

  sortBtn.addEventListener("click", (e) => {
    e.stopPropagation();
    const isOpen = sortMenu.style.display === "flex";
    closeMenus();
    if (!isOpen) sortMenu.style.display = "flex";
  });

  filterMenu.addEventListener("click", (e) => {
    const item = e.target.closest("[data-filter]");
    if (!item) return;
    currentFilter = item.dataset.filter;
    closeMenus();
    render();
  });

  sortMenu.addEventListener("click", (e) => {
    const item = e.target.closest("[data-sort]");
    if (!item) return;
    currentSort = item.dataset.sort;
    closeMenus();
    render();
  });

  document.addEventListener("click", closeMenus);

  // 点击背景关闭lightbox
  lightbox.addEventListener("click", closeLightbox);

  // 按 Esc 键也能关闭lightbox
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && lightbox.style.display === "flex") {
      closeLightbox();
    }
  });

  render();
}