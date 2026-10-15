"""Phase 6 regression checks: anime works and gallery images are empty, the display framework is intact.
Requires Python Playwright + Chrome and Node.js. Run from the repository root against a local static server:
  python scripts/phase1-preview.py            (serves http://127.0.0.1:8765)
  python scripts/phase6-empty-content-check.py
PHASE6_BASE_URL overrides the server, PHASE6_OUT the output folder (default artifacts/phase6/).

1. Static guards: data files are empty, old images / pages / fallbacks are gone, no runtime file links to
   the removed anime detail page. These fail if a rebuild ever brings the old content back.
2. Real (empty) data in the browser: per-type empty states, count 0, gallery organising state, home
   placeholder, search without old works.
3. Temporary mock data injected only through request routing (nothing is written to disk): the four
   badge colours, status filters, link / non-link cards, waterfall, search / filter / sort, lightbox.
"""
import base64
import json
import os
import re
import subprocess
import sys
from pathlib import Path
from urllib.parse import urlparse, parse_qs
from playwright.sync_api import sync_playwright

OUT = Path(os.environ.get('PHASE6_OUT', 'artifacts/phase6'))
OUT.mkdir(parents=True, exist_ok=True)
BASE = os.environ.get('PHASE6_BASE_URL', 'http://127.0.0.1:8765')
report = {'checks': [], 'errors': [], 'console': []}

OLD_TITLES = ['魔女之旅', '葬送的芙莉莲', '紫罗兰永恒花园', '鬼灭之刃', '间谍过家家', '进击的巨人',
              '约会大作战', '铃芽之旅', '魔法少女小圆', '你的名字']
# a concrete file under the emptied folders (placeholders such as <id>-cover.webp in docs do not match)
OLD_IMAGE_REF = re.compile(r'assets/(animes|gallery/(real|anime))/[\w.-]+\.(webp|jpe?g|png|gif|avif)', re.I)
IMAGE_EXTS = {'.jpg', '.jpeg', '.png', '.webp', '.gif', '.avif', '.svg'}


def check(name, condition, detail=None):
    report['checks'].append({'name': name, 'passed': bool(condition), 'detail': detail})
    print(('PASS ' if condition else 'FAIL ') + name + ('' if condition or detail is None else f'  -> {detail}'), flush=True)


def query(page):
    return {k: v[0] for k, v in parse_qs(urlparse(page.url).query).items()}


def watch(page):
    page.on('pageerror', lambda e: report['errors'].append(f'{page.url} :: {e}'))
    page.on('console', lambda m: m.type == 'error' and report['console'].append(f'{page.url} :: {m.text}'))


def js_global(file, name):
    code = f"const vm=require('vm');const fs=require('fs');process.stdout.write(JSON.stringify(vm.runInNewContext(fs.readFileSync({json.dumps(file)},'utf8')+';{name}')))"
    return json.loads(subprocess.run(['node', '-e', code], capture_output=True, text=True, check=True).stdout)


# ------------------------------------------------------------ 1. static guards
anime = js_global('js/anime-data.js', 'animeData')
gallery = js_global('js/gallery-data.js', 'galleryData')
index = json.loads(Path('data/image-index.json').read_text(encoding='utf-8'))
meta = json.loads(Path('data/site-meta.json').read_text(encoding='utf-8'))
check('anime-data.js: animeData is an empty object', anime == {}, anime)
check('gallery-data.js: galleryData is an empty array', gallery == [], len(gallery))
check('image-index.json: valid empty index', index.get('images') == [] and index.get('count') == 0 and index.get('version') == 1, index)
check('site-meta totals: anime 0 / gallery 0 / music 0', (meta['totals']['anime'], meta['totals']['gallery'], meta['totals']['music']) == (0, 0, 0), meta['totals'])
check('site-meta totalContent = notes only', meta['totalContent'] == meta['totals']['notes'], meta)

