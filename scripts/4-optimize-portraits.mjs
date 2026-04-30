// scripts/4-optimize-portraits.mjs
// Compress portrait + decoration assets (PNG → WebP) with transparency-safe encoding.
// Mirrors patterns from scripts/2-optimize-gallery.js.
//
// 行为:
//   - PNG 带 alpha   → lossless WebP (保护卡通脸/线稿细节)
//   - PNG 不透明     → 有损 WebP, q 按原图体积阶梯
//   - 已存在的 WebP  → 尝试重编码, 节省 >5% 才替换
//   - WebP 反而比 PNG 大 → 保留 PNG,丢 WebP
//   - 原图统一备份到 assets/_originals/<原相对路径>
//   - 跳过 _ 开头的子目录 (_unused / _originals 自身)

import { stat, readdir, mkdir, copyFile, unlink, rename } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';
import sharp from 'sharp';

const ROOT = process.cwd();
const ORIGINALS_DIR = path.join(ROOT, 'assets', '_originals');

const TARGETS = [
  { dir: 'assets/portrait/q',   label: 'Q 版人像' },
  { dir: 'assets/portrait/half', label: '半身人像' },
  { dir: 'assets/decoration',    label: '装饰图标' },
  { dir: 'assets/mood',          label: '心情头像' },
];

function pickQuality(bytes) {
  const mb = bytes / (1024 * 1024);
  if (mb >= 1.0) return 75;
  if (mb >= 0.5) return 80;
  if (mb >= 0.2) return 85;
  return 90;
}

