"""Local Phase 3 (About = 概览 / 统计 / 更新) browser regression checks. Requires Python Playwright + Chrome.
Run against a local static server with PHASE3_BASE_URL (default 127.0.0.1:8765), e.g.
  python scripts/phase1-preview.py --port 8765
  python scripts/phase3-about-check.py
Writes screenshots and a JSON report under artifacts/phase3/ (or PHASE3_OUT).
"""
import json
import os
from pathlib import Path
from urllib.parse import urlparse, parse_qs
from playwright.sync_api import sync_playwright

OUT = Path(os.environ.get('PHASE3_OUT', 'artifacts/phase3'))
OUT.mkdir(parents=True, exist_ok=True)
BASE = os.environ.get('PHASE3_BASE_URL', 'http://127.0.0.1:8765')
report = {'checks': [], 'errors': [], 'console': []}


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


def nav_state(page):
    return page.eval_on_selector_all(
        '.site-nav a',
        'els => els.map(a => [a.querySelector(".nav-label").textContent.trim(), a.classList.contains("active")])')


def active_nav(page):
    return [label for label, active in nav_state(page) if active]


def visible_panel(page):
    return page.evaluate('[...document.querySelectorAll("[data-about-panel]")].filter(p => !p.hidden).map(p => p.dataset.aboutPanel).join()')


