#!/usr/bin/env node
// Add one or more audio files to assets/music/ and append them to data/playlist.json.
// In sync mode, scan assets/music/ and append new files already in that folder.
// Lyrics are intentionally left as a placeholder for now.

import fs from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(SCRIPT_DIR, '..');
const MUSIC_DIR = path.join(ROOT, 'assets', 'music');
const PLAYLIST_PATH = path.join(ROOT, 'data', 'playlist.json');
const SUPPORTED_EXTS = new Set(['.mp3', '.m4a', '.aac', '.ogg', '.wav', '.flac']);

function printHelp() {
  console.log(`
用法:
  npm run music:add -- <音频文件> --title "歌名" --artist "歌手"
  npm run music:add -- <音频文件1> <音频文件2>
  npm run music:add -- <文件夹> --batch
  npm run music:sync
  npm run music:add -- --sync
  node scripts/9-add-music.mjs <音频文件> --title "歌名" --artist "歌手"

示例:
  npm run music:add -- "assets/music/new-song.mp3" --title "New Song" --artist "Artist"
  npm run music:add -- "song-a.mp3" "song-b.mp3"
  npm run music:add -- "songs" --batch
  npm run music:add -- "songs" --batch --recursive --artist "默认歌手"
  npm run music:sync

选项:
  --title <文本>       单曲歌名。不填时从文件名推断
  --artist <文本>      单曲歌手；批量时作为默认歌手
  --id <文本>          单曲自定义歌曲 id。不填时自动生成 track-006 这种 id
  --filename <文件名>  单曲复制到 assets/music/ 后使用的文件名。不填时自动生成
  --sync              扫描 assets/music/ 里尚未加入歌单的音频
  --batch             把传入的文件夹作为歌曲目录扫描
  --recursive         配合 --batch 递归扫描子文件夹
  --dry-run           只预览,不复制文件也不写入 playlist.json
  -h, --help          显示帮助

批量模式说明:
  - 脚本会优先读取 MP3 的标题 / 歌手元数据,读不到时再从文件名推断
  - 批量添加时建议文件名写成 "歌手 - 歌名.mp3",脚本会自动拆出歌手和歌名
  - 批量模式不支持 --title、--id、--filename,因为每首歌都需要不同值
`);
}

function parseArgs(argv) {
  const options = {};
  const positional = [];

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];

    if (arg === '-h' || arg === '--help') {
      options.help = true;
      continue;
    }

    if (arg === '--batch') {
      options.batch = true;
      continue;
    }

    if (arg === '--recursive') {
      options.recursive = true;
      continue;
    }

    if (arg === '--dry-run') {
      options.dryRun = true;
      continue;
    }

    if (arg === '--sync') {
      options.sync = true;
      continue;
    }

    if (arg.startsWith('--')) {
      const eq = arg.indexOf('=');
      let key;
      let value;

      if (eq >= 0) {
        key = arg.slice(2, eq);
        value = arg.slice(eq + 1);
      } else {
        key = arg.slice(2);
        value = argv[i + 1];
        if (!value || value.startsWith('--')) {
          throw new Error(`缺少 --${key} 的值`);
        }
        i += 1;
      }

      if (!['title', 'artist', 'id', 'filename'].includes(key)) {
        throw new Error(`未知选项: --${key}`);
      }
      options[key] = value;
      continue;
    }

    positional.push(arg);
  }

  return {
    sourceArgs: positional,
    options,
  };
}

function toWebPath(filepath) {
  return filepath.split(path.sep).join('/');
}

function isInside(parent, child) {
  const rel = path.relative(parent, child);
  return rel === '' || (!rel.startsWith('..') && !path.isAbsolute(rel));
}

function displayPath(absPath) {
  if (isInside(ROOT, absPath)) return toWebPath(path.relative(ROOT, absPath));
  return absPath;
}

function srcKey(src) {
  return String(src || '').replace(/\\/g, '/').toLowerCase();
}

function fileKey(absPath) {
  const normalized = path.normalize(absPath);
  return process.platform === 'win32' ? normalized.toLowerCase() : normalized;
}

function cleanText(value) {
  return String(value || '').trim().replace(/\s+/g, ' ');
}

function todayISO() {
  const now = new Date();
  const local = new Date(now.getTime() - now.getTimezoneOffset() * 60000);
  return local.toISOString().slice(0, 10);
}

function humanizeStem(stem) {
  return cleanText(stem.replace(/[_-]+/g, ' '));
}

