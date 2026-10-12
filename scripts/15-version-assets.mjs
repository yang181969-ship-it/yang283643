import fs from 'node:fs';
import crypto from 'node:crypto';

// Stamp local JS/CSS references with a content hash (?v=xxxxxxxx).
// The shared shell depends on several scripts agreeing with the HTML; without a
// version, a browser or edge cache can pair new markup with an older script.
// Runs after CSS is compiled (postinline:critical), so style.css hashes are final.
const files = ['index.html', 'html/anime-detail.html', 'html/notes-detail.html', 'html/stats.html'];
const hashes = new Map();
function versionOf(asset) {
  if (!hashes.has(asset)) {
    hashes.set(asset, crypto.createHash('sha1').update(fs.readFileSync(asset)).digest('hex').slice(0, 8));
  }
  return hashes.get(asset);
}

let changed = 0;
for (const file of files) {
  const html = fs.readFileSync(file, 'utf8');
  const next = html.replace(/(src|href)="((?:\.\.\/)?)((?:js|css)\/[\w.-]+\.(?:js|css))(?:\?[^"]*)?"/g,
    (match, attr, prefix, asset) => fs.existsSync(asset) ? `${attr}="${prefix}${asset}?v=${versionOf(asset)}"` : match);
  if (next !== html) { fs.writeFileSync(file, next); changed++; }
}
console.log(`Asset versions stamped (${hashes.size} assets, ${changed} documents updated).`);
