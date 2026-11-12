import { configurePdfWorker, extractDocument } from '../extractors/documents.js';
import { finishScan, notScanned } from '../shared/scan.js';
configurePdfWorker(new URL('../vendor/pdf.worker.mjs', import.meta.url).href, {
  cMapUrl: new URL('../vendor/cmaps/', import.meta.url).href, cMapPacked: true,
  standardFontDataUrl: new URL('../vendor/standard_fonts/', import.meta.url).href
});
self.onmessage = async ({ data }) => {
  const started = performance.now();
  try {
    const extraction = await extractDocument(data.name, data.buffer, data.limits);
    self.postMessage({ id: data.id, result: finishScan(extraction, data.keywords), durationMs: performance.now() - started });
  } catch (error) {
    // Never forward parser errors: they can contain document text or paths.
    self.postMessage({ id: data.id, result: notScanned(error?.name === 'PasswordException' ? 'Encrypted PDF requires a password; encrypted extraction is outside scope.' : 'Unreadable, encrypted, malformed, or unsupported document encoding.') });
  }
};
