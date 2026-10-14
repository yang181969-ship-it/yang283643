const GALLERY_CATEGORY_LABELS = {
  all: "全部",
  real: "现实",
  anime: "动漫",
  illustration: "插画",
  character: "人物",
  landscape: "风景",
  life: "生活",
  collection: "收藏",
  works: "作品",
  other: "其他",
};

// 统一图片索引（data/image-index.json）中的来源模块
const GALLERY_SOURCE_LABELS = {
  gallery: "画廊",
  anime: "动漫作品",
  journey: "足迹",
  cards: "银行卡图鉴",
  devices: "数码设备",
  works: "作品",
  journal: "日记",
};

const GALLERY_TAG_LABELS = {
  night: "夜景",
  city: "城市",
  sky: "天空",
  daily: "日常",
  blue: "蓝色",
  healing: "治愈",
  character: "人物",
};

const GALLERY_SORT_LABELS = {
  default: "默认排序",
  random: "随机排序",
  "time-asc": "更新时间升序",
  "time-desc": "更新时间降序",
};

const GALLERY_TOOLBAR_DEFAULT_LABELS = {
  search: "搜索",
  filter: "全部",
  sort: "默认",
};

const GALLERY_TOOLBAR_ARIA_LABELS = {
  search: "展开搜索",
  filter: "展开筛选",
  sort: "展开排序",
};

const galleryState = {
  search: "",
  source: "all",
  category: "all",
  tags: [],
  sort: "default",
};

const galleryRuntime = {
  images: [],
  visibleImages: [],
  currentLightboxIndex: 0,
  previousFocus: null,
  refs: {},
};

// images：可选的图片数组（Life 传入统一图片索引）；不传时沿用 gallery-data.js
function initGalleryPage(images) {
  if (!Array.isArray(images)) {
    const sourceData = typeof galleryData !== "undefined" ? galleryData : [];
    images = Array.isArray(sourceData) ? sourceData : [];
  }
  const grid = document.querySelector("[data-gallery-list]");
  const lightbox = document.getElementById("gallery-lightbox");

  if (!grid || !lightbox) return;

  galleryRuntime.images = images;
  galleryRuntime.refs = {
    grid,
    lightbox,
    lightboxImg: document.querySelector("[data-lightbox-img]"),
    lightboxTitle: document.querySelector("[data-lightbox-title]"),
    lightboxDate: document.querySelector("[data-lightbox-date]"),
    lightboxCategory: document.querySelector("[data-lightbox-category]"),
    lightboxTags: document.querySelector("[data-lightbox-tags]"),
    lightboxNote: document.querySelector("[data-lightbox-note]"),
    lightboxSource: document.querySelector("[data-lightbox-source]"),
    currentIndexEl: document.querySelector("[data-current-index]"),
    totalCountEl: document.querySelector("[data-total-count]"),
  };

  galleryState.search = "";
  galleryState.source = "all";
  galleryState.category = "all";
  galleryState.tags = [];
  galleryState.sort = "default";

  renderGalleryHeroStats(images);
  renderGallerySourceChips();
  renderGalleryTagChips();
  syncGalleryCategoryButtons();
  syncGallerySortButtons();
  syncGalleryToolbarLabels();
  initGalleryToolbar();
  initGallerySearch();
  initGalleryFilters();
  initGallerySort();

  grid.addEventListener("click", (event) => {
    const card = event.target.closest(".gallery-item[data-gallery-index]");
    if (!card) return;
    openLightbox(Number(card.dataset.galleryIndex));
  });

  grid.addEventListener("keydown", (event) => {
    if (event.key !== "Enter" && event.key !== " ") return;
    const card = event.target.closest(".gallery-item[data-gallery-index]");
    if (!card) return;
    event.preventDefault();
    openLightbox(Number(card.dataset.galleryIndex));
  });

  lightbox.querySelectorAll("[data-lightbox-close]").forEach((btn) => {
    btn.addEventListener("click", closeLightbox);
  });

  lightbox.querySelectorAll("[data-lightbox-prev]").forEach((btn) => {
    btn.addEventListener("click", showPrev);
  });

  lightbox.querySelectorAll("[data-lightbox-next]").forEach((btn) => {
    btn.addEventListener("click", showNext);
  });

  if (!window.__galleryLightboxKeyBound) {
    document.addEventListener("keydown", handleLightboxKeydown);
    window.__galleryLightboxKeyBound = true;
  }

  renderGallery();
}

