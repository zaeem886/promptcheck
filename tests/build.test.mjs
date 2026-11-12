import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, access } from 'node:fs/promises';
test('production manifest has minimal permissions and local runtime entrypoints', async () => {
  const manifest=JSON.parse(await readFile('build/manifest.json'));
  assert.equal(manifest.manifest_version,3);
  assert.deepEqual(manifest.permissions,['storage']);
  assert.deepEqual(manifest.content_scripts[0].matches,['https://chatgpt.com/*']);
  assert.equal(manifest.host_permissions,undefined);
  assert.equal(manifest.web_accessible_resources,undefined);
  assert.ok(!manifest.content_security_policy.extension_pages.includes('unsafe-eval'));
  for(const file of ['scanner/index.html','scanner/app.js','scanner/worker.js','content/chatgpt.js','background.js','vendor/pdf.worker.mjs','vendor/cmaps/Adobe-GB1-UCS2.bcmap','vendor/standard_fonts/FoxitFixed.pfb']) await access(`build/${file}`);
  const html=await readFile('build/scanner/index.html','utf8'); assert.ok(!/<script[^>]+src=["']https?:/.test(html));
});
