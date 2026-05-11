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
    isSubmitting: false,
    rating: 5,
  };

  function initCommentPage() {
    const root = document.getElementById("custom-comment-root");
    if (!root) return;

    renderShell(root);
    bindEvents(root);
    loadComments(root, 1);
  }

  window.initCommentPage = initCommentPage;

  function renderShell(root) {
    root.innerHTML = `
      <section class="comment-compose card" aria-labelledby="comment-compose-title">
        <div class="comment-compose-head">
          <div>
            <p class="comment-kicker">LEAVE A MESSAGE</p>
            <h3 id="comment-compose-title">写下你的留言</h3>
          </div>
          <p class="comment-compose-tip">支持 0–5 星评分，最小单位 0.5。</p>
        </div>

        <form class="comment-form" id="comment-form">
          <div class="comment-form-grid">
            <label class="comment-field">
              <span>昵称</span>
              <input
                id="comment-nickname"
                name="nickname"
                type="text"
                maxlength="24"
                autocomplete="nickname"
                placeholder="访客"
              >
            </label>

            <label class="comment-field">
              <span>邮箱</span>
              <input
                id="comment-email"
                name="email"
                type="email"
                autocomplete="email"
                placeholder="可选，不会公开显示"
              >
            </label>

            <label class="comment-field comment-field--wide">
              <span>网站</span>
              <input
                id="comment-website"
                name="website"
                type="url"
                autocomplete="url"
                placeholder="可选，例如 https://example.com"
              >
            </label>
          </div>

          <div class="comment-rating" aria-label="评分">
            <span class="comment-rating-label">评分</span>
            <div class="comment-rating-stars" id="comment-rating-stars"></div>
            <span class="comment-rating-value" id="comment-rating-value">5.0</span>
          </div>

          <label class="comment-field comment-field--content">
            <span>留言内容</span>
            <textarea
              id="comment-content"
              name="content"
              maxlength="1000"
              rows="6"
              required
              placeholder="写点什么吧……"
            ></textarea>
          </label>

          <div class="comment-form-footer">
            <p class="comment-form-note">请友善交流。留言提交后会保存到本站自研留言数据库。</p>
            <button class="comment-submit-btn" type="submit" id="comment-submit-btn">
              提交留言
            </button>
          </div>

          <div class="comment-form-message" id="comment-form-message" hidden></div>
        </form>
      </section>

      <section class="comment-list-section card" aria-labelledby="comment-list-title">
        <div class="comment-list-head">
          <div>
            <p class="comment-kicker">RECENT COMMENTS</p>
            <h3 id="comment-list-title">最近留言</h3>
          </div>
          <button type="button" class="comment-refresh-btn" id="comment-refresh-btn">刷新</button>
        </div>

        <div id="comment-list" class="comment-list">
          <article class="comment-status-card is-loading">
            <div class="comment-status-title">正在加载留言</div>
            <div class="comment-status-text">请稍候……</div>
          </article>
        </div>

        <div class="comment-pagination" id="comment-pagination" hidden>
          <button type="button" id="comment-prev-page">上一页</button>
          <span id="comment-page-info"></span>
          <button type="button" id="comment-next-page">下一页</button>
        </div>
      </section>
    `;

    renderRatingStars(root);
  }

  function bindEvents(root) {
    const form = root.querySelector("#comment-form");
    const refreshBtn = root.querySelector("#comment-refresh-btn");
    const prevBtn = root.querySelector("#comment-prev-page");
    const nextBtn = root.querySelector("#comment-next-page");

    form?.addEventListener("submit", async (event) => {
      event.preventDefault();
      await submitComment(root);
    });

    refreshBtn?.addEventListener("click", () => loadComments(root, state.page));

    prevBtn?.addEventListener("click", () => {
      if (state.page > 1) loadComments(root, state.page - 1);
    });

    nextBtn?.addEventListener("click", () => {
      if (state.page < state.totalPages) loadComments(root, state.page + 1);
    });
  }

  function renderRatingStars(root) {
    const box = root.querySelector("#comment-rating-stars");
    const valueEl = root.querySelector("#comment-rating-value");
    if (!box || !valueEl) return;

    box.innerHTML = "";

    for (let i = 1; i <= 10; i += 1) {
      const value = i / 2;
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "comment-rating-dot";
      btn.dataset.value = String(value);
      btn.setAttribute("aria-label", `${value} 分`);
      btn.textContent = value <= state.rating ? "★" : "☆";
      btn.addEventListener("click", () => {
        state.rating = value;
        valueEl.textContent = value.toFixed(1);
        renderRatingStars(root);
      });
      box.appendChild(btn);
    }
  }

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

      const comments = data.data?.comments || [];
      const pagination = data.data?.pagination || {};

      state.page = pagination.page || page;
      state.totalPages = pagination.totalPages || 0;

      renderCommentList(root, comments);
      renderPagination(root, pagination);
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

  function renderCommentList(root, comments) {
    const list = root.querySelector("#comment-list");
    if (!list) return;

    if (!comments.length) {
      list.innerHTML = `
        <article class="comment-empty">
          <div class="comment-empty-icon">…</div>
          <h4>还没有留言</h4>
          <p>第一条留言等你来写。</p>
        </article>
      `;
      return;
    }

    list.innerHTML = comments.map(comment => renderCommentItem(comment)).join("");
  }

  function renderCommentItem(comment) {
    const nickname = escapeHTML(comment.nickname || "访客");
    const content = escapeHTML(comment.content || "").replace(/\n/g, "<br>");
    const website = normalizeWebsite(comment.website);
    const rating = typeof comment.rating === "number" ? comment.rating : null;
    const date = formatDate(comment.created_at);
    const letter = nickname.trim().slice(0, 1).toUpperCase() || "访";

    return `
      <article class="comment-item">
        <div class="comment-avatar" aria-hidden="true">${escapeHTML(letter)}</div>
        <div class="comment-item-main">
          <header class="comment-item-head">
            <div>
              <div class="comment-author-row">
                ${website
                  ? `<a class="comment-author" href="${escapeAttribute(website)}" target="_blank" rel="noopener noreferrer">${nickname}</a>`
                  : `<span class="comment-author">${nickname}</span>`
                }
                <span class="comment-role-badge">Guest</span>
              </div>
              <time class="comment-time">${escapeHTML(date)}</time>
            </div>
            ${rating !== null ? `<div class="comment-item-rating" aria-label="评分 ${rating} 分">${renderRatingText(rating)}</div>` : ""}
          </header>
          <div class="comment-content">${content}</div>
        </div>
      </article>
    `;
  }

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

  async function submitComment(root) {
    if (state.isSubmitting) return;

    const form = root.querySelector("#comment-form");
    const submitBtn = root.querySelector("#comment-submit-btn");
    const message = root.querySelector("#comment-form-message");
    if (!form || !submitBtn || !message) return;

    const payload = {
      nickname: form.nickname.value.trim() || "访客",
      email: form.email.value.trim(),
      website: form.website.value.trim(),
      content: form.content.value.trim(),
      rating: state.rating,
    };

    if (!payload.content) {
      showFormMessage(message, "留言内容不能为空。", "error");
      return;
    }

    state.isSubmitting = true;
    submitBtn.disabled = true;
    submitBtn.textContent = "提交中……";
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

      form.reset();
      state.rating = 5;
      renderRatingStars(root);
      root.querySelector("#comment-rating-value").textContent = "5.0";

      showFormMessage(message, "留言提交成功。", "success");
      await loadComments(root, 1);
    } catch (error) {
      console.error("留言提交失败：", error);
      showFormMessage(message, error.message || "留言提交失败，请稍后再试。", "error");
    } finally {
      state.isSubmitting = false;
      submitBtn.disabled = false;
      submitBtn.textContent = "提交留言";
    }
  }

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

  function formatDate(value) {
    if (!value) return "刚刚";

    const normalized = String(value).includes("T") ? value : String(value).replace(" ", "T") + "Z";
    const date = new Date(normalized);

    if (Number.isNaN(date.getTime())) return String(value).slice(0, 16);

    return date.toLocaleString("zh-CN", {
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
    });
  }

  function renderRatingText(value) {
    const full = Math.floor(value);
    const half = value % 1 >= 0.5;
    const empty = 5 - full - (half ? 1 : 0);
    return `${"★".repeat(full)}${half ? "☆" : ""}${"·".repeat(Math.max(empty, 0))} <span>${value.toFixed(1)}</span>`;
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
