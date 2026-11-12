import test from 'node:test';
import assert from 'node:assert/strict';
import { detect, mask, normalizeKeywords, summarize } from '../src/shared/detector.js';
const cats = (text, keys) => detect(text, keys).map(x => x.category);
test('email and boundaries', () => {
  assert.deepEqual(cats('Write to synthetic.person+test@example.test.'), ['email']);
  assert.deepEqual(cats('invalid@localhost and a@.test'), []);
});
test('Pakistani mobile formats', () => {
  for (const x of ['03001234567', '0300-1234567', '0300 1234567', '+923001234567', '+92 300 1234567', '+92-300-1234567', '0092 300 1234567']) assert.deepEqual(cats(`Call ${x}.`), ['phone'], x);
  for (const x of ['2030012345678', '030012345678', '2026-11-13', 'Order: 03001234567', 'Invoice no: 03001234567']) assert.deepEqual(cats(x), [], x);
});
test('CNIC requires label for compact form', () => {
  assert.deepEqual(cats('CNIC: 3520212345671 and 35202-1234567-1'), ['cnic', 'cnic']);
  assert.deepEqual(cats('Order: 3520212345671; 85202-1234567-1; 135202123456718'), []);
});
test('exact selected credential formats', () => {
  for (const x of ['sk-' + 'A'.repeat(24), 'sk-proj-' + 'aB_9-'.repeat(8), 'ghp_' + 'a'.repeat(36), 'github_pat_' + 'a'.repeat(40), 'AKIA' + 'A1'.repeat(8), 'AIza' + 'a'.repeat(35)]) {
    assert.deepEqual(cats(x), ['apiKey']); assert.equal(detect(x)[0].preview, '[credential hidden]');
  }
  assert.deepEqual(cats('sk-short ghp_short AKIA123'), []);
});
test('all supported private-key markers', () => {
  for (const prefix of ['', 'RSA ', 'EC ', 'DSA ', 'OPENSSH ', 'ENCRYPTED ']) assert.deepEqual(cats(`-----BEGIN ${prefix}PRIVATE KEY-----`), ['privateKey']);
  assert.deepEqual(cats('-----BEGIN PUBLIC KEY-----'), []);
});
test('literal case-insensitive keywords and normalization', () => {
  assert.deepEqual(cats('PROJECT [a-z]+ <script>', ['project', '[a-z]+', '<script>']), ['keyword', 'keyword', 'keyword']);
  assert.deepEqual(cats('aZzz', ['[a-z]+']), []);
  assert.deepEqual(normalizeKeywords([' X ', 'x', '', null]), ['x']);
  assert.equal(detect('İ PROJECT', ['project'])[0].start, 2, 'UTF-16 offsets survive case folding elsewhere in the text');
});
test('overlap precedence, longest keyword, repeated occurrences', () => {
  const findings = detect('demo@example.test demo@example.test', ['demo', 'example']);
  assert.deepEqual(findings.map(x => x.category), ['email', 'email']);
  assert.equal(summarize(findings)[0].count, 2);
  assert.equal(detect('project secret', ['project', 'project secret']).length, 1);
  assert.equal(detect('aaaa', ['aa']).length, 2);
});
test('masking never leaks credentials or keyword text', () => {
  assert.equal(mask('privateKey', 'secret'), '[credential hidden]');
  assert.equal(mask('apiKey', 'secret'), '[credential hidden]');
  assert.equal(mask('keyword', 'secret'), '[keyword hidden]');
  assert.equal(mask('phone', '+92 300 1234567'), '***67');
  assert.equal(mask('cnic', '35202-1234567-1'), '***71');
  assert.equal(mask('email', 'demo@example.test'), 'd***@***');
});
