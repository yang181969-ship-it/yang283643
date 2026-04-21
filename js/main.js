document.addEventListener("DOMContentLoaded", () => {
  const main = document.getElementById("main-content");
  const navLinks = document.querySelectorAll("nav a");

  if (!main) return;

  const homeContent = main.innerHTML;
  const pageCache = new Map();

  const pageMap = {
    home: null,
    gallery: "html/gallery.html",
    anime: "html/anime.html",
    notes: "html/notes.html",
    diary: "html/diary.html",
    update: "html/update.html",
    comment: "html/comment.html",
    about: "html/about.html",
  };

  function getPageFromHref(href) {
    if (!href) return null;
    if (href === "index.html" || href === "./" || href === "/") return "home";
    if (href.startsWith("index.html?page=")) {
      return new URLSearchParams(href.split("?")[1]).get("page") || "home";
    }
    return null;
  }

  function getCurrentPageFromUrl() {
    return new URLSearchParams(window.location.search).get("page") || "home";
  }

  function updateHighlight(page) {
    navLinks.forEach((link) => {
      const linkPage = getPageFromHref(link.getAttribute("href"));
      link.classList.toggle("active", linkPage === page);
    });
  }

  function setUrl(page, push = true) {
    const url = page === "home" ? "index.html" : `index.html?page=${page}`;
    if (push) {
      history.pushState({ page }, "", url);
    } else {
      history.replaceState({ page }, "", url);
    }
  }

  function renderMathSafe() {
    if (!window.renderMathInElement) return;
    renderMathInElement(document.getElementById("main-content"), {
      delimiters: [
        { left: "$$", right: "$$", display: true },
        { left: "$", right: "$", display: false },
        { left: "\\(", right: "\\)", display: false },
        { left: "\\[", right: "\\]", display: true }
      ],
      throwOnError: false
    });
  }

  function runPageInit(page) {
    if (page === "comment" && typeof initCommentPage === "function") initCommentPage();
    if (page === "anime"   && typeof initAnimePage   === "function") initAnimePage();
    if (page === "gallery" && typeof initGalleryPage === "function") initGalleryPage();
    if (page === "notes"   && typeof window.initNotesPage === "function") window.initNotesPage();
  }

  function afterPageLoad(page, push) {
    updateHighlight(page);
    setUrl(page, push);
    requestAnimationFrame(() => {
      runPageInit(page);
      if (page === "notes") setTimeout(renderMathSafe, 0);
    });
  }

  function setLoading(isLoading) {
    main.style.opacity = isLoading ? "0.4" : "1";
    main.style.pointerEvents = isLoading ? "none" : "";
  }

  function loadPage(page, push = true) {
    if (!Object.prototype.hasOwnProperty.call(pageMap, page)) return;

    if (page === "home") {
      main.innerHTML = homeContent;
      afterPageLoad("home", push);
      return;
    }

    if (pageCache.has(page)) {
      main.innerHTML = pageCache.get(page);
      afterPageLoad(page, push);
      return;
    }

    const file = pageMap[page];
    setLoading(true);

    fetch(file)
      .then((res) => {
        if (!res.ok) throw new Error(`无法加载 ${file}`);
        return res.text();
      })
      .then((html) => {
        const doc = new DOMParser().parseFromString(html, "text/html");
        const newMain = doc.querySelector("#main-content");
        if (!newMain) throw new Error(`${file} 中没有找到 #main-content`);

        const content = newMain.innerHTML;
        pageCache.set(page, content);
        main.innerHTML = content;
        afterPageLoad(page, push);
      })
      .catch((err) => {
        console.error("页面切换失败：", err);
        main.innerHTML = `<div style="padding:40px;text-align:center;color:#ef4444;">
          <p>页面加载失败，请刷新后重试。</p>
        </div>`;
      })
      .finally(() => {
        setLoading(false);
      });
  }

  // 暴露给 search.js 使用
  window._loadPage = loadPage;

  navLinks.forEach((link) => {
    link.addEventListener("click", (e) => {
      const href = link.getAttribute("href");
      const page = getPageFromHref(href);
      if (page && href.startsWith("index.html")) {
        e.preventDefault();
        loadPage(page, true);
      }
    });
  });

  window.addEventListener("popstate", (e) => {
    const state = e.state || {};

    // 搜索结果页回退
    if (state.search) {
      const kw = new URLSearchParams(window.location.search).get("search");
      if (kw && typeof runSearch === "function") {
        runSearch(kw).then(results => renderSearchResults(kw, results));
        document.getElementById("search-input").value = kw;
      }
      return;
    }

    const page = state.page || getCurrentPageFromUrl();

    // 如果 state 里有笔记详情信息，说明是从笔记详情回退/前进
    // notes.js 的 renderDetailView 已经通过 pushState 管理这段历史，
    // 此处只需要在"回到列表"时重新渲染列表即可。
    if (page === "notes" && !state.note) {
      // 回到笔记列表：如果当前 DOM 不是列表（缺少 #notes-content），则重新加载
      if (!document.getElementById("notes-content")) {
        // 优先从缓存还原，避免重复 fetch
        if (pageCache.has("notes")) {
          main.innerHTML = pageCache.get("notes");
          updateHighlight("notes");
          requestAnimationFrame(() => {
            if (typeof window.initNotesPage === "function") window.initNotesPage();
          });
        } else {
          loadPage("notes", false);
        }
      }
      updateHighlight("notes");
      return;
    }

    loadPage(page, false);
  });

  const initialPage = getCurrentPageFromUrl();
  updateHighlight(initialPage);

  if (initialPage !== "home") {
    loadPage(initialPage, false);
  } else {
    history.replaceState({ page: "home" }, "", "index.html");
    requestAnimationFrame(() => runPageInit("home"));
  }
});

