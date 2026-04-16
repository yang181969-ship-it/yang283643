const WALINE_SERVER_URL = "https://yang283643-waline.vercel.app";

// 这里是管理员昵称白名单
const ADMIN_NAMES = ["xy-yang"];

let walineInstance = null;
let walineStyleReady = false;
let walineModulePromise = null;
let walineObserver = null;
let enhanceScheduled = false;

function initCommentPage() {
  const walineRoot = document.getElementById("waline");
  if (!walineRoot) return;

  ensureWalineStyle();

  requestAnimationFrame(() => {
    initWalineComment();
  });
}

function ensureWalineStyle() {
  if (walineStyleReady) return;

  const styleId = "waline-client-style";

  if (!document.getElementById(styleId)) {
    const link = document.createElement("link");
    link.id = styleId;
    link.rel = "stylesheet";
    link.href = "https://unpkg.com/@waline/client@v3/dist/waline.css";
    document.head.appendChild(link);
  }

  walineStyleReady = true;
}

function loadWalineModule() {
  if (!walineModulePromise) {
    walineModulePromise = import("https://unpkg.com/@waline/client@v3/dist/waline.js");
  }
  return walineModulePromise;
}

function getCurrentCommentPath() {
  return window.location.pathname + window.location.search;
}

async function initWalineComment() {
  const walineRoot = document.getElementById("waline");
  if (!walineRoot) return;

  const currentPath = getCurrentCommentPath();

  try {
    const { init } = await loadWalineModule();

    if (walineObserver) {
      walineObserver.disconnect();
      walineObserver = null;
    }

    if (walineInstance && typeof walineInstance.destroy === "function") {
      walineInstance.destroy();
    }

    walineInstance = null;
    walineRoot.innerHTML = "";
    walineRoot.classList.remove("editor-expanded");
    walineRoot.dataset.currentRating = "0";
    delete walineRoot.dataset.editorBound;
    enhanceScheduled = false;

    walineInstance = init({
      el: "#waline",
      serverURL: WALINE_SERVER_URL,
      path: currentPath,
      lang: "zh-CN",
      login: "disable",
      emoji: false,
      search: false,
      pageSize: 20,
      commentSorting: "latest",
      meta: ["nick", "mail", "link"],
      requiredMeta: ["nick"],
      wordLimit: 500,
      dark: "auto",
      reaction: false,
    });

    setTimeout(() => {
      bindWalineEditorBehavior();
      runEnhancements();
      observeWalineUpdates();
    }, 500);
  } catch (error) {
    console.error("Waline 加载失败：", error);
    walineRoot.innerHTML = `
      <div class="comment-empty">留言系统加载失败，请稍后再试。</div>
    `;
  }
}

function bindWalineEditorBehavior() {
  const root = document.getElementById("waline");
  if (!root) return;

  if (root.dataset.editorBound === "true") return;
  root.dataset.editorBound = "true";

  root.addEventListener("focusin", () => {
    root.classList.add("editor-expanded");
    ensureRatingUI();
  });

  root.addEventListener("focusout", () => {
    setTimeout(() => {
      const activeInside = root.contains(document.activeElement);
      const currentEditor = getWalineEditor(root);
      const hasText = !!getEditorText(currentEditor).trim();

      if (!activeInside && !hasText) {
        root.classList.remove("editor-expanded");
      }
    }, 120);
  });
}

function getWalineEditor(root) {
  return root.querySelector(".wl-editor");
}

function getEditorText(editor) {
  if (!editor) return "";
  if (typeof editor.value === "string") return editor.value;
  if (typeof editor.textContent === "string") return editor.textContent;
  return "";
}

function setEditorText(editor, text) {
  if (!editor) return;

  if (typeof editor.value === "string") {
    editor.value = text;
  } else {
    editor.textContent = text;
  }

  editor.dispatchEvent(new Event("input", { bubbles: true }));
}

function createRatingBox(root) {
  const ratingBox = document.createElement("div");
  ratingBox.className = "rating-box";
  ratingBox.innerHTML = `
    <div class="rating-label">评分</div>
    <div class="rating-stars" aria-label="评分选择">
      <button type="button" class="rating-star" data-value="1" aria-label="1星">★</button>
      <button type="button" class="rating-star" data-value="2" aria-label="2星">★</button>
      <button type="button" class="rating-star" data-value="3" aria-label="3星">★</button>
      <button type="button" class="rating-star" data-value="4" aria-label="4星">★</button>
      <button type="button" class="rating-star" data-value="5" aria-label="5星">★</button>
    </div>
    <div class="rating-text">可选，不打分也可以直接评论</div>
  `;

  const stars = Array.from(ratingBox.querySelectorAll(".rating-star"));
  const ratingText = ratingBox.querySelector(".rating-text");

  function paintStars(value) {
    stars.forEach((star) => {
      const starValue = Number(star.dataset.value);
      star.classList.toggle("active", starValue <= value);
    });

    ratingText.textContent =
      value > 0 ? `已选择 ${value} 星` : "可选，不打分也可以直接评论";
  }

  stars.forEach((star) => {
    star.addEventListener("mouseenter", () => {
      paintStars(Number(star.dataset.value));
    });

    star.addEventListener("click", () => {
      const clickedValue = Number(star.dataset.value);
      const currentValue = Number(root.dataset.currentRating || "0");
      const nextValue = currentValue === clickedValue ? 0 : clickedValue;

      root.dataset.currentRating = String(nextValue);
      paintStars(nextValue);
      root.classList.add("editor-expanded");
    });
  });

  ratingBox.addEventListener("mouseleave", () => {
    paintStars(Number(root.dataset.currentRating || "0"));
  });

  paintStars(Number(root.dataset.currentRating || "0"));
  return ratingBox;
}

