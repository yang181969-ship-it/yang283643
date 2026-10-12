/* Shared shell: presentation state only. Audio and timer nodes are never recreated. */
(() => {
  'use strict';
  const root = document.documentElement;
  const rail = document.querySelector('.rail');
  if (!rail || window.sitePanels) return;
  const mobile = matchMedia('(max-width: 900px)');
  const hover = matchMedia('(hover: hover) and (pointer: fine)');
  const panels = new Map();
  const stack = [];
  const focusable = 'button:not(:disabled), a[href], input:not(:disabled), [tabindex]:not([tabindex="-1"])';

  function syncModalState() {
    root.classList.toggle('has-tool-panel', stack.length > 0);
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
    panel.onClose?.();
    syncModalState();
    if (restore) {
      const target = panel.trigger?.isConnected && panel.trigger.getClientRects().length
        ? panel.trigger : document.getElementById('theme-toggle');
      target?.focus({ preventScroll: true });
    }
    scheduleCollapse();
  }
  function open(key, trigger = document.activeElement, nested = false) {
    const panel = panels.get(key);
    if (!panel || panel.dialog.open) return;
    // A settings link inside the theme dialog must return to the visible theme button,
    // not to an element inside the dialog that is being replaced.
    if (!nested && trigger?.closest('dialog[open]') && stack.length) trigger = panels.get(stack.at(-1)).trigger;
    if (!nested) while (stack.length) close(stack.at(-1), false);
    panel.trigger = trigger;
    panel.dialog.showModal();
    stack.push(key);
    syncModalState();
    const first = panel.dialog.querySelector('[autofocus], input:not([type="hidden"]):not([hidden])');
    (first || panel.dialog.querySelector(focusable))?.focus({ preventScroll: true });
  }
  function register(key, dialog, onClose) {
    panels.set(key, { dialog, onClose });
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
  window.sitePanels = { open, close, adopt, get active() { return stack.at(-1); } };
  document.querySelectorAll('dialog[id^="tool-"]').forEach(dialog => {
    const key = dialog.id.slice(5);
    register(key, dialog, () => {
      if (key === 'search') window.dispatchEvent(new Event('site-search:close'));
      if (key === 'theme') document.getElementById('theme-panel').classList.remove('show');
    });
  });
  // Capture Esc before legacy document handlers; exactly one layer closes per press.
  document.addEventListener('keydown', event => {
    if (!stack.length) return;
    if (event.key === 'Escape') {
      event.preventDefault(); event.stopImmediatePropagation(); close(stack.at(-1));
    } else if (event.key === 'Tab') {
      const dialog = panels.get(stack.at(-1)).dialog;
      const items = [...dialog.querySelectorAll(focusable)].filter(el => el.getClientRects().length && !el.closest('[hidden]'));
      const first = items[0], last = items.at(-1);
      if (!first) { event.preventDefault(); dialog.focus(); }
      else if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
    }
  }, true);

  document.addEventListener('click', event => {
    const button = event.target.closest('[data-tool]');
    if (!button) return;
    const key = button.dataset.tool;
    if (key === 'search' || key === 'theme') return; // Existing modules retain their controls.
    open(key, button);
  });
  let enterTimer, leaveTimer;
  function expand() { clearTimeout(leaveTimer); root.classList.add('sidebar-peek'); }
  function scheduleCollapse() {
    clearTimeout(enterTimer); clearTimeout(leaveTimer);
    leaveTimer = setTimeout(() => {
      if (!stack.length && !rail.matches(':hover') && !rail.querySelector(':focus-visible')) root.classList.remove('sidebar-peek');
    }, 250);
  }
  rail.addEventListener('pointerenter', event => {
    if (mobile.matches || !hover.matches || event.pointerType === 'touch') return;
    clearTimeout(leaveTimer); enterTimer = setTimeout(expand, 180);
  });
  rail.addEventListener('pointerleave', scheduleCollapse);
  rail.addEventListener('focusin', expand);
  rail.addEventListener('focusout', scheduleCollapse);
  function setPinned(value) {
    root.dataset.sidebarPinned = String(value);
    root.classList.remove('sidebar-peek');
    try { localStorage.setItem('y181_sidebar_pinned', String(value)); } catch (_) {}
    syncPin();
  }
  function syncPin() {
    const value = root.dataset.sidebarPinned === 'true';
    const pin = document.querySelector('.rail-pin');
    pin.setAttribute('aria-pressed', String(value));
    pin.setAttribute('aria-label', value ? '取消固定侧栏' : '固定展开侧栏');
    pin.querySelector('.shell-label').textContent = value ? '取消固定' : '固定侧栏';
    document.querySelector('[data-pin-setting]').checked = value;
  }
  document.querySelector('.rail-pin').addEventListener('click', () => setPinned(root.dataset.sidebarPinned !== 'true'));
  document.querySelector('[data-pin-setting]').addEventListener('change', event => setPinned(event.target.checked));
  window.addEventListener('storage', event => {
    if (event.key === 'y181_sidebar_pinned') { root.dataset.sidebarPinned = String(event.newValue === 'true'); syncPin(); }
  });
  syncPin();

  const tools = [...document.querySelectorAll('.rail-tools > button')];
  const actions = [...document.querySelectorAll('.rail-actions > button')];
  const toolbar = document.querySelector('[data-mobile-tools]');
  toolbar.addEventListener('focusin', () => root.classList.remove('toolbar-hidden'));
  function responsive() {
    root.classList.remove('sidebar-peek', 'toolbar-hidden');
    clearTimeout(enterTimer); clearTimeout(leaveTimer);
    tools.forEach(button => (mobile.matches ? toolbar : document.querySelector('.rail-tools')).append(button));
    actions.forEach(button => {
      (mobile.matches && button.dataset.tool !== 'settings' ? toolbar : document.querySelector('.rail-actions')).append(button);
    });
  }
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
  window.addEventListener('locationchange', () => root.classList.remove('toolbar-hidden'));
  if (document.body.dataset.standalone === 'true') {
    const page = document.body.dataset.page || (location.pathname.includes('anime-detail') ? 'anime' : 'notes');
    root.dataset.page = page;
    document.querySelectorAll('.site-nav a').forEach(link => {
      const key = new URL(link.href).searchParams.get('page') || 'home';
      const active = key === (page === 'stats' ? 'home' : page);
      link.classList.toggle('active', active);
      if (active) link.setAttribute('aria-current', 'page');
    });
  }
})();
