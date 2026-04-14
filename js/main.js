document.addEventListener("DOMContentLoaded", () => {
  const main = document.getElementById("main-content");
  const navLinks = document.querySelectorAll("nav a");

  if (!main) return;

  // 保存首页原始内容，回主页时直接恢复
  const homeContent = main.innerHTML;

  // 页面键名和文件名映射
  const pageMap = {
    home: "index.html",
    gallery: "gallery.html",
    anime: "anime.html",
    notes: "notes.html",
    diary: "diary.html",
    comment: "comment.html",
    about: "about.html"
  };

  // 文件名反查键名
  const fileToPageKey = {
    "index.html": "home",
    "gallery.html": "gallery",
    "anime.html": "anime",
    "notes.html": "notes",
    "diary.html": "diary",
    "comment.html": "comment",
    "about.html": "about"
  };

  function getPageKeyFromHref(href) {
    if (!href) return null;

    // 处理 index.html?page=xxx
    if (href.includes("index.html?page=")) {
      const page = href.split("page=")[1];
      return page || "home";
    }

    // 处理 index.html
    if (href === "index.html") {
      return "home";
    }

    // 处理 gallery.html / anime.html 这种
    const fileName = href.split("/").pop();
    return fileToPageKey[fileName] || null;
  }

  function getCurrentPageKeyFromUrl() {
    const params = new URLSearchParams(window.location.search);
    const page = params.get("page");
    if (page) return page;

    const fileName = window.location.pathname.split("/").pop() || "index.html";
    return fileToPageKey[fileName] || "home";
  }

  function updateHighlight(pageKey) {
    navLinks.forEach(link => {
      const linkPageKey = getPageKeyFromHref(link.getAttribute("href"));
      link.classList.toggle("active", linkPageKey === pageKey);
    });
  }

  function setUrl(pageKey, addHistory = true) {
    const newUrl =
      pageKey === "home"
        ? "index.html"
        : `index.html?page=${pageKey}`;

    if (addHistory) {
      history.pushState({ page: pageKey }, "", newUrl);
    } else {
      history.replaceState({ page: pageKey }, "", newUrl);
    }
  }

  function loadPage(pageKey, addHistory = true) {
    if (!pageKey) return;

    // 回主页：直接恢复原始 main 内容
    if (pageKey === "home") {
      main.innerHTML = homeContent;
      updateHighlight("home");
      setUrl("home", addHistory);
      return;
    }

    const file = pageMap[pageKey];
    if (!file) return;

    fetch(file)
      .then(res => {
        if (!res.ok) {
          throw new Error(`无法加载 ${file}`);
        }
        return res.text();
      })
      .then(html => {
        const parser = new DOMParser();
        const doc = parser.parseFromString(html, "text/html");
        const newMain = doc.querySelector("#main-content");

        if (!newMain) {
          throw new Error(`${file} 中没有找到 #main-content`);
        }

        main.innerHTML = newMain.innerHTML;
        updateHighlight(pageKey);
        setUrl(pageKey, addHistory);
      })
      .catch(err => {
        console.error("页面切换失败：", err);
      });
  }

  // 拦截导航点击
  navLinks.forEach(link => {
    link.addEventListener("click", e => {
      const href = link.getAttribute("href");
      const pageKey = getPageKeyFromHref(href);

      // 只有站内这些页面才拦截
      if (pageKey) {
        e.preventDefault();
        loadPage(pageKey, true);
      }
    });
  });

  // 浏览器前进后退
  window.addEventListener("popstate", e => {
    const pageKey = (e.state && e.state.page) || getCurrentPageKeyFromUrl();
    loadPage(pageKey, false);
  });

  // 首次进入 index.html?page=xxx 时自动加载对应内容
  const initialPage = getCurrentPageKeyFromUrl();
  updateHighlight(initialPage);

  if (initialPage !== "home") {
    loadPage(initialPage, false);
  } else {
    history.replaceState({ page: "home" }, "", "index.html");
  }
});