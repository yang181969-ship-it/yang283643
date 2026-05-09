#!/usr/bin/env node
// Generate unified SVG covers for the local music playlist.

import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(SCRIPT_DIR, '..');
const PLAYLIST_PATH = path.join(ROOT, 'data', 'playlist.json');
const COVER_DIR = path.join(ROOT, 'assets', 'music', 'covers');
const COVER_SIZE = 1024;

const SYMBOL_THEME = {
  silence: {
    name: 'silence',
    bg: ['#151624', '#2f4055', '#567a8f'],
    glow: '#b8f3ff',
    accent: '#f7a1c4',
    ink: '#f8fbff',
  },
  countdown: {
    name: 'countdown',
    bg: ['#260f32', '#6d1238', '#f15b5b'],
    glow: '#ffd166',
    accent: '#f9a8d4',
    ink: '#fff7ed',
  },
  antler: {
    name: 'antler',
    bg: ['#10342f', '#1d6b55', '#8fcf9b'],
    glow: '#f7d060',
    accent: '#d9f99d',
    ink: '#f7fee7',
  },
  summer: {
    name: 'summer',
    bg: ['#0b5263', '#21b6a8', '#f7e177'],
    glow: '#fff3b0',
    accent: '#ff8a65',
    ink: '#f7fffb',
  },
  speed: {
    name: 'speed',
    bg: ['#151515', '#372136', '#d81e5b'],
    glow: '#f5c542',
    accent: '#f8fafc',
    ink: '#fff7ed',
  },
  mind: {
    name: 'mind',
    bg: ['#17133d', '#5b2a86', '#14b8a6'],
    glow: '#f0abfc',
    accent: '#67e8f9',
    ink: '#f5f3ff',
  },
  town: {
    name: 'town',
    bg: ['#27183e', '#7a3d5b', '#ea7a57'],
    glow: '#ffd166',
    accent: '#a7f3d0',
    ink: '#fff7ed',
  },
  bloom: {
    name: 'bloom',
    bg: ['#3f1237', '#a21caf', '#f472b6'],
    glow: '#fef3c7',
    accent: '#86efac',
    ink: '#fff1f7',
  },
  feather: {
    name: 'feather',
    bg: ['#102a43', '#2563eb', '#38bdf8'],
    glow: '#e0f2fe',
    accent: '#fef3c7',
    ink: '#eff6ff',
  },
  bubbles: {
    name: 'bubbles',
    bg: ['#0f2f45', '#0891b2', '#c084fc'],
    glow: '#cffafe',
    accent: '#f0abfc',
    ink: '#f0f9ff',
  },
  wind: {
    name: 'wind',
    bg: ['#17324d', '#3b82f6', '#99f6e4'],
    glow: '#dbeafe',
    accent: '#fcd34d',
    ink: '#f8fafc',
  },
  road: {
    name: 'road',
    bg: ['#242424', '#52633f', '#84cc16'],
    glow: '#facc15',
    accent: '#e5e7eb',
    ink: '#f7f7ec',
  },
  default: {
    name: 'default',
    bg: ['#253047', '#8b5cf6', '#22c55e'],
    glow: '#fef08a',
    accent: '#f9a8d4',
    ink: '#f8fafc',
  },
};

function parseArgs(argv) {
  return {
    dryRun: argv.includes('--dry-run'),
    noPlaylist: argv.includes('--no-playlist'),
  };
}

function toWebPath(absPath) {
  return path.relative(ROOT, absPath).split(path.sep).join('/');
}

function escapeXml(value) {
  return String(value ?? '').replace(/[&<>"']/g, (char) => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&apos;',
  }[char]));
}

function normalizeText(value) {
  return String(value || '').normalize('NFKC').trim();
}

