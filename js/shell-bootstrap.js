// Runs in <head>; only the pinned preference changes the content's reserved width.
(() => {
  const root = document.documentElement;
  let pinned = false;
  try {
    const saved = localStorage.getItem('y181_sidebar_pinned');
    pinned = saved === 'true' || (saved === null && localStorage.getItem('navCollapsed') === 'false');
    if (saved === null) localStorage.setItem('y181_sidebar_pinned', String(pinned));
    localStorage.removeItem('navCollapsed');
  } catch (_) { /* Storage can be disabled; the default layout still works. */ }
  root.dataset.sidebarPinned = String(pinned);
  root.removeAttribute('data-nav');
})();
