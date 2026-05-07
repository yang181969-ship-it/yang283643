# 构建与维护脚本说明

所有命令默认在项目根目录运行。`scripts/` 里的脚本大多会修改项目文件,运行前建议先确认 `git status` 干净,方便回退和对比。

## 常用 npm scripts

| 命令 | 作用 |
| --- | --- |
| `npm run dev` | 监听 `css/scss/main.scss`,实时编译到 `css/style.css` |
| `npm run build` | 编译并压缩完整样式到 `css/style.css` |
| `npm run build:critical` | 编译首屏关键样式到 `css/critical.css` |
| `npm run inline:critical` | 把 `css/critical.css` 内联到指定 HTML |
| `npm run build:all` | 依次执行更新索引聚合、站点统计聚合、完整 CSS、critical CSS、critical 内联 |
| `npm run aggregate:updates` | 扫描更新日志 Markdown,生成更新页索引数据 |
| `npm run aggregate:stats` | 聚合站点统计页数据和 Hero 区单点指标 |
| `npm run optimize:animes` | 处理动漫页图片 |
| `npm run optimize:gallery` | 处理画廊图片 |
| `npm run update:refs` | 根据图片重命名映射更新动漫页引用 |
| `npm run optimize:portraits` | 处理人像、装饰图、心情头像 |
| `npm run portrait:rotation` | 生成主页人像每日轮换顺序 |
| `npm run purgecss` | 诊断未使用 CSS |
| `npm run music:add -- ...` | 添加一首或批量添加音乐到播放器歌单 |
| `npm run music:sync` | 扫描 `assets/music/`,把尚未加入歌单的音频自动追加到播放器歌单 |

## 音乐维护

### add-music.mjs

作用:复制一首或多首音频到 `assets/music/`,并追加到 `data/playlist.json`。

同步 `assets/music/` 里的新增文件:

```bash
npm run music:sync
```

先预览同步结果,不写入歌单:

```bash
npm run music:sync -- --dry-run
```

单曲命令:

```bash
npm run music:add -- "assets/music/new-song.mp3" --title "New Song" --artist "Artist"
```

多个文件:

```bash
npm run music:add -- "song-a.mp3" "song-b.mp3" "song-c.mp3"
```

文件夹批量扫描:

```bash
npm run music:add -- "songs" --batch
```

递归扫描文件夹和子文件夹:

```bash
npm run music:add -- "songs" --batch --recursive
```

也可以直接运行:

```bash
node scripts/add-music.mjs "assets/music/new-song.mp3" --title "New Song" --artist "Artist"
```

常用选项:

| 选项 | 说明 |
| --- | --- |
| `--title "歌名"` | 歌名。不填时从文件名推断 |
| `--artist "歌手"` | 歌手。不填时优先从 `歌手 - 歌名.mp3` 推断,否则为 `未知歌手` |
| `--id "track-006"` | 自定义歌曲 id。不填时自动生成下一个 `track-xxx` |
| `--filename "song-name.mp3"` | 指定复制后的文件名。不填时自动生成 |
| `--sync` | 扫描 `assets/music/`,只追加歌单里尚未存在的音频 |
| `--batch` | 把传入的文件夹作为歌曲目录扫描 |
| `--recursive` | 配合 `--batch` 递归扫描子文件夹 |
| `--dry-run` | 只预览,不复制文件也不修改歌单 |

行为说明:

- 支持 `.mp3`、`.m4a`、`.aac`、`.ogg`、`.wav`、`.flac`,网页播放建议优先用 `.mp3`。
- MP3 会优先读取文件元数据里的标题和歌手；读不到时再从文件名推断。
- 如果音频已经在 `assets/music/`,脚本会直接使用现有文件,不会重复复制。
- 批量添加时,建议文件名写成 `歌手 - 歌名.mp3`,脚本会自动拆出歌手和歌名。
- 批量添加时不支持 `--title`、`--id`、`--filename`,因为每首歌都需要不同值。
- 批量添加时可以使用 `--artist "默认歌手"`,给无法从文件名推断歌手的文件兜底。
- 自动写入的字段是 `id`、`title`、`artist`、`src`、`lyric`。
- 歌词暂时统一写成 `"歌词待补充"`。以后确定歌词方案后,再把播放器升级为 `lyricSrc` 按需加载。
- 自动生成文件名发生冲突时,会追加 `-2`、`-3`；如果手动指定 `--filename` 且冲突,脚本会报错,避免覆盖旧文件。

