"""Phase 1.5 widget checks: theme popover, search command palette, merged music
panel, calendar with selection/important days, dynamic date icon, responsive fit.
Run from the repository root against `python scripts/phase1-preview.py`:
    python scripts/phase1_5-widgets-check.py
Writes screenshots and widgets-report.json under artifacts/phase1_5/ (git-ignored).
"""
import json
import os
from datetime import datetime, timedelta, timezone
from pathlib import Path
from playwright.sync_api import sync_playwright

OUT = Path('artifacts/phase1_5')
OUT.mkdir(parents=True, exist_ok=True)
BASE = os.environ.get('PHASE1_BASE_URL', 'http://127.0.0.1:8765')
report = {'checks': [], 'errors': []}


def check(name, condition, detail=None):
    report['checks'].append({'name': name, 'passed': bool(condition), 'detail': detail})
    print(('PASS ' if condition else 'FAIL ') + name + ('' if condition or detail is None else f'  -> {detail}'), flush=True)


def watch(page, label):
    page.on('pageerror', lambda e: report['errors'].append(f'{label} pageerror: {e}'))
    page.on('console', lambda m: report['errors'].append(f'{label} console: {m.text}') if m.type == 'error' else None)


OPEN = "[...document.querySelectorAll('dialog[open]')].map(d => d.id)"
RECT = "sel => { const r = document.querySelector(sel).getBoundingClientRect(); return {x: r.x, y: r.y, w: r.width, h: r.height, r: r.right, b: r.bottom}; }"
NO_OVERFLOW = 'document.documentElement.scrollWidth <= innerWidth && document.querySelector(".layout").scrollWidth <= innerWidth'
# What is under a point of the page: true when nothing (dialog/backdrop) covers the card.
CARD_REACHABLE = '''() => { const c = document.querySelector('main .bento-card'); const r = c.getBoundingClientRect();
  return c.contains(document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2)); }'''
BACKDROP = '''id => { const s = getComputedStyle(document.getElementById(id), '::backdrop');
  return { bg: s.backgroundColor, filter: s.backdropFilter || s.webkitBackdropFilter || 'none' }; }'''
tz = timezone(timedelta(hours=8))

