const WALINE_SERVER_URL = "https://yang283643-waline.vercel.app";

const WALINE_CSS_CANDIDATES = [
  "https://unpkg.com/@waline/client@v3/dist/waline.css"
];

const WALINE_JS_CANDIDATES = [
  "https://unpkg.com/@waline/client@v3/dist/waline.js"
];

let walineInstance = null;
let walineStyleReady = false;
let walineModulePromise = null;
let walineObserver = null;
let enhanceScheduled = false;

function initCommentPage() {
  const walineRoot = document.getElementById("waline");
  if (!walineRoot) return;

  showCommentLoading(walineRoot);

  requestAnimationFrame(() => {
    initWalineComment();
  });
}

function showCommentLoading(root) {
  root.innerHTML = `
    <div class="comment-status-card is-loading">
      <div class="comment-status-title">留言系统加载中</div>
      <div class="comment-status-text">正在检测当前网络环境与评论服务可用性，请稍候……</div>
    </div>
  `;
}

function showVpnRequiredNotice(root) {
  root.innerHTML = `
    <div class="comment-status-card is-warning">
      <div class="comment-status-title">留言功能当前不可用</div>
      <div class="comment-status-text">
        检测到当前网络环境下无法连接留言系统。<br>
        本页面的评论服务目前依赖境外链路，通常需要开启 VPN 后才能正常使用。
      </div>
      <div class="comment-status-actions">
        <button type="button" class="comment-retry-btn" id="comment-retry-btn">重新检测</button>
      </div>
    </div>
  `;

  const retryBtn = document.getElementById("comment-retry-btn");
  if (retryBtn) {
    retryBtn.addEventListener("click", () => {
      showCommentLoading(root);
      initWalineComment(true);
    });
  }
}

function showCommentGenericError(root) {
  root.innerHTML = `
    <div class="comment-status-card is-error">
      <div class="comment-status-title">留言系统加载失败</div>
      <div class="comment-status-text">
        评论资源或评论服务暂时不可用，请稍后再试。<br>
        如果你在中国大陆网络环境下访问，这通常是因为当前未开启 VPN。
      </div>
      <div class="comment-status-actions">
        <button type="button" class="comment-retry-btn" id="comment-retry-btn">重新检测</button>
      </div>
    </div>
  `;

  const retryBtn = document.getElementById("comment-retry-btn");
  if (retryBtn) {
    retryBtn.addEventListener("click", () => {
      showCommentLoading(root);
      initWalineComment(true);
    });
  }
}

function loadCssWithFallback(urls, id) {
  return new Promise((resolve, reject) => {
    const existing = document.getElementById(id);
    if (existing) {
      resolve(existing.href || true);
      return;
    }

    let index = 0;

    function tryNext() {
      if (index >= urls.length) {
        reject(new Error("所有 Waline CSS 地址均加载失败"));
        return;
      }

      const href = urls[index++];
      const link = document.createElement("link");
      link.id = id;
      link.rel = "stylesheet";
      link.href = href;

      link.onload = () => resolve(href);
      link.onerror = () => {
        link.remove();
        tryNext();
      };

      document.head.appendChild(link);
    }

    tryNext();
  });
}

function ensureWalineStyle() {
  if (walineStyleReady) return Promise.resolve(true);

  return loadCssWithFallback(WALINE_CSS_CANDIDATES, "waline-client-style")
    .then(() => {
      walineStyleReady = true;
      return true;
    });
}

async function importModuleWithFallback(urls) {
  let lastError = null;

  for (const url of urls) {
    try {
      return await import(url);
    } catch (error) {
      lastError = error;
      console.warn(`Waline 模块加载失败：${url}`, error);
    }
  }

  throw lastError || new Error("所有 Waline JS 地址均加载失败");
}

function loadWalineModule(forceReload = false) {
  if (!walineModulePromise || forceReload) {
    walineModulePromise = importModuleWithFallback(WALINE_JS_CANDIDATES);
  }
  return walineModulePromise;
}

function getCurrentCommentPath() {
  return window.location.pathname + window.location.search;
}

function detectProbablyNeedVpn(error) {
  const msg = String(error?.message || error || "").toLowerCase();

  return (
    msg.includes("failed to fetch") ||
    msg.includes("importing a module script failed") ||
    msg.includes("load failed") ||
    msg.includes("networkerror") ||
    msg.includes("network error") ||
    msg.includes("fetch") ||
    msg.includes("timeout")
  );
}

async function initWalineComment(forceReload = false) {
  const walineRoot = document.getElementById("waline");
  if (!walineRoot) return;

  const currentPath = getCurrentCommentPath();

  try {
    await ensureWalineStyle();
    const { init } = await loadWalineModule(forceReload);

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
      const panel = walineRoot.querySelector(".wl-panel");
      const editor = walineRoot.querySelector(".wl-editor");

      if (!panel || !editor) {
        throw new Error("Waline 初始化未完成，当前网络环境可能无法访问评论服务");
      }

      bindWalineEditorBehavior();
      runEnhancements();
      observeWalineUpdates();
    }, 500);
  } catch (error) {
    console.error("Waline 加载失败：", error);

    if (detectProbablyNeedVpn(error)) {
      showVpnRequiredNotice(walineRoot);
    } else {
      showCommentGenericError(walineRoot);
    }
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
  if (!cardItem) return false;

  if (cardItem.classList.contains("wl-admin")) return true;
  if (cardItem.querySelector(".wl-admin")) return true;

  const nick = cardItem.querySelector(".wl-card .wl-head .wl-nick");
  if (nick && nick.classList.contains("wl-admin")) return true;

  const badge = cardItem.querySelector(".wl-badge");
  if (badge && /admin|管理员/i.test(badge.textContent.trim())) return true;

  return false;
}