function renderGalleryHeroStats(images) {
  const totalEl = document.querySelector("[data-gallery-total]");
  if (totalEl) totalEl.textContent = String(images.length);
}

function initGalleryToolbar() {
  const toolbar = document.querySelector("[data-gallery-toolbar]");
  if (!toolbar) return;

  const actionButtons = toolbar.querySelectorAll("[data-gallery-action]");

  actionButtons.forEach((button) => {
    button.addEventListener("click", (event) => {
      event.stopPropagation();

      const action = button.dataset.galleryAction;
      const panel = document.querySelector(`[data-gallery-panel="${action}"]`);
      const isOpen = panel?.classList.contains("is-open");

      closeGalleryPanels();

      if (!isOpen && panel) {
        button.classList.add("is-active");
        panel.classList.add("is-open");

        if (action === "search") {
          const input = panel.querySelector("[data-gallery-search-input]");
          window.setTimeout(() => input?.focus(), 80);
        }
      }
    });
  });

  // 文档级监听只绑定一次；每次按当前 DOM 查询，页面反复进入也不会叠加监听
  if (window.__galleryToolbarDocBound) return;
  window.__galleryToolbarDocBound = true;

  document.addEventListener("click", (event) => {
    const target = event.target;
    if (!(target instanceof Element)) return;
    const isInsideToolbar = target.closest("[data-gallery-toolbar]");
    const isInsidePanel = target.closest(".gallery-toolbar-popover");

    if (!isInsideToolbar && !isInsidePanel) {
      closeGalleryPanels();
    }
  });

  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape") {
      closeGalleryPanels();
    }
  });
}

function closeGalleryPanels() {
  document.querySelectorAll("[data-gallery-action].is-active").forEach((button) => button.classList.remove("is-active"));
  document.querySelectorAll("[data-gallery-panel].is-open").forEach((panel) => panel.classList.remove("is-open"));
}

function initGallerySearch() {
  const input = document.querySelector("[data-gallery-search-input]");
  const clearButton = document.querySelector("[data-gallery-search-clear]");
  if (!input) return;

  input.addEventListener("input", () => {
    galleryState.search = input.value.trim();
    syncGalleryToolbarLabels();
    renderGallery();
  });

  clearButton?.addEventListener("click", () => {
    input.value = "";
    galleryState.search = "";
    syncGalleryToolbarLabels();
    renderGallery();
    input.focus();
  });
}

function initGalleryFilters() {
  const categoryList = document.querySelector("[data-gallery-category-list]");
  const tagList = document.querySelector("[data-gallery-tag-list]");
  const clearButton = document.querySelector("[data-gallery-filter-clear]");
  const sourceList = document.querySelector("[data-gallery-source-list]");
  if (!categoryList || !tagList) return;

  sourceList?.addEventListener("click", (event) => {
    const button = event.target.closest("[data-source]");
    if (!button) return;

    galleryState.source = button.dataset.source || "all";
    syncGallerySourceButtons();
    syncGalleryToolbarLabels();
    renderGallery();
  });

  categoryList.addEventListener("click", (event) => {
    const button = event.target.closest("[data-category]");
    if (!button) return;

    galleryState.category = button.dataset.category || "all";
    galleryState.tags = [];
    syncGalleryCategoryButtons();
    renderGalleryTagChips();
    syncGalleryToolbarLabels();
    renderGallery();
  });

  tagList.addEventListener("click", (event) => {
    const button = event.target.closest("[data-tag]");
    if (!button) return;

    const tag = button.dataset.tag;
    if (!tag) return;

    galleryState.tags = galleryState.tags.includes(tag)
      ? galleryState.tags.filter((item) => item !== tag)
      : [...galleryState.tags, tag];

    button.classList.toggle("is-active", galleryState.tags.includes(tag));
    syncGalleryToolbarLabels();
    renderGallery();
  });

  clearButton?.addEventListener("click", () => {
    galleryState.source = "all";
    syncGallerySourceButtons();
    galleryState.category = "all";
    galleryState.tags = [];
    syncGalleryCategoryButtons();
    renderGalleryTagChips();
    syncGalleryToolbarLabels();
    renderGallery();
  });
}

