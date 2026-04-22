// scripts/2-optimize-gallery.js (v2.1 - 修复 Windows 子目录扫描)
// 改进：根据原图大小动态选择质量；webp 反而变大时回退到保留原图
//      修复 Windows 上 glob 模式扫描子目录的问题

const sharp = require('sharp');
const { glob } = require('glob');
const path = require('path');
const fs = require('fs');

const ROOT = path.resolve(__dirname, '..');
const GALLERY_DIR = path.join(ROOT, 'assets/gallery');
const ORIGINALS_DIR = path.join(ROOT, 'assets/_originals/gallery');

const MAX_WIDTH = 1920;
const SKIP_IF_SMALLER_THAN = 50 * 1024;

function chooseQuality(originalSizeKB) {
  if (originalSizeKB > 500) return 92;
  if (originalSizeKB > 200) return 85;
  if (originalSizeKB > 100) return 82;
  return 78;
}

async function main() {
  console.log('\n' + '='.repeat(60));
  console.log('🎨 脚本 2 v2.1：智能压缩（assets/gallery/）');
  console.log('='.repeat(60));

  if (!fs.existsSync(GALLERY_DIR)) {
    console.error(`❌ 目录不存在：${GALLERY_DIR}`);
    process.exit(1);
  }

  fs.mkdirSync(ORIGINALS_DIR, { recursive: true });

  // 修复：用 cwd 选项 + 路径标准化，确保跨平台稳定扫描子目录
  const galleryGlob = GALLERY_DIR.replace(/\\/g, '/');
  const files = await glob('**/*.{jpg,jpeg,png,JPG,JPEG,PNG}', {
    cwd: galleryGlob,
    absolute: true,
    nodir: true,
  });

  console.log(`\n📁 找到 ${files.length} 张图片\n`);

  // 调试：如果还是 0,打印目录内容帮助排查
  if (files.length === 0) {
    console.log('🔍 调试信息：');
    console.log(`   GALLERY_DIR = ${GALLERY_DIR}`);
    console.log(`   目录内容：`);
    try {
      const subDirs = fs.readdirSync(GALLERY_DIR);
      subDirs.forEach(item => {
        const itemPath = path.join(GALLERY_DIR, item);
        const isDir = fs.statSync(itemPath).isDirectory();
        console.log(`     - ${item} ${isDir ? '(目录)' : '(文件)'}`);
        if (isDir) {
          const subItems = fs.readdirSync(itemPath);
          subItems.slice(0, 5).forEach(sub => console.log(`         └─ ${sub}`));
          if (subItems.length > 5) console.log(`         └─ ...还有 ${subItems.length - 5} 个`);
        }
      });
    } catch (e) {
      console.log(`     无法读取：${e.message}`);
    }
    return;
  }

  let processed = 0;
  let skipped = 0;
  let losslessCount = 0;
  let fallbackCount = 0;
  let totalOriginal = 0;
  let totalCompressed = 0;

  for (const file of files) {
    const stat = fs.statSync(file);
    const originalSize = stat.size;
    const originalSizeKB = originalSize / 1024;
    const relativeName = path.relative(GALLERY_DIR, file);

    if (originalSize < SKIP_IF_SMALLER_THAN) {
      console.log(`  ⏭️  跳过（已够小）：${relativeName} (${originalSizeKB.toFixed(1)}KB)`);
      skipped++;
      continue;
    }

    const ext = path.extname(file);
    const webpPath = file.replace(ext, '.webp');

    if (fs.existsSync(webpPath)) {
      console.log(`  ⏭️  已存在 webp：${path.basename(webpPath)}`);
      skipped++;
      continue;
    }

    try {
      const metadata = await sharp(file).metadata();
      const useLossless = metadata.format === 'png' && metadata.hasAlpha;
      const quality = chooseQuality(originalSizeKB);

      const pipeline = sharp(file).resize({ width: MAX_WIDTH, withoutEnlargement: true });

      if (useLossless) {
        await pipeline.webp({ lossless: true, effort: 6 }).toFile(webpPath);
      } else {
        await pipeline.webp({ quality, effort: 6 }).toFile(webpPath);
      }

      const newSize = fs.statSync(webpPath).size;
      let finalSize = newSize;
      let modeLabel;

      if (newSize >= originalSize * 0.95) {
        // webp 没收益，删掉，原图保留在原位
        fs.unlinkSync(webpPath);
        finalSize = originalSize;
        modeLabel = '🔙保留';
        fallbackCount++;
        console.log(
          `  ✅ ${modeLabel} ${relativeName}（webp 无收益，保留原图 ${ext}）`
        );
        totalOriginal += originalSize;
        totalCompressed += finalSize;
        processed++;
      } else {
        if (useLossless) {
          modeLabel = '🔒无损';
          losslessCount++;
        } else {
          modeLabel = `✨q${quality}`;
        }

        const saved = ((1 - finalSize / originalSize) * 100).toFixed(1);
        totalOriginal += originalSize;
        totalCompressed += finalSize;
        processed++;

        console.log(
          `  ✅ ${modeLabel} ${relativeName}: ${originalSizeKB.toFixed(0)}KB → ${(finalSize/1024).toFixed(0)}KB (省 ${saved}%)`
        );

        // 转换成功的，原图移动到备份
        const backupPath = path.join(ORIGINALS_DIR, relativeName);
        fs.mkdirSync(path.dirname(backupPath), { recursive: true });
        fs.renameSync(file, backupPath);
      }
    } catch (err) {
      console.error(`  ❌ 失败：${file} - ${err.message}`);
    }
  }

  console.log('\n' + '='.repeat(60));
  console.log(`✨ 完成！`);
  console.log(`   📊 处理：${processed} 张`);
  console.log(`     ├─ 转 WebP 成功：${processed - fallbackCount - losslessCount} 张`);
  console.log(`     ├─ 无损 WebP：${losslessCount} 张`);
  console.log(`     └─ 回退保留原图：${fallbackCount} 张`);
  console.log(`   ⏭️  跳过：${skipped} 张（体积已经够小）`);
  if (processed > 0) {
    const savedMB = ((totalOriginal - totalCompressed) / 1024 / 1024).toFixed(2);
    const ratio = ((1 - totalCompressed / totalOriginal) * 100).toFixed(1);
    console.log(`   💾 总体积：${(totalOriginal/1024/1024).toFixed(2)}MB → ${(totalCompressed/1024/1024).toFixed(2)}MB（省 ${savedMB}MB / ${ratio}%）`);
  }
  console.log(`   📁 转换成功的原图已备份至：assets/_originals/gallery/`);
  console.log('='.repeat(60));
  console.log('\n👉 下一步：跑 python generate_gallery_data.py 更新 gallery-data.js\n');
}

main().catch(console.error);