function ensureRoleBadge(head, isAdmin) {
  if (!head) return;

  let badge = head.querySelector(".custom-role-badge");
  const roleText = isAdmin ? "管理员" : "游客";

  if (!badge) {
    badge = document.createElement("span");
    badge.className = "custom-role-badge";
    head.insertBefore(badge, head.firstChild);
  }

  badge.textContent = roleText;
  badge.classList.toggle("is-admin", isAdmin);
  badge.classList.toggle("is-visitor", !isAdmin);
}

function ensureTimePosition(head) {
  if (!head) return;
  const time = head.querySelector(".wl-time");
  if (!time) return;
  head.appendChild(time);
}

function moveActionsToRight(head) {
  if (!head) return;

  let actionSlot = head.querySelector(".custom-action-slot");
  if (!actionSlot) {
    actionSlot = document.createElement("div");
    actionSlot.className = "custom-action-slot";
  }

  const selectors = [
    ".wl-like",
    ".wl-reply",
    ".wl-likecount",
    ".wl-action",
    ".wl-actions"
  ];

  selectors.forEach((selector) => {
    head.querySelectorAll(`:scope > ${selector}`).forEach((node) => {
      if (node !== actionSlot) {
        actionSlot.appendChild(node);
      }
    });
  });

  Array.from(head.children).forEach((node) => {
    if (!node || node === actionSlot) return;

    if (node.classList?.contains("custom-avatar-slot")) return;
    if (node.classList?.contains("custom-role-badge")) return;
    if (node.classList?.contains("wl-nick")) return;
    if (node.classList?.contains("wl-time")) return;
    if (node.classList?.contains("wl-meta")) return;

    const className = node.className || "";

    if (
      node.classList?.contains("wl-like") ||
      node.classList?.contains("wl-reply") ||
      node.classList?.contains("wl-action") ||
      node.classList?.contains("wl-actions") ||
      node.classList?.contains("wl-likecount") ||
      className.includes("wl-like") ||
      className.includes("wl-reply") ||
      className.includes("wl-action") ||
      className.includes("wl-actions")
    ) {
      actionSlot.appendChild(node);
    }
  });

  head.appendChild(actionSlot);
}

function moveAvatarIntoCard(cardItem, isAdmin) {
  const avatarWrapper = cardItem.querySelector(".wl-user");
  const avatarImg = avatarWrapper?.querySelector("img.wl-user-avatar");
  const card = cardItem.querySelector(".wl-card");
  const head = card?.querySelector(".wl-head");
  const nick = head?.querySelector(".wl-nick");

  if (!card || !head || !nick) return;

  let avatarSlot = head.querySelector(".custom-avatar-slot");
  if (!avatarSlot) {
    avatarSlot = document.createElement("div");
    avatarSlot.className = "custom-avatar-slot";
    head.insertBefore(avatarSlot, head.firstChild);
  }

  const name = nick.textContent.trim();
  if (!name) return;

  const letter = name.charAt(0).toUpperCase();

  let customAvatar = avatarSlot.querySelector(".custom-letter-avatar");
  if (!customAvatar) {
    customAvatar = createLetterAvatar(letter, isAdmin);
    avatarSlot.appendChild(customAvatar);
  } else {
    customAvatar.textContent = letter;
    customAvatar.classList.toggle("is-admin", isAdmin);
  }

  if (avatarImg) {
    avatarImg.style.display = "none";
    avatarImg.setAttribute("aria-hidden", "true");
  }

  if (avatarWrapper) {
    avatarWrapper.style.display = "none";
  }

  cardItem.classList.add("avatar-inside-card");
}

function normalizeHeadOrder(head) {
  if (!head) return;

  const avatar = head.querySelector(".custom-avatar-slot");
  const badge = head.querySelector(".custom-role-badge");
  const nick = head.querySelector(".wl-nick");
  const time = head.querySelector(".wl-time");
  const meta = head.querySelector(".wl-meta");
  const actions = head.querySelector(".custom-action-slot");

  if (avatar) head.appendChild(avatar);
  if (badge) head.appendChild(badge);
  if (nick) head.appendChild(nick);
  if (time) head.appendChild(time);
  if (actions) head.appendChild(actions);
  if (meta) head.appendChild(meta);
}

function enhanceCommentCards() {
  const root = document.getElementById("waline");
  if (!root) return;

  const cardItems = root.querySelectorAll(".wl-cards .wl-card-item");

  cardItems.forEach((cardItem) => {
    const card = cardItem.querySelector(".wl-card");
    const head = card?.querySelector(".wl-head");
    const nick = head?.querySelector(".wl-nick");

    if (!card || !head || !nick) return;

    const isAdmin = isAdminComment(cardItem);

    card.classList.toggle("is-admin", isAdmin);
    card.classList.toggle("is-visitor", !isAdmin);

    moveAvatarIntoCard(cardItem, isAdmin);
    ensureRoleBadge(head, isAdmin);
    ensureTimePosition(head);
    moveActionsToRight(head);
    normalizeHeadOrder(head);
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