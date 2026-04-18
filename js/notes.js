/* ===== 动态加载 KaTeX 和 p5.js（只在笔记页面需要时才加载） ===== */
function loadScript(src) {
  return new Promise((resolve, reject) => {
    if (document.querySelector(`script[src="${src}"]`)) {
      resolve();
      return;
    }
    const s = document.createElement("script");
    s.src = src;
    s.onload = resolve;
    s.onerror = reject;
    document.head.appendChild(s);
  });
}

// KaTeX 加载 Promise，全局只加载一次
let _katexPromise = null;

function loadKaTeX() {
  if (_katexPromise) return _katexPromise;
  _katexPromise = loadScript("https://cdn.bootcdn.net/ajax/libs/KaTeX/0.16.9/katex.min.js")
    .then(() => loadScript("https://cdn.bootcdn.net/ajax/libs/KaTeX/0.16.9/contrib/auto-render.min.js"));
  return _katexPromise;
}

function loadP5() {
  return loadScript("https://cdn.bootcdn.net/ajax/libs/p5.js/1.11.3/p5.min.js");
}

// ===== 提前预加载 KaTeX：notes.js 一被加载就立即开始请求，不等用户触发 =====
loadKaTeX().catch(() => {});

/* ===== 核心：只渲染尚未处理过的卡片 ===== */
function renderMathInCards(cards) {
  const unrendered = [...cards].filter(
    (card) => !card.dataset.mathRendered && !card.classList.contains("is-hidden")
  );

  if (!unrendered.length) return;

  function doRender() {
    unrendered.forEach((card) => {
      renderMathInElement(card, {
        delimiters: [
          { left: "$$", right: "$$", display: true },
          { left: "$", right: "$", display: false },
          { left: "\\(", right: "\\)", display: false },
          { left: "\\[", right: "\\]", display: true }
        ],
        throwOnError: false
      });
      // 标记为已渲染，切换分类时不重复处理
      card.dataset.mathRendered = "1";
    });
  }

  if (window.renderMathInElement) {
    requestAnimationFrame(doRender);
  } else {
    loadKaTeX()
      .then(() => requestAnimationFrame(doRender))
      .catch(() => console.warn("KaTeX 加载失败"));
  }
}

/* ===== 页面初始化 ===== */
function initNotesPage() {
  const notesPage = document.querySelector(".notes-page");
  if (!notesPage) return;

  const groupToggles = notesPage.querySelectorAll(".notes-group-toggle");
  const categoryButtons = notesPage.querySelectorAll(".notes-category");
  const noteCards = notesPage.querySelectorAll(".note-card");
  const emptyState = notesPage.querySelector("#notes-empty");

  if (!noteCards.length) return;

  function clearActiveStates() {
    groupToggles.forEach((btn) => btn.classList.remove("active"));
    categoryButtons.forEach((btn) => btn.classList.remove("active"));
  }

  function filterAllNotes() {
    noteCards.forEach((card) => card.classList.remove("is-hidden"));
    if (emptyState) emptyState.hidden = true;
    renderMathInCards(noteCards);
  }

  function filterNotesByCategory(category) {
    let visibleCount = 0;
    const nowVisible = [];

    noteCards.forEach((card) => {
      if (card.dataset.category === category) {
        card.classList.remove("is-hidden");
        nowVisible.push(card);
        visibleCount++;
      } else {
        card.classList.add("is-hidden");
      }
    });

    if (emptyState) emptyState.hidden = visibleCount !== 0;
    renderMathInCards(nowVisible);
  }

  groupToggles.forEach((toggle) => {
    toggle.addEventListener("click", () => {
      const parentGroup = toggle.closest(".notes-group");
      const mode = toggle.dataset.mode;
      const groupName = toggle.dataset.group;

      if (mode === "all") {
        clearActiveStates();
        toggle.classList.add("active");
        notesPage.querySelectorAll(".notes-group").forEach((group) => {
          if (group.querySelector('[data-mode="all"]')) {
            group.classList.add("is-open");
          } else {
            group.classList.remove("is-open");
          }
        });
        filterAllNotes();
        return;
      }

      if (groupName) {
        const isOpen = parentGroup.classList.contains("is-open");
        notesPage.querySelectorAll(".notes-group").forEach((group) => {
          if (group !== parentGroup && !group.querySelector('[data-mode="all"]')) {
            group.classList.remove("is-open");
          }
        });
        parentGroup.classList.toggle("is-open", !isOpen);
      }
    });
  });

  categoryButtons.forEach((button) => {
    button.addEventListener("click", () => {
      clearActiveStates();
      button.classList.add("active");

      const parentGroup = button.closest(".notes-group");
      if (parentGroup) {
        notesPage.querySelectorAll(".notes-group").forEach((group) => {
          if (group !== parentGroup && !group.querySelector('[data-mode="all"]')) {
            group.classList.remove("is-open");
          }
        });
        parentGroup.classList.add("is-open");
      }

      filterNotesByCategory(button.dataset.category);
    });
  });

  const defaultOverview = notesPage.querySelector('.notes-group-toggle[data-mode="all"]');
  if (defaultOverview) {
    clearActiveStates();
    defaultOverview.classList.add("active");
    filterAllNotes();
  } else {
    renderMathInCards(noteCards);
  }

  if (notesPage.querySelector(".p5-canvas")) {
    loadP5().catch(() => console.warn("p5.js 加载失败"));
  }
}

document.addEventListener("DOMContentLoaded", initNotesPage);
window.initNotesPage = initNotesPage;