/* ===== 浮动按钮：返回顶部 + 返回上一页 ===== */
function initFloatingBtns() {
  const topBtn  = document.getElementById("back-to-top");
  const prevBtn = document.getElementById("back-to-prev");
  const scrollContainer = document.querySelector(".content-scroll");
  if (!scrollContainer) return;

  // 滚动时同时控制两个按钮的显隐
  scrollContainer.addEventListener("scroll", () => {
    const show = scrollContainer.scrollTop > 300;
    topBtn?.classList.toggle("show", show);
    prevBtn?.classList.toggle("show", show);
  });

  // 返回顶部
  topBtn?.addEventListener("click", () => {
    scrollContainer.scrollTo({ top: 0, behavior: "smooth" });
  });

  // 返回上一页：走浏览器历史
  prevBtn?.addEventListener("click", () => {
    history.back();
  });
}

document.addEventListener("DOMContentLoaded", initFloatingBtns);

/* ===== 导航按钮自动居中（移动端横向滚动时）===== */
function initNavAutoCenter() {
  const nav = document.querySelector("nav");
  if (!nav) return;

  function centerActive() {
    // 仅在 nav 确实可横向滚动时执行（桌面端 flex-direction: column 不会触发）
    if (nav.scrollWidth <= nav.clientWidth + 1) return;

    const active = nav.querySelector("a.active");
    if (!active) return;

    // 计算目标滚动位置：让 active 按钮水平居中
    const navRect    = nav.getBoundingClientRect();
    const activeRect = active.getBoundingClientRect();
    const offset     = (activeRect.left - navRect.left) + activeRect.width / 2 - nav.clientWidth / 2;
    const target     = nav.scrollLeft + offset;

    nav.scrollTo({ left: target, behavior: "smooth" });
    // 浏览器会自动把 target 夹到 [0, scrollWidth-clientWidth]，
    // 所以靠边缘的按钮不会强行居中，符合需求。
  }

  // 监听 class 变化：active 切换时重新居中
  const observer = new MutationObserver((mutations) => {
    for (const m of mutations) {
      if (m.type === "attributes" && m.attributeName === "class") {
        centerActive();
        return;
      }
    }
  });
  nav.querySelectorAll("a").forEach(a => {
    observer.observe(a, { attributes: true, attributeFilter: ["class"] });
  });

  // 首次加载也执行一次（等布局稳定）
  requestAnimationFrame(() => setTimeout(centerActive, 60));
  // 窗口尺寸变化时也重新居中
  window.addEventListener("resize", () => setTimeout(centerActive, 60));
}

document.addEventListener("DOMContentLoaded", initNavAutoCenter);