function readSyncsafeInt(buffer, offset = 0) {
  return ((buffer[offset] & 0x7f) << 21)
    | ((buffer[offset + 1] & 0x7f) << 14)
    | ((buffer[offset + 2] & 0x7f) << 7)
    | (buffer[offset + 3] & 0x7f);
}

function readUInt24BE(buffer, offset = 0) {
  return (buffer[offset] << 16) | (buffer[offset + 1] << 8) | buffer[offset + 2];
}

function stripTrailingNulls(buffer) {
  let end = buffer.length;
  while (end > 0 && buffer[end - 1] === 0) end -= 1;
  return buffer.subarray(0, end);
}

function decodeUtf16BE(buffer) {
  const swapped = Buffer.alloc(buffer.length);
  for (let i = 0; i < buffer.length; i += 2) {
    swapped[i] = buffer[i + 1] ?? 0;
    swapped[i + 1] = buffer[i];
  }
  return swapped.toString('utf16le');
}

function decodeTextFrame(frameData) {
  if (!frameData || frameData.length === 0) return '';

  const encoding = frameData[0];
  const payload = stripTrailingNulls(frameData.subarray(1));
  let text = '';

  if (encoding === 0) {
    text = payload.toString('latin1');
  } else if (encoding === 1) {
    if (payload.length >= 2 && payload[0] === 0xfe && payload[1] === 0xff) {
      text = decodeUtf16BE(payload.subarray(2));
    } else if (payload.length >= 2 && payload[0] === 0xff && payload[1] === 0xfe) {
      text = payload.subarray(2).toString('utf16le');
    } else {
      text = payload.toString('utf16le');
    }
  } else if (encoding === 2) {
    text = decodeUtf16BE(payload);
  } else if (encoding === 3) {
    text = payload.toString('utf8');
  }

  return cleanText(text.replace(/^\uFEFF/, '').replace(/\0+/g, ' / '));
}

function removeUnsynchronisation(buffer) {
  const out = [];
  for (let i = 0; i < buffer.length; i += 1) {
    if (buffer[i] === 0xff && buffer[i + 1] === 0x00) {
      out.push(0xff);
      i += 1;
      continue;
    }
    out.push(buffer[i]);
  }
  return Buffer.from(out);
}

const ID3_TEXT_FRAMES = {
  TIT2: 'title',
  TPE1: 'artist',
  TPE2: 'artist',
  TT2: 'title',
  TP1: 'artist',
  TP2: 'artist',
};

function parseId3Frames(buffer, majorVersion) {
  const fields = {};
  let offset = 0;

  while (offset < buffer.length) {
    let frameId;
    let frameSize;
    let frameDataOffset;

    if (majorVersion === 2) {
      if (offset + 6 > buffer.length) break;
      frameId = buffer.toString('latin1', offset, offset + 3);
      frameSize = readUInt24BE(buffer, offset + 3);
      frameDataOffset = offset + 6;
    } else {
      if (offset + 10 > buffer.length) break;
      frameId = buffer.toString('latin1', offset, offset + 4);
      frameSize = majorVersion === 4
        ? readSyncsafeInt(buffer, offset + 4)
        : buffer.readUInt32BE(offset + 4);
      frameDataOffset = offset + 10;
    }

    if (!/^[A-Z0-9]{3,4}$/.test(frameId) || frameSize <= 0) break;

    const frameEnd = frameDataOffset + frameSize;
    if (frameEnd > buffer.length) break;

    const key = ID3_TEXT_FRAMES[frameId];
    if (key && !fields[key]) {
      const value = decodeTextFrame(buffer.subarray(frameDataOffset, frameEnd));
      if (value) fields[key] = value;
    }

    if (fields.title && fields.artist) break;
    offset = frameEnd;
  }

  return fields;
}

async function readId3v2Metadata(filePath) {
  const handle = await fs.open(filePath, 'r');

  try {
    const header = Buffer.alloc(10);
    const { bytesRead } = await handle.read(header, 0, header.length, 0);
    if (bytesRead < header.length || header.toString('latin1', 0, 3) !== 'ID3') return {};

    const majorVersion = header[3];
    if (![2, 3, 4].includes(majorVersion)) return {};

    const flags = header[5];
    const tagSize = readSyncsafeInt(header, 6);
    if (tagSize <= 0) return {};

    const maxReadSize = 16 * 1024 * 1024;
    const readSize = Math.min(tagSize, maxReadSize);
    const tagBuffer = Buffer.alloc(readSize);
    await handle.read(tagBuffer, 0, readSize, 10);

    let body = (flags & 0x80) ? removeUnsynchronisation(tagBuffer) : tagBuffer;

    if (flags & 0x40) {
      if (majorVersion === 4 && body.length >= 4) {
        body = body.subarray(readSyncsafeInt(body, 0));
      } else if (majorVersion === 3 && body.length >= 4) {
        body = body.subarray(4 + body.readUInt32BE(0));
      }
    }

    return parseId3Frames(body, majorVersion);
  } catch {
    return {};
  } finally {
    await handle.close();
  }
}

