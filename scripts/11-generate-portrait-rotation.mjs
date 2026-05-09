// scripts/11-generate-portrait-rotation.mjs
// Generate the daily portrait rotation order used by the home page cards.

import { readdir, mkdir, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';

const ROOT = process.cwd();
const OUTPUT = path.join(ROOT, 'data', 'portrait-rotation.json');
const IMAGE_EXTS = new Set(['.webp', '.png', '.jpg', '.jpeg', '.avif']);
const SETS = {
  q: 'assets/portrait/q',
  half: 'assets/portrait/half',
};

function parseArgs(argv) {
  const opts = {
    startDate: localDateKey(new Date()),
    seed: null,
    dryRun: false,
  };

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--start-date') {
      opts.startDate = argv[++i];
    } else if (arg === '--seed') {
      opts.seed = argv[++i];
    } else if (arg === '--dry-run') {
      opts.dryRun = true;
    } else if (arg === '--help' || arg === '-h') {
      printHelp();
      process.exit(0);
    } else {
      throw new Error(`Unknown option: ${arg}`);
    }
  }

  if (!/^\d{4}-\d{2}-\d{2}$/.test(opts.startDate)) {
    throw new Error('--start-date must use YYYY-MM-DD');
  }

  opts.seed = opts.seed || `portrait-rotation:${opts.startDate}`;
  return opts;
}

function printHelp() {
  console.log(`
Usage:
  node scripts/11-generate-portrait-rotation.mjs [--start-date YYYY-MM-DD] [--seed TEXT] [--dry-run]

Options:
  --start-date  First day of the generated cycle. Defaults to today.
  --seed        Stable shuffle seed. Defaults to "portrait-rotation:<start-date>".
  --dry-run     Print the generated JSON without writing it.
`);
}

function localDateKey(date) {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

function hashString(input) {
  let h = 2166136261;
  for (let i = 0; i < input.length; i++) {
    h ^= input.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

function mulberry32(seed) {
  return function next() {
    let t = seed += 0x6D2B79F5;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function naturalCompare(a, b) {
  return a.localeCompare(b, undefined, { numeric: true, sensitivity: 'base' });
}

function seededShuffle(items, seedText) {
  const rand = mulberry32(hashString(seedText));
  const out = [...items];
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

async function listImages(relDir) {
  const absDir = path.join(ROOT, relDir);
  if (!existsSync(absDir)) {
    throw new Error(`${relDir} does not exist`);
  }

  const entries = await readdir(absDir, { withFileTypes: true });
  return entries
    .filter(entry => entry.isFile())
    .map(entry => entry.name)
    .filter(name => IMAGE_EXTS.has(path.extname(name).toLowerCase()))
    .sort(naturalCompare)
    .map(name => `${relDir}/${name}`.replace(/\\/g, '/'));
}

async function main() {
  const opts = parseArgs(process.argv.slice(2));
  const sets = {};

  for (const [name, relDir] of Object.entries(SETS)) {
    const images = await listImages(relDir);
    if (!images.length) {
      throw new Error(`${relDir} has no supported images`);
    }
    sets[name] = seededShuffle(images, `${opts.seed}:${name}`);
  }

  const data = {
    version: 1,
    startDate: opts.startDate,
    timezone: 'browser-local',
    generatedAt: new Date().toISOString(),
    seed: opts.seed,
    sets,
  };

  const json = `${JSON.stringify(data, null, 2)}\n`;

  if (opts.dryRun) {
    process.stdout.write(json);
    return;
  }

  await mkdir(path.dirname(OUTPUT), { recursive: true });
  await writeFile(OUTPUT, json, 'utf8');

  console.log(`Generated ${path.relative(ROOT, OUTPUT)}`);
  for (const [name, images] of Object.entries(sets)) {
    console.log(`  ${name}: ${images.length} images`);
  }
}

main().catch(err => {
  console.error(`portrait rotation failed: ${err.message}`);
  process.exit(1);
});
