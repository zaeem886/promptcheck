import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { extractDocument, configurePdfWorker } from '../src/extractors/documents.js';
import { DEFAULT_LIMITS, finishScan, preflight } from '../src/shared/scan.js';
configurePdfWorker(new URL('../node_modules/pdfjs-dist/legacy/build/pdf.worker.mjs',import.meta.url).href);
test('PDF extraction preserves page offsets used by occurrence locations', async () => {
  const { PDFDocument, StandardFonts } = await import('pdf-lib');
  const document = await PDFDocument.create(); const font = await document.embedFont(StandardFonts.Helvetica);
  const first=document.addPage();first.drawText('first@example.test',{x:40,y:740,font,size:12});
  document.addPage();
  const third=document.addPage();third.drawText('last@example.test',{x:40,y:740,font,size:12});
  const bytes=await document.save();
  const extracted=await extractDocument('three-pages.pdf',bytes.buffer.slice(bytes.byteOffset,bytes.byteOffset+bytes.byteLength),DEFAULT_LIMITS);
  const result=finishScan(extracted);
  assert.equal(result.status,'Partially scanned');
  assert.deepEqual(result.findings.map(f=>f.location.page),[1,3]);
  assert.equal(result.locationBasis,'extracted PDF text');
  const capped=await extractDocument('three-pages.pdf',bytes.buffer.slice(bytes.byteOffset,bytes.byteOffset+bytes.byteLength),{...DEFAULT_LIMITS,maxTextChars:22});
  const partial=finishScan(capped);assert.equal(partial.status,'Partially scanned');assert.equal(partial.findings[0].location.page,1);
});
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
