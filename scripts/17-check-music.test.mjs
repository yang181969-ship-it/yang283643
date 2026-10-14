// Tests for scripts/17-check-music.mjs. Run: npm run music:test
// Each case builds a throwaway Git repository in the OS temp directory with the project's real
// .gitignore, so the publishable set is computed exactly as on Cloudflare's Git clone.

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { runCheck } from './17-check-music.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const GITIGNORE = fs.readFileSync(path.join(ROOT, '.gitignore'), 'utf8');
const EMPTY_PLAYLIST = '{ "tracks": [] }\n';
const ID3 = Buffer.concat([Buffer.from('ID3\x04\x00\x00\x00\x00\x00\x00', 'latin1'), crypto.randomBytes(64)]);
const PNG = Buffer.from('89504e470d0a1a0a0000000d49484452', 'hex');
const temps = [];

function git(cwd, ...args) {
  // core.ignorecase=false behaves like the Linux build machine, not the Windows checkout
  return execFileSync('git', ['-c', 'core.ignorecase=false', ...args], { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
}

function write(root, rel, content) {
  const abs = path.join(root, rel);
  fs.mkdirSync(path.dirname(abs), { recursive: true });
  fs.writeFileSync(abs, content);
}

// files: { rel: content }; force: paths added with `git add -f` (bypassing .gitignore)
function makeRepo({ files = {}, force = [], playlist = EMPTY_PLAYLIST, git: useGit = true } = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'music-check-'));
  temps.push(root);
  write(root, '.gitignore', GITIGNORE);
  write(root, 'data/playlist.json', playlist);
  write(root, 'index.html', '<!doctype html><title>t</title>');
  for (const [rel, content] of Object.entries(files)) write(root, rel, content);
  if (useGit) {
    git(root, 'init', '-q');
    git(root, 'config', 'core.ignorecase', 'false');
    git(root, 'add', '-A');
    if (force.length) git(root, 'add', '-f', '--', ...force);
  }
  return root;
}

function blocked(result) {
  return result.problems.map((p) => p.label);
}

test.after(() => temps.forEach((dir) => fs.rmSync(dir, { recursive: true, force: true })));

test('empty library passes and ordinary assets are not flagged', () => {
  const root = makeRepo({
    files: {
      'assets/img/photo.png': PNG,
      'assets/img/music.svg': '<svg xmlns="http://www.w3.org/2000/svg"/>',
      'js/mp3-player.js': 'console.log("mp3")',
      'css/style.css': 'body{}',
      'data/music-stats.json': '{}',
      'content/notes/wave.md': '# wav and ogg are words here',
    },
  });
  const result = runCheck({ root, approvals: [] });
  assert.equal(result.source, 'git');
  assert.deepEqual(result.media, []);
  assert.deepEqual(result.problems, []);
});

test('unregistered tracked MP3 blocks the build', () => {
  const root = makeRepo({ files: { 'assets/music/song.mp3': ID3 }, force: ['assets/music/song.mp3'] });
  assert.deepEqual(blocked(runCheck({ root, approvals: [] })), ['assets/music/song.mp3']);
});

test('upper-case .MP3 blocks the build', () => {
  const root = makeRepo({ files: { 'assets/music/SONG.MP3': ID3 }, force: ['assets/music/SONG.MP3'] });
  assert.deepEqual(blocked(runCheck({ root, approvals: [] })), ['assets/music/SONG.MP3']);
});

test('audio and lyrics in other public folders block the build', () => {
  const forced = ['assets/images/bg.ogg', 'html/clip.Flac', 'song.WAV', 'content/lyrics/a.LRC'];
  const root = makeRepo({
    files: {
      'assets/images/bg.ogg': 'OggS....',
      'html/clip.Flac': 'fLaC....',
      'song.WAV': 'RIFF....WAVE',
      'content/lyrics/a.LRC': '[00:01.00]line',
    },
    force: forced,
  });
  assert.deepEqual(blocked(runCheck({ root, approvals: [] })).sort(), forced.slice().sort());
});

test('renamed audio is caught by its file signature, even untracked', () => {
  // .png is not ignored, so this untracked file would be committed by `git add -A`
  const root = makeRepo({ files: { 'assets/img/cover.png': ID3 } });
  git(root, 'rm', '-q', '--cached', 'assets/img/cover.png');
  const result = runCheck({ root, approvals: [] });
  assert.deepEqual(blocked(result), ['assets/img/cover.png']);
  assert.match(result.problems[0].errors[0], /ID3/);
});

