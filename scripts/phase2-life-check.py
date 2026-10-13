"""Local Phase 2 (Life page) browser regression checks. Requires Python Playwright + Chrome.
Run against a local static server with PHASE2_BASE_URL (default 127.0.0.1:8765), e.g.
  python -m http.server 8765 --bind 127.0.0.1
  python scripts/phase2-life-check.py
Writes screenshots and a JSON report under artifacts/phase2/ (or PHASE2_OUT).
"""
import json
import os
from pathlib import Path
from urllib.parse import urlparse, parse_qs
from playwright.sync_api import sync_playwright

# PHASE2_OUT: put output outside the project when testing under VS Code Live Server,
# otherwise every screenshot written into the watched folder triggers a live reload.
OUT = Path(os.environ.get('PHASE2_OUT', 'artifacts/phase2'))
OUT.mkdir(parents=True, exist_ok=True)
BASE = os.environ.get('PHASE2_BASE_URL', 'http://127.0.0.1:8765')
report = {'checks': [], 'errors': [], 'console': [], 'viewports': []}


def check(name, condition, detail=None):
    report['checks'].append({'name': name, 'passed': bool(condition), 'detail': detail})
    print(('PASS ' if condition else 'FAIL ') + name + ('' if condition or detail is None else f'  -> {detail}'), flush=True)


def query(page):
    q = parse_qs(urlparse(page.url).query)
    return {k: v[0] for k, v in q.items()}


def settle(page, ms=500):
    page.wait_for_timeout(ms)


def watch(page):
    page.on('pageerror', lambda e: report['errors'].append(f'{page.url} :: {e}'))
    page.on('console', lambda m: m.type == 'error' and report['console'].append(f'{page.url} :: {m.text}'))


# Static guard: VS Code Live Server injects its reload script before every occurrence of the
# tag it picks (</body> first, else </svg>) but sizes Content-Length for one injection.
# A fragment with inline SVG and no single </body> is truncated there (Life panels vanished).
for frag in sorted(Path('html').glob('*.html')):
    text = frag.read_text(encoding='utf-8').lower()
    if '</svg>' in text:
        check(f'{frag.as_posix()} has exactly one </body> (Live Server safe)', text.count('</body>') == 1, text.count('</body>'))

