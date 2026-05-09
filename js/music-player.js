/**
 * 随心听音乐播放器 —— Phase C Commit 3
 * - 5 控件:loop(三态:顺序 / 随机 / 单曲循环) / prev / play / next / playlist
 * - LRC 时间戳同步歌词,无时间戳 fallback 静态显示
 * - audio 挂 <body> 顶层,SPA 切页不重建;hard nav 时 pagehide 持久化位置
 * - 首次进站不 autoplay;state 里 isPlaying=true 也用 .play().catch() 优雅降级
 *
 * 持久化 key:
 *   y181_music_state          { trackIndex, currentTime, isPlaying }
 *   y181_music_loop            'sequential' | 'shuffle' | 'one'
 *   y181_music_lyrics_visible  '1' | '0'
 */
(function () {
  'use strict';

  // ---- 常量 ----
  const KEY_STATE   = 'y181_music_state';
  const KEY_LOOP    = 'y181_music_loop';
  const KEY_LYRICS  = 'y181_music_lyrics_visible';
  const SITE_ROOT_URL = getSiteRootUrl();
  const PLAYLIST_URL = new URL('data/playlist.json', SITE_ROOT_URL).href;
  const LOOP_MODES  = ['sequential', 'shuffle', 'one'];
  const DEFAULT_LOOP = 'sequential';

  // ---- 状态 ----
  const state = {
    tracks: [],
    currentIndex: -1,
    loopMode: DEFAULT_LOOP,
    lyricsVisible: false,
    parsedLyrics: [],   // [{ time: number(秒), text: string }] 或 [] 表示纯文本
    plainLyric: '',
    activeLyricIdx: -1,
    playlistQuery: '',
    pendingTrackRequest: null,
  };

  // ---- DOM ----
  let audio, root,
      titleEl, artistEl, coverEl,
      progressEl, progressBarEl, timeCurEl, timeTotEl,
      loopBtn, prevBtn, playBtn, nextBtn, playlistBtn,
      lyricsToggleBtn, lyricsEl, lyricsInnerEl,
      modalEl, modalListEl, modalCountEl, modalSearchEl, modalEmptyEl;

  function getSiteRootUrl() {
    const script = document.currentScript
      || document.querySelector('script[src$="music-player.js"]');
    return script?.src ? new URL('../', script.src) : new URL('./', document.baseURI);
  }

  function resolveSiteUrl(path) {
    return new URL(path, SITE_ROOT_URL).href;
  }

  // ============================================================
  // 入口
  // ============================================================
  function init() {
    audio = document.getElementById('music-audio');
    root  = document.querySelector('.rail-widget--music');
    if (!audio || !root) return;

    titleEl   = root.querySelector('[data-music-title]');
    artistEl  = root.querySelector('[data-music-artist]');
    coverEl   = root.querySelector('[data-music-cover]');
    progressEl    = root.querySelector('[data-music-progress]');
    progressBarEl = root.querySelector('[data-music-progress-bar]');
    timeCurEl = root.querySelector('[data-music-time-current]');
    timeTotEl = root.querySelector('[data-music-time-total]');
    loopBtn   = root.querySelector('[data-music-act="loop"]');
    prevBtn   = root.querySelector('[data-music-act="prev"]');
    playBtn   = root.querySelector('[data-music-act="play"]');
    nextBtn   = root.querySelector('[data-music-act="next"]');
    playlistBtn = root.querySelector('[data-music-act="playlist"]');
    lyricsToggleBtn = root.querySelector('[data-music-lyrics-toggle]');
    lyricsEl  = root.querySelector('[data-music-lyrics]');
    lyricsInnerEl = root.querySelector('[data-music-lyrics-inner]');
    modalEl   = document.querySelector('[data-music-modal]');
    modalListEl  = modalEl?.querySelector('[data-music-modal-list]');
    modalCountEl = modalEl?.querySelector('[data-music-modal-count]');
    modalSearchEl = modalEl?.querySelector('[data-music-modal-search]');
    modalEmptyEl = modalEl?.querySelector('[data-music-modal-empty]');

    bindEvents();
    restoreLoop();
    restoreLyricsToggle();
    loadPlaylist();
  }

  // ============================================================
  // 加载歌单
  // ============================================================
  async function loadPlaylist() {
    try {
      const res = await fetch(PLAYLIST_URL, { cache: 'no-cache' });
      if (!res.ok) throw new Error('playlist fetch failed: ' + res.status);
      const data = await res.json();
      const tracks = Array.isArray(data) ? data : data.tracks;
      if (!Array.isArray(tracks) || tracks.length === 0) {
        console.warn('[music] playlist 为空,跳过');
        return;
      }
      state.tracks = tracks;
      enableControls();
      renderPlaylistModal();
      restorePlayback();
      playPendingTrackRequest();
    } catch (err) {
      console.warn('[music] 加载歌单失败:', err);
    }
  }

  function enableControls() {
    prevBtn.disabled = false;
    playBtn.disabled = false;
    nextBtn.disabled = false;
  }

  // ============================================================
  // 状态恢复(首次进站不 autoplay,后续刷新尝试恢复)
  // ============================================================
  function restorePlayback() {
    let saved = null;
    try { saved = JSON.parse(localStorage.getItem(KEY_STATE) || 'null'); } catch (_) {}

    const idx = (saved && Number.isInteger(saved.trackIndex) && saved.trackIndex >= 0 && saved.trackIndex < state.tracks.length)
      ? saved.trackIndex
      : 0;

    loadTrack(idx, false);

    if (saved && Number.isFinite(saved.currentTime) && saved.currentTime > 0) {
      // 等 metadata 加载好再 seek,避免 race
      audio.addEventListener('loadedmetadata', function once() {
        audio.removeEventListener('loadedmetadata', once);
        try { audio.currentTime = saved.currentTime; } catch (_) {}
      });
    }

    // isPlaying=true 时尝试恢复播放,被浏览器拦截就退化为暂停
    if (saved && saved.isPlaying) {
      const tryPlay = () => audio.play().catch(() => {
        updatePlayingState(false);
      });
      if (audio.readyState >= 2) tryPlay();
      else audio.addEventListener('canplay', function once() {
        audio.removeEventListener('canplay', once);
        tryPlay();
      });
    }
  }

  function restoreLoop() {
    const saved = localStorage.getItem(KEY_LOOP);
    // 旧值 'all' / 'none' 一律 fallback 到默认
    state.loopMode = LOOP_MODES.includes(saved) ? saved : DEFAULT_LOOP;
    applyLoopUI();
  }

  function restoreLyricsToggle() {
    state.lyricsVisible = localStorage.getItem(KEY_LYRICS) === '1';
    applyLyricsToggle();
  }

  // ============================================================
  // 当前曲目
  // ============================================================
  function loadTrack(index, autoplay) {
    if (index < 0 || index >= state.tracks.length) return;
    const track = state.tracks[index];
    state.currentIndex = index;

    audio.src = resolveSiteUrl(track.src);
    titleEl.textContent  = track.title || '未命名';
    artistEl.textContent = track.artist || '—';
    renderCover(track);
    parseLyric(track.lyric);
    renderLyrics();
    updatePlaylistModalActive();
    persistState();

    if (autoplay) {
      audio.play().catch((err) => {
        console.warn('[music] 自动播放被拦截:', err);
        updatePlayingState(false);
      });
    }
  }

  function renderCover(track) {
    if (!coverEl) return;

    const cover = track?.cover;
    let img = coverEl.querySelector('.music-cover__image');

    if (!cover) {
      coverEl.classList.remove('has-cover');
      if (img) {
        img.hidden = true;
        img.removeAttribute('src');
      }
      return;
    }

    if (!img) {
      img = document.createElement('img');
      img.className = 'music-cover__image';
      img.alt = '';
      img.decoding = 'async';
      img.loading = 'eager';
      coverEl.appendChild(img);
    }

    const nextSrc = resolveSiteUrl(cover);
    if (img.src === nextSrc && img.complete && img.naturalWidth > 0) {
      img.hidden = false;
      coverEl.classList.add('has-cover');
      return;
    }

    coverEl.classList.remove('has-cover');
    img.onload = () => {
      img.hidden = false;
      coverEl.classList.add('has-cover');
    };
    img.onerror = () => {
      img.hidden = true;
      coverEl.classList.remove('has-cover');
    };

    img.hidden = true;
    img.src = nextSrc;
  }

  function getRequestedTrackIndex(detail) {
    if (!detail || state.tracks.length === 0) return -1;

    if (detail.id) {
      const idx = state.tracks.findIndex((track) => track.id === detail.id);
      if (idx >= 0) return idx;
    }

    if (Number.isInteger(detail.index) && detail.index >= 0 && detail.index < state.tracks.length) {
      return detail.index;
    }

    if (detail.title) {
      return state.tracks.findIndex((track) => track.title === detail.title);
    }

    return -1;
  }

  function playRequestedTrack(detail) {
    const idx = getRequestedTrackIndex(detail);
    if (idx < 0) {
      state.pendingTrackRequest = detail;
      return;
    }

    state.pendingTrackRequest = null;
    loadTrack(idx, true);
    if (detail?.revealPlaylist) {
      revealPlaylistTrack(idx);
      return;
    }

    root?.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  }

  function playPendingTrackRequest() {
    if (!state.pendingTrackRequest) return;
    playRequestedTrack(state.pendingTrackRequest);
  }

  function prevTrack() {
    if (state.tracks.length === 0) return;
    let idx = state.currentIndex - 1;
    if (idx < 0) idx = state.tracks.length - 1;
    loadTrack(idx, !audio.paused);
  }

  // ============================================================
  // 播放控制
  // ============================================================
  function togglePlay() {
    if (state.currentIndex < 0 && state.tracks.length > 0) {
      loadTrack(0, true);
      return;
    }
    if (audio.paused) audio.play().catch((err) => console.warn('[music] play failed:', err));
    else audio.pause();
  }

  function toggleLoop() {
    const cur = LOOP_MODES.indexOf(state.loopMode);
    state.loopMode = LOOP_MODES[(cur + 1) % LOOP_MODES.length];
    localStorage.setItem(KEY_LOOP, state.loopMode);
    applyLoopUI();
  }

  function applyLoopUI() {
    loopBtn.dataset.loopMode = state.loopMode;
    audio.loop = (state.loopMode === 'one');  // 单曲循环交给浏览器
    const labels = {
      sequential: '顺序播放',
      shuffle:    '随机播放',
      one:        '单曲循环',
    };
    loopBtn.setAttribute('aria-label', '循环模式:' + labels[state.loopMode]);
  }

  function nextTrack(force) {
    if (state.tracks.length === 0) return;

    // 随机:不与当前重复
    if (state.loopMode === 'shuffle') {
      if (state.tracks.length === 1) { loadTrack(0, true); return; }
      let idx;
      do { idx = Math.floor(Math.random() * state.tracks.length); }
      while (idx === state.currentIndex);
      loadTrack(idx, true);
      return;
    }

    let idx = state.currentIndex + 1;
    if (idx >= state.tracks.length) {
      idx = 0;
    }
    loadTrack(idx, true);
  }

  // ============================================================
  // 歌词:LRC 解析 + 同步
  // ============================================================
  function parseLyric(raw) {
    state.parsedLyrics = [];
    state.plainLyric = '';
    state.activeLyricIdx = -1;
    if (!raw || typeof raw !== 'string') return;

    const lines = raw.split(/\r?\n/);
    const tsRe = /\[(\d{1,2}):(\d{1,2})(?:\.(\d{1,3}))?\]/g;
    const out = [];

    for (const line of lines) {
      tsRe.lastIndex = 0;
      const matches = [...line.matchAll(tsRe)];
      if (matches.length === 0) continue;
      const text = line.replace(tsRe, '').trim();
      if (!text) continue;
      for (const m of matches) {
        const min = parseInt(m[1], 10);
        const sec = parseInt(m[2], 10);
        const ms  = m[3] ? parseInt(m[3].padEnd(3, '0').slice(0, 3), 10) : 0;
        out.push({ time: min * 60 + sec + ms / 1000, text });
      }
    }

    if (out.length > 0) {
      out.sort((a, b) => a.time - b.time);
      state.parsedLyrics = out;
    } else {
      // 无时间戳:作为静态文本
      state.plainLyric = raw.trim();
    }
  }

  function renderLyrics() {
    if (!lyricsInnerEl) return;
    lyricsInnerEl.innerHTML = '';

    if (state.parsedLyrics.length > 0) {
      const frag = document.createDocumentFragment();
      state.parsedLyrics.forEach((line, i) => {
        const p = document.createElement('p');
        p.className = 'music-lyrics__line';
        p.dataset.idx = i;
        p.textContent = line.text;
        frag.appendChild(p);
      });
      lyricsInnerEl.appendChild(frag);
    } else if (state.plainLyric) {
      state.plainLyric.split(/\n+/).forEach((t) => {
        const p = document.createElement('p');
        p.textContent = t;
        lyricsInnerEl.appendChild(p);
      });
    } else {
      const hint = document.createElement('p');
      hint.className = 'music-lyrics__hint';
      hint.textContent = '暂无歌词';
      lyricsInnerEl.appendChild(hint);
    }
  }

  function syncLyric(currentTime) {
    if (state.parsedLyrics.length === 0) return;
    let idx = -1;
    for (let i = 0; i < state.parsedLyrics.length; i++) {
      if (state.parsedLyrics[i].time <= currentTime) idx = i;
      else break;
    }
    if (idx === state.activeLyricIdx) return;
    state.activeLyricIdx = idx;

    const lines = lyricsInnerEl.querySelectorAll('.music-lyrics__line');
    lines.forEach((el, i) => el.classList.toggle('is-active', i === idx));

    if (state.lyricsVisible && idx >= 0 && lines[idx]) {
      const containerH = lyricsInnerEl.clientHeight;
      const lineTop = lines[idx].offsetTop;
      const lineH   = lines[idx].offsetHeight;
      lyricsInnerEl.scrollTo({
        top: lineTop - containerH / 2 + lineH / 2,
        behavior: 'smooth',
      });
    }
  }

  function applyLyricsToggle() {
    lyricsEl.hidden = !state.lyricsVisible;
    lyricsToggleBtn.setAttribute('aria-pressed', state.lyricsVisible ? 'true' : 'false');
    lyricsToggleBtn.classList.toggle('is-active', state.lyricsVisible);
  }

  // ============================================================
  // 歌单浮层
  // ============================================================
  function renderPlaylistCover(track) {
    const cover = track?.cover;
    if (cover) {
      return `
        <span class="music-modal__cover" aria-hidden="true">
          <img src="${escapeHtml(resolveSiteUrl(cover))}" alt="" loading="lazy" decoding="async">
        </span>
      `;
    }

    return `
      <span class="music-modal__cover music-modal__cover--empty" aria-hidden="true">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
          <path d="M9 18V5l12-2v13"></path>
          <circle cx="6" cy="18" r="3"></circle>
          <circle cx="18" cy="16" r="3"></circle>
        </svg>
      </span>
    `;
  }

  function renderPlaylistModal() {
    if (!modalListEl) return;
    modalListEl.innerHTML = '';
    const frag = document.createDocumentFragment();
    state.tracks.forEach((track, i) => {
      const title = track.title || '未命名';
      const artist = track.artist || '—';
      const li = document.createElement('li');
      li.dataset.idx = i;
      li.dataset.search = normalizeSearchText(`${title} ${artist}`);
      li.innerHTML = `
        <span class="music-modal__index">${String(i + 1).padStart(2, '0')}</span>
        ${renderPlaylistCover(track)}
        <div class="music-modal__info">
          <span class="music-modal__name">${escapeHtml(title)}</span>
          <span class="music-modal__sub">${escapeHtml(artist)}</span>
        </div>
        <span class="music-modal__playing" aria-hidden="true">
          <svg viewBox="0 0 24 24" fill="currentColor"><rect x="4"  y="10" width="3" height="10" rx="1"><animate attributeName="height" values="4;14;4" dur="0.8s" repeatCount="indefinite"/><animate attributeName="y" values="14;6;14" dur="0.8s" repeatCount="indefinite"/></rect><rect x="10" y="6"  width="3" height="14" rx="1"><animate attributeName="height" values="14;4;14" dur="0.8s" repeatCount="indefinite"/><animate attributeName="y" values="6;14;6"  dur="0.8s" repeatCount="indefinite"/></rect><rect x="16" y="10" width="3" height="10" rx="1"><animate attributeName="height" values="10;4;10" dur="0.6s" repeatCount="indefinite"/><animate attributeName="y" values="10;14;10" dur="0.6s" repeatCount="indefinite"/></rect></svg>
        </span>
      `;
      li.addEventListener('click', () => {
        loadTrack(i, true);
        closeModal();
      });
      frag.appendChild(li);
    });
    modalListEl.appendChild(frag);
    applyPlaylistSearch();
    updatePlaylistModalActive();
  }

  function updatePlaylistModalActive() {
    if (!modalListEl) return;
    modalListEl.querySelectorAll('li').forEach((li) => {
      li.classList.toggle('is-current', Number(li.dataset.idx) === state.currentIndex);
    });
  }

  function scrollPlaylistItemIntoView(index) {
    const currentItem = modalListEl?.querySelector(`li[data-idx="${index}"]`);
    if (!currentItem || currentItem.hidden) return;

    currentItem.scrollIntoView({ behavior: 'smooth', block: 'center' });
  }

  function revealPlaylistTrack(index) {
    if (!modalEl || !modalListEl) return;

    clearPlaylistSearch();
    updatePlaylistModalActive();
    openModal();

    requestAnimationFrame(() => {
      requestAnimationFrame(() => scrollPlaylistItemIntoView(index));
    });
  }

  function normalizeSearchText(value) {
    return String(value || '').normalize('NFKC').toLowerCase();
  }

  function updatePlaylistModalCount(visibleCount) {
    if (!modalCountEl) return;
    const total = state.tracks.length;
    const query = state.playlistQuery.trim();
    modalCountEl.textContent = query ? `${visibleCount} / ${total} 首` : `${total} 首`;
  }

  function applyPlaylistSearch() {
    if (!modalListEl) {
      updatePlaylistModalCount(state.tracks.length);
      return;
    }

    const query = normalizeSearchText(state.playlistQuery);
    let visibleCount = 0;
    modalListEl.querySelectorAll('li').forEach((li) => {
      const isMatch = !query || (li.dataset.search || '').includes(query);
      li.hidden = !isMatch;
      if (isMatch) visibleCount += 1;
    });

    if (modalEmptyEl) {
      modalEmptyEl.hidden = visibleCount > 0 || state.tracks.length === 0;
    }
    updatePlaylistModalCount(visibleCount);
  }

  function clearPlaylistSearch() {
    state.playlistQuery = '';
    if (modalSearchEl) modalSearchEl.value = '';
    applyPlaylistSearch();
  }

  function openModal() {
    if (!modalEl) return;
    modalEl.hidden = false;
    modalEl.setAttribute('aria-hidden', 'false');
    applyPlaylistSearch();
    modalEl.classList.add('is-visible');
    requestAnimationFrame(() => {
      modalSearchEl?.focus({ preventScroll: true });
    });
  }

  function closeModal() {
    if (!modalEl) return;
    modalEl.classList.remove('is-visible');
    setTimeout(() => {
      modalEl.hidden = true;
      modalEl.setAttribute('aria-hidden', 'true');
      clearPlaylistSearch();
    }, 240);
  }

  // ============================================================
  // UI 更新
  // ============================================================
  function updatePlayingState(isPlaying) {
    root.dataset.status = isPlaying ? 'playing' : 'idle';
    playBtn.setAttribute('aria-label', isPlaying ? '暂停' : '播放');
    persistState();
  }

  function updateProgress() {
    const dur = audio.duration;
    const cur = audio.currentTime;
    if (Number.isFinite(dur) && dur > 0) {
      const pct = (cur / dur) * 100;
      progressBarEl.style.width = pct + '%';
      progressEl.setAttribute('aria-valuenow', String(Math.round(pct)));
    }
    timeCurEl.textContent = formatTime(cur);
    timeTotEl.textContent = formatTime(dur);
    syncLyric(cur);
  }

  function formatTime(s) {
    if (!Number.isFinite(s) || s < 0) return '0:00';
    const m = Math.floor(s / 60);
    const ss = Math.floor(s % 60).toString().padStart(2, '0');
    return `${m}:${ss}`;
  }

  function escapeHtml(str) {
    return String(str).replace(/[&<>"']/g, (c) => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;' }[c]));
  }

  // ============================================================
  // 持久化
  // ============================================================
  function persistState() {
    try {
      localStorage.setItem(KEY_STATE, JSON.stringify({
        trackIndex: state.currentIndex,
        currentTime: audio.currentTime || 0,
        isPlaying: !audio.paused,
      }));
    } catch (_) {}
  }

  // ============================================================
  // 事件绑定
  // ============================================================
  function bindEvents() {
    // 控制按钮
    loopBtn.addEventListener('click', toggleLoop);
    prevBtn.addEventListener('click', prevTrack);
    playBtn.addEventListener('click', togglePlay);
    nextBtn.addEventListener('click', () => nextTrack(true));
    playlistBtn.addEventListener('click', openModal);

    // 歌词 toggle
    lyricsToggleBtn.addEventListener('click', () => {
      state.lyricsVisible = !state.lyricsVisible;
      localStorage.setItem(KEY_LYRICS, state.lyricsVisible ? '1' : '0');
      applyLyricsToggle();
    });

    // 进度条 seek(点击)
    progressEl.addEventListener('click', (e) => {
      if (!Number.isFinite(audio.duration)) return;
      const rect = progressEl.getBoundingClientRect();
      const pct = Math.min(1, Math.max(0, (e.clientX - rect.left) / rect.width));
      audio.currentTime = pct * audio.duration;
    });
    // 进度条 seek(键盘:← →)
    progressEl.addEventListener('keydown', (e) => {
      if (!Number.isFinite(audio.duration)) return;
      if (e.key === 'ArrowLeft')  { audio.currentTime = Math.max(0, audio.currentTime - 5); e.preventDefault(); }
      if (e.key === 'ArrowRight') { audio.currentTime = Math.min(audio.duration, audio.currentTime + 5); e.preventDefault(); }
    });

    // 浮层关闭
    modalEl?.querySelectorAll('[data-music-modal-close]').forEach((el) => {
      el.addEventListener('click', closeModal);
    });
    modalSearchEl?.addEventListener('input', () => {
      state.playlistQuery = modalSearchEl.value;
      applyPlaylistSearch();
    });
    modalSearchEl?.addEventListener('keydown', (e) => {
      if (e.key !== 'Enter') return;
      const firstMatch = modalListEl?.querySelector('li:not([hidden])');
      if (!firstMatch) return;
      e.preventDefault();
      firstMatch.click();
    });
    window.addEventListener('y181:music-play-track', (event) => {
      playRequestedTrack(event.detail || {});
    });
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && modalEl?.classList.contains('is-visible')) closeModal();
    });

    // audio 事件
    audio.addEventListener('play',     () => updatePlayingState(true));
    audio.addEventListener('pause',    () => updatePlayingState(false));
    audio.addEventListener('timeupdate', updateProgress);
    audio.addEventListener('loadedmetadata', updateProgress);
    audio.addEventListener('ended', () => {
      // one 由 audio.loop 处理(不会触发 ended);这里只处理 shuffle / sequential
      if (state.loopMode === 'one') return;
      nextTrack(false);
    });
    audio.addEventListener('error', (e) => {
      console.warn('[music] audio 错误:', audio.error, audio.src);
    });

    // hard nav 持久化
    window.addEventListener('pagehide', persistState);
    window.addEventListener('beforeunload', persistState);
  }

  // ============================================================
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
