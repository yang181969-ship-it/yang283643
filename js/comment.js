// ============================================================
// 自研留言系统前端
// API: https://comment.yang181969.com/api/comments
// ============================================================

(function () {
  "use strict";

  const COMMENT_API_BASE = "https://comment.yang181969.com";
  const COMMENTS_ENDPOINT = `${COMMENT_API_BASE}/api/comments`;
  const UPLOAD_ENDPOINT = `${COMMENT_API_BASE}/api/upload`;

  const MAX_IMAGES = 3;
  const MAX_IMAGE_SIZE = 3 * 1024 * 1024;
  const ALLOWED_IMAGE_TYPES = ["image/jpeg", "image/png", "image/webp", "image/gif"];

  const state = {
    page: 1,
    pageSize: 100,
    totalPages: 0,
    totalComments: 0,
    isSubmitting: false,
    isUploading: false,
    activeTab: "all",
    rawComments: [],
    replyTarget: null, // { commentId, name }
    selectedImages: [], // [{ url, name }]
  };

  function initCommentPage() {
    const root = document.querySelector(".comment-page");
    if (!root) return;

    bindEvents(root);
    loadComments(root, 1);
    syncComposerCollapsed(root);
    syncMainHeightWithSidebar(root);
  }

  // ============================================================
  // 高度对齐：让左侧大卡片底部与右侧侧栏（站长的话）底部齐平
  // 仅在两栏布局（>900px）下生效；窄屏由 CSS 媒体查询接管
  // ============================================================
  function syncMainHeightWithSidebar(root) {
    const main = root.querySelector(".comment-main");
    const sidebar = root.querySelector(".comment-sidebar");
    if (!main || !sidebar || typeof ResizeObserver === "undefined") return;

    const mq = window.matchMedia("(min-width: 901px)");

    const apply = () => {
      if (mq.matches) {
        main.style.setProperty("--comment-main-height", `${sidebar.offsetHeight}px`);
      } else {
        main.style.removeProperty("--comment-main-height");
      }
    };

    const ro = new ResizeObserver(apply);
    ro.observe(sidebar);

    if (typeof mq.addEventListener === "function") {
      mq.addEventListener("change", apply);
    } else if (typeof mq.addListener === "function") {
      mq.addListener(apply);
    }

    apply();
  }

  window.initCommentPage = initCommentPage;

  // ============================================================
  // 事件绑定
  // ============================================================
  function bindEvents(root) {
    const refreshBtn = root.querySelector("#comment-refresh-btn");
    const tabs = root.querySelectorAll(".comment-tab");
    const composer = root.querySelector("#comment-composer");
    const textarea = root.querySelector("#comment-content");
    const cancelReplyBtn = root.querySelector("#comment-composer-cancel");
    const list = root.querySelector("#comment-list");

    refreshBtn?.addEventListener("click", () => loadComments(root, state.page));

    tabs.forEach(tab => {
      tab.addEventListener("click", () => {
        const tabId = tab.dataset.tab;
        if (!tabId || tabId === state.activeTab) return;
        state.activeTab = tabId;
        tabs.forEach(t => {
          const isActive = t.dataset.tab === tabId;
          t.classList.toggle("is-active", isActive);
          t.setAttribute("aria-selected", isActive ? "true" : "false");
        });
        renderCommentList(root, state.rawComments);
      });
    });

    composer?.addEventListener("submit", async (event) => {
      event.preventDefault();
      await submitComment(root);
    });

    textarea?.addEventListener("focus", () => expandComposer(root));
    textarea?.addEventListener("input", () => {
      autoResizeTextarea(textarea);
      updateCharCount(root, textarea);
    });

    cancelReplyBtn?.addEventListener("click", () => clearReplyTarget(root));

    // 图片上传
    const imageBtn = root.querySelector("#comment-image-btn");
    const imageInput = root.querySelector("#comment-image-input");
    imageBtn?.addEventListener("click", () => imageInput?.click());
    imageInput?.addEventListener("change", (event) => handleImageSelection(root, event));

    // 列表内事件委托：回复 / 点赞 / 图片预览
    list?.addEventListener("click", (event) => {
      const replyBtn = event.target.closest("[data-action='reply']");
      if (replyBtn) {
        const id = replyBtn.dataset.commentId;
        const name = replyBtn.dataset.commentName;
        setReplyTarget(root, { commentId: id, name });
        return;
      }

      const likeBtn = event.target.closest("[data-action='like']");
      if (likeBtn) {
        const willLike = !likeBtn.classList.contains("is-liked");
        likeBtn.classList.toggle("is-liked", willLike);
        const countEl = likeBtn.querySelector(".comment-action__count");
        if (countEl) {
          const current = parseInt(countEl.textContent, 10) || 0;
          const next = Math.max(0, current + (willLike ? 1 : -1));
          countEl.textContent = String(next);
        }
        return;
      }

      const toggleBtn = event.target.closest("[data-action='toggle-replies']");
      if (toggleBtn) {
        const article = toggleBtn.closest(".comment-item");
        const repliesEl = article?.querySelector(".comment-replies");
        const labelEl = toggleBtn.querySelector(".comment-replies-toggle__label");
        if (!repliesEl) return;
        const count = repliesEl.children.length;
        const willHide = !repliesEl.hidden;
        repliesEl.hidden = willHide;
        toggleBtn.setAttribute("aria-expanded", willHide ? "false" : "true");
        if (labelEl) {
          labelEl.textContent = willHide ? `展开 ${count} 条回复` : `收起 ${count} 条回复`;
        }
      }
    });

    // 预览区移除按钮
    const previewBox = root.querySelector("#comment-upload-preview");
    previewBox?.addEventListener("click", (event) => {
      const removeBtn = event.target.closest(".comment-upload-remove");
      if (!removeBtn) return;
      const index = Number(removeBtn.dataset.index);
      if (!Number.isInteger(index)) return;
      state.selectedImages.splice(index, 1);
      renderUploadPreview(root);
    });

    // 展开态:点击 composer 外部 → 收起(若 textarea 无内容)
    document.addEventListener("click", (event) => {
      const composerEl = root.querySelector("#comment-composer");
      if (!composerEl || !composerEl.classList.contains("is-expanded")) return;
      if (composerEl.contains(event.target)) return;
      // 「回复」按钮刚刚展开 composer,跳过这一次
      if (event.target.closest && event.target.closest("[data-action='reply']")) return;

      const ta = root.querySelector("#comment-content");
      if (ta && ta.value.trim()) return; // 有内容时保留,避免误丢

      clearReplyTarget(root);
      collapseComposer(root);
    });
  }

  // ============================================================
  // 加载留言列表
  // ============================================================
  async function loadComments(root, page = 1) {
    const list = root.querySelector("#comment-list");
    if (!list) return;

    state.page = page;

    list.innerHTML = `
      <article class="comment-status-card is-loading">
        <div class="comment-status-title">正在加载留言</div>
        <div class="comment-status-text">请稍候……</div>
      </article>
    `;

    try {
      const url = `${COMMENTS_ENDPOINT}?page=${encodeURIComponent(page)}&pageSize=${encodeURIComponent(state.pageSize)}`;
      const data = await fetchJson(url);

      if (!data.ok) throw new Error(data.message || "留言加载失败");

      const comments = (data.data?.comments || []).map(normalizeComment);
      const pagination = data.data?.pagination || {};

      state.page = pagination.page || page;
      state.totalPages = pagination.totalPages || 0;
      state.totalComments = pagination.total || comments.length;
      state.rawComments = comments;

      renderCommentList(root, comments);
      renderStats(root, comments, pagination);
    } catch (error) {
      console.error("留言加载失败：", error);
      list.innerHTML = `
        <article class="comment-status-card is-error">
          <div class="comment-status-title">留言加载失败</div>
          <div class="comment-status-text">请检查网络或稍后重试。</div>
          <div class="comment-status-actions">
            <button type="button" class="comment-retry-btn" id="comment-retry-load">重新加载</button>
          </div>
        </article>
      `;
      root.querySelector("#comment-retry-load")?.addEventListener("click", () => loadComments(root, state.page));
    }
  }

  // ============================================================
  // 数据规范化
  // 兼容后端没有 replies / parent_id 时的旧数据
  // ============================================================
  function normalizeComment(raw) {
    const replies = Array.isArray(raw.replies) ? raw.replies.map(normalizeReply) : [];
    return {
      id: raw.id,
      nickname: raw.nickname || "访客",
      role: raw.role || (raw.is_admin ? "admin" : "guest"),
      website: raw.website || "",
      content: raw.content || "",
      created_at: raw.created_at,
      likes: typeof raw.likes === "number" ? raw.likes : 0,
      images: normalizeImages(raw.images),
      replies,
    };
  }

  function normalizeReply(raw) {
    return {
      id: raw.id,
      nickname: raw.nickname || "访客",
      role: raw.role || (raw.is_admin ? "admin" : "guest"),
      website: raw.website || "",
      content: raw.content || "",
      created_at: raw.created_at,
      likes: typeof raw.likes === "number" ? raw.likes : 0,
      images: normalizeImages(raw.images),
      replyToName: raw.reply_to_name || raw.replyToName || "",
    };
  }

  function normalizeImages(value) {
    if (Array.isArray(value)) {
      return value.filter(item => typeof item === "string" && item.trim());
    }
    if (typeof value === "string" && value.trim()) {
      try {
        const parsed = JSON.parse(value);
        if (Array.isArray(parsed)) {
          return parsed.filter(item => typeof item === "string" && item.trim());
        }
      } catch {
        // ignore
      }
    }
    return [];
  }

  function resolveImageUrl(url) {
    if (!url) return "";
    if (/^https?:\/\//i.test(url)) return url;
    return `${COMMENT_API_BASE}${url.startsWith("/") ? url : `/${url}`}`;
  }

  // ============================================================
  // 渲染留言列表
  // ============================================================
  function renderCommentList(root, comments) {
    const list = root.querySelector("#comment-list");
    if (!list) return;

    const filtered = applyTabFilter(comments, state.activeTab);

    if (!filtered.length) {
      list.innerHTML = `
        <article class="comment-empty">
          <div class="comment-empty-icon" aria-hidden="true"></div>
          <h4>${state.activeTab === "replied" ? "暂时没有带回复的留言" : "还没有留言"}</h4>
          <p>${state.activeTab === "replied" ? "切换到「全部」看看其他留言吧。" : "第一条留言等你来写。"}</p>
        </article>
      `;
      return;
    }

    list.innerHTML = filtered.map(comment => renderCommentItem(comment)).join("");
  }

  function applyTabFilter(comments, tab) {
    if (!Array.isArray(comments)) return [];
    if (tab === "replied") {
      return comments.filter(c => Array.isArray(c.replies) && c.replies.length > 0);
    }
    if (tab === "latest") {
      return [...comments].sort((a, b) => {
        const ta = parseTime(a.created_at);
        const tb = parseTime(b.created_at);
        return tb - ta;
      });
    }
    return comments;
  }

  function renderCommentItem(comment) {
    const nickname = escapeHTML(comment.nickname);
    const safeName = escapeAttribute(comment.nickname);
    const content = escapeHTML(comment.content).replace(/\n/g, "<br>");
    const date = formatDate(comment.created_at);
    const letter = (comment.nickname.trim().slice(0, 1) || "访").toUpperCase();
    const isAdmin = comment.role === "admin";
    const roleBadge = isAdmin
      ? `<span class="comment-role-badge is-owner">站长</span>`
      : `<span class="comment-role-badge">访客</span>`;
    const website = normalizeWebsite(comment.website);
    const authorEl = website
      ? `<a class="comment-author" href="${escapeAttribute(website)}" target="_blank" rel="noopener noreferrer">${nickname}</a>`
      : `<span class="comment-author">${nickname}</span>`;

    const replyCount = comment.replies.length;
    const repliesHtml = replyCount
      ? `<button type="button" class="comment-replies-toggle" data-action="toggle-replies" aria-expanded="false">
           <span class="comment-replies-toggle__icon" aria-hidden="true"></span>
           <span class="comment-replies-toggle__label">展开 ${replyCount} 条回复</span>
         </button>
         <div class="comment-replies" hidden>${comment.replies.map(r => renderReplyItem(r)).join("")}</div>`
      : "";

    const imagesHtml = renderImageList(comment.images);

    return `
      <article class="comment-item${isAdmin ? " is-owner" : ""}" data-id="${escapeAttribute(comment.id)}">
        <div class="comment-avatar" aria-hidden="true">${escapeHTML(letter)}</div>
        <div class="comment-item__main">
          <header class="comment-item__head">
            <div class="comment-item__author">
              ${authorEl}
              ${roleBadge}
              <span class="comment-item__sep" aria-hidden="true">·</span>
              <time class="comment-time">${escapeHTML(date)}</time>
            </div>
            <div class="comment-item__actions">
              <button type="button" class="comment-action comment-action--icon" data-action="reply" data-comment-id="${escapeAttribute(comment.id)}" data-comment-name="${safeName}" aria-label="回复" title="回复">
                <span class="comment-action__icon comment-action__icon--reply" aria-hidden="true"></span>
              </button>
              <button type="button" class="comment-action comment-action--icon comment-action--like" data-action="like" data-comment-id="${escapeAttribute(comment.id)}" aria-label="点赞" title="点赞">
                <span class="comment-action__icon comment-action__icon--like" aria-hidden="true"></span>
                <span class="comment-action__count">${comment.likes || 0}</span>
              </button>
            </div>
          </header>
          <div class="comment-content">${content}</div>
          ${imagesHtml}
          ${repliesHtml}
        </div>
      </article>
    `;
  }

  function renderReplyItem(reply) {
    const nickname = escapeHTML(reply.nickname);
    const safeName = escapeAttribute(reply.nickname);
    const replyToName = escapeHTML(reply.replyToName || "");
    const date = formatDate(reply.created_at);
    const letter = (reply.nickname.trim().slice(0, 1) || "访").toUpperCase();
    const content = escapeHTML(reply.content).replace(/\n/g, "<br>");
    const isAdmin = reply.role === "admin";
    const roleBadge = isAdmin
      ? `<span class="comment-role-badge is-owner">站长</span>`
      : `<span class="comment-role-badge">访客</span>`;
    const website = normalizeWebsite(reply.website);
    const authorEl = website
      ? `<a class="comment-author" href="${escapeAttribute(website)}" target="_blank" rel="noopener noreferrer">${nickname}</a>`
      : `<span class="comment-author">${nickname}</span>`;
    const mention = replyToName
      ? `<span class="comment-mention">@${replyToName}</span> `
      : "";

    const imagesHtml = renderImageList(reply.images);

    return `
      <article class="comment-reply${isAdmin ? " is-owner" : ""}" data-id="${escapeAttribute(reply.id)}">
        <div class="comment-avatar comment-avatar--sm" aria-hidden="true">${escapeHTML(letter)}</div>
        <div class="comment-reply__main">
          <header class="comment-reply__head">
            <div class="comment-item__author">
              ${authorEl}
              ${roleBadge}
              <span class="comment-item__sep" aria-hidden="true">·</span>
              <time class="comment-time">${escapeHTML(date)}</time>
            </div>
            <div class="comment-item__actions">
              <button type="button" class="comment-action comment-action--icon" data-action="reply" data-comment-id="${escapeAttribute(reply.id)}" data-comment-name="${safeName}" aria-label="回复" title="回复">
                <span class="comment-action__icon comment-action__icon--reply" aria-hidden="true"></span>
              </button>
              <button type="button" class="comment-action comment-action--icon comment-action--like" data-action="like" data-comment-id="${escapeAttribute(reply.id)}" aria-label="点赞" title="点赞">
                <span class="comment-action__icon comment-action__icon--like" aria-hidden="true"></span>
                <span class="comment-action__count">${reply.likes || 0}</span>
              </button>
            </div>
          </header>
          <div class="comment-content">${mention}${content}</div>
          ${imagesHtml}
        </div>
      </article>
    `;
  }

  // ============================================================
  // 统计卡
  // ============================================================
  function renderStats(root, comments, pagination) {
    const total = pagination.total ?? comments.length;
    const today = countTodayComments(comments);
    const replies = comments.reduce((sum, c) => sum + (c.replies?.length || 0), 0);
    const likes = comments.reduce((sum, c) => {
      const replyLikes = (c.replies || []).reduce((s, r) => s + (r.likes || 0), 0);
      return sum + (c.likes || 0) + replyLikes;
    }, 0);

    setStatValue(root, "#comment-stat-total", total);
    setStatValue(root, "#comment-stat-today", today);
    setStatValue(root, "#comment-stat-replies", replies);
    setStatValue(root, "#comment-stat-likes", likes);
  }

  function setStatValue(root, selector, value) {
    const el = root.querySelector(selector);
    if (!el) return;
    el.textContent = String(value ?? 0);
  }

  function countTodayComments(comments) {
    const today = new Date();
    const y = today.getFullYear();
    const m = today.getMonth();
    const d = today.getDate();
    return comments.filter(c => {
      const t = parseTime(c.created_at);
      if (!t) return false;
      const dt = new Date(t);
      return dt.getFullYear() === y && dt.getMonth() === m && dt.getDate() === d;
    }).length;
  }

  // ============================================================
  // 浮浮输入框：折叠 / 展开 / 回复态
  // ============================================================
  function syncComposerCollapsed(root) {
    const composer = root.querySelector("#comment-composer");
    composer?.classList.remove("is-expanded");
  }

  function expandComposer(root) {
    const composer = root.querySelector("#comment-composer");
    if (!composer) return;
    if (composer.classList.contains("is-expanded")) return;

    composer.classList.add("is-expanded");

    composer.querySelector(".comment-composer__fields")?.removeAttribute("hidden");
    composer.querySelector(".comment-composer__tools")?.removeAttribute("hidden");
    composer.querySelector(".comment-composer__editor-label")?.removeAttribute("hidden");
    composer.querySelector(".comment-composer__counter")?.removeAttribute("hidden");

    const sendCollapsed = composer.querySelector("#comment-send-collapsed");
    if (sendCollapsed) sendCollapsed.hidden = true;

    const textarea = composer.querySelector("#comment-content");
    if (textarea) {
      textarea.rows = 4;
      autoResizeTextarea(textarea);
      updateCharCount(root, textarea);
    }
  }

  function collapseComposer(root) {
    const composer = root.querySelector("#comment-composer");
    if (!composer) return;

    composer.classList.remove("is-expanded");

    composer.querySelector(".comment-composer__fields")?.setAttribute("hidden", "");
    composer.querySelector(".comment-composer__tools")?.setAttribute("hidden", "");
    composer.querySelector(".comment-composer__editor-label")?.setAttribute("hidden", "");
    composer.querySelector(".comment-composer__counter")?.setAttribute("hidden", "");

    const sendCollapsed = composer.querySelector("#comment-send-collapsed");
    if (sendCollapsed) sendCollapsed.hidden = false;

    const textarea = composer.querySelector("#comment-content");
    if (textarea) {
      textarea.rows = 1;
      textarea.style.height = "";
    }
  }

  function updateCharCount(root, textarea) {
    const counter = root.querySelector("#comment-composer-count");
    if (!counter || !textarea) return;
    counter.textContent = String(textarea.value.length);
  }

  function setReplyTarget(root, target) {
    state.replyTarget = target;
    const bar = root.querySelector("#comment-composer-reply-bar");
    const nameEl = root.querySelector("#comment-composer-reply-name");
    const textarea = root.querySelector("#comment-content");

    if (bar) bar.hidden = !target;
    if (nameEl && target) nameEl.textContent = `@${target.name}`;

    if (textarea) {
      textarea.placeholder = target ? `回复 @${target.name}……` : "说一下你的留言……";
    }

    expandComposer(root);
    textarea?.focus();
  }

  function clearReplyTarget(root) {
    state.replyTarget = null;
    const bar = root.querySelector("#comment-composer-reply-bar");
    const textarea = root.querySelector("#comment-content");
    if (bar) bar.hidden = true;
    if (textarea) textarea.placeholder = "说一下你的留言……";
  }

  function autoResizeTextarea(textarea) {
    if (!textarea) return;
    textarea.style.height = "auto";
    const next = Math.min(textarea.scrollHeight, 280);
    textarea.style.height = `${next}px`;
  }

  // ============================================================
  // 提交留言
  // ============================================================
  async function submitComment(root) {
    if (state.isSubmitting) return;

    const composer = root.querySelector("#comment-composer");
    const submitBtn = root.querySelector("#comment-submit-btn");
    const message = root.querySelector("#comment-form-message");
    if (!composer || !message) return;

    // 折叠态点击发送 → 先展开，让用户填昵称
    if (!composer.classList.contains("is-expanded")) {
      expandComposer(root);
      root.querySelector("#comment-content")?.focus();
      return;
    }

    const nickname = root.querySelector("#comment-nickname")?.value.trim() || "";
    const email = root.querySelector("#comment-email")?.value.trim() || "";
    const website = root.querySelector("#comment-website")?.value.trim() || "";
    const content = root.querySelector("#comment-content")?.value.trim() || "";

    if (!nickname) {
      showFormMessage(message, "请填写昵称。", "error");
      return;
    }

    if (!content) {
      showFormMessage(message, "留言内容不能为空。", "error");
      return;
    }

    const payload = {
      nickname,
      email,
      website,
      content,
      images: state.selectedImages.map(item => item.url),
    };

    if (state.replyTarget) {
      payload.reply_to_id = state.replyTarget.commentId;
    }

    state.isSubmitting = true;
    if (submitBtn) {
      submitBtn.disabled = true;
      const label = submitBtn.querySelector(".comment-composer__submit-label");
      if (label) label.textContent = "提交中……";
    }
    showFormMessage(message, "正在提交留言……", "info");

    try {
      const data = await fetchJson(COMMENTS_ENDPOINT, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify(payload),
      });

      if (!data.ok) throw new Error(data.message || "提交失败");

      const textarea = root.querySelector("#comment-content");
      if (textarea) {
        textarea.value = "";
        textarea.style.height = "";
        updateCharCount(root, textarea);
      }

      clearReplyTarget(root);
      clearUploadPreview(root);
      showFormMessage(message, "留言提交成功。", "success");

      await loadComments(root, 1);

      setTimeout(() => {
        if (message) {
          message.hidden = true;
          message.textContent = "";
        }
        collapseComposer(root);
      }, 1600);
    } catch (error) {
      console.error("留言提交失败：", error);
      showFormMessage(message, error.message || "留言提交失败，请稍后再试。", "error");
    } finally {
      state.isSubmitting = false;
      if (submitBtn) {
        submitBtn.disabled = false;
        const label = submitBtn.querySelector(".comment-composer__submit-label");
        if (label) label.textContent = "发送留言";
      }
    }
  }

  // ============================================================
  // 图片：渲染留言/回复中的图片
  // ============================================================
  function renderImageList(images) {
    if (!Array.isArray(images) || !images.length) return "";
    const items = images.map(url => {
      const full = resolveImageUrl(url);
      const safe = escapeAttribute(full);
      return `<a class="comment-image-link" href="${safe}" target="_blank" rel="noopener noreferrer">
        <img src="${safe}" alt="留言图片" loading="lazy">
      </a>`;
    }).join("");
    return `<div class="comment-images comment-images--n${images.length}">${items}</div>`;
  }

  // ============================================================
  // 图片：本地选择 + 上传 + 预览
  // ============================================================
  async function handleImageSelection(root, event) {
    const input = event.target;
    const files = Array.from(input.files || []);
    if (!files.length) return;

    const message = root.querySelector("#comment-form-message");

    const remaining = MAX_IMAGES - state.selectedImages.length;
    if (remaining <= 0) {
      if (message) showFormMessage(message, `每条留言最多上传 ${MAX_IMAGES} 张图片`, "error");
      input.value = "";
      return;
    }

    if (files.length > remaining) {
      if (message) showFormMessage(message, `每条留言最多上传 ${MAX_IMAGES} 张图片`, "error");
    }

    const toUpload = files.slice(0, remaining);

    for (const file of toUpload) {
      if (!ALLOWED_IMAGE_TYPES.includes(file.type)) {
        if (message) showFormMessage(message, "仅支持 JPG、PNG、WEBP、GIF 图片", "error");
        continue;
      }
      if (file.size > MAX_IMAGE_SIZE) {
        if (message) showFormMessage(message, "单张图片不能超过 3MB", "error");
        continue;
      }

      state.isUploading = true;
      try {
        if (message) showFormMessage(message, "正在上传图片……", "info");
        const data = await uploadCommentImage(file);
        if (data?.url) {
          state.selectedImages.push({ url: data.url, name: data.filename || file.name });
          renderUploadPreview(root);
          if (message) {
            message.hidden = true;
            message.textContent = "";
          }
        }
      } catch (error) {
        console.error("图片上传失败：", error);
        if (message) showFormMessage(message, error.message || "图片上传失败", "error");
      } finally {
        state.isUploading = false;
      }
    }

    input.value = "";
  }

  async function uploadCommentImage(file) {
    const formData = new FormData();
    formData.append("image", file);

    const res = await fetch(UPLOAD_ENDPOINT, {
      method: "POST",
      body: formData,
    });

    let data = null;
    try {
      data = await res.json();
    } catch {
      data = null;
    }

    if (!res.ok || !data || data.success === false) {
      throw new Error((data && data.message) || "图片上传失败");
    }

    return data;
  }

  function renderUploadPreview(root) {
    const box = root.querySelector("#comment-upload-preview");
    if (!box) return;

    if (!state.selectedImages.length) {
      box.hidden = true;
      box.innerHTML = "";
      return;
    }

    box.hidden = false;
    box.innerHTML = state.selectedImages.map((item, index) => {
      const full = resolveImageUrl(item.url);
      const safe = escapeAttribute(full);
      return `
        <div class="comment-upload-item">
          <img src="${safe}" alt="留言图片预览">
          <button type="button" class="comment-upload-remove" data-index="${index}" aria-label="删除图片">×</button>
        </div>
      `;
    }).join("");
  }

  function clearUploadPreview(root) {
    state.selectedImages = [];
    const box = root.querySelector("#comment-upload-preview");
    if (box) {
      box.hidden = true;
      box.innerHTML = "";
    }
    const input = root.querySelector("#comment-image-input");
    if (input) input.value = "";
  }

  // ============================================================
  // 工具方法
  // ============================================================
  async function fetchJson(url, options = {}) {
    const res = await fetch(url, {
      cache: "no-cache",
      ...options,
    });

    let data = null;
    try {
      data = await res.json();
    } catch {
      data = null;
    }

    if (!res.ok) {
      throw new Error(data?.message || `请求失败：${res.status}`);
    }

    return data;
  }

  function showFormMessage(el, text, type) {
    el.hidden = false;
    el.className = `comment-form-message is-${type}`;
    el.textContent = text;
  }

  function normalizeWebsite(value) {
    const raw = String(value || "").trim();
    if (!raw) return "";

    try {
      const url = new URL(raw.startsWith("http://") || raw.startsWith("https://") ? raw : `https://${raw}`);
      if (!["http:", "https:"].includes(url.protocol)) return "";
      return url.href;
    } catch {
      return "";
    }
  }

  function parseTime(value) {
    if (!value) return 0;
    const normalized = String(value).includes("T") ? value : String(value).replace(" ", "T") + "Z";
    const t = new Date(normalized).getTime();
    return Number.isNaN(t) ? 0 : t;
  }

  function formatDate(value) {
    if (!value) return "刚刚";

    const t = parseTime(value);
    if (!t) return String(value).slice(0, 16);

    return new Date(t).toLocaleString("zh-CN", {
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
    });
  }

  function escapeHTML(value) {
    return String(value ?? "").replace(/[&<>"']/g, char => ({
      "&": "&amp;",
      "<": "&lt;",
      ">": "&gt;",
      '"': "&quot;",
      "'": "&#39;",
    }[char]));
  }

  function escapeAttribute(value) {
    return escapeHTML(value).replace(/`/g, "&#96;");
  }
})();
