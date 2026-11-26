import test from 'node:test';
import assert from 'node:assert/strict';
import { detect } from '../src/shared/detector.js';
import { maskModelFindings, mergeFindings } from '../src/shared/hybrid.js';
import { createCharacterModel } from '../src/ml/character-model.js';

test('the hybrid scan keeps rules, deduplicates agreements and adds masked model findings', () => {
  const text = 'Call +1 (202) 555-0198.\nShip to 21 Cedar Road.\nEmail demo@example.test';
  const rules = detect(text);
  const addressStart = text.indexOf('21 Cedar Road');
  const model = maskModelFindings(text, [
    { label: 'PHONE', start: rules[0].start, end: rules[0].end },
    { label: 'ADDRESS', start: addressStart, end: addressStart + '21 Cedar Road'.length },
    { label: 'PERSON', start: rules[1].start, end: rules[1].start + 4 }
  ]);
  const findings = mergeFindings(rules, model);
  assert.deepEqual(findings.map(f => [f.category, f.source]), [['phone', 'both'], ['address', 'ml'], ['email', undefined]]);
  assert.deepEqual(findings[2], rules[1]);
  assert.equal(findings[1].location.line, 2);
  assert.equal(findings[1].preview, '[value hidden]');
  assert.equal(rules[0].source, undefined);
});

test('the model stitches a span across window boundaries and returns UTF-16 offsets', async () => {
  const config = { core: 3, halo: 1, buckets: 4096, min_span_score: 0.98,
    shape_groups: ['Nd', 'Lu', 'Ll', 'L', 'M', 'P', 'Z', 'other'],
    tags: ['O', 'B-PERSON', 'I-PERSON'] };
  const windows = [];
  const predict = createCharacterModel(config, ids => {
    windows.push([...ids]);
    return Float32Array.from(Array.from(ids).flatMap(id =>
      id === 66 ? [0, 10, 0] : id === 99 || id === 100 ? [0, 0, 10] : [10, 0, 0]));
  });
  const result = await predict('😀 Abc.', new AbortController().signal);
  assert.deepEqual(result, [{ label: 'PERSON', start: 3, end: 6 }]);
  assert.deepEqual(windows.map(ids => ids.slice(-3)), [[33, 66, 99], [99, 100, 47]]);
});