for folder in ['assets/animes', 'assets/gallery']:
    on_disk = [p.as_posix() for p in Path(folder).rglob('*') if p.is_file() and p.suffix.lower() in IMAGE_EXTS]
    tracked = [f for f in subprocess.run(['git', 'ls-files', folder], capture_output=True, text=True).stdout.split('\n')
               if Path(f).suffix.lower() in IMAGE_EXTS]
    check(f'{folder}: no image files on disk or in the Git index', not on_disk and not tracked, on_disk + tracked)

removed = ['html/anime-detail.html', 'js/anime-detail.js', 'css/scss/pages/_anime-detail.scss',
           'html/anime.html', 'js/animes.js', 'css/scss/pages/_anime.scss',
           'scripts/1-rename-anime-images.js', 'scripts/3-update-html-references.js', 'scripts/rename-mapping.json']
check('removed anime page files stay removed', not [f for f in removed if Path(f).exists()], [f for f in removed if Path(f).exists()])

runtime = [Path('index.html'), *Path('html').glob('*.html'), *Path('js').glob('*.js'), *Path('templates').glob('*.html'),
           *Path('data').glob('*.json'), Path('css/style.css'), Path('css/critical.css'),
           Path('scripts/5-inline-critical.mjs'), Path('scripts/14-sync-shell.mjs'), Path('scripts/15-version-assets.mjs'),
           Path('scripts/16-build-life-data.mjs'), Path('package.json'), Path('css/scss/main.scss')]
texts = {p.as_posix(): p.read_text(encoding='utf-8') for p in runtime if p.exists()}
check('no runtime / build file references anime-detail', not [f for f, t in texts.items() if 'anime-detail' in t],
      [f for f, t in texts.items() if 'anime-detail' in t])
check('no runtime file references removed images', not [f for f, t in texts.items() if OLD_IMAGE_REF.search(t)],
      [f for f, t in texts.items() if OLD_IMAGE_REF.search(t)])
check('no hard-coded anime search fallback', 'ANIME_DATA_FALLBACK' not in texts['js/search.js'])
stale = sorted({(f, t) for f, text in texts.items() for t in OLD_TITLES if t in text and not f.startswith('data/stats')})
check('old anime titles absent from runtime files', not stale, stale)
check('Life badge mapping intact', all(f'{k}: "{v}"' in texts['js/life.js'] for k, v in
      {'upcoming': '待更新', 'ongoing': '连载中', 'finished': '已完结', 'movie': '电影'}.items()))


# ------------------------------------------------------------ mock data (served only through routing)
def svg(w, h, color):
    raw = f'<svg xmlns="http://www.w3.org/2000/svg" width="{w}" height="{h}"><rect width="100%" height="100%" fill="{color}"/></svg>'
    return 'data:image/svg+xml;base64,' + base64.b64encode(raw.encode()).decode()


MOCK_ANIME = {
    'mock-a': {'title': '测试作品甲', 'watchStatus': 'watched', 'badge': 'upcoming', 'order': 1, 'image': svg(300, 400, '#88a'), 'updateDate': '2026-10-01',
               'description': '模拟数据', 'info': ['题材：测试']},
    'mock-b': {'title': '测试作品乙', 'watchStatus': 'watching', 'badge': 'ongoing', 'order': 2, 'image': svg(300, 400, '#a88'), 'updateDate': '2026-10-02',
               'link': 'index.html?page=notes'},
    'mock-c': {'title': '测试作品丙', 'watchStatus': 'wishlist', 'badge': 'finished', 'order': 3, 'image': svg(300, 400, '#8a8')},
    'mock-d': {'title': '测试作品丁', 'watchStatus': 'watched', 'badge': 'movie', 'order': 4},
}
BADGE_RGB = {'upcoming': 'rgb(59, 130, 246)', 'ongoing': 'rgb(245, 158, 11)', 'finished': 'rgb(34, 197, 94)', 'movie': 'rgb(168, 85, 247)'}
MOCK_IMAGES = []
for i, (w, h, cat, tags, source) in enumerate([
        (600, 900, 'real', ['天空'], 'gallery'), (900, 600, 'real', ['城市'], 'gallery'), (600, 600, 'anime', ['人物'], 'gallery'),
        (600, 1000, 'real', ['天空', '夜景'], 'gallery'), (800, 600, 'anime', ['动漫'], 'anime'), (600, 800, 'anime', ['动漫'], 'anime')], start=1):
    src = svg(w, h, ['#c9d', '#9cd', '#dc9', '#9dc', '#cd9', '#d9c'][i - 1])
    MOCK_IMAGES.append({'id': f'mock-{i}', 'title': f'测试图片{i}', 'src': src, 'thumb': src, 'category': cat, 'album': '', 'tags': tags,
                        'note': '模拟备注' if i == 1 else '', 'width': w, 'height': h, 'order': i, 'updatedAt': f'2026-10-0{i}',
                        'date': f'2026-10-0{i}', 'source': source,
                        'refs': [{'type': 'anime', 'id': 'mock-a', 'title': '测试作品甲', 'href': 'index.html?page=life&tab=works&type=anime'}] if source == 'anime' else []})
