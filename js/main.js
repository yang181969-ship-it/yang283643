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

/* ===== 返回顶部按钮 ===== */
function initBackToTop() {
  const btn = document.getElementById("back-to-top");
  const scrollContainer = document.querySelector(".content-scroll");
  if (!btn || !scrollContainer) return;

  scrollContainer.addEventListener("scroll", () => {
    btn.classList.toggle("show", scrollContainer.scrollTop > 300);
  });

  btn.addEventListener("click", () => {
    scrollContainer.scrollTo({ top: 0, behavior: "smooth" });
  });
}

document.addEventListener("DOMContentLoaded", initBackToTop);