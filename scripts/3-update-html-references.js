// scripts/3-update-html-references.js
// 功能：根据脚本 1 生成的映射表，自动更新 anime.html 和 anime-detail.js
//   1. 读取 scripts/rename-mapping.json
//   2. 备份原文件为 .bak
//   3. 全局替换图片引用
//
// 用法：node scripts/3-update-html-references.js

const path = require('path');
const fs = require('fs');

const ROOT = path.resolve(__dirname, '..');
const MAPPING_FILE = path.join(__dirname, 'rename-mapping.json');

// 需要处理的文件列表
const TARGET_FILES = [
  'html/anime.html',
  'js/anime-detail.js',
];

function main() {
  console.log('\n' + '='.repeat(60));
  console.log('🔄 脚本 3：更新 HTML/JS 里的图片引用');
  console.log('='.repeat(60));

  if (!fs.existsSync(MAPPING_FILE)) {
    console.error(`❌ 找不到映射表：${MAPPING_FILE}`);
    console.error('   请先跑「脚本 1」生成映射表');
    process.exit(1);
  }

  const mapping = JSON.parse(fs.readFileSync(MAPPING_FILE, 'utf-8'));
  const mappingEntries = Object.entries(mapping);
  
  console.log(`\n📄 映射表加载完成，共 ${mappingEntries.length} 条规则\n`);

  let totalReplacements = 0;

  for (const relPath of TARGET_FILES) {
    const fullPath = path.join(ROOT, relPath);

    if (!fs.existsSync(fullPath)) {
      console.log(`⚠️  文件不存在，跳过：${relPath}`);
      continue;
    }

    let content = fs.readFileSync(fullPath, 'utf-8');
    const originalContent = content;
    let fileReplacements = 0;
    const replacementLog = [];

    for (const [oldRef, newRef] of mappingEntries) {
      // 在文件里搜索旧路径，可能带 ./ 或 ../ 前缀
      // oldRef 例如 "assets/animes/魔女之旅.jpg"
      // 文件里可能是 "./assets/animes/魔女之旅.jpg" 或 "../assets/animes/魔女之旅.jpg"
      
      // 我们做精确替换：只替换 "assets/animes/xxx" 这部分，前缀保留
      const escapedOld = oldRef.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      const regex = new RegExp(escapedOld, 'g');
      const matches = content.match(regex);
      
      if (matches) {
        content = content.replace(regex, newRef);
        fileReplacements += matches.length;
        replacementLog.push(`    ${matches.length}× ${oldRef} → ${newRef}`);
      }
    }

    if (fileReplacements > 0) {
      // 备份
      const backupPath = fullPath + '.bak';
      fs.writeFileSync(backupPath, originalContent, 'utf-8');
      // 写入新内容
      fs.writeFileSync(fullPath, content, 'utf-8');
      
      console.log(`✅ ${relPath}：替换了 ${fileReplacements} 处`);
      replacementLog.forEach(line => console.log(line));
      console.log(`   💾 原文件备份为：${relPath}.bak\n`);
      
      totalReplacements += fileReplacements;
    } else {
      console.log(`⏭️  ${relPath}：没有找到需要替换的引用\n`);
    }
  }

  console.log('='.repeat(60));
  console.log(`✨ 完成！总共替换了 ${totalReplacements} 处引用`);
  console.log('='.repeat(60));
  console.log('\n👉 下一步：');
  console.log('   1. 本地打开网站，测试动漫页和详情页所有图片是否正常显示');
  console.log('   2. 如果全部正常，可以删除 .bak 备份文件');
  console.log('   3. 如果有问题，把 .bak 文件改回原名恢复\n');
}

main();