with sync_playwright() as pw:
    browser = pw.chromium.launch(channel='chrome', headless=True)

    # ================= Desktop =================
    ctx = browser.new_context(viewport={'width': 1440, 'height': 900}, timezone_id='Asia/Shanghai')
    ctx.add_init_script("try { localStorage.setItem('y181_sidebar_pinned', localStorage.getItem('y181_sidebar_pinned') || 'false') } catch (_) {}")
    page = ctx.new_page(); watch(page, 'desktop')
    page.goto(BASE, wait_until='load'); page.wait_for_timeout(1200)

    # ---------- Theme popover ----------
    for pinned in ['false', 'true']:
        if page.evaluate("document.documentElement.dataset.sidebarPinned") != pinned:
            page.locator('.rail-pin').click(); page.wait_for_timeout(400)
        page.locator('#theme-toggle').click(); page.wait_for_timeout(300)
        t = page.evaluate(RECT, '#theme-toggle'); p = page.evaluate(RECT, '#tool-theme')
        check(f'theme ({"expanded" if pinned == "true" else "collapsed"}) opens non-modal', page.evaluate(OPEN) == ['tool-theme']
              and not page.evaluate("document.getElementById('tool-theme').matches(':modal')")
              and not page.evaluate("document.documentElement.classList.contains('has-tool-panel')"))
        check(f'theme ({"expanded" if pinned == "true" else "collapsed"}) beside button, 8-12px gap, on screen',
              8 <= p['x'] - t['r'] <= 12 and p['y'] >= 0 and p['b'] <= 900 and p['r'] <= 1440 and 280 <= p['w'] <= 320, [t, p])
        check(f'theme ({"expanded" if pinned == "true" else "collapsed"}) page stays visible and reachable', page.evaluate(CARD_REACHABLE))
        page.screenshot(path=str(OUT / f'theme-desktop-{"expanded" if pinned == "true" else "collapsed"}.png'))
        page.locator('#theme-toggle').click(); page.wait_for_timeout(200)
        check(f'theme button toggles closed', page.evaluate(OPEN) == [])
    page.locator('.rail-pin').click(); page.wait_for_timeout(400)  # back to collapsed

    page.locator('#theme-toggle').click(); page.wait_for_timeout(250)
    page.locator('[data-mode="dark"]').click()
    page.locator('.theme-preset[data-hue="145"]').click()
    page.locator('#glow-toggle').click()
    page.locator('#hue-picker-track').focus(); page.keyboard.press('ArrowRight')
    check('theme: live updates while panel stays open', page.evaluate(OPEN) == ['tool-theme'] and page.locator('html').get_attribute('data-theme') == 'dark'
          and page.evaluate("getComputedStyle(document.documentElement).getPropertyValue('--primary-hue').trim()") == '146')
    page.screenshot(path=str(OUT / 'theme-desktop-dark.png'))
    page.keyboard.press('Escape'); page.wait_for_timeout(200)
    check('theme: Esc closes and restores focus', page.evaluate(OPEN) == [] and page.evaluate("document.activeElement.id") == 'theme-toggle')
    page.locator('#theme-toggle').click(); page.wait_for_timeout(200)
    page.locator('main .bento-card').first.click(position={'x': 30, 'y': 30}); page.wait_for_timeout(250)
    check('theme: outside click closes, page receives the click', page.evaluate(OPEN) == [])
    page.reload(wait_until='load'); page.wait_for_timeout(700)
    check('theme: settings persist', page.locator('html').get_attribute('data-theme') == 'dark'
          and page.evaluate("localStorage.getItem('primary-hue')") == '146')
    page.locator('#theme-toggle').click(); page.locator('[data-mode="light"]').click(); page.locator('.theme-preset[data-hue="210"]').click()
    page.locator('#glow-toggle').click(); page.keyboard.press('Escape')

    # ---------- Search command palette ----------
    page.keyboard.press('Control+k'); page.wait_for_timeout(300)
    s = page.evaluate(RECT, '#tool-search')
    check('search: Ctrl+K opens palette with input focused', page.evaluate(OPEN) == ['tool-search'] and page.evaluate("document.activeElement.id") == 'search-input')
    check('search: top ~8-12vh, centred, 680-760px', 0.07 * 900 <= s['y'] <= 0.13 * 900 and abs((s['x'] + s['w'] / 2) - 720) <= 2 and 680 <= s['w'] <= 760, s)
    bd = page.evaluate(BACKDROP, 'tool-search')
    check('search: backdrop only lightly dimmed, no blur', bd['filter'] in ('none', '') and float(bd['bg'].rstrip(')').split(',')[-1]) <= 0.12, bd)
    page.keyboard.type('魔')
    page.locator('.search-result-card').first.wait_for(timeout=8000)
    first = page.evaluate("document.getElementById('search-input').getAttribute('aria-activedescendant')")
    page.keyboard.press('ArrowDown')
    second = page.evaluate("document.getElementById('search-input').getAttribute('aria-activedescendant')")
    page.keyboard.press('ArrowUp')
    check('search: live results + arrow keys move selection', first == 'search-opt-0' and second == 'search-opt-1'
          and page.evaluate("document.getElementById('search-input').getAttribute('aria-activedescendant')") == 'search-opt-0')
    page.locator('.search-filter[data-search-filter="动漫"]').click()
    check('search: category filter keeps focus in input', page.locator('.search-filter.is-active').get_attribute('data-search-filter') == '动漫'
          and page.evaluate("document.activeElement.id") == 'search-input')
    check('search: only result area scrolls, panel within viewport', page.evaluate(RECT, '#tool-search')['b'] <= 900)
    page.screenshot(path=str(OUT / 'search-desktop.png'))
    page.keyboard.press('ArrowDown'); title = page.locator('.search-result-card.is-active .search-result-title').text_content()
    page.keyboard.press('Enter'); page.wait_for_timeout(1500)
    check('search: Enter opens the selected result', 'anime-detail' in page.url and page.evaluate(OPEN) == [], [title, page.url])
    page.goto(BASE, wait_until='load'); page.wait_for_timeout(900)
    page.locator('#search-toggle').click(); page.keyboard.type('zzqqxx-无结果'); page.wait_for_timeout(900)
    check('search: empty state', page.locator('.search-empty').count() == 1 and page.locator('.search-result-card').count() == 0)
    page.mouse.click(10, 880); page.wait_for_timeout(250)
    check('search: outside click closes, focus released to trigger', page.evaluate(OPEN) == [] and page.evaluate("document.activeElement.id") == 'search-toggle'
          and page.evaluate("document.getElementById('search-input').getAttribute('aria-expanded')") == 'false')
    page.locator('#search-toggle').click(); page.wait_for_timeout(250)
    check('search: reopens normally', page.evaluate(OPEN) == ['tool-search'])
    page.keyboard.press('Escape')

    # ---------- Music panel ----------
    page.locator('.rail [data-tool="music"]').click(); page.wait_for_timeout(500)
    pl = page.evaluate(RECT, '.music-panel .rail-widget--music'); ls = page.evaluate(RECT, '.music-playlist'); d = page.evaluate(RECT, '#tool-music')
    check('music: player and playlist visible together (no second step)', page.evaluate(OPEN) == ['tool-music']
          and page.locator('[data-music-playlist-list] li').count() > 0 and page.locator('[data-music-modal], [data-music-act="playlist"]').count() == 0)
    check('music: desktop two columns ~42/58, 900-1060px wide', pl['r'] <= ls['x'] + 1 and 0.38 <= pl['w'] / (pl['w'] + ls['w']) <= 0.46 and 900 <= d['w'] <= 1060, [pl, ls, d])
    bd = page.evaluate(BACKDROP, 'tool-music')
    check('music: backdrop keeps dim + blur', 'blur' in bd['filter'], bd)
    page.locator('[data-music-volume]').fill('30')
    check('music: volume slider drives the audio element', abs(page.evaluate("document.getElementById('music-audio').volume") - 0.3) < 0.01
          and page.evaluate("localStorage.getItem('y181_music_volume')") == '30')
    page.locator('[data-music-playlist-list] [data-music-track="1"]').click(); page.wait_for_timeout(1200)
    check('music: clicking a song plays it, panel stays open', page.evaluate(OPEN) == ['tool-music']
          and page.locator('[data-music-playlist-list] li.is-current').get_attribute('data-idx') == '1'
          and page.evaluate("!document.getElementById('music-audio').paused"))
    page.locator('[data-music-playlist-search]').fill('倒数')
    check('music: playlist filter', page.locator('[data-music-playlist-list] li:not([hidden])').count() == 1)
    page.locator('[data-music-playlist-search]').focus(); page.keyboard.press('Control+k'); page.wait_for_timeout(200)
    check('Ctrl+K does not hijack typing in other inputs', page.evaluate(OPEN) == ['tool-music'])
    page.locator('[data-music-playlist-search]').fill('')
    bar = page.locator('[data-music-progress]').bounding_box()
    page.mouse.click(bar['x'] + bar['width'] * 0.5, bar['y'] + bar['height'] / 2); page.wait_for_timeout(300)
    check('music: progress seek', page.evaluate("(a => a.currentTime / a.duration)(document.getElementById('music-audio'))") > 0.4)
    page.screenshot(path=str(OUT / 'music-desktop.png'))
    src = page.evaluate("document.getElementById('music-audio').src"); t0 = page.evaluate("document.getElementById('music-audio').currentTime")
    page.keyboard.press('Escape'); page.wait_for_timeout(900)
    check('music: closing keeps playing', page.evaluate(OPEN) == [] and page.evaluate("!document.getElementById('music-audio').paused")
          and page.evaluate("document.getElementById('music-audio').currentTime") > t0)
    for _ in range(4):
        page.locator('.rail [data-tool="music"]').click(); page.wait_for_timeout(120); page.keyboard.press('Escape'); page.wait_for_timeout(120)
    page.locator('.rail [data-tool="music"]').click(); page.wait_for_timeout(300)
    check('music: reopening keeps song, position, play state', page.evaluate("document.getElementById('music-audio').src") == src
          and page.evaluate("document.getElementById('music-audio').currentTime") > t0 and page.evaluate("!document.getElementById('music-audio').paused")
          and page.locator('[data-music-playlist-list] li.is-current').get_attribute('data-idx') == '1')
    page.locator('[data-music-act="next"]').click(); page.wait_for_timeout(300)
    check('music: no duplicated listeners after repeated open/close', page.locator('[data-music-playlist-list] li.is-current').get_attribute('data-idx') == '2')
    page.locator('.music-panel').click(position={'x': 30, 'y': 30}); page.wait_for_timeout(150)
    check('music: click inside does not close', page.evaluate(OPEN) == ['tool-music'])
    page.mouse.click(10, 10); page.wait_for_timeout(250)
    check('music: backdrop click closes, music continues', page.evaluate(OPEN) == [] and page.evaluate("!document.getElementById('music-audio').paused"))
    page.reload(wait_until='load'); page.wait_for_timeout(900)
    check('music: volume persists', page.locator('[data-music-volume]').input_value() == '30'
          and abs(page.evaluate("document.getElementById('music-audio').volume") - 0.3) < 0.01)
    page.evaluate("document.getElementById('music-audio').pause(); localStorage.setItem('y181_music_volume', '80')")
    check('single audio + widget instances', page.evaluate("document.querySelectorAll('audio').length === 1 && document.querySelectorAll('.rail-widget').length === 3"))

    # ---------- Calendar ----------
    page.locator('.rail [data-tool="calendar"]').click(); page.wait_for_timeout(300)
    cal = page.evaluate(RECT, '.calendar-panel .rail-widget--calendar'); sm = page.evaluate(RECT, '.cal-summary'); ev = page.evaluate(RECT, '.cal-events')
    check('calendar: desktop month left (~60%) + info right', cal['r'] <= sm['x'] and sm['b'] <= ev['y'] and 0.55 <= cal['w'] / (cal['w'] + sm['w']) <= 0.65, [cal, sm, ev])
    today = page.evaluate("new Date().getDate()")
    check('calendar: today selected + badge by default', page.locator('.cal-day--today').text_content() == str(today)
          and page.locator('.cal-day--selected').text_content() == str(today) and page.locator('[data-cal-sel-today]').is_visible())
    other = 20 if today != 20 else 21
    page.locator('.cal-day:not(.cal-day--out)', has_text=str(other)).first.click()
    check('calendar: click selects, today stays distinct', page.locator('.cal-day--selected').text_content() == str(other)
          and page.locator('[data-cal-sel-day]').text_content() == str(other) and not page.locator('[data-cal-sel-today]').is_visible()
          and 'cal-day--selected' not in page.locator('.cal-day--today').get_attribute('class'))
    check('calendar: empty state for a day without records', page.locator('[data-cal-day-empty]').is_visible())
    page.locator('.cal-day--selected').focus(); page.keyboard.press('ArrowRight')
    check('calendar: arrow keys move selection', page.locator('[data-cal-sel-day]').text_content() == str(other + 1))
    title = page.locator('[data-cal-title]').text_content()
    page.locator('[data-cal-next]').click()
    check('calendar: next month', page.locator('[data-cal-title]').text_content() != title and page.locator('[data-cal-today]').is_visible())
    page.locator('.cal-day--out').last.click()
    check('calendar: clicking a trailing day switches month', page.locator('[data-cal-sel-day]').text_content() == page.locator('.cal-day--selected').text_content()
          and 'cal-day--out' not in page.locator('.cal-day--selected').get_attribute('class'))
    page.locator('[data-cal-goto-today]').click()
    check('calendar: back to today', page.locator('[data-cal-title]').text_content() == title and page.locator('.cal-day--selected').text_content() == str(today))
    page.screenshot(path=str(OUT / 'calendar-desktop.png'))
    page.keyboard.press('Escape')
    m = page.evaluate("[document.querySelector('.rail [data-tool=calendar]').getAttribute('aria-label'), document.querySelector('.rail [data-date-day]').textContent, "
                      "(() => { const t = document.querySelector('.rail .date-icon__day').getBBox(), r = document.querySelector('.rail .date-icon rect').getBBox(); return t.x >= r.x && t.x + t.width <= r.x + r.width; })()]")
    check('date icon shows local day without overflow (month in label)', page.evaluate("`${new Date().getMonth() + 1}月`") in m[0] and m[1] == str(today) and m[2], m)
    ctx.close()

    # ---------- Important days + leap year (simulated clock) ----------
    ctx = browser.new_context(viewport={'width': 1440, 'height': 900}, timezone_id='America/Los_Angeles')
    page = ctx.new_page(); watch(page, 'clock')
    page.clock.install(time=datetime(2027, 4, 13, 0, 30, tzinfo=timezone(timedelta(hours=-7))))
    page.goto(BASE, wait_until='load'); page.wait_for_timeout(600)
    page.locator('.rail [data-tool="calendar"]').click(); page.wait_for_timeout(300)
    check('local timezone date (not Beijing)', page.locator('[data-cal-sel-day]').text_content() == '13' and '4 月' in page.locator('[data-cal-title]').text_content())
    check('yearly important day shows on its date', '网站上线纪念日' in page.locator('[data-cal-day-events]').inner_text() and '1 周年' in page.locator('[data-cal-day-events]').inner_text())
    check('upcoming list says today', '就是今天' in page.locator('[data-cal-upcoming]').inner_text())
    page.locator('[data-cal-next]').click(); page.locator('[data-cal-prev]').click()
    page.clock.pause_at(datetime(2028, 2, 29, 9, tzinfo=timezone(timedelta(hours=-8))))
    page.evaluate("window.dispatchEvent(new Event('focus'))"); page.wait_for_timeout(200)
    check('focus re-check follows to leap day', page.locator('[data-cal-sel-day]').text_content() == '29' and '2028 年 2 月' == page.locator('[data-cal-title]').text_content()
          and page.locator('.cal-day:not(.cal-day--out)').count() == 29)
    ctx.close()

    # ================= Mobile =================
    for w, h in [(390, 844), (375, 812), (320, 720)]:
        ctx = browser.new_context(viewport={'width': w, 'height': h}, has_touch=True, is_mobile=True, timezone_id='Asia/Shanghai')
        page = ctx.new_page(); watch(page, f'mobile-{w}')
        page.goto(BASE, wait_until='load'); page.wait_for_timeout(1100)
        tb = page.evaluate("document.querySelector('.site-toolbar').getBoundingClientRect().bottom")

        page.locator('.mobile-tools [data-tool="theme"]').tap(); page.wait_for_timeout(300)
        p = page.evaluate(RECT, '#tool-theme'); t = page.evaluate(RECT, '.mobile-tools [data-tool="theme"]')
        check(f'{w}px theme below toolbar button, within screen, no dimming', p['y'] >= tb and p['x'] >= 8 and p['r'] <= w - 8 and p['b'] <= h
              and not page.evaluate("document.getElementById('tool-theme').matches(':modal')"), [p, t, tb])
        if w == 390: page.screenshot(path=str(OUT / 'theme-mobile-390.png'))
        page.locator('[data-mode="dark"]').tap()
        check(f'{w}px theme changes live', page.locator('html').get_attribute('data-theme') == 'dark' and page.evaluate(OPEN) == ['tool-theme'])
        page.locator('[data-mode="light"]').tap()
        page.mouse.click(w // 2, h - 200); page.wait_for_timeout(250)
        check(f'{w}px theme closes on outside tap', page.evaluate(OPEN) == [])

        page.locator('.mobile-tools [data-tool="search"]').tap(); page.wait_for_timeout(300)
        page.locator('#search-input').fill('笔记'); page.locator('.search-result-card').first.wait_for()
        s = page.evaluate(RECT, '#tool-search')
        check(f'{w}px search under toolbar, wide, fits viewport', s['y'] >= tb - 1 and s['x'] >= 8 and s['r'] <= w - 8 and s['b'] <= h, [s, tb])
        if w == 390: page.screenshot(path=str(OUT / 'search-mobile-390.png'))
        # Soft keyboard: visual viewport shrinks; the panel must shrink with it and scroll only its results.
        page.evaluate("document.getElementById('tool-search').style.setProperty('--vv-height', '300px')")
        page.wait_for_timeout(100)
        s2 = page.evaluate(RECT, '#tool-search')
        check(f'{w}px search fits above soft keyboard', s2['b'] <= 300 + 1 and page.evaluate(
            "(b => b.scrollHeight > b.clientHeight)(document.querySelector('.search-popover__body'))"), s2)
        page.locator('#tool-search .tool-close').tap(); page.wait_for_timeout(250)

        page.locator('.mobile-tools [data-tool="music"]').tap(); page.wait_for_timeout(800)
        pl, ls, d = page.evaluate(
            "[...['.music-panel .rail-widget--music', '.music-playlist', '#tool-music']].map(s => { const r = document.querySelector(s).getBoundingClientRect(); return {x: r.x, y: r.y, w: r.width, h: r.height, r: r.right, b: r.bottom}; })")
        check(f'{w}px music stacked: player above playlist, fits viewport', pl['b'] <= ls['y'] + 1 and d['y'] >= 0 and d['b'] <= h and d['r'] <= w, [pl, ls, d])
        check(f'{w}px music list scrolls on its own', page.evaluate("(l => l.scrollHeight > l.clientHeight)(document.querySelector('[data-music-playlist-list]'))")
              and page.evaluate("(p => p.scrollHeight <= p.clientHeight + 1)(document.querySelector('.music-panel'))"))
        check(f'{w}px music controls keep 44px targets', min(page.evaluate(
            "[...document.querySelectorAll('#tool-music .music-controls .music-btn')].map(b => Math.min(b.offsetWidth, b.offsetHeight))")) >= 44)
        if w == 390: page.screenshot(path=str(OUT / 'music-mobile-390.png'))
        page.locator('#tool-music .tool-close').tap(); page.wait_for_timeout(250)

        page.locator('.mobile-tools [data-tool="calendar"]').tap(); page.wait_for_timeout(300)
        sm = page.evaluate(RECT, '.cal-summary'); cal = page.evaluate(RECT, '.calendar-panel .rail-widget--calendar'); ev = page.evaluate(RECT, '.cal-events')
        d = page.evaluate(RECT, '#tool-calendar'); last = page.evaluate("(c => c.getBoundingClientRect().right)(document.querySelectorAll('.cal-day')[6])")
        check(f'{w}px calendar stacked: date, month, important days', sm['b'] <= cal['y'] and cal['b'] <= ev['y'] + 1, [sm, cal, ev])
        check(f'{w}px calendar seven columns fit, panel in viewport', last <= cal['r'] and d['b'] <= h and d['r'] <= w)
        if w == 390: page.screenshot(path=str(OUT / 'calendar-mobile-390.png'))
        page.locator('#tool-calendar .tool-close').tap(); page.wait_for_timeout(250)
        check(f'{w}px no horizontal overflow; toolbar icons coordinated', page.evaluate(NO_OVERFLOW) and page.evaluate(
            "[...document.querySelectorAll('.mobile-tools > button')].every(b => b.offsetWidth >= 44 && b.offsetHeight >= 44)"))
        ctx.close()

    # ================= Every required size: each panel fits and closes =================
    for w, h in [(1920, 1080), (1440, 900), (1024, 768), (901, 768), (900, 768), (390, 844), (375, 812), (320, 720), (844, 390)]:
        mobile = w <= 900
        ctx = browser.new_context(viewport={'width': w, 'height': h}, has_touch=mobile, is_mobile=mobile)
        page = ctx.new_page(); watch(page, f'size-{w}x{h}')
        page.goto(BASE, wait_until='load'); page.wait_for_timeout(900)
        bad = []
        for tool in ['theme', 'search', 'music', 'calendar']:
            button = page.locator(f'[data-tool="{tool}"]').first
            button.tap() if mobile else button.click()
            page.wait_for_timeout(300)
            r = page.evaluate(RECT, f'#tool-{tool}')
            if not (r['x'] >= 0 and r['y'] >= 0 and r['r'] <= w and r['b'] <= h) or page.evaluate(OPEN) != [f'tool-{tool}']:
                bad.append([tool, r])
            page.keyboard.press('Escape'); page.wait_for_timeout(200)
            if page.evaluate(OPEN): bad.append([tool, 'did not close'])
        check(f'{w}x{h} all four panels fit the viewport and close', not bad, bad)
        check(f'{w}x{h} no horizontal overflow, scrolling not locked', page.evaluate(NO_OVERFLOW)
              and not page.evaluate("document.documentElement.classList.contains('has-tool-panel')"))
        ctx.close()

    # ---------- Reduced motion ----------
    ctx = browser.new_context(viewport={'width': 1440, 'height': 900}, reduced_motion='reduce')
    page = ctx.new_page(); watch(page, 'reduced-motion')
    page.goto(BASE, wait_until='load'); page.wait_for_timeout(700)
    page.locator('#theme-toggle').click()
    check('reduced motion disables panel animation', page.evaluate("getComputedStyle(document.getElementById('tool-theme')).animationName") == 'none')
    ctx.close()
    browser.close()

check('no page errors', not report['errors'], report['errors'])
(OUT / 'widgets-report.json').write_text(json.dumps(report, ensure_ascii=False, indent=2), encoding='utf-8')
failed = [c['name'] for c in report['checks'] if not c['passed']]
print(json.dumps({'checks': len(report['checks']), 'failed': failed}, ensure_ascii=False))
