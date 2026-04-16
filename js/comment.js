const COMMENT_STORAGE_KEY = "yang181969_comment_board_data";
const COMMENT_MAX_IMAGE_SIZE = 3 * 1024 * 1024; // 3MB

// ===== Waline 配置 =====
const WALINE_SERVER_URL = "https://yang283643-waline.vercel.app";

// 以后如果你要接图床 / 上传 API，就把这个地址改成你的接口
const COMMENT_IMAGE_UPLOAD_API = "";

let commentCurrentRating = 0;
let commentCurrentImageData = "";
let walineInstance = null;

/**
 * 留言板页面初始化
 * 供 main.js 中 runPageInit("comment") 调用
 */
function initCommentPage() {
  const localMode = document.getElementById("comment-local-mode");
  const walineMode = document.getElementById("comment-waline-mode");
  const walineEl = document.getElementById("waline");

  // 新版双模式结构：优先走 Waline
  if (walineMode && walineEl) {
    if (WALINE_SERVER_URL) {
      if (localMode) localMode.style.display = "none";
      walineMode.style.display = "";
      initWalineComment();
      return;
    }

    if (localMode) localMode.style.display = "";
    walineMode.style.display = "none";
    initLocalCommentBoard();
    return;
  }

  // 旧版单模式结构：没有双模式容器时，继续本地留言
  initLocalCommentBoard();
}

function initLocalCommentBoard() {
  const form = document.getElementById("comment-form");
  const list = document.getElementById("comment-list");
  const starRating = document.getElementById("star-rating");
  const ratingText = document.getElementById("rating-text");
  const imageInput = document.getElementById("image-upload");
  const fileNameText = document.getElementById("file-name");
  let imagePreview = document.getElementById("comment-image-preview");

  if (
    !form ||
    !list ||
    !starRating ||
    !ratingText ||
    !imageInput ||
    !fileNameText
  ) {
    return;
  }

  if (!imagePreview) {
    imagePreview = document.createElement("div");
    imagePreview.id = "comment-image-preview";
    imagePreview.className = "comment-image-preview";
    imageInput.parentElement.insertAdjacentElement("afterend", imagePreview);
  }

  commentCurrentRating = 0;
  commentCurrentImageData = "";

  renderStarRating();
  bindImagePreview();
  bindFormSubmit();
  renderComments();

  function renderStarRating() {
    starRating.innerHTML = "";

    for (let i = 1; i <= 5; i++) {
      const star = document.createElement("div");
      star.className = "star-item";
      star.dataset.star = String(i);

      star.innerHTML = `
        <span class="star-bg">★</span>
        <span class="star-fill">★</span>
      `;

      star.addEventListener("mousemove", (e) => {
        const previewRating = getHalfStarValue(e, star, i);
        updateStarDisplay(previewRating);
      });

      star.addEventListener("click", (e) => {
        commentCurrentRating = getHalfStarValue(e, star, i);
        updateStarDisplay(commentCurrentRating);
      });

      starRating.appendChild(star);
    }

    starRating.onmouseleave = () => {
      updateStarDisplay(commentCurrentRating);
    };

    updateStarDisplay(commentCurrentRating);
  }

  function getHalfStarValue(event, starElement, starIndex) {
    const rect = starElement.getBoundingClientRect();
    const offsetX = event.clientX - rect.left;
    return offsetX < rect.width / 2 ? starIndex - 0.5 : starIndex;
  }

  function updateStarDisplay(tempRating) {
    const stars = starRating.querySelectorAll(".star-item");

    stars.forEach((star, index) => {
      const fill = star.querySelector(".star-fill");
      const starNumber = index + 1;

      let fillPercent = 0;

      if (tempRating >= starNumber) {
        fillPercent = 100;
      } else if (tempRating >= starNumber - 0.5) {
        fillPercent = 50;
      } else {
        fillPercent = 0;
      }

      fill.style.width = `${fillPercent}%`;
    });

    ratingText.textContent = `当前评分：${tempRating} 星`;
  }

  function bindImagePreview() {
    imageInput.onchange = () => {
      const file = imageInput.files && imageInput.files[0];

      if (!file) {
        resetImageState();
        return;
      }

      if (!file.type.startsWith("image/")) {
        alert("请选择图片文件。");
        imageInput.value = "";
        resetImageState();
        return;
      }

      if (file.size > COMMENT_MAX_IMAGE_SIZE) {
        alert("图片不能超过 3MB。");
        imageInput.value = "";
        resetImageState();
        return;
      }

      fileNameText.textContent = file.name;

      const reader = new FileReader();

      reader.onload = (e) => {
        const result = e.target && e.target.result;
        if (typeof result !== "string") {
          alert("图片读取失败，请重新选择。");
          imageInput.value = "";
          resetImageState();
          return;
        }

        commentCurrentImageData = result;
        imagePreview.innerHTML = `<img src="${result}" alt="预览图片">`;
      };

      reader.onerror = () => {
        alert("图片读取失败，请重新选择。");
        imageInput.value = "";
        resetImageState();
      };

      reader.readAsDataURL(file);
    };
  }

  function resetImageState() {
    commentCurrentImageData = "";
    fileNameText.textContent = "未选择文件";
    imagePreview.innerHTML = "";
  }

  function bindFormSubmit() {
    form.onsubmit = (e) => {
      e.preventDefault();

      const usernameInput = document.getElementById("comment-username");
      const contentInput = document.getElementById("comment-content");

      if (!usernameInput || !contentInput) return;

      const username = usernameInput.value.trim();
      const content = contentInput.value.trim();

      if (!username) {
        alert("请先填写用户名。");
        usernameInput.focus();
        return;
      }

      if (!content) {
        alert("请输入留言内容。");
        contentInput.focus();
        return;
      }

      const comments = getComments();

      const newComment = {
        id: Date.now(),
        username,
        content,
        rating: commentCurrentRating,
        image: commentCurrentImageData,
        time: formatTime(new Date())
      };

      comments.unshift(newComment);
      saveComments(comments);

      form.reset();
      commentCurrentRating = 0;
      resetImageState();
      updateStarDisplay(commentCurrentRating);
      renderComments();
    };
  }

  function renderComments() {
    const comments = getComments();

    if (!comments.length) {
      list.innerHTML =
        '<div class="comment-empty">还没有留言，快来留下第一条建议吧！</div>';
      return;
    }

    list.innerHTML = comments
      .map((comment) => {
        return `
          <article class="comment-card">
            <div class="comment-card-header">
              <div class="comment-username">${escapeHTML(comment.username)}</div>
              <div class="comment-time">${escapeHTML(comment.time)}</div>
            </div>

            <div class="comment-score">${renderStarDisplay(comment.rating)}</div>

            <div class="comment-text">${escapeHTML(comment.content)}</div>

            ${
              comment.image
                ? `<div class="comment-image-box">
                    <img src="${comment.image}" alt="用户上传图片" loading="lazy">
                  </div>`
                : ""
            }
          </article>
        `;
      })
      .join("");
  }
}

