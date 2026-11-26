// Run the exported model with one WASM thread in a fresh local browser.
import { readFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';
import JSZip from 'jszip';
import { build } from 'esbuild';

if (!process.argv[2]) throw new Error('Pass the path to the Kaggle model ZIP.');
const zip = await JSZip.loadAsync(await readFile(process.argv[2]));
const assets = new Map();
for (const name of ['model.onnx', 'manifest.json', 'parity.json']) {
  assets.set('/' + name, await zip.file(name).async('nodebuffer'));
}
const runtimeNames = ['ort.wasm.min.mjs', 'ort-wasm-simd-threaded.mjs', 'ort-wasm-simd-threaded.wasm'];
for (const name of runtimeNames) {
  assets.set('/' + name, await readFile(new URL('node_modules/onnxruntime-web/dist/' + name, import.meta.url)));
}
const ruleBundle = await build({ entryPoints: [fileURLToPath(new URL('../src/shared/detector.js', import.meta.url))],
  bundle: true, format: 'esm', write: false });
assets.set('/detector.js', ruleBundle.outputFiles[0].contents);
const server = createServer((req, res) => {
  if (req.url === '/') {
    res.writeHead(200, { 'Content-Type': 'text/html' }).end('<!doctype html><title>Local ML benchmark</title>');
  } else if (assets.has(req.url)) {
    const type = req.url.endsWith('.wasm') ? 'application/wasm'
      : req.url.endsWith('js') ? 'text/javascript' : 'application/octet-stream';
    res.writeHead(200, { 'Content-Type': type }).end(assets.get(req.url));
  } else res.writeHead(404).end();
});
await new Promise((resolve, reject) => server.on('error', reject).listen(0, '127.0.0.1', resolve));
let browser;
try {
  browser = await chromium.launch(process.env.CHROME_PATH
    ? { executablePath: process.env.CHROME_PATH } : { channel: 'chrome' });
  const page = await browser.newPage();
  await page.goto('http://127.0.0.1:' + server.address().port);
  const results = await page.evaluate(async () => {
    const manifest = await (await fetch('/manifest.json')).json();
    if (manifest.format !== 'promptprivacy-char-cnn-v1') throw Error('Unrecognized model');
    const { detect } = await import('/detector.js');
    const start = performance.now();
    const ort = await import('/ort.wasm.min.mjs');
    ort.env.wasm.numThreads = 1;
    ort.env.wasm.wasmPaths = location.origin + '/';
    const session = await ort.InferenceSession.create('/model.onnx', { executionProviders: ['wasm'] });
    const coldLoadMs = performance.now() - start;
    const groups = manifest.shape_groups.slice(0, -1).map(group => new RegExp('\\p{' + group + '}', 'u'));
    const groupSize = manifest.buckets / manifest.shape_groups.length;
    function encode(text) {
      return Int32Array.from(Array.from(text), ch => {
        const n = ch.codePointAt(0);
        if (n < 128) return n + 1;
        const group = groups.findIndex(match => match.test(ch));
        return 129 + groupSize * (group < 0 ? groups.length : group) + n % groupSize;
      });
    }
    async function scan(text) {
      const ids = encode(text);
      const tags = new Int16Array(ids.length);
      const confidence = new Float64Array(ids.length);
      for (let a = 0; a < ids.length; a += manifest.core) {
        const b = Math.min(ids.length, a + manifest.core);
        const left = Math.max(0, a - manifest.halo), right = Math.min(ids.length, b + manifest.halo);
        const input = new ort.Tensor('int32', ids.subarray(left, right), [1, right - left]);
        const { logits } = await session.run({ ids: input });
        const width = manifest.tags.length;
        const values = logits.data;
        for (let i = a; i < b; i++) {
          const offset = (i - left) * width;
          let best = 0;
          for (let j = 1; j < width; j++) {
            if (values[offset + j] > values[offset + best]) best = j;
          }
          tags[i] = best;
          if (best) {
            let sum = 0;
            for (let j = 0; j < width; j++) sum += Math.exp(values[offset+j] - values[offset+best]);
            confidence[i] = 1 / sum;
          }
        }
        input.dispose();
        logits.dispose();
      }
      const spans = [];
      let active, begin;
      for (let i = 0; i <= tags.length; i++) {
        const label = manifest.tags[tags[i] ?? 0];
        if (active && label === 'I-' + active) continue;
        if (active) {
          let sum = 0;
          for (let j = begin; j < i; j++) sum += confidence[j];
          if (sum / (i - begin) >= manifest.min_span_score) spans.push([active, begin, i]);
        }
        active = label === 'O' ? null : label.slice(2);
        begin = i;
      }
      return { ids, tags, spans };
    }
    const parity = await (await fetch('/parity.json')).json();
    for (const entry of parity) {
      const { ids, tags, spans } = await scan(entry.text);
      if (String(ids) !== String(entry.ids) || String(tags) !== String(entry.tags)
        || JSON.stringify(spans) !== JSON.stringify(entry.spans.sort((a, b) => a[1] - b[1]))) {
        throw Error('Browser predictions differ from the Python reference');
      }
    }
    const timing = [];
    for (const length of [128, 1024, 4096]) {
      const prompt = 'Résumé: please email sample+qa@example.net with the updates. '.repeat(length).slice(0, length);
      for (let i = 0; i < 3; i++) await scan(prompt);
      for (const [name, fn] of [['extensionRules', detect], ['model', scan]]) {
        const ms = [];
        for (let i = 0; i < 40; i++) {
          const tick = performance.now();
          await fn(prompt);
          ms.push(performance.now() - tick);
        }
        ms.sort((a, b) => a - b);
        timing.push({ length, path: name, medianMs: (ms[19] + ms[20])/2, p95Ms: ms[37] });
      }
    }
    await session.release();
    return { smokeRun: manifest.smoke_run, coldLoadMs, parityCases: parity.length, timing };
  });
  const runtimeBytes = runtimeNames.reduce((total, name) => total + assets.get('/' + name).length, 0);
  console.log(JSON.stringify({ browser: browser.version(), modelBytes: assets.get('/model.onnx').length,
    wasmRuntimeBytes: runtimeBytes, ...results }, null, 2));
} finally {
  if (browser) await browser.close();
  await new Promise(resolve => server.close(resolve));
}