新增音乐的推荐流程:

1. 准备一个音频文件,优先用 `.mp3`。
2. 放进 `assets/music/` 后运行 `npm run music:sync -- --dry-run` 预览。
3. 确认无误后运行 `npm run music:sync`。
4. 打开 `data/playlist.json` 简单检查新增条目。
5. 本地打开主页,测试播放、上一首、下一首和歌单浮层。

如果想从别的位置复制一首歌进来,也可以运行:

```bash
npm run music:add -- "音频路径" --title "歌名" --artist "歌手"
```

然后:

1. 打开 `data/playlist.json` 简单检查新增条目。
2. 本地打开主页,测试播放、上一首、下一首和歌单浮层。

批量新增音乐的推荐流程:

1. 把要添加的音乐放进一个临时文件夹,例如 `songs/`。
2. 尽量把文件名整理成 `歌手 - 歌名.mp3`。
3. 先运行 `npm run music:add -- "songs" --batch --dry-run` 预览。
4. 确认无误后运行 `npm run music:add -- "songs" --batch`。
5. 打开 `data/playlist.json` 和主页播放器检查结果。

## 图片优化脚本

### 1-rename-anime-images.js

命令:

```bash
npm run optimize:animes
```

作用:

- 处理 `assets/animes/` 中的动漫图片。
- 根据脚本内的 `ANIME_RENAME_MAP` 把原图重命名为 `{animeId}-cover.webp`、`{animeId}-1.webp` 等。
- 按图片体积动态选择 WebP 质量。
- WebP 体积收益不足时回退保留原格式。
- 原图移动到 `assets/_originals/animes/`。
- 生成 `scripts/rename-mapping.json`,供 `3-update-html-references.js` 使用。

新增动漫图片时,需要先在脚本里的 `ANIME_RENAME_MAP` 增加条目。

### 2-optimize-gallery.js

命令:

```bash
npm run optimize:gallery
```

作用:

- 扫描 `assets/gallery/` 下的 `jpg`、`jpeg`、`png`。
- 转换为 WebP,保留原文件名主干。
- 小于 50 KB 的图片会跳过。
- WebP 收益不足时保留原图。
- 转换成功的原图移动到 `assets/_originals/gallery/`。

跑完后通常还需要更新画廊数据:

```bash
python generate_gallery_data.py
```

### 3-update-html-references.js

命令:

```bash
npm run update:refs
```

作用:

- 读取 `scripts/rename-mapping.json`。
- 更新 `html/anime.html` 和 `js/anime-detail.js` 里的旧图片路径。
- 修改前会生成 `.bak` 备份。

这个脚本通常在 `npm run optimize:animes` 之后运行。

### 4-optimize-portraits.mjs

命令:

```bash
npm run optimize:portraits
```

作用:

- 处理 `assets/portrait/q`、`assets/portrait/half`、`assets/decoration`、`assets/mood`。
- PNG 带透明通道时使用无损 WebP。
- 不透明 PNG 使用有损 WebP,质量按体积选择。
- 已存在的 WebP 会尝试重编码,只有节省超过约 5% 才替换。
- 原图备份到 `assets/_originals/` 对应目录。
- 如果 PNG 被转成 WebP,脚本会列出需要检查引用的文件名。

### generate-portrait-rotation.mjs

命令:

```bash
npm run portrait:rotation
```

作用:

- 扫描 `assets/portrait/q` 和 `assets/portrait/half`。
- 为两组主页卡片人像生成一个稳定打乱的每日轮换顺序。
- 写入 `data/portrait-rotation.json`,供 `js/home-cards.js` 在首页读取。
- 首页会按浏览器本地日期计算当天图片,并在每天零点后自动刷新。

常用参数:

| 选项 | 说明 |
| --- | --- |
| `--start-date YYYY-MM-DD` | 指定轮换起始日。当天使用顺序里的第 1 张图 |
| `--seed "文本"` | 指定稳定洗牌种子。同一组图片和 seed 会生成同一顺序 |
| `--dry-run` | 只预览生成结果,不写入文件 |

