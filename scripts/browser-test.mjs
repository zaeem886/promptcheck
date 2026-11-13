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
const checks=[], documentRuns=[], promptRuns=[], siteRuns=[], outbound=[], errors=[];
const passed = name => { checks.push(name); console.log(`PASS ${name}`); };
try {
  const browserSession=await context.browser().newBrowserCDPSession();
  const {id}=await browserSession.send('Extensions.loadUnpacked',{path:extensionPath});
  passed(`Production MV3 extension loads in ${browserName}`);
  await context.route(/^https?:\/\//, async route => {
    if (route.request().url()==='https://chatgpt.com/fixture') return route.fulfill({contentType:'text/html',body:await readFile('fixtures/editor.html','utf8')});
    if (route.request().url()==='https://chatgpt.com/work-fixture') return route.fulfill({contentType:'text/html',body:await readFile('fixtures/editor-work.html','utf8')});
    const fixturePaths = {
      'https://claude.ai': 'fixtures/editor-claude.html',
      'https://gemini.google.com': 'fixtures/editor-gemini.html',
      'https://claude.ai.evil.test': 'fixtures/editor-claude.html',
      'https://example.test': 'fixtures/editor-gemini.html'
    };
    const url = new URL(route.request().url());
    if (url.pathname === '/fixture' && fixturePaths[url.origin]) return route.fulfill({contentType:'text/html',body:await readFile(fixturePaths[url.origin],'utf8')});
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
    if (doc.name === 'pdf-findings.pdf') assert.match(text,/Page 1 · Line 1/);
    if (doc.name === 'csv-findings.csv') assert.match(text,/Line 2, column/);
    if (doc.name === 'docx-findings.docx') assert.match(text,/Line 1, column/);
    documentRuns.push({name:doc.name,status:doc.status,durationMs:performance.now()-start});
  }
  passed(`Real browser worker extraction/status/masking for ${documentRuns.length} documents`);
  await page.locator('#file').setInputFiles(resolve('fixtures/manual/location-test.txt'));
  await page.waitForFunction(()=>document.querySelector('#result').dataset.status==='Findings detected');
  for (const expected of ['Line 2, column 8 · Top','Line 5, column 8 · Middle','Line 8, column 7 · Bottom']) assert.ok((await page.locator('#result').innerText()).includes(expected),expected);
  assert.equal(await page.locator('#result .occurrence').count(),3);
  await page.locator('#file').setInputFiles({name:'repeated.txt',mimeType:'text/plain',buffer:Buffer.from(Array(45).fill('demo@example.test').join('\n'))});
  await page.waitForFunction(()=>document.querySelector('#result').dataset.status==='Findings detected'&&document.querySelectorAll('#result .occurrence').length===20);
  await page.getByRole('button',{name:'Show 20 more Email findings (25 remaining)',exact:true}).click();
  assert.equal(await page.locator('#result .occurrence').count(),40);
  await page.getByRole('button',{name:'Show 5 more Email findings (5 remaining)',exact:true}).click();
  assert.equal(await page.locator('#result .occurrence').count(),45);
  assert.match(await page.locator('#result .occurrence-location').last().innerText(),/Line 45, column 1 · Bottom/);
  passed('Document locations include every repeated occurrence, logical lines, regions, PDF pages, and batched reveal');
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
  assert.deepEqual(status,{status:'editor-found',site:'chatgpt'});
  await page.goto(`chrome-extension://${id}/scanner/index.html?live=editor-found&site=chatgpt`);
  await page.getByText('Connected: the live scanner found', {exact:false}).waitFor();
  await page.getByRole('heading',{name:'ChatGPT live scanner',exact:true}).waitFor();
  passed('Privacy-preserving live-scanner connection diagnostic');
  await page.goto(`chrome-extension://${id}/scanner/index.html`);
  const session=await context.newCDPSession(editor);
  const {targetInfos} = await browserSession.send('Target.getTargets',{filter:[{type:'tab',exclude:false}]});
  const tabTarget = targetInfos.find(t=>t.type==='tab' && t.url===editor.url());
  assert.ok(tabTarget,'Fixture must have a browser tab target');
  async function toolbarStatus(expected, targetId = tabTarget.targetId, site = 'chatgpt') {
    const [diagnostic] = await Promise.all([
      context.waitForEvent('page'),
      browserSession.send('Extensions.triggerAction',{id,targetId})
    ]);
    await diagnostic.waitForURL(`**/scanner/index.html?live=${expected}*`);
    await diagnostic.locator('#live-status').waitFor();
    if (expected !== 'not-connected') {
      assert.equal(new URL(diagnostic.url()).searchParams.get('site'),site);
      const label = {chatgpt:'ChatGPT',claude:'Claude',gemini:'Gemini'}[site];
      await diagnostic.getByRole('heading',{name:`${label} live scanner`,exact:true}).waitFor();
    }
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
  async function clickDismiss() {
    const tree=await session.send('DOM.getDocument',{depth:-1,pierce:true});
    function find(n){if(n.attributes?.includes('data-promptprivacy-dismiss'))return n;for(const child of [...(n.children||[]),...(n.shadowRoots||[])]){const found=find(child);if(found)return found;}}
    const button=find(tree.root);assert.ok(button);
    assert.ok(button.attributes.includes('Dismiss warning'));
    const resolved=await session.send('DOM.resolveNode',{nodeId:button.nodeId});
    await session.send('Runtime.callFunctionOn',{objectId:resolved.object.objectId,functionDeclaration:'function(){this.click();}'});
  }
  async function locationReview(action, source = 'Current draft') {
    const tree=await session.send('DOM.getDocument',{depth:-1,pierce:true});
    function find(n){if(n.attributes?.includes('data-promptprivacy')&&n.attributes?.includes('advisory'))return n;for(const child of [...(n.children||[]),...(n.shadowRoots||[])]){const found=find(child);if(found)return found;}}
    const root=find(tree.root)?.shadowRoots?.[0];assert.ok(root);
    const resolved=await session.send('DOM.resolveNode',{nodeId:root.nodeId});
    const result=await session.send('Runtime.callFunctionOn',{
      objectId:resolved.object.objectId,returnByValue:true,arguments:[{value:action},{value:source}],
      functionDeclaration:`function(action,source){
        if(action==='open'){this.querySelector('details').open=true;return;}
        const block=[...this.querySelectorAll('.detail-scope')].find(x=>x.querySelector('strong').textContent.startsWith(source));
        if(action==='more'){block.querySelector('.more-findings:not([hidden])').click();return;}
        return [...block.querySelectorAll('.occurrence')].map(x=>({preview:x.querySelector('.occurrence-preview').textContent,location:x.querySelector('.occurrence-location').textContent}));
      }`
    });return result.result.value;
  }
  async function assertBelowComposer() {
    const layout=await editor.evaluate(()=>{
      const root=document.querySelector('[data-composer-root]'),host=document.querySelector('[data-promptprivacy="advisory"]');
      const a=root.getBoundingClientRect(),b=host.getBoundingClientRect();
      return {inside:root.contains(host),rootBottom:a.bottom,top:b.top,height:b.height,width:b.width,alignment:getComputedStyle(host).textAlign};
    });
    assert.equal(layout.inside,false);assert.ok(layout.top>=layout.rootBottom+4,JSON.stringify(layout));
    assert.ok(layout.height<230,JSON.stringify(layout));assert.ok(layout.width>250);assert.equal(layout.alignment,'left');
  }
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
  assert.deepEqual(workStatus,{status:'editor-found',site:'chatgpt'});
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
  await editor.waitForTimeout(30);assert.equal((await warning()).trim(),'');
  passed('ChatGPT clears paste snapshot on Send');
  await pasteInto(workEditor,await readFile('fixtures/manual/large-prompt.txt','utf8'));
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
  await clickDismiss();
  assert.equal((await warning()).trim(),'');
  passed('Dismiss removes the masked clipboard snapshot');
  const editorHeap = await editor.evaluate(()=>performance.memory?{usedJSHeapSize:performance.memory.usedJSHeapSize,totalJSHeapSize:performance.memory.totalJSHeapSize}:null);
  for (const provider of [
    {id:'claude',label:'Claude',url:'https://claude.ai/fixture',selector:'[data-composer-root] .ProseMirror'},
    {id:'gemini',label:'Gemini',url:'https://gemini.google.com/fixture',selector:'[data-composer-root] .ql-editor'}
  ]) {
    await editor.goto(provider.url);
    let input = editor.locator(provider.selector);
    await input.fill('Explain binary search.');
    await waitWarning(/No supported patterns found/);
    const before = performance.now();
    await input.fill('Contact demo@example.test and call +92 300 1234567');
    text = await waitWarning(/Pakistani phone: 1/);
    siteRuns.push({site:provider.id,warningMs:performance.now()-before,verification:'local composer fixture'});
    assert.match(text,/Email: 1/);assert.ok(!text.includes('demo@example.test'));
    assert.ok(text.includes(`${provider.label} can access your draft`));assert.ok(!text.includes('ChatGPT can access your draft'));
    assert.ok(!(await input.innerText()).includes('PromptPrivacy'));
    await editor.locator('[data-promptprivacy="advisory"]').evaluate(el=>el.remove());
    await waitWarning(/Pakistani phone: 1/);
    assert.equal(await editor.locator('[data-promptprivacy="advisory"]').count(),1);
    await editor.locator('#send').click();assert.equal(await editor.locator('#sent').innerText(),'Sent: 1');
    await input.fill('');await editor.waitForTimeout(30);assert.equal((await warning()).trim(),'');
    passed(`${provider.label}: draft scanning, masking, clearing, advisory remounting, and normal sending`);
    await input.pressSequentially('PROJECT MARIGOLD',{delay:1});
    await waitWarning(/Sensitive keyword: 1/);
    await editor.locator('#replace').click();
    await input.fill('demo@example.test');await waitWarning(/Email: 1/);
    await toolbarStatus('editor-found',tabTarget.targetId,provider.id);
    passed(`${provider.label}: shared keywords, typing, editor replacement, and toolbar diagnostic`);

    // Capture clipboard text even if a site's own paste handler creates a chip.
    await input.evaluate(el=>el.addEventListener('paste',event=>{
      event.preventDefault();el.replaceChildren();el.dispatchEvent(new InputEvent('input',{bubbles:true,inputType:'insertFromPaste'}));
    },{once:true}));
    await pasteInto(input,await readFile('fixtures/manual/large-prompt.txt','utf8'));
    text = await waitWarning(/Pasted text snapshot/);
    for(const expected of ['Email: 2','Pakistani phone: 1','CNIC-like number: 1','API key format: 1','Private key marker: 1']) assert.ok(text.includes(expected),expected);
    assert.equal((await input.innerText()).trim(),'');
    await pasteInto(editor.getByRole('textbox',{name:'Unrelated notes',exact:true}),'unrelated-only@example.test');
    assert.match(await warning(),/Email: 2/);
    await editor.evaluate(()=>history.pushState({},'', '/fixture?conversation=next'));
    await editor.locator('#replace').click();
    await input.fill('Next draft demo@example.test');await waitWarning(/Current draft · Possible sensitive information/);
    assert.equal(await editor.locator('[data-promptprivacy="advisory"]').count(),1);
    passed(`${provider.label}: large paste snapshots, unrelated-input exclusion, and SPA editor replacement`);
    siteRuns.at(-1).rendererHeapSnapshot = await editor.evaluate(()=>performance.memory?{usedJSHeapSize:performance.memory.usedJSHeapSize,totalJSHeapSize:performance.memory.totalJSHeapSize}:null);

    // Native textarea fallback, including ordinary paste without cancellation.
    await input.evaluate((el,id)=>{
      const textarea=document.createElement('textarea');textarea.setAttribute('aria-label','Prompt fallback');
      if(id==='claude')textarea.dataset.testid='chat-input';el.replaceWith(textarea);
    },provider.id);
    input = editor.locator('[data-composer-root] textarea');
    await input.fill('Call 03001234567');await waitWarning(/Pakistani phone: 1/);
    const allowed = await input.evaluate(el=>{
      const data=new DataTransfer();data.setData('text/plain','Ordinary notes');
      return el.dispatchEvent(new ClipboardEvent('paste',{bubbles:true,cancelable:true,clipboardData:data}));
    });assert.equal(allowed,true);
    passed(`${provider.label}: native textarea fallback and paste remains available`);
    // Removing the composer leaves history/artifacts/clipboard buffers and unrelated
    // fields on the page. None may be promoted to a prompt source.
    await editor.locator('[data-composer-root]').evaluate(el=>el.remove());
    await toolbarStatus('editor-not-found',tabTarget.targetId,provider.id);
    assert.equal((await warning()).trim(),'');
    passed(`${provider.label}: missing composer fails closed without scanning messages or helper buffers`);

    if (provider.id === 'claude') {
      await editor.goto(provider.url);
      await editor.locator('[data-testid="chat-input"]').evaluate(el=>el.removeAttribute('data-testid'));
      input=editor.locator(provider.selector);
      await input.evaluate(el=>{el.removeAttribute('aria-label');el.removeAttribute('role');});
      await input.fill('demo@example.test');await waitWarning(/Email: 1/);
      // Some Claude layouts have no form, fieldset, test id, or accessible label.
      await editor.locator('fieldset').evaluate(el=>{const wrapper=document.createElement('div');wrapper.dataset.composerRoot='';wrapper.append(...el.childNodes);el.replaceWith(wrapper);});
      await waitWarning(/Email: 1/);
      await input.fill('CNIC: 3520212345671');await waitWarning(/CNIC-like number: 1/);
      passed('Claude: legacy ProseMirror composer without test id, role, or fieldset');
      // Two plausible editors must remain unread until one is explicitly focused.
      await editor.getByRole('textbox',{name:'Unrelated notes',exact:true}).focus();
      await input.evaluate(el=>{const copy=el.cloneNode(false);copy.dataset.ambiguousClone='';el.after(copy);});
      await toolbarStatus('editor-not-found',tabTarget.targetId,'claude');
      await input.first().focus();await waitWarning(/CNIC-like number: 1/);
      passed('Claude: ambiguous composers are not scanned until a matching editor is focused');
    }
  }
  // Geometry and send lifecycle regressions for the layout reported by the user.
  for (const provider of [
    {id:'chatgpt',url:'https://chatgpt.com/work-fixture',selector:'[data-composer-markdown]'},
    {id:'claude',url:'https://claude.ai/fixture',selector:'[data-composer-root] .ProseMirror'},
    {id:'gemini',url:'https://gemini.google.com/fixture',selector:'[data-composer-root] .ql-editor'}
  ]) {
    await editor.goto(provider.url);const input=editor.locator(provider.selector);
    await input.fill('Contact demo@example.test and call +92 300 1234567');await waitWarning(/Email: 1/);
    await assertBelowComposer();
    await editor.screenshot({path:`artifacts/advisory-${provider.id}.png`,fullPage:true});
    await clickDismiss();await editor.waitForTimeout(400);assert.equal((await warning()).trim(),'');
    await editor.locator('#sent').evaluate(el=>el.append(document.createTextNode(' ')));await editor.waitForTimeout(30);
    assert.equal((await warning()).trim(),'');
    await input.fill('Contact edited@example.test');await waitWarning(/Email: 1/);
    passed(`${provider.id}: compact advisory is outside and below the full composer; dismiss remains closed until draft changes`);
    await pasteInto(input,'Contact pasted@example.test');await waitWarning(/Pasted text snapshot/);
    await editor.locator('#send').evaluate(el=>{el.disabled=true;el.click();});
    assert.match(await warning(),/Pasted text snapshot/);
    await editor.locator('#send').evaluate(el=>{el.disabled=false;});
    await editor.locator('#send').click();await editor.waitForTimeout(50);
    assert.equal((await warning()).trim(),'');
    await editor.waitForTimeout(400);assert.equal((await warning()).trim(),'');
    passed(`${provider.id}: Send clears the snapshot without blocking submission or re-opening stale findings`);
    // Enter configured as a newline and IME/Shift+Enter must preserve the review.
    await input.fill('Prepare another draft');await pasteInto(input,'Contact keyboard@example.test');
    await input.fill('Contact keyboard@example.test');await waitWarning(/Pasted text snapshot/);
    await input.press('Shift+Enter');await editor.waitForTimeout(50);assert.match(await warning(),/Pasted text snapshot/);
    await input.evaluate(el=>el.dispatchEvent(new KeyboardEvent('keydown',{key:'Enter',isComposing:true,bubbles:true,cancelable:true})));
    assert.match(await warning(),/Pasted text snapshot/);
    await editor.evaluate(()=>{window.enterInsertsNewline=true;});
    await input.press('Enter');await editor.waitForTimeout(400);assert.match(await warning(),/Pasted text snapshot/);
    await editor.evaluate(()=>{window.enterInsertsNewline=false;});
    await input.press('Enter');await editor.waitForTimeout(100);assert.equal((await warning()).trim(),'');
    // Attachment-only send: the draft starts empty, so Stop-control transition
    // is needed to confirm a keyboard submission when there is no submit event.
    await input.fill('Reset response state');await input.fill('');
    await pasteInto(input,'Contact attachment@example.test');await input.fill('');
    await waitWarning(/Pasted text snapshot/);await input.press('Enter');
    await editor.waitForTimeout(100);assert.equal((await warning()).trim(),'');
    passed(`${provider.id}: Enter-send and attachment-only send clear reviews; newline and IME do not`);
    // Responsive layout still stays beneath the composer, with no inherited
    // center alignment and no injected content in the editable scroll region.
    await editor.setViewportSize({width:390,height:844});
    await input.fill('demo@example.test');await waitWarning(/Email: 1/);await assertBelowComposer();
    await editor.setViewportSize({width:1280,height:720});
    const locationText=await readFile('fixtures/manual/location-test.txt','utf8');
    await input.fill(locationText);await waitWarning(/Line 8, column 7 · Bottom/);
    await locationReview('open');
    let occurrences=await locationReview('rows');assert.equal(occurrences.length,3);
    assert.deepEqual(occurrences.map(x=>x.location),['Line 2, column 8 · Top','Line 5, column 8 · Middle','Line 8, column 7 · Bottom']);
    assert.ok(!JSON.stringify(occurrences).includes('top@example.test'));
    await editor.screenshot({path:`artifacts/locations-${provider.id}.png`,fullPage:true});
    await input.fill('Inserted ordinary line\n'+locationText);await waitWarning(/Line 3, column 8/);
    occurrences=await locationReview('rows');assert.match(occurrences[0].location,/Line 3, column 8/);
    await pasteInto(input,locationText);await waitWarning(/Pasted text snapshot/);
    occurrences=await locationReview('rows','Pasted text snapshot');assert.equal(occurrences.length,3);
    assert.match(occurrences[0].location,/Line 2, column 8 · Top/);
    await pasteInto(input,Array(45).fill('demo@example.test').join('\n'));
    assert.equal((await locationReview('rows','Pasted text snapshot')).length,20);
    await locationReview('more','Pasted text snapshot');assert.equal((await locationReview('rows','Pasted text snapshot')).length,40);
    await locationReview('more','Pasted text snapshot');occurrences=await locationReview('rows','Pasted text snapshot');assert.equal(occurrences.length,45);
    assert.match(occurrences.at(-1).location,/Line 45, column 1 · Bottom/);
    passed(`${provider.id}: per-occurrence line/column/region updates, independent paste locations, and all repeated findings available`);
  }
  await editor.goto('https://chatgpt.com/fixture');
  await pasteInto(editor.locator('#prompt-textarea'),'form@example.test');await waitWarning(/Pasted text snapshot/);
  await editor.locator('form').evaluate(form=>form.requestSubmit());await editor.waitForTimeout(50);
  assert.equal((await warning()).trim(),'');passed('Native form submit clears a paste snapshot');
  for (const url of ['https://claude.ai.evil.test/fixture','https://example.test/fixture']) {
    await editor.goto(url);await editor.waitForTimeout(100);
    assert.equal(await editor.locator('[data-promptprivacy="advisory"]').count(),0);
  }
  passed('Unrelated sites and lookalike domains receive no content script');
  const storage=await page.evaluate(()=>chrome.storage.local.get(null)); assert.deepEqual(Object.keys(storage),['keywords']); passed('Only configured keyword preferences persisted');
  const memory={scanner:await page.evaluate(()=>performance.memory?{usedJSHeapSize:performance.memory.usedJSHeapSize,totalJSHeapSize:performance.memory.totalJSHeapSize}:null),editor:editorHeap,method:'Chrome performance.memory after workload; coarse renderer snapshots, may share isolate/process and exclude document workers, browser, and peak memory. Not attributable extension overhead.'};
  await page.locator('#file').setInputFiles(resolve('fixtures/documents/pdf-findings.pdf')); await page.waitForFunction(()=>document.querySelector('#result').dataset.status==='Findings detected');
  await page.screenshot({path:'artifacts/scanner.png',fullPage:true});
  assert.equal(outbound.length,0); assert.equal(errors.length,0); passed('No attempted runtime HTTP(S) requests or page errors in fixtures');
  await writeFile(`${reportPath}.json`,JSON.stringify({browserProduct:browserName,browser:context.browser().version(),checks,documentRuns,promptRuns,siteRuns,timingMethod:'performance.now around Playwright file selection or editor input through observed result; includes automation, 50ms polling (prompt), debounce, file reads and worker initialization (document). Not isolated CPU time.',memory,outboundRequests:outbound.length,pageErrors:errors.length,liveSites:'Local route fixtures for ChatGPT, Claude, and Gemini. Optional public Gemini check is reported separately in live-sites.json; signed-in testing remains manual.',paste:'Synthetic input and ClipboardEvent/DataTransfer events; native OS clipboard paste remains manual.'},null,2));
  const times = documentRuns.map(r=>r.durationMs).sort((a,b)=>a-b);
  const siteTable = siteRuns.map(run=>`| ${run.site} | ${run.warningMs.toFixed(2)} | ${(run.rendererHeapSnapshot.usedJSHeapSize/2**20).toFixed(2)} |`).join('\n');
  await writeFile(`${reportPath}.md`, `# ${browserName} integration measurements\n\n${browserName} (Chromium ${context.browser().version()}), Windows, production unpacked package. Local fixtures for ChatGPT, Claude, and Gemini; not signed-in live sessions.\n\n${checks.map(name=>`- PASS: ${name}`).join('\n')}\n\n${documentRuns.length} real-worker/preflight document cases: median ${times[Math.floor(times.length/2)].toFixed(2)} ms, min ${times[0].toFixed(2)} ms, max ${times.at(-1).toFixed(2)} ms. ChatGPT warning observations: ${promptRuns.map(r=>`${r.case}: ${r.durationMs.toFixed(2)} ms`).join('; ')}.\n\n| Additional site fixture | Warning latency ms | Renderer heap snapshot MiB |\n|---|---:|---:|\n${siteTable}\n\nTimings include automation, typing, polling, debounce, reads, and worker startup; not isolated CPU time. Renderer JS heap snapshots: scanner ${(memory.scanner.usedJSHeapSize/2**20).toFixed(2)} MiB, ChatGPT ${(memory.editor.usedJSHeapSize/2**20).toFixed(2)} MiB. ${memory.method} Worker/browser-process peak memory is unavailable.\n\nNo attempted HTTP(S) requests and no page errors observed in these scenarios. Signed-in live sites, OS clipboard paste, keyboard/IME, and screen-reader checks remain manual. Paste checks dispatch synthetic input and ClipboardEvent/DataTransfer events. Toolbar activation is automated through the browser debugging API. The optional public-page smoke check is reported separately in live-sites.json.\n`);
} finally {await context.close();}
