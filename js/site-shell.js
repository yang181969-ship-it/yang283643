/* Shared shell: presentation state only. Audio and timer nodes are never recreated. */
(() => {
  'use strict';
  const root = document.documentElement;
  const rail = document.querySelector('.rail');
  if (!rail || window.sitePanels) return;
  const mobile = matchMedia('(max-width: 900px)');
  const panels = new Map();
  const stack = [];
  const focusable = 'button:not(:disabled), a[href], input:not(:disabled), [tabindex]:not([tabindex="-1"])';

  // Modules (search, theme, …) react to these instead of owning the buttons.
  function emit(type, key) {
    window.dispatchEvent(new CustomEvent(type, { detail: { key } }));
  }
  // Popovers (theme) are non-modal: no backdrop, no focus trap, the page stays usable.
  // A popover marked data-mobile-panel="sheet" opens as a modal bottom sheet on mobile instead;
  // the mode is fixed when it opens, so a breakpoint change can never mix the two lifecycles.
  const modeFor = dialog => dialog.dataset.panel !== 'popover' ? 'modal'
    : dialog.dataset.mobilePanel === 'sheet' && mobile.matches ? 'sheet' : 'popover';
  const isPopover = key => {
    const panel = panels.get(key);
    return Boolean(panel) && (panel.mode || modeFor(panel.dialog)) === 'popover';
  };
  function syncModalState() {
    root.classList.toggle('has-tool-panel', stack.some(key => !isPopover(key)));
    document.querySelectorAll('[data-tool]').forEach(button => {
      button.setAttribute('aria-expanded', String(Boolean(panels.get(button.dataset.tool)?.dialog.open)));
    });
  }
  function close(key, restore = true) {
    const panel = panels.get(key);
    if (!panel?.dialog.open) return;
    // Close children first, so focus never goes behind a remaining modal.
    const index = stack.indexOf(key);
    while (stack.length > index + 1) close(stack.at(-1), false);
    stack.splice(index, 1);
    panel.dialog.close();
    if (isPopover(key)) popoverCleanup();
    panel.onClose?.();
    syncModalState();
    emit('site-panel:close', key);
    if (restore) {
      const target = panel.trigger?.isConnected && panel.trigger.getClientRects().length
        ? panel.trigger : document.querySelector(`[data-tool="${key}"]`);
      target?.focus({ preventScroll: true });
    }
  }
  function open(key, trigger = document.activeElement, nested = false) {
    const panel = panels.get(key);
    if (!panel || panel.dialog.open) return;
    // A control inside an open dialog that switches panels returns focus to the
    // original shell button, not to an element inside the dialog being replaced.
    if (!nested && trigger?.closest('dialog[open]') && stack.length) trigger = panels.get(stack.at(-1)).trigger;
    if (!nested) while (stack.length) close(stack.at(-1), false);
    panel.trigger = trigger;
    panel.mode = modeFor(panel.dialog);
    panel.dialog.dataset.mode = panel.mode;
    if (panel.mode === 'popover') {
      panel.dialog.show();
      placePopover(key);
      popoverWatch(key);
    } else {
      // A sheet is laid out by CSS; drop any desktop anchoring left from an earlier popover.
      if (panel.mode === 'sheet') ['left', 'top', 'max-height'].forEach(prop => panel.dialog.style.removeProperty(prop));
      panel.dialog.showModal();
    }
    stack.push(key);
    syncModalState();
    emit('site-panel:open', key);
    requestAnimationFrame(() => syncFades(panel.dialog));
    // Text inputs (search) take focus; music focuses its play button rather than the playlist filter,
    // so touch devices do not pop the keyboard on open.
    const first = panel.dialog.querySelector('[data-autofocus]:not(:disabled), [autofocus], input[type="text"]:not([hidden])');
    (first || panel.dialog.querySelector(focusable))?.focus({ preventScroll: true });
  }
  // Scroll hint for inner scroll areas marked [data-scroll-fade]: data-fade-bottom is set only while
  // content continues below. Updated on scroll / resize / interaction inside the panel, never polled.
  function syncFades(dialog) {
    dialog.querySelectorAll('[data-scroll-fade]').forEach(el => {
      el.toggleAttribute('data-fade-bottom', el.scrollHeight - el.clientHeight - el.scrollTop > 2);
    });
  }
  const fadeObserver = new ResizeObserver(entries => {
    new Set(entries.map(entry => entry.target.closest('dialog'))).forEach(dialog => dialog && syncFades(dialog));
  });
  function register(key, dialog, onClose) {
    panels.set(key, { dialog, onClose });
    dialog.querySelectorAll('[data-scroll-fade]').forEach(el => fadeObserver.observe(el));
    dialog.addEventListener('scroll', () => syncFades(dialog), { capture: true, passive: true });
    ['input', 'click'].forEach(type => dialog.addEventListener(type, () => requestAnimationFrame(() => syncFades(dialog))));
    dialog.addEventListener('cancel', event => { event.preventDefault(); close(key); });
    let backdropDown = false;
    dialog.addEventListener('pointerdown', event => {
      const rect = dialog.getBoundingClientRect();
      backdropDown = event.target === dialog && (event.clientX < rect.left || event.clientX > rect.right || event.clientY < rect.top || event.clientY > rect.bottom);
    });
    dialog.addEventListener('click', event => {
      if (event.target === dialog && backdropDown) close(key);
      if (event.target.closest('[data-tool-close]')) close(key);
    });
  }
  function adopt(key, content, label, onClose) {
    if (panels.has(key)) return panels.get(key).dialog;
    const dialog = document.createElement('dialog');
    dialog.className = 'tool-dialog tool-dialog--legacy';
    dialog.setAttribute('aria-label', label);
    document.body.append(dialog);
    dialog.append(content);
    register(key, dialog, onClose);
    return dialog;
  }
  function toggle(key, trigger) {
    if (panels.get(key)?.dialog.open) close(key);
    else open(key, trigger);
  }

  // Popover placement: desktop beside the rail button, mobile under the toolbar button, always on screen.
  function anchorFor(key) {
    const trigger = panels.get(key).trigger;
    if (trigger?.isConnected && trigger.getClientRects().length) return trigger;
    return [...document.querySelectorAll(`[data-tool="${key}"]`)].find(el => el.getClientRects().length);
  }
  function placePopover(key) {
    const { dialog } = panels.get(key);
    const anchor = anchorFor(key);
    if (!anchor || !dialog.open) return;
    const r = anchor.getBoundingClientRect();
    const view = window.visualViewport;
    const vw = document.documentElement.clientWidth, vh = view ? view.height : innerHeight;
    const edge = 8, gap = 10;
    let top = mobile.matches ? r.bottom + gap : edge;
    dialog.style.maxHeight = `${Math.max(160, vh - top - edge)}px`;
    const w = dialog.offsetWidth, h = dialog.offsetHeight;
    let left;
    if (mobile.matches) {
      left = r.right - w;
    } else {
      left = rail.getBoundingClientRect().right + gap; // Beside the floating rail sheet, not inside its edge.
      top = r.bottom - h; // The theme button sits near the rail bottom, so the panel grows upward.
    }
    left = Math.min(Math.max(left, edge), vw - w - edge);
    top = Math.min(Math.max(top, edge), vh - h - edge);
    dialog.style.left = `${Math.round(left)}px`;
    dialog.style.top = `${Math.round(top)}px`;
    dialog.dataset.side = mobile.matches ? 'bottom' : 'right';
  }
  let popoverStop = null;
  function popoverWatch(key) {
    popoverCleanup();
    const { dialog } = panels.get(key);
    const reposition = () => placePopover(key);
    // The rail animates its width when pinned; follow it frame by frame.
    const observer = new ResizeObserver(reposition);
    observer.observe(rail);
    observer.observe(dialog);
    const outside = event => {
      if (dialog.contains(event.target) || event.target.closest?.(`[data-tool="${key}"]`)) return;
      close(key, false); // The click still reaches the page; focus goes where the user clicked.
    };
    window.addEventListener('resize', reposition);
    window.visualViewport?.addEventListener('resize', reposition);
    document.addEventListener('pointerdown', outside, true);
    popoverStop = () => {
      observer.disconnect();
      window.removeEventListener('resize', reposition);
      window.visualViewport?.removeEventListener('resize', reposition);
      document.removeEventListener('pointerdown', outside, true);
    };
  }
  function popoverCleanup() { popoverStop?.(); popoverStop = null; }

  window.sitePanels = { open, close, toggle, adopt, get active() { return stack.at(-1); } };
  document.querySelectorAll('dialog[id^="tool-"]').forEach(dialog => register(dialog.id.slice(5), dialog));
  // Capture Esc before legacy document handlers; exactly one layer closes per press.
  document.addEventListener('keydown', event => {
    if (!stack.length) return;
    if (event.key === 'Escape') {
      event.preventDefault(); event.stopImmediatePropagation(); close(stack.at(-1));
    } else if (event.key === 'Tab' && !isPopover(stack.at(-1))) {
      const dialog = panels.get(stack.at(-1)).dialog;
      const items = [...dialog.querySelectorAll(focusable)].filter(el => el.getClientRects().length && !el.closest('[hidden], [inert]'));
      const first = items[0], last = items.at(-1);
      if (!first) { event.preventDefault(); dialog.focus(); }
      else if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
    }
  }, true);

  // One delegated handler for every shell tool, desktop rail and mobile toolbar alike.
  document.addEventListener('click', event => {
    const button = event.target.closest('[data-tool]');
    if (!button || !panels.has(button.dataset.tool)) return;
    toggle(button.dataset.tool, button);
  });

  // Ctrl+K / Cmd+K toggles search, but never hijacks typing in another field.
  document.addEventListener('keydown', event => {
    if (event.key?.toLowerCase() !== 'k' || !(event.ctrlKey || event.metaKey) || event.altKey || event.shiftKey) return;
    const target = event.target instanceof Element ? event.target : null;
    if (target?.closest('input, textarea, select, [contenteditable]:not([contenteditable="false"])') && !target.closest('#tool-search')) return;
    if (!panels.has('search')) return;
    event.preventDefault();
    toggle('search', document.getElementById('search-toggle'));
  });

  // Desktop sidebar: two states, changed only by the toggle button.
  const pin = rail.querySelector('.rail-pin');
  function syncPin() {
    const expanded = root.dataset.sidebarPinned === 'true';
    const label = expanded ? '收起侧栏' : '展开侧栏';
    pin.setAttribute('aria-expanded', String(expanded));
    pin.setAttribute('aria-label', label);
    pin.title = label;
    pin.querySelector('.shell-label').textContent = label;
  }
  pin.addEventListener('click', () => {
    const expanded = root.dataset.sidebarPinned !== 'true';
    root.dataset.sidebarPinned = String(expanded);
    try { localStorage.setItem('y181_sidebar_pinned', String(expanded)); } catch (_) {}
    syncPin();
  });
  window.addEventListener('storage', event => {
    if (event.key === 'y181_sidebar_pinned') { root.dataset.sidebarPinned = String(event.newValue === 'true'); syncPin(); }
  });
  syncPin();
  // Very short desktop windows: the rail's middle area scrolls; mark it while more items are below.
  const railScroll = rail.querySelector('.rail-scroll');
  if (railScroll) {
    const syncRailFade = () => railScroll.toggleAttribute('data-fade-bottom', railScroll.scrollHeight - railScroll.clientHeight - railScroll.scrollTop > 2);
    railScroll.addEventListener('scroll', syncRailFade, { passive: true });
    new ResizeObserver(syncRailFade).observe(railScroll);
  }

  // Date button: owned here so it never stays blank, even if the month widget fails.
  let today = '', midnightTimer;
  function refreshDate() {
    const now = new Date();
    const key = `${now.getFullYear()}-${now.getMonth() + 1}-${now.getDate()}`;
    clearTimeout(midnightTimer);
    const midnight = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1);
    midnightTimer = setTimeout(refreshDate, midnight - now + 50);
    if (key === today) return;
    today = key;
    // Line calendar icon shows the day number only; the month is in the button's aria-label.
    document.querySelectorAll('[data-date-day]').forEach(el => { el.textContent = now.getDate(); });
    document.querySelectorAll('[data-tool="calendar"]').forEach(el => {
      el.setAttribute('aria-label', `日历，今天 ${now.getFullYear()}年${now.getMonth() + 1}月${now.getDate()}日`);
    });
    window.dispatchEvent(new CustomEvent('site:datechange', { detail: { date: now } }));
  }
  // Timers can be throttled or frozen in the background; re-check whenever the page returns.
  document.addEventListener('visibilitychange', () => { if (!document.hidden) refreshDate(); });
  window.addEventListener('pageshow', refreshDate);
  window.addEventListener('focus', refreshDate);
  window.siteDate = { refresh: refreshDate };
  refreshDate();

  const tools = [...document.querySelectorAll('.rail-tools > button')];
  const actions = [...document.querySelectorAll('.rail-actions > button')];
  const toolbar = document.querySelector('[data-mobile-tools]');
  toolbar.addEventListener('focusin', () => root.classList.remove('toolbar-hidden'));
  function responsive() {
    root.classList.remove('toolbar-hidden');
    tools.forEach(button => (mobile.matches ? toolbar : document.querySelector('.rail-tools')).append(button));
    actions.forEach(button => (mobile.matches ? toolbar : document.querySelector('.rail-actions')).append(button));
  }
  // A panel whose mode depends on the breakpoint (theme: popover ↔ sheet) closes instead of switching while open.
  mobile.addEventListener('change', () => {
    [...stack].reverse().forEach(key => {
      const panel = panels.get(key);
      if (panel.mode !== modeFor(panel.dialog)) close(key, false);
    });
  });
  mobile.addEventListener('change', responsive);
  responsive();

  const layout = document.querySelector('.layout');
  let previous = layout.scrollTop, travel = 0, direction = 0;
  layout.addEventListener('scroll', () => {
    const current = Math.max(0, layout.scrollTop), delta = current - previous;
    previous = current;
    if (!mobile.matches || stack.length) { travel = 0; return; }
    if (current < 12) { root.classList.remove('toolbar-hidden'); travel = 0; return; }
    if (Math.abs(delta) < 2) return;
    const nextDirection = Math.sign(delta);
    travel = nextDirection === direction ? travel + Math.abs(delta) : Math.abs(delta);
    direction = nextDirection;
    if (travel > (direction > 0 ? 36 : 18)) {
      root.classList.toggle('toolbar-hidden', direction > 0);
      travel = 0;
    }
  }, { passive: true });
  const showToolbar = () => { root.classList.remove('toolbar-hidden'); previous = Math.max(0, layout.scrollTop); travel = 0; };
  window.addEventListener('locationchange', showToolbar);
  window.addEventListener('popstate', showToolbar);
  // Any tool panel (button, Ctrl/Cmd+K, a control inside another panel) shows the toolbar first; auto-hide
  // stays paused while one is open (the scroll handler checks the stack) and restarts from here on close,
  // so focus returns to a visible toolbar button.
  window.addEventListener('site-panel:open', showToolbar);
  window.addEventListener('site-panel:close', () => { if (!stack.length) showToolbar(); });

  // Soft keyboard: the bottom navigation steps aside only while a text field has focus AND the visual
  // viewport has lost a keyboard-sized part of its height compared with the same width without a focused
  // field. Pinch zoom is ignored. Without visualViewport the navigation simply stays (limited fallback).
  const view = window.visualViewport;
  if (view) {
    const textField = 'input:not([type="button"], [type="checkbox"], [type="radio"], [type="range"], [type="submit"], [type="reset"], [type="color"], [type="file"]), textarea, [contenteditable]:not([contenteditable="false"])';
    let baseWidth = 0, baseHeight = 0;
    const syncKeyboard = () => {
      if (Math.abs(view.scale - 1) > 0.01) return;
      if (innerWidth !== baseWidth) { baseWidth = innerWidth; baseHeight = 0; }
      const typing = Boolean(document.activeElement?.matches(textField));
      if (!typing) baseHeight = Math.max(baseHeight, view.height);
      root.classList.toggle('keyboard-open', mobile.matches && typing && baseHeight - view.height > 150);
    };
    view.addEventListener('resize', syncKeyboard);
    document.addEventListener('focusin', syncKeyboard);
    document.addEventListener('focusout', () => requestAnimationFrame(syncKeyboard));
    syncKeyboard();
  }
  // Only a back/forward-cache restore; the initial load's pageshow can land after the user scrolled.
  window.addEventListener('pageshow', event => { if (event.persisted) showToolbar(); });
  if (document.body.dataset.standalone === 'true') {
    const page = document.body.dataset.page || 'notes';
    root.dataset.page = page;
    document.querySelectorAll('.site-nav a').forEach(link => {
      const key = new URL(link.href).searchParams.get('page') || 'home';
      const active = key === (page === 'stats' || page === 'update' ? 'about' : page);
      link.classList.toggle('active', active);
      if (active) link.setAttribute('aria-current', 'page');
    });
  }
})();
