# 构建脚本说明

## 图片优化工作流(按数字顺序)

### 1-rename-anime-images.js
- 作用:压缩 `assets/animes/` 并按 id 重命名为 `{id}-cover.webp` / `{id}-N.webp`
- 命令:`npm run optimize:animes`
- 输出:`rename-mapping.json`(给第 3 步用)
- 原图备份到 `assets/_originals/`

### 2-optimize-gallery.js
- 作用:压缩 `assets/gallery/` 的图片,保留原文件名
- 命令:`npm run optimize:gallery`

### 3-update-html-references.js
- 作用:读 `rename-mapping.json`,自动更新 HTML 里的图片引用
- 命令:`npm run update:refs`
- 会生成 `.bak` 备份文件,确认无误后手动删

### 压缩策略(1 和 2 共用)
- 动态质量:>500KB 用 92,200-500KB 用 85,100-200KB 用 82,<100KB 用 78
- PNG 透明图用无损
- webp 反而变大时回退保留原图(.jpg)

---

## 诊断工具

### 4-purgecss.mjs
- 作用:扫描 HTML/JS 找未使用的 CSS 选择器
- 命令:`npm run purgecss`
- 输出:`css/purged/style.css`(诊断用,不是生产文件)
- 结论:2026-04 跑过一次,仅节省 2.1%,证明源码已很精炼,不进构建流程

---

## 新增动漫的标准工作流

1. 图片丢进 `assets/animes/`(中文名随意)
2. 编辑 `1-rename-anime-images.js` 的 `ANIME_RENAME_MAP` 加条目
3. 编辑 `js/anime-detail.js` 的 `animeData` 加条目
4. 编辑 `html/anime.html` 加 `anime-item` 卡片
5. 跑:`npm run optimize:animes` → `npm run update:refs` → `npm run build`
6. 确认无误后删 `.bak` 文件 → `git push`

## 新增画廊图的简化工作流

1. 图片丢进 `assets/gallery/real/` 或 `assets/gallery/anime/`
2. 跑:`npm run optimize:gallery` → `python generate_gallery_data.py`