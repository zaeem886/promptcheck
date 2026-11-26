import { readFile } from 'node:fs/promises';
import assert from 'node:assert/strict';
import JSZip from 'jszip';
import { detect } from '../src/shared/detector.js';
import { mergeFindings, MODEL_CATEGORIES } from '../src/shared/hybrid.js';
import { MODEL_PORT, PREPARE_MODEL } from '../src/ml/protocol.js';

export async function evaluateHybrid(page) {
  const zip = await JSZip.loadAsync(await readFile('ml/promptprivacy-global (1).zip'));
  const parity = JSON.parse(await zip.file('parity.json').async('string'));
  const benchmark = JSON.parse(await readFile('artifacts/ml-evaluation-v2/results.json', 'utf8'));
  const config = JSON.parse(await readFile('build/ml/model.json', 'utf8'));
  assert.equal(benchmark.model_sha256, config.model_sha256);
  const inputs = [...parity, ...benchmark.cases].map(item => item.text);
  const responses = await page.evaluate(async ({ inputs, prepare, portName }) => {
    const ready = await chrome.runtime.sendMessage({ type: prepare });
    if (!ready?.ready) throw new Error('The packaged model worker could not start');
    const output = [];
    for (const text of inputs) {
      if (!text.length) { output.push({ findings: [], durationMs: 0 }); continue; }
      const start = performance.now();
      const findings = await new Promise((resolve, reject) => {
        const port = chrome.runtime.connect({ name: portName });
        const timeout = setTimeout(() => { port.disconnect(); reject(new Error('Model scan timed out')); }, 5000);
        port.onDisconnect.addListener(() => {
          clearTimeout(timeout);
          reject(new Error(chrome.runtime.lastError?.message || 'Model port closed early'));
        });
        port.onMessage.addListener(({ findings }) => {
          clearTimeout(timeout);
          port.disconnect();
          resolve(findings);
        });
        port.postMessage({ text });
      });
      if (!Array.isArray(findings)) throw new Error('No results from the packaged model worker');
      output.push({ findings, durationMs: performance.now() - start });
    }
    return output;
  }, { inputs, prepare: PREPARE_MODEL, portName: MODEL_PORT });

  const asUtf16 = (text, start, end) => {
    const chars = Array.from(text);
    return { start: chars.slice(0, start).join('').length, end: chars.slice(0, end).join('').length };
  };
  const key = ({ category, start, end }) => [category === 'cnic' ? 'nationalId' : category, start, end].join(':');
  for (const [index, sample] of parity.entries()) {
    const expected = sample.spans.map(([label, start, end]) => key({
      ...asUtf16(sample.text, start, end), category: MODEL_CATEGORIES[label]
    })).sort();
    assert.deepEqual(responses[index].findings.map(key).sort(), expected, 'Kaggle/extension span parity');
  }
  const scores = { rules: {tp: 0, fp: 0, fn: 0}, model: {tp: 0, fp: 0, fn: 0}, hybrid: {tp: 0, fp: 0, fn: 0} };
  const runs = [];
  for (const [index, item] of benchmark.cases.entries()) {
    const { findings: model, durationMs } = responses[parity.length + index];
    const rules = detect(item.text);
    const hybrid = mergeFindings(rules, model);
    const expected = new Set(item.spans.map(({ label, start, end }) => key({
      ...asUtf16(item.text, start, end), category: MODEL_CATEGORIES[label]
    })));
    for (const [name, findings] of Object.entries({ rules, model, hybrid })) {
      const actual = new Set(findings.map(key));
      for (const span of actual) scores[name][expected.has(span) ? 'tp' : 'fp']++;
      for (const span of expected) if (!actual.has(span)) scores[name].fn++;
    }
    runs.push(durationMs);
  }
  runs.sort((a, b) => a - b);
  for (const score of Object.values(scores)) {
    const { tp, fp, fn } = score;
    Object.assign(score, { precision: tp / Math.max(1, tp + fp), recall: tp / Math.max(1, tp + fn),
      f1: 2 * tp / Math.max(1, 2 * tp + fp + fn) });
  }
  return { modelSha256: config.model_sha256, cutoff: config.min_span_score, cases: benchmark.cases.length,
    parityCases: parity.length, scores, modelRoundTripMs: { median: runs[Math.floor(runs.length / 2)],
      p95: runs[Math.ceil(0.95 * runs.length) - 1], max: runs.at(-1) } };
}
