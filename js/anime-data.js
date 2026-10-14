// ============================================================
// js/anime-data.js
// 动漫数据源（Life「作品 → 动漫」、主页生活片段、全站搜索、统计脚本共用）
//
// 当前没有收录作品：空对象是合法数据，各读取端会显示对应的空状态。
//
// 新增条目时追加到末尾，键名即作品 id（字母、数字、连字符），字段：
//   title        作品名称（必填）
//   image        封面路径，例如 "../assets/animes/<id>-cover.webp"
//   watchStatus  "watched" 已看 | "watching" 在看 | "wishlist" 想看
//   badge        封面角标 "upcoming" 待更新 | "ongoing" 连载中 | "finished" 已完结 | "movie" 电影
//   order        列表排序（小在前）；可选 rating: 0–10
//   link         可选的详情地址（站内路径或外部链接）；留空时卡片不跳转
//   description  简介（搜索使用）
//   info         ["题材：…", "主角：…"]（搜索与统计使用）
//   gallery      作品插图路径数组（npm run life:data 收入统一图片索引）
//   updateDate   "YYYY-MM-DD"（主页按它取最近的作品）
// 注意：不要使用 status 字段名，统计脚本把 status 当作中文分组标签。
// ============================================================

const animeData = {};
