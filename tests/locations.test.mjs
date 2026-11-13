import test from 'node:test';
import assert from 'node:assert/strict';
import { detect, summarize } from '../src/shared/detector.js';
import { locateFindings, formatLocation } from '../src/shared/locations.js';
import { finishScan } from '../src/shared/scan.js';

test('each repeated match keeps an independent line and column', () => {
  const findings = detect('First: demo@example.test\n\nAgain: demo@example.test');
  assert.deepEqual(findings.map(f => [f.location.line, f.location.column, f.location.endLine]), [[1, 8, 1], [3, 8, 3]]);
  const group = summarize(findings)[0];
  assert.equal(group.count, 2); assert.equal(group.previews.length, 1); assert.equal(group.occurrences.length, 2);
  assert.equal(group.occurrences[1].location.line, 3);
  assert.ok(!JSON.stringify(group).includes('demo@example.test'));
});
test('logical lines support CRLF, lone CR, LF, and Unicode line separators', () => {
  const text = ['demo@example.test', 'demo@example.test', 'demo@example.test', 'demo@example.test', 'demo@example.test', 'demo@example.test'].join('\r\n');
  assert.deepEqual(detect(text).map(f=>f.location.line), [1,2,3,4,5,6]);
  assert.deepEqual(detect('a@example.test\rb@example.test\nc@example.test\u2028d@example.test\u2029e@example.test').map(f=>f.location.line), [1,2,3,4,5]);
});
test('top/middle/bottom use exact thirds of character offsets, even on one line', () => {
  const ranges = [0, 9, 10, 19, 20, 29].map(start=>({start,end:start+1}));
  assert.deepEqual(locateFindings('x'.repeat(30), ranges).map(f=>f.location.section), ['Top','Top','Middle','Middle','Bottom','Bottom']);
  assert.deepEqual(locateFindings('', []), []);
  assert.equal(locateFindings('x', [{start:0,end:1}])[0].location.column, 1);
});
test('multiline literal keywords have a line range; columns match UTF-16 offsets', () => {
  const finding = detect('😀 intro\nPROJECT\nMARIGOLD\nend', ['PROJECT\nMARIGOLD'])[0];
  assert.equal(finding.location.line, 2); assert.equal(finding.location.column, 1); assert.equal(finding.location.endLine, 3);
  assert.match(formatLocation(finding.location), /Lines 2–3, column 1/);
  assert.equal(detect('😀 demo@example.test')[0].location.column, 4);
  assert.equal(formatLocation(null), 'Location unavailable');
});
test('credentials stay fully hidden while exposing a useful location', () => {
  const secret = 'sk-' + 'A'.repeat(24);
  const finding = detect(`Notes\nToken: ${secret}\nEnd`)[0];
  assert.equal(finding.preview, '[credential hidden]');
  assert.equal(finding.location.line, 2); assert.equal(finding.location.column, 8);
  assert.ok(!JSON.stringify(finding).includes(secret));
});
test('PDF locations map to real page ranges after skipped/no-text pages', () => {
  const text = 'first@example.test\n\nlast@example.test';
  const result = finishScan({text,partial:true,locationBasis:'extracted PDF text',pageRanges:[{page:1,start:0,end:18},{page:2,start:19,end:19},{page:3,start:20,end:text.length}]});
  assert.deepEqual(result.findings.map(f=>[f.location.page,f.location.line]), [[1,1],[3,3]]);
  assert.match(formatLocation(result.findings[1].location), /^Page 3 · Line 3/);
  assert.equal(result.groups[0].occurrences[1].location.page, 3);
});
