#!/usr/bin/env node
// Music copyright gate, run as the first step of npm run build:all (npm run music:check).
//
// 1. Publishable media: every file that would be published is scanned for audio and lyric files,
//    whatever its folder. Cloudflare Pages builds from a Git clone of the repository, so the
//    publishable set is Git's view of the project: tracked files plus untracked files that are not
//    ignored (what the next `git add -A` would commit). Ignored local files such as .local/ never
//    reach the clone. When Git is unavailable the whole directory is scanned instead (fail closed).
//    `--dir <path>` scans a real output directory, for a future separate build output or direct upload.
//    Detection: extension (case-insensitive) and the file signature, so a renamed audio file is caught.
// 2. Playlist: every track in data/playlist.json needs complete license metadata AND its audio must be
//    in the manual approval list below.
//
// No music is currently cleared for public hosting, so APPROVED_MEDIA is empty and any publishable
// audio or lyric file fails the build. Filling in license fields in playlist.json never approves a file
// on its own. This check only prevents omissions; it is not a legal review.

import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));
const DEFAULT_ROOT = path.resolve(SCRIPT_DIR, '..');

export const AUDIO_EXTS = new Set([
  'mp3', 'm4a', 'm4b', 'aac', 'flac', 'wav', 'ogg', 'oga', 'opus', 'weba', 'wma',
  'aif', 'aiff', 'aifc', 'ape', 'alac', 'amr', 'caf', 'mka', 'mid', 'midi',
]);
export const LYRIC_EXTS = new Set(['lrc', 'krc', 'qrc']);
const PLAYABLE_EXTS = new Set(['.mp3', '.m4a', '.aac', '.ogg', '.wav', '.flac']);
const SKIP_DIRS = new Set(['.git', 'node_modules']);

// Manual approval list. Add an entry only after a human has reviewed the license and archived the
// evidence. The entry is bound to the file content: replacing the file invalidates it.
//   { path: 'assets/music/song.mp3', sha256: '<64 hex chars>', reviewedBy: '审核人',
//     reviewedAt: 'YYYY-MM-DD', evidence: '授权凭据存档位置 / 编号' }
export const APPROVED_MEDIA = Object.freeze([]);

const PLACEHOLDERS = new Set(['', 'unknown', 'todo', 'tbd', 'n/a', 'na', 'none', '-', '—', '未知', '待定', '待补充', '无']);
// 这些许可类型不强制要求署名;其余类型必须填写 attribution
const NO_ATTRIBUTION_TYPES = /^(cc0|public domain|公有领域|original|原创)/i;

function isFilled(value) {
  return typeof value === 'string' && !PLACEHOLDERS.has(value.trim().toLowerCase());
}

function isHttpUrl(value) {
  try {
    const url = new URL(value);
    return url.protocol === 'https:' || url.protocol === 'http:';
  } catch {
    return false;
  }
}

function toPosix(p) {
  return p.split(path.sep).join('/');
}

function sha256(absPath) {
  return crypto.createHash('sha256').update(fs.readFileSync(absPath)).digest('hex');
}

// ------------------------------------------------------------------
// Publishable file sets
// ------------------------------------------------------------------
function gitLines(root, args) {
  const out = execFileSync('git', ['-C', root, ...args, '-z'], { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024, stdio: ['ignore', 'pipe', 'ignore'] });
  return out.split('\0').filter(Boolean);
}

export function listDirFiles(dir) {
  const files = [];
  const walk = (abs) => {
    for (const entry of fs.readdirSync(abs, { withFileTypes: true })) {
      if (entry.isDirectory()) {
        if (!SKIP_DIRS.has(entry.name)) walk(path.join(abs, entry.name));
      } else if (entry.isFile()) {
        files.push(toPosix(path.relative(dir, path.join(abs, entry.name))));
      }
    }
  };
  walk(dir);
  return files;
}

export function listPublishableFiles(root) {
  try {
    return { source: 'git', files: gitLines(root, ['ls-files', '--cached', '--others', '--exclude-standard']) };
  } catch {
    return { source: 'filesystem', files: listDirFiles(root) };
  }
}

// Ignored local media (e.g. .local/music-backup/): reported for transparency, never published.
export function listIgnoredMedia(root) {
  try {
    return gitLines(root, ['ls-files', '--others', '--ignored', '--exclude-standard'])
      .filter((rel) => !rel.startsWith('node_modules/') && detectMedia(root, rel));
  } catch {
    return [];
  }
}

