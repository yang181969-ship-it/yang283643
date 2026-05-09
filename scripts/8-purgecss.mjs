import { PurgeCSS } from 'purgecss';
import fs from 'fs';
import path from 'path';

const outputDir = './css/purged';
if (!fs.existsSync(outputDir)) {
  fs.mkdirSync(outputDir, { recursive: true });
}

const result = await new PurgeCSS().purge({
  content: [
    './index.html',
    './html/**/*.html',
    './js/**/*.js',
  ],
  css: ['./css/style.css'],
  safelist: {
    standard: [
      'show', 'active', 'open', 'hidden', 'loaded',
      'upcoming', 'completed', 'ongoing',
      /^data-theme/,
    ],
    greedy: [
      /^wl-/,
      /^katex/,
      /^hljs/,
    ],
    deep: [
      /^wl-/,
      /^katex/,
    ],
  },
  variables: true,
});

for (const file of result) {
  const outputPath = path.join(outputDir, path.basename(file.file));
  fs.writeFileSync(outputPath, file.css);
  console.log(`✓ ${outputPath}`);

  // 对比体积
  const originalSize = fs.statSync(file.file).size;
  const newSize = file.css.length;
  const saved = ((1 - newSize / originalSize) * 100).toFixed(1);
  console.log(`  原始: ${(originalSize / 1024).toFixed(1)} KB`);
  console.log(`  清洗后: ${(newSize / 1024).toFixed(1)} KB`);
  console.log(`  节省: ${saved}%`);
}