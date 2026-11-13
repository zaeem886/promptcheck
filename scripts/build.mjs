import { build } from 'esbuild';
import { mkdir, rm, cp, readFile, writeFile, readdir } from 'node:fs/promises';
// Fixed build path, wholly inside this repository.
await rm(new URL('../build/', import.meta.url), { recursive: true, force: true });
await mkdir('build/vendor', { recursive: true });
await mkdir('build/scanner', { recursive: true });
await Promise.all([
  build({ entryPoints: ['src/content/index.js'], outfile: 'build/content/index.js', bundle: true, format: 'iife', target: 'chrome120', loader: { '.css': 'text' } }),
  build({ entryPoints: ['src/background.js'], outfile: 'build/background.js', bundle: true, format: 'iife', target: 'chrome120' }),
  build({ entryPoints: ['src/scanner/app.js', 'src/scanner/worker.js'], outdir: 'build/scanner', bundle: true, format: 'esm', target: 'chrome120' }),
  cp('src/manifest.json', 'build/manifest.json'),
  cp('src/scanner/index.html', 'build/scanner/index.html'), cp('src/scanner/style.css', 'build/scanner/style.css'),
  cp('src/scanner/findings.css', 'build/scanner/findings.css'),
  cp('node_modules/pdfjs-dist/legacy/build/pdf.worker.mjs', 'build/vendor/pdf.worker.mjs')
]);
await cp('node_modules/pdfjs-dist/LICENSE', 'build/vendor/PDFJS-LICENSE.txt');
await cp('node_modules/mammoth/LICENSE', 'build/vendor/MAMMOTH-LICENSE.txt');
await cp('node_modules/pdfjs-dist/cmaps', 'build/vendor/cmaps', { recursive: true });
await cp('node_modules/pdfjs-dist/standard_fonts', 'build/vendor/standard_fonts', { recursive: true });
const pkg = JSON.parse(await readFile('package-lock.json', 'utf8'));
let notices = 'Third-party notices for installed build dependencies. Not all packages are shipped at runtime.\n';
for (const [path, info] of Object.entries(pkg.packages)) {
  if (!path) continue;
  let files; try { files = await readdir(path); } catch { continue; }
  for (const file of files.filter(name => /^(licen[sc]e|copying|notice)(\.|$)/i.test(name))) {
    try { notices += `\n\n--- ${path} ${info.version} / ${file} ---\n${await readFile(`${path}/${file}`, 'utf8')}`; } catch {}
  }
}
await writeFile('build/vendor/THIRD_PARTY_NOTICES.txt', notices);
await writeFile('build/vendor/versions.json', JSON.stringify(Object.fromEntries(Object.entries(pkg.packages).filter(([k]) => /node_modules\/(pdfjs-dist|mammoth)$/.test(k)).map(([k,v]) => [k, v.version])), null, 2));
console.log('Production extension ready in build/');