async function readAudioMetadata(filePath) {
  const ext = path.extname(filePath).toLowerCase();
  if (ext === '.mp3') return readId3v2Metadata(filePath);
  return {};
}

function inferMetaFromFilename(sourcePath) {
  const stem = path.basename(sourcePath, path.extname(sourcePath));
  const parts = stem.split(/\s+-\s+/);

  if (parts.length >= 2) {
    return {
      artist: humanizeStem(parts[0]),
      title: humanizeStem(parts.slice(1).join(' - ')),
    };
  }

  return {
    artist: '',
    title: humanizeStem(stem),
  };
}

function sanitizeFilenameBase(value) {
  let base = cleanText(value).toLowerCase();
  base = base.normalize('NFKC');
  base = base.replace(/[^\p{L}\p{N}._-]+/gu, '-');
  base = base.replace(/-+/g, '-').replace(/^[.-]+|[.-]+$/g, '');
  return base.slice(0, 80) || 'track';
}

function normalizeFilename(rawFilename, sourceExt) {
  const rawBase = path.basename(rawFilename);
  const rawExt = path.extname(rawBase);
  const ext = (rawExt || sourceExt).toLowerCase();
  const base = sanitizeFilenameBase(path.basename(rawBase, rawExt));
  return `${base}${ext}`;
}

async function uniqueFilename(filename, reserved = new Set()) {
  const ext = path.extname(filename);
  const base = path.basename(filename, ext);
  let candidate = filename;
  let n = 2;

  while (existsSync(path.join(MUSIC_DIR, candidate)) || reserved.has(candidate.toLowerCase())) {
    candidate = `${base}-${n}${ext}`;
    n += 1;
  }

  return candidate;
}

async function sameFile(a, b) {
  try {
    const [aStat, bStat] = await Promise.all([fs.stat(a), fs.stat(b)]);
    return aStat.dev === bStat.dev && aStat.ino === bStat.ino;
  } catch {
    return false;
  }
}

async function readPlaylist() {
  if (!existsSync(PLAYLIST_PATH)) {
    throw new Error(`找不到歌单文件: ${path.relative(ROOT, PLAYLIST_PATH)}`);
  }

  const raw = await fs.readFile(PLAYLIST_PATH, 'utf-8');
  const data = JSON.parse(raw);
  const tracks = Array.isArray(data) ? data : data.tracks;

  if (!Array.isArray(tracks)) {
    throw new Error('playlist.json 需要是数组,或包含 tracks 数组');
  }

  return { data, tracks, isArrayRoot: Array.isArray(data) };
}

function nextTrackId(tracks) {
  const used = new Set(tracks.map((track) => String(track.id || '')));
  let max = 0;

  for (const id of used) {
    const match = /^track-(\d+)$/i.exec(id);
    if (match) max = Math.max(max, Number(match[1]));
  }

  let next = Math.max(max, tracks.length) + 1;
  let id = '';

  do {
    id = `track-${String(next).padStart(3, '0')}`;
    next += 1;
  } while (used.has(id));

  return id;
}

function buildPlaylistOutput(data, tracks, isArrayRoot) {
  if (isArrayRoot) return tracks;
  return { ...data, tracks };
}

function assertSupportedAudio(filePath) {
  const ext = path.extname(filePath).toLowerCase();
  if (!SUPPORTED_EXTS.has(ext)) {
    throw new Error(`不支持的音频格式: ${ext || '(无扩展名)'}. 建议使用 .mp3`);
  }
}

async function collectAudioFilesFromDir(dirPath, recursive) {
  const entries = await fs.readdir(dirPath, { withFileTypes: true });
  entries.sort((a, b) => a.name.localeCompare(b.name, 'zh-Hans-CN', { numeric: true }));

  const files = [];
  for (const entry of entries) {
    if (entry.name.startsWith('.')) continue;
    const fullPath = path.join(dirPath, entry.name);

    if (entry.isDirectory()) {
      if (recursive) {
        files.push(...await collectAudioFilesFromDir(fullPath, recursive));
      }
      continue;
    }

    if (!entry.isFile()) continue;
    if (SUPPORTED_EXTS.has(path.extname(entry.name).toLowerCase())) files.push(fullPath);
  }

  return files;
}

