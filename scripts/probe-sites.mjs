// Development-only connectivity check in a fresh, signed-out browser profile.
// Does not type, send prompts, sign in, or read draft/message text.
import { chromium } from 'playwright';
import { mkdir, writeFile } from 'node:fs/promises';
const browser = await chromium.launch({
  executablePath: process.env.CHROME_PATH || 'C:/Program Files/Google/Chrome/Application/chrome.exe',
  headless: true
});
const results = [];
try {
  for (const url of ['https://claude.ai/new', 'https://gemini.google.com/app']) {
    const page = await browser.newPage();
    try {
      await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 15000 });
      await page.waitForTimeout(2000);
      const metadata = await page.locator('textarea, [contenteditable="true"]').evaluateAll(elements => elements.map(element => ({
        tag: element.tagName,
        attributes: Object.fromEntries([...element.attributes].filter(x => ['id', 'class', 'role', 'aria-label', 'data-testid', 'data-placeholder', 'contenteditable'].includes(x.name)).map(x => [x.name, x.value])),
        ancestors: [element.parentElement, element.parentElement?.parentElement, element.parentElement?.parentElement?.parentElement].filter(Boolean).map(x => ({ tag: x.tagName, id: x.id, class: x.className }))
      })));
      results.push({ requestedUrl: url, finalUrl: page.url(), title: await page.title(), editorMetadata: metadata, signedInTesting: false });
    } catch (error) {
      results.push({ requestedUrl: url, status: 'Unavailable', reason: error.name === 'TimeoutError' ? 'Navigation timed out' : 'Browser navigation failed', signedInTesting: false });
    } finally { await page.close(); }
  }
} finally { await browser.close(); }
await mkdir('artifacts', { recursive: true });
await writeFile('artifacts/site-probe.json', JSON.stringify(results, null, 2));
console.log(JSON.stringify(results, null, 2));
