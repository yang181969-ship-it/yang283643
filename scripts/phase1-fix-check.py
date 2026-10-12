"""Phase 1 bug-fix regression checks: layout width, search, theme, date button,
mobile top spacing, button-only sidebar, settings removal.
Run from the repository root against `python scripts/phase1-preview.py`:
    python scripts/phase1-fix-check.py
Writes screenshots and fix-report.json under artifacts/phase1/ (git-ignored).
"""
import json
import os
from datetime import datetime, timedelta, timezone
from pathlib import Path
from playwright.sync_api import sync_playwright

OUT = Path('artifacts/phase1')
OUT.mkdir(parents=True, exist_ok=True)
BASE = os.environ.get('PHASE1_BASE_URL', 'http://127.0.0.1:8765')
report = {'checks': [], 'metrics': {}, 'errors': []}


def check(name, condition, detail=None):
    report['checks'].append({'name': name, 'passed': bool(condition), 'detail': detail})
    print(('PASS ' if condition else 'FAIL ') + name + ('' if condition or detail is None else f'  -> {detail}'), flush=True)


def watch(page, label):
    page.on('pageerror', lambda e: report['errors'].append(f'{label} pageerror: {e}'))
    page.on('console', lambda m: report['errors'].append(f'{label} console: {m.text}') if m.type == 'error' else None)
    # Audio files are not part of the repository checkout; everything else must load.
    page.on('requestfailed', lambda r: None if r.url.endswith('.mp3') else report['errors'].append(f'{label} requestfailed: {r.url}'))
    page.on('response', lambda r: report['errors'].append(f'{label} HTTP {r.status}: {r.url}') if r.status >= 400 and not r.url.endswith('.mp3') else None)


OPEN = "[...document.querySelectorAll('dialog[open]')].map(d => d.id)"
NO_OVERFLOW = 'document.documentElement.scrollWidth <= innerWidth && document.querySelector(".layout").scrollWidth <= innerWidth'
FIRST_CARD = '''() => { const el = document.querySelector('main .bento-card, main .card, main .note-card, main .about-page > *, main > *');
  return el.getBoundingClientRect().top; }'''

