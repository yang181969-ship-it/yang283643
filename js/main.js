document.addEventListener("DOMContentLoaded", () => {
  const main = document.getElementById("main-content");
  const navLinks = document.querySelectorAll("nav a");

  if (!main) return;

  const homeContent = main.innerHTML;

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

  /* =========================
     页面初始化（重点改动）
  ========================= */
  function runPageInit(page) {

    if (page === "comment" && typeof initCommentPage === "function") {
      initCommentPage();
    }

    if (page === "anime" && typeof initAnimePage === "function") {
      initAnimePage();
    }

    if (page === "gallery" && typeof initGalleryPage === "function") {
      initGalleryPage();
    }

    /* ===== 新增：notes 页面 ===== */
    if (page === "notes") {
      initNotesPage();
    }

    /* ===== about 页面暂时无需逻辑 ===== */
  }

  /* =========================
     Notes 初始化
  ========================= */
  function initNotesPage() {

    /* KaTeX 渲染 */
    if (window.renderMathInElement) {
      renderMathInElement(document.body, {
        delimiters: [
          { left: "$$", right: "$$", display: true },
          { left: "\\(", right: "\\)", display: false },
          { left: "\\[", right: "\\]", display: true }
        ],
        throwOnError: false
      });
    }

    /* 分类切换 */
    const categories = document.querySelectorAll(".notes-category");
    const panels = document.querySelectorAll(".notes-panel");

    categories.forEach(btn => {
      btn.addEventListener("click", () => {
        categories.forEach(item => item.classList.remove("active"));
        panels.forEach(panel => panel.classList.remove("active"));

        btn.classList.add("active");

        const target = document.getElementById(btn.dataset.target);
        if (target) target.classList.add("active");
      });
    });

    /* p5.js 动画 */
    setTimeout(() => {
      if (!window.p5 || !document.getElementById("notes-p5-demo")) return;

      new p5((p) => {
        let t = 0;

        p.setup = function () {
          const host = document.getElementById("notes-p5-demo");
          const canvas = p.createCanvas(host.clientWidth, 220);
          canvas.parent("notes-p5-demo");
        };

        p.draw = function () {
          p.clear();
          p.background(248, 250, 252);

          p.stroke(120, 120, 180);
          p.strokeWeight(2);
          p.noFill();

          p.beginShape();
          for (let x = 0; x <= p.width; x += 8) {
            const y = 110 + 36 * Math.sin(x * 0.03 + t);
            p.vertex(x, y);
          }
          p.endShape();

          t += 0.04;
        };

        p.windowResized = function () {
          const host = document.getElementById("notes-p5-demo");
          if (!host) return;
          p.resizeCanvas(host.clientWidth, 220);
        };
      });

    }, 300);
  }

  /* ========================= */

  function loadPage(page, push = true) {
    if (!pageMap.hasOwnProperty(page)) return;

    if (page === "home") {
      main.innerHTML = homeContent;
      updateHighlight("home");
      setUrl("home", push);

      requestAnimationFrame(() => {
        runPageInit("home");
      });
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

        requestAnimationFrame(() => {
          runPageInit(page);
        });
      })
      .catch((err) => {
        console.error("页面切换失败：", err);
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
    const page = (e.state && e.state.page) || getCurrentPageFromUrl();
    loadPage(page, false);
  });

  const initialPage = getCurrentPageFromUrl();
  updateHighlight(initialPage);

  if (initialPage !== "home") {
    loadPage(initialPage, false);
  } else {
    history.replaceState({ page: "home" }, "", "index.html");
    requestAnimationFrame(() => {
      runPageInit("home");
    });
  }
});

/* ===== 返回顶部按钮 ===== */
function initBackToTop() {
  const btn = document.getElementById("back-to-top");
  const scrollContainer = document.querySelector(".content-scroll");

  if (!btn || !scrollContainer) return;

  scrollContainer.addEventListener("scroll", () => {
    if (scrollContainer.scrollTop > 300) {
      btn.classList.add("show");
    } else {
      btn.classList.remove("show");
    }
  });

  btn.addEventListener("click", () => {
    scrollContainer.scrollTo({
      top: 0,
      behavior: "smooth"
    });
  });
}

document.addEventListener("DOMContentLoaded", initBackToTop);