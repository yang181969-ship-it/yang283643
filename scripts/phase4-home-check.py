"""Local Phase 4 (Home = 欢迎区 + 五张卡) browser regression checks. Requires Python Playwright + Chrome.
Run against a local static server with PHASE4_BASE_URL (default 127.0.0.1:8765), e.g.
  python scripts/phase1-preview.py --port 8765
  python scripts/phase4-home-check.py
Writes screenshots and a JSON report under artifacts/phase4/ (or PHASE4_OUT).
"""
import json
import os
import re
from datetime import datetime, timezone
from pathlib import Path
from urllib.parse import urlparse, parse_qs, quote
from playwright.sync_api import sync_playwright

OUT = Path(os.environ.get('PHASE4_OUT', 'artifacts/phase4'))
OUT.mkdir(parents=True, exist_ok=True)
BASE = os.environ.get('PHASE4_BASE_URL', 'http://127.0.0.1:8765')
report = {'checks': [], 'errors': [], 'console': []}

notes_index = json.loads(Path('data/notes-index.json').read_text(encoding='utf-8'))
updates_index = json.loads(Path('data/updates-index.json').read_text(encoding='utf-8'))
site_meta = json.loads(Path('data/site-meta.json').read_text(encoding='utf-8'))
latest_notes = sorted(notes_index, key=lambda n: n.get('date', ''), reverse=True)[:3]
latest_updates = sorted(updates_index, key=lambda u: u.get('date', ''), reverse=True)[:3]


def check(name, condition, detail=None):
    report['checks'].append({'name': name, 'passed': bool(condition), 'detail': detail})
    print(('PASS ' if condition else 'FAIL ') + name + ('' if condition or detail is None else f'  -> {detail}'), flush=True)


def query(page):
    q = parse_qs(urlparse(page.url).query)
    return {k: v[0] for k, v in q.items()}


def settle(page, ms=500):
    page.wait_for_timeout(ms)


def watch(page, ignore=()):
    page.on('pageerror', lambda e: report['errors'].append(f'{page.url} :: {e}'))
    page.on('console', lambda m: m.type == 'error' and not any(s in m.text for s in ignore)
            and report['console'].append(f'{page.url} :: {m.text}'))


def active_nav(page):
    return page.eval_on_selector_all(
        '.site-nav a', 'els => els.filter(a => a.classList.contains("active")).map(a => a.querySelector(".nav-label").textContent.trim())')


def note_href(file):
    # 与 notes.js 详情页写入的格式一致：note = encodeURIComponent(file)，再整体作为查询参数编码
    return 'index.html?page=notes&note=' + quote(quote(file, safe="~()*!.'"), safe='')


def wait_home(page):
    page.wait_for_selector('[data-card="notes"] .home-note__link', timeout=8000)
    page.wait_for_selector('[data-card="update"] .home-update__link', timeout=8000)
    page.wait_for_selector('[data-card="stats"] .home-stat', timeout=8000)


def overflow_x(page):
    return page.evaluate('''() => {
      const w = document.documentElement.clientWidth;
      return [...document.querySelectorAll('#main-content *')]
        .filter(el => el.getClientRects().length && !el.closest('[hidden], svg'))
        .filter(el => { for (let p = el.parentElement; p && p.id !== 'main-content'; p = p.parentElement) {
          if (getComputedStyle(p).overflowX !== 'visible') return false; } return true; })
        .filter(el => { const r = el.getBoundingClientRect(); return r.right > w + 1 || r.left < -1; })
        .slice(0, 5).map(el => el.className || el.tagName);
    }''')


def rects(page):
    return page.evaluate('''() => Object.fromEntries(['.home-hero', '[data-card=notes]', '[data-card=life]', '[data-card=update]',
      '[data-card=today]', '[data-card=stats]'].map(s => { const r = document.querySelector(s).getBoundingClientRect();
      return [s, { top: Math.round(r.top), left: Math.round(r.left), width: Math.round(r.width), height: Math.round(r.height), bottom: Math.round(r.bottom) }]; }))''')


