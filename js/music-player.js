/**
 * 随心听音乐播放器 —— Phase C Commit 3 / Phase 1.5
 * - 4 控件:loop(三态:顺序 / 随机 / 单曲循环) / prev / play / next + 音量
 * - 歌单与播放器同在一个弹窗(桌面左右、移动上下),不再有二级歌单浮层
 * - LRC 时间戳同步歌词,无时间戳 fallback 静态显示
 * - audio 挂 <body> 顶层,SPA 切页不重建;hard nav 时 pagehide 持久化位置
 * - 首次进站不 autoplay;state 里 isPlaying=true 也用 .play().catch() 优雅降级
 *
 * 持久化 key:
 *   y181_music_state          { trackId, currentTime, isPlaying }(只恢复仍在歌单里的同一 id)
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
      playlistEl, playlistListEl, playlistCountEl, playlistSearchEl, playlistEmptyEl,
      ringEls = [];

  function getSiteRootUrl() {
    const script = document.currentScript
      || document.querySelector('script[src*="js/music-player.js"]');
    return script?.src ? new URL('../', script.src) : new URL('./', document.baseURI);
  }

  function resolveSiteUrl(path) {
    return new URL(path, SITE_ROOT_URL).href;
  }

  // localStorage 在禁用站点数据 / 部分隐私模式下,访问本身就可能抛 SecurityError,
  // 写入也可能抛 QuotaExceededError:读失败按"无记录"处理,写失败静默忽略,播放器照常初始化。
  function storageGet(key) {
    try { return window.localStorage.getItem(key); } catch (_) { return null; }
  }

  function storageSet(key, value) {
    try { window.localStorage.setItem(key, value); } catch (_) {}
  }

  function storageRemove(key) {
    try { window.localStorage.removeItem(key); } catch (_) {}
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
    ringEls = [...document.querySelectorAll('[data-music-ring]')];

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
        showEmptyLibrary();
        return;
      }
      state.tracks = tracks;
      enableControls();
      renderPlaylist();
      restorePlayback();
      playPendingTrackRequest();
    } catch (err) {
      console.warn('[music] 加载歌单失败:', err);
      showEmptyLibrary();
    }
  }

  // 曲库为空(或歌单加载失败):保留播放器外观,禁用所有播放操作,不设置任何音频地址,
  // 并清掉旧的播放记录,避免之后恢复已删除的歌曲。
  function showEmptyLibrary() {
    state.tracks = [];
    state.currentIndex = -1;
    storageRemove(KEY_STATE);
    root.dataset.library = 'empty';
    titleEl.textContent = '曲库整理中';
    artistEl.textContent = '正在重新整理音乐资源，暂未开放播放。';
    [loopBtn, prevBtn, playBtn, nextBtn].forEach((btn) => { btn.disabled = true; });
    progressEl.setAttribute('aria-disabled', 'true');
    progressEl.tabIndex = -1;
    if (playlistSearchEl) playlistSearchEl.disabled = true;
    renderPlaylist();
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
    try { saved = JSON.parse(storageGet(KEY_STATE) || 'null'); } catch (_) {}

    // 只按 id 恢复仍在歌单里的同一首歌;旧版记录(只有 trackIndex)或已删除的曲目一律丢弃
    const savedIdx = typeof saved?.trackId === 'string'
      ? state.tracks.findIndex((track) => track.id === saved.trackId)
      : -1;
    if (savedIdx < 0) {
      saved = null;
      storageRemove(KEY_STATE);
    }

    loadTrack(Math.max(0, savedIdx), false);

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
    const saved = storageGet(KEY_LOOP);
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
    const raw = storageGet(KEY_VOLUME);
    if (raw !== null && Number.isFinite(Number(raw))) saved = Number(raw);
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
      storageSet(KEY_VOLUME, String(v));
    }
  }

  function restoreLyricsToggle() {
    state.lyricsVisible = storageGet(KEY_LYRICS) === '1';
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
    if (state.tracks.length === 0) return;
    if (state.currentIndex < 0) {
      loadTrack(0, true);
      return;
    }
    if (audio.paused) audio.play().catch((err) => console.warn('[music] play failed:', err));
    else audio.pause();
  }

  function toggleLoop() {
    const cur = LOOP_MODES.indexOf(state.loopMode);
    state.loopMode = LOOP_MODES[(cur + 1) % LOOP_MODES.length];
    storageSet(KEY_LOOP, state.loopMode);
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
    loopBtn.setAttribute('aria-label', '循环模式：' + labels[state.loopMode]);
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
    // 按列表自身坐标计算(offsetTop 相对的是弹窗,会多算上方播放区/标题的高度)
    const offset = item.getBoundingClientRect().top - list.getBoundingClientRect().top + list.scrollTop;
    const top = offset - list.clientHeight / 2 + item.offsetHeight / 2;
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
      const libraryEmpty = state.tracks.length === 0;
      playlistEmptyEl.textContent = libraryEmpty ? '曲库整理中，暂无可播放的歌曲' : '没有找到匹配的音乐';
      playlistEmptyEl.hidden = !libraryEmpty && visibleCount > 0;
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
    syncRing();
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
    syncRing();
  }

  // 导航音乐按钮的进度环:剩余比例 = 1 - currentTime / duration。
  // 只在 audio 事件(timeupdate / seek / 切歌 / 播放暂停)时更新,不额外轮询;
  // 平滑过渡由 CSS 完成,回退或大幅跳转(拖动、切歌、单曲循环重头)时直接跳到位。
  // 只在音频真实播放时显示:暂停、结束、出错、停止都恢复静态音符。
  const RING_LENGTH = 2 * Math.PI * 16; // 与模板中 r="16" 一致
  let ringLast = 0;
  let ringShown = false;
  function syncRing(snap) {
    if (!ringEls.length) return;
    const dur = audio.duration;
    const p = Number.isFinite(dur) && dur > 0 ? Math.min(1, Math.max(0, audio.currentTime / dur)) : 0;
    const playing = !audio.paused && !audio.ended && !audio.error;
    // 重新出现时直接定位到当前进度,不从上次隐藏前的位置动画过来
    const jump = snap || !ringShown || p < ringLast || p - ringLast > 0.02;
    ringLast = p;
    ringShown = playing;
    ringEls.forEach((ring) => {
      const button = ring.closest('[data-tool="music"]');
      if (playing) button.dataset.ring = 'playing';
      else delete button.dataset.ring;
      ring.style.transition = jump ? 'none' : '';
      ring.style.strokeDashoffset = (p * RING_LENGTH).toFixed(2);
      ring.style.opacity = p >= 0.999 ? '0' : '';
    });
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
    const track = state.tracks[state.currentIndex];
    if (!track) return;
    storageSet(KEY_STATE, JSON.stringify({
      trackId: track.id,
      currentTime: audio.currentTime || 0,
      isPlaying: !audio.paused,
    }));
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
      storageSet(KEY_LYRICS, state.lyricsVisible ? '1' : '0');
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
    audio.addEventListener('emptied', () => syncRing(true));
    audio.addEventListener('seeking', () => syncRing(true));
    ['ended', 'error', 'abort'].forEach((type) => audio.addEventListener(type, () => syncRing(true)));
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