function fmt(bytes) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(2)} MB`;
}

async function backupOriginal(absPath, relPath) {
  const dest = path.join(ORIGINALS_DIR, relPath);
  if (existsSync(dest)) return; // 已经备份过,幂等
  await mkdir(path.dirname(dest), { recursive: true });
  await copyFile(absPath, dest);
}

async function encodeWebP(srcPath, destPath, hasAlpha, origBytes) {
  const opts = hasAlpha
    ? { lossless: true, effort: 6, alphaQuality: 100 }
    : { quality: pickQuality(origBytes), effort: 6 };
  await sharp(srcPath).webp(opts).toFile(destPath);
}

async function processPNG(absPath, relPath) {
  const origBytes = (await stat(absPath)).size;
  const meta = await sharp(absPath).metadata();
  const hasAlpha = !!meta.hasAlpha;

  await backupOriginal(absPath, relPath);

  const webpPath = absPath.replace(/\.png$/i, '.webp');
  const tmpPath = webpPath + '.tmp';

  await encodeWebP(absPath, tmpPath, hasAlpha, origBytes);
  const newBytes = (await stat(tmpPath)).size;

  if (newBytes >= origBytes) {
    await unlink(tmpPath);
    return { kind: 'png-kept', orig: origBytes, alpha: hasAlpha };
  }

  // WebP 胜出 — 提升 tmp,删 PNG
  if (existsSync(webpPath)) await unlink(webpPath); // 防止旧 webp 重名占位
  await rename(tmpPath, webpPath);
  await unlink(absPath);
  return {
    kind: 'png-converted',
    orig: origBytes,
    new: newBytes,
    alpha: hasAlpha,
    saved: origBytes - newBytes,
  };
}

async function processWebP(absPath, relPath) {
  const origBytes = (await stat(absPath)).size;

  // 小于 50 KB 的 WebP 没必要再压
  if (origBytes < 50 * 1024) {
    return { kind: 'webp-skipped', orig: origBytes };
  }

  const meta = await sharp(absPath).metadata();
  const hasAlpha = !!meta.hasAlpha;

  const tmpPath = absPath + '.tmp';
  await encodeWebP(absPath, tmpPath, hasAlpha, origBytes);
  const newBytes = (await stat(tmpPath)).size;

  // 节省不足 5% 不替换 (防反复运行劣化)
  if (newBytes >= origBytes * 0.95) {
    await unlink(tmpPath);
    return { kind: 'webp-kept', orig: origBytes };
  }

  await backupOriginal(absPath, relPath);
  await rename(tmpPath, absPath);
  return {
    kind: 'webp-reencoded',
    orig: origBytes,
    new: newBytes,
    alpha: hasAlpha,
    saved: origBytes - newBytes,
  };
}

async function* walk(absDir) {
  const entries = await readdir(absDir, { withFileTypes: true });
  for (const e of entries) {
    if (e.name.startsWith('_')) continue; // 跳过 _originals / _unused
    if (e.name.startsWith('.')) continue; // 跳过 .DS_Store 等
    const full = path.join(absDir, e.name);
    if (e.isDirectory()) yield* walk(full);
    else if (e.isFile()) yield full;
  }
}

async function processTarget(target) {
  const absDir = path.join(ROOT, target.dir);
  if (!existsSync(absDir)) {
    console.log(`  ⊘ ${target.dir} 不存在,跳过`);
    return null;
  }

  console.log(`\n▸ ${target.label}  (${target.dir})`);
  const stats = {
    pngConverted: 0, pngKept: 0,
    webpReencoded: 0, webpKept: 0, webpSkipped: 0,
    saved: 0,
    renamed: [], // [{from, to, relDir}, ...]
  };

  for await (const filepath of walk(absDir)) {
    const ext = path.extname(filepath).toLowerCase();
    const relPath = path.relative(ROOT, filepath);
    const baseName = path.basename(filepath);

    try {
      if (ext === '.png') {
        const r = await processPNG(filepath, relPath);
        if (r.kind === 'png-converted') {
          stats.pngConverted++;
          stats.saved += r.saved;
          stats.renamed.push({
            from: baseName,
            to: baseName.replace(/\.png$/i, '.webp'),
            relDir: path.relative(ROOT, path.dirname(filepath)),
          });
          console.log(
            `  ✓ ${baseName}: PNG ${fmt(r.orig)} → WebP ${fmt(r.new)} (-${fmt(r.saved)}) ` +
            `${r.alpha ? '[α 无损]' : `[q=${pickQuality(r.orig)}]`}`
          );
        } else {
          stats.pngKept++;
          console.log(`  ↺ ${baseName}: WebP 反而更大,保留 PNG (${fmt(r.orig)})`);
        }
      } else if (ext === '.webp') {
        const r = await processWebP(filepath, relPath);
        if (r.kind === 'webp-reencoded') {
          stats.webpReencoded++;
          stats.saved += r.saved;
          console.log(
            `  ✓ ${baseName}: WebP ${fmt(r.orig)} → ${fmt(r.new)} (-${fmt(r.saved)}) [重编码]`
          );
        } else if (r.kind === 'webp-kept') {
          stats.webpKept++;
        } else {
          stats.webpSkipped++;
        }
      }
    } catch (err) {
      console.error(`  ✗ ${baseName}: ${err.message}`);
    }
  }

  console.log(
    `  小计: PNG 转换 ${stats.pngConverted}, 保留 PNG ${stats.pngKept}, ` +
    `WebP 重编码 ${stats.webpReencoded}, 节省 ${fmt(stats.saved)}`
  );
  return stats;
}

async function main() {
  console.log('━━━ 4-optimize-portraits ━━━');
  console.log(`原图备份目录: ${path.relative(ROOT, ORIGINALS_DIR)}`);

  await mkdir(ORIGINALS_DIR, { recursive: true });

  const totals = { saved: 0, converted: 0, reencoded: 0, allRenamed: [] };

  for (const t of TARGETS) {
    const s = await processTarget(t);
    if (!s) continue;
    totals.saved    += s.saved;
    totals.converted += s.pngConverted;
    totals.reencoded += s.webpReencoded;
    totals.allRenamed.push(...s.renamed);
  }

  console.log('\n━━━ 总计 ━━━');
  console.log(`PNG → WebP: ${totals.converted}  |  WebP 重编码: ${totals.reencoded}`);
  console.log(`总节省: ${fmt(totals.saved)}`);

  if (totals.allRenamed.length) {
    console.log('\n⚠ 以下 PNG 已转为 WebP,记得检查代码引用:');
    for (const r of totals.allRenamed) {
      console.log(`    ${r.relDir}/${r.from}  →  ${r.to}`);
    }
    const pattern = [...new Set(totals.allRenamed.map(r => r.from))]
      .map(n => n.replace(/\./g, '\\.'))
      .join('|');
    console.log('\n建议 grep:');
    console.log(`    grep -rEn "(${pattern})" --include="*.html" --include="*.js" --include="*.scss" --include="*.json" .`);
  } else {
    console.log('\n本次无 PNG 重命名,引用无需调整。');
  }

  console.log('\n确认页面正常后,可手动删 assets/_originals/portrait 与 _originals/decoration');
}

main().catch(err => {
  console.error('脚本错误:', err);
  process.exit(1);
});