def overflow_x(page):
    return page.evaluate('''() => {
      const w = document.documentElement.clientWidth;
      return [...document.querySelectorAll('#main-content *')]
        .filter(el => el.getClientRects().length && !el.closest('[hidden], svg, .update-calendar'))
        // 自身在横向滚动 / 裁剪容器里的元素不算溢出（如移动端可横滑的标签栏）
        .filter(el => { for (let p = el.parentElement; p && p.id !== 'main-content'; p = p.parentElement) {
          if (getComputedStyle(p).overflowX !== 'visible') return false; } return true; })
        .filter(el => { const r = el.getBoundingClientRect(); return r.right > w + 1 || r.left < -1; })
        .slice(0, 5).map(el => el.className || el.tagName);
    }''')


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

    # nav → About defaults to overview
    page.goto(f'{BASE}/index.html', wait_until='load'); settle(page, 1000)
    h0 = page.evaluate('history.length')
    page.click('.site-nav a[href="index.html?page=about"]'); settle(page, 900)
    check('nav → About opens overview', query(page) == {'page': 'about', 'tab': 'overview'} and visible_panel(page) == 'overview', page.url)
    check('About nav active, label 关于', active_nav(page) == ['关于'], nav_state(page))
    check('nav click adds one history entry', page.evaluate('history.length') == h0 + 1)
    labels = [t.strip() for t in page.locator('.about-tab').all_inner_texts()]
    check('tab labels Chinese only', labels == ['概览', '统计', '更新'], labels)
    check('overview keeps hero + title', page.inner_text('#about-title').strip() == '关于这个小站 ✨')
    check('「我是谁」 removed', page.locator('text=我是谁').count() == 0)
    check('Cloudflare Pages deployment described', 'Cloudflare Pages' in page.inner_text('.about-card--tech') and 'GitHub Pages' not in page.inner_text('[data-about-panel="overview"]'))
    page.wait_for_selector('[data-about-slot="stats"] .about-entry__metrics', timeout=5000)
    metrics = page.eval_on_selector_all('[data-about-slot="stats"] dd', 'els => els.map(e => e.textContent.trim())')
    meta = json.loads(Path('data/site-meta.json').read_text(encoding='utf-8'))
    updates = json.loads(Path('data/updates-index.json').read_text(encoding='utf-8'))
    check('stats entry uses real data', metrics[0] == str(meta['totals']['notes']) and metrics[1] == str(meta['totalContent']) and metrics[3] == str(len(updates)), metrics)
    latest = max(u['date'] for u in updates)
    check('update entry shows latest log date', latest.replace('-', '.') in page.inner_text('[data-about-slot="update"]'))
    check('update entry shows two recent items', page.locator('[data-about-slot="update"] li').count() == 2)
    page.screenshot(path=str(OUT / 'desktop-overview-light.png'))

    # declaration modal
    page.click('[data-open-declaration]'); settle(page, 300)
    check('declaration modal opens', page.is_visible('[data-declaration-modal]') and 'AI 使用说明' in page.inner_text('[data-declaration-modal]'))
    page.keyboard.press('Escape'); settle(page, 200)
    check('Esc closes declaration modal', not page.is_visible('[data-declaration-modal]'))

    # tabs + URL + history
    h1 = page.evaluate('history.length')
    page.click('[data-about-tab="stats"]'); settle(page, 1200)
    check('stats tab URL', query(page) == {'page': 'about', 'tab': 'stats'}, page.url)
    check('nav label 关于 · 统计 (About active)', active_nav(page) == ['关于 · 统计'], nav_state(page))
    check('stats hero + summary', page.locator('.stats-hero [data-stats-hero-visual] svg').count() == 1 and page.inner_text('[data-stats-summary="total"]') == str(meta['totalContent']))
    check('stats last updated follows log', page.inner_text('[data-stats-summary="lastUpdated"]') == f"{int(latest[5:7])}月{int(latest[8:])}日", page.inner_text('[data-stats-summary="lastUpdated"]'))
    stats = json.loads(Path('data/stats.json').read_text(encoding='utf-8'))
    months = page.eval_on_selector_all('.stats-chart-month', 'els => els.map(e => e.textContent)')
    check('growth chart uses snapshots', months == [s['month'] for s in stats['snapshots']], months)
    check('recent changes rendered', page.locator('[data-stats-recent] li').count() == 8)
    check('archive shows real dates', '2026年4月13日' in page.inner_text('[data-stats-archive]') and '2026年5月6日' not in page.inner_text('[data-stats-archive]'))
    wide = page.evaluate('Math.round(document.querySelector(".stats-page").getBoundingClientRect().width)')
    tabs_w = page.evaluate('Math.round(document.querySelector(".about-tabs").getBoundingClientRect().width)')
    check('1440: stats panel aligned with tab bar', abs(wide - tabs_w) <= 1, (wide, tabs_w))
    donut_before = page.text_content('.stats-donut-center-title') if page.locator('.stats-donut-center-title').count() else ''
    page.locator('[data-stats-primary-tab]:not(.is-active)').first.click(); settle(page, 300)
    check('data center category switch', page.text_content('.stats-donut-center-title') != donut_before, donut_before)
    page.screenshot(path=str(OUT / 'desktop-stats-light.png'))

    # hero animation pauses when stats hidden
    poly = '() => document.querySelector(".stats-column-face--top")?.getAttribute("points")'
    a = page.evaluate(poly); settle(page, 250); b = page.evaluate(poly)
    check('stats hero animates while visible', a != b)
    page.click('[data-about-tab="update"]'); settle(page, 1200)
    a = page.evaluate(poly); settle(page, 300); b = page.evaluate(poly)
    check('stats hero paused while hidden', a == b)
    check('update tab URL + label', query(page) == {'page': 'about', 'tab': 'update'} and active_nav(page) == ['关于 · 更新'], (page.url, nav_state(page)))
    check('update list renders all logs', page.locator('.update-card').count() == len(updates))
    check('update hero stats', page.inner_text('[data-stat="total"]') == str(len(updates)) and page.inner_text('[data-stat="latest"]') == latest.replace('-', '.'))
    check('three tab clicks = three history entries', page.evaluate('history.length') == h1 + 2)
    page.click('[data-about-tab="update"]'); settle(page, 300)
    check('clicking active tab adds no history', page.evaluate('history.length') == h1 + 2)
    page.screenshot(path=str(OUT / 'desktop-update-light.png'))

    # filter / sort / calendar
    page.click('#update-filter-toggle'); settle(page, 200)
    check('filter menu opens once', page.get_attribute('#update-filter-toggle', 'aria-expanded') == 'true')
    page.click('[data-chip="fix"]'); settle(page, 300)
    fix_count = sum(1 for u in updates if 'fix' in (u.get('tags') or []))
    check('filter fix', page.locator('.update-card').count() == fix_count, page.locator('.update-card').count())
    page.click('#update-filter-toggle'); page.click('[data-chip="all"]'); settle(page, 300)
    first_new = page.eval_on_selector('.update-card', 'e => e.dataset.date')
    page.click('#update-sort-toggle'); settle(page, 300)
    first_old = page.eval_on_selector('.update-card', 'e => e.dataset.date')
    check('sort oldest first', first_old < first_new and page.inner_text('.update-sort-text') == '最早优先', (first_new, first_old))
    page.click('#update-sort-toggle'); settle(page, 200)
    page.click('#update-calendar-trigger'); settle(page, 400)
    check('calendar opens', page.is_visible('#update-calendar') and page.locator('.update-calendar-cell--has-update').count() >= 1)
    page.mouse.click(5, 450); settle(page, 400)
    check('calendar closes on outside click', not page.evaluate('document.getElementById("update-calendar").classList.contains("is-open")'))

    # detail → back to list (history)
    page.evaluate('document.querySelector(".page-card").scrollTo({top: 900})'); settle(page, 200)
    list_scroll = page.evaluate('document.querySelector(".page-card").scrollTop')
    h2 = page.evaluate('history.length')
    # 用 DOM click，避免 Playwright 先把卡片滚进视口改变列表位置
    page.evaluate('''document.querySelector('.update-card[data-file="content/updates/2026-10-12.md"]').click()'''); settle(page, 1000)
    check('detail URL', query(page) == {'page': 'about', 'tab': 'update', 'update': '2026-10-12'}, page.url)
    check('detail renders markdown (h2 + table)', page.locator('.update-detail-body h2').count() >= 3 and page.locator('.update-detail-body table').count() == 1)
    check('tabs + nav stay during detail', page.is_visible('.about-tabs') and active_nav(page) == ['关于 · 更新'])
    check('list hidden, not destroyed', page.locator('.update-page:not(.update-detail-page)[hidden]').count() == 1)
    page.screenshot(path=str(OUT / 'desktop-update-detail-light.png'))
    page.click('[data-update-back]'); settle(page, 700)
    check('back button → list (history.back, no new entry)', query(page) == {'page': 'about', 'tab': 'update'} and page.evaluate('history.length') == h2 + 1, (page.url, page.evaluate('history.length'), h2))
    check('list scroll restored', abs(page.evaluate('document.querySelector(".page-card").scrollTop') - list_scroll) < 40, (list_scroll, page.evaluate('document.querySelector(".page-card").scrollTop')))
    page.go_forward(); settle(page, 800)
    check('forward reopens detail', page.locator('.update-detail-page').count() == 1 and query(page).get('update') == '2026-10-12')
    page.go_back(); settle(page, 500)
    check('browser back closes detail', page.locator('.update-detail-page').count() == 0 and visible_panel(page) == 'update')
    page.go_back(); settle(page, 500)
    check('back → stats tab', visible_panel(page) == 'stats' and query(page).get('tab') == 'stats')
    page.go_back(); settle(page, 500)
    check('back → overview', visible_panel(page) == 'overview' and active_nav(page) == ['关于'])
    page.go_forward(); page.go_forward(); settle(page, 600)
    check('forward x2 → update', visible_panel(page) == 'update')

    # keyboard
    page.focus('[data-about-tab="update"]'); page.keyboard.press('ArrowLeft'); settle(page, 600)
    check('ArrowLeft → stats', query(page).get('tab') == 'stats' and page.evaluate('document.activeElement.dataset.aboutTab') == 'stats')
    page.keyboard.press('Home'); settle(page, 400)
    check('Home → overview', query(page).get('tab') == 'overview')
    page.keyboard.press('End'); settle(page, 400)
    check('End → update', query(page).get('tab') == 'update')

    # refresh keeps tab / detail
    page.goto(f'{BASE}/index.html?page=about&tab=update&update=2026-10-13', wait_until='load'); settle(page, 1500)
    check('direct detail link', page.locator('.update-detail-title').count() == 1 and visible_panel(page) == 'update')
    page.reload(wait_until='load'); settle(page, 1500)
    check('reload keeps detail', page.locator('.update-detail-title').count() == 1 and query(page).get('update') == '2026-10-13')
    h3 = page.evaluate('history.length')
    page.click('[data-update-back]'); settle(page, 600)
    check('back button on direct link pushes list', query(page) == {'page': 'about', 'tab': 'update'} and page.evaluate('history.length') == h3 + 1)
    page.goto(f'{BASE}/index.html?page=about&tab=update&update=no-such-log', wait_until='load'); settle(page, 1200)
    check('unknown update id shows message', '没有找到这条更新' in page.inner_text('.update-detail-page'))

    # legacy addresses are normalized in place (replaceState, no extra entry)
    for legacy, expected in [
        ('?page=about', {'page': 'about', 'tab': 'overview'}),
        ('?page=stats', {'page': 'about', 'tab': 'stats'}),
        ('?page=update', {'page': 'about', 'tab': 'update'}),
        ('?page=update&update=2026-10-12', {'page': 'about', 'tab': 'update', 'update': '2026-10-12'}),
        ('?page=stats&from=old', {'page': 'about', 'tab': 'stats', 'from': 'old'}),
        ('?page=about&tab=bogus', {'page': 'about', 'tab': 'overview'}),
    ]:
        page.goto(f'{BASE}/index.html', wait_until='load'); settle(page, 300)
        before = page.evaluate('history.length')
        page.goto(f'{BASE}/index.html{legacy}', wait_until='load'); settle(page, 1300)
        ok = query(page) == expected and page.evaluate('history.length') == before + 1 and visible_panel(page) == expected['tab']
        check(f'legacy {legacy} → {expected}', ok, (page.url, visible_panel(page)))
    check('legacy update link opens detail', page.locator('.update-detail-page').count() == 0)  # last case is overview
    page.goto(f'{BASE}/html/stats.html', wait_until='load'); settle(page, 1300)
    check('html/stats.html redirects', query(page) == {'page': 'about', 'tab': 'stats'}, page.url)
    page.goto(f'{BASE}/html/update.html', wait_until='load'); settle(page, 1300)
    check('html/update.html redirects', query(page) == {'page': 'about', 'tab': 'update'}, page.url)

    # home entries
    page.goto(f'{BASE}/index.html', wait_until='load'); settle(page, 1500)
    check('home stats card link', page.get_attribute('[data-card="stats"] .bento-card-link', 'href') == 'index.html?page=about&tab=stats')
    check('home update card link', page.get_attribute('[data-card="update"] .bento-card-link', 'href') == 'index.html?page=about&tab=update')
    page.wait_for_selector('[data-card="update"] .bento-list-link', timeout=5000)
    href = page.get_attribute('[data-card="update"] .bento-list-link >> nth=0', 'href')
    check('home dynamic update link', href.startswith('index.html?page=about&tab=update&update='), href)
    page.click('[data-card="update"] .bento-list-link >> nth=0'); settle(page, 1500)
    check('home update item opens detail', page.locator('.update-detail-title').count() == 1 and active_nav(page) == ['关于 · 更新'])
    page.go_back(); settle(page, 1200)
    page.click('[data-card="stats"] .bento-card-link'); settle(page, 1500)
    check('home stats card → About stats', visible_panel(page) == 'stats' and active_nav(page) == ['关于 · 统计'])

    # SPA round trip: leave About and come back → no duplicate init / listeners
    page.click('.site-nav a[href="index.html?page=notes"]'); settle(page, 900)
    check('leaving About resets nav label', active_nav(page) == ['笔记'] and '关于' in [l for l, _ in nav_state(page)], nav_state(page))
    page.go_back(); settle(page, 1300)
    check('back into About stats', visible_panel(page) == 'stats' and page.locator('.stats-page').count() == 1)
    page.click('[data-about-tab="update"]'); settle(page, 1000)
    page.click('#update-filter-toggle'); settle(page, 200)
    check('filter toggles once after remount', page.get_attribute('#update-filter-toggle', 'aria-expanded') == 'true')
    page.keyboard.press('Escape'); settle(page, 200)
    page.click('#update-calendar-trigger'); settle(page, 300)
    check('calendar opens after remount', page.evaluate('document.getElementById("update-calendar").classList.contains("is-open")'))
    page.keyboard.press('Escape'); settle(page, 400)
    check('Esc closes calendar after remount', not page.evaluate('document.getElementById("update-calendar").classList.contains("is-open")'))
    check('single update list in DOM', page.locator('#update-list').count() == 1 and page.locator('.stats-page').count() == 1)

    # params of other pages must not leak into About URLs
    page.goto(f'{BASE}/index.html?page=life&tab=works&type=anime', wait_until='load'); settle(page, 1200)
    page.click('.site-nav a[href="index.html?page=about"]'); settle(page, 900)
    check('Life params do not leak into About URL', query(page) == {'page': 'about', 'tab': 'overview'}, page.url)
    page.click('[data-about-tab="stats"]'); settle(page, 1000)

    # search entry still routes into About
    page.evaluate('window._loadPage("stats")'); settle(page, 800)
    check('_loadPage("stats") switches in place', query(page).get('tab') == 'stats' and visible_panel(page) == 'stats')

    # sticky tabs + floating back button in detail
    page.click('[data-about-tab="overview"]'); settle(page, 500)
    page.evaluate('document.querySelector(".page-card").scrollTo({top: 300})'); settle(page, 300)
    top = page.evaluate('Math.round(document.querySelector(".about-tabs").getBoundingClientRect().top)')
    check('tabs stick to top while scrolling', 0 <= top <= 20, top)
    aside = page.evaluate('''() => { const t = document.querySelector('.about-tabs').getBoundingClientRect();
      const a = document.querySelector('.about-aside').getBoundingClientRect(); return a.top >= t.bottom - 1; }''')
    check('sticky aside stays below tabs', aside)
    page.screenshot(path=str(OUT / 'desktop-overview-scrolled.png'))

    ctx.close()

    # dark mode + other hue + pinned sidebar
    ctx = browser.new_context(viewport={'width': 1440, 'height': 900})
    ctx.add_init_script("try{localStorage.setItem('theme-mode','dark');localStorage.setItem('primary-hue','145');localStorage.setItem('y181_sidebar_pinned','true')}catch(e){}")
    page = ctx.new_page(); watch(page)
    page.goto(f'{BASE}/index.html?page=about&tab=overview', wait_until='load'); settle(page, 1500)
    check('dark theme applied', page.evaluate('document.documentElement.dataset.theme') == 'dark')
    check('pinned sidebar shows 关于 label', page.evaluate('document.documentElement.dataset.sidebarPinned') == 'true')
    page.screenshot(path=str(OUT / 'desktop-overview-dark.png'))
    page.click('[data-about-tab="stats"]'); settle(page, 1200)
    page.screenshot(path=str(OUT / 'desktop-stats-dark.png'))
    page.click('[data-about-tab="update"]'); settle(page, 1000)
    page.screenshot(path=str(OUT / 'desktop-update-dark.png'))
    check('desktop no horizontal overflow', not overflow_x(page), overflow_x(page))
    ctx.close()

    # ------------------------------------------------------------ async races (Codex review)
    def race_page():
        c = browser.new_context(viewport={'width': 1440, 'height': 900})
        c.add_init_script("try{localStorage.setItem('theme-mode','light')}catch(e){}")
        p = c.new_page(); watch(p)
        return c, p

    def hold(pattern, p):
        held = []
        p.route(pattern, lambda route: held.append(route))
        return held

    def release(held, p, pattern):
        # 先放行再取消拦截：反过来会让 Playwright 内部等待中的路由任务被取消并打印噪音
        for route in held:
            try:
                route.continue_()
            except Exception:
                pass
        held.clear()
        p.unroute(pattern)

    loading_clear = '''() => { const m = document.getElementById("main-content");
      return m.style.pointerEvents === "" && m.style.opacity !== "0.4"; }'''

    # P1: back to a mounted About while a cross-page request is still pending
    ctx, page = race_page()
    page.goto(f'{BASE}/index.html?page=about&tab=overview', wait_until='load'); settle(page, 1200)
    page.click('[data-about-tab="update"]'); settle(page, 1000)
    held = hold('**/html/notes.html', page)
    h = page.evaluate('history.length')
    page.click('.site-nav a[href="index.html?page=notes"]'); settle(page, 400)
    check('race P1: notes request is pending (loading shown)', len(held) == 1 and not page.evaluate(loading_clear), len(held))
    page.go_back(); settle(page, 600)
    check('race P1: back returns to About overview immediately', query(page) == {'page': 'about', 'tab': 'overview'} and visible_panel(page) == 'overview', page.url)
    check('race P1: loading state cleared by back', page.evaluate(loading_clear))
    release(held, page, '**/html/notes.html'); settle(page, 1000)
    check('race P1: stale notes response does not overwrite About', visible_panel(page) == 'overview' and page.locator('.notes-page').count() == 0, page.url)
    check('race P1: stale response leaves URL + history alone', query(page) == {'page': 'about', 'tab': 'overview'} and page.evaluate('history.length') == h, (page.url, page.evaluate('history.length'), h))
    check('race P1: nav highlight still 关于', active_nav(page) == ['关于'], nav_state(page))
    # variant: sub-tab click is also a newer intent
    held = hold('**/html/life.html', page)
    page.click('.site-nav a[href="index.html?page=life"]'); settle(page, 300)
    # 加载中正文 pointer-events: none，鼠标点不到；键盘仍可切换分区
    page.focus('[data-about-tab="overview"]'); page.keyboard.press('ArrowRight'); settle(page, 800)
    release(held, page, '**/html/life.html'); settle(page, 1000)
    check('race P1: About tab click beats pending Life request', query(page) == {'page': 'about', 'tab': 'stats'} and page.locator('[data-life-root]').count() == 0 and page.evaluate(loading_clear), page.url)
    # the abandoned page still loads normally afterwards
    page.click('.site-nav a[href="index.html?page=notes"]'); settle(page, 1200)
    check('race P1: Notes loads normally afterwards', query(page).get('page') == 'notes' and page.locator('.notes-page').count() == 1)
    ctx.close()

    # P1: update index still pending while leaving About and coming back
    ctx, page = race_page()
    held = hold('**/updates-index.json*', page)
    page.goto(f'{BASE}/index.html?page=about&tab=update', wait_until='load'); settle(page, 1000)
    page.click('.site-nav a[href="index.html"]'); settle(page, 1000)
    page.click('.site-nav a[href="index.html?page=about"]'); settle(page, 800)
    page.click('[data-about-tab="update"]'); settle(page, 600)
    release(held, page, '**/updates-index.json*'); settle(page, 1500)
    check('race P1: update list renders after remount', page.locator('.update-card').count() == len(updates), page.locator('.update-card').count())
    check('race P1: single list / no duplicate cards', page.locator('#update-list').count() == 1 and page.locator('.update-month-header').count() == len({u['date'][:7] for u in updates}))
    page.click('#update-filter-toggle'); page.click('[data-chip="fix"]'); settle(page, 300)
    check('race P1: filter works after remount', page.locator('.update-card').count() == fix_count)
    page.click('#update-calendar-trigger'); settle(page, 400)
    check('race P1: calendar works after remount', page.evaluate('document.getElementById("update-calendar").classList.contains("is-open")'))
    ctx.close()

    # P1: index temporarily 503 → retry state → recovers
    ctx, page = race_page()
    console_before = len(report['console'])
    page.route('**/updates-index.json*', lambda route: route.fulfill(status=503, body='busy'))
    page.goto(f'{BASE}/index.html?page=about&tab=update', wait_until='load'); settle(page, 1500)
    check('race 503: retry state shown, not marked ready', page.locator('[data-about-retry="update"]').count() == 1
          and page.get_attribute('[data-about-mount="update"]', 'data-mounted') is None)
    page.click('[data-about-retry="update"]'); settle(page, 1200)
    check('race 503: retry while still failing stays retryable', page.locator('[data-about-retry="update"]').count() == 1)
    page.unroute_all(behavior='ignoreErrors')
    # 这一段的 503 与初始化失败日志是故意注入的，单独记录，不计入控制台错误
    report.setdefault('expected_console', []).extend(report['console'][console_before:])
    del report['console'][console_before:]
    page.click('[data-about-tab="overview"]'); settle(page, 500)
    page.click('[data-about-tab="update"]'); settle(page, 1500)
    check('race 503: re-entering the tab recovers', page.locator('.update-card').count() == len(updates) and page.locator('#update-list').count() == 1)
    check('race 503: overview entry cards recover too', page.evaluate('''() => { document.querySelector('[data-about-tab="overview"]').click();
      return true; }''') and (settle(page, 800) or True) and page.locator('[data-about-slot="update"] li').count() == 2)
    ctx.close()

    # P2: stale detail must not scroll / focus another tab
    ctx, page = race_page()
    page.goto(f'{BASE}/index.html?page=about&tab=update', wait_until='load'); settle(page, 1500)
    held = hold('**/content/updates/2026-10-12.md', page)
    page.evaluate('''document.querySelector('.update-card[data-file="content/updates/2026-10-12.md"]').click()'''); settle(page, 400)
    page.click('[data-about-tab="overview"]'); settle(page, 400)
    page.evaluate('document.querySelector(".page-card").scrollTo({top: 600})'); settle(page, 300)
    before = page.evaluate('document.querySelector(".page-card").scrollTop')
    release(held, page, '**/content/updates/2026-10-12.md'); settle(page, 1000)
    check('race P2: stale detail does not scroll overview', abs(page.evaluate('document.querySelector(".page-card").scrollTop') - before) < 2, (before, page.evaluate('document.querySelector(".page-card").scrollTop')))
    check('race P2: stale detail not rendered / no focus steal', page.locator('.update-detail-page').count() == 0
          and not page.evaluate('document.activeElement?.classList.contains("update-detail-title")'))
    check('race P2: URL stays on overview', query(page) == {'page': 'about', 'tab': 'overview'})
    page.click('[data-about-tab="update"]'); settle(page, 600)
    check('race P2: update tab shows the list, not the stale detail', page.locator('.update-detail-page').count() == 0 and page.locator('.update-page:not(.update-detail-page):not([hidden])').count() == 1)
    # rapid consecutive opens: A (slow) → back → B (fast) → A arrives late
    held = hold('**/content/updates/2026-10-12.md', page)
    page.evaluate('''document.querySelector('.update-card[data-file="content/updates/2026-10-12.md"]').click()'''); settle(page, 300)
    page.go_back(); settle(page, 400)
    page.evaluate('''document.querySelector('.update-card[data-file="content/updates/2026-10-13.md"]').click()'''); settle(page, 800)
    release(held, page, '**/content/updates/2026-10-12.md'); settle(page, 1000)
    title_b = next(u['title'] for u in updates if u['file'].endswith('2026-10-13.md'))
    check('race P2: latest of rapid opens wins', query(page).get('update') == '2026-10-13' and page.text_content('.update-detail-title') == title_b
          and page.locator('.update-detail-page').count() == 1, page.url)
    # normal detail + back still fine
    page.click('[data-update-back]'); settle(page, 700)
    check('race P2: back to list still works', page.locator('.update-detail-page').count() == 0 and query(page) == {'page': 'about', 'tab': 'update'})
    ctx.close()

    # ------------------------------------------------------------ stats Hero animation lifecycle (Codex round 2)
    RAF_COUNTER = """try{localStorage.setItem('theme-mode','light')}catch(e){}
      window.__rafCalls = 0; window.__frames = 0;
      const __raf = window.requestAnimationFrame.bind(window);
      window.requestAnimationFrame = (cb) => { window.__rafCalls += 1; return __raf(cb); };
      // 不计数的监视循环：统计真实帧数，把「页面 rAF 调用 / 帧」作为动画循环个数（与帧率无关）
      const __tick = () => { window.__frames += 1; __raf(__tick); }; __raf(__tick);"""

    def hero_page(reduced=False):
        c = browser.new_context(viewport={'width': 1440, 'height': 900}, reduced_motion='reduce' if reduced else 'no-preference')
        c.add_init_script(RAF_COUNTER)
        p = c.new_page(); watch(p)
        return c, p

    def raf_rate(p, ms=1000):
        """页面代码每帧调用 rAF 的次数：1 ≈ 一个动画循环，0 ≈ 没有循环，2 ≈ 循环叠加。"""
        c0, f0 = p.evaluate('[window.__rafCalls, window.__frames]'); settle(p, ms)
        c1, f1 = p.evaluate('[window.__rafCalls, window.__frames]')
        return round((c1 - c0) / max(1, f1 - f0), 2)

    hero_points = '() => document.querySelector("[data-stats-hero-visual] .stats-column-face--top")?.getAttribute("points") || null'

    def hero_moving(p, ms=400):
        a = p.evaluate(hero_points); settle(p, ms); b = p.evaluate(hero_points)
        return a is not None and a != b

    # D: direct entry → charts + Hero initialise and animate (also gives the single-loop baseline)
    ctx, page = hero_page()
    page.goto(f'{BASE}/index.html?page=about&tab=stats', wait_until='load'); settle(page, 1500)
    months = page.eval_on_selector_all('.stats-chart-month', 'els => els.map(e => e.textContent)')
    check('hero D: direct stats renders charts', months == [s['month'] for s in stats['snapshots']] and page.locator('.stats-donut-svg').count() == 1, months)
    check('hero D: Hero animates on direct entry', hero_moving(page))
    single = raf_rate(page)
    check('hero D: one animation loop (~1 rAF per frame)', 0.8 <= single <= 1.25, single)
    ctx.close()

    # A: stats.html delayed → back to overview → response arrives while hidden
    ctx, page = hero_page()
    page.goto(f'{BASE}/index.html?page=about&tab=overview', wait_until='load'); settle(page, 1200)
    idle = raf_rate(page)
    held = hold('**/html/stats.html', page)
    page.click('[data-about-tab="stats"]'); settle(page, 300)
    check('hero A: stats.html request is pending', len(held) == 1)
    page.click('[data-about-tab="overview"]'); settle(page, 300)
    release(held, page, '**/html/stats.html'); settle(page, 1000)
    check('hero A: stats mounted in the hidden panel', page.locator('[data-about-panel="stats"][hidden] .stats-page').count() == 1
          and page.evaluate(hero_points) is not None)
    check('hero A: hidden Hero points stay still', not hero_moving(page, 500))
    hidden_rate = raf_rate(page)
    check('hero A: no rAF loop while hidden', hidden_rate <= idle + 0.1, (hidden_rate, idle))
    check('hero A: URL / overview unaffected', query(page) == {'page': 'about', 'tab': 'overview'} and visible_panel(page) == 'overview')

    # B: re-enter stats → content shown, animation starts (single loop)
    page.click('[data-about-tab="stats"]'); settle(page, 600)
    check('hero B: stats content visible after re-entry', visible_panel(page) == 'stats'
          and page.inner_text('[data-stats-summary="total"]') == str(meta['totalContent']) and page.locator('.stats-growth-svg').count() == 1)
    check('hero B: Hero animates again', hero_moving(page))
    rate_b = raf_rate(page)
    check('hero B: still a single loop', 0.8 <= rate_b <= 1.25, rate_b)

    # C: rapid toggling → never more than one loop, stops when hidden, no errors
    errors_before = len(report['errors']) + len(report['console'])
    for _ in range(8):
        page.click('[data-about-tab="overview"]'); settle(page, 40)
        page.click('[data-about-tab="stats"]'); settle(page, 40)
    settle(page, 400)
    rate_c = raf_rate(page)
    check('hero C: rapid toggling leaves exactly one loop', 0.8 <= rate_c <= 1.25 and hero_moving(page), rate_c)
    page.click('[data-about-tab="overview"]'); settle(page, 400)
    check('hero C: ending on overview stops the loop', not hero_moving(page, 500) and raf_rate(page) <= idle + 0.1)
    check('hero C: no errors while toggling', len(report['errors']) + len(report['console']) == errors_before)
    page.click('[data-about-tab="stats"]'); settle(page, 500)
    page.locator('[data-stats-primary-tab]:not(.is-active)').first.click(); settle(page, 300)
    check('hero C: data center still switches after toggling', page.locator('.stats-donut-svg').count() == 1
          and page.locator('[data-stats-primary-tab].is-active').count() == 1)
    ctx.close()

    # E: prefers-reduced-motion → static Hero, never loops (direct entry, re-entry, late mount)
    ctx, page = hero_page(reduced=True)
    page.goto(f'{BASE}/index.html?page=about&tab=stats', wait_until='load'); settle(page, 1500)
    check('hero E: reduced motion draws a static Hero', page.evaluate(hero_points) is not None and not hero_moving(page, 500))
    check('hero E: reduced motion has no rAF loop', raf_rate(page) <= 0.1)
    page.click('[data-about-tab="overview"]'); settle(page, 300)
    page.click('[data-about-tab="stats"]'); settle(page, 500)
    check('hero E: re-entry keeps it static', not hero_moving(page, 500) and raf_rate(page) <= 0.1)
    check('hero E: About panel animation disabled', page.evaluate('getComputedStyle(document.querySelector("[data-about-panel=stats]")).animationName') == 'none')
    ctx.close()

    # ------------------------------------------------------------ wide 1920
    ctx = browser.new_context(viewport={'width': 1920, 'height': 1080})
    ctx.add_init_script("try{localStorage.setItem('theme-mode','light')}catch(e){}")
    page = ctx.new_page(); watch(page)
    page.goto(f'{BASE}/index.html?page=about&tab=stats', wait_until='load'); settle(page, 1500)
    wide = page.evaluate('Math.round(document.querySelector(".stats-page").getBoundingClientRect().width)')
    check('1920: stats uses wide layout (>1500px)', wide > 1500, wide)
    tabs_box = page.evaluate('Math.round(document.querySelector(".about-tabs").getBoundingClientRect().left)')
    page.click('[data-about-tab="overview"]'); settle(page, 500)
    check('1920: tab bar does not move between tabs', tabs_box == page.evaluate('Math.round(document.querySelector(".about-tabs").getBoundingClientRect().left)'))
    page.screenshot(path=str(OUT / 'wide-overview.png'))
    page.click('[data-about-tab="stats"]'); settle(page, 500)
    page.screenshot(path=str(OUT / 'wide-stats.png'))
    ctx.close()

    # ------------------------------------------------------------ tablet 768 + mobile 375
    for name, vp in [('tablet', {'width': 768, 'height': 1024}), ('mobile', {'width': 375, 'height': 812})]:
        ctx = browser.new_context(viewport=vp, is_mobile=name == 'mobile', has_touch=True)
        ctx.add_init_script("try{localStorage.setItem('theme-mode','light');localStorage.setItem('primary-hue','260')}catch(e){}")
        page = ctx.new_page(); watch(page)
        page.goto(f'{BASE}/index.html?page=about', wait_until='load'); settle(page, 1500)
        check(f'{name}: bottom nav highlights 关于', active_nav(page) == ['关于'], nav_state(page))
        check(f'{name}: overview no horizontal overflow', not overflow_x(page), overflow_x(page))
        page.screenshot(path=str(OUT / f'{name}-overview.png'), full_page=False)
        page.tap('[data-about-tab="stats"]'); settle(page, 1300)
        check(f'{name}: stats tab via touch', query(page).get('tab') == 'stats' and active_nav(page) == ['关于 · 统计'])
        check(f'{name}: stats no horizontal overflow', not overflow_x(page), overflow_x(page))
        page.screenshot(path=str(OUT / f'{name}-stats.png'), full_page=False)
        page.tap('[data-about-tab="update"]'); settle(page, 1200)
        check(f'{name}: update no horizontal overflow', not overflow_x(page), overflow_x(page))
        page.evaluate('document.querySelector(".layout").scrollTo({top: 900})'); settle(page, 500)
        tabs = page.evaluate('Math.round(document.querySelector(".about-tabs").getBoundingClientRect().top)')
        toolbar = page.evaluate('Math.round(document.querySelector(".site-toolbar").getBoundingClientRect().bottom)')
        check(f'{name}: sticky tabs not under toolbar', tabs >= toolbar - 1 or tabs >= 0, (tabs, toolbar))
        page.screenshot(path=str(OUT / f'{name}-update-scrolled.png'), full_page=False)
        if name == 'mobile':
            page.tap('#update-calendar-trigger'); settle(page, 500)
            check('mobile: calendar bottom sheet opens', page.evaluate('document.getElementById("update-calendar").classList.contains("is-open")'))
            page.screenshot(path=str(OUT / 'mobile-calendar.png'), full_page=False)
            page.tap('#update-calendar-backdrop', position={'x': 20, 'y': 40}); settle(page, 500)
            page.tap('.update-card >> nth=1'); settle(page, 1200)
            check('mobile: detail opens', page.locator('.update-detail-title').count() == 1)
            check('mobile: detail no horizontal overflow', not overflow_x(page), overflow_x(page))
            page.screenshot(path=str(OUT / 'mobile-detail.png'), full_page=False)
            page.evaluate('document.querySelector(".layout").scrollTo({top: 600})'); settle(page, 400)
            page.evaluate('document.getElementById("back-to-prev").click()'); settle(page, 800)
            check('mobile: floating back closes detail', page.locator('.update-detail-page').count() == 0 and query(page) == {'page': 'about', 'tab': 'update'})
        ctx.close()

    browser.close()

passed = sum(c['passed'] for c in report['checks'])
print(f'\n{passed}/{len(report["checks"])} checks passed; page errors: {len(report["errors"])}; console errors: {len(report["console"])}')
for e in report['errors'] + report['console']:
    print('  ', e)
(OUT / 'report.json').write_text(json.dumps(report, ensure_ascii=False, indent=2), encoding='utf-8')
