# 网站标签参考

整理日期：2026-10-15

> 这个文件由 `npm run tags:sync` 自动生成，请不要手动编辑。

这个文件用于记录当前网站里已经出现或已经配置好的标签，方便以后新增内容时保持命名统一。统计来源以现有数据文件和页面筛选项为准。

## 动漫

数据来源：

- `js/anime-data.js` 的 `info` 字段，主要来自 `题材：...`
- `js/anime-data.js` 的 `badge` 字段（卡片状态徽章）

### 已使用题材标签

暂无。

### 卡片状态徽章

暂无。

## 笔记

数据来源：

- `data/notes-index.json` 的 `category`
- `html/notes.html` 的侧边栏分类筛选

### 当前已有内容分类

| 分类 | 使用次数 |
| --- | ---: |
| 电磁学 | 2 |
| 微积分 | 2 |
| 线性代数 | 2 |
| 公式渲染 | 1 |
| 组合数学 | 1 |

### 页面已配置但暂无内容的分类

| 分类 | 所属分组 |
| --- | --- |
| 抽象代数 | 数学 |
| 可视化 | 工具 |
| 力学 | 物理 |
| 量子 | 物理 |
| 趣题 | 数学 / 物理 |

## 更新

数据来源：

- `data/updates-index.json` 的 `category`、`tags`、`primary`
- `html/update.html` 的筛选按钮
- `js/update.js` 的标签显示文案

### 当前已有内容分类

| 分类 | 使用次数 |
| --- | ---: |
| 建站日志 | 18 |

### 当前已使用标签

| 标签值 | 显示文案 | 使用次数 |
| --- | --- | ---: |
| `feature` | 功能更新 | 15 |
| `mobile` | 移动端适配 | 6 |
| `visual` | 视觉优化 | 6 |
| `fix` | 修复问题 | 3 |
| `interaction` | interaction | 3 |
| `responsive` | responsive | 3 |
| `perf` | 性能优化 | 2 |
| `about` | about | 1 |
| `cloudflare` | cloudflare | 1 |
| `deployment` | deployment | 1 |
| `home` | home | 1 |
| `infrastructure` | infrastructure | 1 |
| `life` | life | 1 |
| `navigation` | navigation | 1 |
| `widgets` | widgets | 1 |

### 当前已使用 primary

| primary | 使用次数 |
| --- | ---: |
| `feature` | 11 |
| `optimization` | 6 |
| `fix` | 1 |

### 页面已配置但暂无内容的筛选项

暂无。

## 画廊

数据来源：

- `js/gallery-data.js` 的 `category` 和 `tags`
- `html/life.html` 中画廊的分类筛选按钮
- `js/gallery.js` 的分类与标签显示文案

### 当前已有内容分类

暂无。

### 当前已使用标签

暂无。

### 页面/代码已配置但暂无内容的分类值

| 分类值 | 显示文案 |
| --- | --- |
| `anime` | 动漫 |
| `character` | 人物 |
| `collection` | 收藏 |
| `illustration` | 插画 |
| `landscape` | 风景 |
| `life` | 生活 |
| `other` | 其他 |
| `real` | 现实 |
| `works` | 作品 |

### 备注

- `js/gallery.js` 里也保留了英文标签映射，例如 `night` -> `夜景`、`city` -> `城市`、`sky` -> `天空` 等；当前 `js/gallery-data.js` 直接使用中文标签。
- 更新页的 `tags` 用英文值存储，页面显示时再映射成中文文案；新增更新日志时优先复用现有英文值。

