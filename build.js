// Bundles lib/three.min.js + src/*.js into a single self-contained index.html
const fs = require('fs'), path = require('path');
const root = __dirname;
const order = ['core', 'ocean', 'vfx', 'audio', 'ships', 'combat', 'perks', 'perks2', 'perks3', 'ui', 'main'];
const esc = s => s.replace(/<\/script/gi, '<\\/script');
let three = fs.readFileSync(path.join(root, 'lib/three.min.js'), 'utf8');
three = three.replace(/^console\.warn\([^\n]*?\);/, '');
let out = `<!DOCTYPE html>
<html lang="tr">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Kara Bayrak — Korsan Denizleri</title>
<style>html,body{margin:0;padding:0;width:100%;height:100%;overflow:hidden;background:#04121c;}canvas{display:block}</style>
</head>
<body>
<script>${esc(three)}</script>
`;
const missing = [];
for (const name of order) {
  const f = path.join(root, 'src', name + '.js');
  if (!fs.existsSync(f)) { missing.push(name); continue; }
  out += `<script>/* ===== ${name}.js ===== */\n${esc(fs.readFileSync(f, 'utf8'))}\n</script>\n`;
}
out += '</body>\n</html>\n';
fs.writeFileSync(path.join(root, 'index.html'), out);
console.log('index.html', (out.length / 1024).toFixed(0) + ' KB', missing.length ? 'MISSING: ' + missing.join(',') : 'all modules ok');