推荐命令:

```bash
npm run portrait:rotation -- --start-date 2026-05-04 --seed portrait-rotation-v1
```

新增、删除或替换 `q` / `half` 图片后,重新运行一次这个命令即可更新轮换数据。

## CSS 与性能脚本

### 4-purgecss.mjs

命令:

```bash
npm run purgecss
```

作用:

- 扫描 `index.html`、`html/**/*.html`、`js/**/*.js`。
- 对 `css/style.css` 做未使用选择器诊断。
- 输出到 `css/purged/style.css`。

注意:这是诊断工具,不在正式构建链路里。Waline、KaTeX、highlight.js 等动态类名已经做了 safelist。

### 5-inline-critical.mjs

命令:

```bash
npm run inline:critical
```

作用:

- 读取 `css/critical.css`。
- 内联到 `index.html`、`html/anime-detail.html`、`html/notes-detail.html`。
- 把完整 `css/style.css` 改成异步加载。
- 修改前会生成 `.bak` 备份。
- 如果检测到已经内联过,会跳过,避免重复插入。

通常由 `npm run build:all` 间接执行。

## 内容维护脚本

### 6-aggregate-updates.mjs

命令:

```bash
npm run aggregate:updates
```

作用:

- 扫描 `content/updates/*.md`。
- 解析每篇更新日志里的标题、`@category`、`@meta`、`@date`、`@summary`、`@tags` 和 `@primary`。
- 老日志没有显式声明 `@summary` / `@tags` / `@primary` 时,会根据标题和 `@meta` 自动推断摘要、标签和主分类。
- 按日期倒序写入 `data/updates-index.json`,供更新页读取。
- 运行结束会输出更新数量、日期范围、tag 分布和 primary 分布,方便检查分类是否合理。

常用 metadata:

| 字段 | 说明 |
| --- | --- |
| `@category: 建站日志` | 更新所属栏目。不填时默认为 `建站日志` |
| `@meta: 新增 / 优化 / 修复...` | 用于展示和自动推断标签的简短说明 |
| `@date: YYYY-MM-DD` | 更新日期。不填时会尝试从文件名推断 |
| `@summary: 文本` | 更新摘要。不填时从正文自动截取 |
| `@tags: feature, mobile` | 细分标签,可用 `feature`、`visual`、`perf`、`fix`、`mobile` |
| `@primary: feature` | 主分类,可用 `feature`、`optimization`、`fix` |

新增或修改 `content/updates/` 里的日志后,重新运行一次这个命令即可刷新更新页索引。

### 7-aggregate-stats.mjs

命令:

```bash
npm run aggregate:stats
```

作用:

- 读取 `data/notes-index.json`、`js/anime-data.js`、画廊数据、`data/updates-index.json` 和可选的 `data/music-stats.json`。
- 写入 `data/stats.json`,供统计页主图和详情卡片读取。
- 写入 `data/site-meta.json`,供统计页 Hero 区展示总内容数、建站天数、最新更新等单点指标。
- 生成笔记分类、番剧状态、番剧题材、画廊分类、更新月份、音乐歌手和评论分布这几组统计源。
- 同一个月份重复运行时会覆盖当月快照,不会重复追加。

注意:评论 / Waline 数据不在脚本里聚合,统计页前端会运行时实时拉取。通常需要先运行 `npm run aggregate:updates`,再运行这个脚本；也可以直接用 `npm run build:all` 一并刷新。

### split-notes.mjs

命令:

```bash
node scripts/split-notes.mjs
```

作用:

- 读取 `data/notes-index.json`。
- 把每个"合集 Markdown"按 `---` 分隔拆成一篇一个文件。
- 拆出的文件写入原 Markdown 同名子目录。
- 根据标题生成安全文件名。
- 重写 `data/notes-index.json`。
- 删除原合集 Markdown 文件。

注意:这个脚本会删除原合集文件,运行前务必确认当前改动已经提交或有备份。

## 数据文件

### rename-mapping.json

这是 `1-rename-anime-images.js` 生成的图片路径映射文件,不是手写脚本。`3-update-html-references.js` 会读取它来替换动漫页和详情页里的图片引用。