/* ===== 搜索框折叠/展开（桌面端+手机端统一）===== */
function initMobileSearch() {
  const toggleBtn = document.getElementById("search-toggle");
  const searchBar = document.querySelector(".search-bar");
  const backdrop  = document.getElementById("search-backdrop");
  const input     = document.getElementById("search-input");
  if (!toggleBtn || !searchBar) return;

  function open() {
    searchBar.classList.add("is-open");
    toggleBtn.classList.add("is-open");
    backdrop?.classList.add("is-open");
    setTimeout(() => input?.focus(), 50);
  }

  function close() {
    searchBar.classList.remove("is-open");
    toggleBtn.classList.remove("is-open");
    backdrop?.classList.remove("is-open");
  }

  // 点击触发按钮：
  // - 未展开：展开
  // - 已展开 + 输入框有内容：触发搜索（模拟点击已有的 #search-btn，复用 search.js 的搜索逻辑）
  // - 已展开 + 输入框为空：关闭
  toggleBtn.addEventListener("click", (e) => {
    e.stopPropagation();
    const isOpen = searchBar.classList.contains("is-open");
    if (!isOpen) {
      open();
      return;
    }
    const kw = (input?.value || "").trim();
    if (kw) {
      // 复用 search.js 绑定在 #search-btn 上的逻辑
      document.getElementById("search-btn")?.click();
      // 搜索完成后自动关闭
      setTimeout(close, 0);
    } else {
      close();
    }
  });

  // 点击搜索框内部不关闭
  searchBar.addEventListener("click", (e) => e.stopPropagation());

  // 点击页面其他区域关闭
  document.addEventListener("click", () => {
    if (searchBar.classList.contains("is-open")) close();
  });

  // 遮罩点击关闭（手机端）
  backdrop?.addEventListener("click", close);

  // ESC 关闭
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape") close();
  });

  // 点击搜索按钮 / 回车后关闭
  document.getElementById("search-btn")?.addEventListener("click", () => {
    if (searchBar.classList.contains("is-open")) close();
  });
  input?.addEventListener("keydown", (e) => {
    if (e.key === "Enter" && searchBar.classList.contains("is-open")) {
      setTimeout(close, 0);
    }
  });
}

document.addEventListener("DOMContentLoaded", initMobileSearch);

/* ===== 侧边栏卡片折叠（分类卡 + TOC 卡） ===== */
function initSidebarCollapse() {
  // 1. 处理已有 .is-collapsible 结构的卡片（如笔记分类卡——在 notes.html 里直接写好）
  function bindCollapseBtn(card) {
    const btn = card.querySelector(".notes-card-collapse");
    if (!btn || btn.dataset.collapseBound) return;
    btn.dataset.collapseBound = "1";
    btn.addEventListener("click", () => {
      const collapsed = card.classList.toggle("is-collapsed");
      btn.setAttribute("aria-expanded", collapsed ? "false" : "true");
    });
  }

  // 2. 自动把 .note-toc-card（JS 动态渲染出来的）包装成可折叠结构
  //    不需要修改 notes.js，也不影响桌面端视觉
  function wrapTocCard(card) {
    if (card.dataset.wrapped) return;
    card.dataset.wrapped = "1";

    const h2 = card.querySelector("h2");
    if (!h2) return;

    // 创建折叠按钮，把 h2 移进去，加 ▾
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "notes-card-collapse";
    btn.setAttribute("aria-label", "折叠目录");

    const arrow = document.createElement("span");
    arrow.className = "notes-card-arrow";
    arrow.textContent = "▾";

    // 把原 h2 包进 btn
    h2.parentNode.insertBefore(btn, h2);
    btn.appendChild(h2);
    btn.appendChild(arrow);

    // 剩下的所有内容塞进 .notes-card-body
    const body = document.createElement("div");
    body.className = "notes-card-body";
    while (btn.nextSibling) body.appendChild(btn.nextSibling);
    card.appendChild(body);

    card.classList.add("is-collapsible");

    // 手机端默认收起；桌面端默认展开
    const isMobile = window.matchMedia("(max-width: 900px)").matches;
    if (isMobile) {
      card.classList.add("is-collapsed");
      btn.setAttribute("aria-expanded", "false");
    } else {
      btn.setAttribute("aria-expanded", "true");
    }

    bindCollapseBtn(card);
  }

  // 初始绑定当前 DOM 里已有的卡片
  function scan() {
    document.querySelectorAll(".notes-sidebar-card.is-collapsible").forEach(bindCollapseBtn);
    document.querySelectorAll(".note-toc-card").forEach(wrapTocCard);

    // 手机端：笔记分类卡默认收起（notes.html 里没加 .is-collapsed，这里补上）
    if (window.matchMedia("(max-width: 900px)").matches) {
      document.querySelectorAll(".notes-sidebar-card.is-collapsible").forEach(card => {
        // 首次扫描时才自动收起；用户手动展开后不要覆盖
        if (!card.dataset.autoCollapsed) {
          card.classList.add("is-collapsed");
          card.dataset.autoCollapsed = "1";
          const btn = card.querySelector(".notes-card-collapse");
          btn?.setAttribute("aria-expanded", "false");
        }
      });
    }
  }

  scan();

  // 因为笔记详情页是动态渲染的，TOC 后出现——用 MutationObserver 监听
  const mo = new MutationObserver(() => scan());
  const root = document.getElementById("main-content");
  if (root) mo.observe(root, { childList: true, subtree: true });
}

document.addEventListener("DOMContentLoaded", initSidebarCollapse);