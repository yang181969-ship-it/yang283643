"""Temporary music library for browser checks (Playwright request routing only).

The published library is intentionally empty (see scripts/README.md, 2026-10 copyright cleanup), so the
player shows its empty state. Playback / seek / playlist checks need tracks; this helper serves a small
mock playlist and generated silent WAV audio through request interception. Nothing is written to disk
or published, and `npm run music:check` is unaffected.

    from music_mock import install_music_mock, remove_music_mock, empty_library_state
"""
import io
import json
import re
import wave

PLAYLIST_PATTERN = re.compile(r'/data/playlist\.json(\?|$)')
AUDIO_PATTERN = re.compile(r'/assets/music/__mock__/')

# 12 tracks (the old library size) so the playlist overflows on small screens; exactly one title contains 倒数
MOCK_PLAYLIST = {'tracks': [
    {'id': f'mock-{i:03d}', 'title': '倒数（模拟）' if i == 2 else f'模拟歌曲 {i}', 'artist': '测试',
     'src': f'assets/music/__mock__/track-{i}.wav',
     'lyric': '[00:00.00]第一句\n[00:05.00]第二句' if i == 1 else '歌词待补充'}
    for i in range(1, 13)
]}


def _silent_wav(seconds=30, rate=8000):
    buf = io.BytesIO()
    with wave.open(buf, 'wb') as w:
        w.setnchannels(1)
        w.setsampwidth(1)
        w.setframerate(rate)
        w.writeframes(b'\x80' * (seconds * rate))  # 8-bit unsigned silence
    return buf.getvalue()


WAV = _silent_wav()


def _serve_playlist(route):
    route.fulfill(status=200, content_type='application/json', body=json.dumps(MOCK_PLAYLIST, ensure_ascii=False))


def _serve_audio(route):
    # Media elements seek with Range requests; answer them like a static host would.
    total = len(WAV)
    match = re.fullmatch(r'bytes=(\d+)-(\d*)', route.request.headers.get('range', ''))
    headers = {'Content-Type': 'audio/wav', 'Accept-Ranges': 'bytes'}
    if not match:
        route.fulfill(status=200, headers={**headers, 'Content-Length': str(total)}, body=WAV)
        return
    start = int(match[1])
    end = min(int(match[2]) if match[2] else total - 1, total - 1)
    route.fulfill(status=206, headers={**headers, 'Content-Range': f'bytes {start}-{end}/{total}',
                                       'Content-Length': str(end - start + 1)}, body=WAV[start:end + 1])


def install_music_mock(target):
    """target: a BrowserContext or Page. Requests made after this see the mock library."""
    target.route(PLAYLIST_PATTERN, _serve_playlist)
    target.route(AUDIO_PATTERN, _serve_audio)


def remove_music_mock(target):
    target.unroute(PLAYLIST_PATTERN, _serve_playlist)
    target.unroute(AUDIO_PATTERN, _serve_audio)


def empty_library_state(page):
    """Assumes the music dialog is open. True when the player shows the production empty library."""
    return page.evaluate('''() => {
      const root = document.querySelector('#tool-music');
      const play = root.querySelector('[data-music-act="play"]');
      return root.querySelectorAll('[data-music-playlist-list] li[data-idx]').length === 0
        && play.disabled
        && /曲库整理中/.test(root.textContent);
    }''')
