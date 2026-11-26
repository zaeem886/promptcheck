import { build } from 'esbuild';
import { mkdir, rm, cp, readFile, writeFile, readdir } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import JSZip from 'jszip';
import { MODEL_CATEGORIES } from '../src/shared/hybrid.js';

const modelBundle = 'ml/promptprivacy-global (1).zip';
const archive = await JSZip.loadAsync(await readFile(modelBundle));
const model = await archive.file('model.onnx').async('nodebuffer');
const config = JSON.parse(await archive.file('manifest.json').async('string'));
const tags = ['O', ...Object.keys(MODEL_CATEGORIES).flatMap(label => ['B-' + label, 'I-' + label])];
if (config.format !== 'promptprivacy-char-cnn-v1' || config.smoke_run !== false ||
    config.model_sha256 !== createHash('sha256').update(model).digest('hex') ||
    JSON.stringify(config.tags) !== JSON.stringify(tags) || config.core !== 256 || config.halo !== 64 ||
    config.buckets !== 4096 || JSON.stringify(config.shape_groups) !== JSON.stringify(['Nd', 'Lu', 'Ll', 'L', 'M', 'P', 'Z', 'other']) ||
    !(config.min_span_score > 0 && config.min_span_score <= 1)) {
  throw new Error('Invalid PromptPrivacy model or configuration in ' + modelBundle);
}

// Fixed build path, wholly inside this repository.
await rm(new URL('../build/', import.meta.url), { recursive: true, force: true });
const ortFiles = ['ort.wasm.min.mjs', 'ort-wasm-simd-threaded.mjs', 'ort-wasm-simd-threaded.wasm'];
await Promise.all(['vendor/onnxruntime', 'scanner', 'ml'].map(path => mkdir('build/' + path, { recursive: true })));
await Promise.all([
  build({ entryPoints: ['src/content/index.js'], outfile: 'build/content/index.js', bundle: true, format: 'iife', target: 'chrome120', loader: { '.css': 'text' } }),
  build({ entryPoints: ['src/background.js'], outfile: 'build/background.js', bundle: true, format: 'iife', target: 'chrome120' }),
  build({ entryPoints: ['src/scanner/app.js', 'src/scanner/worker.js'], outdir: 'build/scanner', bundle: true, format: 'esm', target: 'chrome120' }),
  build({ entryPoints: ['src/ml/offscreen.js', 'src/ml/worker.js'], outdir: 'build/ml', bundle: true, format: 'esm', target: 'chrome120',
    external: ['../vendor/onnxruntime/ort.wasm.min.mjs'] }),
  cp('src/ml/offscreen.html', 'build/ml/offscreen.html'),
  writeFile('build/ml/model.onnx', model),
  writeFile('build/ml/model.json', JSON.stringify(config, null, 2)),
  ...ortFiles.map(file => cp('node_modules/onnxruntime-web/dist/' + file, 'build/vendor/onnxruntime/' + file)),
  ...['LICENSE', 'ThirdPartyNotices.txt'].map(file => cp('third-party/onnxruntime/' + file, 'build/vendor/onnxruntime/' + file)),
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
await writeFile('build/vendor/versions.json', JSON.stringify(Object.fromEntries(Object.entries(pkg.packages).filter(([k]) => /node_modules\/(pdfjs-dist|mammoth|onnxruntime-web)$/.test(k)).map(([k,v]) => [k, v.version])), null, 2));
console.log('Production extension ready in build/');
