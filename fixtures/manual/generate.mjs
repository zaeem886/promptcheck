// Regenerate a synthetic large draft. Ground truth below is authored separately.
import { mkdir, writeFile } from 'node:fs/promises';
import { detect, summarize } from '../../src/shared/detector.js';
const lines = ['SYNTHETIC STRESS TEST. No real identities or credentials.', 'Beginning contact: beginning@example.test.'];
for (let i = 1; i <= 120; i++) {
  lines.push(`Section ${i}: Explain how a university library can organize books, improve search results, and schedule study rooms. Compare simple indexing methods, summarize the tradeoffs, and keep the explanation suitable for an information security class.`);
  if (i === 60) lines.push('Middle contact: +92 300 1234567. CNIC: 35202-1234567-1. Synthetic token: sk-' + 'A'.repeat(24));
}
lines.push('Final contact: ending@example.test.', 'Synthetic marker: -----BEGIN PRIVATE KEY-----', 'There is no actual private key body in this example.');
const text = lines.join('\n\n');
const expected = { email: 2, phone: 1, cnic: 1, apiKey: 1, privateKey: 1 };
const actual = Object.fromEntries(summarize(detect(text)).map(x => [x.category, x.count]));
for (const category of new Set([...Object.keys(expected), ...Object.keys(actual)])) {
  if ((actual[category] || 0) !== (expected[category] || 0)) throw new Error('Unexpected finding counts');
}
await mkdir(new URL('.', import.meta.url), {recursive: true});
await writeFile(new URL('large-prompt.txt', import.meta.url), text);
await writeFile(new URL('large-prompt-expected.json', import.meta.url), JSON.stringify({characters:text.length,totalFindings:6,expected,note:'Use an empty keyword list for these expected counts.'}, null, 2));
console.log(JSON.stringify({characters:text.length,totalFindings:6,expected}));
