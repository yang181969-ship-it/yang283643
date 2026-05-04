// ============================================================
// js/rail-extras-swipe.js
// Phase D2:rail-extras 横滑分页点联动
// 桌面无副作用(.rail-extras-dots 在桌面 display:none)
// ============================================================
(function () {
  'use strict';

  function init() {
    const swipe = document.querySelector('.rail-extras');
    const dots  = document.querySelectorAll('.rail-extras-dot');
    if (!swipe || dots.length === 0) return;

    // 拿到所有可见 widget(.rail-widget 都算)
    const widgets = Array.from(swipe.querySelectorAll('.rail-widget'))
      .sort((a, b) => {
        const orderA = Number.parseInt(getComputedStyle(a).order, 10) || 0;
        const orderB = Number.parseInt(getComputedStyle(b).order, 10) || 0;
        return orderA - orderB;
      });
    if (widgets.length === 0) return;

    // dot click → 平滑滚到对应 widget
    dots.forEach((dot, i) => {
      dot.addEventListener('click', () => {
        const target = widgets[i];
        if (!target) return;
        target.scrollIntoView({
          behavior: 'smooth',
          block: 'nearest',
          inline: 'center',
        });
      });
    });

    // 谁在视口里 → 高亮对应 dot
    if (typeof IntersectionObserver !== 'function') return;

    const observer = new IntersectionObserver(
      (entries) => {
        // 取相交比例最大的 widget 作为当前页
        let best = null;
        let bestRatio = 0;
        entries.forEach((e) => {
          if (e.intersectionRatio > bestRatio) {
            bestRatio = e.intersectionRatio;
            best = e.target;
          }
        });
        if (!best) return;
        const idx = widgets.indexOf(best);
        if (idx === -1) return;
        dots.forEach((d, i) => {
          d.classList.toggle('is-active', i === idx);
        });
      },
      {
        root: swipe,
        threshold: [0.4, 0.6, 0.8],
      }
    );

    widgets.forEach((w) => observer.observe(w));
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init, { once: true });
  } else {
    init();
  }
})();