// ------------------------------------------------------------------
// Media detection
// ------------------------------------------------------------------
function readHead(absPath, length) {
  let fd;
  try {
    fd = fs.openSync(absPath, 'r');
    const buf = Buffer.alloc(length);
    const n = fs.readSync(fd, buf, 0, length, 0);
    return buf.subarray(0, n);
  } catch {
    return Buffer.alloc(0);
  } finally {
    if (fd !== undefined) fs.closeSync(fd);
  }
}

function sniffAudio(head) {
  const ascii = (start, end) => head.subarray(start, end).toString('latin1');
  if (head.length < 4) return null;
  if (ascii(0, 3) === 'ID3') return 'ID3 (MP3)';
  if (ascii(0, 4) === 'fLaC') return 'FLAC';
  if (ascii(0, 4) === 'OggS') return 'Ogg';
  if (ascii(0, 4) === 'MThd') return 'MIDI';
  if (ascii(0, 4) === 'MAC ') return 'APE';
  if (ascii(0, 4) === 'caff') return 'CAF';
  if (ascii(0, 5) === '#!AMR') return 'AMR';
  if (head.length >= 12 && ascii(0, 4) === 'RIFF' && ascii(8, 12) === 'WAVE') return 'WAV';
  if (head.length >= 12 && ascii(0, 4) === 'FORM' && /^AIF[FC]$/.test(ascii(8, 12))) return 'AIFF';
  if (head.length >= 12 && ascii(4, 8) === 'ftyp' && /^M4[ABP] $/.test(ascii(8, 12))) return 'M4A';
  return null;
}

// Returns { kind: 'audio' | 'lyrics', reason } or null.
export function detectMedia(root, rel) {
  const ext = path.extname(rel).slice(1).toLowerCase();
  if (AUDIO_EXTS.has(ext)) return { kind: 'audio', reason: `扩展名 ${path.extname(rel)}` };
  if (LYRIC_EXTS.has(ext)) return { kind: 'lyrics', reason: `歌词扩展名 ${path.extname(rel)}` };
  const signature = sniffAudio(readHead(path.join(root, rel), 12));
  return signature ? { kind: 'audio', reason: `文件头为 ${signature}` } : null;
}

// ------------------------------------------------------------------
// Approval
// ------------------------------------------------------------------
export function approvalProblem(root, rel, approvals) {
  const entry = approvals.find((item) => item?.path === rel);
  if (!entry) return '未在人工批准清单 APPROVED_MEDIA 中(当前没有任何音乐获准公开发布)';
  if (!isFilled(entry.reviewedBy) || !isFilled(entry.reviewedAt) || !isFilled(entry.evidence)) {
    return '批准记录缺少 reviewedBy / reviewedAt / evidence';
  }
  const abs = path.join(root, rel);
  if (!fs.existsSync(abs)) return '文件不存在,无法核对批准时的内容哈希';
  if (typeof entry.sha256 !== 'string' || entry.sha256.toLowerCase() !== sha256(abs)) {
    return '文件内容与批准记录的 sha256 不一致';
  }
  return null;
}

// ------------------------------------------------------------------
// Playlist metadata
// ------------------------------------------------------------------
export function validateTrack(track, { root = DEFAULT_ROOT, approvals = APPROVED_MEDIA } = {}) {
  const errors = [];
  if (!track || typeof track !== 'object') return ['不是对象'];

  if (!isFilled(track.id)) errors.push('缺少 id');
  if (!isFilled(track.title)) errors.push('缺少歌曲名称 title');
  if (!isFilled(track.artist)) errors.push('缺少作者或表演者 artist');

  if (!isFilled(track.src)) {
    errors.push('缺少音频路径 src');
  } else if (!track.src.startsWith('assets/music/') || track.src.includes('..')) {
    errors.push('src 必须是 assets/music/ 下的本地文件(不接入外部音频服务)');
  } else if (!PLAYABLE_EXTS.has(path.extname(track.src).toLowerCase())) {
    errors.push(`src 扩展名不受支持: ${path.extname(track.src)}`);
  } else if (!fs.existsSync(path.join(root, track.src))) {
    errors.push(`音频文件不存在: ${track.src}`);
  } else {
    const problem = approvalProblem(root, track.src, approvals);
    if (problem) errors.push(`音频 ${track.src} ${problem}`);
  }

  const license = track.license;
  if (!license || typeof license !== 'object') {
    errors.push('缺少 license 授权信息');
    return errors;
  }
  if (!isFilled(license.type)) errors.push('缺少许可类型 license.type');
  if (!isFilled(license.sourceUrl) || !isHttpUrl(license.sourceUrl)) {
    errors.push('license.sourceUrl 必须是原始来源的 http(s) 链接');
  }
  if (!isFilled(license.basis)) errors.push('缺少许可或授权依据 license.basis');
  if (license.allowPublicHosting !== true) {
    errors.push('license.allowPublicHosting 不是 true:未确认允许公开托管和网络传播');
  }
  if (typeof license.attribution !== 'string') {
    errors.push('缺少署名信息 license.attribution(无需署名时写空字符串)');
  } else if (!license.attribution.trim() && !NO_ATTRIBUTION_TYPES.test(String(license.type || '').trim())) {
    errors.push(`许可类型 ${license.type} 需要填写署名 license.attribution`);
  }
  return errors;
}

