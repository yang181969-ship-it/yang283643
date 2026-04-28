// ============================================================
// js/count-up.js
// 数字滚动动画工具（Phase B2 / Commit 6）
//
// 用法：
//   countUp(el, 42)              立即开始，从 0 滚到 42，1200ms
//   countUp(el, 42, 800)         自定义时长
//   observeCountUp(el, 42)       进入视口再开始（IntersectionObserver）
//
// 行为：
//   - 自动尊重 prefers-reduced-motion，无障碍模式直接显示终值
//   - 非有限数字（NaN/Infinity）显示 ─，不报错
//   - easeOutCubic 缓动，结尾不会突兀
// ============================================================

(function () {
  'use strict';

  const prefersReducedMotion =
    window.matchMedia &&
    window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  function countUp(el, target, duration) {
    if (!el) return;
    if (!Number.isFinite(target)) {
      el.textContent = '─';
      return;
    }
    if (prefersReducedMotion) {
      el.textContent = String(target);
      return;
    }
    const dur = duration > 0 ? duration : 1200;
    const start = performance.now();
    function tick(now) {
      const elapsed = now - start;
      const t = Math.min(elapsed / dur, 1);
      const eased = 1 - Math.pow(1 - t, 3); // easeOutCubic
      const current = Math.round(target * eased);
      el.textContent = String(current);
      if (t < 1) requestAnimationFrame(tick);
    }
    requestAnimationFrame(tick);
  }

  function observeCountUp(el, target, duration) {
    if (!el) return;
    if (!Number.isFinite(target)) {
      el.textContent = '─';
      return;
    }
    if (!('IntersectionObserver' in window)) {
      countUp(el, target, duration);
      return;
    }
    const io = new IntersectionObserver((entries) => {
      entries.forEach((entry) => {
        if (entry.isIntersecting) {
          countUp(entry.target, target, duration);
          io.unobserve(entry.target);
        }
      });
    }, { threshold: 0.3 });
    io.observe(el);
  }

  window.countUp = countUp;
  window.observeCountUp = observeCountUp;
})();