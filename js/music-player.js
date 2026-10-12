/**
 * 随心听音乐播放器 —— Phase C Commit 3 / Phase 1.5
 * - 4 控件:loop(三态:顺序 / 随机 / 单曲循环) / prev / play / next + 音量
 * - 歌单与播放器同在一个弹窗(桌面左右、移动上下),不再有二级歌单浮层
 * - LRC 时间戳同步歌词,无时间戳 fallback 静态显示
 * - audio 挂 <body> 顶层,SPA 切页不重建;hard nav 时 pagehide 持久化位置
 * - 首次进站不 autoplay;state 里 isPlaying=true 也用 .play().catch() 优雅降级
 *
 * 持久化 key:
 *   y181_music_state          { trackIndex, currentTime, isPlaying }
 *   y181_music_loop            'sequential' | 'shuffle' | 'one'
 *   y181_music_lyrics_visible  '1' | '0'
 *   y181_music_volume          0–100
 */
(function () {
  'use strict';

  // ---- 常量 ----
  const KEY_STATE   = 'y181_music_state';
  const KEY_LOOP    = 'y181_music_loop';
  const KEY_LYRICS  = 'y181_music_lyrics_visible';
  const KEY_VOLUME  = 'y181_music_volume';
  const DEFAULT_VOLUME = 80;
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
      loopBtn, prevBtn, playBtn, nextBtn,
      volumeEl, volumeValueEl,
      lyricsToggleBtn, lyricsEl, lyricsInnerEl,
      playlistEl, playlistListEl, playlistCountEl, playlistSearchEl, playlistEmptyEl;

  function getSiteRootUrl() {
    const script = document.currentScript
      || document.querySelector('script[src*="js/music-player.js"]');
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
    volumeEl  = root.querySelector('[data-music-volume]');
    volumeValueEl = root.querySelector('[data-music-volume-value]');
    lyricsToggleBtn = root.querySelector('[data-music-lyrics-toggle]');
    lyricsEl  = root.querySelector('[data-music-lyrics]');
    lyricsInnerEl = root.querySelector('[data-music-lyrics-inner]');
    playlistEl   = document.querySelector('[data-music-playlist]');
    playlistListEl  = playlistEl?.querySelector('[data-music-playlist-list]');
    playlistCountEl = playlistEl?.querySelector('[data-music-playlist-count]');
    playlistSearchEl = playlistEl?.querySelector('[data-music-playlist-search]');
    playlistEmptyEl = playlistEl?.querySelector('[data-music-playlist-empty]');

    bindEvents();
    restoreLoop();
    restoreLyricsToggle();
    restoreVolume();
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
      renderPlaylist();
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

  // 音量:0–100% 映射到同一个 <audio>。iOS 等设备的 audio.volume 只读(恒为 1),
  // 探测失败时禁用滑块并提示使用系统音量,而不是假装可以调节。
  function restoreVolume() {
    if (!volumeEl) return;
    let supported = true;
    const before = audio.volume;
    try {
      audio.volume = 0.5;
      supported = Math.abs(audio.volume - 0.5) < 0.01;
      audio.volume = before;
    } catch (_) { supported = false; }

    if (!supported) {
      volumeEl.disabled = true;
      root.querySelector('[data-music-volume-wrap]')?.classList.add('is-unsupported');
      const hint = root.querySelector('[data-music-volume-hint]');
      if (hint) hint.hidden = false;
      setVolume(100, false);
      return;
    }
    let saved = DEFAULT_VOLUME;
    try {
      const raw = localStorage.getItem(KEY_VOLUME);
      if (raw !== null && Number.isFinite(Number(raw))) saved = Number(raw);
    } catch (_) {}
    setVolume(saved, false);
  }

  function setVolume(value, persist) {
    const v = Math.round(Math.min(100, Math.max(0, Number(value) || 0)));
    if (!volumeEl.disabled) audio.volume = v / 100;
    volumeEl.value = String(v);
    volumeEl.style.setProperty('--value', v + '%');
    volumeEl.setAttribute('aria-valuetext', v + '%');
    if (volumeValueEl) volumeValueEl.textContent = v + '%';
    if (persist) {
      try { localStorage.setItem(KEY_VOLUME, String(v)); } catch (_) {}
    }
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
    updatePlaylistActive();
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
    if (detail?.revealPlaylist) revealPlaylistTrack(idx);
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
  // 歌单(与播放器同一弹窗,常驻显示)
  // ============================================================
  function renderPlaylistCover(track) {
    const cover = track?.cover;
    if (cover) {
      return `
        <span class="music-playlist__cover" aria-hidden="true">
          <img src="${escapeHtml(resolveSiteUrl(cover))}" alt="" loading="lazy" decoding="async">
        </span>
      `;
    }

    return `
      <span class="music-playlist__cover music-playlist__cover--empty" aria-hidden="true">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
          <path d="M9 18V5l12-2v13"></path>
          <circle cx="6" cy="18" r="3"></circle>
          <circle cx="18" cy="16" r="3"></circle>
        </svg>
      </span>
    `;
  }

  // 每首歌是一个 <button>,键盘可直接 Tab/Enter;一次性委托监听,重渲染不重复绑定。
  function renderPlaylist() {
    if (!playlistListEl) return;
    playlistListEl.innerHTML = '';
    const frag = document.createDocumentFragment();
    state.tracks.forEach((track, i) => {
      const title = track.title || '未命名';
      const artist = track.artist || '—';
      const li = document.createElement('li');
      li.dataset.idx = i;
      li.dataset.search = normalizeSearchText(`${title} ${artist}`);
      li.innerHTML = `
        <button type="button" class="music-playlist__item" data-music-track="${i}">
          <span class="music-playlist__index">${String(i + 1).padStart(2, '0')}</span>
          ${renderPlaylistCover(track)}
          <span class="music-playlist__info">
            <span class="music-playlist__name">${escapeHtml(title)}</span>
            <span class="music-playlist__sub">${escapeHtml(artist)}</span>
          </span>
          <span class="music-playlist__playing" aria-hidden="true"><i></i><i></i><i></i></span>
        </button>
      `;
      frag.appendChild(li);
    });
    playlistListEl.appendChild(frag);
    applyPlaylistSearch();
    updatePlaylistActive();
  }

  function updatePlaylistActive() {
    if (!playlistListEl) return;
    playlistListEl.querySelectorAll('li').forEach((li) => {
      const current = Number(li.dataset.idx) === state.currentIndex;
      li.classList.toggle('is-current', current);
      const btn = li.firstElementChild;
      if (current) btn?.setAttribute('aria-current', 'true');
      else btn?.removeAttribute('aria-current');
    });
  }

  // 只滚动歌单自身,不牵动页面或弹窗。
  function scrollPlaylistItemIntoView(index, smooth) {
    const item = playlistListEl?.querySelector(`li[data-idx="${index}"]`);
    if (!item || item.hidden) return;
    const list = playlistListEl;
    const top = item.offsetTop - list.clientHeight / 2 + item.offsetHeight / 2;
    list.scrollTo({ top: Math.max(0, top), behavior: smooth ? 'smooth' : 'auto' });
  }

  function revealPlaylistTrack(index) {
    clearPlaylistSearch();
    updatePlaylistActive();
    const musicButton = document.querySelector('[data-tool="music"]');
    if (window.sitePanels && !document.getElementById('tool-music')?.open) {
      window.sitePanels.open('music', musicButton);
    }
    requestAnimationFrame(() => {
      requestAnimationFrame(() => scrollPlaylistItemIntoView(index, true));
    });
  }

  function normalizeSearchText(value) {
    return String(value || '').normalize('NFKC').toLowerCase();
  }

  function updatePlaylistCount(visibleCount) {
    if (!playlistCountEl) return;
    const total = state.tracks.length;
    const query = state.playlistQuery.trim();
    playlistCountEl.textContent = query ? `${visibleCount} / ${total} 首` : `${total} 首`;
  }

  function applyPlaylistSearch() {
    if (!playlistListEl) {
      updatePlaylistCount(state.tracks.length);
      return;
    }

    const query = normalizeSearchText(state.playlistQuery);
    let visibleCount = 0;
    playlistListEl.querySelectorAll('li').forEach((li) => {
      const isMatch = !query || (li.dataset.search || '').includes(query);
      li.hidden = !isMatch;
      if (isMatch) visibleCount += 1;
    });

    if (playlistEmptyEl) {
      playlistEmptyEl.hidden = visibleCount > 0 || state.tracks.length === 0;
    }
    updatePlaylistCount(visibleCount);
  }

  function clearPlaylistSearch() {
    state.playlistQuery = '';
    if (playlistSearchEl) playlistSearchEl.value = '';
    applyPlaylistSearch();
  }

  // ============================================================
  // UI 更新
  // ============================================================
  function updatePlayingState(isPlaying) {
    root.dataset.status = isPlaying ? 'playing' : 'idle';
    if (playlistEl) playlistEl.dataset.status = root.dataset.status;
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
    volumeEl?.addEventListener('input', () => setVolume(volumeEl.value, true));

    // 歌词 toggle
    lyricsToggleBtn.addEventListener('click', () => {
      state.lyricsVisible = !state.lyricsVisible;
      localStorage.setItem(KEY_LYRICS, state.lyricsVisible ? '1' : '0');
      applyLyricsToggle();
    });

    // Pointer capture supports continuous mouse/touch seeking without losing the audio instance.
    const seek = (e) => {
      if (!Number.isFinite(audio.duration)) return;
      const rect = progressEl.getBoundingClientRect();
      const pct = Math.min(1, Math.max(0, (e.clientX - rect.left) / rect.width));
      audio.currentTime = pct * audio.duration;
    };
    progressEl.addEventListener('pointerdown', (e) => {
      progressEl.setPointerCapture(e.pointerId);
      seek(e);
    });
    progressEl.addEventListener('pointermove', (e) => {
      if (progressEl.hasPointerCapture(e.pointerId)) seek(e);
    });
    progressEl.addEventListener('pointerup', (e) => {
      seek(e);
      if (progressEl.hasPointerCapture(e.pointerId)) progressEl.releasePointerCapture(e.pointerId);
    });
    // 进度条 seek(键盘:← →)
    progressEl.addEventListener('keydown', (e) => {
      if (!Number.isFinite(audio.duration)) return;
      if (e.key === 'ArrowLeft')  { audio.currentTime = Math.max(0, audio.currentTime - 5); e.preventDefault(); }
      if (e.key === 'ArrowRight') { audio.currentTime = Math.min(audio.duration, audio.currentTime + 5); e.preventDefault(); }
    });

    // 歌单:点歌只切歌,不关闭弹窗(关闭/Esc/遮罩由 site-shell.js 统一处理)
    playlistListEl?.addEventListener('click', (e) => {
      const btn = e.target.closest('[data-music-track]');
      if (!btn) return;
      const idx = Number(btn.dataset.musicTrack);
      if (idx === state.currentIndex) togglePlay();
      else loadTrack(idx, true);
    });
    playlistSearchEl?.addEventListener('input', () => {
      state.playlistQuery = playlistSearchEl.value;
      applyPlaylistSearch();
    });
    playlistSearchEl?.addEventListener('keydown', (e) => {
      if (e.key !== 'Enter') return;
      const firstMatch = playlistListEl?.querySelector('li:not([hidden]) [data-music-track]');
      if (!firstMatch) return;
      e.preventDefault();
      firstMatch.click();
    });
    // 打开音乐弹窗时把当前歌曲滚到歌单可见处
    window.addEventListener('site-panel:open', (e) => {
      if (e.detail?.key !== 'music') return;
      requestAnimationFrame(() => scrollPlaylistItemIntoView(state.currentIndex, false));
    });
    window.addEventListener('y181:music-play-track', (event) => {
      playRequestedTrack(event.detail || {});
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
