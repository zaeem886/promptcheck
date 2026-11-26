import { configurePdfWorker, extractDocument } from '../extractors/documents.js';
import { documentResult, finishScan, incompleteModelScan, notScanned } from '../shared/scan.js';
import { mergeFindings } from '../shared/hybrid.js';
configurePdfWorker(new URL('../vendor/pdf.worker.mjs', import.meta.url).href, {
  cMapUrl: new URL('../vendor/cmaps/', import.meta.url).href, cMapPacked: true,
  standardFontDataUrl: new URL('../vendor/standard_fonts/', import.meta.url).href
});
self.onmessage = async ({ data: { id, name, buffer, limits, keywords } }) => {
  const started = performance.now();
  try {
    const extraction = await extractDocument(name, buffer, limits);
    const result = finishScan(extraction, keywords);
    if (result.status === 'Not scanned') {
      self.postMessage({ id, result, durationMs: performance.now() - started });
      return;
    }
    const { text: modelText, ...metadata } = extraction;
    self.onmessage = ({ data: response }) => {
      if (response.id !== id) return;
      const merged = response.findings
        ? documentResult(metadata, mergeFindings(result.findings, response.findings))
        : incompleteModelScan(result, 'The ML check could not finish. Rule results are shown.');
      self.postMessage({ id, result: merged, durationMs: performance.now() - started });
    };
    // Forward the original extraction for model inference and exact value display.
    self.postMessage({ id, result, modelText });
  } catch (error) {
    // Never forward parser errors: they can contain document text or paths.
    self.postMessage({ id, result: notScanned(error?.name === 'PasswordException' ? 'Encrypted PDF requires a password; encrypted extraction is outside scope.' : 'Unreadable, encrypted, malformed, or unsupported document encoding.') });
  }
};