function initGallerySort() {
  const sortPanel = document.querySelector(".gallery-sort-panel");
  if (!sortPanel) return;

  sortPanel.addEventListener("click", (event) => {
    const button = event.target.closest("[data-sort]");
    if (!button) return;

    galleryState.sort = button.dataset.sort || "default";
    syncGallerySortButtons();
    syncGalleryToolbarLabels();
    renderGallery();
  });
}

function syncGalleryCategoryButtons() {
  document.querySelectorAll("[data-gallery-category-list] [data-category]").forEach((button) => {
    button.classList.toggle("is-active", button.dataset.category === galleryState.category);
  });
}

// 只切换高亮，不重建按钮：被点击的按钮留在 DOM 中，弹出面板不会被误判为点在外部而关闭
function syncGallerySourceButtons() {
  document.querySelectorAll("[data-gallery-source-list] [data-source]").forEach((button) => {
    button.classList.toggle("is-active", button.dataset.source === galleryState.source);
  });
}

function syncGallerySortButtons() {
  document.querySelectorAll(".gallery-sort-panel [data-sort]").forEach((button) => {
    button.classList.toggle("is-active", button.dataset.sort === galleryState.sort);
  });
}

function syncGalleryToolbarLabels() {
  const searchText = galleryState.search.trim();
  setGalleryToolbarButtonLabel(
    "search",
    searchText ? `搜索：${searchText}` : GALLERY_TOOLBAR_DEFAULT_LABELS.search,
    searchText
  );

  const filterLabel = getGalleryFilterToolbarLabel();
  setGalleryToolbarButtonLabel(
    "filter",
    filterLabel,
    filterLabel === GALLERY_TOOLBAR_DEFAULT_LABELS.filter ? "" : filterLabel
  );

  const sortLabel = galleryState.sort === "default"
    ? GALLERY_TOOLBAR_DEFAULT_LABELS.sort
    : GALLERY_SORT_LABELS[galleryState.sort] || GALLERY_TOOLBAR_DEFAULT_LABELS.sort;
  setGalleryToolbarButtonLabel(
    "sort",
    sortLabel,
    sortLabel === GALLERY_TOOLBAR_DEFAULT_LABELS.sort ? "" : sortLabel
  );
}

function setGalleryToolbarButtonLabel(action, label, ariaDetail = "") {
  const button = document.querySelector(`[data-gallery-action="${action}"]`);
  const textEl = button?.querySelector(".gallery-toolbar__text");
  if (!button || !textEl) return;

  const fallback = GALLERY_TOOLBAR_DEFAULT_LABELS[action] || "";
  const displayLabel = label || fallback;
  const ariaBase = GALLERY_TOOLBAR_ARIA_LABELS[action] || fallback || displayLabel;

  textEl.textContent = displayLabel;
  button.title = displayLabel;
  button.setAttribute("aria-label", ariaDetail ? `${ariaBase}：${ariaDetail}` : ariaBase);
}

function getGalleryFilterToolbarLabel() {
  const labels = [];

  if (galleryState.source !== "all") {
    labels.push(GALLERY_SOURCE_LABELS[galleryState.source] || galleryState.source);
  }

  if (galleryState.category !== "all") {
    labels.push(GALLERY_CATEGORY_LABELS[galleryState.category] || galleryState.category);
  }

  galleryState.tags.forEach((tag) => {
    const label = GALLERY_TAG_LABELS[tag] || tag;
    if (!labels.includes(label)) labels.push(label);
  });

  return formatGalleryToolbarSelection(labels) || GALLERY_TOOLBAR_DEFAULT_LABELS.filter;
}