MOCK_INDEX = {'version': 1, 'count': len(MOCK_IMAGES), 'sources': {'gallery': 4, 'anime': 2}, 'images': MOCK_IMAGES}
MOCK_GALLERY = [{k: v for k, v in img.items() if k not in ('source', 'refs')} for img in MOCK_IMAGES if img['source'] == 'gallery']


def install_mocks(ctx):
    ctx.route(re.compile(r'/js/anime-data\.js(\?|$)'), lambda r: r.fulfill(content_type='application/javascript',
              body='const animeData = ' + json.dumps(MOCK_ANIME, ensure_ascii=False) + ';'))
    ctx.route(re.compile(r'/js/gallery-data\.js(\?|$)'), lambda r: r.fulfill(content_type='application/javascript',
              body='const galleryData = ' + json.dumps(MOCK_GALLERY, ensure_ascii=False) + ';'))
    ctx.route(re.compile(r'/data/image-index\.json(\?|$)'), lambda r: r.fulfill(content_type='application/json',
              body=json.dumps(MOCK_INDEX, ensure_ascii=False)))


with sync_playwright() as pw:
    browser = pw.chromium.launch(channel='chrome', headless=True)
    light = "try{localStorage.setItem('theme-mode','light');localStorage.setItem('primary-hue','210')}catch(e){}"

    # ------------------------------------------------------------ 2. real (empty) data
    ctx = browser.new_context(viewport={'width': 1440, 'height': 900})
    ctx.add_init_script(light)
    page = ctx.new_page(); watch(page)
    page.goto(f'{BASE}/index.html?page=life&tab=works&type=anime', wait_until='load'); page.wait_for_timeout(1000)
    check('works/anime: empty state copy', page.inner_text('[data-life-works] .life-empty strong').strip() == '动漫收藏暂时为空'
          and page.inner_text('[data-life-works] .life-empty span:not(.life-empty__icon)').strip() == '新的作品记录将在这里展示。', page.inner_text('[data-life-works]'))
    check('works/anime: chip count shows 0', page.inner_text('[data-life-count="anime"]').strip() == '0')
    for value in ['done', 'doing', 'want', 'all']:
        page.click(f'[data-life-status-value="{value}"]'); page.wait_for_timeout(200)
        ok = page.get_attribute(f'[data-life-status-value="{value}"]', 'aria-pressed') == 'true' and '动漫收藏暂时为空' in page.inner_text('[data-life-works]')
        check(f'works/anime: status {value} switches safely', ok and (query(page).get('status') == value or value == 'all'), page.url)
    page.click('[data-life-type="film"]'); page.wait_for_timeout(300)
    check('works/film keeps its own empty state', page.inner_text('[data-life-works] .life-empty strong').strip() == '这里还没有影视记录')
    page.click('[data-life-type="book"]'); page.wait_for_timeout(300)
    check('works/book keeps its own empty state', page.inner_text('[data-life-works] .life-empty strong').strip() == '这里还没有书籍记录')
    page.screenshot(path=str(OUT / 'empty-works-book.png'))

    page.goto(f'{BASE}/index.html?page=life&tab=collections&type=gallery', wait_until='load'); page.wait_for_selector('.gallery-empty', timeout=5000)
    check('gallery: organising empty state with 0 images', page.inner_text('.gallery-empty strong').strip() == '画廊正在整理中'
          and page.inner_text('.gallery-empty span').strip() == '新的图片将在这里展示。' and page.inner_text('[data-gallery-total]') == '0')
    check('gallery: no images, no broken thumbnails', page.locator('[data-gallery-list] img').count() == 0)
    page.screenshot(path=str(OUT / 'empty-gallery.png'))

    page.goto(f'{BASE}/index.html', wait_until='load'); page.wait_for_selector('[data-card="life"] .home-life-chip', timeout=8000)
    check('home: life card placeholder, entries kept', page.locator('.home-life-tile').count() == 0
          and page.locator('[data-card="life"] .home-empty').count() == 1 and page.locator('.home-life-chip').count() == 4)
    page.keyboard.press('Control+k'); page.keyboard.type('芙莉莲'); page.wait_for_timeout(1200)
    check('search: no deleted anime results', page.locator('.search-result-card').count() == 0
          and page.locator('.search-filter[data-search-filter="动漫"] strong').inner_text() == '0')
    page.keyboard.press('Escape')
    sp = ctx.new_page(); watch(sp)
    sp.goto(f'{BASE}/html/stats.html', wait_until='load'); sp.wait_for_timeout(800)
    sp.locator('#search-toggle').click(); sp.locator('#search-input').fill('魔女'); sp.wait_for_timeout(1200)
    check('standalone page search: no anime fallback results', sp.locator('.search-filter[data-search-filter="动漫"] strong').inner_text() == '0')
    sp.close()
    ctx.close()

    # ------------------------------------------------------------ 3. mock data: the framework still works
    ctx = browser.new_context(viewport={'width': 1440, 'height': 900})
    ctx.add_init_script(light)
    install_mocks(ctx)
    page = ctx.new_page(); watch(page)
    page.goto(f'{BASE}/index.html?page=life&tab=works&type=anime', wait_until='load'); page.wait_for_timeout(1200)
    check('mock works: 4 cards, count 4', page.locator('[data-life-works] .life-work').count() == 4 and page.inner_text('[data-life-count="anime"]').strip() == '4')
    badges = page.eval_on_selector_all('.life-work__badge', '''els => els.map(e => {
      const cover = e.closest('.life-work__cover').getBoundingClientRect(), r = e.getBoundingClientRect();
      return [e.dataset.badge, e.textContent.trim(), getComputedStyle(e, '::before').backgroundColor,
              Math.round(cover.right - r.right), Math.round(r.top - cover.top)];
    })''')
    check('mock works: four badge colours', sorted((b[0], b[2]) for b in badges) == sorted(BADGE_RGB.items()), badges)
    check('mock works: badge labels', {b[0]: b[1] for b in badges} == {'upcoming': '待更新', 'ongoing': '连载中', 'finished': '已完结', 'movie': '电影'}, badges)
    check('mock works: badges sit top-right of the cover', all(b[3] == 8 and b[4] == 8 for b in badges), badges)
    check('mock works: card with link is <a>, others are non-navigating <article>',
          page.locator('a.life-work[href="index.html?page=notes"]').count() == 1 and page.locator('article.life-work').count() == 3
          and page.locator('a.life-work:not([href]), a.life-work[href=""]').count() == 0)
    check('mock works: missing cover uses placeholder', page.locator('.life-work__placeholder').count() == 1)
    # Paper interaction rule (Phase 2.0): a linked card lifts slightly and its paper shadow deepens on hover;
    # a static <article> card keeps its position and its resting paper shadow. Checked on computed styles before
    # and after a real hover, for the default "outline" paper and for "layered" (whose hover keeps the second sheet).
    def shadow_layers(value):
        if value in ('', 'none'): return []
        layers, depth, cur = [], 0, ''
        for ch in value:
            depth += ch == '('; depth -= ch == ')'
            if ch == ',' and depth == 0: layers.append(cur); cur = ''
            else: cur += ch
        layers.append(cur)
        # [x, y, blur, spread] of each layer, colour ignored
        return [[float(n) for n in re.findall(r'(-?[\d.]+)px', layer)] for layer in layers]
    def lift(transform):
        m = re.match(r'matrix\(([^)]+)\)', transform)
        if not m: return None
        a, b, c, d, tx, ty = [float(n) for n in m[1].split(',')]
        return {'scale': (a, d), 'tx': tx, 'ty': ty}
    def hover_styles(sel):
        get = 'e => [getComputedStyle(e).transform, getComputedStyle(e).boxShadow]'
        page.mouse.move(5, 5); page.wait_for_timeout(450)
        rest = page.eval_on_selector(sel, get)
        page.hover(sel); page.wait_for_timeout(450)
        hover = page.eval_on_selector(sel, get)
        page.mouse.move(5, 5); page.wait_for_timeout(450)
        return {'rest': rest, 'hover': hover}
    for paper in ['outline', 'layered']:
        page.evaluate(f"document.documentElement.dataset.paper = '{paper}'"); page.wait_for_timeout(100)
        linked, static = hover_styles('a.life-work >> nth=0'), hover_styles('article.life-work >> nth=0')
        lr, lh = shadow_layers(linked['rest'][1]), shadow_layers(linked['hover'][1])
        sr, sh = shadow_layers(static['rest'][1]), shadow_layers(static['hover'][1])
        up = lift(linked['hover'][0])
        check(f'mock works ({paper}): both cards rest flat on the same paper shadow',
              linked['rest'][0] == 'none' and static['rest'][0] == 'none' and lr and linked['rest'][1] == static['rest'][1],
              [linked['rest'], static['rest']])
        check(f'mock works ({paper}): linked card lifts slightly on hover (no scaling)',
              up is not None and -6 <= up['ty'] < 0 and up['tx'] == 0 and up['scale'] == (1.0, 1.0), linked['hover'][0])
        check(f'mock works ({paper}): linked card shadow deepens on hover',
              lh and linked['hover'][1] != linked['rest'][1] and max(l[2] for l in lh) > max(l[2] for l in lr),
              [linked['rest'][1], linked['hover'][1]])
        check(f'mock works ({paper}): static card does not move or change its shadow on hover',
              static['hover'][0] == 'none' and static['hover'][1] == static['rest'][1] and sh == sr, static)
        if paper == 'layered':
            sheet = lambda layers: [l for l in layers if l[2] == 0 and (l[0], l[1]) != (0, 0)]
            check('mock works (layered): hover keeps the second paper sheet',
                  len(sheet(lr)) == 2 and sheet(lh) == sheet(lr) and sheet(sh) == sheet(sr), [linked['hover'][1]])
    page.evaluate("document.documentElement.dataset.paper = 'outline'")
    for value, n in [('done', 2), ('doing', 1), ('want', 1), ('all', 4)]:
        page.click(f'[data-life-status-value="{value}"]'); page.wait_for_timeout(200)
        check(f'mock works: status {value} = {n}', page.locator('[data-life-works] .life-work').count() == n)
    page.screenshot(path=str(OUT / 'mock-works.png'))
    # watchStatus and badge stay independent: the "想看" card still shows its 已完结 badge
    page.click('[data-life-status-value="want"]'); page.wait_for_timeout(200)
    check('mock works: watchStatus filter independent of badge', page.locator('.life-work__badge[data-badge="finished"]').count() == 1)

    page.click('[data-life-tab="collections"]'); page.wait_for_selector('.gallery-item', timeout=5000); page.wait_for_timeout(500)
    check('mock gallery: 6 items, total 6', page.locator('.gallery-item').count() == 6 and page.inner_text('[data-gallery-total]') == '6')
    layout = page.eval_on_selector_all('.gallery-item', 'els => els.map(e => [Math.round(e.getBoundingClientRect().left), e.style.getPropertyValue("--gallery-item-ratio").trim()])')
    check('mock gallery: waterfall columns + aspect ratios', len({x for x, _ in layout}) >= 3 and all(r for _, r in layout), layout)
    page.screenshot(path=str(OUT / 'mock-gallery.png'))
    page.click('[data-gallery-action="search"]'); page.fill('[data-gallery-search-input]', '测试图片1'); page.wait_for_timeout(300)
    check('mock gallery: search matches', page.locator('.gallery-item').count() == 1)
    page.fill('[data-gallery-search-input]', '不存在的关键词'); page.wait_for_timeout(300)
    check('mock gallery: no-match state differs from empty gallery', page.inner_text('.gallery-empty strong').strip() == '没有找到匹配的收藏')
    page.click('[data-gallery-search-clear]'); page.keyboard.press('Escape'); page.wait_for_timeout(200)
    page.click('[data-gallery-action="filter"]'); page.wait_for_timeout(200)
    page.click('[data-category="anime"]'); page.wait_for_timeout(200)
    check('mock gallery: category filter', page.locator('.gallery-item').count() == 3)
    page.click('[data-tag="动漫"]'); page.wait_for_timeout(200)
    check('mock gallery: tag filter', page.locator('.gallery-item').count() == 2)
    page.click('[data-gallery-filter-clear]'); page.click('[data-source="gallery"]'); page.wait_for_timeout(200)
    check('mock gallery: source filter', page.locator('.gallery-item').count() == 4)
    page.click('[data-gallery-filter-clear]'); page.keyboard.press('Escape')
    page.click('[data-gallery-action="sort"]'); page.click('[data-sort="time-desc"]'); page.wait_for_timeout(200)
    check('mock gallery: sort time-desc', page.get_attribute('.gallery-item >> nth=0', 'aria-label') == '打开 测试图片6')
    page.click('[data-sort="default"]'); page.keyboard.press('Escape'); page.wait_for_timeout(200)
    page.click('.gallery-item >> nth=0'); page.wait_for_timeout(300)
    check('mock gallery: lightbox opens', page.is_visible('#gallery-lightbox') and page.evaluate("document.documentElement.classList.contains('is-modal-open')"))
    page.click('[data-lightbox-next]'); page.wait_for_timeout(150)
    page.keyboard.press('ArrowRight'); page.wait_for_timeout(150)
    page.keyboard.press('ArrowLeft'); page.wait_for_timeout(150)
    check('mock gallery: lightbox next / arrow keys', page.inner_text('[data-current-index]') == '2' and page.inner_text('[data-total-count]') == '6')
    page.keyboard.press('Escape'); page.wait_for_timeout(200)
    check('mock gallery: Escape closes lightbox + scroll lock', not page.is_visible('#gallery-lightbox') and not page.evaluate("document.documentElement.classList.contains('is-modal-open')"))
    page.click('.gallery-item[aria-label="打开 测试图片5"]'); page.wait_for_timeout(300)
    check('mock gallery: related work link points to Life', page.locator('[data-lightbox-source] a[href="index.html?page=life&tab=works&type=anime"]').count() == 1)
    page.screenshot(path=str(OUT / 'mock-lightbox.png'))
    page.evaluate("document.querySelector('[data-life-tab=\"journey\"]').click()"); page.wait_for_timeout(300)
    check('mock gallery: leaving the tab closes the lightbox', page.evaluate("document.getElementById('gallery-lightbox').hidden && !document.documentElement.classList.contains('is-modal-open')"))

    page.goto(f'{BASE}/index.html', wait_until='load'); page.wait_for_selector('.home-life-tile', timeout=8000)
    tiles = page.eval_on_selector_all('.home-life-tile', 'els => els.map(a => a.getAttribute("href"))')
    check('mock home: work tiles link to Life or the configured link, never anime-detail',
          len(tiles) == 4 and 'index.html?page=notes' in tiles and not [t for t in tiles if 'anime-detail' in t], tiles)
    page.goto(f'{BASE}/index.html?page=life', wait_until='load'); page.wait_for_timeout(1000)
    # two watched works, only one has a cover: no empty-src thumbnails
    check('mock overview: mini covers link inside Life, no coverless thumbnail', page.locator('.life-mini-cover').count() == 1
          and page.locator('.life-mini-cover[href="index.html?page=life&tab=works&type=anime"]').count() == 1
          and page.locator('[data-life-panel="overview"] img[src=""]').count() == 0)
    ctx.close()

    # mobile + dark with mock data
    mctx = browser.new_context(viewport={'width': 390, 'height': 844}, has_touch=True, is_mobile=True)
    mctx.add_init_script("try{localStorage.setItem('theme-mode','dark');localStorage.setItem('primary-hue','210')}catch(e){}")
    install_mocks(mctx)
    m = mctx.new_page(); watch(m)
    m.goto(f'{BASE}/index.html?page=life&tab=works&type=anime', wait_until='load'); m.wait_for_timeout(1000)
    check('mobile dark: works render, no horizontal overflow', m.locator('.life-work').count() == 4
          and m.evaluate('document.documentElement.scrollWidth <= innerWidth && document.querySelector(".layout").scrollWidth <= innerWidth'))
    m.screenshot(path=str(OUT / 'mobile-dark-mock-works.png'))
    m.goto(f'{BASE}/index.html?page=life&tab=collections&type=gallery', wait_until='load'); m.wait_for_selector('.gallery-item'); m.wait_for_timeout(600)
    m.tap('.gallery-item >> nth=1'); m.wait_for_timeout(300)
    m.tap('[data-lightbox-next]'); m.wait_for_timeout(200)
    ok = m.inner_text('[data-current-index]') == '3'
    m.screenshot(path=str(OUT / 'mobile-dark-mock-lightbox.png'))
    m.tap('.gallery-lightbox__close'); m.wait_for_timeout(300)
    check('mobile dark: lightbox navigates and closes', ok and not m.is_visible('#gallery-lightbox'))
    mctx.close()

    # mobile + empty data
    ectx = browser.new_context(viewport={'width': 390, 'height': 844}, has_touch=True, is_mobile=True)
    ectx.add_init_script(light)
    e = ectx.new_page(); watch(e)
    for route in ['index.html?page=life&tab=works&type=anime', 'index.html?page=life&tab=collections&type=gallery', 'index.html']:
        e.goto(f'{BASE}/{route}', wait_until='load'); e.wait_for_timeout(1000)
        check(f'mobile empty {route}: no horizontal overflow',
              e.evaluate('document.documentElement.scrollWidth <= innerWidth && document.querySelector(".layout").scrollWidth <= innerWidth'))
        e.screenshot(path=str(OUT / f'mobile-empty-{len(route)}.png'))
    ectx.close()
    browser.close()

passed = sum(c['passed'] for c in report['checks'])
report['summary'] = {'passed': passed, 'total': len(report['checks']), 'pageErrors': len(report['errors']), 'consoleErrors': len(report['console'])}
(OUT / 'report.json').write_text(json.dumps(report, ensure_ascii=False, indent=2), encoding='utf-8')
print(json.dumps(report['summary'], ensure_ascii=False))
for err in report['errors'] + report['console']:
    print('ERR', err)
# non-zero exit for automation: any failed check or browser error fails the run
sys.exit(0 if passed == len(report['checks']) and not report['errors'] and not report['console'] else 1)
