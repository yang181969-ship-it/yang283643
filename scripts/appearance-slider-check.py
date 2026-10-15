"""Appearance panel slider regression checks (card opacity + grid density), driven by real input events.
Requires Python Playwright + Chrome. Run from the repository root against a local static server:
  python scripts/phase1-preview.py            (serves http://127.0.0.1:8765)
  python scripts/appearance-slider-check.py
APPEARANCE_BASE_URL overrides the server, APPEARANCE_OUT the output folder (default artifacts/appearance/).

Guards the rule "preset nodes only jump when they are clicked; dragging is never snapped":
fine drags of one step (82→83, 65→64, 23→24 …) must survive the release, with the mouse and with touch
(Chrome DevTools touch events), at desktop and phone widths. Also covers preset buttons, tapping a tick
on the track, long drags ending next to a tick, keyboard steps, the immersive preview lifecycle
(pointerup ≈350 ms, pointercancel immediate, rapid preset clicks), localStorage and reload.
"""
import json
import os
from pathlib import Path
from playwright.sync_api import sync_playwright

OUT = Path(os.environ.get('APPEARANCE_OUT', 'artifacts/appearance'))
OUT.mkdir(parents=True, exist_ok=True)
BASE = os.environ.get('APPEARANCE_BASE_URL', 'http://127.0.0.1:8765')
THUMB = 20  # same as --thumb in _theme-panel.scss and THUMB in theme.js
SLIDERS = {
    'opacity': {'id': 'paper-opacity', 'key': 'paper-opacity', 'var': '--paper-alpha', 'min': 45, 'max': 100,
                'presets': [45, 65, 82, 100], 'fine': [(82, +1), (82, -1), (65, +1), (65, -1)]},
    'grid': {'id': 'grid-opacity', 'key': 'grid-opacity', 'var': '--paper-grid-alpha', 'min': 0, 'max': 65,
             'presets': [0, 23, 45, 65], 'fine': [(23, +1), (23, -1), (45, +1), (45, -1)]},
}
report = {'checks': [], 'errors': []}


def check(name, ok, detail=None):
    report['checks'].append({'name': name, 'ok': bool(ok), 'detail': detail})
    print(('PASS ' if ok else 'FAIL ') + name + ('' if ok or detail is None else f'  -> {detail}'))


class Driver:
    """Real input: page.mouse for mouse, CDP Input.dispatchTouchEvent for touch."""
    def __init__(self, ctx, page, touch):
        self.page, self.touch = page, touch
        self.cdp = ctx.new_cdp_session(page) if touch else None

    def _touch(self, kind, x=None, y=None):
        points = [] if x is None else [{'x': x, 'y': y}]
        self.cdp.send('Input.dispatchTouchEvent', {'type': kind, 'touchPoints': points})

    def drag(self, x0, y, x1, steps=4, before_release=None):
        page = self.page
        if self.touch:
            # A finger has to leave the touch slop before the native thumb follows it, so a fine adjustment is
            # "pull out, come back": out 20 px past the start, then onto the target.
            out = x0 + (20 if x1 >= x0 else -20)
            self._touch('touchStart', x0, y)
            for i in range(1, 4):
                self._touch('touchMove', x0 + (out - x0) * i / 3, y); page.wait_for_timeout(16)
            for i in range(1, steps + 1):
                self._touch('touchMove', out + (x1 - out) * i / steps, y); page.wait_for_timeout(16)
        else:
            page.mouse.move(x0, y); page.mouse.down()
            page.mouse.move(x1, y, steps=steps)
        page.wait_for_timeout(60)
        seen = before_release() if before_release else None
        if self.touch: self._touch('touchEnd')
        else: page.mouse.up()
        return seen

    def tap(self, x, y):
        if self.touch:
            self._touch('touchStart', x, y); self.page.wait_for_timeout(30); self._touch('touchEnd')
        else:
            self.page.mouse.click(x, y)

    def cancel_drag(self, x0, y, x1):
        """Start a drag and let the system cancel it (touch only)."""
        self._touch('touchStart', x0, y)
        for i in range(1, 4):
            self._touch('touchMove', x0 + (x1 - x0) * i / 3, y); self.page.wait_for_timeout(16)
        self.page.wait_for_timeout(60)
        on = previewing(self.page)
        self._touch('touchCancel')
        return on


def previewing(page):
    return page.evaluate("() => document.querySelector('#tool-theme').classList.contains('is-previewing')")