function formatGalleryToolbarSelection(labels) {
  const cleanLabels = labels.map((label) => String(label || "").trim()).filter(Boolean);

  if (cleanLabels.length <= 2) {
    return cleanLabels.join("、");
  }

  return `${cleanLabels[0]} +${cleanLabels.length - 1}`;
}

function getGalleryAvailableTags() {
  const source = galleryState.category === "all"
    ? galleryRuntime.images
    : galleryRuntime.images.filter((item) => item.category === galleryState.category);
  const tagSet = new Set();

  source.forEach((item) => {
    getItemTags(item).forEach((tag) => tagSet.add(tag));
  });

  return Array.from(tagSet);
}

// 来源筛选：只有统一图片索引（含多个来源）时才显示
function renderGallerySourceChips() {
  const sourceList = document.querySelector("[data-gallery-source-list]");
  if (!sourceList) return;

  const sources = Array.from(new Set(galleryRuntime.images.map((item) => item.source).filter(Boolean)));
  const group = sourceList.closest(".gallery-filter-panel__group");
  if (group) group.hidden = sources.length < 2;
  if (sources.length < 2) {
    sourceList.innerHTML = "";
    return;
  }

  sourceList.innerHTML = ["all", ...sources]
    .map((source) => {
      const activeClass = galleryState.source === source ? " is-active" : "";
      const label = source === "all" ? "全部" : GALLERY_SOURCE_LABELS[source] || source;
      return `<button class="gallery-chip${activeClass}" type="button" data-source="${escapeHTML(source)}">${escapeHTML(label)}</button>`;
    })
    .join("");
}

function renderGalleryTagChips() {
  const tagList = document.querySelector("[data-gallery-tag-list]");
  if (!tagList) return;

  const tags = getGalleryAvailableTags();

  if (!tags.length) {
    tagList.innerHTML = '<span class="gallery-filter-empty">暂无标签</span>';
    return;
  }

  tagList.innerHTML = tags
    .map((tag) => {
      const activeClass = galleryState.tags.includes(tag) ? " is-active" : "";
      const label = GALLERY_TAG_LABELS[tag] || tag;

      return `
        <button class="gallery-chip${activeClass}" type="button" data-tag="${escapeHTML(tag)}">
          ${escapeHTML(label)}
        </button>
      `;
    })
    .join("");
}

function renderGallery() {
  const { grid } = galleryRuntime.refs;
  if (!grid) return;

  galleryRuntime.visibleImages = getFilteredImages(galleryRuntime.images);

  if (!galleryRuntime.visibleImages.length) {
    showEmptyState();
    return;
  }

  grid.classList.remove("is-empty");
  grid.innerHTML = galleryRuntime.visibleImages.map((item, index) => {
    const title = item.title || filenameFromSrc(item.src) || "未命名图片";
    const category = GALLERY_CATEGORY_LABELS[item.category] || item.category || "未分类";
    const date = formatDisplayDate(item.updatedAt || item.date);
    const width = Number(item.width) || 0;
    const height = Number(item.height) || 0;
    const ratioStyle = width > 0 && height > 0
      ? ` style="--gallery-item-ratio: ${width} / ${height};"`
      : "";
    const sizeAttrs = width > 0 && height > 0
      ? ` width="${width}" height="${height}"`
      : "";

    return `
      <article
        class="gallery-item"
        role="button"
        tabindex="0"
        data-gallery-index="${index}"
        aria-label="打开 ${escapeHTML(title)}"
        ${ratioStyle}
      >
        <img src="${escapeHTML(item.thumb || item.src)}" alt="${escapeHTML(title)}"${sizeAttrs} loading="${index < 12 ? "eager" : "lazy"}" decoding="async">
        <div class="gallery-item__overlay">
          <p>${escapeHTML(date)} · ${escapeHTML(category)}</p>
        </div>
      </article>
    `;
  }).join("");
}