export function validatePlaylist(data, options = {}) {
  const tracks = Array.isArray(data) ? data : data?.tracks;
  if (!Array.isArray(tracks)) return { tracks: [], problems: [{ label: 'playlist.json', errors: ['缺少 tracks 数组'] }] };

  const problems = [];
  const seenIds = new Set();
  const seenSrc = new Set();
  tracks.forEach((track, index) => {
    const errors = validateTrack(track, options);
    if (track?.id && seenIds.has(track.id)) errors.push(`id 重复: ${track.id}`);
    if (track?.src && seenSrc.has(track.src)) errors.push(`src 重复: ${track.src}`);
    seenIds.add(track?.id);
    seenSrc.add(track?.src);
    if (errors.length) problems.push({ label: `#${index + 1} ${track?.title || track?.id || '(未命名)'}`, errors });
  });
  return { tracks, problems };
}

// ------------------------------------------------------------------
// Whole check
// ------------------------------------------------------------------
export function runCheck({ root = DEFAULT_ROOT, dir = null, approvals = APPROVED_MEDIA } = {}) {
  const scanRoot = dir ? path.resolve(dir) : root;
  const { source, files } = dir ? { source: 'directory', files: listDirFiles(scanRoot) } : listPublishableFiles(root);

  const media = [];
  const problems = [];
  for (const rel of files) {
    const found = detectMedia(scanRoot, rel);
    if (!found) continue;
    media.push({ path: rel, ...found });
    const problem = approvalProblem(scanRoot, rel, approvals);
    if (problem) problems.push({ label: rel, errors: [`${found.reason}: ${problem}`] });
  }

  let tracks = [];
  const playlistPath = path.join(root, 'data', 'playlist.json');
  try {
    const result = validatePlaylist(JSON.parse(fs.readFileSync(playlistPath, 'utf8')), { root, approvals });
    tracks = result.tracks;
    problems.push(...result.problems.map((p) => ({ label: `playlist ${p.label}`, errors: p.errors })));
  } catch (err) {
    problems.push({ label: 'data/playlist.json', errors: [`无法读取: ${err.message}`] });
  }

  const ignoredMedia = dir ? [] : listIgnoredMedia(root);
  return { source, scanned: files.length, media, tracks, ignoredMedia, problems };
}

function main() {
  const args = process.argv.slice(2);
  const dirIndex = args.indexOf('--dir');
  const dir = dirIndex >= 0 ? args[dirIndex + 1] : null;
  if (dirIndex >= 0 && !dir) {
    console.error('[music:check] --dir 需要一个目录路径');
    process.exit(1);
  }

  const result = runCheck({ dir });
  const scope = { git: 'Git 跟踪文件 + 未忽略的新文件', filesystem: '整个目录(Git 不可用,按最严格范围检查)', directory: `目录 ${dir}` }[result.source];
  console.log(`[music:check] 扫描范围: ${scope},共 ${result.scanned} 个文件`);
  if (result.ignoredMedia.length) {
    console.log(`[music:check] 已被 .gitignore 排除、不会发布的本地音频/歌词: ${result.ignoredMedia.length} 个(${[...new Set(result.ignoredMedia.map((p) => path.posix.dirname(p)))].join(', ')})`);
  }

  if (result.problems.length) {
    console.error(`[music:check] 失败:发现 ${result.problems.length} 项未获批准的音乐资源或歌单条目,不得发布:`);
    result.problems.slice(0, 50).forEach(({ label, errors }) => {
      console.error(`  - ${label}`);
      errors.forEach((e) => console.error(`      · ${e}`));
    });
    if (result.problems.length > 50) console.error(`  …… 另有 ${result.problems.length - 50} 项`);
    console.error('请移除这些文件/条目;获得授权的音乐需先完成人工审查并登记到 APPROVED_MEDIA。');
    process.exit(1);
  }
  console.log(`[music:check] 通过:待发布音频/歌词 ${result.media.length} 个,歌单 ${result.tracks.length} 首(不代替法律审查)。`);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main();
}
