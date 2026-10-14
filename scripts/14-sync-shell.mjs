import fs from 'node:fs';

// Build-time includes: full navigation and tool DOM exist before deferred scripts run.
const files = ['index.html', 'html/notes-detail.html', 'html/stats.html'];
for (const file of files) {
  let html = fs.readFileSync(file, 'utf8');
  // Keep each document's line endings so repeated syncs are byte-for-byte idempotent.
  const eol = html.includes('\r\n') ? '\r\n' : '\n';
  for (const part of ['shell', 'tools']) {
    let template = fs.readFileSync(`templates/site-${part}.html`, 'utf8').trim().replace(/\r?\n/g, eol);
    if (file.startsWith('html/')) {
      template = template.replace(/(href|src)="(index\.html[^"\s]*|assets\/[^"\s]*)"/g, '$1="../$2"');
    }
    const pattern = new RegExp(`(<!-- site-${part}:start -->)[\\s\\S]*?(<!-- site-${part}:end -->)`);
    if (!pattern.test(html)) throw new Error(`Missing ${part} markers in ${file}`);
    html = html.replace(pattern, (_, start, end) => `${start}${eol}${template}${eol}${end}`);
  }
  fs.writeFileSync(file, html);
}
console.log(`Shared shell and tools synchronized in ${files.length} documents.`);