/**
 * Waline 初始化
 */
function initWalineComment() {
  const walineEl = document.getElementById("waline");
  if (!walineEl) return;

  const currentPath = window.location.pathname + window.location.search;

  if (walineInstance) {
    walineInstance.update({
      path: currentPath
    });
    return;
  }

  import("https://unpkg.com/@waline/client@v3/dist/waline.js")
    .then(({ init }) => {
      walineInstance = init({
        el: "#waline",
        serverURL: WALINE_SERVER_URL,
        path: currentPath,
        lang: "zh-CN",
        login: "enable",
        commentSorting: "latest",
        pageSize: 10,
        meta: ["nick", "mail", "link"],
        requiredMeta: ["nick"],
        wordLimit: 500,
        dark: "auto",
        imageUploader: COMMENT_IMAGE_UPLOAD_API ? uploadCommentImage : false
      });
    })
    .catch((error) => {
      console.error("Waline 加载失败：", error);
      walineEl.innerHTML = `
        <div class="comment-empty">留言系统加载失败，请稍后再试。</div>
      `;
    });
}

/**
 * 预留给 Waline 的图片上传函数
 * 部署图床 / 上传接口后可直接启用
 */
async function uploadCommentImage(file) {
  if (!COMMENT_IMAGE_UPLOAD_API) {
    throw new Error("图片上传接口未配置");
  }

  const formData = new FormData();
  formData.append("file", file);

  const response = await fetch(COMMENT_IMAGE_UPLOAD_API, {
    method: "POST",
    body: formData
  });

  if (!response.ok) {
    throw new Error("图片上传失败");
  }

  const data = await response.json();

  if (!data || !data.url) {
    throw new Error("服务器未返回图片地址");
  }

  return data.url;
}

function getComments() {
  const raw = localStorage.getItem(COMMENT_STORAGE_KEY);

  if (!raw) return [];

  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch (error) {
    console.error("留言数据解析失败：", error);
    return [];
  }
}

function saveComments(comments) {
  try {
    localStorage.setItem(COMMENT_STORAGE_KEY, JSON.stringify(comments));
  } catch (error) {
    console.error("留言保存失败：", error);
    alert("保存失败，可能是图片过大或本地存储空间不足。");
  }
}

function formatTime(date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  const hour = String(date.getHours()).padStart(2, "0");
  const minute = String(date.getMinutes()).padStart(2, "0");

  return `${year}-${month}-${day} ${hour}:${minute}`;
}

function renderStarDisplay(score) {
  const fullStars = Math.floor(score);
  const hasHalf = score % 1 !== 0;
  const emptyStars = 5 - fullStars - (hasHalf ? 1 : 0);

  let result = "★".repeat(fullStars);

  if (hasHalf) {
    result += "☆";
  }

  result += "✩".repeat(emptyStars);

  return `${result}（${score} / 5）`;
}

function escapeHTML(str) {
  return String(str)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}