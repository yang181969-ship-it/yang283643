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
    update: "html/update.html",
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

// ===== 手机端导航点击后自动滚动到可视区域中间（带边界限制） =====
function centerNavLink(link) {
  const nav = document.querySelector("nav");
  if (!nav || !link) return;

  // 只在手机/窄屏下启用
  if (window.innerWidth > 900) return;

  const navRect = nav.getBoundingClientRect();
  const linkRect = link.getBoundingClientRect();

  // 目标：让 link 尽量出现在容器中间
  let targetLeft =
    nav.scrollLeft +
    (linkRect.left - navRect.left) -
    (nav.clientWidth / 2) +
    (link.clientWidth / 2);

  // 边界限制：靠左或靠右时不强行居中
  const maxScrollLeft = nav.scrollWidth - nav.clientWidth;
  targetLeft = Math.max(0, Math.min(targetLeft, maxScrollLeft));

  nav.scrollTo({
    left: targetLeft,
    behavior: "smooth"
  });
}

// 给所有导航链接绑定点击事件
function bindNavAutoCenter() {
  const navLinks = document.querySelectorAll("nav .nav-link");

  navLinks.forEach(link => {
    link.addEventListener("click", function () {
      centerNavLink(this);
    });
  });
}

// 页面加载后，让当前 active 项自动进入可视区域
function centerActiveNavLink() {
  const activeLink = document.querySelector("nav .nav-link.active");
  if (!activeLink) return;

  setTimeout(() => {
    centerNavLink(activeLink);
  }, 100);
}

document.addEventListener("DOMContentLoaded", () => {
  bindNavAutoCenter();
  centerActiveNavLink();
});