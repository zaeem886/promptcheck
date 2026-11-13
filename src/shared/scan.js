import { detect, summarize } from './detector.js';
export const DEFAULT_LIMITS = Object.freeze({ maxBytes: 10 * 1024 * 1024, timeoutMs: 15000, maxTextChars: 2000000, maxPages: 200 });
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
  const findings = detect(extraction.text, keywords);
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
