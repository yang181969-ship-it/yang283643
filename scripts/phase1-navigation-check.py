"""Responsive details, history, route races, and reduced-motion regression checks."""
import json
from pathlib import Path
from playwright.sync_api import sync_playwright

checks, errors = [], []
BASE = 'http://127.0.0.1:8765'
def check(name, value):
    checks.append({'name':name,'passed':bool(value)})
    print(('PASS ' if value else 'FAIL ')+name,flush=True)

try:
  with sync_playwright() as pw:
    browser = pw.chromium.launch(channel='chrome',headless=True)
    context = browser.new_context(viewport={'width':390,'height':844},reduced_motion='reduce')
    page=context.new_page()
    page.on('pageerror',lambda error:errors.append(str(error)))
    page.on('console',lambda msg:errors.append(msg.text) if msg.type=='error' else None)
    for path in ['?page=notes','?page=anime','?page=gallery','?page=about','?page=stats','?page=update','html/anime-detail.html?id=majo','html/notes-detail.html?file=../content/math/calculus/傅里叶级数的基本形式.md','html/stats.html']:
      page.goto(BASE+'/'+path,wait_until='domcontentloaded');page.wait_for_timeout(750)
      check(path+' mobile shell',page.locator('.mobile-tools > button').count()==5 and page.locator('.site-nav a').count()==5)
      check(path+' mobile no horizontal overflow',page.evaluate('document.documentElement.scrollWidth<=innerWidth && document.querySelector(".layout").scrollWidth<=innerWidth'))
    page.goto(BASE+'/?page=notes',wait_until='domcontentloaded')
    page.locator('.note-card').first.wait_for();page.locator('.note-card').first.click()
    title=page.locator('.note-detail-title').text_content()
    page.evaluate('history.back()');page.locator('.note-card').first.wait_for()
    page.evaluate('history.forward()');page.locator('.note-detail-title').wait_for()
    check('back and forward restore note detail',page.locator('.note-detail-title').text_content()==title)
    page.wait_for_timeout(1500)
    # This note may have no math; verify an explicit formula note instead.
    page.goto(BASE+'/html/notes-detail.html?file=../content/math/calculus/傅里叶级数的基本形式.md',wait_until='domcontentloaded')
    page.locator('.katex').first.wait_for(timeout=15000)
    check('standalone math rendered',page.locator('.katex').count()>0)
    page.set_viewport_size({'width':320,'height':568})
    for tool in ['music','timer','calendar','search','theme']:
      page.locator(f'.mobile-tools [data-tool="{tool}"]').click()
      rect=page.locator('dialog[open]').bounding_box()
      check(tool+' dialog fits 320px screen',rect['x']>=0 and rect['x']+rect['width']<=320 and rect['height']<=568)
      page.keyboard.press('Escape')
    check('settings entry removed',page.locator('[data-tool="settings"], #tool-settings, .shell-settings-link').count()==0)
    check('reduced-motion sidebar transition',page.locator('.rail').evaluate('(e)=>getComputedStyle(e).transitionDuration')=='0s')
    page.set_viewport_size({'width':1440,'height':900})
    page.goto(BASE,wait_until='domcontentloaded');page.wait_for_timeout(1500)
    # Delay one route through the page's fetch API to reproduce an older-response race.
    page.evaluate('''() => {
      const fetchOriginal = window.fetch;
      window.fetch = async (...args) => {
        const response = await fetchOriginal(...args);
        if (args[0] === 'html/about.html') await new Promise(resolve=>setTimeout(resolve,400));
        return response;
      };
      window._loadPage('about'); window._loadPage('gallery');
    }''')
    page.wait_for_timeout(800)
    check('stale route cannot overwrite latest navigation',page.locator('html').get_attribute('data-page')=='gallery' and page.locator('.gallery-page').count()==1)
    page.locator('.rail .logo').click();page.wait_for_timeout(300)
    check('logo routes home through SPA',page.locator('html').get_attribute('data-page')=='home')
    page.locator('.rail-pin').click();page.mouse.move(900,500);page.locator('#main-content').click(position={'x':10,'y':10})
    page.locator('.rail-pin').click();page.mouse.move(900,500);page.wait_for_timeout(500)
    check('unpin restores narrow content reservation',page.locator('html').get_attribute('data-sidebar-pinned')=='false' and page.locator('.rail').bounding_box()['width']==68)
    touch = browser.new_context(viewport={'width':1024,'height':768},has_touch=True,is_mobile=True)
    touchpage=touch.new_page();touchpage.goto(BASE,wait_until='domcontentloaded');touchpage.wait_for_timeout(1600)
    touchpage.locator('.rail-pin').tap();touchpage.wait_for_timeout(300)
    check('touch desktop click alternative expands sidebar',touchpage.locator('.rail').bounding_box()['width']==192)
    touchpage.set_viewport_size({'width':1024,'height':400})
    check('short desktop sidebar scrolls internally',touchpage.locator('.rail').evaluate('(r)=>r.scrollHeight>r.clientHeight && getComputedStyle(r).overflowY==="auto"'))
    browser.close()
finally:
  Path('artifacts/phase1/navigation-report.json').write_text(json.dumps({'checks':checks,'errors':errors},ensure_ascii=False,indent=2),encoding='utf-8')
