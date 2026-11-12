import { chromium } from 'playwright';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { resolve } from 'node:path';
import assert from 'node:assert/strict';
const extensionPath = resolve('build');
const browserName = /brave/i.test(process.env.CHROME_PATH || '') ? 'Brave' : 'Chrome';
const reportPath = browserName === 'Brave' ? 'artifacts/brave-results' : 'artifacts/browser-results';
await mkdir('artifacts', {recursive:true});
const context = await chromium.launchPersistentContext(resolve(`artifacts/browser-profile/run-${Date.now()}`), {
  executablePath: process.env.CHROME_PATH || 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless:true,
  ignoreDefaultArgs:['--disable-extensions','--disable-component-extensions-with-background-pages'],
  args:['--enable-unsafe-extension-debugging']
});
const checks=[], documentRuns=[], promptRuns=[], outbound=[], errors=[];
const passed = name => { checks.push(name); console.log(`PASS ${name}`); };
try {
  const browserSession=await context.browser().newBrowserCDPSession();
  const {id}=await browserSession.send('Extensions.loadUnpacked',{path:extensionPath});
  passed(`Production MV3 extension loads in ${browserName}`);
  await context.route(/^https?:\/\//, async route => {
    if (route.request().url()==='https://chatgpt.com/fixture') return route.fulfill({contentType:'text/html',body:await readFile('fixtures/editor.html','utf8')});
    if (route.request().url()==='https://chatgpt.com/work-fixture') return route.fulfill({contentType:'text/html',body:await readFile('fixtures/editor-work.html','utf8')});
    outbound.push(route.request().url()); await route.abort();
  });
  const page=await context.newPage(); page.on('pageerror',error=>{ errors.push('scanner page error'); console.log('Scanner script error:',error.message); });
  await page.goto(`chrome-extension://${id}/scanner/index.html`);
  await page.locator('#keywords').fill('project marigold\n[a-z]+\n<script>'); await page.locator('#save').click();
  await page.getByText('Keyword preferences saved on this device.').waitFor(); passed('Literal keyword preferences save in local storage');
  const documentLabels=JSON.parse(await readFile('fixtures/document-labels.json'));
  for (const doc of documentLabels.filter(d=>!d.limits)) {
    const start=performance.now();
    await page.locator('#file').setInputFiles(resolve(`fixtures/documents/${doc.name}`));
    await page.waitForFunction(status=>document.querySelector('#result').dataset.status===status,doc.status,{timeout:20000});
    const text=await page.locator('#result').innerText();
    for (const expected of doc.expected) assert.ok(!text.includes(expected.value),'Raw finding must not appear in UI');
    documentRuns.push({name:doc.name,status:doc.status,durationMs:performance.now()-start});
  }
  passed(`Real browser worker extraction/status/masking for ${documentRuns.length} documents`);
  await page.locator('#clear').click();
  await page.locator('#file').setInputFiles(resolve('fixtures/documents/pdf-findings.pdf'));
  await page.locator('#file').setInputFiles(resolve('fixtures/documents/txt-clear.txt'));
  await page.waitForFunction(()=>document.querySelector('#result').dataset.status==='No supported patterns found');
  await page.waitForTimeout(600);
  assert.equal(await page.locator('#result').getAttribute('data-status'),'No supported patterns found');
  passed('Replacing a scan prevents stale results');
  await page.locator('#file').setInputFiles(resolve('fixtures/documents/large.txt')); await page.locator('#cancel').click();
  assert.match(await page.locator('#result').innerText(),/Scan cancelled/); passed('Cancel terminates active processing');
  // Deterministically simulate a hung worker without relying on machine speed.
  await page.locator('summary').click();
  await page.evaluate(()=>{window.RealWorker=window.Worker; window.Worker=class {postMessage(){} terminate(){window.workerTerminated=true;}};});
  await page.locator('#timeout').fill('1'); await page.locator('#file').setInputFiles(resolve('fixtures/documents/txt-findings.txt'));
  await page.waitForFunction(()=>document.querySelector('#result').textContent.includes('time limit exceeded'));
  assert.equal(await page.evaluate(()=>window.workerTerminated),true); passed('Deadline terminates a simulated hung worker');
  await page.evaluate(()=>{window.Worker=window.RealWorker;});
  await page.locator('#timeout').fill('15'); await page.locator('#max-size').fill('1');
  await page.locator('#file').setInputFiles(resolve('fixtures/documents/large.txt'));
  assert.match(await page.locator('#result').innerText(),/size limit/); passed('Configured size limit preflight');
  const editor=await context.newPage(); editor.on('pageerror',()=>errors.push('editor page error'));
  await editor.goto('https://chatgpt.com/fixture');
  const background = context.serviceWorkers().find(w=>w.url()===`chrome-extension://${id}/background.js`) || await context.waitForEvent('serviceworker',{predicate:w=>w.url()===`chrome-extension://${id}/background.js`});
  // Tab URLs are deliberately unavailable without tabs/host permissions. Find the fixture
  // by its safe status handshake instead of adding tab-reading permission.
  const connectedId = await background.evaluate(async () => {
    for (const tab of await chrome.tabs.query({})) {
      try { if ((await chrome.tabs.sendMessage(tab.id,{type:'promptprivacy:status'}))?.status==='editor-found') return tab.id; } catch {}
    }
  });
  assert.notEqual(connectedId, undefined);
  const status = await background.evaluate(tabId=>chrome.tabs.sendMessage(tabId,{type:'promptprivacy:status'}),connectedId);
  assert.deepEqual(status,{status:'editor-found'});
  await page.goto(`chrome-extension://${id}/scanner/index.html?live=editor-found`);
  await page.getByText('Connected: the live scanner found', {exact:false}).waitFor();
  passed('Privacy-preserving live-scanner connection diagnostic');
  await page.goto(`chrome-extension://${id}/scanner/index.html`);
  const session=await context.newCDPSession(editor);
  const {targetInfos} = await browserSession.send('Target.getTargets',{filter:[{type:'tab',exclude:false}]});
  const tabTarget = targetInfos.find(t=>t.type==='tab' && t.url===editor.url());
  assert.ok(tabTarget,'Fixture must have a browser tab target');
  async function toolbarStatus(expected, targetId = tabTarget.targetId) {
    const [diagnostic] = await Promise.all([
      context.waitForEvent('page'),
      browserSession.send('Extensions.triggerAction',{id,targetId})
    ]);
    await diagnostic.waitForURL(`**/scanner/index.html?live=${expected}`);
    await diagnostic.locator('#live-status').waitFor();
    await diagnostic.close();
  }
  await toolbarStatus('editor-found');
  await editor.locator('#prompt-textarea').evaluate(el=>el.id='temporarily-replaced-editor');
  await toolbarStatus('editor-not-found');
  await editor.locator('#temporarily-replaced-editor').evaluate(el=>el.id='prompt-textarea');
  const disconnected = await context.newPage(); await disconnected.goto('about:blank#promptprivacy-diagnostic');
  const disconnectedTargets = await browserSession.send('Target.getTargets',{filter:[{type:'tab',exclude:false}]});
  const disconnectedTarget = disconnectedTargets.targetInfos.find(t=>t.type==='tab'&&t.url===disconnected.url());
  await toolbarStatus('not-connected', disconnectedTarget.targetId); await disconnected.close();
  passed('Actual toolbar action reports connected, missing-editor, and disconnected states');
  async function warning() {
    const tree=await session.send('DOM.getDocument',{depth:-1,pierce:true});
    function find(n) { if(n.attributes?.includes('advisory')&&n.attributes?.includes('data-promptprivacy')) return n; for(const c of [...(n.children||[]),...(n.shadowRoots||[])]) { const found=find(c); if(found)return found; } }
    const host=find(tree.root);
    function texts(n) { return (n.nodeName==='#text'?n.nodeValue:'')+[...(n.children||[]),...(n.shadowRoots||[])].map(texts).join(' '); }
    const root=host?.shadowRoots?.[0]; const panel=root?.children?.find(n=>n.nodeName==='SECTION');
    return panel?texts(panel):'';
  }
  async function waitWarning(pattern) { for(let i=0;i<40;i++){ const text=await warning(); if(pattern.test(text))return text; await editor.waitForTimeout(50); } throw new Error(`Warning did not match ${pattern}`); }
  let promptStarted=performance.now();
  await editor.locator('#prompt-textarea').fill('Explain binary search.');
  await waitWarning(/No supported patterns found/); promptRuns.push({case:'clear',durationMs:performance.now()-promptStarted}); passed('Live adapter reads draft only, excludes conversation history');
  promptStarted=performance.now();
  await editor.locator('#prompt-textarea').fill('');
  await editor.locator('#prompt-textarea').pressSequentially('Contact demo@example.test',{delay:1});
  let text=await waitWarning(/Email: 1/); promptRuns.push({case:'email',durationMs:performance.now()-promptStarted}); assert.ok(!text.includes('demo@example.test')); passed('Typing produces masked advisory after debounce');
  await editor.locator('#send').click(); assert.equal(await editor.locator('#sent').innerText(),'Sent: 1'); passed('Normal sending remains available with findings');
  await editor.locator('#prompt-textarea').fill(''); await editor.waitForTimeout(30); assert.equal((await warning()).trim(),''); passed('Empty draft clears stale findings immediately');
  // Simulate paste delivery (input event path); clipboard permission is not needed.
  await editor.locator('#prompt-textarea').evaluate(el=>{el.textContent='Call +92 300 1234567';el.dispatchEvent(new InputEvent('input',{bubbles:true,inputType:'insertFromPaste',data:'Call +92 300 1234567'}));});
  await waitWarning(/Pakistani phone: 1/); passed('Pasted text follows the same input scan path');
  await editor.locator('#replace').click(); await editor.locator('#prompt-textarea').fill('PROJECT MARIGOLD');
  text=await waitWarning(/Sensitive keyword: 1/); assert.ok(!text.includes('PROJECT MARIGOLD')); passed('Editor replacement and stored literal keywords');
  await editor.locator('#prompt-textarea').fill('sk-'+'A'.repeat(24));
  text=await waitWarning(/API key format: 1/); assert.ok(text.includes('[credential hidden]')); assert.ok(!text.includes('AAA')); passed('Live credentials are fully masked');
  await editor.locator('#prompt-textarea').fill('Ordinary notes'); await waitWarning(/No supported patterns found/);
  await editor.locator('#send').click(); assert.equal(await editor.locator('#sent').innerText(),'Sent: 2');
  const pasteAllowed=await editor.locator('#prompt-textarea').evaluate(el=>{
    const data=new DataTransfer();data.setData('text/plain','demo@example.test');
    return el.dispatchEvent(new ClipboardEvent('paste',{bubbles:true,cancelable:true,clipboardData:data}));
  });
  assert.equal(pasteAllowed,true);await waitWarning(/Pasted text snapshot/);
  passed('Clipboard review does not cancel normal paste behavior');
  // Regression for the actual Work-mode DOM supplied by the user: no prompt-textarea id.
  await editor.goto('https://chatgpt.com/work-fixture');
  const workEditor = editor.locator('[data-composer-markdown]');
  text = await waitWarning(/Pakistani phone: 1/);
  assert.match(text,/Email: 1/); assert.ok(!text.includes('demo@example.test'));
  assert.equal(await workEditor.getAttribute('id'),null);
  passed('Work composer without an id scans existing nested paragraph/span draft only');
  // The unrelated textbox must never become a scan source even when focused.
  await editor.getByRole('textbox',{name:'Unrelated notes',exact:true}).focus();
  text = await waitWarning(/Pakistani phone: 1/); assert.match(text,/Email: 1/);
  await workEditor.fill(''); await editor.waitForTimeout(30); assert.equal((await warning()).trim(),'');
  await workEditor.pressSequentially('Contact demo@example.test',{delay:1});
  await waitWarning(/Email: 1/);
  await editor.locator('#send').click(); assert.equal(await editor.locator('#sent').innerText(),'Sent: 1');
  passed('Work editor typing, clearing, unrelated-editor exclusion, and normal sending');
  await editor.locator('#replace').click();
  await workEditor.evaluate(el=>{ const p=document.createElement('p'); const span=document.createElement('span'); span.setAttribute('data-prompt-literal-paste',''); span.textContent='Call +92 300 1234567'; p.append(span); el.replaceChildren(p); el.dispatchEvent(new InputEvent('input',{bubbles:true,inputType:'insertFromPaste'})); });
  await waitWarning(/Pakistani phone: 1/);
  const workStatus=await background.evaluate(tabId=>chrome.tabs.sendMessage(tabId,{type:'promptprivacy:status'}),connectedId);
  assert.deepEqual(workStatus,{status:'editor-found'});
  passed('Work editor replacement, nested paste input, and connected diagnostic');
  async function pasteInto(locator, clipboardText) {
    await locator.evaluate((el,text)=>{
      const data=new DataTransfer();data.setData('text/plain',text);
      el.dispatchEvent(new ClipboardEvent('paste',{bubbles:true,cancelable:true,clipboardData:data}));
    },clipboardText);
  }
  await pasteInto(workEditor,await readFile('fixtures/manual/large-prompt.txt','utf8'));
  text=await waitWarning(/Pasted text snapshot/);
  for(const expected of ['Email: 2','Pakistani phone: 1','CNIC-like number: 1','API key format: 1','Private key marker: 1']) assert.ok(text.includes(expected),expected);
  assert.equal((await workEditor.innerText()).trim(),'');
  assert.equal(await editor.locator('#pasted-chip').innerText(),'Pasted text attachment');
  assert.ok(!text.includes('beginning@example.test'));assert.ok(!text.includes('AAAA'));
  await editor.waitForTimeout(400);assert.match(await warning(),/Email: 2/);
  passed('Large clipboard paste is scanned before conversion to an attachment, even with an empty draft');
  await editor.locator('#send').click();assert.equal(await editor.locator('#sent').innerText(),'Sent: 2');
  await editor.locator('#replace').click();text=await waitWarning(/Pasted text snapshot/);assert.match(text,/Email: 2/);
  // A paste in a generic textbox must not replace the active composer snapshot.
  await pasteInto(editor.getByRole('textbox',{name:'Unrelated notes',exact:true}),'unrelated-only@example.test');
  assert.match(await warning(),/Email: 2/);
  await pasteInto(workEditor,'Ordinary library notes with no contact details.');
  text=await waitWarning(/Pasted text snapshot · No supported patterns found/);assert.ok(!text.includes('Email: 2'));
  passed('Paste reviews survive conversion/editor replacement, allow sending, ignore unrelated inputs, and replace older snapshots');
  await pasteInto(workEditor,'Ordinary notes. '.repeat(135000));
  await waitWarning(/Pasted text snapshot · Partially scanned/);
  passed('Clipboard scan character limit is explicitly reported as partial');
  const tree=await session.send('DOM.getDocument',{depth:-1,pierce:true});
  function dismissNode(n){if(n.attributes?.includes('data-promptprivacy-dismiss'))return n;for(const child of [...(n.children||[]),...(n.shadowRoots||[])]){const found=dismissNode(child);if(found)return found;}}
  const dismiss=dismissNode(tree.root);assert.ok(dismiss);
  const resolved=await session.send('DOM.resolveNode',{nodeId:dismiss.nodeId});
  await session.send('Runtime.callFunctionOn',{objectId:resolved.object.objectId,functionDeclaration:'function(){this.click();}'});
  assert.equal((await warning()).trim(),'');
  passed('Dismiss removes the masked clipboard snapshot');
  const storage=await page.evaluate(()=>chrome.storage.local.get(null)); assert.deepEqual(Object.keys(storage),['keywords']); passed('Only configured keyword preferences persisted');
  const memory={scanner:await page.evaluate(()=>performance.memory?{usedJSHeapSize:performance.memory.usedJSHeapSize,totalJSHeapSize:performance.memory.totalJSHeapSize}:null),editor:await editor.evaluate(()=>performance.memory?{usedJSHeapSize:performance.memory.usedJSHeapSize,totalJSHeapSize:performance.memory.totalJSHeapSize}:null),method:'Chrome performance.memory after workload; coarse renderer snapshots, may share isolate/process and exclude document workers, browser, and peak memory. Not attributable extension overhead.'};
  await page.locator('#file').setInputFiles(resolve('fixtures/documents/pdf-findings.pdf')); await page.waitForFunction(()=>document.querySelector('#result').dataset.status==='Findings detected');
  await page.screenshot({path:'artifacts/scanner.png',fullPage:true});
  assert.equal(outbound.length,0); assert.equal(errors.length,0); passed('No attempted runtime HTTP(S) requests or page errors in fixtures');
  await writeFile(`${reportPath}.json`,JSON.stringify({browserProduct:browserName,browser:context.browser().version(),checks,documentRuns,promptRuns,timingMethod:'performance.now around Playwright file selection or editor fill through observed result; includes automation, 50ms polling (prompt), debounce, file reads and worker initialization (document). Not isolated CPU time.',memory,outboundRequests:outbound.length,pageErrors:errors.length,liveChatGPT:'Not tested: local route fixture used; sign-in and production selectors require manual verification.',paste:'Synthetic insertFromPaste event; native clipboard paste remains manual.'},null,2));
  const times = documentRuns.map(r=>r.durationMs).sort((a,b)=>a-b);
  await writeFile(`${reportPath}.md`, `# ${browserName} integration measurements\n\n${browserName} (Chromium ${context.browser().version()}), Windows, production unpacked package, synthetic local editor fixture.\n\n${checks.map(name=>`- PASS: ${name}`).join('\n')}\n\n${documentRuns.length} real-worker/preflight document cases: median ${times[Math.floor(times.length/2)].toFixed(2)} ms, min ${times[0].toFixed(2)} ms, max ${times.at(-1).toFixed(2)} ms. Prompt end-to-end observations: ${promptRuns.map(r=>`${r.case}: ${r.durationMs.toFixed(2)} ms`).join('; ')}. Includes automation, typing, polling, debounce, reads, and worker startup; not isolated CPU time.\n\nRenderer JS heap snapshots: scanner ${(memory.scanner.usedJSHeapSize/2**20).toFixed(2)} MiB, editor ${(memory.editor.usedJSHeapSize/2**20).toFixed(2)} MiB. ${memory.method} Worker/browser-process peak memory is unavailable.\n\nNo attempted HTTP(S) requests and no page errors observed in these scenarios. Live signed-in ChatGPT, OS clipboard paste, keyboard/IME, and screen-reader checks remain manual. The paste check dispatches a synthetic insertFromPaste input event. Toolbar activation is automated through the browser debugging API.\n`);
} finally {await context.close();}