### portrait-rotation.json

这是 `generate-portrait-rotation.mjs` 生成的主页人像每日轮换数据。`js/home-cards.js` 会读取其中的 `startDate` 和 `sets.q` / `sets.half`,按当天日期选择首页卡片右下角的人像图片。

这个文件可以手动检查顺序,但通常不建议手写维护。需要换顺序时重新运行:

```bash
npm run portrait:rotation -- --start-date 2026-05-04 --seed portrait-rotation-v1
```

### updates-index.json

这是 `6-aggregate-updates.mjs` 生成的更新页索引数据。更新页会读取其中的 `title`、`date`、`category`、`meta`、`summary`、`tags` 和 `primary` 来渲染列表、筛选和统计。

这个文件通常不手写维护。需要刷新时重新运行:

```bash
npm run aggregate:updates
```

### stats.json

这是 `7-aggregate-stats.mjs` 生成的统计页数据。`js/stats.js` 会读取其中的 `snapshots` 和 `breakdowns`,用于渲染顶部累计图和各类详情卡片。

这个文件通常不手写维护。需要刷新时重新运行:

```bash
npm run aggregate:stats
```

### site-meta.json

这是 `7-aggregate-stats.mjs` 生成的站点单点指标数据。统计页会读取其中的 `siteBirthday`、`totalDays`、`totalContent`、`totals`、`latestUpdate` 和 `newAnimeCount`。

这个文件通常不手写维护。需要刷新时重新运行:

```bash
npm run aggregate:stats
```

### music-stats.json

这是音乐统计的可选来源文件。`7-aggregate-stats.mjs` 会读取其中的 `topArtists`,并透传到 `data/stats.json` 的 `musicTopArtists`。

## 常见工作流

### 新增更新日志

1. 在 `content/updates/` 新增一篇 `YYYY-MM-DD.md`。
2. 写入标题和必要 metadata,例如 `@category`、`@meta`、`@date`。
3. 如需精确控制列表展示,补充 `@summary`、`@tags`、`@primary`。
4. 运行 `npm run aggregate:updates`。
5. 检查 `data/updates-index.json` 和更新页展示。

### 更新站点统计页

```bash
npm run aggregate:updates
npm run aggregate:stats
```

然后检查 `data/stats.json`、`data/site-meta.json` 和统计页展示。如果只改了笔记、番剧、画廊或音乐统计来源,可以只运行 `npm run aggregate:stats`。

### 新增主页音乐

```bash
npm run music:sync -- --dry-run
npm run music:sync
```

批量新增:

```bash
npm run music:add -- "songs" --batch --dry-run
npm run music:add -- "songs" --batch
```

然后检查 `data/playlist.json` 和主页播放器。

### 新增动漫图片

1. 图片放进 `assets/animes/`。
2. 编辑 `scripts/1-rename-anime-images.js` 的 `ANIME_RENAME_MAP`。
3. 编辑 `js/anime-detail.js` 的动漫数据。
4. 编辑 `html/anime.html` 的动漫卡片。
5. 运行 `npm run optimize:animes`。
6. 运行 `npm run update:refs`。
7. 运行 `npm run build`。
8. 检查页面无误后删除 `.bak`。

### 新增画廊图片

1. 图片放进 `assets/gallery/real/` 或 `assets/gallery/anime/`。
2. 运行 `npm run optimize:gallery`。
3. 运行 `python generate_gallery_data.py`。
4. 检查画廊页布局和图片加载。

### 更新主页人像每日轮换

1. 把图片放进 `assets/portrait/q/` 或 `assets/portrait/half/`。
2. 如有需要,先运行 `npm run optimize:portraits` 压缩图片。
3. 运行 `npm run portrait:rotation -- --start-date 2026-05-04 --seed portrait-rotation-v1`。
4. 检查 `data/portrait-rotation.json` 和主页卡片图片显示。

### 重新构建样式与首屏 CSS

```bash
npm run build:all
```

这会先刷新 `data/updates-index.json`、`data/stats.json` 和 `data/site-meta.json`,再构建完整样式和首屏 CSS。检查无误后,可以删除本次生成的 `.bak` 文件。
