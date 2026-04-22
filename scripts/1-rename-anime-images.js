// scripts/1-rename-anime-images.js (v2 - 智能压缩版)
// 改进：根据原图大小自动选择压缩质量；webp 反而变大时回退到保留原图

const sharp = require('sharp');
const path = require('path');
const fs = require('fs');

const ROOT = path.resolve(__dirname, '..');
const ANIMES_DIR = path.join(ROOT, 'assets/animes');
const ORIGINALS_DIR = path.join(ROOT, 'assets/_originals/animes');
const MAPPING_FILE = path.join(__dirname, 'rename-mapping.json');

const ANIME_RENAME_MAP = {
  majo: {
    cover: '魔女之旅2.jpg',
    gallery: ['魔女之旅.jpg', '魔女之旅1.jpg', '魔女之旅2.jpg', '魔女之旅3.jpg']
  },
  frieren: {
    cover: '葬送的芙莉莲.jpg',
    gallery: ['葬送的芙莉莲.jpg', '葬送的芙莉莲1.jpg', '葬送的芙莉莲2.jpg', '葬送的芙莉莲3.jpg']
  },
  garden: {
    cover: '紫罗兰永恒花园.jpg',
    gallery: ['紫罗兰永恒花园.jpg', '紫罗兰永恒花园1.jpg', '紫罗兰永恒花园2.jpg']
  },
  slayer: {
    cover: '鬼灭之刃.jpg',
    gallery: ['鬼灭之刃.jpg', '鬼灭之刃1.jpg', '鬼灭之刃2.jpg']
  },
  spy: {
    cover: '间谍过家家.jpg',
    gallery: ['间谍过家家.jpg', '间谍过家家1.jpg', '间谍过家家2.jpg', '间谍过家家3.jpg']
  },
  titan: {
    cover: '进击的巨人.jpg',
    gallery: ['进击的巨人.jpg', '进击的巨人1.jpg', '进击的巨人2.jpg', '进击的巨人3.jpg']
  },
  datebattle: {
    cover: '约会大作战.jpg',
    gallery: ['约会大作战.jpg', '约会大作战1.jpg', '约会大作战2.jpg', '约会大作战3.jpg']
  }
};

const MAX_WIDTH = 1920;

// 根据原图大小决定 webp 质量
function chooseQuality(originalSizeKB) {
  if (originalSizeKB > 500) return 92;       // 大图：高质量，正经压缩
  if (originalSizeKB > 200) return 85;       // 中图：平衡
  if (originalSizeKB > 100) return 82;       // 小图：略激进
  return 78;                                  // 极小图：进一步激进，反正画质本来一般
}

