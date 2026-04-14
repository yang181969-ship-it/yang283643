document.addEventListener("DOMContentLoaded", () => {
  const main = document.getElementById("main-content");
  const navLinks = document.querySelectorAll("nav a");

  if (!main) return;

  // 保存首页原始内容
  const homeContent = main.innerHTML;

  // page 参数到实际文件的映射
  const pageMap = {
    home: null,
    gallery: "html/gallery.html",
    anime: "html/anime.html",
    notes: "html/notes.html",
    diary: "html/diary.html",
    comment: "html/comment.html",
    about: "html/about.html",
  };

  function getPageFromHref(href) {
    if (!href) return null;

    if (href === "index.html" || href === "./" || href === "/") {
      return "home";
    }

    if (href.startsWith("index.html?page=")) {
      const params = new URLSearchParams(href.split("?")[1]);
      return params.get("page") || "home";
    }

    return null;
  }

  function getCurrentPageFromUrl() {
    const params = new URLSearchParams(window.location.search);
    return params.get("page") || "home";
  }

  function updateHighlight(page) {
    navLinks.forEach((link) => {
      const href = link.getAttribute("href");
      const linkPage = getPageFromHref(href);
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

  function runPageInit(page) {
    if (page === "comment" && typeof initCommentPage === "function") {
      initCommentPage();
    }
  }

  function loadPage(page, push = true) {
    if (!pageMap.hasOwnProperty(page)) return;

    if (page === "home") {
      main.innerHTML = homeContent;
      updateHighlight("home");
      setUrl("home", push);
      return;
    }

    const file = pageMap[page];

    fetch(file)
      .then((res) => {
        if (!res.ok) {
          throw new Error(`无法加载 ${file}`);
        }
        return res.text();
      })
      .then((html) => {
        const doc = new DOMParser().parseFromString(html, "text/html");
        const newMain = doc.querySelector("#main-content");

        if (!newMain) {
          throw new Error(`${file} 中没有找到 #main-content`);
        }

        main.innerHTML = newMain.innerHTML;
        updateHighlight(page);
        setUrl(page, push);
        runPageInit(page);
      })
      .catch((err) => {
        console.error("页面切换失败：", err);
      });
  }

  // 拦截左侧导航点击
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

  // 浏览器前进/后退
  window.addEventListener("popstate", (e) => {
    const page = (e.state && e.state.page) || getCurrentPageFromUrl();
    loadPage(page, false);
  });

  // 首次进入页面时，根据 URL 自动加载
  const initialPage = getCurrentPageFromUrl();
  updateHighlight(initialPage);

  if (initialPage !== "home") {
    loadPage(initialPage, false);
  } else {
    history.replaceState({ page: "home" }, "", "index.html");
  }
});