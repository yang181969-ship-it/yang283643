document.addEventListener("DOMContentLoaded", () => {
  const main = document.getElementById("main-content");
  const navLinks = document.querySelectorAll("nav a");

  if (!main) return;

  const homeContent = main.innerHTML;

  // ⭐ 核心：全部改成 html/路径
  const pageMap = {
    home: "index.html",
    gallery: "html/gallery.html",
    anime: "html/anime.html",
    notes: "html/notes.html",
    diary: "html/diary.html",
    comment: "html/comment.html",
    about: "html/about.html"
  };

  const fileToPageKey = {
    "index.html": "home",
    "gallery.html": "gallery",
    "anime.html": "anime",
    "notes.html": "notes",
    "diary.html": "diary",
    "comment.html": "comment",
    "about.html": "about"
  };

  function getPageFromUrl() {
    const params = new URLSearchParams(window.location.search);
    return params.get("page") || "home";
  }

  function updateHighlight(page) {
    navLinks.forEach(link => {
      const href = link.getAttribute("href");

      if (page === "home" && href === "index.html") {
        link.classList.add("active");
      } else if (href === `index.html?page=${page}`) {
        link.classList.add("active");
      } else {
        link.classList.remove("active");
      }
    });
  }

  function loadPage(page, push = true) {
    if (page === "home") {
      main.innerHTML = homeContent;
      updateHighlight("home");

      if (push) {
        history.pushState({ page }, "", "index.html");
      }
      return;
    }

    const url = pageMap[page];

    fetch(url)
      .then(res => res.text())
      .then(html => {
        const doc = new DOMParser().parseFromString(html, "text/html");
        const newMain = doc.querySelector("#main-content");

        main.innerHTML = newMain.innerHTML;
        updateHighlight(page);

        if (push) {
          history.pushState({ page }, "", `index.html?page=${page}`);
        }
      });
  }

  navLinks.forEach(link => {
    link.addEventListener("click", e => {
      const href = link.getAttribute("href");

      if (href.startsWith("index.html")) {
        e.preventDefault();
        const page = getPageFromUrlFromHref(href);
        loadPage(page);
      }
    });
  });

  function getPageFromUrlFromHref(href) {
    if (href.includes("page=")) {
      return href.split("page=")[1];
    }
    return "home";
  }

  window.addEventListener("popstate", e => {
    const page = (e.state && e.state.page) || getPageFromUrl();
    loadPage(page, false);
  });

  const initPage = getPageFromUrl();
  updateHighlight(initPage);

  if (initPage !== "home") {
    loadPage(initPage, false);
  }
});