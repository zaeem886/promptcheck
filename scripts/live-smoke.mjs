// Optional development-only check: fresh signed-out browser, synthetic draft,
// no Send click, no account access. The service may still read its editor.
import { chromium } from 'playwright';
import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import assert from 'node:assert/strict';
const context = await chromium.launchPersistentContext(resolve(`artifacts/browser-profile/live-${Date.now()}`), {
  executablePath: process.env.CHROME_PATH || 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: true,
  ignoreDefaultArgs: ['--disable-extensions', '--disable-component-extensions-with-background-pages'],
  args: ['--enable-unsafe-extension-debugging']
});
const report = { measuredAt: new Date().toISOString(), browser: context.browser().version(), signedIn: false, promptSent: false };
try {
  const browserSession = await context.browser().newBrowserCDPSession();
  await browserSession.send('Extensions.loadUnpacked', { path: resolve('build') });
  const page = await context.newPage();
  await page.goto('https://gemini.google.com/app', { waitUntil: 'domcontentloaded', timeout: 20000 });
  const input = page.locator('rich-textarea .ql-editor[contenteditable="true"][role="textbox"]');
  await input.waitFor({ state: 'visible', timeout: 10000 });
  const session = await context.newCDPSession(page);
  async function warning() {
    const tree = await session.send('DOM.getDocument', { depth: -1, pierce: true });
    function find(node) {
      if (node.attributes?.includes('data-promptprivacy') && node.attributes?.includes('advisory')) return node;
      for (const child of [...(node.children || []), ...(node.shadowRoots || [])]) { const match = find(child); if (match) return match; }
    }
    function text(node) { return (node.nodeName === '#text' ? node.nodeValue : '') + [...(node.children || []), ...(node.shadowRoots || [])].map(text).join(' '); }
    const panel = find(tree.root)?.shadowRoots?.[0]?.children?.find(node => node.nodeName === 'SECTION');
    return panel ? text(panel) : '';
  }
  await input.fill('Contact demo@example.test and call +92 300 1234567');
  let result = '';
  for (let i = 0; i < 40; i++) {
    result = await warning(); if (result.includes('Pakistani phone: 1')) break;
    await page.waitForTimeout(100);
  }
  assert.match(result, /Email: 1/); assert.match(result, /Pakistani phone: 1/);
  assert.match(result, /Gemini can access/); assert.ok(!result.includes('demo@example.test'));
  assert.match(result,/Line 1, column 9 · Top/);assert.match(result,/Line 1, column 36 · Bottom/);
  const layout = await input.evaluate(element => {
    const host=document.querySelector('[data-promptprivacy="advisory"]');
    const composer=host.previousElementSibling;
    const input=element.getBoundingClientRect(), box=composer.getBoundingClientRect(), warning=host.getBoundingClientRect();
    return {composerTag:composer.tagName,insideComposer:composer.contains(host),inputBottom:input.bottom,composerBottom:box.bottom,warningTop:warning.top,warningHeight:warning.height};
  });
  assert.equal(layout.insideComposer,false);assert.ok(layout.warningTop>=layout.composerBottom+4);
  assert.ok(layout.warningTop>=layout.inputBottom+4);assert.ok(layout.warningHeight<230);
  await page.locator('[data-promptprivacy="advisory"]').screenshot({ path: 'artifacts/gemini-live-advisory.png' });
  await page.screenshot({path:'artifacts/gemini-live-layout.png',fullPage:true});
  await input.fill(''); await page.waitForTimeout(100); assert.equal((await warning()).trim(), '');
  report.gemini = { status: 'Passed', checks: ['Public composer discovery', 'Synthetic draft scan', 'Masked email/phone previews with line/column/region', 'Provider-specific advisory', 'Compact warning outside/below composer', 'Clear empty draft'], layout, sending: 'Not exercised; no prompt sent' };
} catch (error) {
  report.gemini = { status: 'Unavailable or failed', reason: error.name === 'TimeoutError' ? 'Public page/editor navigation timed out' : error.name === 'AssertionError' ? 'Live advisory assertions did not pass' : 'Browser navigation or inspection failed' };
  process.exitCode = 1;
} finally { await context.close(); }
await mkdir('artifacts', { recursive: true });
await writeFile('artifacts/live-sites.json', JSON.stringify(report, null, 2));
console.log(JSON.stringify(report, null, 2));