with sync_playwright() as p:
    browser = p.chromium.launch(channel='chrome')
    ctx = browser.new_context(viewport={'width': 1440, 'height': 900})
    page = ctx.new_page(); watch(page, ignore=('open-meteo',))

    # ---------------- 结构与数据 ----------------
    page.goto(f'{BASE}/index.html', wait_until='load'); wait_home(page); settle(page, 800)
    check('hero title', '欢迎来到我的小站' in page.inner_text('.home-hero__title'))
    check('hero eyebrow + lead', page.inner_text('.home-hero__eyebrow').strip() == 'HOME · YANG181969'
          and '数学、生活与那些值得留下的瞬间' in page.inner_text('.home-hero__lead'))
    check('hero portrait loaded', page.evaluate('document.querySelector("[data-home-portrait]").naturalWidth > 0'))
    cards = page.eval_on_selector_all('#main-content .bento-card', 'els => els.map(e => e.dataset.card)')
    check('five cards in priority order', cards == ['notes', 'life', 'update', 'today', 'stats'], cards)
    legacy = page.eval_on_selector_all('#main-content a[href]', 'els => els.map(a => a.getAttribute("href")).filter(h => /page=(anime|gallery|stats|update)\\b/.test(h))')
    check('no new links to retired top-level pages', legacy == [], legacy)

    upd = page.eval_on_selector_all('[data-card="update"] .home-update__link', 'els => els.map(a => [a.getAttribute("href"), a.querySelector(".home-update__title").textContent.trim(), a.querySelector("time").getAttribute("datetime")])')
    expected_upd = [[f'index.html?page=about&tab=update&update={Path(u["file"]).stem}', u['title'], u['date']] for u in latest_updates]
    check('updates card: newest 3 from index (href / title / date)', upd == expected_upd, upd)
    check('update card full-log entry', page.locator('[data-card="update"] .home-card-more[href="index.html?page=about&tab=update"]').count() == 1)

    stats = page.eval_on_selector_all('[data-card="stats"] .home-stat', 'els => els.map(e => [e.querySelector("dt").textContent, e.querySelector("dd").textContent])')
    t = site_meta['totals']
    check('stats card numbers match site-meta / update index', stats == [['笔记', str(t['notes'])], ['作品', str(t['anime'])], ['收藏', str(t['gallery'])], ['更新', str(len(updates_index))]], stats)
    b = datetime.fromisoformat(site_meta['siteBirthday']).replace(tzinfo=timezone.utc)
    days = max(1, (datetime.now(timezone.utc) - b).days)  # 与 stats.js daysSinceBirthday 一致
    check('stats card site days', page.inner_text('.home-stats__days strong').strip() == str(days), page.inner_text('.home-stats__days'))

    notes = page.eval_on_selector_all('[data-card="notes"] .home-note__link', 'els => els.map(a => [a.getAttribute("href"), a.querySelector(".home-note__title").textContent.trim()])')
    check('notes card: newest 3 with direct article links', notes == [[note_href(n['file']), n['title']] for n in latest_notes], notes)
    page.wait_for_function('document.querySelectorAll("[data-note-preview].is-ready").length >= 1', timeout=8000)
    check('notes preview loaded', page.locator('[data-note-preview].is-ready').count() >= 1)
    check('notes title links to Notes', page.get_attribute('[data-card="notes"] .bento-card-title-link', 'href') == 'index.html?page=notes')

    tiles = page.eval_on_selector_all('.home-life-tile', 'els => els.map(a => [a.getAttribute("href"), a.querySelector("img").getAttribute("alt"), a.querySelector("img").getAttribute("loading")])')
    check('life card: 4 tiles with alt + lazy', len(tiles) == 4 and all(t[1] and t[2] == 'lazy' for t in tiles), tiles)
    check('life tiles use Life / detail routes', all(h.startswith('html/anime-detail.html?id=') or h == 'index.html?page=life&tab=collections&type=gallery' for h, _, _ in tiles), tiles)
    chips = page.eval_on_selector_all('.home-life-chip', 'els => els.map(a => a.getAttribute("href"))')
    check('life section chips', chips == ['index.html?page=life&tab=works&type=anime', 'index.html?page=life&tab=collections&type=gallery',
                                          'index.html?page=life&tab=journey', 'index.html?page=life&tab=journal'], chips)
    page.wait_for_function('[...document.querySelectorAll(".home-life-tile img")].every(i => i.complete)', timeout=8000)
    stretch = page.evaluate('''() => [...document.querySelectorAll('.home-life-tile img')].map(i => getComputedStyle(i).objectFit)''')
    check('life tiles cropped, not stretched', all(v == 'cover' for v in stretch), stretch)
    check('today card rendered (weather or fallback)', page.locator('[data-card="today"] .mood-display').count() == 1)
    page.screenshot(path=str(OUT / 'home-1440.png'))

    # ---------------- 路由:笔记详情 / 前进后退 / 刷新 ----------------
    before = page.evaluate('history.length')
    page.click('[data-card="notes"] .home-note__link >> nth=0')
    page.wait_for_selector('.note-detail-title', timeout=8000); settle(page, 400)
    check('note item opens article detail', page.inner_text('.note-detail-title').strip() == latest_notes[0]['title'] and active_nav(page) == ['笔记'])
    check('note detail pushes one history entry', page.evaluate('history.length') == before + 1)
    note_url = page.url
    page.go_back(); wait_home(page); settle(page, 400)
    check('back returns to home with cards restored', query(page) == {} and page.locator('.home-life-tile').count() == 4)
    page.go_forward(); page.wait_for_selector('.note-detail-title', timeout=8000)
    check('forward re-opens the article', page.inner_text('.note-detail-title').strip() == latest_notes[0]['title'])
    page.reload(wait_until='load'); page.wait_for_selector('.note-detail-title', timeout=8000)
    check('refresh keeps the article (deep link)', page.url == note_url and page.inner_text('.note-detail-title').strip() == latest_notes[0]['title'])

    # 更新详情
    page.goto(f'{BASE}/index.html', wait_until='load'); wait_home(page)
    page.click('[data-card="update"] .home-update__link >> nth=0')
    page.wait_for_selector('.update-detail-title', timeout=8000); settle(page, 300)
    check('update item opens About update detail', query(page) == {'page': 'about', 'tab': 'update', 'update': Path(latest_updates[0]['file']).stem}
          and active_nav(page) == ['关于 · 更新'], page.url)
    page.go_back(); wait_home(page)
    page.click('[data-card="update"] .home-card-more'); settle(page, 1200)
    check('update full-log link opens update list', query(page) == {'page': 'about', 'tab': 'update'} and page.locator('.update-detail-title').count() == 0)

    # 站点速览:点击卡片任意位置
    page.goto(f'{BASE}/index.html', wait_until='load'); wait_home(page)
    page.click('[data-card="stats"] .home-stats', force=True); settle(page, 1300)  # 拉伸链接覆盖整卡：在卡片中部按下
    check('stats card body → About stats', query(page) == {'page': 'about', 'tab': 'stats'} and active_nav(page) == ['关于 · 统计'], page.url)

    # 生活片段
    page.goto(f'{BASE}/index.html', wait_until='load'); wait_home(page)
    gallery_tile = page.locator('.home-life-tile[href="index.html?page=life&tab=collections&type=gallery"]').first
    gallery_tile.click(); page.wait_for_selector('.gallery-item', timeout=8000)
    check('life gallery tile → Life collections/gallery', query(page) == {'page': 'life', 'tab': 'collections', 'type': 'gallery'} and active_nav(page) == ['生活'])
    page.go_back(); wait_home(page)
    page.click('.home-life-chip >> nth=0'); settle(page, 1200)
    check('life works chip → Life works/anime', query(page) == {'page': 'life', 'tab': 'works', 'type': 'anime'} and page.locator('.life-work').count() > 0)
    page.go_back(); wait_home(page)
    work = page.locator('.home-life-tile[href^="html/anime-detail.html"]').first
    work_href = work.get_attribute('href')
    work.click(); page.wait_for_load_state('load'); settle(page, 800)
    check('life work tile → anime detail', page.url.endswith(work_href) and page.inner_text('#anime-title').strip() not in ('', '加载中...', '未找到该动漫'), page.url)
    page.go_back(); page.wait_for_load_state('load'); wait_home(page)
    page.click('[data-card="notes"] .bento-card-title-link'); page.wait_for_selector('.note-card', timeout=8000)
    check('notes card title → Notes list', query(page) == {'page': 'notes'} and page.locator('.note-detail-title').count() == 0)

    # 修饰键点击保持浏览器默认行为（不被路由拦截）
    page.goto(f'{BASE}/index.html', wait_until='load'); wait_home(page)
    with ctx.expect_page() as new_tab:
        page.click('[data-card="update"] .home-update__link >> nth=0', modifiers=['Control'])
    new_tab.value.close()
    check('ctrl+click opens a new tab and leaves home in place', query(page) == {} and page.locator('.home-hero').count() == 1)

    # 键盘
    page.focus('[data-card="notes"] .home-note__link >> nth=1')
    page.keyboard.press('Enter'); page.wait_for_selector('.note-detail-title', timeout=8000)
    check('keyboard Enter on note opens detail', page.inner_text('.note-detail-title').strip() == latest_notes[1]['title'])
    page.goto(f'{BASE}/index.html', wait_until='load'); wait_home(page)
    focusables = page.evaluate('''() => [...document.querySelectorAll('#main-content a[href]')].filter(a => a.tabIndex >= 0 && a.getClientRects().length).length''')
    check('home links are keyboard focusable', focusables >= 15, focusables)

    # 快速连续点击：最后一次导航意图决定页面
    page.click('[data-card="notes"] .home-note__link >> nth=0')
    page.click('.site-nav a[href="index.html?page=life"]'); settle(page, 1500)
    check('rapid note → life ends on Life', query(page).get('page') == 'life' and page.locator('.note-detail-title').count() == 0
          and page.locator('[data-life-root]').count() == 1, page.url)
    ctx.close()

    # ---------------- 慢网络:离开主页后过期回调不改动页面 ----------------
    ctx = browser.new_context(viewport={'width': 1440, 'height': 900})
    page = ctx.new_page(); watch(page, ignore=('open-meteo',))
    page.goto(f'{BASE}/index.html?page=notes', wait_until='load'); page.wait_for_selector('.note-card', timeout=8000)

    def slow(route):
        page.wait_for_timeout(1800)
        route.continue_()
    page.route('**/data/site-meta.json', slow)
    page.route('**/data/notes-index.json', slow)
    page.click('.site-nav a[href="index.html"]'); settle(page, 300)
    check('home skeleton visible while data is slow', page.locator('[data-card="stats"] .bento-card-body.is-skeleton').count() == 1)
    page.click('.site-nav a[href="index.html?page=about"]'); settle(page, 3500)
    check('stale home callbacks do not touch About', query(page).get('page') == 'about' and page.locator('.home-stat, .home-note').count() == 0
          and page.locator('[data-about-root]').count() == 1, page.url)
    page.unroute('**/data/site-meta.json'); page.unroute('**/data/notes-index.json')
    page.go_back(); wait_home(page)
    check('returning home after slow load restores cards', page.locator('.home-note__link').count() == 3 and page.locator('.home-stat').count() == 4)
    ctx.close()

    # ---------------- 数据失败降级 ----------------
    ctx = browser.new_context(viewport={'width': 1440, 'height': 900})
    page = ctx.new_page(); watch(page, ignore=('open-meteo', 'updates-index', '500', 'Failed to load resource'))
    page.route('https://api.open-meteo.com/**', lambda r: r.abort())
    page.route('**/updates-index.json', lambda r: r.fulfill(status=500, body='nope'))
    page.goto(f'{BASE}/index.html', wait_until='load')
    page.wait_for_selector('[data-card="today"] .mood-display', timeout=12000)
    page.wait_for_selector('[data-card="update"] .home-empty', timeout=8000)
    page.wait_for_selector('[data-card="notes"] .home-note__link', timeout=8000)
    check('weather failure shows fallback', '东京天气暂时没有回应' in page.inner_text('[data-card="today"]')
          and page.locator('[data-card="today"] .mood-avatar').count() == 1)
    check('updates failure shows placeholder + entry', page.locator('[data-card="update"] .home-card-more').count() == 1)
    page.wait_for_selector('[data-card="stats"] .home-stat', timeout=8000)
    stats = page.eval_on_selector_all('[data-card="stats"] .home-stat dd', 'els => els.map(e => e.textContent)')
    check('stats falls back to site-meta update total', stats[-1] == str(t['updates']), stats)
    check('other cards unaffected by failures', page.locator('.home-note__link').count() == 3 and page.locator('.home-life-tile').count() == 4)
    page.screenshot(path=str(OUT / 'home-fallback.png'))
    ctx.close()

    # ---------------- 响应式 / 主题 ----------------
    for width, height in [(320, 640), (375, 812), (768, 1024), (1024, 768), (1440, 900), (1920, 1080)]:
        for theme, hue in [('light', None), ('dark', None), ('light', '30')]:
            if theme == 'dark' and width not in (375, 1440):
                continue
            if hue and width != 1440:
                continue
            ctx = browser.new_context(viewport={'width': width, 'height': height})
            init = f"localStorage.setItem('theme-mode', '{theme}');" + (f"localStorage.setItem('primary-hue', '{hue}');" if hue else '')
            ctx.add_init_script(f'try {{ {init} }} catch (e) {{}}')
            page = ctx.new_page(); watch(page, ignore=('open-meteo',))
            page.goto(f'{BASE}/index.html', wait_until='load'); wait_home(page); settle(page, 1200)
            tag = f'{width}-{theme}' + (f'-hue{hue}' if hue else '')
            check(f'[{tag}] no horizontal overflow', not overflow_x(page) and page.evaluate('document.documentElement.scrollWidth <= document.documentElement.clientWidth'), overflow_x(page))
            r = rects(page)
            order = [r[s]['top'] for s in ['.home-hero', '[data-card=notes]', '[data-card=life]', '[data-card=update]', '[data-card=today]', '[data-card=stats]']]
            if width < 640:
                check(f'[{tag}] mobile single column, priority order', order == sorted(order) and len({r[s]['left'] for s in r}) == 1, r)
                hero_h = r['.home-hero']['height']
                check(f'[{tag}] compact hero ({hero_h}px)', 90 <= hero_h <= 140, hero_h)
            elif width <= 900:
                check(f'[{tag}] tablet two columns', r['[data-card=notes]']['top'] == r['[data-card=life]']['top']
                      and r['[data-card=today]']['top'] == r['[data-card=stats]']['top'], r)
            else:
                row1 = {r[s]['top'] for s in ['[data-card=today]', '[data-card=update]', '[data-card=stats]']}
                row2 = {r[s]['top'] for s in ['[data-card=notes]', '[data-card=life]']}
                check(f'[{tag}] desktop two tiers', len(row1) == 1 and len(row2) == 1 and min(row2) > min(row1)
                      and r['[data-card=notes]']['width'] > r['[data-card=life]']['width'], r)
                hero_h = r['.home-hero']['height']
                check(f'[{tag}] light hero ({hero_h}px)', 110 <= hero_h <= 160, hero_h)
            # 滚到底：最后一张卡不被底部导航遮挡
            page.evaluate('''() => { const s = window.matchMedia('(max-width: 900px)').matches ? document.querySelector('.layout') : document.querySelector('.page-card');
              s.scrollTop = s.scrollHeight; }'''); settle(page, 400)
            covered = page.evaluate('''() => { const nav = document.querySelector('.site-nav'); const last = [...document.querySelectorAll('#main-content .bento-card')]
              .reduce((a, b) => (a.getBoundingClientRect().bottom > b.getBoundingClientRect().bottom ? a : b));
              const nb = nav.getBoundingClientRect(); const lb = last.getBoundingClientRect();
              return getComputedStyle(nav).position === 'fixed' && nb.top < innerHeight && lb.bottom > nb.top + 1; }''')
            check(f'[{tag}] last card not hidden behind fixed nav', not covered)
            page.evaluate('''() => { const s = window.matchMedia('(max-width: 900px)').matches ? document.querySelector('.layout') : document.querySelector('.page-card'); s.scrollTop = 0; }''')
            settle(page, 200)
            page.screenshot(path=str(OUT / f'home-{tag}.png'))
            ctx.close()

    browser.close()

report['passed'] = sum(c['passed'] for c in report['checks'])
report['failed'] = sum(not c['passed'] for c in report['checks'])
(OUT / 'report.json').write_text(json.dumps(report, ensure_ascii=False, indent=2), encoding='utf-8')
print(f"\n{report['passed']} passed, {report['failed']} failed, {len(report['errors'])} page errors, {len(report['console'])} console errors")
for e in report['errors'] + report['console']:
    print('  ', e)
