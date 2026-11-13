import test from 'node:test';
import assert from 'node:assert/strict';
import { SITES, siteForOrigin, siteById } from '../src/shared/sites.js';
import { adapterForOrigin } from '../src/content/adapters/index.js';
test('all supported origins resolve to their own site-specific adapter', () => {
  assert.equal(SITES.length, 3);
  assert.deepEqual(SITES.map(site=>site.origin), ['https://chatgpt.com','https://claude.ai','https://gemini.google.com']);
  for (const site of SITES) {
    assert.equal(siteForOrigin(site.origin), site);
    assert.equal(siteById(site.id), site);
    const adapter = adapterForOrigin(site.origin);
    assert.equal(adapter.id, site.id); assert.equal(adapter.label, site.label);
    assert.ok(adapter.selectors.length); assert.ok(adapter.composerSelector);
    assert.ok(adapter.sendSelector); assert.ok(adapter.stopSelector);
  }
});
test('lookalike hosts, unrelated services, HTTP, and subdomains are not supported', () => {
  for (const origin of ['https://claude.ai.evil.test', 'https://gemini.google.com.evil.test', 'https://chatgpt.com.evil.test', 'https://not-claude.ai', 'https://google.com', 'https://www.claude.ai', 'http://claude.ai', 'http://gemini.google.com', 'https://example.test', 'null']) {
    assert.equal(siteForOrigin(origin), null); assert.equal(adapterForOrigin(origin), null);
  }
  assert.equal(siteById('<script>'), null);
});