test('ignored private backup is not flagged and never reaches a clone', () => {
  const root = makeRepo({ files: { '.local/music-backup/private.mp3': ID3, '.local/music-backup/Other.FLAC': 'fLaC....' } });
  git(root, '-c', 'user.name=t', '-c', 'user.email=t@t', 'commit', '-q', '-m', 'init');

  const result = runCheck({ root, approvals: [] });
  assert.deepEqual(result.problems, []);
  assert.deepEqual(result.ignoredMedia.sort(), ['.local/music-backup/Other.FLAC', '.local/music-backup/private.mp3']);
  assert.ok(!git(root, 'ls-files').includes('music-backup'), 'backup must not be tracked');

  // Cloudflare Pages builds from a Git clone: the backup must not exist there
  const clone = fs.mkdtempSync(path.join(os.tmpdir(), 'music-clone-'));
  temps.push(clone);
  git(os.tmpdir(), 'clone', '-q', root, clone);
  assert.ok(!fs.existsSync(path.join(clone, '.local')), 'clone must not contain .local/');
  assert.deepEqual(runCheck({ root: clone, approvals: [] }).ignoredMedia, []);
});

test('without Git the whole directory is scanned (fail closed), backups included', () => {
  const root = makeRepo({ files: { '.local/music-backup/private.mp3': ID3 }, git: false });
  const result = runCheck({ root, approvals: [] });
  assert.equal(result.source, 'filesystem');
  assert.deepEqual(blocked(result), ['.local/music-backup/private.mp3']);
});

test('--dir scans an output directory as-is', () => {
  const root = makeRepo({ files: { 'dist/assets/a.opus': 'OggS' }, git: false });
  assert.deepEqual(blocked(runCheck({ root, dir: path.join(root, 'dist'), approvals: [] })), ['assets/a.opus']);
});

const LICENSED_TRACK = {
  id: 'track-001',
  title: 'Song',
  artist: 'Artist',
  src: 'assets/music/song.mp3',
  license: {
    type: 'CC BY 4.0',
    sourceUrl: 'https://example.org/song',
    basis: 'https://creativecommons.org/licenses/by/4.0/',
    allowPublicHosting: true,
    attribution: '"Song" by Artist, CC BY 4.0',
  },
};

test('a license declaration in playlist.json alone does not approve audio', () => {
  const root = makeRepo({
    files: { 'assets/music/song.mp3': ID3 },
    force: ['assets/music/song.mp3'],
    playlist: JSON.stringify({ tracks: [LICENSED_TRACK] }),
  });
  const labels = blocked(runCheck({ root, approvals: [] }));
  assert.ok(labels.includes('assets/music/song.mp3'));
  assert.ok(labels.some((l) => l.startsWith('playlist ')));
});

test('a playlist track without license metadata is blocked', () => {
  const { license, ...bare } = LICENSED_TRACK;
  const root = makeRepo({ playlist: JSON.stringify({ tracks: [{ ...bare, src: 'assets/music/missing.mp3' }] }) });
  const result = runCheck({ root, approvals: [] });
  assert.equal(result.problems.length, 1);
  assert.ok(result.problems[0].errors.some((e) => e.includes('license')));
});

test('future extension: a reviewed, hash-bound approval passes; any mismatch blocks', () => {
  const root = makeRepo({
    files: { 'assets/music/song.mp3': ID3 },
    force: ['assets/music/song.mp3'],
    playlist: JSON.stringify({ tracks: [LICENSED_TRACK] }),
  });
  const approval = {
    path: 'assets/music/song.mp3',
    sha256: crypto.createHash('sha256').update(ID3).digest('hex'),
    reviewedBy: 'reviewer',
    reviewedAt: '2026-10-14',
    evidence: 'license-archive/song.pdf',
  };
  assert.deepEqual(runCheck({ root, approvals: [approval] }).problems, []);
  assert.ok(blocked(runCheck({ root, approvals: [{ ...approval, sha256: '0'.repeat(64) }] })).includes('assets/music/song.mp3'));
  assert.ok(blocked(runCheck({ root, approvals: [{ ...approval, reviewedBy: '' }] })).includes('assets/music/song.mp3'));
});

test('project .gitignore ignores audio and lyrics in any letter case', () => {
  const ignored = ['test.mp3', 'test.MP3', 'test.FLAC', 'a/b/Test.Mp3', 'x.Wav', 'x.OGG', 'x.Opus', 'x.m4A', 'y.LRC'];
  const kept = ['test.png', 'test.js', 'mp3.svg', 'audio.css', 'notes/flac.md'];
  const root = makeRepo();
  for (const rel of ignored) {
    assert.doesNotThrow(() => git(root, 'check-ignore', '-q', '--no-index', rel), `${rel} should be ignored`);
  }
  for (const rel of kept) {
    assert.throws(() => git(root, 'check-ignore', '-q', '--no-index', rel), `${rel} should not be ignored`);
  }
});

test('the real project passes with the current empty library', () => {
  const result = runCheck({ root: ROOT });
  assert.deepEqual(result.problems, []);
  assert.deepEqual(result.media, []);
});
