// ============================================================
// 自研留言系统前端
// API: https://comment.yang181969.com/api/comments
// ============================================================

(function () {
  "use strict";

  const COMMENT_API_BASE = "https://comment.yang181969.com";
  const COMMENTS_ENDPOINT = `${COMMENT_API_BASE}/api/comments`;

  const state = {
    page: 1,
    pageSize: 20,
    totalPages: 0,
    totalComments: 0,
    isSubmitting: false,
    activeTab: "all",
    rawComments: [],
    replyTarget: null, // { commentId, name }
  };

  function initCommentPage() {
    const root = document.querySelector(".comment-page");
    if (!root) return;

    bindEvents(root);
    loadComments(root, 1);
    syncComposerCollapsed(root);
  }

  window.initCommentPage = initCommentPage;

  // ============================================================
  // 事件绑定
  // ============================================================
  function bindEvents(root) {
    const refreshBtn = root.querySelector("#comment-refresh-btn");
    const prevBtn = root.querySelector("#comment-prev-page");
    const nextBtn = root.querySelector("#comment-next-page");
    const tabs = root.querySelectorAll(".comment-tab");
    const composer = root.querySelector("#comment-composer");
    const textarea = root.querySelector("#comment-content");
    const cancelReplyBtn = root.querySelector("#comment-composer-cancel");
    const list = root.querySelector("#comment-list");

    refreshBtn?.addEventListener("click", () => loadComments(root, state.page));

    prevBtn?.addEventListener("click", () => {
      if (state.page > 1) loadComments(root, state.page - 1);
    });

    nextBtn?.addEventListener("click", () => {
      if (state.page < state.totalPages) loadComments(root, state.page + 1);
    });

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

    // 列表内事件委托：回复 / 点赞
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
        likeBtn.classList.toggle("is-liked");
      }
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
      renderPagination(root, pagination);
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
      replyToName: raw.reply_to_name || raw.replyToName || "",
    };
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
      : `<span class="comment-role-badge">Guest</span>`;
    const website = normalizeWebsite(comment.website);
    const authorEl = website
      ? `<a class="comment-author" href="${escapeAttribute(website)}" target="_blank" rel="noopener noreferrer">${nickname}</a>`
      : `<span class="comment-author">${nickname}</span>`;

    const repliesHtml = comment.replies.length
      ? `<div class="comment-replies">${comment.replies.map(r => renderReplyItem(r)).join("")}</div>`
      : "";

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
          </header>
          <div class="comment-content">${content}</div>
          <div class="comment-item__actions">
            <button type="button" class="comment-action" data-action="reply" data-comment-id="${escapeAttribute(comment.id)}" data-comment-name="${safeName}">
              <span class="comment-action__icon comment-action__icon--reply" aria-hidden="true"></span>
              回复
            </button>
            <button type="button" class="comment-action" data-action="like" data-comment-id="${escapeAttribute(comment.id)}">
              <span class="comment-action__icon comment-action__icon--like" aria-hidden="true"></span>
              点赞${comment.likes ? `(${comment.likes})` : ""}
            </button>
          </div>
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
      : `<span class="comment-role-badge">Guest</span>`;
    const website = normalizeWebsite(reply.website);
    const authorEl = website
      ? `<a class="comment-author" href="${escapeAttribute(website)}" target="_blank" rel="noopener noreferrer">${nickname}</a>`
      : `<span class="comment-author">${nickname}</span>`;
    const mention = replyToName
      ? `<span class="comment-mention">@${replyToName}</span> `
      : "";

    return `
      <article class="comment-reply${isAdmin ? " is-owner" : ""}" data-id="${escapeAttribute(reply.id)}">
        <div class="comment-avatar comment-avatar--sm" aria-hidden="true">${escapeHTML(letter)}</div>
        <div class="comment-reply__main">
          <header class="comment-reply__head">
            ${authorEl}
            ${roleBadge}
            <span class="comment-item__sep" aria-hidden="true">·</span>
            <time class="comment-time">${escapeHTML(date)}</time>
          </header>
          <div class="comment-content">${mention}${content}</div>
          <div class="comment-item__actions">
            <button type="button" class="comment-action" data-action="reply" data-comment-id="${escapeAttribute(reply.id)}" data-comment-name="${safeName}">
              <span class="comment-action__icon comment-action__icon--reply" aria-hidden="true"></span>
              回复
            </button>
            <button type="button" class="comment-action" data-action="like" data-comment-id="${escapeAttribute(reply.id)}">
              <span class="comment-action__icon comment-action__icon--like" aria-hidden="true"></span>
              点赞${reply.likes ? `(${reply.likes})` : ""}
            </button>
          </div>
        </div>
      </article>
    `;
  }

  // ============================================================
  // 分页
  // ============================================================
  function renderPagination(root, pagination) {
    const wrap = root.querySelector("#comment-pagination");
    const info = root.querySelector("#comment-page-info");
    const prev = root.querySelector("#comment-prev-page");
    const next = root.querySelector("#comment-next-page");

    if (!wrap || !info || !prev || !next) return;

    const totalPages = pagination.totalPages || 0;

    if (totalPages <= 1) {
      wrap.hidden = true;
      return;
    }

    wrap.hidden = false;
    info.textContent = `${pagination.page || 1} / ${totalPages}`;
    prev.disabled = (pagination.page || 1) <= 1;
    next.disabled = (pagination.page || 1) >= totalPages;
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
    };

    if (state.replyTarget) {
      payload.parent_id = state.replyTarget.commentId;
      payload.reply_to_name = state.replyTarget.name;
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
