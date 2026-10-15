"""State, accessibility and cross-document checks for the Phase 1 shell."""
import json
from datetime import datetime
from pathlib import Path
from playwright.sync_api import sync_playwright
from music_mock import install_music_mock, remove_music_mock, empty_library_state

OUT = Path('artifacts/phase1')
BASE = 'http://127.0.0.1:8765'
checks, errors = [], []
def check(name, passed):
    checks.append({'name':name, 'passed':bool(passed)})
    print(('PASS ' if passed else 'FAIL ')+name, flush=True)

try:
  with sync_playwright() as pw:
    browser = pw.chromium.launch(channel='chrome', headless=True)
    context = browser.new_context(viewport={'width':1440,'height':900}, timezone_id='Asia/Shanghai')
    page = context.new_page()
    page.on('pageerror', lambda e: errors.append(str(e)))
    # Published library is empty: check that first, then use the temporary mock library (scripts/music_mock.py)
    page.goto(BASE, wait_until='domcontentloaded'); page.wait_for_timeout(2000)
    page.locator('[data-tool="music"]').click(); page.wait_for_timeout(300)
    check('production music library shows the empty state', empty_library_state(page))
    page.keyboard.press('Escape')
    install_music_mock(context)
    page.goto(BASE, wait_until='domcontentloaded'); page.wait_for_timeout(2000)
    page.locator('[data-tool="music"]').click()
    page.locator('[data-music-act="play"]').click()
    page.wait_for_function('!document.querySelector("audio").paused && document.querySelector("audio").currentTime > .2')
    page.evaluate('window.testAudio = document.querySelector("audio")')
    page.keyboard.press('Escape'); start = page.locator('audio').evaluate('(a)=>a.currentTime')
    page.wait_for_timeout(800)
    check('actual audio continues after closing player', page.locator('audio').evaluate('(a)=>!a.paused && a.currentTime')>start)
    page.locator('.site-nav a[href*="page=about"]').click(); page.wait_for_timeout(400)
    check('SPA retains the same playing audio node', page.evaluate('window.testAudio === document.querySelector("audio") && !testAudio.paused'))
    page.locator('[data-tool="music"]').click()
    page.locator('[data-music-lyrics-toggle]').click()
    check('lyrics toggle', page.locator('[data-music-lyrics]').is_visible())
    mode = page.locator('[data-music-act="loop"]').get_attribute('data-loop-mode')
    page.locator('[data-music-act="loop"]').click()
    check('loop mode changes', page.locator('[data-music-act="loop"]').get_attribute('data-loop-mode')!=mode)
    bar = page.locator('[data-music-progress]').bounding_box()
    page.mouse.move(bar['x']+5,bar['y']+bar['height']/2); page.mouse.down()
    page.mouse.move(bar['x']+bar['width']*.45,bar['y']+bar['height']/2,steps=5); page.mouse.up()
    print('Seek metrics:', page.locator('audio').evaluate('(a)=>({time:a.currentTime,duration:a.duration,seekable:a.seekable.length})'), flush=True)
    check('drag seeking', page.locator('audio').evaluate('(a)=>a.currentTime/a.duration')>.35)
    page.locator('[data-music-playlist-search]').fill('倒数')
    check('playlist filter', page.locator('[data-music-playlist-list] li:not([hidden])').count()==1)
    page.keyboard.press('Escape')
    page.locator('[data-tool="timer"]').click(); page.locator('[data-timer-act="start"]').click(); page.keyboard.press('Escape')
    page.evaluate('Object.defineProperty(document,"hidden",{configurable:true,get:()=>true}); document.dispatchEvent(new Event("visibilitychange"))')
    check('simulated document.hidden auto-pauses timer', page.locator('.rail-widget--timer').get_attribute('data-status')=='paused')
    page.evaluate('delete document.hidden; document.dispatchEvent(new Event("visibilitychange"))')
    page.locator('[data-tool="timer"]').click()
    page.locator('[data-timer-act="reset"]').click()
    page.locator('[data-timer-tab="countdown"]').click()
    page.locator('[data-timer-slider]').fill('1'); page.locator('[data-timer-act="start"]').click()
    page.keyboard.press('Escape')
    check('countdown continues with dialog hidden', page.locator('.rail-widget--timer').get_attribute('data-status')=='running')
    page.locator('[data-tool="timer"]').click()
    page.locator('[data-timer-act="reset"]').hover(); page.mouse.down(); page.wait_for_timeout(3200); page.mouse.up()
    check('long press resets timer', page.locator('.rail-widget--timer').get_attribute('data-status')=='idle')
    page.keyboard.press('Escape')
    page.locator('audio').evaluate('(a)=>a.pause()')
    remove_music_mock(context)
    page.locator('[data-tool="calendar"]').click()
    page.locator('[data-cal-next]').click(); month = page.locator('[data-cal-title]').text_content()
    page.keyboard.press('Escape'); page.locator('[data-tool="calendar"]').click()
    check('viewed calendar month survives close', page.locator('[data-cal-title]').text_content()==month)
    for _ in range(14): page.keyboard.press('Tab')
    check('Tab remains within active panel', page.evaluate('document.activeElement.closest("dialog")?.id')=='tool-calendar')
    page.mouse.click(5,5)
    check('backdrop closes and restores focus', page.locator('dialog[open]').count()==0 and page.evaluate('document.activeElement.dataset.tool')=='calendar')
    page.locator('#theme-toggle').click(); page.locator('[data-mode="auto"]').click(); page.keyboard.press('Escape')
    page.emulate_media(color_scheme='dark')
    page.wait_for_timeout(150)
    check('automatic theme follows system dark', page.locator('html').get_attribute('data-theme')=='dark')
    page.emulate_media(color_scheme='light')
    page.wait_for_timeout(150)
    check('automatic theme follows system light', page.locator('html').get_attribute('data-theme')=='light')
    page.locator('#theme-toggle').click(); page.locator('[data-hue="145"]').click()
    check('preset persisted', page.evaluate('localStorage.getItem("primary-hue")')=='145')
    check('ambient glow retired', page.locator('#glow-toggle').count()==0 and page.locator('html').get_attribute('data-glow') is None)
    page.keyboard.press('Escape')
    page.goto(BASE+'/?page=gallery',wait_until='domcontentloaded'); page.wait_for_timeout(900)
    # Phase 6: the gallery may legitimately be empty; then it shows the empty state and never opens the lightbox.
    if page.locator('.gallery-item').count():
        page.locator('.gallery-item').first.click()
        check('gallery lightbox opens', page.locator('#gallery-lightbox').is_visible())
        page.keyboard.press('Escape'); check('gallery lightbox closes', not page.locator('#gallery-lightbox').is_visible())
    else:
        check('empty gallery shows empty state, lightbox stays closed', page.locator('.gallery-empty').count() == 1 and not page.locator('#gallery-lightbox').is_visible())
    page.goto(BASE+'/?page=notes',wait_until='domcontentloaded'); page.locator('.note-card').first.wait_for()
    page.locator('.note-card').first.click(); page.wait_for_timeout(500)
    note_url = page.url
    page.reload(wait_until='domcontentloaded')
    # 详情要等 markdown-it(CDN)加载完才渲染，按元素出现等待，而不是固定 1 秒
    try: page.locator('.note-detail-card').first.wait_for(timeout=10000)
    except Exception: pass
    check('note deep-link refresh retains detail', page.locator('.note-detail-card').count()>0 and 'note=' in page.url)
    page.goto(BASE+'/html/stats.html',wait_until='domcontentloaded'); page.wait_for_timeout(500)
    page.locator('#search-toggle').click(); page.locator('#search-input').fill('傅里叶'); page.locator('.search-result-card').first.wait_for()
    page.locator('.search-result-card').first.click()
    # stats.html has the SPA router, so the note opens as index.html?page=notes&note=…; pages without it use notes-detail.html
    try: page.locator('.note-detail-title').first.wait_for(timeout=10000)
    except Exception: pass
    check('standalone note search navigates', ('/html/notes-detail.html' in page.url or 'note=' in page.url) and page.locator('.note-detail-title').count()>0)
    # Deterministic local midnight, including year rollover, without high-frequency polling.
    clockpage = context.new_page()
    clockpage.clock.install(time=datetime.fromisoformat('2026-12-31T23:59:58+08:00'))
    clockpage.goto(BASE,wait_until='domcontentloaded')
    clockpage.clock.pause_at(datetime.fromisoformat('2026-12-31T23:59:59+08:00'))
    check('date before local midnight', clockpage.locator('[data-date-day]').text_content()=='31')
    clockpage.clock.fast_forward(2000)
    check('midnight year rollover updates icon', clockpage.locator('[data-date-day]').text_content()=='1' and '2027年1月1日' in clockpage.locator('[data-tool=calendar]').first.get_attribute('aria-label'))
    clockpage.evaluate('document.querySelector("[data-tool=calendar]").click(); document.querySelector("[data-cal-today]").click()')
    check('today uses current local year and month', '2027' in clockpage.locator('[data-cal-title]').text_content() and clockpage.locator('.cal-day--today').text_content()=='1')
    clockpage.evaluate('''() => {
      window.sitePanels.close('calendar'); document.querySelector('[data-tool=timer]').click();
      document.querySelector('[data-timer-tab=countdown]').click();
      const slider=document.querySelector('[data-timer-slider]'); slider.value='1'; slider.dispatchEvent(new Event('input'));
      document.querySelector('[data-timer-act=start]').click(); window.sitePanels.close('timer');
    }''')
    clockpage.clock.fast_forward(61000); clockpage.clock.run_for(100)
    check('countdown completes while panel closed', clockpage.locator('.rail-widget--timer').get_attribute('data-status')=='completed' and clockpage.evaluate('window.sitePanels.active')=='focus-complete')
    check('countdown adds today total', clockpage.evaluate('JSON.parse(localStorage.getItem("y181_focus_total_today")).seconds')>=60)
    browser.close()
finally:
  (OUT/'state-report.json').write_text(json.dumps({'checks':checks,'errors':errors},ensure_ascii=False,indent=2),encoding='utf-8')
