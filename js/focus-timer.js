/**
 * 专注计时器 —— Phase C Commit 2(v2)
 * 秒表 stopwatch:从 0 累加,无终点,reset 时若有累计则计入今日
 * 计时 countdown:从 N 倒数到 0,跑完弹 modal 并计入今日,不循环
 * 共用:静音 + 长按 3s 直接重置 / 短按 confirm 重置 / visibilitychange 暂停
 */
(function () {
  'use strict';

  const KEY_SESSION = 'y181_focus_session';
  const KEY_TOTAL   = 'y181_focus_total_today';
  const HOLD_MS     = 3000;

  const state = {
    mode: 'stopwatch',     // 'stopwatch' | 'countdown'
    countdownMin: 25,
    status: 'idle',        // 'idle' | 'running' | 'paused' | 'completed'(仅 countdown)

    // 秒表字段
    swStartedAt: 0,        // running 时的当前段起点(Date.now())
    swAccumulated: 0,      // 暂停前累计毫秒

    // 计时字段
    cdDuration: 0,         // 本轮总秒数
    cdRemaining: 0,
    cdEndsAt: 0,

    rafId: 0,
  };

  let root, displayEl, todayEl,
      sliderWrap, sliderEl, sliderValEl,
      progressEl, progressBarEl,
      tabSwBtn, tabCdBtn,
      startBtn, pauseBtn, resetBtn, holdEl,
      modalRoot;

  // ============================================================
  // 入口
  // ============================================================
  function init() {
    root = document.querySelector('.rail-widget--timer');
    if (!root) return;

    displayEl     = root.querySelector('[data-timer-display]');
    todayEl       = root.querySelector('[data-timer-today]');
    sliderWrap    = root.querySelector('[data-timer-slider-wrap]');
    sliderEl      = root.querySelector('[data-timer-slider]');
    sliderValEl   = root.querySelector('[data-timer-slider-value]');
    progressEl    = root.querySelector('[data-timer-progress]');
    progressBarEl = root.querySelector('[data-timer-progress-bar]');
    tabSwBtn      = root.querySelector('[data-timer-tab="stopwatch"]');
    tabCdBtn      = root.querySelector('[data-timer-tab="countdown"]');
    startBtn      = root.querySelector('[data-timer-act="start"]');
    pauseBtn      = root.querySelector('[data-timer-act="pause"]');
    resetBtn      = root.querySelector('[data-timer-act="reset"]');
    holdEl        = root.querySelector('[data-timer-hold]');

    if (!displayEl || !startBtn || !pauseBtn || !resetBtn) return;

    injectModal();
    loadSession();
    refreshTodayTotal();

    if (tabSwBtn) tabSwBtn.addEventListener('click', () => switchMode('stopwatch'));
    if (tabCdBtn) tabCdBtn.addEventListener('click', () => switchMode('countdown'));
    if (sliderEl) sliderEl.addEventListener('input', onSliderInput);

    startBtn.addEventListener('click', onStartClick);
    pauseBtn.addEventListener('click', onPauseClick);
    bindLongPress(resetBtn);

    document.addEventListener('visibilitychange', () => {
      if (document.hidden && state.status === 'running') pause();
    });

    applyMode();
    render();
  }

  // ============================================================
  // 持久化(只存偏好)
  // ============================================================
  function loadSession() {
    try {
      const raw = localStorage.getItem(KEY_SESSION);
      if (!raw) return;
      const data = JSON.parse(raw);

      // 新键
      if (data.mode === 'stopwatch' || data.mode === 'countdown') {
        state.mode = data.mode;
      }
      // 旧键兼容(auto/manual 旧版本)
      else if (data.mode === 'auto' || data.mode === 'manual') {
        state.mode = 'countdown';
      }

      const m = parseInt(
        data.countdownMin != null ? data.countdownMin : data.manualMin,
        10
      );
      if (Number.isFinite(m) && m >= 1 && m <= 60) state.countdownMin = m;
    } catch (_) {}
  }

  function saveSession() {
    try {
      localStorage.setItem(KEY_SESSION, JSON.stringify({
        mode: state.mode,
        countdownMin: state.countdownMin,
      }));
    } catch (_) {}
  }

  function todayKey() {
    const d = new Date();
    return d.getFullYear() + '-'
      + String(d.getMonth() + 1).padStart(2, '0') + '-'
      + String(d.getDate()).padStart(2, '0');
  }

  function readTotal() {
    try {
      const raw = localStorage.getItem(KEY_TOTAL);
      if (!raw) return 0;
      const data = JSON.parse(raw);
      if (data && data.date === todayKey() && typeof data.seconds === 'number') {
        return data.seconds;
      }
    } catch (_) {}
    return 0;
  }

  function addTotal(seconds) {
    if (!seconds || seconds <= 0) return;
    const cur = readTotal();
    try {
      localStorage.setItem(KEY_TOTAL, JSON.stringify({
        date: todayKey(),
        seconds: cur + seconds,
      }));
    } catch (_) {}
    refreshTodayTotal();
  }

  function refreshTodayTotal() {
    if (!todayEl) return;
    const s = readTotal();
    if (s <= 0) { todayEl.textContent = '今日 0m'; return; }
    const h = Math.floor(s / 3600);
    const m = Math.floor((s % 3600) / 60);
    todayEl.textContent = h > 0
      ? '今日 ' + h + 'h ' + m + 'm'
      : '今日 ' + m + 'm';
  }

  // ============================================================
  // 模式切换
  // ============================================================
  function switchMode(mode) {
    if (state.status === 'running' || state.status === 'paused') return;
    if (state.mode === mode) return;
    state.mode = mode;
    // 切 tab 时清空所有计时字段(idle/completed 都重置回干净 idle)
    state.status = 'idle';
    state.swStartedAt = 0;
    state.swAccumulated = 0;
    state.cdDuration = 0;
    state.cdRemaining = 0;
    state.cdEndsAt = 0;
    saveSession();
    applyMode();
    render();
  }

  function applyMode() {
    const isSw = state.mode === 'stopwatch';
    if (tabSwBtn) {
      tabSwBtn.classList.toggle('is-active', isSw);
      tabSwBtn.setAttribute('aria-selected', isSw ? 'true' : 'false');
    }
    if (tabCdBtn) {
      tabCdBtn.classList.toggle('is-active', !isSw);
      tabCdBtn.setAttribute('aria-selected', !isSw ? 'true' : 'false');
    }
    if (sliderWrap) sliderWrap.hidden = isSw;
    if (sliderEl)    sliderEl.value = String(state.countdownMin);
    if (sliderValEl) sliderValEl.textContent = state.countdownMin + ' min';
  }

  function onSliderInput(e) {
    if (state.status === 'running' || state.status === 'paused') return;
    const v = clampInt(e.target.value, 1, 60);
    state.countdownMin = v;
    if (sliderValEl) sliderValEl.textContent = v + ' min';
    saveSession();
    render();
  }

  function clampInt(v, lo, hi) {
    const n = parseInt(v, 10);
    if (!Number.isFinite(n)) return lo;
    return Math.max(lo, Math.min(hi, n));
  }

  // ============================================================
  // 秒表 / 计时统一控制接口
  // ============================================================
  function start() {
    if (state.mode === 'stopwatch') startStopwatch();
    else startCountdown();
  }

  function pause() {
    if (state.status !== 'running') return;
    cancelAnimationFrame(state.rafId);
    state.rafId = 0;

    if (state.mode === 'stopwatch') {
      state.swAccumulated += Date.now() - state.swStartedAt;
      state.swStartedAt = 0;
    } else {
      state.cdRemaining = Math.max(0, Math.ceil((state.cdEndsAt - Date.now()) / 1000));
    }
    state.status = 'paused';
    render();
  }

  function reset() {
    cancelAnimationFrame(state.rafId);
    state.rafId = 0;

    if (state.mode === 'stopwatch') {
      // 秒表"停下即完成":有累计就计入今日
      const elapsedSec = Math.floor(getStopwatchMs() / 1000);
      addTotal(elapsedSec);
      state.swStartedAt = 0;
      state.swAccumulated = 0;
    } else {
      // 计时:重置不计入,只有自然跑完才算
      state.cdDuration = 0;
      state.cdRemaining = 0;
      state.cdEndsAt = 0;
    }
    state.status = 'idle';
    render();
  }

  // ---- 秒表 ----
  function startStopwatch() {
    if (state.status === 'running') return;
    if (state.status === 'idle' || state.status === 'completed') {
      state.swAccumulated = 0;
    }
    state.swStartedAt = Date.now();
    state.status = 'running';
    loop();
    render();
  }

  function getStopwatchMs() {
    if (state.status === 'running' && state.swStartedAt > 0) {
      return state.swAccumulated + (Date.now() - state.swStartedAt);
    }
    return state.swAccumulated;
  }

  // ---- 计时 ----
  function startCountdown() {
    if (state.status === 'idle' || state.status === 'completed') {
      state.cdDuration  = state.countdownMin * 60;
      state.cdRemaining = state.cdDuration;
      state.cdEndsAt    = Date.now() + state.cdRemaining * 1000;
      state.status      = 'running';
    } else if (state.status === 'paused') {
      state.cdEndsAt = Date.now() + state.cdRemaining * 1000;
      state.status   = 'running';
    } else {
      return;
    }
    loop();
    render();
  }

  function completeCountdown() {
    cancelAnimationFrame(state.rafId);
    state.rafId = 0;
    const completedSeconds = state.cdDuration;
    state.cdRemaining = 0;
    state.status = 'completed';
    addTotal(completedSeconds);
    render();
    showModal(completedSeconds);
  }

  // ---- 共享 RAF 循环 ----
  function loop() {
    cancelAnimationFrame(state.rafId);
    const tick = () => {
      if (state.mode === 'countdown') {
        const remain = Math.max(0, Math.ceil((state.cdEndsAt - Date.now()) / 1000));
        state.cdRemaining = remain;
        renderTicking();
        if (remain <= 0) { completeCountdown(); return; }
      } else {
        renderTicking();
      }
      state.rafId = requestAnimationFrame(tick);
    };
    state.rafId = requestAnimationFrame(tick);
  }

  // ============================================================
  // 渲染
  // ============================================================
  function fmtMS(totalSec) {
    const m = Math.floor(totalSec / 60);
    const s = totalSec % 60;
    return String(m).padStart(2, '0') + ':' + String(s).padStart(2, '0');
  }

  function fmtElapsedMs(ms) {
    const totalSec = Math.floor(ms / 1000);
    const h = Math.floor(totalSec / 3600);
    if (h > 0) {
      const m = Math.floor((totalSec % 3600) / 60);
      const s = totalSec % 60;
      return h + ':' + String(m).padStart(2, '0') + ':' + String(s).padStart(2, '0');
    }
    return fmtMS(totalSec);
  }

  function getDisplayText() {
    if (state.mode === 'stopwatch') {
      return fmtElapsedMs(getStopwatchMs());
    }
    // countdown
    if (state.status === 'idle')           return fmtMS(state.countdownMin * 60);
    if (state.status === 'completed')      return fmtMS(0);
    return fmtMS(state.cdRemaining);
  }

  function render() {
    displayEl.textContent = getDisplayText();

    // 进度条仅 countdown 非 idle 时显示
    const showProgress = state.mode === 'countdown' && state.status !== 'idle';
    if (progressEl) progressEl.hidden = !showProgress;
    if (progressBarEl) {
      const pct = showProgress && state.cdDuration > 0
        ? Math.max(0, Math.min(1, 1 - state.cdRemaining / state.cdDuration))
        : 0;
      progressBarEl.style.width = (pct * 100).toFixed(2) + '%';
    }

    const isRunning   = state.status === 'running';
    const isPaused    = state.status === 'paused';
    const isIdle      = state.status === 'idle';
    const isCompleted = state.status === 'completed';

    startBtn.disabled = isRunning;
    if (isPaused)         startBtn.textContent = '继续';
    else if (isCompleted) startBtn.textContent = '再来';
    else                  startBtn.textContent = '开始';

    pauseBtn.disabled = !isRunning;

    // 秒表:有累计或暂停时可重置;计时:非 idle 时可重置
    const canResetSw = state.mode === 'stopwatch' && (isRunning || isPaused || getStopwatchMs() > 0);
    const canResetCd = state.mode === 'countdown' && !isIdle;
    resetBtn.disabled = !(canResetSw || canResetCd);

    const locked = isRunning || isPaused;
    if (tabSwBtn) tabSwBtn.disabled = locked;
    if (tabCdBtn) tabCdBtn.disabled = locked;
    if (sliderEl) sliderEl.disabled = locked;

    root.dataset.status = state.status;
    root.dataset.mode = state.mode;
  }

  function renderTicking() {
    displayEl.textContent = getDisplayText();
    if (state.mode === 'countdown' && progressBarEl && state.cdDuration > 0) {
      const pct = Math.max(0, Math.min(1, 1 - state.cdRemaining / state.cdDuration));
      progressBarEl.style.width = (pct * 100).toFixed(2) + '%';
    }
  }

  // ============================================================
  // 按钮处理
  // ============================================================
  function onStartClick() {
    if (state.status === 'running') return;
    start();
  }

  function onPauseClick() { pause(); }

  function bindLongPress(btn) {
    let pressing  = false;
    let pressStart = 0;
    let rafId     = 0;
    let triggered = false;
    let suppressNextClick = false;

    const cleanup = () => {
      pressing = false;
      cancelAnimationFrame(rafId);
      rafId = 0;
      btn.classList.remove('is-holding');
      if (holdEl) holdEl.style.setProperty('--hold-progress', '0');
    };

    const updateHold = () => {
      if (!pressing) return;
      const elapsed = Date.now() - pressStart;
      const pct = Math.min(1, elapsed / HOLD_MS);
      if (holdEl) holdEl.style.setProperty('--hold-progress', pct.toFixed(3));
      if (pct >= 1 && !triggered) {
        triggered = true;
        suppressNextClick = true;
        cleanup();
        reset();
        return;
      }
      rafId = requestAnimationFrame(updateHold);
    };

    const startPress = (e) => {
      if (btn.disabled) return;
      if (e.type === 'mousedown' && e.button !== 0) return;
      if (pressing) return;
      pressing = true;
      triggered = false;
      pressStart = Date.now();
      btn.classList.add('is-holding');
      rafId = requestAnimationFrame(updateHold);
    };

    const endPress = () => { if (pressing) cleanup(); };

    btn.addEventListener('mousedown', startPress);
    btn.addEventListener('touchstart', startPress, { passive: true });
    btn.addEventListener('mouseup', endPress);
    btn.addEventListener('mouseleave', endPress);
    btn.addEventListener('touchend', endPress);
    btn.addEventListener('touchcancel', endPress);
    window.addEventListener('blur', endPress);

    btn.addEventListener('click', (e) => {
      if (suppressNextClick) {
        suppressNextClick = false;
        e.preventDefault();
        e.stopPropagation();
        return;
      }
      if (btn.disabled) return;
      reset();
    });
  }

  // ============================================================
  // Modal(仅计时跑完用)
  // ============================================================
  function injectModal() {
    const existing = document.querySelector('[data-focus-modal]');
    if (existing) { modalRoot = existing; return; }

    const wrap = document.createElement('div');
    wrap.className = 'focus-modal';
    wrap.setAttribute('data-focus-modal', '');
    wrap.hidden = true;
    wrap.innerHTML = ''
      + '<div class="focus-modal__backdrop" data-focus-modal-close></div>'
      + '<div class="focus-modal__panel" role="dialog" aria-modal="true" aria-labelledby="focus-modal-title">'
      +   '<div class="focus-modal__icon" aria-hidden="true">'
      +     '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">'
      +       '<polyline points="20 6 9 17 4 12"/>'
      +     '</svg>'
      +   '</div>'
      +   '<h3 class="focus-modal__title" id="focus-modal-title">专注完成</h3>'
      +   '<p class="focus-modal__desc" data-focus-modal-desc>—</p>'
      +   '<button type="button" class="focus-modal__btn" data-focus-modal-close>知道了</button>'
      + '</div>';

    document.body.appendChild(wrap);
    modalRoot = wrap;

    modalRoot.querySelectorAll('[data-focus-modal-close]').forEach(el => {
      el.addEventListener('click', hideModal);
    });

    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && modalRoot && !modalRoot.hidden) hideModal();
    });
  }

  function showModal(seconds) {
    if (!modalRoot) return;
    const desc = modalRoot.querySelector('[data-focus-modal-desc]');
    if (desc) {
      const min = Math.round(seconds / 60);
      desc.textContent = '本次专注 ' + min + ' 分钟,继续保持!';
    }
    modalRoot.hidden = false;
    requestAnimationFrame(() => {
      modalRoot.classList.add('is-visible');
    });
  }

  function hideModal() {
    if (!modalRoot) return;
    modalRoot.classList.remove('is-visible');
    setTimeout(() => { modalRoot.hidden = true; }, 240);
  }

  // ============================================================
  // 启动
  // ============================================================
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();