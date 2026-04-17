const WALINE_SERVER_URL = "https://yang283643-waline.vercel.app";

const WALINE_CSS_URL = "https://unpkg.com/@waline/client@v3/dist/waline.css";
const WALINE_JS_URL = "https://unpkg.com/@waline/client@v3/dist/waline.js";

let walineInstance = null;
let walineModulePromise = null;
let walineObserver = null;
let enhanceScheduled = false;

function initCommentPage() {
  const root = document.getElementById("waline");
  if (!root) return;

  showVpnIntroModal();
  showLoading(root);
  initWalineComment();
}

function showLoading(root) {
  root.innerHTML = `
    <div class="comment-status-card is-loading">
      <div class="comment-status-title">留言系统加载中</div>
      <div class="comment-status-text">正在检测评论服务，请稍候……</div>
    </div>
  `;
}

function showVpnIntroModal() {
  if (window.__commentVpnModalShown) return;
  if (document.getElementById("comment-vpn-modal")) return;

  window.__commentVpnModalShown = true;

  const modal = document.createElement("div");
  modal.id = "comment-vpn-modal";
  modal.className = "comment-vpn-modal";

  modal.innerHTML = `
    <div class="comment-vpn-mask"></div>

    <div class="comment-vpn-card">
      <button class="comment-vpn-close">×</button>

      <div class="comment-vpn-title">
        留言说明
      </div>

      <div class="comment-vpn-content">
        当前留言系统仍在测试阶段，依赖境外评论服务。<br><br>
        如果你处于中国大陆网络环境，通常需要开启 VPN 后，才能正常查看、发布、回复和点赞评论。
      </div>

      <div class="comment-vpn-tags">
        <span>后续会迁移国内</span>
        <span>请耐心等待</span>
      </div>

      <button class="comment-vpn-btn">我知道了</button>
    </div>
  `;

  document.body.appendChild(modal);
  document.body.classList.add("vpn-modal-open");

  const closeBtn = modal.querySelector(".comment-vpn-close");
  const confirmBtn = modal.querySelector(".comment-vpn-btn");

  function closeModal() {
    modal.classList.add("closing");
    document.body.classList.remove("vpn-modal-open");

    setTimeout(() => {
      modal.remove();
    }, 250);
  }

  closeBtn.onclick = closeModal;
  confirmBtn.onclick = closeModal;
}

  function closeModal() {
    modal.classList.add("is-closing");
    document.body.classList.remove("comment-vpn-modal-open");

    setTimeout(() => {
      modal.remove();
    }, 220);
  }

  closeBtn.addEventListener("click", closeModal);
  confirmBtn.addEventListener("click", closeModal);


  function closeModal() {
    modal.classList.add("is-closing");
    document.body.classList.remove("comment-vpn-modal-open");

    setTimeout(() => {
      modal.remove();
    }, 220);
  }

  closeBtn.addEventListener("click", closeModal);
  confirmBtn.addEventListener("click", closeModal);


function showGenericError(root) {
  root.innerHTML = `
    <div class="comment-status-card is-error">
      <div class="comment-status-title">留言系统加载失败</div>
      <div class="comment-status-text">
        评论资源或评论服务暂时不可用，请稍后再试。
      </div>
      <div class="comment-status-actions">
        <button type="button" class="comment-retry-btn" id="comment-retry-btn">重新检测</button>
      </div>
    </div>
  `;

  const retryBtn = document.getElementById("comment-retry-btn");
  if (retryBtn) {
    retryBtn.addEventListener("click", () => {
      showLoading(root);
      initWalineComment(true);
    });
  }
}

function ensureWalineStyle() {
  return new Promise((resolve, reject) => {
    const id = "waline-client-style";
    if (document.getElementById(id)) {
      resolve();
      return;
    }

    const link = document.createElement("link");
    link.id = id;
    link.rel = "stylesheet";
    link.href = WALINE_CSS_URL;
    link.onload = resolve;
    link.onerror = () => reject(new Error("Waline CSS 加载失败"));
    document.head.appendChild(link);
  });
}

function loadWalineModule(forceReload = false) {
  if (!walineModulePromise || forceReload) {
    walineModulePromise = import(WALINE_JS_URL);
  }
  return walineModulePromise;
}

function needVpn(error) {
  const msg = String(error?.message || error || "").toLowerCase();
  return (
    msg.includes("failed to fetch") ||
    msg.includes("network") ||
    msg.includes("timeout") ||
    msg.includes("importing a module script failed")
  );
}