function ensureRatingUI() {
  const root = document.getElementById("waline");
  if (!root) return;

  const panel = root.querySelector(".wl-panel");
  if (!panel) return;

  let ratingBox = panel.querySelector(".rating-box");
  if (!ratingBox) {
    ratingBox = createRatingBox(root);
    panel.prepend(ratingBox);
  }

  const submitBtn = root.querySelector(".wl-submit");
  if (!submitBtn) return;

  if (submitBtn.dataset.ratingSubmitBound === "true") return;
  submitBtn.dataset.ratingSubmitBound = "true";

  submitBtn.addEventListener(
    "click",
    () => {
      const ratingValue = Number(root.dataset.currentRating || "0");
      if (!ratingValue) return;

      const editor = getWalineEditor(root);
      if (!editor) return;

      const currentText = getEditorText(editor).trim();
      if (!currentText) return;

      if (/^评分：★{1,5}\n/.test(currentText)) return;

      setEditorText(editor, `评分：${"★".repeat(ratingValue)}\n${currentText}`);
    },
    { capture: true }
  );
}

function decorateLikeButtons() {
  const root = document.getElementById("waline");
  if (!root) return;

  const likeButtons = root.querySelectorAll(".wl-like");
  likeButtons.forEach((btn) => {
    if (btn.dataset.likeEnhanced === "true") return;
    btn.dataset.likeEnhanced = "true";

    btn.addEventListener("click", () => {
      btn.classList.remove("like-burst");
      void btn.offsetWidth;
      btn.classList.add("like-burst");

      setTimeout(() => {
        btn.classList.remove("like-burst");
      }, 380);
    });
  });
}

function decorateReplyThreads() {
  const root = document.getElementById("waline");
  if (!root) return;

  const replies = root.querySelectorAll(".wl-replies");
  replies.forEach((item) => {
    if (item.dataset.replyEnhanced === "true") return;
    item.dataset.replyEnhanced = "true";
    item.classList.add("reply-thread-enhanced");
  });
}

function createLetterAvatar(letter, isAdmin) {
  const avatar = document.createElement("div");
  avatar.className = "custom-letter-avatar";
  if (isAdmin) avatar.classList.add("is-admin");
  avatar.textContent = letter;
  return avatar;
}

function isAdminComment(cardItem) {
  const nick = cardItem.querySelector(".wl-card .wl-head .wl-nick");
  if (!nick) return false;

  const name = nick.textContent.trim().toLowerCase();
  return ADMIN_NAMES.includes(name);
}

function enhanceCommentCards() {
  const root = document.getElementById("waline");
  if (!root) return;

  const cardItems = root.querySelectorAll(".wl-cards .wl-card-item");

  cardItems.forEach((cardItem) => {
    const avatarImg = cardItem.querySelector(".wl-user img.wl-user-avatar");
    const nick = cardItem.querySelector(".wl-card .wl-head .wl-nick");
    const card = cardItem.querySelector(".wl-card");

    if (!avatarImg || !nick || !card) return;

    const name = nick.textContent.trim();
    if (!name) return;

    const letter = name.charAt(0).toUpperCase();
    const isAdmin = isAdminComment(cardItem);

    card.classList.toggle("is-admin", isAdmin);

    const avatarWrapper = cardItem.querySelector(".wl-user");
    if (avatarWrapper && avatarWrapper.dataset.avatarEnhanced !== "true") {
      const customAvatar = createLetterAvatar(letter, isAdmin);
      avatarWrapper.appendChild(customAvatar);
      avatarWrapper.dataset.avatarEnhanced = "true";

      avatarImg.style.display = "none";
      avatarImg.setAttribute("aria-hidden", "true");
    } else if (avatarWrapper) {
      const customAvatar = avatarWrapper.querySelector(".custom-letter-avatar");
      if (customAvatar) {
        customAvatar.textContent = letter;
        customAvatar.classList.toggle("is-admin", isAdmin);
      }
    }

    let badge = cardItem.querySelector(".custom-admin-badge");

    if (!isAdmin) {
      if (badge) badge.remove();
      return;
    }

    if (!badge) {
      badge = document.createElement("span");
      badge.className = "custom-admin-badge";
      badge.textContent = "管理员";
      nick.parentNode.insertBefore(badge, nick);
    }
  });
}

function runEnhancements() {
  ensureRatingUI();
  decorateLikeButtons();
  decorateReplyThreads();
  enhanceCommentCards();
}

function scheduleEnhancements() {
  if (enhanceScheduled) return;
  enhanceScheduled = true;

  requestAnimationFrame(() => {
    enhanceScheduled = false;
    runEnhancements();
  });
}

function observeWalineUpdates() {
  const root = document.getElementById("waline");
  if (!root) return;

  if (walineObserver) {
    walineObserver.disconnect();
  }

  walineObserver = new MutationObserver(() => {
    scheduleEnhancements();
  });

  walineObserver.observe(root, {
    childList: true,
    subtree: true,
  });
}

if (!window.__walineEscBound) {
  window.__walineEscBound = true;

  document.addEventListener("keydown", (e) => {
    if (e.key !== "Escape") return;

    const currentRoot = document.getElementById("waline");
    if (!currentRoot) return;

    const currentEditor = getWalineEditor(currentRoot);
    if (!currentEditor) return;

    if (!getEditorText(currentEditor).trim()) {
      currentEditor.blur();
      currentRoot.classList.remove("editor-expanded");
    }
  });
}