function hashString(value) {
  let hash = 2166136261;
  for (const char of value) {
    hash ^= char.codePointAt(0);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

function inferSymbol(track) {
  const text = `${track.title || ''} ${track.artist || ''}`.toLowerCase();
  if (/silence|youseebiggirl/.test(text)) return 'silence';
  if (/倒数|countdown/.test(text)) return 'countdown';
  if (/鹿|be free/.test(text)) return 'antler';
  if (/夏日|summer|漱石/.test(text)) return 'summer';
  if (/\bf1\b|hans zimmer/.test(text)) return 'speed';
  if (/lose my mind/.test(text)) return 'mind';
  if (/童话|fairy|town/.test(text)) return 'town';
  if (/❀|花|flower/.test(text)) return 'bloom';
  if (/鳥|鸟|詩|诗/.test(text)) return 'feather';
  if (/泡沫|bubble/.test(text)) return 'bubbles';
  if (/起风|wind/.test(text)) return 'wind';
  if (/平凡|road|路/.test(text)) return 'road';
  return 'default';
}

function pickTheme(track) {
  const symbol = track.coverTheme?.symbol || inferSymbol(track);
  const base = SYMBOL_THEME[symbol] || SYMBOL_THEME.default;
  return {
    ...base,
    name: symbol,
    seed: hashString(`${track.id}|${track.title}|${track.artist}`),
  };
}

function splitTitle(title) {
  const cleanTitle = normalizeText(title || 'Untitled');
  const compact = cleanTitle.replace(/\s*\((.*?)\)\s*/g, ' ($1) ');
  const maxLineLength = /[A-Za-z0-9]/.test(compact) ? 20 : 10;
  const tokens = compact.includes(' ') ? compact.split(/\s+/) : [...compact];
  const lines = [];
  let current = '';

  for (const token of tokens) {
    const next = current ? `${current} ${token}` : token;
    if (next.length > maxLineLength && current) {
      lines.push(current);
      current = token;
      continue;
    }
    current = next;
  }

  if (current) lines.push(current);
  return lines.slice(0, 2);
}

function textLines(lines, startY, size, className) {
  return lines.map((line, index) => (
    `<text class="${className}" x="72" y="${startY + index * Math.round(size * 1.16)}">${escapeXml(line)}</text>`
  )).join('\n');
}

function buildPattern(theme) {
  const angle = 18 + (theme.seed % 24);
  const opacity = 0.1 + ((theme.seed % 9) / 100);
  return `
    <g class="cover-pattern" opacity="${opacity.toFixed(2)}" transform="rotate(-${angle} 512 512)">
      ${Array.from({ length: 11 }, (_, i) => {
        const x = -220 + i * 130;
        return `<rect x="${x}" y="-60" width="2" height="1160" rx="1" fill="${escapeXml(theme.ink)}"/>`;
      }).join('\n')}
    </g>
  `;
}

function symbolMarkup(theme) {
  const accent = escapeXml(theme.accent);
  const glow = escapeXml(theme.glow);
  const ink = escapeXml(theme.ink);

  switch (theme.name) {
    case 'silence':
      return `
        <g class="cover-symbol" fill="none" stroke-linecap="round">
          <path d="M256 512 C352 406 448 618 512 512 C576 406 672 618 768 512" stroke="${glow}" stroke-width="18"/>
          <path d="M512 296 V728" stroke="${accent}" stroke-width="10" opacity="0.72"/>
          <circle cx="512" cy="512" r="174" stroke="${ink}" stroke-width="2" opacity="0.24"/>
        </g>
      `;
    case 'countdown':
      return `
        <g class="cover-symbol">
          <circle cx="512" cy="480" r="220" fill="none" stroke="${glow}" stroke-width="8" opacity="0.7"/>
          <circle cx="512" cy="480" r="156" fill="none" stroke="${ink}" stroke-width="2" opacity="0.3"/>
          <text x="512" y="548" text-anchor="middle" class="cover-symbol-text" font-size="228">10</text>
          <path d="M512 258 A222 222 0 0 1 734 480" fill="none" stroke="${accent}" stroke-width="22" stroke-linecap="round"/>
        </g>
      `;
    case 'antler':
      return `
        <g class="cover-symbol" fill="none" stroke-linecap="round" stroke-linejoin="round">
          <path d="M512 660 C472 578 452 504 464 420 C474 348 418 312 376 270" stroke="${glow}" stroke-width="16"/>
          <path d="M512 660 C552 578 572 504 560 420 C550 348 606 312 648 270" stroke="${glow}" stroke-width="16"/>
          <path d="M462 432 C410 420 362 384 336 338 M558 432 C610 420 658 384 684 338" stroke="${accent}" stroke-width="12"/>
          <path d="M478 358 C444 334 422 296 416 258 M546 358 C580 334 602 296 608 258" stroke="${ink}" stroke-width="9" opacity="0.56"/>
        </g>
      `;
    case 'summer':
      return `
        <g class="cover-symbol" fill="none" stroke-linecap="round">
          <circle cx="512" cy="390" r="118" fill="${glow}" opacity="0.78"/>
          <path d="M238 602 C310 546 390 660 462 602 S614 546 686 602 S806 660 862 604" stroke="${ink}" stroke-width="16"/>
          <path d="M244 662 C320 608 392 720 468 662 S616 608 692 662 S808 720 864 664" stroke="${accent}" stroke-width="10" opacity="0.82"/>
        </g>
      `;
    case 'speed':
      return `
        <g class="cover-symbol" fill="none" stroke-linecap="round">
          <path d="M214 642 C420 268 680 256 816 456 C920 610 796 768 604 716 C482 684 486 542 610 520 C700 504 752 554 760 626" stroke="${glow}" stroke-width="18"/>
          <path d="M178 398 H458 M154 500 H382 M210 604 H354" stroke="${ink}" stroke-width="12" opacity="0.68"/>
          <path d="M632 424 L796 338" stroke="${accent}" stroke-width="12"/>
        </g>
      `;
    case 'mind':
      return `
        <g class="cover-symbol" fill="none" stroke-linecap="round">
          <path d="M512 320 C628 320 704 414 680 524 C656 636 514 704 408 640 C310 580 318 442 410 400 C490 364 584 408 584 500 C584 574 498 612 444 572 C398 538 406 474 454 454" stroke="${glow}" stroke-width="17"/>
          <circle cx="512" cy="512" r="246" stroke="${ink}" stroke-width="2" opacity="0.22"/>
          <circle cx="690" cy="334" r="20" fill="${accent}" opacity="0.86"/>
        </g>
      `;
    case 'town':
      return `
        <g class="cover-symbol" fill="none" stroke-linecap="round" stroke-linejoin="round">
          <path d="M270 602 L270 486 L360 410 L450 486 L450 602 Z" fill="${ink}" opacity="0.28" stroke="${ink}" stroke-width="8"/>
          <path d="M454 602 L454 432 L574 342 L694 432 L694 602 Z" fill="${glow}" opacity="0.28" stroke="${glow}" stroke-width="8"/>
          <path d="M690 602 L690 506 L764 448 L838 506 L838 602 Z" fill="${accent}" opacity="0.24" stroke="${accent}" stroke-width="8"/>
          <path d="M336 298 L352 332 L388 338 L362 364 L368 400 L336 382 L304 400 L310 364 L284 338 L320 332 Z" fill="${glow}" stroke="none"/>
        </g>
      `;
    case 'bloom':
      return `
        <g class="cover-symbol">
          ${[0, 60, 120, 180, 240, 300].map((angle) => (
            `<ellipse cx="512" cy="430" rx="70" ry="178" fill="${glow}" opacity="0.42" transform="rotate(${angle} 512 512)"/>`
          )).join('\n')}
          <circle cx="512" cy="512" r="74" fill="${accent}" opacity="0.82"/>
          <circle cx="512" cy="512" r="24" fill="${ink}" opacity="0.76"/>
        </g>
      `;
    case 'feather':
      return `
        <g class="cover-symbol" fill="none" stroke-linecap="round" stroke-linejoin="round">
          <path d="M612 244 C424 310 340 474 402 652 C552 626 710 514 744 312 C708 258 666 236 612 244 Z" fill="${glow}" opacity="0.28" stroke="${glow}" stroke-width="10"/>
          <path d="M704 298 C596 416 488 534 362 704" stroke="${ink}" stroke-width="12"/>
          <path d="M594 414 L696 410 M530 492 L650 506 M470 570 L590 604" stroke="${accent}" stroke-width="9" opacity="0.72"/>
        </g>
      `;
    case 'bubbles':
      return `
        <g class="cover-symbol" fill="none">
          <circle cx="420" cy="514" r="142" stroke="${glow}" stroke-width="14" opacity="0.76"/>
          <circle cx="628" cy="430" r="104" stroke="${accent}" stroke-width="12" opacity="0.72"/>
          <circle cx="650" cy="628" r="72" stroke="${ink}" stroke-width="10" opacity="0.56"/>
          <circle cx="350" cy="342" r="42" stroke="${ink}" stroke-width="8" opacity="0.42"/>
          <circle cx="752" cy="322" r="30" fill="${glow}" opacity="0.46"/>
        </g>
      `;
    case 'wind':
      return `
        <g class="cover-symbol" fill="none" stroke-linecap="round">
          <path d="M226 424 C366 342 494 506 636 402 C702 354 772 356 828 394" stroke="${glow}" stroke-width="16"/>
          <path d="M180 528 C330 438 458 626 610 520 C678 472 762 472 846 526" stroke="${ink}" stroke-width="13" opacity="0.72"/>
          <path d="M250 636 C374 570 466 694 594 626 C642 600 700 596 762 620" stroke="${accent}" stroke-width="10" opacity="0.82"/>
        </g>
      `;
    case 'road':
      return `
        <g class="cover-symbol">
          <path d="M438 760 L500 306 H524 L586 760 Z" fill="${ink}" opacity="0.34"/>
          <path d="M512 340 L512 728" stroke="${glow}" stroke-width="10" stroke-linecap="round" stroke-dasharray="42 34"/>
          <path d="M230 760 C352 604 418 456 492 306 M794 760 C672 604 606 456 532 306" fill="none" stroke="${accent}" stroke-width="8" opacity="0.58"/>
        </g>
      `;
    default:
      return `
        <g class="cover-symbol" fill="none" stroke-linecap="round">
          <circle cx="512" cy="512" r="186" stroke="${glow}" stroke-width="14"/>
          <path d="M356 548 C430 432 588 432 666 548" stroke="${accent}" stroke-width="15"/>
          <path d="M426 390 V642 M598 390 V642" stroke="${ink}" stroke-width="11" opacity="0.62"/>
        </g>
      `;
  }
}

function renderSvg(track, index) {
  const theme = pickTheme(track);
  const title = normalizeText(track.title || track.id);
  const artist = normalizeText(track.artist || '');
  const titleLines = splitTitle(title);
  const number = String(index + 1).padStart(3, '0');
  const gradientId = `bg-${track.id}`;
  const label = `${title} - ${artist}`;

  return `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="${COVER_SIZE}" height="${COVER_SIZE}" viewBox="0 0 ${COVER_SIZE} ${COVER_SIZE}" role="img" aria-label="${escapeXml(label)}">
  <defs>
    <linearGradient id="${gradientId}" x1="0%" y1="0%" x2="100%" y2="100%">
      <stop offset="0%" stop-color="${escapeXml(theme.bg[0])}"/>
      <stop offset="55%" stop-color="${escapeXml(theme.bg[1])}"/>
      <stop offset="100%" stop-color="${escapeXml(theme.bg[2])}"/>
    </linearGradient>
    <radialGradient id="light-${track.id}" cx="34%" cy="22%" r="68%">
      <stop offset="0%" stop-color="${escapeXml(theme.glow)}" stop-opacity="0.72"/>
      <stop offset="56%" stop-color="${escapeXml(theme.glow)}" stop-opacity="0.12"/>
      <stop offset="100%" stop-color="${escapeXml(theme.glow)}" stop-opacity="0"/>
    </radialGradient>
    <filter id="grain-${track.id}" x="-20%" y="-20%" width="140%" height="140%">
      <feTurbulence type="fractalNoise" baseFrequency="0.76" numOctaves="3" stitchTiles="stitch"/>
      <feColorMatrix type="saturate" values="0"/>
      <feComponentTransfer>
        <feFuncA type="table" tableValues="0 0.18"/>
      </feComponentTransfer>
    </filter>
    <style>
      .cover-title,
      .cover-artist,
      .cover-code,
      .cover-symbol-text {
        font-family: "Inter", "Noto Sans SC", "Microsoft YaHei", "PingFang SC", Arial, sans-serif;
        letter-spacing: 0;
      }
      .cover-title { fill: ${escapeXml(theme.ink)}; font-size: 68px; font-weight: 800; }
      .cover-artist { fill: ${escapeXml(theme.ink)}; font-size: 32px; font-weight: 600; opacity: 0.78; }
      .cover-code { fill: ${escapeXml(theme.ink)}; font-size: 24px; font-weight: 700; opacity: 0.5; }
      .cover-symbol { opacity: 0.92; }
      .cover-symbol-text { fill: ${escapeXml(theme.ink)}; font-weight: 900; opacity: 0.9; }
    </style>
  </defs>
  <rect width="${COVER_SIZE}" height="${COVER_SIZE}" rx="84" fill="url(#${gradientId})"/>
  <rect width="${COVER_SIZE}" height="${COVER_SIZE}" rx="84" fill="url(#light-${track.id})"/>
  <rect width="${COVER_SIZE}" height="${COVER_SIZE}" rx="84" filter="url(#grain-${track.id})" opacity="0.42"/>
  <circle cx="${210 + (theme.seed % 100)}" cy="${186 + (theme.seed % 70)}" r="210" fill="${escapeXml(theme.glow)}" opacity="0.17"/>
  <circle cx="${780 - (theme.seed % 80)}" cy="${654 - (theme.seed % 90)}" r="280" fill="${escapeXml(theme.accent)}" opacity="0.13"/>
  ${buildPattern(theme)}
  ${symbolMarkup(theme)}
  <rect x="44" y="44" width="936" height="936" rx="58" fill="none" stroke="${escapeXml(theme.ink)}" stroke-opacity="0.16" stroke-width="2"/>
  ${textLines(titleLines, 746, 68, 'cover-title')}
  <text class="cover-artist" x="72" y="${822 + Math.max(0, titleLines.length - 1) * 78}">${escapeXml(artist)}</text>
  <text class="cover-code" x="72" y="936">Y181 MUSIC / ${number}</text>
</svg>
`;
}

async function readPlaylist() {
  const raw = await fs.readFile(PLAYLIST_PATH, 'utf8');
  const data = JSON.parse(raw);
  if (!Array.isArray(data.tracks)) {
    throw new Error('data/playlist.json must contain a tracks array.');
  }
  return data;
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  const playlist = await readPlaylist();
  await fs.mkdir(COVER_DIR, { recursive: true });

  let changedPlaylist = false;
  const generated = [];

  for (const [index, track] of playlist.tracks.entries()) {
    const id = normalizeText(track.id || `track-${String(index + 1).padStart(3, '0')}`);
    const filename = `${id}.svg`;
    const absCoverPath = path.join(COVER_DIR, filename);
    const coverPath = toWebPath(absCoverPath);
    const svg = renderSvg({ ...track, id }, index);

    if (!options.dryRun) {
      await fs.writeFile(absCoverPath, svg, 'utf8');
    }

    if (track.cover !== coverPath) {
      track.cover = coverPath;
      changedPlaylist = true;
    }

    generated.push(coverPath);
  }

  if (changedPlaylist && !options.noPlaylist && !options.dryRun) {
    await fs.writeFile(PLAYLIST_PATH, `${JSON.stringify(playlist, null, 2)}\n`, 'utf8');
  }

  console.log(`Generated ${generated.length} SVG music covers.`);
  generated.forEach((item) => console.log(`- ${item}`));

  if (changedPlaylist && options.noPlaylist) {
    console.log('Playlist changes were skipped because --no-playlist was set.');
  } else if (changedPlaylist && !options.dryRun) {
    console.log('Updated data/playlist.json cover fields.');
  } else if (options.dryRun) {
    console.log('--dry-run: no files were written.');
  }
}

main().catch((err) => {
  console.error(`Failed to generate music covers: ${err.message}`);
  process.exit(1);
});