function getFilteredImages(images) {
  const keyword = galleryState.search.trim().toLowerCase();
  let data = [...images];

  if (galleryState.source !== "all") {
    data = data.filter((item) => item.source === galleryState.source);
  }

  if (galleryState.category !== "all") {
    data = data.filter((item) => item.category === galleryState.category);
  }

  if (galleryState.tags.length) {
    data = data.filter((item) => {
      const itemTags = getItemTags(item);
      return galleryState.tags.every((tag) => {
        const label = GALLERY_TAG_LABELS[tag] || tag;
        return itemTags.includes(tag) || itemTags.includes(label);
      });
    });
  }

  if (keyword) {
    data = data.filter((item) => getSearchText(item).includes(keyword));
  }

  return sortGalleryItems(data);
}

function sortGalleryItems(items) {
  const data = [...items];

  switch (galleryState.sort) {
    case "random":
      return data.sort(() => Math.random() - 0.5);

    case "time-asc":
      return data.sort((a, b) => compareGalleryTime(a, b, "asc") || getOrder(a) - getOrder(b));

    case "time-desc":
      return data.sort((a, b) => compareGalleryTime(a, b, "desc") || getOrder(a) - getOrder(b));

    case "default":
    default:
      return data.sort((a, b) => getOrder(a) - getOrder(b));
  }
}

function compareGalleryTime(a, b, direction) {
  const timeA = getDateTime(a);
  const timeB = getDateTime(b);

  if (!timeA && !timeB) return 0;
  if (!timeA) return 1;
  if (!timeB) return -1;

  return direction === "asc" ? timeA - timeB : timeB - timeA;
}

function openLightbox(index) {
  if (!galleryRuntime.visibleImages[index]) return;
  galleryRuntime.currentLightboxIndex = index;
  galleryRuntime.previousFocus = document.activeElement instanceof HTMLElement
    ? document.activeElement
    : null;

  updateLightbox();
  galleryRuntime.refs.lightbox.hidden = false;
  document.documentElement.classList.add("is-modal-open");
  galleryRuntime.refs.lightbox.querySelector("[data-lightbox-close]")?.focus({ preventScroll: true });
}

function closeLightbox() {
  const { lightbox, lightboxImg } = galleryRuntime.refs;
  if (!lightbox || lightbox.hidden) return;

  lightbox.hidden = true;
  if (lightboxImg) {
    lightboxImg.src = "";
    lightboxImg.alt = "";
  }
  document.documentElement.classList.remove("is-modal-open");

  if (galleryRuntime.previousFocus && document.contains(galleryRuntime.previousFocus)) {
    galleryRuntime.previousFocus.focus({ preventScroll: true });
  }
}

function updateLightbox() {
  const item = galleryRuntime.visibleImages[galleryRuntime.currentLightboxIndex];
  const refs = galleryRuntime.refs;
  if (!item || !refs.lightboxImg) return;

  const title = item.title || filenameFromSrc(item.src) || "未命名图片";
  const category = GALLERY_CATEGORY_LABELS[item.category] || item.category || "未分类";
  const date = formatDisplayDate(item.updatedAt || item.date) || "暂无记录";
  const tags = getItemTags(item);
  const note = getItemNote(item) || "暂无备注";

  refs.lightboxImg.src = item.src;
  refs.lightboxImg.alt = title;
  if (refs.lightboxTitle) refs.lightboxTitle.textContent = title;
  if (refs.lightboxDate) refs.lightboxDate.textContent = date;
  if (refs.lightboxCategory) refs.lightboxCategory.textContent = category;
  if (refs.lightboxNote) refs.lightboxNote.textContent = note;
  if (refs.currentIndexEl) refs.currentIndexEl.textContent = String(galleryRuntime.currentLightboxIndex + 1);
  if (refs.totalCountEl) refs.totalCountEl.textContent = String(galleryRuntime.visibleImages.length);

  if (refs.lightboxSource) {
    const source = GALLERY_SOURCE_LABELS[item.source] || "";
    const links = (Array.isArray(item.refs) ? item.refs : [])
      .filter((ref) => ref && ref.title)
      .map((ref) => ref.href
        ? `<a href="${escapeHTML(ref.href)}">${escapeHTML(ref.title)}</a>`
        : `<span>${escapeHTML(ref.title)}</span>`);
    refs.lightboxSource.innerHTML = [source ? escapeHTML(source) : "", links.join("、")]
      .filter(Boolean).join(" · ") || "画廊";
  }

  if (refs.lightboxTags) {
    refs.lightboxTags.innerHTML = tags.length
      ? tags.map((tag) => `<span>${escapeHTML(GALLERY_TAG_LABELS[tag] || tag)}</span>`).join("")
      : '<span class="gallery-info-empty">暂无标签</span>';
  }
}

