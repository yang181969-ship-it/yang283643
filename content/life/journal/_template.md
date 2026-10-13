# 日记标题

@date: 2026-01-01
@summary: 一两句话的摘要，显示在日记卡片上。不写时自动取正文第一段。
@tags: 日常, 学习
@cover: assets/life/journal/example.webp

以 _ 开头的文件不会被收录，这个文件只是模板。

新建日记：复制本文件为 content/life/journal/2026-01-01-slug.md（文件名即唯一标识），
修改上面的字段并写正文，然后运行 npm run life:data（或 npm run build:all）。

正文支持：段落、## 二级标题、### 三级标题、- 列表、**加粗**、`行内代码`、代码块、表格，
以及独占一行的图片 ![说明](assets/...)。
