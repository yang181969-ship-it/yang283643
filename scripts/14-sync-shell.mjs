import fs from 'node:fs';

// Build-time includes: full navigation and tool DOM exist before deferred scripts run.
const files = ['index.html', 'html/anime-detail.html', 'html/notes-detail.html', 'html/stats.html'];
for (const file of files) {
  let html = fs.readFileSync(file, 'utf8');
  for (const part of ['shell', 'tools']) {
    let template = fs.readFileSync(`templates/site-${part}.html`, 'utf8').trim();
    if (file.startsWith('html/')) {
      template = template.replace(/(href|src)="(index\.html[^"\s]*|assets\/[^"\s]*)"/g, '$1="../$2"');
    }
    const pattern = new RegExp(`(<!-- site-${part}:start -->)[\\s\\S]*?(<!-- site-${part}:end -->)`);
    if (!pattern.test(html)) throw new Error(`Missing ${part} markers in ${file}`);
    html = html.replace(pattern, (_, start, end) => `${start}\n${template}\n${end}`);
  }
  fs.writeFileSync(file, html);
}
console.log('Shared shell and tools synchronized in four documents.');
