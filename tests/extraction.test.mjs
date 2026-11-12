import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { extractDocument, configurePdfWorker } from '../src/extractors/documents.js';
import { DEFAULT_LIMITS, finishScan, preflight } from '../src/shared/scan.js';
configurePdfWorker(new URL('../node_modules/pdfjs-dist/legacy/build/pdf.worker.mjs',import.meta.url).href);
test('all independently labelled document statuses', async () => {
  const labels = JSON.parse(await readFile('fixtures/document-labels.json'));
  for (const label of labels) {
    const bytes = await readFile(`fixtures/documents/${label.name}`), limits = {...DEFAULT_LIMITS,...label.limits};
    let status;
    if (preflight({name:label.name,size:bytes.length},limits)) status='Not scanned';
    else {
      try { status=finishScan(await extractDocument(label.name,bytes.buffer.slice(bytes.byteOffset,bytes.byteOffset+bytes.byteLength),limits),label.keywords).status; }
      catch { status='Not scanned'; }
    }
    assert.equal(status,label.status,label.name);
  }
});