async function main() {
  console.log('\n' + '='.repeat(60));
  console.log('🎨 脚本 1 v2：智能压缩 + 重命名（assets/animes/）');
  console.log('='.repeat(60));

  if (!fs.existsSync(ANIMES_DIR)) {
    console.error(`❌ 目录不存在：${ANIMES_DIR}`);
    process.exit(1);
  }

  fs.mkdirSync(ORIGINALS_DIR, { recursive: true });

  const referenceMapping = {};
  let processed = 0;
  let skipped = 0;
  let losslessCount = 0;
  let fallbackCount = 0;
  let totalOriginal = 0;
  let totalCompressed = 0;
  const errors = [];

  for (const [animeId, config] of Object.entries(ANIME_RENAME_MAP)) {
    console.log(`\n━━━ ${animeId} ━━━`);

    const uniqueOldNames = new Set([config.cover, ...config.gallery]);

    for (const oldName of uniqueOldNames) {
      const oldPath = path.join(ANIMES_DIR, oldName);

      if (!fs.existsSync(oldPath)) {
        console.error(`  ❌ 文件不存在：${oldName}`);
        errors.push(oldName);
        continue;
      }

      // 决定新名字
      let newBaseName;
      if (oldName === config.cover) {
        newBaseName = `${animeId}-cover`;
      } else {
        const galleryIndex = config.gallery.indexOf(oldName);
        newBaseName = `${animeId}-${galleryIndex + 1}`;
      }

      const newWebpPath = path.join(ANIMES_DIR, newBaseName + '.webp');

      if (fs.existsSync(newWebpPath)) {
        console.log(`  ⏭️  已存在：${newBaseName}.webp`);
        skipped++;
        continue;
      }

      try {
        const stat = fs.statSync(oldPath);
        const originalSize = stat.size;
        const originalSizeKB = originalSize / 1024;

        // 决定模式和质量
        const metadata = await sharp(oldPath).metadata();
        const useLossless = metadata.format === 'png' && metadata.hasAlpha;
        const quality = chooseQuality(originalSizeKB);

        const pipeline = sharp(oldPath)
          .resize({ width: MAX_WIDTH, withoutEnlargement: true });

        // 先尝试转 webp
        if (useLossless) {
          await pipeline.webp({ lossless: true, effort: 6 }).toFile(newWebpPath);
        } else {
          await pipeline.webp({ quality, effort: 6 }).toFile(newWebpPath);
        }

        const newSize = fs.statSync(newWebpPath).size;

        // 安全网：如果 webp 比原图还大，放弃 webp，改为复制原图过来
        let finalPath = newWebpPath;
        let finalSize = newSize;
        let finalNewName = newBaseName + '.webp';
        let modeLabel;

        if (newSize >= originalSize * 0.95) {
          // webp 没什么收益（甚至变大），回退到保留原图（改名）
          fs.unlinkSync(newWebpPath);  // 删掉刚生成的 webp
          const ext = path.extname(oldName);  // 保留原扩展名
          finalNewName = newBaseName + ext;
          finalPath = path.join(ANIMES_DIR, finalNewName);
          fs.copyFileSync(oldPath, finalPath);
          finalSize = originalSize;
          modeLabel = '🔙保留';
          fallbackCount++;
        } else if (useLossless) {
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
          `  ✅ ${modeLabel} ${oldName} → ${finalNewName} (${originalSizeKB.toFixed(0)}KB → ${(finalSize/1024).toFixed(0)}KB, 省 ${saved}%)`
        );

        // 移动原图到备份
        const backupPath = path.join(ORIGINALS_DIR, oldName);
        fs.renameSync(oldPath, backupPath);

        // 记录映射（旧引用 → 新引用）
        // 注意：finalNewName 可能是 .webp 也可能是 .jpg/.png
      } catch (err) {
        console.error(`  ❌ 失败：${oldName} - ${err.message}`);
        errors.push(oldName);
      }
    }

    // 构建该动漫的引用映射
    // 这里需要根据实际生成的文件名来决定（可能是 .webp 也可能是 .jpg）
    // 重新扫描目录里的实际文件
    const coverWebp = `${animeId}-cover.webp`;
    const coverJpg = `${animeId}-cover.jpg`;
    const coverPng = `${animeId}-cover.png`;
    let coverFinalName;
    if (fs.existsSync(path.join(ANIMES_DIR, coverWebp))) coverFinalName = coverWebp;
    else if (fs.existsSync(path.join(ANIMES_DIR, coverJpg))) coverFinalName = coverJpg;
    else if (fs.existsSync(path.join(ANIMES_DIR, coverPng))) coverFinalName = coverPng;

    if (coverFinalName) {
      referenceMapping[`assets/animes/${config.cover}`] = `assets/animes/${coverFinalName}`;
    }

    config.gallery.forEach((oldName, index) => {
      if (oldName === config.cover) {
        // 指向 cover
        if (coverFinalName) {
          referenceMapping[`assets/animes/${oldName}`] = `assets/animes/${coverFinalName}`;
        }
      } else {
        const baseName = `${animeId}-${index + 1}`;
        const candidates = [`${baseName}.webp`, `${baseName}.jpg`, `${baseName}.png`];
        for (const candidate of candidates) {
          if (fs.existsSync(path.join(ANIMES_DIR, candidate))) {
            referenceMapping[`assets/animes/${oldName}`] = `assets/animes/${candidate}`;
            break;
          }
        }
      }
    });
  }

  fs.writeFileSync(MAPPING_FILE, JSON.stringify(referenceMapping, null, 2), 'utf-8');

  console.log('\n' + '='.repeat(60));
  console.log(`✨ 完成！`);
  console.log(`   📊 处理：${processed} 张`);
  console.log(`     ├─ 转 WebP 成功：${processed - fallbackCount - losslessCount} 张`);
  console.log(`     ├─ 无损 WebP：${losslessCount} 张`);
  console.log(`     └─ 回退保留原图：${fallbackCount} 张（webp 反而变大，没收益）`);
  console.log(`   ⏭️  跳过：${skipped} 张`);
  if (errors.length > 0) {
    console.log(`   ❌ 失败：${errors.length} 张`);
  }
  if (processed > 0) {
    const savedMB = ((totalOriginal - totalCompressed) / 1024 / 1024).toFixed(2);
    const ratio = ((1 - totalCompressed / totalOriginal) * 100).toFixed(1);
    console.log(`   💾 总体积：${(totalOriginal/1024/1024).toFixed(2)}MB → ${(totalCompressed/1024/1024).toFixed(2)}MB（省 ${savedMB}MB / ${ratio}%）`);
  }
  console.log(`   📁 原图已备份至：assets/_originals/animes/`);
  console.log(`   📄 映射表已生成：scripts/rename-mapping.json`);
  console.log('='.repeat(60));
  console.log('\n👉 下一步：抽查几张文件看画质，满意后跑 npm run update:refs\n');
}

main().catch(console.error);