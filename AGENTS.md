# AGENTS.md

## 1. Project Overview

This is a personal website project (yang181969.com).

The site is a static front-end (HTML, CSS/SCSS, JavaScript, images, content and data files).
It is deployed with **Cloudflare Pages**; the **GitHub** repository is the source of truth and
the automatic deployment source (pushing to `main` triggers a Cloudflare Pages build).

`index.html` is a single-page shell. The four top-level pages are loaded into `#main-content`
by `js/main.js` and addressed with `?page=...`:

- **Home** (`index.html`): light welcome area + five cards
  (Notes, Life snippets, Recent updates, Today's corner / Tokyo weather, Site overview)
- **Notes** (`?page=notes`): math, physics and knowledge notes; article detail `&note=...`
- **Life** (`?page=life`): personal life hub with sections
  overview, works, collections, journey (footprints) and journal
- **About** (`?page=about`): site introduction with sections
  overview, stats and update log

Anime, Gallery, Stats and Update are no longer standalone pages. Their old URLs
(`?page=anime`, `?page=gallery`, `?page=stats`, `?page=update`, `html/stats.html`, `html/update.html`)
are kept only as redirects to the Life / About sections. Do not add new links to them.

The design direction is a card-based personal website with a unified visual style, responsive layout, theme-color support, dark mode, and optimized page performance.

---

## 2. Important Project Rules

Before making any changes, follow these rules strictly:

1. Do not make large-scale rewrites unless explicitly requested.
2. Do not delete existing functionality.
3. Do not change the routing structure unless explicitly requested.
4. Do not modify unrelated files.
5. Do not scan or modify `node_modules/`.
6. Do not modify generated or temporary files unless explicitly requested.
7. Before editing multiple files, explain the intended plan first.
8. After editing, summarize every changed file and what changed.
9. Preserve the existing website style unless the user asks for a redesign.
10. Prefer small, safe, incremental changes.

---

## 3. Files and Directories

Common project directories:

```text
assets/      Static assets, images, decorations, gallery materials
content/     Markdown or article content (notes, updates, life journal)
css/         CSS and SCSS source files (edit css/scss/, then build css/style.css)
data/        JSON or data files
html/        Page HTML fragments loaded into index.html, plus standalone detail pages
js/          JavaScript files
scripts/     Build, data-generation and browser-check scripts (see scripts/README.md)
templates/   Shared shell / tool markup synced into the HTML documents
```

Generated files: `css/style.css`, `css/critical.css`, the inlined critical CSS and `?v=` asset
versions in the HTML documents, `data/image-index.json`, `data/journal-index.json`,
`data/updates-index.json`, `data/stats.json`, `data/site-meta.json`. Regenerate them with the
npm scripts (`npm run build`, `npm run build:critical`, `npm run inline:critical`, `npm run build:all`)
instead of editing them by hand.

---

## 4. Routing

All in-site navigation goes through the router in `js/main.js` (`window._loadPage(page, push, options)`),
which also guards against stale asynchronous page loads. Do not build a second router.

```text
Home    index.html
Notes   index.html?page=notes[&note=<encodeURIComponent(file path from data/notes-index.json)>]
Life    index.html?page=life&tab=overview|works|collections|journey|journal[&type=...][&status=...][&entry=<journal id>]
About   index.html?page=about&tab=overview|stats|update[&update=<file name of content/updates/*.md without .md>]
```

Page scripts must check that their DOM is still mounted before applying asynchronous results.