function showEmptyState() {
  const { grid } = galleryRuntime.refs;
  if (!grid) return;

  // 画廊本身没有图片时显示整理中；有图片但筛选 / 搜索无结果时提示换条件
  const [title, text] = galleryRuntime.images.length
    ? ["没有找到匹配的收藏", "换一个分类、标签或关键词再试试。"]
    : ["画廊正在整理中", "新的图片将在这里展示。"];

  grid.classList.add("is-empty");
  grid.innerHTML = `
    <div class="gallery-empty">
      <strong>${title}</strong>
      <span>${text}</span>
    </div>
  `;
}

function showPrev() {
  if (!galleryRuntime.visibleImages.length) return;
  galleryRuntime.currentLightboxIndex =
    (galleryRuntime.currentLightboxIndex - 1 + galleryRuntime.visibleImages.length) %
    galleryRuntime.visibleImages.length;
  updateLightbox();
}

function showNext() {
  if (!galleryRuntime.visibleImages.length) return;
  galleryRuntime.currentLightboxIndex =
    (galleryRuntime.currentLightboxIndex + 1) % galleryRuntime.visibleImages.length;
  updateLightbox();
}

function handleLightboxKeydown(event) {
  const { lightbox } = galleryRuntime.refs;
  if (!lightbox || lightbox.hidden) return;

  if (event.key === "Escape") {
    event.preventDefault();
    closeLightbox();
  } else if (event.key === "ArrowLeft") {
    event.preventDefault();
    showPrev();
  } else if (event.key === "ArrowRight") {
    event.preventDefault();
    showNext();
  }
}

function getItemTags(item) {
  return Array.isArray(item.tags)
    ? item.tags.map((tag) => String(tag).trim()).filter(Boolean)
    : [];
}

function getSearchText(item) {
  const category = GALLERY_CATEGORY_LABELS[item.category] || item.category || "";
  const tags = getItemTags(item)
    .flatMap((tag) => [tag, GALLERY_TAG_LABELS[tag] || ""])
    .filter(Boolean);

  const refTitles = (Array.isArray(item.refs) ? item.refs : []).map((ref) => ref && ref.title);

  return [
    item.title,
    item.album,
    ...refTitles,
    getItemNote(item),
    item.src,
    category,
    ...tags,
  ].join(" ").toLowerCase();
}

function getDateTime(item) {
  const time = new Date(item.updatedAt || item.date || 0).getTime();
  return Number.isNaN(time) ? 0 : time;
}

function getItemNote(item) {
  return item.note || item.remark || item["备注"] || "";
}

function getOrder(item) {
  return Number(item.order) || 0;
}

function formatDisplayDate(dateString) {
  const text = String(dateString || "").trim();
  const match = text.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (!match) return "暂无记录";
  return `${match[1]}.${match[2]}.${match[3]}`;
}

function filenameFromSrc(src) {
  const filename = String(src || "").split(/[?#]/)[0].split("/").filter(Boolean).pop() || "";
  return filename.replace(/\.[^.]+$/, "");
}

function escapeHTML(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}