def geometry(page, s):
    r = page.evaluate(f"() => {{ const r = document.getElementById('{s['id']}').getBoundingClientRect(); return [r.x, r.y, r.width, r.height]; }}")
    return {'x': r[0], 'y': r[1] + r[3] / 2, 'w': r[2]}


def x_for(g, s, value):
    return g['x'] + THUMB / 2 + (g['w'] - THUMB) * (value - s['min']) / (s['max'] - s['min'])


def read(page, s):
    return page.evaluate(f"""() => ({{
      input: Number(document.getElementById('{s['id']}').value),
      output: document.querySelector('output[for="{s['id']}"]').textContent,
      stored: localStorage.getItem('{s['key']}'),
      css: document.documentElement.style.getPropertyValue('{s['var']}'),
    }})""")


DEFAULTS = {'paper-opacity': 82, 'grid-opacity': 23}


def consistent(v, value, key=None):
    # Setting the value that is already active writes nothing, so a never-changed key may still be empty at its default.
    stored_ok = v['stored'] == str(value) or (v['stored'] is None and key is not None and DEFAULTS[key] == value)
    return v['input'] == value and v['output'] == f'{value}%' and stored_ok and v['css'] == f'{value / 100:.2f}'


def preset(page, s, value):
    page.locator(f'#{s["id"]} ~ .range-ticks').locator('xpath=../..').locator(f'.range-preset[data-value="{value}"]').click()
    page.wait_for_timeout(700)  # let the 600 ms preset preview finish before the next case


def open_paper(page, touch):
    trigger = '.mobile-tools [data-tool="theme"]' if page.viewport_size['width'] <= 900 else '#theme-toggle'
    (page.tap if touch else page.click)(trigger); page.wait_for_timeout(400)
    (page.tap if touch else page.click)('[data-appearance-tab="paper"]'); page.wait_for_timeout(150)