with sync_playwright() as pw:
    browser = pw.chromium.launch(channel='chrome', headless=True)

    # ------------------------------------------------------------ desktop
    ctx = browser.new_context(viewport={'width': 1440, 'height': 900})
    ctx.add_init_script("try{localStorage.setItem('theme-mode','light');localStorage.setItem('primary-hue','210')}catch(e){}")
    page = ctx.new_page()
    watch(page)

    page.goto(f'{BASE}/index.html?page=life', wait_until='load'); settle(page, 1200)
    nav = page.eval_on_selector_all('.site-nav a', 'els => els.map(a => [a.getAttribute("href"), a.classList.contains("active")])')
    check('nav has four items', [n[0] for n in nav] == ['index.html', 'index.html?page=notes', 'index.html?page=life', 'index.html?page=about'], nav)
    check('Life nav item active on Life', dict(nav).get('index.html?page=life') is True, nav)
    labels = [t.strip() for t in page.locator('.life-tab').all_inner_texts()]
    check('tab labels are Chinese only', labels == ['总览', '作品', '收藏', '足迹', '日记'], labels)
    widths = page.eval_on_selector_all('.life-tab', 'els => els.map(e => Math.round(e.getBoundingClientRect().width))')
    check('desktop tabs evenly distributed', max(widths) - min(widths) <= 2, widths)
    check('Life overview renders by default', page.is_visible('[data-life-panel="overview"]') and page.locator('.life-mini-cover').count() == 4)
    check('overview featured collections has thumbnails', page.locator('.life-mini-gallery__item').count() == 6)
    check('overview wishlist shows anime wishlist', page.locator('.life-wish').count() == 2)
    check('overview journal/milestone empty states', page.locator('[data-life-slot="journal"] .life-empty').count() == 1 and page.locator('[data-life-slot="milestones"] .life-empty').count() == 1)
    page.screenshot(path=str(OUT / 'desktop-overview-light.png'), full_page=False)

    # tabs + history
    h0 = page.evaluate('history.length')
    page.click('[data-life-tab="works"]'); settle(page)
    check('works tab updates URL', query(page).get('tab') == 'works' and query(page).get('type') == 'anime', page.url)
    check('works grid shows 10 anime', page.locator('.life-works-grid .life-work').count() == 10)
    check('detail links preserved', page.locator('a.life-work[href="html/anime-detail.html?id=majo"]').count() == 1)
    h1 = page.evaluate('history.length')
    page.click('[data-life-tab="works"]'); settle(page, 300)
    check('clicking active tab adds no history', page.evaluate('history.length') == h1 == h0 + 1, (h0, h1, page.evaluate('history.length')))
    page.click('[data-life-status-value="want"]'); settle(page, 300)
    check('status filter want = 2', page.locator('.life-works-grid .life-work').count() == 2 and query(page).get('status') == 'want')
    page.click('[data-life-type="film"]'); settle(page, 400)
    check('film type shows empty state', page.locator('.life-works-grid .life-empty').count() == 1, page.url)
    page.click('[data-life-type="book"]'); settle(page, 300)
    check('book status labels switch to 已读/想读', page.inner_text('[data-life-status-value="want"]').strip() == '想读')
    page.go_back(); settle(page)
    check('back returns to film', query(page).get('type') == 'film' and page.get_attribute('[data-life-type="film"]', 'aria-pressed') == 'true', page.url)
    page.go_back(); page.go_back(); settle(page)
    check('back twice returns to works/anime/all', query(page).get('type') == 'anime' and 'status' not in query(page), page.url)
    page.go_back(); settle(page)
    check('back to overview', page.is_visible('[data-life-panel="overview"]') and query(page).get('page') == 'life', page.url)
    page.go_forward(); settle(page)
    check('forward to works', page.is_visible('[data-life-panel="works"]'))

    # keyboard
    page.focus('[data-life-tab="works"]'); page.keyboard.press('ArrowRight'); settle(page)
    check('ArrowRight moves to collections', query(page).get('tab') == 'collections' and page.evaluate('document.activeElement.dataset.lifeTab') == 'collections')

    # gallery
    page.wait_for_selector('.gallery-item', timeout=5000); settle(page, 600)
    total = page.locator('.gallery-item').count()
    check('gallery uses unified index (55 images)', total == 55 and page.inner_text('[data-gallery-total]') == '55', total)
    page.screenshot(path=str(OUT / 'desktop-gallery-light.png'))
    page.click('[data-gallery-action="search"]'); settle(page, 200)
    check('gallery search panel opens once (no double binding)', page.locator('[data-gallery-panel="search"].is-open').count() == 1)
    page.fill('[data-gallery-search-input]', '芙莉莲'); settle(page, 300)
    # 4 anime-detail images + 1 original gallery image whose note mentions 芙莉莲
    check('search by related work finds anime art', page.locator('.gallery-item').count() == 5, page.locator('.gallery-item').count())
    page.click('[data-gallery-search-clear]'); settle(page, 200)
    page.keyboard.press('Escape'); settle(page, 200)
    page.click('[data-gallery-action="filter"]'); settle(page, 200)
    page.click('[data-category="real"]'); settle(page, 300)
    real = page.locator('.gallery-item').count()
    check('category filter real', 0 < real < total, real)
    page.click('[data-gallery-filter-clear]'); settle(page, 200)
    page.click('[data-source="gallery"]'); settle(page, 300)
    check('source filter: original gallery = 17', page.locator('.gallery-item').count() == 17, page.locator('.gallery-item').count())
    page.click('[data-source="anime"]'); settle(page, 300)
    check('source filter: anime detail art = 38 (deduplicated)', page.locator('.gallery-item').count() == 38, page.locator('.gallery-item').count())
    page.click('[data-gallery-filter-clear]'); settle(page, 200)
    check('clear filter restores all', page.locator('.gallery-item').count() == total)
    page.click('[data-gallery-action="sort"]'); settle(page, 200)
    page.click('[data-sort="time-desc"]'); settle(page, 300)
    check('sort time-desc keeps all items', page.locator('.gallery-item').count() == total)
    page.keyboard.press('Escape'); settle(page, 200)
    page.click('.gallery-item >> nth=0'); settle(page, 300)
    check('lightbox opens', page.is_visible('#gallery-lightbox') and page.evaluate("document.documentElement.classList.contains('is-modal-open')"))
    page.click('[data-lightbox-next]'); settle(page, 200)
    check('lightbox next', page.inner_text('[data-current-index]') == '2')
    page.keyboard.press('Escape'); settle(page, 200)
    check('Esc closes lightbox and scroll lock', not page.is_visible('#gallery-lightbox') and not page.evaluate("document.documentElement.classList.contains('is-modal-open')"))
    # anime art shows related work link in lightbox
    page.click('[data-gallery-action="search"]'); page.fill('[data-gallery-search-input]', '魔女之旅'); settle(page, 300)
    page.keyboard.press('Escape'); page.click('.gallery-item[aria-label="打开 魔女之旅 · 封面"]'); settle(page, 300)
    check('lightbox shows related work link', page.locator('[data-lightbox-source] a[href="html/anime-detail.html?id=majo"]').count() == 1, page.inner_text('[data-lightbox-source]'))
    # leaving tab with the lightbox open releases it
    page.evaluate("document.querySelector('[data-life-tab=\"journey\"]').click()"); settle(page, 300)
    check('switching tab closes lightbox + lock', page.evaluate("document.getElementById('gallery-lightbox').hidden && !document.documentElement.classList.contains('is-modal-open')"))
    check('journey timeline empty state', page.locator('[data-life-list="journey"] .life-empty').count() == 1)
    page.click('[data-life-tab="collections"]'); settle(page, 300)
    check('collections remembers gallery and keeps state', query(page).get('type') == 'gallery' and page.locator('.gallery-item').count() >= 1)
    page.click('[data-life-type="cards"]'); settle(page, 300)
    check('cards empty state', page.locator('[data-life-list="cards"] .life-empty').count() == 1 and not page.is_visible('[data-life-sub="gallery"]'))
    page.click('[data-life-type="devices"]'); settle(page, 300)
    check('devices empty state', page.locator('[data-life-list="devices"] .life-empty').count() == 1)
    page.click('[data-life-tab="journal"]'); settle(page, 400)
    check('journal empty state', page.locator('[data-life-list="journal"] .life-empty').count() == 1)

    # unknown tab + legacy URLs (no extra history)
    page.goto(f'{BASE}/index.html?page=life&tab=nope&type=zzz', wait_until='load'); settle(page, 1000)
    check('unknown tab falls back to overview (canonical URL)', query(page).get('tab') == 'overview' and page.is_visible('[data-life-panel="overview"]'), page.url)
    control = ctx.new_page()
    control.goto(f'{BASE}/index.html?page=notes', wait_until='load'); settle(control, 600)
    base_len = control.evaluate('history.length'); control.close()
    for legacy, expect in [('anime', ('works', 'anime')), ('gallery', ('collections', 'gallery'))]:
        p2 = ctx.new_page(); watch(p2)
        p2.goto(f'{BASE}/index.html?page={legacy}', wait_until='load'); settle(p2, 1200)
        q = query(p2)
        check(f'legacy ?page={legacy} -> life/{expect[0]}/{expect[1]}', (q.get('page'), q.get('tab'), q.get('type')) == ('life',) + expect, p2.url)
        check(f'legacy ?page={legacy} adds no history entry', p2.evaluate('history.length') == base_len, (p2.evaluate('history.length'), base_len))
        p2.close()

    # home cards still lead to the content
    page.goto(f'{BASE}/index.html', wait_until='load'); settle(page, 1500)
    # Phase 4：动漫 / 画廊卡并入主页「生活片段」，改用卡内的分区入口
    page.click('[data-card="life"] .home-life-chip >> nth=0'); page.wait_for_load_state('load'); settle(page, 1200)
    check('home life card works link -> Life works', query(page).get('tab') == 'works' and page.locator('.life-work').count() == 10, page.url)
    page.goto(f'{BASE}/index.html', wait_until='load'); settle(page, 1500)
    page.click('[data-card="life"] .home-life-chip >> nth=1'); page.wait_for_load_state('load'); settle(page, 1500)
    check('home life card collections link -> Life gallery', query(page).get('type') == 'gallery' and page.locator('.gallery-item').count() == 55, page.url)

    # SPA re-entry: home -> life -> notes -> life (no duplicate bindings)
    page.goto(f'{BASE}/index.html', wait_until='load'); settle(page, 1500)
    for _ in range(3):
        page.click('.site-nav a[href="index.html?page=life"]'); settle(page, 700)
        page.click('.site-nav a[href="index.html?page=notes"]'); settle(page, 700)
    page.click('.site-nav a[href="index.html?page=life"]'); settle(page, 800)
    page.click('[data-life-tab="collections"]'); page.wait_for_selector('.gallery-item'); settle(page, 400)
    page.click('[data-gallery-action="filter"]'); settle(page, 200)
    check('gallery filter toggles after re-entry', page.locator('[data-gallery-panel="filter"].is-open').count() == 1)
    page.keyboard.press('Escape')
    hl = page.evaluate('history.length')
    page.click('[data-life-tab="journey"]'); settle(page, 300)
    check('one tab click = one history entry after re-entry', page.evaluate('history.length') == hl + 1)
    page.go_back(); settle(page, 400)
    check('back after re-entry restores collections', query(page).get('tab') == 'collections' and page.is_visible('[data-life-sub="gallery"]'))
    page.go_back(); settle(page, 600)
    check('back leaves Life to overview entry', query(page).get('page') == 'life' and query(page).get('tab') in (None, 'overview'), page.url)

    # search -> gallery (alias)
    page.goto(f'{BASE}/index.html?page=notes', wait_until='load'); settle(page, 1200)
    page.evaluate("window._loadPage('gallery')"); settle(page, 1500)
    check('_loadPage("gallery") alias opens Life gallery', query(page).get('type') == 'gallery' and page.locator('.gallery-item').count() == 55, page.url)

    # anime detail
    page.goto(f'{BASE}/index.html?page=life&tab=works&type=anime', wait_until='load'); settle(page, 1200)
    page.click('a.life-work[href*="id=frieren"]'); page.wait_for_load_state('load'); settle(page, 900)
    check('detail page renders', page.inner_text('#anime-title') == '葬送的芙莉莲' and page.locator('#anime-gallery img').count() == 4)
    check('detail page highlights 生活', page.get_attribute('.site-nav a[href="../index.html?page=life"]', 'aria-current') == 'page')
    page.evaluate("document.getElementById('back-to-prev').click()"); page.wait_for_load_state('load'); settle(page, 1200)
    check('detail back returns to works list', query(page).get('tab') == 'works' and page.locator('.life-work').count() == 10, page.url)
    p3 = ctx.new_page(); watch(p3)
    p3.goto(f'{BASE}/html/anime-detail.html?id=majo', wait_until='load'); settle(p3, 800)
    p3.evaluate("document.getElementById('back-to-prev').click()"); p3.wait_for_load_state('load'); settle(p3, 1200)
    check('direct-open detail back falls back to Life works', query(p3).get('tab') == 'works', p3.url)
    p3.close()

    # dark theme + other hue (own context: the light init script would reset a reload)
    dctx = browser.new_context(viewport={'width': 1440, 'height': 900})
    dctx.add_init_script("try{localStorage.setItem('theme-mode','dark');localStorage.setItem('primary-hue','140')}catch(e){}")
    dpage = dctx.new_page(); watch(dpage)
    dpage.goto(f'{BASE}/index.html?page=life', wait_until='load'); settle(dpage, 1200)
    check('dark theme active', dpage.evaluate("document.documentElement.dataset.theme") == 'dark', dpage.evaluate("document.documentElement.dataset.theme"))
    tab_color = dpage.eval_on_selector('.life-tab[aria-selected="true"]', 'e => getComputedStyle(e).color')
    check('active tab colour follows hue 140', tab_color.startswith('rgb(') and (lambda r, g, b: g > r and g > b)(*[int(x) for x in tab_color[4:-1].split(',')[:3]]), tab_color)
    dpage.screenshot(path=str(OUT / 'desktop-overview-dark-hue140.png'))
    dpage.click('[data-life-tab="works"]'); settle(dpage, 500)
    dpage.screenshot(path=str(OUT / 'desktop-works-dark.png'))
    dpage.click('[data-life-tab="collections"]'); dpage.wait_for_selector('.gallery-item'); settle(dpage, 800)
    dpage.screenshot(path=str(OUT / 'desktop-gallery-dark.png'))
    dpage.click('.gallery-item >> nth=2'); settle(dpage, 400)
    dpage.screenshot(path=str(OUT / 'desktop-lightbox-dark.png'))
    dpage.keyboard.press('Escape')
    dpage.click('[data-life-tab="journey"]'); settle(dpage, 400)
    dpage.screenshot(path=str(OUT / 'desktop-journey-dark.png'))
    dctx.close()

    # sidebar pin keeps working
    page.goto(f'{BASE}/index.html?page=life', wait_until='load'); settle(page, 1000)
    before = page.eval_on_selector('.rail', 'e => e.getBoundingClientRect().width')
    page.click('.rail-pin'); settle(page, 500)
    after = page.eval_on_selector('.rail', 'e => e.getBoundingClientRect().width')
    check('sidebar expand still works on Life', after > before, (before, after))
    overflow = page.evaluate('document.documentElement.scrollWidth > innerWidth')
    check('no horizontal overflow with expanded rail', not overflow)
    page.screenshot(path=str(OUT / 'desktop-overview-rail-expanded.png'))
    page.click('.rail-pin'); settle(page, 400)
    ctx.close()

    # ------------------------------------------------------------ viewports
    for (w, h, label) in [(1920, 1080, 'wide'), (1024, 768, 'tablet'), (768, 1024, 'tablet-portrait'), (390, 844, 'mobile'), (320, 640, 'narrow')]:
        c = browser.new_context(viewport={'width': w, 'height': h}, device_scale_factor=1, has_touch=w < 900, is_mobile=w < 900)
        c.add_init_script("try{localStorage.setItem('theme-mode','light');localStorage.setItem('primary-hue','210')}catch(e){}")
        p = c.new_page(); watch(p)
        for tab in ['overview', 'works', 'collections', 'journey', 'journal']:
            p.goto(f'{BASE}/index.html?page=life&tab={tab}', wait_until='load'); settle(p, 1300 if tab == 'collections' else 900)
            m = p.evaluate('''() => {
              const track = document.querySelector('.life-tabs__track');
              const tabs = [...document.querySelectorAll('.life-tab')];
              const active = document.querySelector('.life-tab[aria-selected="true"]').getBoundingClientRect();
              const tr = track.getBoundingClientRect();
              return {
                overflow: document.documentElement.scrollWidth > innerWidth || document.querySelector('.layout').scrollWidth > innerWidth,
                tabsSingleLine: tabs.every(t => Math.abs(t.getBoundingClientRect().top - tabs[0].getBoundingClientRect().top) < 2),
                tabTextOneLine: tabs.every(t => t.getBoundingClientRect().height <= 48),
                activeVisible: active.left >= tr.left - 1 && active.right <= tr.right + 1,
              };
            }''')
            m.update({'viewport': label, 'tab': tab})
            report['viewports'].append(m)
            check(f'{label} {tab}: no horizontal overflow', not m['overflow'])
            check(f'{label} {tab}: tabs single line', m['tabsSingleLine'] and m['tabTextOneLine'])
            check(f'{label} {tab}: active tab visible', m['activeVisible'])
            p.screenshot(path=str(OUT / f'{label}-{tab}.png'))

        if w <= 900:
            # sticky tab bar under the mobile toolbar; toolbar hides on scroll down
            p.goto(f'{BASE}/index.html?page=life&tab=works', wait_until='load'); settle(p, 1000)
            p.evaluate("document.querySelector('.layout').scrollBy(0, 220)"); settle(p, 200)
            p.evaluate("document.querySelector('.layout').scrollBy(0, 300)"); settle(p, 500)
            s = p.evaluate('''() => {
              const tb = document.querySelector('.site-toolbar').getBoundingClientRect();
              const tabs = document.querySelector('.life-tabs').getBoundingClientRect();
              const nav = document.querySelector('.site-nav').getBoundingClientRect();
              return { hidden: document.documentElement.classList.contains('toolbar-hidden'), tabsTop: tabs.top, tabsBottom: tabs.bottom, toolbarBottom: tb.bottom, navTop: nav.top };
            }''')
            check(f'{label}: toolbar hides on scroll down', s['hidden'], s)
            check(f'{label}: tabs stick near top when toolbar hidden', 0 <= s['tabsTop'] <= 24, s)
            p.screenshot(path=str(OUT / f'{label}-works-scrolled.png'))
            p.evaluate("document.querySelector('.layout').scrollBy(0, -60)"); settle(p, 500)
            s2 = p.evaluate('''() => ({ hidden: document.documentElement.classList.contains('toolbar-hidden'),
              tabsTop: document.querySelector('.life-tabs').getBoundingClientRect().top,
              toolbarBottom: document.querySelector('.site-toolbar').getBoundingClientRect().bottom })''')
            check(f'{label}: tabs sit below visible toolbar', (not s2['hidden']) and s2['tabsTop'] >= s2['toolbarBottom'] - 1, s2)
            p.screenshot(path=str(OUT / f'{label}-works-toolbar-back.png'))
            # lightbox on small screen
            p.goto(f'{BASE}/index.html?page=life&tab=collections&type=gallery', wait_until='load'); p.wait_for_selector('.gallery-item'); settle(p, 800)
            p.tap('.gallery-item >> nth=1'); settle(p, 400)
            p.screenshot(path=str(OUT / f'{label}-lightbox.png'))
            p.tap('[data-lightbox-next]'); settle(p, 200)
            ok_next = p.inner_text('[data-current-index]') == '3'  # opened the 2nd image
            p.tap('.gallery-lightbox__close'); settle(p, 300)
            check(f'{label}: lightbox navigates and closes', ok_next and not p.is_visible('#gallery-lightbox'))
            # tapping last tab scrolls it into view on narrow screens
            p.goto(f'{BASE}/index.html?page=life&tab=journal', wait_until='load'); settle(p, 900)
            vis = p.evaluate('''() => { const a = document.querySelector('.life-tab[aria-selected="true"]').getBoundingClientRect(), t = document.querySelector('.life-tabs__track').getBoundingClientRect(); return a.right <= t.right + 1 && a.left >= t.left - 1; }''')
            check(f'{label}: journal tab auto-scrolled into view', vis)
        c.close()

    browser.close()

passed = sum(c['passed'] for c in report['checks'])
report['summary'] = {'passed': passed, 'total': len(report['checks']), 'pageErrors': len(report['errors']), 'consoleErrors': len(report['console'])}
(OUT / 'report.json').write_text(json.dumps(report, ensure_ascii=False, indent=2), encoding='utf-8')
print(json.dumps(report['summary'], ensure_ascii=False))
for e in report['errors'] + report['console']:
    print('ERR', e)
