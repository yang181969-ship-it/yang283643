const animeData = {
  majo: {
    title: "魔女之旅",
    image: "../assets/animes/魔女之旅2.jpg",
    description: "讲述了魔女伊蕾娜在世界各地旅行时，与形形色色的人物相遇、经历相逢与离别的故事",
    info: [
      "题材：奇幻 / 公路 / 旅行",
      "主角：伊蕾娜",
    ],
    gallery: [
      "../assets/animes/魔女之旅.jpg",
      "../assets/animes/魔女之旅1.jpg",
      "../assets/animes/魔女之旅2.jpg",
      "../assets/animes/魔女之旅3.jpg"
    ],
    links: [
      { text: "观影链接", url: "https://yhdm6.top/v/3398.html" },
    ]
  },

  frieren: {
    title: "葬送的芙莉莲",
    image: "../assets/animes/葬送的芙莉莲.jpg",
    description: "讲述精灵魔法使芙莉莲在勇者辛美尔去世后重新踏上旅程，通过与人类同伴的互动，逐渐理解生命的意义与记忆的价值",
    info: [
      "题材：奇幻 / 冒险 / 治愈",
      "主角：芙莉莲",
    ],
    gallery: [
      "../assets/animes/葬送的芙莉莲.jpg",
      "../assets/animes/葬送的芙莉莲1.jpg",
      "../assets/animes/葬送的芙莉莲2.jpg",
      "../assets/animes/葬送的芙莉莲3.jpg"
    ],
    links: [
      { text: "观影链接", url: "https://yhdm6.top/v/22881.html" },
    ]
  },

  garden: {
    title: "紫罗兰永恒花园",
    image: "../assets/animes/紫罗兰永恒花园.jpg",
    description: "暂无",
    info: [
      "题材：治愈 / 奇幻 / 日常",
      "主角：薇尔莉特·伊芙加登",
    ],
    gallery: [
      "../assets/animes/紫罗兰永恒花园.jpg",
      "../assets/animes/紫罗兰永恒花园1.jpg",
      "../assets/animes/紫罗兰永恒花园2.jpg"  
    ],
    links: [
      { text: "观影链接", url: "https://yhdm6.top/vsh/%E7%B4%AB%E7%BD%97%E5%85%B0%E6%B0%B8%E6%81%92%E8%8A%B1%E5%9B%AD-------------.html" },
    ]
  },

  slayer: {
    title: "鬼灭之刃",
    image: "../assets/animes/鬼灭之刃.jpg",
    description: "时值日本大正时代，灶门炭治郎原本是个善良的卖炭少年，但家人被鬼杀害后，他的日常生活发生了翻天覆地的变化。炭治郎家人中唯一的幸存者是他的妹妹灶门祢豆子，但祢豆子已变成了凶暴的鬼。为了让祢豆子恢复原状，并杀掉害死家人的鬼，炭治郎和祢豆子踏上了旅程",
    info: [
      "题材：热血 / 战斗 / 奇幻",
      "主角：炭治郎",
    ],
    gallery: [
      "../assets/animes/鬼灭之刃.jpg",
      "../assets/animes/鬼灭之刃1.jpg",
      "../assets/animes/鬼灭之刃2.jpg"  
    ],
    links: [
      { text: "观影链接", url: "https://yhdm6.top/vsh/-------------.html?wd=%E9%AC%BC%E7%81%AD%E4%B9%8B%E5%88%83&submit=" },
    ]
  },

  spy: {
    title: "间谍过家家",
    image: "../assets/animes/间谍过家家.jpg",
    description: "为了潜入名校，西国能力最强的间谍“黄昏”被下令组建家庭。但是，他的“女儿”居然是能够读取他人内心的超能力者，“妻子”是暗杀者？互相隐藏了真实身份的新家庭，面临考验与世界危机的痛快家庭喜剧就此展开",
    info: [
      "题材：战斗 / 搞笑 / 日常",
      "主角：阿尼亚，黄昏，约尔",
    ],
    gallery: [
      "../assets/animes/间谍过家家.jpg",
      "../assets/animes/间谍过家家1.jpg",
      "../assets/animes/间谍过家家2.jpg" ,
      "../assets/animes/间谍过家家3.jpg" 
    ],
    links: [
      { text: "观影链接", url: "https://yhdm6.top/vsh/-------------.html?wd=%E9%97%B4%E8%B0%8D%E8%BF%87%E5%AE%B6%E5%AE%B6&submit=" },
    ]
  },

  titan: {
    title: "进击的巨人",
    image: "../assets/animes/进击的巨人.jpg",
    description: "那一天，人类想起了被他们支配的恐惧",
    info: [
      "题材：热血 / 奇幻 / 神作",
      "主角：艾伦·耶格尔",
    ],
    gallery: [
      "../assets/animes/进击的巨人.jpg",
      "../assets/animes/进击的巨人1.jpg",
      "../assets/animes/进击的巨人2.jpg",
      "../assets/animes/进击的巨人3.jpg"
    ],
    links: [
      { text: "观影链接", url: "https://yhdm6.top/vsh/-------------.html?wd=%E8%BF%9B%E5%87%BB%E7%9A%84%E5%B7%A8%E4%BA%BA&submit=" },
    ]
  },
};

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
      galleryBox.appendChild(img);
    });
  }

  const linksList = document.getElementById("anime-links");
  linksList.innerHTML = "";
  anime.links.forEach(link => {
    const li = document.createElement("li");
    const a = document.createElement("a");
    a.href = link.url;
    a.target = "_blank";
    a.textContent = link.text;
    li.appendChild(a);
    linksList.appendChild(li);
  });
}

document.addEventListener("DOMContentLoaded", () => {
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