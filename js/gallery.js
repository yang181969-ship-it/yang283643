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
    const filterItems = filterMenu.querySelectorAll("[data-filter]");
    const sortItems = sortMenu.querySelectorAll("[data-sort]");

    filterItems.forEach((item) => {
      item.classList.toggle("active", item.dataset.filter === currentFilter);
    });

    sortItems.forEach((item) => {
      item.classList.toggle("active", item.dataset.sort === currentSort);
    });
  }

  function updateButtonText() {
    const filterTextMap = {
      all: "分类 ▼",
      real: "分类：现实 ▼",
      anime: "分类：动漫 ▼"
    };

    const sortTextMap = {
      default: "排列 ▼",
      random: "排列：随机 ▼"
    };

    filterBtn.textContent = filterTextMap[currentFilter] || "分类 ▼";
    sortBtn.textContent = sortTextMap[currentSort] || "排列 ▼";
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

    grid.innerHTML = data
      .map(
        (item) => `
        <div class="gallery-item">
          <img src="${item.src}" data-src="${item.src}" alt="">
        </div>
      `
      )
      .join("");

    bindImageClick();
    updateMenuActiveState();
    updateButtonText();
  }

  function bindImageClick() {
    const imgs = grid.querySelectorAll(".gallery-item img");

    imgs.forEach((img) => {
      img.addEventListener("click", () => {
        lightbox.style.display = "flex";
        lightboxImg.src = img.dataset.src;
      });
    });
  }

  // 点击按钮：切换菜单显示
  filterBtn.addEventListener("click", (e) => {
    e.stopPropagation();
    const isOpen = filterMenu.style.display === "flex";
    closeMenus();
    if (!isOpen) {
      filterMenu.style.display = "flex";
    }
  });

  sortBtn.addEventListener("click", (e) => {
    e.stopPropagation();
    const isOpen = sortMenu.style.display === "flex";
    closeMenus();
    if (!isOpen) {
      sortMenu.style.display = "flex";
    }
  });

  // 点击分类选项
  filterMenu.addEventListener("click", (e) => {
    const item = e.target.closest("[data-filter]");
    if (!item) return;

    currentFilter = item.dataset.filter;
    closeMenus();
    render();
  });

  // 点击排列选项
  sortMenu.addEventListener("click", (e) => {
    const item = e.target.closest("[data-sort]");
    if (!item) return;

    currentSort = item.dataset.sort;
    closeMenus();
    render();
  });

  // 点击页面任意其他区域关闭菜单
  document.addEventListener("click", () => {
    closeMenus();
  });

  // 放大图关闭
  lightbox.addEventListener("click", () => {
    lightbox.style.display = "none";
    lightboxImg.src = "";
  });

  render();
}