async function resolveSourceFiles(sourceArgs, options) {
  const allFiles = [];

  for (const arg of sourceArgs) {
    const sourcePath = path.resolve(ROOT, arg);
    if (!existsSync(sourcePath)) {
      throw new Error(`找不到路径: ${arg}`);
    }

    const stat = await fs.stat(sourcePath);
    if (stat.isDirectory()) {
      if (!options.batch) {
        throw new Error(`传入文件夹时请加 --batch: ${arg}`);
      }
      const files = await collectAudioFilesFromDir(sourcePath, !!options.recursive);
      allFiles.push(...files);
      continue;
    }

    if (!stat.isFile()) {
      throw new Error(`不是普通文件: ${arg}`);
    }

    assertSupportedAudio(sourcePath);
    allFiles.push(sourcePath);
  }

  const unique = [];
  const seen = new Set();
  for (const file of allFiles) {
    const key = fileKey(file);
    if (seen.has(key)) continue;
    seen.add(key);
    unique.push(file);
  }

  if (unique.length === 0) {
    throw new Error('没有找到可添加的音频文件');
  }

  return unique;
}

async function prepareTrack(sourcePath, options, tracks, reservedFilenames, bulkMode) {
  const sourceExt = path.extname(sourcePath).toLowerCase();
  const inferred = inferMetaFromFilename(sourcePath);
  const metadata = await readAudioMetadata(sourcePath);
  const title = cleanText(
    bulkMode
      ? (metadata.title || inferred.title || path.basename(sourcePath, sourceExt))
      : (options.title || metadata.title || inferred.title || path.basename(sourcePath, sourceExt))
  );
  const artist = cleanText(
    bulkMode
      ? (metadata.artist || inferred.artist || options.artist || '未知歌手')
      : (options.artist || metadata.artist || inferred.artist || '未知歌手')
  );
  const id = cleanText(bulkMode ? nextTrackId(tracks) : (options.id || nextTrackId(tracks)));

  if (tracks.some((track) => String(track.id || '') === id)) {
    throw new Error(`歌曲 id 已存在: ${id}`);
  }

  const sourceInMusicDir = isInside(MUSIC_DIR, sourcePath);
  let targetPath;
  let targetAlreadySameFile;

  if (sourceInMusicDir) {
    targetPath = sourcePath;
    targetAlreadySameFile = true;
  } else {
    const filenameSeed = options.filename
      ? options.filename
      : bulkMode
        ? path.basename(sourcePath)
        : title;

    const requestedFilename = normalizeFilename(filenameSeed, sourceExt);
    let finalFilename = requestedFilename;
    targetPath = path.join(MUSIC_DIR, finalFilename);
    targetAlreadySameFile = await sameFile(sourcePath, targetPath);

    if ((existsSync(targetPath) || reservedFilenames.has(finalFilename.toLowerCase())) && !targetAlreadySameFile) {
      if (!bulkMode && options.filename) {
        throw new Error(`目标文件已存在: assets/music/${finalFilename}`);
      }
      finalFilename = await uniqueFilename(finalFilename, reservedFilenames);
      targetPath = path.join(MUSIC_DIR, finalFilename);
      targetAlreadySameFile = await sameFile(sourcePath, targetPath);
    }

    reservedFilenames.add(finalFilename.toLowerCase());
  }

  const src = toWebPath(path.relative(ROOT, targetPath));
  const existingTrack = tracks.find((track) => String(track.src || '') === src);
  if (existingTrack) {
    return {
      status: 'skip',
      sourcePath,
      reason: `歌单里已经存在 ${src} (${existingTrack.title || existingTrack.id || '未命名'})`,
    };
  }

  const caseVariantTrack = options.sync
    ? tracks.find((track) => srcKey(track.src) === srcKey(src))
    : null;

  if (caseVariantTrack) {
    return {
      status: 'repair',
      sourcePath,
      track: caseVariantTrack,
      oldSrc: String(caseVariantTrack.src || ''),
      newSrc: src,
    };
  }

  return {
    status: 'add',
    sourcePath,
    targetPath,
    targetAlreadySameFile,
    newTrack: {
      id,
      title,
      artist,
      src,
      dateAdded: todayISO(),
      lyric: '歌词待补充',
    },
  };
}