with sync_playwright() as pw:
    browser = pw.chromium.launch(channel='chrome', headless=True)

    # ---------- 1 + 5. Desktop width and button-only sidebar ----------
    ctx = browser.new_context(viewport={'width': 1920, 'height': 1080}, timezone_id='Asia/Shanghai')
    page = ctx.new_page(); watch(page, 'desktop')
    page.goto(BASE, wait_until='load'); page.wait_for_timeout(1500)
    for w, h in [(1920, 1080), (1680, 900), (1440, 900), (901, 768)]:
        page.set_viewport_size({'width': w, 'height': h})
        states = {}
        for expanded in [False, True]:
            if (page.evaluate("document.documentElement.dataset.sidebarPinned") == 'true') != expanded:
                page.locator('.rail-pin').click()
            page.mouse.move(w - 10, h // 2); page.wait_for_timeout(450)
            m = page.evaluate('''() => { const r = document.querySelector('.rail').getBoundingClientRect();
              const card = document.querySelector('main .bento-card').getBoundingClientRect();
              const main = document.querySelector('main').getBoundingClientRect();
              return { rail: r.width, gap: Math.round(card.left - r.right), mainWidth: Math.round(main.width),
                rightGap: Math.round(innerWidth - main.right) }; }''')
            states[expanded] = m
            check(f'{w}px {"expanded" if expanded else "collapsed"} rail width', m['rail'] == (220 if expanded else 68), m)
            check(f'{w}px {"expanded" if expanded else "collapsed"} rail-to-card gap is moderate', 40 <= m['gap'] <= 80, m)
            check(f'{w}px no horizontal overflow', page.evaluate(NO_OVERFLOW))
            if w in (1920, 1680, 1440):
                page.screenshot(path=str(OUT / f'fix-desktop-{w}-{"expanded" if expanded else "collapsed"}.png'))
        report['metrics'][f'desktop-{w}'] = states
        check(f'{w}px collapsing widens content by 152px', states[False]['mainWidth'] - states[True]['mainWidth'] == 152, states)
    page.set_viewport_size({'width': 1440, 'height': 900})
    if page.evaluate("document.documentElement.dataset.sidebarPinned") == 'true':
        page.locator('.rail-pin').click()
    page.mouse.move(1200, 400); page.wait_for_timeout(300)
    for target in ['.rail .logo', '.site-nav a:nth-child(3)', '[data-tool="calendar"]', '#theme-toggle', '.rail']:
        box = page.locator(target).first.bounding_box()
        page.mouse.move(box['x'] + 10, box['y'] + box['height'] / 2, steps=5); page.wait_for_timeout(500)
        check(f'hover on {target} does not expand', page.locator('.rail').bounding_box()['width'] == 68)
    page.mouse.move(1200, 400); page.wait_for_timeout(300)
    check('pointer leaving does not change state', page.locator('.rail').bounding_box()['width'] == 68)
    page.locator('.site-nav a').first.focus(); page.keyboard.press('Tab'); page.keyboard.press('Tab'); page.wait_for_timeout(400)
    check('keyboard focus does not expand', page.locator('.rail').bounding_box()['width'] == 68)
    check('collapsed: labels hidden, nav tooltips present',
          page.evaluate("getComputedStyle(document.querySelector('.nav-label')).opacity") == '0'
          and page.locator('.site-nav a[title]').count() == 5)
    pin = page.locator('.rail-pin')
    check('collapsed pin aria state', pin.get_attribute('aria-expanded') == 'false' and pin.get_attribute('aria-label') == '展开侧栏')
    pin.click(); page.wait_for_timeout(450)
    check('expanded pin aria state + labels visible', pin.get_attribute('aria-expanded') == 'true' and pin.get_attribute('aria-label') == '收起侧栏'
          and page.evaluate("getComputedStyle(document.querySelector('.nav-label')).opacity") == '1'
          and page.evaluate("getComputedStyle(document.querySelector('.rail-pin svg')).transform") != 'none')
    check('expanded state stored', page.evaluate("localStorage.getItem('y181_sidebar_pinned')") == 'true')
    page.reload(wait_until='load'); page.wait_for_timeout(600)
    check('expanded survives reload', page.locator('.rail').bounding_box()['width'] == 220)
    page.locator('.site-nav a[href*="page=notes"]').click(); page.wait_for_timeout(800)
    check('expanded survives SPA navigation', page.locator('.rail').bounding_box()['width'] == 220)
    page.goto(BASE + '/html/stats.html', wait_until='load'); page.wait_for_timeout(600)
    check('expanded survives standalone page', page.locator('.rail').bounding_box()['width'] == 220)
    page.locator('.rail-pin').click(); page.wait_for_timeout(450)
    page.goto(BASE, wait_until='load'); page.wait_for_timeout(600)
    check('collapsed survives page change', page.locator('.rail').bounding_box()['width'] == 68)
    check('rail transition is 220ms', page.evaluate("getComputedStyle(document.querySelector('.rail')).transitionDuration") == '0.22s')

    # ---------- 6. Settings removed ----------
    check('settings button, dialog and link removed',
          page.locator('[data-tool="settings"], #tool-settings, .shell-settings-link, [data-pin-setting]').count() == 0)
    check('rail actions are exactly search + theme',
          page.evaluate("[...document.querySelectorAll('.rail-actions > button')].map(b => b.dataset.tool).join()") == 'search,theme')

    # ---------- 2. Search (desktop) ----------
    page.locator('#search-toggle').click(); page.wait_for_timeout(300)
    check('search opens', page.evaluate(OPEN) == ['tool-search'] and page.evaluate("document.activeElement.id") == 'search-input')
    page.keyboard.type('魔女')
    page.locator('.search-result-card').first.wait_for(timeout=8000)
    check('typing shows live results', page.locator('.search-result-card').count() > 0)
    page.locator('.search-popover__status').click(); page.wait_for_timeout(250)
    check('clicking inside dialog keeps it open', page.evaluate(OPEN) == ['tool-search'])
    filters = page.locator('.search-filter:not([disabled])')
    filters.nth(1).click(); page.wait_for_timeout(200)
    check('category filter works', page.locator('.search-filter.is-active').count() == 1 and page.locator('.search-filter.is-active').get_attribute('data-search-filter') != 'all')
    page.locator('#search-clear').click(); page.wait_for_timeout(300)
    check('clear empties input', page.input_value('#search-input') == '' and page.evaluate(OPEN) == ['tool-search'])
    page.keyboard.type('魔女'); page.locator('.search-result-card').first.wait_for()
    check('search after clearing', page.locator('.search-result-card').count() > 0)
    page.screenshot(path=str(OUT / 'fix-search-desktop.png'))
    page.keyboard.press('Escape'); page.wait_for_timeout(250)
    check('Esc closes search, focus returns', page.evaluate(OPEN) == [] and page.evaluate("document.activeElement.id") == 'search-toggle')
    page.locator('#search-toggle').click(); page.wait_for_timeout(300)
    check('reopen restores previous results', page.evaluate(OPEN) == ['tool-search'] and page.locator('.search-result-card:visible').count() > 0)
    page.keyboard.press('Control+k'); page.wait_for_timeout(250)
    check('Ctrl+K closes search', page.evaluate(OPEN) == [])
    page.locator('#search-toggle').click(); page.wait_for_timeout(300)
    page.mouse.click(8, 8); page.wait_for_timeout(250)
    check('backdrop click closes search', page.evaluate(OPEN) == [])
    page.locator('#search-toggle').click(); page.locator('#search-input').fill('关于')
    page.locator('.search-result-card').first.wait_for(); page.keyboard.press('Enter'); page.wait_for_timeout(900)
    check('Enter opens page result', page.evaluate(OPEN) == [] and page.locator('html').get_attribute('data-page') == 'about')

    # ---------- 2. Theme (desktop) ----------
    page.locator('#theme-toggle').click(); page.wait_for_timeout(300)
    check('theme opens', page.evaluate(OPEN) == ['tool-theme'])
    page.locator('[data-mode="dark"]').click()
    check('dark mode', page.locator('html').get_attribute('data-theme') == 'dark')
    page.locator('[data-mode="auto"]').click()
    check('auto mode', page.locator('html').get_attribute('data-theme-mode') == 'auto')
    page.locator('[data-mode="dark"]').click()
    page.locator('.theme-preset[data-hue="145"]').click()
    check('preset hue', page.evaluate("getComputedStyle(document.documentElement).getPropertyValue('--primary-hue').trim()") == '145')
    page.locator('#hue-picker-track').focus(); page.keyboard.press('ArrowRight'); page.wait_for_timeout(100)
    hue = page.evaluate("localStorage.getItem('primary-hue')")
    check('custom hue slider', hue not in (None, '145'), hue)
    glow_before = page.locator('html').get_attribute('data-glow')
    page.locator('#glow-toggle').click()
    check('glow toggle', page.locator('html').get_attribute('data-glow') != glow_before)
    page.screenshot(path=str(OUT / 'fix-theme-desktop.png'))
    page.keyboard.press('Escape')
    page.reload(wait_until='load'); page.wait_for_timeout(600)
    check('theme persists after reload', page.locator('html').get_attribute('data-theme') == 'dark'
          and page.evaluate("getComputedStyle(document.documentElement).getPropertyValue('--primary-hue').trim()") == hue
          and page.locator('html').get_attribute('data-glow') != glow_before)
    page.locator('#theme-toggle').click(); page.wait_for_timeout(300)
    check('reopened panel reflects state', page.locator('.theme-mode-btn.active').get_attribute('data-mode') == 'dark'
          and page.locator('#hue-picker-value').text_content().strip() == hue
          and page.locator('#glow-toggle').get_attribute('aria-pressed') == ('true' if glow_before == 'off' else 'false'))
    page.locator('[data-mode="light"]').click(); page.locator('.theme-preset[data-hue="210"]').click()
    if page.locator('html').get_attribute('data-glow') != glow_before: page.locator('#glow-toggle').click()
    page.keyboard.press('Escape')

    # ---------- 3. Calendar month widget ----------
    now = page.evaluate("(() => { const d = new Date(); return [d.getMonth() + 1, d.getDate()]; })()")
    check('date button shows local date', page.locator('.rail [data-date-month]').text_content() == f'{now[0]}月' and page.locator('.rail [data-date-day]').text_content() == str(now[1]))
    page.locator('[data-tool="calendar"]').click(); page.wait_for_timeout(250)
    check('calendar today highlighted', page.locator('.cal-day--today').text_content() == str(now[1]))
    title = page.locator('[data-cal-title]').text_content()
    page.locator('[data-cal-next]').click()
    check('next month', page.locator('[data-cal-title]').text_content() != title and page.locator('.cal-day--today').count() == 0 and page.locator('[data-cal-today]').is_visible())
    page.locator('[data-cal-prev]').click(); page.locator('[data-cal-prev]').click()
    page.locator('[data-cal-today]').click()
    check('prev month + back to today', page.locator('[data-cal-title]').text_content() == title and page.locator('.cal-day--today').count() == 1)
    page.keyboard.press('Escape')
    check('music/timer single instances on desktop', page.evaluate("document.querySelectorAll('#music-audio').length === 1 && document.querySelectorAll('.rail-widget').length === 3"))
    ctx.close()

    # ---------- 3. Midnight rollover (simulated clock) ----------
    tz = timezone(timedelta(hours=8))
    for w in (1440, 390):
        ctx = browser.new_context(viewport={'width': w, 'height': 900}, timezone_id='Asia/Shanghai', has_touch=w < 900, is_mobile=w < 900)
        page = ctx.new_page(); watch(page, f'clock-{w}')
        page.clock.install(time=datetime(2026, 10, 31, 23, 59, 50, tzinfo=tz))
        page.goto(BASE, wait_until='load'); page.wait_for_timeout(300)
        before = page.evaluate("[document.querySelector('[data-date-month]').textContent, document.querySelector('[data-date-day]').textContent]")
        page.clock.run_for(15000)
        after = page.evaluate("[document.querySelector('[data-date-month]').textContent, document.querySelector('[data-date-day]').textContent]")
        check(f'{w}px midnight rollover updates button', before == ['10月', '31'] and after == ['11月', '1'], [before, after])
        page.locator('[data-tool="calendar"]').click(); page.wait_for_timeout(200)
        check(f'{w}px month view follows rollover', '11 月' in page.locator('[data-cal-title]').text_content() and page.locator('.cal-day--today').text_content() == '1')
        page.keyboard.press('Escape')
        # A frozen background tab misses the timer; returning to the page must still correct it.
        page.clock.pause_at(datetime(2026, 11, 2, 9, 0, 0, tzinfo=tz))
        page.evaluate("window.dispatchEvent(new Event('focus'))")
        check(f'{w}px focus re-checks date', page.locator('[data-date-day]').first.text_content() == '2')
        ctx.close()

    # ---------- 4. Mobile layout, toolbar, capsule; search/theme on touch ----------
    for w, h in [(900, 768), (390, 844), (375, 812), (320, 720)]:
        ctx = browser.new_context(viewport={'width': w, 'height': h}, has_touch=True, is_mobile=True, timezone_id='Asia/Shanghai')
        page = ctx.new_page(); watch(page, f'mobile-{w}')
        page.goto(BASE, wait_until='load'); page.wait_for_timeout(1300)
        tb = lambda: page.evaluate("document.querySelector('.site-toolbar').getBoundingClientRect().bottom")
        check(f'{w}px mobile toolbar + bottom nav + 5 tools', page.locator('.site-toolbar').is_visible() and page.locator('.mobile-tools > button').count() == 5
              and page.evaluate("getComputedStyle(document.querySelector('.site-nav')).position") == 'fixed')
        check(f'{w}px no horizontal overflow', page.evaluate(NO_OVERFLOW))
        gap = page.evaluate(FIRST_CARD) - tb()
        report['metrics'][f'mobile-{w}-top-gap'] = gap
        check(f'{w}px first card below toolbar at top (12-16px)', 12 <= gap <= 16, gap)
        page.screenshot(path=str(OUT / f'fix-mobile-{w}-top.png'))
        page.mouse.move(w // 2, h // 2)
        for _ in range(8): page.mouse.wheel(0, 120); page.wait_for_timeout(50)
        page.wait_for_timeout(350)
        check(f'{w}px scrolling down hides toolbar', page.evaluate("document.documentElement.classList.contains('toolbar-hidden')"))
        st, top = page.evaluate("document.querySelector('.layout').scrollTop"), page.evaluate(FIRST_CARD)
        for _ in range(3): page.mouse.wheel(0, -60); page.wait_for_timeout(50)
        page.wait_for_timeout(350)
        st2, top2 = page.evaluate("document.querySelector('.layout').scrollTop"), page.evaluate(FIRST_CARD)
        check(f'{w}px scrolling up shows toolbar without content jump',
              not page.evaluate("document.documentElement.classList.contains('toolbar-hidden')") and abs((top2 - top) - (st - st2)) < 1, [st, st2, top, top2])
        for _ in range(30): page.mouse.wheel(0, -200); page.wait_for_timeout(30)
        page.wait_for_timeout(400)
        check(f'{w}px back at top restores spacing', page.evaluate("document.querySelector('.layout').scrollTop") == 0 and abs(page.evaluate(FIRST_CARD) - tb() - gap) < 1)

        # Search + theme through the mobile toolbar.
        page.locator('.mobile-tools [data-tool="search"]').tap(); page.wait_for_timeout(300)
        check(f'{w}px mobile search opens', page.evaluate(OPEN) == ['tool-search'])
        page.locator('#search-input').fill('魔女'); page.locator('.search-result-card').first.wait_for()
        check(f'{w}px mobile search results', page.locator('.search-result-card').count() > 0)
        if w == 390: page.screenshot(path=str(OUT / 'fix-search-mobile-390.png'))
        page.locator('#tool-search .tool-close').tap(); page.wait_for_timeout(250)
        check(f'{w}px mobile close button closes search', page.evaluate(OPEN) == [])
        page.locator('.mobile-tools [data-tool="theme"]').tap(); page.wait_for_timeout(300)
        page.locator('[data-mode="dark"]').tap()
        check(f'{w}px mobile theme works', page.evaluate(OPEN) == ['tool-theme'] and page.locator('html').get_attribute('data-theme') == 'dark')
        page.locator('[data-mode="light"]').tap(); page.keyboard.press('Escape'); page.wait_for_timeout(250)
        check(f'{w}px mobile date button', page.locator('.mobile-tools [data-date-day]').text_content() == page.evaluate("String(new Date().getDate())"))

        # Sticky anime tabs stay under the visible toolbar.
        page.goto(BASE + '/?page=anime', wait_until='load'); page.wait_for_timeout(1200)
        page.evaluate("document.querySelector('.layout').scrollTop = 600"); page.wait_for_timeout(300)
        page.evaluate("document.querySelector('.layout').scrollTop = 560"); page.wait_for_timeout(450)
        tabs = page.evaluate("document.querySelector('.anime-tabs').getBoundingClientRect().top")
        check(f'{w}px sticky anime tabs not under toolbar', tabs >= tb() - 0.5, [tabs, tb()])

        # Activity capsule (timer running, off the home page).
        page.goto(BASE + '/?page=notes', wait_until='load'); page.wait_for_timeout(1200)
        page.locator('.mobile-tools [data-tool="timer"]').tap(); page.locator('[data-timer-act="start"]').tap(); page.keyboard.press('Escape'); page.wait_for_timeout(600)
        island = lambda: page.evaluate("(() => { const r = document.querySelector('.mobile-activity-island').getBoundingClientRect(); return [r.top, r.bottom]; })()")
        visible = page.evaluate("document.querySelector('.mobile-activity-island').classList.contains('is-visible')")
        if w <= 900 and visible:
            i = island(); card = page.evaluate(FIRST_CARD)
            check(f'{w}px capsule below toolbar, card below capsule', i[0] >= tb() and card - i[1] >= 12, [tb(), i, card])
            if w == 390: page.screenshot(path=str(OUT / 'fix-mobile-390-capsule.png'))
            page.mouse.move(w // 2, h // 2)
            for _ in range(8): page.mouse.wheel(0, 120); page.wait_for_timeout(50)
            page.wait_for_timeout(350)
            st, top = page.evaluate("document.querySelector('.layout').scrollTop"), page.evaluate(FIRST_CARD)
            check(f'{w}px capsule follows hidden toolbar', page.evaluate("document.documentElement.classList.contains('toolbar-hidden')") and island()[0] < 20)
            for _ in range(3): page.mouse.wheel(0, -60); page.wait_for_timeout(50)
            page.wait_for_timeout(350)
            st2, top2 = page.evaluate("document.querySelector('.layout').scrollTop"), page.evaluate(FIRST_CARD)
            check(f'{w}px capsule: toolbar toggle causes no content jump', abs((top2 - top) - (st - st2)) < 1 and island()[0] >= tb(), [st, st2, top, top2])
        else:
            check(f'{w}px capsule visible with running timer', visible)
        page.locator('.site-nav a[href*="page=about"]').tap(); page.wait_for_timeout(800)
        check(f'{w}px timer survives navigation, single instances',
              page.locator('.rail-widget--timer').get_attribute('data-status') == 'running'
              and page.evaluate("document.querySelectorAll('#music-audio').length === 1 && document.querySelectorAll('.rail-widget').length === 3"))
        page.go_back(); page.wait_for_timeout(800)
        check(f'{w}px browser back keeps layout', page.locator('html').get_attribute('data-page') == 'notes' and not page.evaluate("document.documentElement.classList.contains('toolbar-hidden')"))
        ctx.close()

    # ---------- Rotation / breakpoint crossing on one page ----------
    ctx = browser.new_context(viewport={'width': 390, 'height': 844}, has_touch=True, is_mobile=True)
    page = ctx.new_page(); watch(page, 'rotate')
    page.goto(BASE, wait_until='load'); page.wait_for_timeout(1200)
    page.set_viewport_size({'width': 844, 'height': 390}); page.wait_for_timeout(400)
    gap = page.evaluate(FIRST_CARD) - page.evaluate("document.querySelector('.site-toolbar').getBoundingClientRect().bottom")
    check('landscape rotation keeps top spacing', 12 <= gap <= 16 and page.evaluate(NO_OVERFLOW), gap)
    page.set_viewport_size({'width': 1280, 'height': 800}); page.wait_for_timeout(400)
    check('crossing to desktop restores rail tools', page.locator('.rail-tools > button').count() == 3 and page.locator('.rail-actions > button').count() == 2
          and not page.locator('.site-toolbar').is_visible())
    page.set_viewport_size({'width': 390, 'height': 844}); page.wait_for_timeout(400)
    check('crossing back to mobile restores toolbar tools', page.locator('.mobile-tools > button').count() == 5
          and page.evaluate("document.querySelectorAll('#music-audio').length === 1"))
    ctx.close()
    browser.close()

check('no page errors / failed requests', not report['errors'], report['errors'])
(OUT / 'fix-report.json').write_text(json.dumps(report, ensure_ascii=False, indent=2), encoding='utf-8')
failed = [c['name'] for c in report['checks'] if not c['passed']]
print(json.dumps({'checks': len(report['checks']), 'failed': failed}, ensure_ascii=False))
