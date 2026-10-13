"""Local Phase 1 browser regression checks. Requires Python Playwright + Chrome.
Run against a local static server with PHASE1_BASE_URL (default localhost:8765).
Writes screenshots and a JSON report under artifacts/phase1/.
"""
import json
import os
from pathlib import Path
from playwright.sync_api import sync_playwright

OUT = Path('artifacts/phase1')
OUT.mkdir(parents=True, exist_ok=True)
BASE = os.environ.get('PHASE1_BASE_URL', 'http://127.0.0.1:8765')
report = {'viewports': [], 'checks': [], 'errors': []}

def check(name, condition):
    report['checks'].append({'name': name, 'passed': bool(condition)})
    if not condition:
        print('FAIL:', name, flush=True)

with sync_playwright() as pw:
    browser = pw.chromium.launch(channel='chrome', headless=True)
    context = browser.new_context(viewport={'width': 1440, 'height': 900})
    page = context.new_page()
    page.on('pageerror', lambda error: report['errors'].append(str(error)))
    page.goto(BASE, wait_until='domcontentloaded')
    page.wait_for_timeout(2400)
    for w, h in [(1920,1080),(1440,900),(1024,768),(901,768),(900,768),(390,844),(375,812),(320,720)]:
        page.set_viewport_size({'width': w, 'height': h})
        page.mouse.move(w-20, 100)
        page.wait_for_timeout(400)
        metrics = page.evaluate('''() => {
          const rail = document.querySelector('.rail'), toolbar = document.querySelector('.site-toolbar');
          return { width: innerWidth, overflow: document.documentElement.scrollWidth > innerWidth,
            rail: rail.getBoundingClientRect().width, toolbar: getComputedStyle(toolbar).display,
            navCount: document.querySelectorAll('.site-nav a').length,
            audioCount: document.querySelectorAll('#music-audio').length,
            widgets: document.querySelectorAll('.rail-widget').length,
            tools: [...document.querySelectorAll('.mobile-tools > button')].map(b => b.getBoundingClientRect().width) };
        }''')
        report['viewports'].append(metrics)
        check(f'{w}px no horizontal overflow', not metrics['overflow'])
        check(f'{w}px unique instances', metrics['audioCount']==1 and metrics['widgets']==3 and metrics['navCount']==4)
        check(f'{w}px shell layout', metrics['rail']==68 and metrics['toolbar']=='none' if w>900 else len(metrics['tools'])==5 and min(metrics['tools'])>=44)
        if w in [1440,390,320]: page.screenshot(path=str(OUT/f'home-{w}.png'))
    page.set_viewport_size({'width':1440,'height':900})
    page.mouse.move(1000,100)
    page.wait_for_timeout(500)
    pane = page.locator('.page-card, .content-scroll').first
    before = pane.bounding_box()
    page.locator('.rail').hover()
    page.wait_for_timeout(450)
    check('hover never expands sidebar', page.locator('.rail').bounding_box()['width']==68 and pane.bounding_box()==before)
    page.locator('.rail-pin').click(); page.mouse.move(1000,100); page.wait_for_timeout(450)
    after = pane.bounding_box()
    check('button expands sidebar and narrows content', page.locator('.rail').bounding_box()['width']==192 and after['width']==before['width']-124 and page.locator('.rail-pin').get_attribute('aria-expanded')=='true')
    page.reload(wait_until='domcontentloaded'); page.wait_for_timeout(700)
    check('pinned refresh', page.locator('.rail').bounding_box()['width']==192)
    page.locator('[data-tool="timer"]').click()
    page.locator('[data-timer-act="start"]').click()
    page.keyboard.press('Escape')
    page.wait_for_timeout(1200)
    check('timer continues after panel closes', page.locator('.rail-widget--timer').get_attribute('data-status')=='running' and page.locator('[data-timer-display]').text_content()!='00:00')
    page.locator('.site-nav a[href*="page=about"]').click()
    page.wait_for_timeout(900)
    check('timer survives SPA navigation', page.locator('.rail-widget--timer').get_attribute('data-status')=='running')
    page.locator('[data-tool="music"]').click()
    check('playlist is part of the music panel', page.locator('dialog[open]').count()==1 and page.locator('#tool-music [data-music-playlist-list] li').count()>0)
    page.keyboard.press('Escape')
    check('one Escape closes music and restores trigger', page.locator('dialog[open]').count()==0 and page.evaluate('document.activeElement.dataset.tool')=='music')
    page.locator('#search-toggle').click()
    page.locator('#search-input').fill('动漫')
    page.locator('.search-result-card').first.wait_for()
    check('search results in dialog', page.locator('#tool-search').evaluate('(el)=>el.open') and page.locator('.search-result-card').count()>0)
    page.screenshot(path=str(OUT/'search-desktop.png'))
    page.keyboard.press('Escape')
    page.locator('#theme-toggle').click()
    page.locator('[data-mode="dark"]').click()
    check('dark theme', page.locator('html').get_attribute('data-theme')=='dark')
    page.keyboard.press('Escape')
    page.screenshot(path=str(OUT/'dark-desktop.png'))
    page.locator('#theme-toggle').click(); page.locator('[data-mode="light"]').click(); page.keyboard.press('Escape')
    for route in ['?page=notes','?page=anime','?page=gallery','?page=about','?page=stats','?page=update','html/anime-detail.html?id=majo','html/notes-detail.html?file=../content/math/calculus/傅里叶级数的基本形式.md','html/stats.html']:
        page.goto(BASE+'/'+route, wait_until='domcontentloaded'); page.wait_for_timeout(950)
        check(route+' shared shell', page.locator('.site-nav a').count()==4 and page.locator('#music-audio').count()==1 and page.locator('.rail-widget').count()==3)
        check(route+' pinned persists', page.locator('html').get_attribute('data-sidebar-pinned')=='true')
        check(route+' business content present', len(page.locator('#main-content').inner_text())>30)
    page.set_viewport_size({'width':390,'height':844})
    page.goto(BASE+'/?page=notes', wait_until='domcontentloaded'); page.wait_for_timeout(1000)
    page.locator('[data-tool="timer"]').click(); page.locator('[data-timer-act="start"]').click(); page.keyboard.press('Escape')
    page.wait_for_timeout(500)
    page.evaluate('document.querySelector(".layout").scrollTop=250'); page.wait_for_timeout(400)
    check('mobile scroll down hides toolbar', page.locator('html').evaluate('(el)=>el.classList.contains("toolbar-hidden")'))
    page.screenshot(path=str(OUT/'mobile-hidden-toolbar.png'))
    page.evaluate('document.querySelector(".layout").scrollTop=100'); page.wait_for_timeout(400)
    check('mobile scroll up restores toolbar', not page.locator('html').evaluate('(el)=>el.classList.contains("toolbar-hidden")'))
    page.locator('[data-tool="calendar"]').click()
    page.screenshot(path=str(OUT/'mobile-calendar.png'))
    check('calendar date matches device', page.locator('[data-date-day]').text_content()==page.evaluate('String(new Date().getDate())'))
    page.keyboard.press('Escape')
    browser.close()

(OUT/'report.json').write_text(json.dumps(report, ensure_ascii=False, indent=2),encoding='utf-8')
print(json.dumps({'checks':len(report['checks']),'failed':[x for x in report['checks'] if not x['passed']],'errors':report['errors']},ensure_ascii=False), flush=True)
