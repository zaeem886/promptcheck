import * as pdfjs from 'pdfjs-dist/legacy/build/pdf.mjs';
import mammoth from 'mammoth/mammoth.browser.js';
import { extension } from '../shared/scan.js';
let pdfResources = {};
export function configurePdfWorker(url, resources = {}) { pdfjs.GlobalWorkerOptions.workerSrc = url; pdfResources = resources; }
export async function extractDocument(name, buffer, limits) {
  const type = extension(name);
  if (type === 'txt' || type === 'csv') {
    const text = new TextDecoder('utf-8', { fatal: true }).decode(buffer);
    if (text.includes('\0')) throw new Error('binary');
    return cap({ text, locationBasis: 'source text' }, limits);
  }
  if (type === 'docx') {
    const result = await mammoth.extractRawText({ arrayBuffer: buffer });
    return cap({ text: result.value, locationBasis: 'extracted DOCX body text', partial: result.messages.length > 0, reason: result.messages.length ? 'DOCX extraction reported unsupported content; body text only.' : '' }, limits);
  }
  if (type !== 'pdf') throw new Error('unsupported');
  const loading = pdfjs.getDocument({ data: new Uint8Array(buffer), isEvalSupported: false, useSystemFonts: false, disableFontFace: true, verbosity: 0, ...pdfResources });
  let doc;
  try {
    doc = await loading.promise;
    const chunks = [], pageRanges = []; let scannedPages = 0, skipped = 0, length = 0;
    for (let i = 1; i <= Math.min(doc.numPages, limits.maxPages); i++) {
      try {
        const page = await doc.getPage(i);
        const content = await page.getTextContent();
        const text = content.items.map(x => typeof x.str === 'string' ? x.str + (x.hasEOL ? '\n' : ' ') : '').join('');
        if (text.trim()) scannedPages++; else skipped++;
        const start = length + (chunks.length ? 1 : 0);
        chunks.push(text); length = start + text.length;
        pageRanges.push({ page: i, start, end: length }); page.cleanup();
        if (length >= limits.maxTextChars) break;
      } catch { skipped++; }
    }
    const partial = skipped > 0 || scannedPages < doc.numPages || length >= limits.maxTextChars;
    return cap({ text: chunks.join('\n'), locationBasis: 'extracted PDF text', pageRanges, pages: doc.numPages, scannedPages, partial, reason: partial ? 'Some pages have no extractable text, could not be read, or exceeded page/text limits. OCR is outside scope.' : '' }, limits);
  } finally { await loading.destroy(); }
}
function cap(result, limits) {
  if (result.text.length > limits.maxTextChars) return { ...result, text: result.text.slice(0, limits.maxTextChars), partial: true, reason: 'Extracted text exceeded the configured character limit.' };
  return result;
}
