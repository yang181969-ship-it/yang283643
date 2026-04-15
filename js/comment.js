let commentCurrentRating = 0;
let commentCurrentImageData = "";

const COMMENT_STORAGE_KEY = "yang181969_comment_board_data";

function initCommentPage() {
  const form = document.getElementById("comment-form");
  const list = document.getElementById("comment-list");
  const starRating = document.getElementById("star-rating");
  const ratingText = document.getElementById("rating-text");
  const imageInput = document.getElementById("image-upload");
  const fileNameText = document.getElementById("file-name");

  if (!form || !list || !starRating || !ratingText || !imageInput || !fileNameText) {
    return;
  }

  commentCurrentRating = 0;
  commentCurrentImageData = "";

  let imagePreview = document.getElementById("comment-image-preview");

  if (!imagePreview) {
    imagePreview = document.createElement("div");
    imagePreview.id = "comment-image-preview";
    imagePreview.className = "comment-image-preview";
    imageInput.parentElement.insertAdjacentElement("afterend", imagePreview);
  }

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
        const rect = star.getBoundingClientRect();
        const offsetX = e.clientX - rect.left;
        const previewRating = offsetX < rect.width / 2 ? i - 0.5 : i;
        updateStarDisplay(previewRating);
      });

      star.addEventListener("click", (e) => {
        const rect = star.getBoundingClientRect();
        const offsetX = e.clientX - rect.left;
        commentCurrentRating = offsetX < rect.width / 2 ? i - 0.5 : i;
        updateStarDisplay(commentCurrentRating);
      });

      starRating.appendChild(star);
    }

    starRating.addEventListener("mouseleave", () => {
      updateStarDisplay(commentCurrentRating);
    });

    updateStarDisplay(commentCurrentRating);
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
    imageInput.addEventListener("change", () => {
      const file = imageInput.files[0];

      if (!file) {
        commentCurrentImageData = "";
        fileNameText.textContent = "未选择文件";
        imagePreview.innerHTML = "";
        return;
      }

      fileNameText.textContent = file.name;

      const reader = new FileReader();
      reader.onload = (e) => {
        commentCurrentImageData = e.target.result;
        imagePreview.innerHTML = `<img src="${commentCurrentImageData}" alt="预览图片">`;
      };
      reader.readAsDataURL(file);
    });
  }

  function bindFormSubmit() {
    form.addEventListener("submit", (e) => {
      e.preventDefault();

      const usernameInput = document.getElementById("comment-username");
      const contentInput = document.getElementById("comment-content");

      const username = usernameInput.value.trim();
      const content = contentInput.value.trim();

      if (!username) {
        alert("请先填写用户名。");
        return;
      }

      if (!content) {
        alert("请输入留言内容。");
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
      commentCurrentImageData = "";
      fileNameText.textContent = "未选择文件";
      imagePreview.innerHTML = "";
      updateStarDisplay(commentCurrentRating);
      renderComments();
    });
  }

  function renderComments() {
    const comments = getComments();

    if (!comments.length) {
      list.innerHTML = `<div class="comment-empty">还没有留言，快来留下第一条建议吧！</div>`;
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
                    <img src="${comment.image}" alt="用户上传图片">
                  </div>`
                : ""
            }
          </article>
        `;
      })
      .join("");
  }
}

function getComments() {
  const raw = localStorage.getItem(COMMENT_STORAGE_KEY);
  return raw ? JSON.parse(raw) : [];
}

function saveComments(comments) {
  localStorage.setItem(COMMENT_STORAGE_KEY, JSON.stringify(comments));
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