import { detect, summarize } from './detector.js';
import { DEFAULT_LIMITS } from './limits.js';
export { DEFAULT_LIMITS };
export const SUPPORTED = ['txt', 'csv', 'pdf', 'docx'];
export function extension(name) { return name.toLowerCase().split('.').pop(); }
export function preflight(file, limits = DEFAULT_LIMITS) {
  if (!SUPPORTED.includes(extension(file.name))) return 'Unsupported file type. Choose TXT, CSV, PDF, or DOCX.';
  if (file.size > limits.maxBytes) return 'File exceeds the configured size limit.';
  if (!file.size) return 'The file is empty.';
  return null;
}
export function notScanned(reason) { return { status: 'Not scanned', reason, findings: [], groups: [], partial: false }; }
export function finishScan(extraction, keywords = []) {
  if (!extraction.text.trim()) return notScanned(extraction.reason || 'No extractable text. OCR is outside scope.');
  return documentResult(extraction, detect(extraction.text, keywords));
}
export function documentResult(extraction, findings) {
  if (extraction.pageRanges) for (const finding of findings) {
    const first = extraction.pageRanges.find(range => finding.start >= range.start && finding.start < range.end);
    const last = extraction.pageRanges.find(range => finding.end - 1 >= range.start && finding.end - 1 < range.end);
    if (first) finding.location.page = first.page;
    if (last) finding.location.endPage = last.page;
  }
  return {
    status: extraction.partial ? 'Partially scanned' : findings.length ? 'Findings detected' : 'No supported patterns found',
    partial: !!extraction.partial, reason: extraction.reason || '', findings, groups: summarize(findings),
    pages: extraction.pages, scannedPages: extraction.scannedPages, locationBasis: extraction.locationBasis || 'scanned text'
  };
}

export function incompleteModelScan(result, reason) {
  return { ...result, partial: true, status: 'Partially scanned',
    reason: [result.reason, reason].filter(Boolean).join(' ') };
}
