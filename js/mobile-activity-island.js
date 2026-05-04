// Mobile-only status capsule for active music/timer widgets.
(function () {
  'use strict';

  const MOBILE_QUERY = '(max-width: 900px)';
  const ACTIVE_TIMER_STATUSES = new Set(['running', 'paused']);
  const KEY_MUSIC_USED = 'y181_mobile_music_used';
  const KEY_MUSIC_STATE = 'y181_music_state';

  const TEXT = {
    activity: '\u5f53\u524d\u6d3b\u52a8',
    music: '\u97f3\u4e50',
    musicPlaying: '\u64ad\u653e\u4e2d',
    musicPaused: '\u5df2\u6682\u505c',
    playMusic: '\u64ad\u653e\u97f3\u4e50',
    pauseMusic: '\u6682\u505c\u97f3\u4e50',
    previousTrack: '\u4e0a\u4e00\u9996',
    nextTrack: '\u4e0b\u4e00\u9996',
    closeMusic: '\u5173\u95ed\u97f3\u4e50\u80f6\u56ca',
    closeTimer: '\u5173\u95ed\u8ba1\u65f6\u80f6\u56ca',
    closeAll: '\u5168\u90e8\u5173\u95ed',
    more: '\u66f4\u591a\u64cd\u4f5c',
    timerPaused: '\u6682\u505c',
    timerCountdown: '\u8ba1\u65f6',
    timerStopwatch: '\u79d2\u8868',
    startTimer: '\u7ee7\u7eed\u8ba1\u65f6',
    pauseTimer: '\u6682\u505c\u8ba1\u65f6'
  };

  const ICONS = {
    music: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M9 18V5l12-2v13"></path><circle cx="6" cy="18" r="3"></circle><circle cx="18" cy="16" r="3"></circle></svg>',
    timer: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><line x1="10" y1="2" x2="14" y2="2"></line><line x1="12" y1="14" x2="15" y2="11"></line><circle cx="12" cy="14" r="8"></circle></svg>',
    prev: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.3" stroke-linecap="round" stroke-linejoin="round"><polygon points="19 20 9 12 19 4 19 20"></polygon><line x1="5" y1="19" x2="5" y2="5"></line></svg>',
    play: '<svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><polygon points="8 5 19 12 8 19 8 5"></polygon></svg>',
    pause: '<svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><rect x="7" y="5" width="4" height="14" rx="1"></rect><rect x="13" y="5" width="4" height="14" rx="1"></rect></svg>',
    next: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.3" stroke-linecap="round" stroke-linejoin="round"><polygon points="5 4 15 12 5 20 5 4"></polygon><line x1="19" y1="5" x2="19" y2="19"></line></svg>',
    close: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"><line x1="6" y1="6" x2="18" y2="18"></line><line x1="18" y1="6" x2="6" y2="18"></line></svg>'
  };

  const media = window.matchMedia(MOBILE_QUERY);
  const state = {
    dismissed: { music: false, timer: false },
    musicUsed: false,
    lastTimerStatus: 'idle'
  };

  let island;
  let musicItem;
  let timerItem;
  let musicTitleWindowEl;
  let musicTitleEl;
  let musicSubEl;
  let musicToggleBtn;
  let timerLabelEl;
  let timerTimeEl;
  let timerToggleBtn;
  let moreBtn;
  let menuEl;
  let scheduled = false;

  function init() {
    state.musicUsed = inferMusicUsed();
    injectIslandStyles();
    createIsland();
    bindEvents();
    update();
    window.setInterval(update, 1000);
  }

  function createIsland() {
    island = document.querySelector('[data-mobile-activity-island]');
    if (!island) {
      island = document.createElement('div');
      document.body.appendChild(island);
    }

    island.className = 'mobile-activity-island';
    island.setAttribute('data-mobile-activity-island', '');
    island.setAttribute('data-island-version', '2');
    island.setAttribute('role', 'group');
    island.setAttribute('aria-label', TEXT.activity);
    island.innerHTML = ''
      + '<section class="mobile-activity-island__segment mobile-activity-island__segment--music" data-island-panel="music">'
      +   '<button type="button" class="mobile-activity-island__content" data-island-action="music-toggle">'
      +     '<span class="mobile-activity-island__beat" aria-hidden="true"><span></span><span></span><span></span><span></span></span>'
      +     '<span class="mobile-activity-island__body">'
      +       '<span class="mobile-activity-island__title-window" data-island-music-title-window><span class="mobile-activity-island__title-text" data-island-music-title></span></span>'
      +       '<span class="mobile-activity-island__meta" data-island-music-sub></span>'
      +     '</span>'
      +   '</button>'
      +   '<span class="mobile-activity-island__controls">'
      +     '<button type="button" class="mobile-activity-island__control" data-island-action="music-prev" aria-label="' + TEXT.previousTrack + '">' + ICONS.prev + '</button>'
      +     '<button type="button" class="mobile-activity-island__control mobile-activity-island__control--primary" data-island-action="music-toggle" data-island-control="music-toggle"></button>'
      +     '<button type="button" class="mobile-activity-island__control" data-island-action="music-next" aria-label="' + TEXT.nextTrack + '">' + ICONS.next + '</button>'
      +     '<button type="button" class="mobile-activity-island__control mobile-activity-island__control--close" data-island-dismiss="music" aria-label="' + TEXT.closeMusic + '">' + ICONS.close + '</button>'
      +   '</span>'
      + '</section>'
      + '<section class="mobile-activity-island__segment mobile-activity-island__segment--timer" data-island-panel="timer">'
      +   '<button type="button" class="mobile-activity-island__content" data-island-action="timer-toggle">'
      +     '<span class="mobile-activity-island__timer-icon" aria-hidden="true">' + ICONS.timer + '</span>'
      +     '<span class="mobile-activity-island__body mobile-activity-island__body--timer">'
      +       '<span class="mobile-activity-island__meta" data-island-timer-label></span>'
      +       '<span class="mobile-activity-island__time" data-island-timer-time></span>'
      +     '</span>'
      +   '</button>'
      +   '<span class="mobile-activity-island__controls">'
      +     '<button type="button" class="mobile-activity-island__control mobile-activity-island__control--primary" data-island-action="timer-toggle" data-island-control="timer-toggle"></button>'
      +     '<button type="button" class="mobile-activity-island__control mobile-activity-island__control--close" data-island-dismiss="timer" aria-label="' + TEXT.closeTimer + '">' + ICONS.close + '</button>'
      +   '</span>'
      + '</section>'
      + '<button type="button" class="mobile-activity-island__more" data-island-action="menu-toggle" aria-label="' + TEXT.more + '" aria-expanded="false"><span class="mobile-activity-island__more-dots" aria-hidden="true"><span></span><span></span><span></span></span></button>'
      + '<div class="mobile-activity-island__menu" data-island-menu role="menu">'
      +   '<button type="button" data-island-dismiss="music" role="menuitem">' + TEXT.closeMusic + '</button>'
      +   '<button type="button" data-island-dismiss="timer" role="menuitem">' + TEXT.closeTimer + '</button>'
      +   '<button type="button" data-island-dismiss="all" role="menuitem">' + TEXT.closeAll + '</button>'
      + '</div>'
      + '';

    musicItem = island.querySelector('[data-island-panel="music"]');
    timerItem = island.querySelector('[data-island-panel="timer"]');
    musicTitleWindowEl = island.querySelector('[data-island-music-title-window]');
    musicTitleEl = island.querySelector('[data-island-music-title]');
    musicSubEl = island.querySelector('[data-island-music-sub]');
    musicToggleBtn = island.querySelector('[data-island-control="music-toggle"]');
    timerLabelEl = island.querySelector('[data-island-timer-label]');
    timerTimeEl = island.querySelector('[data-island-timer-time]');
    timerToggleBtn = island.querySelector('[data-island-control="timer-toggle"]');
    moreBtn = island.querySelector('[data-island-action="menu-toggle"]');
    menuEl = island.querySelector('[data-island-menu]');
  }

  function injectIslandStyles() {
    let style = document.querySelector('style[data-mobile-activity-runtime-style]');
    if (!style) {
      style = document.createElement('style');
      style.setAttribute('data-mobile-activity-runtime-style', '');
      document.head.appendChild(style);
    }

    style.textContent = `
@media (max-width: 900px) {
  .mobile-activity-island[data-island-version="2"] {
    --island-bg: linear-gradient(135deg, hsla(var(--primary-hue), 92%, 72%, 0.34), var(--glass-bg-strong));
    --island-border: hsla(var(--primary-hue), 80%, 68%, 0.42);
    --island-divider: hsla(var(--primary-hue), 58%, 48%, 0.2);
    --island-text: var(--primary-dark);
    --island-muted: var(--text-muted);
    position: fixed !important;
    top: calc(58px + env(safe-area-inset-top, 0px)) !important;
    left: 50% !important;
    z-index: 80 !important;
    display: flex !important;
    align-items: center !important;
    gap: 0 !important;
    height: 42px !important;
    max-width: calc(100vw - 24px) !important;
    padding: 3px !important;
    color: var(--island-text) !important;
    background: var(--island-bg) !important;
    border: 1px solid var(--island-border) !important;
    border-radius: 999px !important;
    box-shadow: 0 6px 18px rgba(15, 23, 42, 0.1) !important;
    backdrop-filter: blur(var(--glass-blur-strong)) saturate(145%) !important;
    -webkit-backdrop-filter: blur(var(--glass-blur-strong)) saturate(145%) !important;
    opacity: 0 !important;
    visibility: hidden !important;
    pointer-events: none !important;
    overflow: visible !important;
    transform: translateX(-50%) translateY(-8px) !important;
    transition: opacity var(--dur-glass-quick) var(--ease-glass-quick), visibility var(--dur-glass-quick) var(--ease-glass-quick), transform var(--dur-glass) var(--ease-glass), width var(--dur-glass) var(--ease-glass) !important;
  }

  .mobile-activity-island[data-island-version="2"].is-visible {
    opacity: 1 !important;
    visibility: visible !important;
    pointer-events: auto !important;
    transform: translateX(-50%) translateY(0) !important;
  }

  html[data-page="home"] .mobile-activity-island[data-island-version="2"] {
    display: none !important;
  }

  html.has-mobile-activity[data-page]:not([data-page="home"]) main {
    padding-top: calc(var(--page-pad-top) + 52px) !important;
  }

  [data-theme="dark"] .mobile-activity-island[data-island-version="2"] {
    --island-bg: linear-gradient(135deg, hsla(var(--primary-hue), 76%, 50%, 0.36), var(--glass-bg-strong));
    --island-border: hsla(var(--primary-hue), 72%, 62%, 0.38);
    --island-divider: rgba(226, 232, 240, 0.18);
    --island-text: var(--text-main);
    --island-muted: rgba(226, 232, 240, 0.72);
  }

  .mobile-activity-island[data-island-version="2"][data-variant="music"] {
    width: min(330px, calc(100vw - 24px)) !important;
  }

  .mobile-activity-island[data-island-version="2"][data-variant="timer"] {
    width: min(206px, calc(100vw - 24px)) !important;
  }

  .mobile-activity-island[data-island-version="2"][data-layout="dual"] {
    width: min(428px, calc(100vw - 24px)) !important;
  }

  .mobile-activity-island[data-island-version="2"] .mobile-activity-island__segment {
    flex: 1 1 0 !important;
    min-width: 0 !important;
    position: relative !important;
    height: 100% !important;
    display: flex !important;
    align-items: center !important;
    gap: 4px !important;
    margin: 0 !important;
    padding: 0 5px 0 9px !important;
    color: inherit !important;
    background: transparent !important;
    border: 0 !important;
    border-radius: 999px !important;
    box-shadow: none !important;
    overflow: hidden !important;
  }

  .mobile-activity-island[data-island-version="2"] .mobile-activity-island__segment[hidden] {
    display: none !important;
  }

  .mobile-activity-island[data-island-version="2"][data-layout="dual"] .mobile-activity-island__segment--timer {
    flex: 0 0 112px !important;
    justify-content: center !important;
    border-left: 0 !important;
    padding-left: 13px !important;
    padding-right: 7px !important;
  }

  .mobile-activity-island[data-island-version="2"][data-layout="dual"] .mobile-activity-island__segment--timer::before {
    content: "" !important;
    position: absolute !important;
    left: 0 !important;
    top: 50% !important;
    width: 1px !important;
    height: 22px !important;
    background: var(--island-divider) !important;
    border-radius: 999px !important;
    transform: translateY(-50%) !important;
  }

  .mobile-activity-island[data-island-version="2"] .mobile-activity-island__content {
    flex: 1 1 auto !important;
    min-width: 0 !important;
    height: 100% !important;
    display: flex !important;
    align-items: center !important;
    gap: 8px !important;
    margin: 0 !important;
    padding: 0 !important;
    color: inherit !important;
    background: transparent !important;
    border: 0 !important;
    border-radius: 999px !important;
    box-shadow: none !important;
    font: inherit !important;
    text-align: left !important;
    overflow: hidden !important;
    cursor: pointer !important;
    -webkit-tap-highlight-color: transparent !important;
  }

  .mobile-activity-island[data-island-version="2"] .mobile-activity-island__controls {
    flex: 0 0 auto !important;
    display: flex !important;
    align-items: center !important;
    justify-content: center !important;
    gap: 3px !important;
    height: 100% !important;
    line-height: 0 !important;
  }

  .mobile-activity-island[data-island-version="2"] .mobile-activity-island__control {
    flex: 0 0 26px !important;
    width: 26px !important;
    height: 26px !important;
    display: inline-flex !important;
    align-items: center !important;
    justify-content: center !important;
    position: relative !important;
    margin: 0 !important;
    padding: 0 !important;
    color: var(--primary-dark) !important;
    background: hsla(var(--primary-hue), 88%, 72%, 0.22) !important;
    border: 0 !important;
    border-radius: 50% !important;
    box-shadow: none !important;
    font-size: 0 !important;
    line-height: 0 !important;
    cursor: pointer !important;
    overflow: hidden !important;
    -webkit-tap-highlight-color: transparent !important;
  }

  .mobile-activity-island[data-island-version="2"] .mobile-activity-island__control svg {
    flex: 0 0 auto !important;
    width: 13px !important;
    height: 13px !important;
    display: block !important;
    position: absolute !important;
    left: 50% !important;
    top: 50% !important;
    margin: 0 !important;
    pointer-events: none !important;
    transform-origin: 50% 50% !important;
    transform: translate(-50%, -50%) !important;
  }

  .mobile-activity-island[data-island-version="2"] .mobile-activity-island__control[data-icon-state="play"] svg {
    transform: translate(calc(-50% + 0.8px), -50%) !important;
  }

  .mobile-activity-island[data-island-version="2"] .mobile-activity-island__control[data-island-action="music-prev"] svg {
    transform: translate(calc(-50% - 0.4px), -50%) !important;
  }

  .mobile-activity-island[data-island-version="2"] .mobile-activity-island__control[data-island-action="music-next"] svg {
    transform: translate(calc(-50% + 0.4px), -50%) !important;
  }

  .mobile-activity-island[data-island-version="2"] .mobile-activity-island__control--primary {
    color: #fff !important;
    background: var(--primary) !important;
  }

  .mobile-activity-island[data-island-version="2"] .mobile-activity-island__control--close {
    color: var(--island-muted) !important;
    background: transparent !important;
  }

  .mobile-activity-island[data-island-version="2"][data-layout="dual"] .mobile-activity-island__control--close {
    display: none !important;
  }

  .mobile-activity-island[data-island-version="2"] .mobile-activity-island__more {
    flex: 0 0 24px !important;
    width: 24px !important;
    height: 26px !important;
    display: none !important;
    align-items: center !important;
    justify-content: center !important;
    position: relative !important;
    margin: 0 4px 0 0 !important;
    padding: 0 !important;
    color: var(--primary-dark) !important;
    background: hsla(var(--primary-hue), 88%, 72%, 0.22) !important;
    border: 0 !important;
    border-radius: 999px !important;
    box-shadow: none !important;
    font-size: 0 !important;
    line-height: 0 !important;
    cursor: pointer !important;
    overflow: hidden !important;
    -webkit-tap-highlight-color: transparent !important;
  }

  .mobile-activity-island[data-island-version="2"] .mobile-activity-island__more-dots {
    position: absolute !important;
    left: 50% !important;
    top: 50% !important;
    display: flex !important;
    align-items: center !important;
    justify-content: center !important;
    gap: 2.5px !important;
    width: 14px !important;
    height: 6px !important;
    transform: translate(-50%, -50%) !important;
    pointer-events: none !important;
  }

  .mobile-activity-island[data-island-version="2"] .mobile-activity-island__more-dots span {
    flex: 0 0 3px !important;
    width: 3px !important;
    height: 3px !important;
    display: block !important;
    border-radius: 50% !important;
    background: currentColor !important;
  }

  .mobile-activity-island[data-island-version="2"][data-layout="dual"] .mobile-activity-island__more {
    display: flex !important;
  }

  .mobile-activity-island[data-island-version="2"] .mobile-activity-island__menu {
    position: absolute !important;
    top: calc(100% + 7px) !important;
    right: 6px !important;
    z-index: 2 !important;
    width: 130px !important;
    display: none !important;
    flex-direction: column !important;
    gap: 2px !important;
    padding: 6px !important;
    background: var(--glass-bg-strong) !important;
    border: 1px solid var(--island-border) !important;
    border-radius: 12px !important;
    box-shadow: 0 10px 28px rgba(15, 23, 42, 0.16) !important;
    backdrop-filter: blur(var(--glass-blur-strong)) saturate(145%) !important;
    -webkit-backdrop-filter: blur(var(--glass-blur-strong)) saturate(145%) !important;
  }

  .mobile-activity-island[data-island-version="2"].is-menu-open .mobile-activity-island__menu {
    display: flex !important;
  }

  .mobile-activity-island[data-island-version="2"] .mobile-activity-island__menu button {
    width: 100% !important;
    min-height: 30px !important;
    display: flex !important;
    align-items: center !important;
    justify-content: flex-start !important;
    margin: 0 !important;
    padding: 0 9px !important;
    color: var(--island-text) !important;
    background: transparent !important;
    border: 0 !important;
    border-radius: 8px !important;
    font: inherit !important;
    font-size: 12px !important;
    font-weight: 650 !important;
    text-align: left !important;
    cursor: pointer !important;
  }

  .mobile-activity-island[data-island-version="2"] .mobile-activity-island__menu button:hover {
    background: hsla(var(--primary-hue), 88%, 72%, 0.18) !important;
  }

  .mobile-activity-island[data-island-version="2"] .mobile-activity-island__beat {
    flex: 0 0 22px !important;
    width: 22px !important;
    height: 20px !important;
    display: flex !important;
    align-items: flex-end !important;
    justify-content: center !important;
    gap: 2px !important;
    color: var(--primary) !important;
  }

  .mobile-activity-island[data-island-version="2"] .mobile-activity-island__beat span {
    width: 3px !important;
    min-height: 5px !important;
    border-radius: 999px !important;
    background: currentColor !important;
    transform-origin: center bottom !important;
    animation: mobileActivityBeat 0.72s ease-in-out infinite !important;
  }

  .mobile-activity-island[data-island-version="2"] .mobile-activity-island__beat span:nth-child(1) { height: 9px !important; animation-delay: -0.18s !important; }
  .mobile-activity-island[data-island-version="2"] .mobile-activity-island__beat span:nth-child(2) { height: 16px !important; animation-delay: -0.34s !important; }
  .mobile-activity-island[data-island-version="2"] .mobile-activity-island__beat span:nth-child(3) { height: 12px !important; animation-delay: -0.08s !important; }
  .mobile-activity-island[data-island-version="2"] .mobile-activity-island__beat span:nth-child(4) { height: 14px !important; animation-delay: -0.24s !important; }

  .mobile-activity-island[data-island-version="2"] .mobile-activity-island__segment--music[data-state="paused"] .mobile-activity-island__beat span {
    animation-play-state: paused !important;
    opacity: 0.55 !important;
  }

  .mobile-activity-island[data-island-version="2"] .mobile-activity-island__body {
    flex: 1 1 auto !important;
    min-width: 0 !important;
    display: flex !important;
    flex-direction: column !important;
    justify-content: center !important;
    line-height: 1.1 !important;
  }

  .mobile-activity-island[data-island-version="2"] .mobile-activity-island__title-window,
  .mobile-activity-island[data-island-version="2"] .mobile-activity-island__title-text,
  .mobile-activity-island[data-island-version="2"] .mobile-activity-island__meta,
  .mobile-activity-island[data-island-version="2"] .mobile-activity-island__time {
    display: block !important;
    min-width: 0 !important;
    max-width: 100% !important;
    overflow: hidden !important;
    text-overflow: ellipsis !important;
    white-space: nowrap !important;
    letter-spacing: 0 !important;
  }

  .mobile-activity-island[data-island-version="2"] .mobile-activity-island__title-window {
    position: relative !important;
  }

  .mobile-activity-island[data-island-version="2"] .mobile-activity-island__title-text {
    width: max-content !important;
    max-width: none !important;
  }

  .mobile-activity-island[data-island-version="2"] .mobile-activity-island__title-window.is-marquee .mobile-activity-island__title-text {
    animation: mobileActivityMarquee var(--marquee-duration, 8s) ease-in-out infinite alternate !important;
  }

  .mobile-activity-island[data-island-version="2"] .mobile-activity-island__title-text,
  .mobile-activity-island[data-island-version="2"] .mobile-activity-island__time {
    color: var(--island-text) !important;
    font-size: 12px !important;
    font-weight: 750 !important;
    font-variant-numeric: tabular-nums !important;
  }

  .mobile-activity-island[data-island-version="2"] .mobile-activity-island__meta {
    margin-top: 2px !important;
    color: var(--island-muted) !important;
    font-size: 9px !important;
    font-weight: 650 !important;
  }

  .mobile-activity-island[data-island-version="2"] .mobile-activity-island__timer-icon {
    flex: 0 0 18px !important;
    width: 18px !important;
    height: 18px !important;
    display: flex !important;
    color: var(--primary) !important;
  }

  .mobile-activity-island[data-island-version="2"] .mobile-activity-island__timer-icon svg {
    width: 18px !important;
    height: 18px !important;
    display: block !important;
  }

  .mobile-activity-island[data-island-version="2"][data-layout="dual"] .mobile-activity-island__segment--music .mobile-activity-island__meta,
  .mobile-activity-island[data-island-version="2"][data-layout="dual"] .mobile-activity-island__segment--timer .mobile-activity-island__meta,
  .mobile-activity-island[data-island-version="2"][data-layout="dual"] .mobile-activity-island__timer-icon {
    display: none !important;
  }

  .mobile-activity-island[data-island-version="2"][data-layout="dual"] .mobile-activity-island__body--timer {
    align-items: center !important;
  }

  @media (max-width: 380px) {
    .mobile-activity-island[data-island-version="2"][data-layout="dual"] {
      width: calc(100vw - 18px) !important;
    }

    .mobile-activity-island[data-island-version="2"][data-layout="dual"] .mobile-activity-island__segment--timer {
      flex-basis: 112px !important;
    }
  }

  @keyframes mobileActivityMarquee {
    from { transform: translateX(0); }
    to { transform: translateX(var(--marquee-distance, -32px)); }
  }

  @keyframes mobileActivityBeat {
    0%, 100% { transform: scaleY(0.42); }
    45% { transform: scaleY(1); }
    70% { transform: scaleY(0.66); }
  }
}`;
  }

  function bindEvents() {
    island.addEventListener('click', (event) => {
      const dismissTarget = event.target.closest('[data-island-dismiss]')?.dataset.islandDismiss;
      if (dismissTarget) {
        dismissPanel(dismissTarget);
        return;
      }

      const action = event.target.closest('[data-island-action]')?.dataset.islandAction;
      if (action === 'menu-toggle') {
        toggleMenu();
        return;
      }
      if (action === 'music-prev') clickWidgetButton('[data-music-act="prev"]');
      if (action === 'music-toggle') toggleMusic();
      if (action === 'music-next') clickWidgetButton('[data-music-act="next"]');
      if (action === 'timer-toggle') toggleTimer();
    });

    document.addEventListener('click', (event) => {
      if (!island.contains(event.target)) closeMenu();
    });

    document.addEventListener('keydown', (event) => {
      if (event.key === 'Escape') closeMenu();
    });

    const audio = document.getElementById('music-audio');
    if (audio) {
      audio.addEventListener('play', () => {
        markMusicUsed();
        state.dismissed.music = false;
        scheduleUpdate();
      });

      ['pause', 'ended', 'emptied', 'loadedmetadata', 'timeupdate'].forEach((eventName) => {
        audio.addEventListener(eventName, scheduleUpdate);
      });
    }

    const timerRoot = document.querySelector('.rail-widget--timer');
    if (timerRoot && typeof MutationObserver === 'function') {
      new MutationObserver(scheduleUpdate).observe(timerRoot, {
        attributes: true,
        attributeFilter: ['data-status', 'data-mode']
      });
    }

    const musicRoot = document.querySelector('.rail-widget--music');
    if (musicRoot && typeof MutationObserver === 'function') {
      new MutationObserver(scheduleUpdate).observe(musicRoot, {
        attributes: true,
        childList: true,
        characterData: true,
        subtree: true,
        attributeFilter: ['data-status']
      });
    }

    window.addEventListener('y181:pagechange', scheduleUpdate);
    window.addEventListener('locationchange', scheduleUpdate);
    window.addEventListener('popstate', scheduleUpdate);
    window.addEventListener('resize', scheduleUpdate);

    if (typeof media.addEventListener === 'function') {
      media.addEventListener('change', scheduleUpdate);
    } else if (typeof media.addListener === 'function') {
      media.addListener(scheduleUpdate);
    }
  }

  function scheduleUpdate() {
    if (scheduled) return;
    scheduled = true;
    requestAnimationFrame(() => {
      scheduled = false;
      update();
    });
  }

  function getCurrentPage() {
    return document.documentElement.dataset.page
      || new URLSearchParams(window.location.search).get('page')
      || 'home';
  }

  function inferMusicUsed() {
    try {
      if (sessionStorage.getItem(KEY_MUSIC_USED) === '1') return true;
    } catch (_) {}
    try {
      const saved = JSON.parse(localStorage.getItem(KEY_MUSIC_STATE) || 'null');
      return Boolean(saved && (saved.isPlaying || saved.currentTime > 0));
    } catch (_) {
      return false;
    }
  }

  function markMusicUsed() {
    state.musicUsed = true;
    try { sessionStorage.setItem(KEY_MUSIC_USED, '1'); } catch (_) {}
  }

  function getMusicState() {
    const root = document.querySelector('.rail-widget--music');
    const audio = document.getElementById('music-audio');
    if (!root || !audio) return { active: false };

    const isPlaying = root.dataset.status === 'playing'
      || (!audio.paused && !audio.ended && Boolean(audio.currentSrc || audio.src));
    if (!isPlaying && !state.musicUsed) return { active: false };

    const title = root.querySelector('[data-music-title]')?.textContent.trim() || TEXT.music;
    const artist = root.querySelector('[data-music-artist]')?.textContent.trim() || '';

    return {
      active: true,
      isPlaying,
      title,
      artist
    };
  }

  function getTimerState() {
    const root = document.querySelector('.rail-widget--timer');
    if (!root) return { active: false };

    const status = root.dataset.status || 'idle';
    if (!ACTIVE_TIMER_STATUSES.has(status)) return { active: false, status };

    const mode = root.dataset.mode || 'stopwatch';
    const display = root.querySelector('[data-timer-display]')?.textContent.trim() || '00:00';
    const label = status === 'paused'
      ? TEXT.timerPaused
      : (mode === 'countdown' ? TEXT.timerCountdown : TEXT.timerStopwatch);

    return {
      active: true,
      status,
      label,
      display
    };
  }

  function update() {
    const music = getMusicState();
    const timer = getTimerState();
    const page = getCurrentPage();

    if (timer.active && timer.status === 'running' && state.lastTimerStatus !== 'running') {
      state.dismissed.timer = false;
    }
    state.lastTimerStatus = timer.status || 'idle';

    const showMusic = music.active && !state.dismissed.music;
    const showTimer = timer.active && !state.dismissed.timer;
    const visible = media.matches && page !== 'home' && (showMusic || showTimer);

    document.documentElement.classList.toggle('has-mobile-activity', visible);
    island.classList.toggle('is-visible', visible);

    if (!visible) {
      island.setAttribute('aria-hidden', 'true');
      closeMenu();
      return;
    }

    const isDual = showMusic && showTimer;
    island.dataset.layout = isDual ? 'dual' : 'single';
    island.dataset.variant = isDual ? 'both' : (showMusic ? 'music' : 'timer');
    island.setAttribute('aria-hidden', 'false');
    if (!isDual) closeMenu();

    musicItem.hidden = !showMusic;
    timerItem.hidden = !showTimer;
    if (!showMusic) delete musicItem.dataset.state;
    if (!showTimer) delete timerItem.dataset.state;

    if (showMusic) {
      musicItem.dataset.state = music.isPlaying ? 'playing' : 'paused';
      musicItem.setAttribute('aria-label', (music.isPlaying ? TEXT.musicPlaying : TEXT.musicPaused) + ': ' + music.title);
      musicTitleEl.textContent = music.title;
      musicSubEl.textContent = music.isPlaying
        ? (music.artist || TEXT.musicPlaying)
        : TEXT.musicPaused;
      musicToggleBtn.innerHTML = music.isPlaying ? ICONS.pause : ICONS.play;
      musicToggleBtn.dataset.iconState = music.isPlaying ? 'pause' : 'play';
      musicToggleBtn.setAttribute('aria-label', music.isPlaying ? TEXT.pauseMusic : TEXT.playMusic);
      updateTitleMarquee();
    }

    if (showTimer) {
      timerItem.dataset.state = timer.status;
      timerItem.setAttribute('aria-label', timer.label + ' ' + timer.display);
      timerLabelEl.textContent = timer.label;
      timerTimeEl.textContent = timer.display;
      timerToggleBtn.innerHTML = timer.status === 'running' ? ICONS.pause : ICONS.play;
      timerToggleBtn.dataset.iconState = timer.status === 'running' ? 'pause' : 'play';
      timerToggleBtn.setAttribute('aria-label', timer.status === 'running' ? TEXT.pauseTimer : TEXT.startTimer);
    }
  }

  function updateTitleMarquee() {
    if (!musicTitleWindowEl || !musicTitleEl) return;
    requestAnimationFrame(() => {
      const overflow = Math.ceil(musicTitleEl.scrollWidth - musicTitleWindowEl.clientWidth);
      const shouldScroll = overflow > 4;
      musicTitleWindowEl.classList.toggle('is-marquee', shouldScroll);
      musicTitleEl.style.setProperty('--marquee-distance', shouldScroll ? (-overflow + 'px') : '0px');
      musicTitleEl.style.setProperty('--marquee-duration', Math.max(6, Math.min(14, overflow / 12 + 5)).toFixed(1) + 's');
    });
  }

  function toggleMenu() {
    const open = !island.classList.contains('is-menu-open');
    island.classList.toggle('is-menu-open', open);
    moreBtn?.setAttribute('aria-expanded', open ? 'true' : 'false');
  }

  function closeMenu() {
    if (!island) return;
    island.classList.remove('is-menu-open');
    moreBtn?.setAttribute('aria-expanded', 'false');
  }

  function clickWidgetButton(selector) {
    const button = document.querySelector(selector);
    if (!button || button.disabled) return;
    button.click();
    scheduleUpdate();
  }

  function toggleMusic() {
    markMusicUsed();
    state.dismissed.music = false;
    clickWidgetButton('[data-music-act="play"]');
  }

  function toggleTimer() {
    const root = document.querySelector('.rail-widget--timer');
    if (!root) return;
    state.dismissed.timer = false;
    const selector = root.dataset.status === 'running'
      ? '[data-timer-act="pause"]'
      : '[data-timer-act="start"]';
    clickWidgetButton(selector);
  }

  function dismissPanel(panel) {
    closeMenu();
    if (panel === 'all') {
      state.dismissed.music = true;
      state.dismissed.timer = true;
      scheduleUpdate();
      return;
    }
    if (panel === 'music' || panel === 'timer') {
      state.dismissed[panel] = true;
      scheduleUpdate();
    }
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init, { once: true });
  } else {
    init();
  }
})();
