// ============================================================
// js/anime-detail.js
// 动漫详情页业务逻辑（Commit 6 起，animeData 已抽到 anime-data.js）
// ============================================================

function getAnimeId() {
  const params = new URLSearchParams(window.location.search);
  return params.get("id");
}

function renderAnimeDetail() {
  const id = getAnimeId();
  const anime = animeData[id];

  if (!anime) {
    document.getElementById("anime-title").textContent = "未找到该动漫";
    document.getElementById("anime-description").textContent = "请返回动漫列表重新选择。";
    return;
  }

  document.title = anime.title;
  document.getElementById("anime-title").textContent = anime.title;

  const image = document.getElementById("anime-image");
  image.src = anime.image;
  image.alt = anime.title;
  image.loading = "eager";

  document.getElementById("anime-description").textContent = anime.description;

  const infoList = document.getElementById("anime-info");
  infoList.innerHTML = "";
  anime.info.forEach(item => {
    const li = document.createElement("li");
    li.textContent = item;
    infoList.appendChild(li);
  });

  const galleryBox = document.getElementById("anime-gallery");
  galleryBox.innerHTML = "";
  if (anime.gallery && anime.gallery.length > 0) {
    anime.gallery.forEach(src => {
      const img = document.createElement("img");
      img.src = src;
      img.alt = anime.title;
      img.loading = "lazy";
      galleryBox.appendChild(img);
    });
  }
}

document.addEventListener("DOMContentLoaded", () => {
  // 早退保护：主页若误加载本脚本（不应发生），不要污染主页 DOM
  if (!document.getElementById("anime-title")) return;
  renderAnimeDetail();
  enableImageLightbox();
});

function enableImageLightbox() {
  const lightbox = document.getElementById("image-lightbox");
  const lightboxImage = document.getElementById("lightbox-image");
  const closeBtn = document.getElementById("lightbox-close");

  if (!lightbox || !lightboxImage || !closeBtn) return;

  const clickableImages = document.querySelectorAll(
    ".anime-detail-cover img, .anime-extra-gallery img"
  );

  clickableImages.forEach(img => {
    img.addEventListener("click", () => {
      lightboxImage.src = img.src;
      lightboxImage.alt = img.alt || "";
      lightbox.classList.add("show");
      document.body.style.overflow = "hidden";
    });
  });

  function closeLightbox() {
    lightbox.classList.remove("show");
    document.body.style.overflow = "";
  }

  closeBtn.addEventListener("click", closeLightbox);

  lightbox.addEventListener("click", (e) => {
    if (e.target === lightbox) {
      closeLightbox();
    }
  });

  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape") {
      closeLightbox();
    }
  });
}