function printPrepared(prepared, repaired, skipped) {
  console.log(`\n将要添加 ${prepared.length} 首歌曲:`);
  prepared.forEach((item, index) => {
    const track = item.newTrack;
    console.log(`  ${String(index + 1).padStart(2, '0')}. ${track.id} | ${track.title} - ${track.artist}`);
    console.log(`      src: ${track.src}`);
  });

  if (repaired.length > 0) {
    console.log(`\n将要修正 ${repaired.length} 个歌单路径:`);
    repaired.forEach((item) => {
      console.log(`  - ${item.oldSrc} -> ${item.newSrc}`);
    });
  }

  if (skipped.length > 0) {
    console.log(`\n跳过 ${skipped.length} 个文件:`);
    skipped.forEach((item) => {
      console.log(`  - ${displayPath(item.sourcePath)}: ${item.reason}`);
    });
  }
}

async function main() {
  const { sourceArgs, options } = parseArgs(process.argv.slice(2));

  if (options.help) {
    printHelp();
    return;
  }

  if (sourceArgs.length === 0 && !options.sync) {
    printHelp();
    throw new Error('请提供音频文件路径,或提供文件夹路径并加 --batch');
  }

  if (options.sync && sourceArgs.length > 0) {
    throw new Error('--sync 会自动扫描 assets/music/,不需要再传入文件或文件夹');
  }

  if (options.recursive && !options.batch && !options.sync) {
    throw new Error('--recursive 需要配合 --batch 或 --sync 使用');
  }

  await fs.mkdir(MUSIC_DIR, { recursive: true });

  const sourceFiles = options.sync
    ? await collectAudioFilesFromDir(MUSIC_DIR, !!options.recursive)
    : await resolveSourceFiles(sourceArgs, options);
  const bulkMode = options.sync || sourceFiles.length > 1 || !!options.batch;

  if (options.sync && (options.title || options.id || options.filename)) {
    throw new Error('--sync 不支持 --title、--id、--filename；这些信息会从音频元数据或文件名读取');
  }

  if (bulkMode && (options.title || options.id || options.filename)) {
    throw new Error('批量模式不支持 --title、--id、--filename；请用文件名表达每首歌的信息');
  }

  const { data, tracks, isArrayRoot } = await readPlaylist();
  const workingTracks = tracks.slice();
  const prepared = [];
  const repaired = [];
  const skipped = [];
  const reservedFilenames = new Set();

  for (const sourcePath of sourceFiles) {
    try {
      const result = await prepareTrack(sourcePath, options, workingTracks, reservedFilenames, bulkMode);
      if (result.status === 'skip') {
        skipped.push(result);
        continue;
      }

      if (result.status === 'repair') {
        repaired.push(result);
        continue;
      }

      prepared.push(result);
      workingTracks.push(result.newTrack);
    } catch (err) {
      if (!bulkMode) throw err;
      skipped.push({ sourcePath, reason: err.message });
    }
  }

  if (prepared.length === 0 && repaired.length === 0) {
    if (skipped.length > 0) printPrepared(prepared, repaired, skipped);
    if (bulkMode || options.dryRun) {
      console.log('\n没有可添加的新歌曲,playlist.json 未修改');
      return;
    }
    throw new Error('没有可添加的新歌曲');
  }

  printPrepared(prepared, repaired, skipped);

  if (options.dryRun) {
    console.log('\n--dry-run: 未复制文件,未修改 playlist.json');
    return;
  }

  for (const item of prepared) {
    if (!item.targetAlreadySameFile) {
      await fs.copyFile(item.sourcePath, item.targetPath);
      console.log(`已复制: ${displayPath(item.targetPath)}`);
    } else {
      console.log(`已在 assets/music/ 中,跳过复制: ${displayPath(item.targetPath)}`);
    }
  }

  for (const item of repaired) {
    item.track.src = item.newSrc;
    console.log(`已修正: ${item.oldSrc} -> ${item.newSrc}`);
  }

  const output = buildPlaylistOutput(data, workingTracks, isArrayRoot);
  await fs.writeFile(PLAYLIST_PATH, `${JSON.stringify(output, null, 2)}\n`, 'utf-8');

  console.log(`已更新: ${path.relative(ROOT, PLAYLIST_PATH)}`);
  console.log(`当前歌单: ${workingTracks.length} 首\n`);
}

main().catch((err) => {
  console.error(`\n添加失败: ${err.message}\n`);
  process.exit(1);
});