function getCurrentCommentPath() {
  return window.location.pathname + window.location.search;
}

async function initWalineComment(forceReload = false) {
  const root = document.getElementById("waline");
  if (!root) return;

  try {
    await ensureWalineStyle();
    const { init } = await loadWalineModule(forceReload);

    if (walineObserver) {
      walineObserver.disconnect();
      walineObserver = null;
    }

    if (walineInstance?.destroy) {
      walineInstance.destroy();
    }

    root.innerHTML = "";
    root.classList.remove("editor-expanded");
    root.dataset.currentRating = "0";
    delete root.dataset.editorBound;
    enhanceScheduled = false;

    walineInstance = init({
      el: "#waline",
      serverURL: WALINE_SERVER_URL,
      path: getCurrentCommentPath(),
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
      const panel = root.querySelector(".wl-panel");
      const editor = root.querySelector(".wl-editor");

      if (!panel || !editor) {
        throw new Error("Waline 初始化失败");
      }

      bindEditorBehavior();
      runEnhancements();
      observeWalineUpdates();
    }, 500);
  } catch (error) {
    console.error("Waline 加载失败：", error);
    if (needVpn(error)) {
      showVpnNotice(root);
    } else {
      showGenericError(root);
    }
  }
}

function bindEditorBehavior() {
  const root = document.getElementById("waline");
  if (!root || root.dataset.editorBound === "true") return;

  root.dataset.editorBound = "true";

  root.addEventListener("focusin", () => {
    root.classList.add("editor-expanded");
    ensureRatingUI();
  });

  root.addEventListener("focusout", () => {
    setTimeout(() => {
      const activeInside = root.contains(document.activeElement);
      const editor = root.querySelector(".wl-editor");
      const hasText = !!getEditorText(editor).trim();

      if (!activeInside && !hasText) {
        root.classList.remove("editor-expanded");
      }
    }, 120);
  });
}

function getEditorText(editor) {
  if (!editor) return "";
  return typeof editor.value === "string" ? editor.value : editor.textContent || "";
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
  const box = document.createElement("div");
  box.className = "rating-box";
  box.innerHTML = `
    <div class="rating-label">评分</div>
    <div class="rating-stars" aria-label="评分选择">
      <button type="button" class="rating-star" data-value="1">★</button>
      <button type="button" class="rating-star" data-value="2">★</button>
      <button type="button" class="rating-star" data-value="3">★</button>
      <button type="button" class="rating-star" data-value="4">★</button>
      <button type="button" class="rating-star" data-value="5">★</button>
    </div>
    <div class="rating-text">可选，不打分也可以直接评论</div>
  `;

  const stars = [...box.querySelectorAll(".rating-star")];
  const text = box.querySelector(".rating-text");

  function paint(value) {
    stars.forEach((star) => {
      star.classList.toggle("active", Number(star.dataset.value) <= value);
    });
    text.textContent = value > 0 ? `已选择 ${value} 星` : "可选，不打分也可以直接评论";
  }

  stars.forEach((star) => {
    star.addEventListener("mouseenter", () => paint(Number(star.dataset.value)));
    star.addEventListener("click", () => {
      const clicked = Number(star.dataset.value);
      const current = Number(root.dataset.currentRating || "0");
      const next = current === clicked ? 0 : clicked;
      root.dataset.currentRating = String(next);
      paint(next);
      root.classList.add("editor-expanded");
    });
  });

  box.addEventListener("mouseleave", () => {
    paint(Number(root.dataset.currentRating || "0"));
  });

  paint(Number(root.dataset.currentRating || "0"));
  return box;
}

function ensureRatingUI() {
  const root = document.getElementById("waline");
  if (!root) return;

  const panel = root.querySelector(".wl-panel");
  if (!panel) return;

  if (!panel.querySelector(".rating-box")) {
    panel.prepend(createRatingBox(root));
  }

  const submitBtn = root.querySelector(".wl-submit");
  if (!submitBtn || submitBtn.dataset.ratingSubmitBound === "true") return;

  submitBtn.dataset.ratingSubmitBound = "true";
  submitBtn.addEventListener(
    "click",
    () => {
      const ratingValue = Number(root.dataset.currentRating || "0");
      if (!ratingValue) return;

      const editor = root.querySelector(".wl-editor");
      if (!editor) return;

      const currentText = getEditorText(editor).trim();
      if (!currentText) return;
      if (/^评分：★{1,5}\n/.test(currentText)) return;

      setEditorText(editor, `评分：${"★".repeat(ratingValue)}\n${currentText}`);
    },
    { capture: true }
  );
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
  if (nick?.classList.contains("wl-admin")) return true;

  const badge = cardItem.querySelector(".wl-badge");
  return !!(badge && /admin|管理员/i.test(badge.textContent.trim()));
}

