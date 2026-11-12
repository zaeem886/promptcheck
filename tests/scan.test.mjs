import test from 'node:test';
import assert from 'node:assert/strict';
import { DEFAULT_LIMITS, finishScan, preflight, notScanned } from '../src/shared/scan.js';
test('four distinct states and partial findings', () => {
  assert.equal(finishScan({ text: 'demo@example.test' }).status, 'Findings detected');
  assert.equal(finishScan({ text: 'ordinary notes' }).status, 'No supported patterns found');
  const partial = finishScan({ text: 'demo@example.test', partial: true, reason: 'image page' });
  assert.equal(partial.status, 'Partially scanned'); assert.equal(partial.findings.length, 1);
  assert.equal(finishScan({ text: 'ordinary notes', partial: true }).status, 'Partially scanned');
  assert.equal(finishScan({ text: '  ', partial: true }).status, 'Not scanned');
  assert.equal(notScanned('Timed out').status, 'Not scanned');
});
test('preflight limits and extensions', () => {
  for (const name of ['test.TXT', 'a.csv', 'a.pdf', 'a.docx']) assert.equal(preflight({name, size: 10}), null);
  assert.match(preflight({ name: 'a.exe', size: 10 }), /Unsupported/);
  assert.match(preflight({ name: 'a.txt', size: DEFAULT_LIMITS.maxBytes + 1 }), /size/);
  assert.match(preflight({ name: 'a.txt', size: 0 }), /empty/);
});
