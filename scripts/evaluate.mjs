import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { platform, release, cpus, totalmem } from 'node:os';
import { performance } from 'node:perf_hooks';
import { detect } from '../src/shared/detector.js';
import { DEFAULT_LIMITS, preflight, notScanned, finishScan } from '../src/shared/scan.js';
import { extractDocument, configurePdfWorker } from '../src/extractors/documents.js';
configurePdfWorker(new URL('../node_modules/pdfjs-dist/legacy/build/pdf.worker.mjs', import.meta.url).href);
const prompts = JSON.parse(await readFile('fixtures/prompts.json'));
const labels = JSON.parse(await readFile('fixtures/prompt-labels.json'));
const docs = JSON.parse(await readFile('fixtures/document-labels.json'));
function score(expected, actual, equal) {
  const unmatched = [...expected]; let tp = 0, fp = 0;
  for (const finding of actual) { const i = unmatched.findIndex(x => equal(x, finding)); if (i < 0) fp++; else { tp++; unmatched.splice(i, 1); } }
  return {tp, fp, fn:unmatched.length};
}
function aggregate(rows) {
  const sum = rows.reduce((a,r) => ({tp:a.tp+r.tp,fp:a.fp+r.fp,fn:a.fn+r.fn}), {tp:0,fp:0,fn:0});
  return {...sum, precision:sum.tp/(sum.tp+sum.fp) || 0, recall:sum.tp/(sum.tp+sum.fn) || 0};
}
async function measured(fn) {
  global.gc?.(); const before = process.memoryUsage(); const start = performance.now();
  const result = await fn(); const durationMs = performance.now()-start; const after = process.memoryUsage();
  return {result,durationMs,rssBefore:before.rss,rssAfter:after.rss,heapDelta:after.heapUsed-before.heapUsed};
}
const promptRows = [];
for (const prompt of prompts) {
  const run = await measured(() => detect(prompt.text, prompt.keywords));
  promptRows.push({id:prompt.id,...score(labels[prompt.id],run.result,(a,b)=>a.category===b.category&&a.start===b.start&&a.end===b.end),...Object.fromEntries(Object.entries(run).filter(([k])=>k!=='result'))});
}
const documentRows = [];
for (const doc of docs) {
  const bytes = await readFile(`fixtures/documents/${doc.name}`); const config = {...DEFAULT_LIMITS,...doc.limits}; let text = '';
  const run = await measured(async () => {
    const reason = preflight({name:doc.name,size:bytes.length}, config); if (reason) return notScanned(reason);
    try {
      const extraction = await extractDocument(doc.name, bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset+bytes.byteLength), config);
      text = extraction.text; return finishScan(extraction, doc.keywords);
    } catch { return notScanned('Extraction failure'); }
  });
  const actual = run.result.findings.map(f=>({category:f.category,value:text.slice(f.start,f.end)}));
  documentRows.push({name:doc.name,expectedStatus:doc.status,status:run.result.status,statusPass:doc.status===run.result.status,unavailableFindings:doc.unavailableFindings||0,...score(doc.expected,actual,(a,b)=>a.category===b.category&&a.value===b.value),...Object.fromEntries(Object.entries(run).filter(([k])=>k!=='result'))});
}
function perf(rows) {
  const times = rows.map(x=>x.durationMs).sort((a,b)=>a-b);
  return {totalMs:times.reduce((a,b)=>a+b,0), medianMs:times[Math.floor(times.length/2)],p95Ms:times[Math.min(times.length-1,Math.floor(times.length*.95))],maxMs:times.at(-1),maxObservedRssBytes:Math.max(...rows.map(r=>Math.max(r.rssBefore,r.rssAfter))),maxObservedHeapDeltaBytes:Math.max(...rows.map(r=>r.heapDelta))};
}
const report = {environment:{node:process.version,os:`${platform()} ${release()}`,cpu:cpus()[0]?.model,logicalCpus:cpus().length,ramBytes:totalmem(),measuredAt:new Date().toISOString()},method:'One sequential cold/warm mixed run; high resolution performance.now; GC before each case. RSS sampled before/after, heap delta after minus before. Not peak allocation or browser process memory. Prompt timing excludes 300ms UI debounce. Node document timings exclude file I/O and worker startup; browser harness measures UI end-to-end separately.',prompts:{count:prompts.length,metrics:aggregate(promptRows),performance:perf(promptRows),rows:promptRows},documents:{count:docs.length,metrics:aggregate(documentRows),performance:perf(documentRows),statusPasses:documentRows.filter(r=>r.statusPass).length,unavailableFindings:documentRows.reduce((a,r)=>a+r.unavailableFindings,0),rows:documentRows}};
await mkdir('artifacts',{recursive:true}); await writeFile('artifacts/evaluation.json',JSON.stringify(report,null,2));
const fmt = x=>Number(x).toFixed(3);
await writeFile('artifacts/evaluation.md', `# Measured synthetic evaluation\n\nGenerated ${report.environment.measuredAt}. Environment: ${report.environment.os}, Node ${process.version}, ${report.environment.cpu}, ${report.environment.logicalCpus} logical CPUs, ${(totalmem()/2**30).toFixed(1)} GiB RAM.\n\n| Workflow | Cases | TP | FP | FN | Precision | Recall | Median ms | p95 ms | Max observed RSS MiB |\n|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|\n${[['Prompts',report.prompts],['Documents',report.documents]].map(([name,r])=>`| ${name} | ${r.count} | ${r.metrics.tp} | ${r.metrics.fp} | ${r.metrics.fn} | ${fmt(r.metrics.precision)} | ${fmt(r.metrics.recall)} | ${fmt(r.performance.medianMs)} | ${fmt(r.performance.p95Ms)} | ${fmt(r.performance.maxObservedRssBytes/2**20)} |`).join('\n')}\n\nDocument statuses: ${report.documents.statusPasses}/${docs.length} match the independent expected status. ${report.documents.unavailableFindings} labelled findings are unavailable because of unsupported extraction or partial coverage; they count as false negatives in end-to-end recall. Unreadable inputs with no known findings contribute status cases, not true negatives. Partial scans keep all successfully detected findings and include omitted labelled findings as false negatives.\n\n${report.method}\n\nThe corpus is small, repetitive, synthetic, and not representative of real user data. Two deliberate prompt misses cover obfuscated email and parenthesized phone; two deliberate false alarms cover unlabelled order-like phone digits and a CNIC-shaped code literal. Missing-text PDF fixtures use vector-only pages, not photographed documents. Their conceptual unavailable labels model information outside the text layer and are explicitly identified in document-labels.json. Actual Chrome memory is unavailable unless reported separately by the browser harness.\n`);
console.log(JSON.stringify({prompts:report.prompts.metrics,documents:report.documents.metrics,statusPasses:report.documents.statusPasses,documentCount:docs.length},null,2));
if (report.documents.statusPasses!==docs.length) process.exitCode=1;