function ensureRoleBadge(head, isAdmin) {
  let badge = head.querySelector(".custom-role-badge");
  if (!badge) {
    badge = document.createElement("span");
    badge.className = "custom-role-badge";
  }

  badge.textContent = isAdmin ? "管理员" : "游客";
  badge.classList.toggle("is-admin", isAdmin);
  badge.classList.toggle("is-visitor", !isAdmin);

  return badge;
}

function ensureAvatar(head, nickText, isAdmin) {
  let slot = head.querySelector(".custom-avatar-slot");
  if (!slot) {
    slot = document.createElement("div");
    slot.className = "custom-avatar-slot";
  }

  let avatar = slot.querySelector(".custom-letter-avatar");
  const letter = (nickText || "?").charAt(0).toUpperCase();

  if (!avatar) {
    avatar = createLetterAvatar(letter, isAdmin);
    slot.appendChild(avatar);
  } else {
    avatar.textContent = letter;
    avatar.classList.toggle("is-admin", isAdmin);
  }

  return slot;
}

function ensureActionSlot(head) {
  let slot = head.querySelector(".custom-action-slot");
  if (!slot) {
    slot = document.createElement("div");
    slot.className = "custom-action-slot";
  }

  const actionNodes = [
    ...head.querySelectorAll(".wl-like, .wl-reply, .wl-likecount, .wl-action, .wl-actions")
  ];

  actionNodes.forEach((node) => {
    if (node !== slot && !slot.contains(node)) {
      slot.appendChild(node);
    }
  });

  return slot;
}

function rebuildCommentHead(cardItem) {
  const card = cardItem.querySelector(".wl-card");
  const head = card?.querySelector(".wl-head");
  const nick = head?.querySelector(".wl-nick");
  const time = head?.querySelector(".wl-time");
  const meta = head?.querySelector(".wl-meta");
  const user = cardItem.querySelector(".wl-user");
  const avatarImg = user?.querySelector("img.wl-user-avatar");

  if (!card || !head || !nick) return;

  const isAdmin = isAdminComment(cardItem);
  const avatar = ensureAvatar(head, nick.textContent.trim(), isAdmin);
  const badge = ensureRoleBadge(head, isAdmin);
  const actions = ensureActionSlot(head);

  if (user) user.style.display = "none";
  if (avatarImg) avatarImg.style.display = "none";
  cardItem.classList.add("avatar-inside-card");

  const left = document.createElement("div");
  left.className = "custom-head-left";
  left.append(avatar, badge, nick);
  if (time) left.append(time);

  head.innerHTML = "";
  head.append(left, actions);
  if (meta) head.append(meta);

  card.classList.toggle("is-admin", isAdmin);
  card.classList.toggle("is-visitor", !isAdmin);
}

function decorateLikeButtons() {
  const root = document.getElementById("waline");
  if (!root) return;

  root.querySelectorAll(".wl-like").forEach((btn) => {
    if (btn.dataset.likeEnhanced === "true") return;
    btn.dataset.likeEnhanced = "true";

    btn.addEventListener("click", () => {
      btn.classList.remove("like-burst");
      void btn.offsetWidth;
      btn.classList.add("like-burst");
      setTimeout(() => btn.classList.remove("like-burst"), 380);
    });
  });
}

function decorateReplyThreads() {
  const root = document.getElementById("waline");
  if (!root) return;

  root.querySelectorAll(".wl-replies").forEach((item) => {
    if (item.dataset.replyEnhanced === "true") return;
    item.dataset.replyEnhanced = "true";
    item.classList.add("reply-thread-enhanced");
  });
}

function enhanceCommentCards() {
  const root = document.getElementById("waline");
  if (!root) return;

  root.querySelectorAll(".wl-cards .wl-card-item").forEach((cardItem) => {
    rebuildCommentHead(cardItem);
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

  if (walineObserver) walineObserver.disconnect();

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

    const root = document.getElementById("waline");
    if (!root) return;

    const editor = root.querySelector(".wl-editor");
    if (!editor) return;

    if (!getEditorText(editor).trim()) {
      editor.blur();
      root.classList.remove("editor-expanded");
    }
  });
}