def run(browser, width, height, touch):
    tag = f'{width}-{"touch" if touch else "mouse"}'
    ctx = browser.new_context(viewport={'width': width, 'height': height}, has_touch=touch, is_mobile=touch)
    page = ctx.new_page()
    page.on('pageerror', lambda e: report['errors'].append(f'{tag}: {e}'))
    page.on('console', lambda m: m.type == 'error' and report['errors'].append(f'{tag} console: {m.text}'))
    page.goto(BASE + '/index.html', wait_until='load'); page.wait_for_timeout(900)
    page.evaluate("() => localStorage.clear()"); page.reload(wait_until='load'); page.wait_for_timeout(900)
    open_paper(page, touch)
    drv = Driver(ctx, page, touch)

    for name, s in SLIDERS.items():
        g = geometry(page, s)
        step = (g['w'] - THUMB) / (s['max'] - s['min'])

        # 1. one-step drags from a preset value: the release keeps the dragged value
        for start, direction in s['fine']:
            preset(page, s, start)
            cx = x_for(g, s, start)
            during = drv.drag(cx, g['y'], cx + direction * step, before_release=lambda: read(page, s)['input'])
            page.wait_for_timeout(80)
            v = read(page, s)
            check(f'{tag} {name}: drag {start}→{start + direction} kept after release',
                  during == start + direction and consistent(v, start + direction), {'during': during, 'after': v})

        # 2. the ~5 px drag from the review: still exactly one step, never pulled back
        preset(page, s, s['fine'][0][0])
        cx = x_for(g, s, s['fine'][0][0])
        during = drv.drag(cx, g['y'], cx + 5, before_release=lambda: read(page, s)['input'])
        page.wait_for_timeout(80)
        v = read(page, s)
        check(f'{tag} {name}: 5px drag keeps the native value', v['input'] == during != s['fine'][0][0] and consistent(v, during),
              {'during': during, 'after': v})

        # 3. preset buttons jump exactly
        for value in s['presets']:
            preset(page, s, value)
            check(f'{tag} {name}: preset button {value}', consistent(read(page, s), value, s['key']), read(page, s))

        # 4. tapping a tick on the track (away from the thumb) jumps exactly to that preset;
        #    9 px off the tick the native value alone would land one or two steps away
        preset(page, s, s['presets'][-1])
        tick = s['presets'][1]
        drv.tap(x_for(g, s, tick) + 9, g['y']); page.wait_for_timeout(80)
        check(f'{tag} {name}: tap on track tick {tick}', consistent(read(page, s), tick), read(page, s))

        # 5. long drags: one ending in open track, one ending one step past a tick — never snapped
        preset(page, s, s['presets'][-1])
        target = x_for(g, s, (s['min'] + s['max']) / 2) + 0.3 * step
        during = drv.drag(x_for(g, s, s['presets'][-1]), g['y'], target, steps=10, before_release=lambda: read(page, s)['input'])
        page.wait_for_timeout(80)
        check(f'{tag} {name}: long drag keeps its end value', consistent(read(page, s), during), {'during': during, 'after': read(page, s)})
        preset(page, s, s['presets'][-1])
        near = s['presets'][1]
        during = drv.drag(x_for(g, s, s['presets'][-1]), g['y'], x_for(g, s, near) + step, steps=10,
                          before_release=lambda: read(page, s)['input'])
        page.wait_for_timeout(80)
        check(f'{tag} {name}: drag ending next to tick {near} is not snapped', during == near + 1 and consistent(read(page, s), near + 1),
              {'during': during, 'after': read(page, s)})

        # 6. keyboard keeps 1 % steps with no snapping
        preset(page, s, s['presets'][2])
        page.focus(f'#{s["id"]}'); page.keyboard.press('ArrowRight')
        check(f'{tag} {name}: ArrowRight +1', consistent(read(page, s), s['presets'][2] + 1), read(page, s))
        page.keyboard.press('ArrowLeft'); page.keyboard.press('ArrowLeft')
        check(f'{tag} {name}: ArrowLeft ×2 −2', consistent(read(page, s), s['presets'][2] - 1), read(page, s))

    # 7. immersive preview lifecycle on a fine drag
    s = SLIDERS['opacity']; g = geometry(page, s); step = (g['w'] - THUMB) / (s['max'] - s['min'])
    preset(page, s, 82)
    cx = x_for(g, s, 82)
    seen = drv.drag(cx, g['y'], cx + step, before_release=lambda: previewing(page))
    page.wait_for_timeout(200); mid = previewing(page)
    page.wait_for_timeout(350); end = previewing(page)
    check(f'{tag} preview: on while dragging, held ~350ms after release, then restored', seen and mid and not end, [seen, mid, end])
    if touch:
        preset(page, s, 82)
        on = drv.cancel_drag(cx, g['y'], cx + 3 * step)
        page.wait_for_timeout(60)
        check(f'{tag} preview: pointercancel restores immediately', on and not previewing(page), on)

    # 8. rapid preset clicks: the last click owns the restore timer
    page.locator('#paper-panel .range-preset[data-value="65"]').first.click(); page.wait_for_timeout(300)
    page.locator('#paper-panel .range-preset[data-value="100"]').first.click(); page.wait_for_timeout(400)
    held = previewing(page); page.wait_for_timeout(350)
    check(f'{tag} preview: rapid preset clicks do not race', held and not previewing(page) and consistent(read(page, s), 100))

    # 9. reload keeps the real final values (not a nearby preset)
    preset(page, s, 65)
    drv.drag(x_for(g, s, 65), g['y'], x_for(g, s, 65) + step); page.wait_for_timeout(500)
    sg = SLIDERS['grid']; gg = geometry(page, sg); gstep = (gg['w'] - THUMB) / (sg['max'] - sg['min'])
    preset(page, sg, 23)
    drv.drag(x_for(gg, sg, 23), gg['y'], x_for(gg, sg, 23) - gstep); page.wait_for_timeout(500)
    page.screenshot(path=str(OUT / f'slider-{tag}.png'))
    page.reload(wait_until='load'); page.wait_for_timeout(900)
    open_paper(page, touch)
    check(f'{tag} reload keeps 66 / 22', consistent(read(page, s), 66) and consistent(read(page, sg), 22), [read(page, s), read(page, sg)])
    ctx.close()


with sync_playwright() as pw:
    browser = pw.chromium.launch(channel='chrome', headless=True)
    for width, height, touch in [(1440, 900, False), (390, 844, False), (390, 844, True), (360, 740, True), (430, 932, True)]:
        run(browser, width, height, touch)
    browser.close()

failed = [c['name'] for c in report['checks'] if not c['ok']]
(OUT / 'report.json').write_text(json.dumps(report, ensure_ascii=False, indent=2), encoding='utf-8')
print(json.dumps({'checks': len(report['checks']), 'failed': failed, 'errors': report['errors']}, ensure_ascii=False))
raise SystemExit(1 if failed or report['errors'] else 0)
