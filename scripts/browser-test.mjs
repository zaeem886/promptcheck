import { chromium } from 'playwright';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { resolve } from 'node:path';
import assert from 'node:assert/strict';
import { evaluateHybrid } from './hybrid-evaluation.mjs';
const extensionPath = resolve('build');
const browserName = /brave/i.test(process.env.CHROME_PATH || '') ? 'Brave' : 'Chrome';
const reportPath = browserName === 'Brave' ? 'artifacts/brave-results' : 'artifacts/browser-results';
await mkdir('artifacts', {recursive:true});
const context = await chromium.launchPersistentContext(resolve(`artifacts/browser-profile/run-${browserName}-${Date.now()}`), {
  executablePath: process.env.CHROME_PATH || 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless:true,
  ignoreDefaultArgs:['--disable-extensions','--disable-component-extensions-with-background-pages'],
  args:['--enable-unsafe-extension-debugging']
});
const checks=[], documentRuns=[], promptRuns=[], siteRuns=[], outbound=[], errors=[];
const hybridSample = 'If the courier gets lost, ring +1 (202) 555-0198.\nShip the replacement to 42 Rue des Fleurs\n75011 Paris.';
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
    await page.waitForFunction(()=>{
      const status=document.querySelector('#result').dataset.status;
      return status && status!=='Scanning';
    },undefined,{timeout:20000});
    assert.equal(await page.locator('#result').getAttribute('data-status'),doc.status,doc.name);
    const text=await page.locator('#result').innerText();
    const previews=await page.locator('#result .occurrence-preview').allTextContents();
    for (const [index, expected] of doc.expected.entries()) {
      assert.equal(previews.includes(expected.value), index < doc.expected.length - (doc.unavailableFindings || 0), doc.name);
    }
    if (doc.name === 'pdf-findings.pdf') assert.match(text,/Page 1 · Line 1/);
    if (doc.name === 'csv-findings.csv') assert.match(text,/Line 2, column/);
    if (doc.name === 'docx-findings.docx') assert.match(text,/Line 1, column/);
    documentRuns.push({name:doc.name,status:doc.status,durationMs:performance.now()-start});
  }
  passed(`Real browser worker extraction, status and full values for ${documentRuns.length} documents`);
  const passphrase = '<script>document  test passphrase\r\nnext line</script>';
  const originalPhone = '＋۹۲ （۳۰۰） ۱۲۳۴۵۶۷';
  await page.locator('#file').setInputFiles({
    name: 'international-fields.txt', mimeType: 'text/plain',
    buffer: Buffer.from(`Phone: ${originalPhone}\nPassword: "${passphrase}"\nPassport: XZ4625079\nCard: 4242 4242 4242 4242`)
  });
  await page.waitForFunction(() => document.querySelector('#result').dataset.status === 'Findings detected');
  const internationalDocument = await page.locator('#result').innerText();
  for (const label of ['Phone number', 'Password or passphrase', 'Payment card']) assert.ok(internationalDocument.includes(label), label);
  const internationalPreviews = await page.locator('#result .occurrence-preview').allTextContents();
  for (const value of [originalPhone, passphrase, 'XZ4625079', '4242 4242 4242 4242']) assert.ok(internationalPreviews.includes(value));
  assert.equal(await page.locator('#result script').count(), 0);
  passed('Document findings preserve original formatting and render markup as plain text');
  await page.locator('#file').setInputFiles({name:'hybrid.txt',mimeType:'text/plain',buffer:Buffer.from(hybridSample)});
  await page.waitForFunction(() => document.querySelector('#result').textContent.includes('Rules + ML'));
  const hybridDocument = page.locator('#result');
  assert.deepEqual(await hybridDocument.locator('.occurrence-source').allTextContents(), ['Rules + ML', 'ML']);
  assert.match(await hybridDocument.innerText(), /Lines 2–3, column 25/);
  assert.deepEqual(await hybridDocument.locator('.occurrence-preview').allTextContents(), ['+1 (202) 555-0198', '42 Rue des Fleurs\n75011 Paris']);
  passed('Document rules and ML merge into full findings with original locations');
  await page.locator('#file').setInputFiles(resolve('fixtures/manual/location-test.txt'));
  await page.waitForFunction(()=>document.querySelector('#result').dataset.status==='Findings detected');
  for (const expected of ['Line 2, column 8 · Top','Line 5, column 8 · Middle','Line 8, column 7 · Bottom']) assert.ok((await page.locator('#result').innerText()).includes(expected),expected);
  assert.equal(await page.locator('#result .occurrence-source').filter({hasText:/^Rules/}).count(),3);
  await page.locator('#file').setInputFiles({name:'repeated.txt',mimeType:'text/plain',buffer:Buffer.from(Array(45).fill('demo@example.test').join('\n'))});
  const emailOccurrences = page.getByRole('list', {name:'Email occurrences',exact:true}).locator('.occurrence');
  await page.waitForFunction(()=>document.querySelector('#result').dataset.status==='Findings detected');
  assert.equal(await emailOccurrences.count(),20);
  await page.getByRole('button',{name:'Show 20 more Email findings (25 remaining)',exact:true}).click();
  assert.equal(await emailOccurrences.count(),40);
  await page.getByRole('button',{name:'Show 5 more Email findings (5 remaining)',exact:true}).click();
  assert.equal(await emailOccurrences.count(),45);
  assert.match(await emailOccurrences.last().locator('.occurrence-location').innerText(),/Line 45, column 1 · Bottom/);
  assert.equal(await emailOccurrences.last().locator('.occurrence-preview').textContent(),'demo@example.test');
  passed('Document locations include every repeated occurrence, logical lines, regions, PDF pages, and batched reveal');
  await page.locator('#clear').click();
  assert.equal(await page.locator('#result .occurrence-preview').count(),0);
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
  // Delay only the ML request so the real extraction and rules can finish.
  await page.evaluate(() => {
    const sendMessage = chrome.runtime.sendMessage;
    chrome.runtime.sendMessage = message => message.type === 'promptprivacy:prepare-model'
      ? new Promise(() => {}) : sendMessage(message);
    window.restoreSendMessage = () => { chrome.runtime.sendMessage = sendMessage; };
  });
  await page.locator('#file').setInputFiles({name:'pending-model.txt',mimeType:'text/plain',buffer:Buffer.from('demo@example.test')});
  await page.getByText('Checking with ML…', {exact:true}).waitFor();
  assert.match(await page.locator('#result').innerText(),/Email · 1/);
  assert.equal(await page.locator('#result .occurrence-preview').textContent(),'demo@example.test');
  await page.waitForFunction(()=>document.querySelector('#result').dataset.status==='Partially scanned');
  assert.match(await page.locator('#result').innerText(),/ML check reached the time limit/);
  assert.match(await page.locator('#result').innerText(),/Email · 1/);
  assert.equal(await page.locator('#result .occurrence-preview').textContent(),'demo@example.test');
  await page.evaluate(() => window.restoreSendMessage());
  passed('Document rules are visible during ML and survive its deadline');
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
  async function locationReview(action, source = 'Current draft', index = 0) {
    const tree=await session.send('DOM.getDocument',{depth:-1,pierce:true});
    function find(n){if(n.attributes?.includes('data-promptprivacy')&&n.attributes?.includes('advisory'))return n;for(const child of [...(n.children||[]),...(n.shadowRoots||[])]){const found=find(child);if(found)return found;}}
    const root=find(tree.root)?.shadowRoots?.[0];assert.ok(root);
    const resolved=await session.send('DOM.resolveNode',{nodeId:root.nodeId});
    const result=await session.send('Runtime.callFunctionOn',{
      objectId:resolved.object.objectId,returnByValue:true,awaitPromise:true,arguments:[{value:action},{value:source},{value:index}],
      functionDeclaration:`async function(action,source,index){
        if(action==='open'||action==='close'){
          this.querySelector('details').open=action==='open';
          await new Promise(resolve=>setTimeout(resolve,0));
          return;
        }
        if(action==='source'){
          const view=this.querySelector('.source-view:not([hidden])');
          if(!view)return null;
          const mark=view.querySelector('mark');
          return {caption:view.getAttribute('aria-label'),match:mark.textContent,
            before:mark.previousSibling.textContent,after:mark.nextSibling.textContent,
            focused:this.activeElement===view};
        }
        if(action==='focus-findings'){
          const pane=this.querySelector('.findings-scroll');
          pane.scrollIntoView({block:'center'});
          pane.focus({preventScroll:true});
          // Let the document scroll event from scrollIntoView settle before
          // testing the user's keyboard action inside the focused pane.
          await new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)));
          return;
        }
        if(action==='scroll-state'){
          const pane=this.querySelector('.findings-scroll');
          const bounds=pane.getBoundingClientRect();
          const summary=this.querySelector('details > summary').getBoundingClientRect();
          const last=[...pane.querySelectorAll('.occurrence')].at(-1).getBoundingClientRect();
          const conversation=pane.ownerDocument.querySelector('#fixture-conversation');
          const outer=conversation || pane.ownerDocument.scrollingElement;
          const chatBounds=conversation?.getBoundingClientRect();
          return {top:pane.scrollTop,max:pane.scrollHeight-pane.clientHeight,
            focus:this.activeElement===pane,tabIndex:pane.tabIndex,
            x:bounds.left+bounds.width/2,y:bounds.top+bounds.height/2,
            summaryTop:summary.top,summaryBottom:summary.bottom,paneTop:bounds.top,
            outerTop:outer.scrollTop,outerMax:outer.scrollHeight-outer.clientHeight,
            outerX:chatBounds ? chatBounds.left+chatBounds.width/2 : 12,
            outerY:chatBounds ? chatBounds.top+chatBounds.height/2 : 260,
            lastVisible:last.top>=Math.max(0,bounds.top)-1 &&
              last.bottom<=Math.min(pane.ownerDocument.defaultView.innerHeight,bounds.bottom)+1};
        }
        const block=[...this.querySelectorAll('.detail-scope')].find(x=>x.querySelector('strong').textContent.startsWith(source));
        if(action==='locate'){block.querySelectorAll('button.occurrence-preview')[index].click();return;}
        if(action==='more'){block.querySelector('.more-findings:not([hidden])').click();return;}
        const rows=action==='email' ? block.querySelectorAll('[aria-label="Email occurrences"] .occurrence') : block.querySelectorAll('.occurrence');
        return [...rows].map(x=>({preview:x.querySelector('.occurrence-preview').textContent,location:x.querySelector('.occurrence-location').textContent,source:x.querySelector('.occurrence-source').textContent}));
      }`
    });
    assert.ok(!result.exceptionDetails,result.exceptionDetails?.exception?.description);
    return result.result.value;
  }
  async function waitForFindingScroll(predicate, message) {
    let state;
    for (let attempt=0;attempt<40;attempt++) {
      state=await locationReview('scroll-state');
      if (predicate(state)) return state;
      await editor.waitForTimeout(50);
    }
    assert.fail(`${message}: ${JSON.stringify(state)}`);
  }
  async function assertFindingScrolling(docked) {
    if (docked) await editor.setViewportSize({width:1280,height:950});
    await editor.evaluate(docked=>{
      const composer=document.querySelector('[data-composer-root]');
      const advisory=document.querySelector('[data-promptprivacy="advisory"]');
      const history=document.createElement('section');
      history.setAttribute('aria-label','Conversation');
      history.setAttribute('role','log');
      const messages=document.createElement('div');
      messages.style.height='900px';
      messages.textContent='Earlier fixture messages';
      history.append(messages);
      if (docked) {
        history.id='fixture-conversation';
        history.style.cssText='height: 128px; overflow-y: auto';
        const main=document.createElement('main');
        const dock=document.createElement('div');
        composer.before(main);
        main.append(history,dock);
        dock.append(composer,advisory);
      } else {
        composer.before(history);
        const tail=document.createElement('div');
        tail.style.height='200px';
        document.body.append(tail);
      }
    },docked);
    await locationReview('focus-findings');
    await editor.keyboard.press('Home');
    const start=await waitForFindingScroll(s=>s.top<=1,'Home did not reach the first findings');
    assert.equal(start.tabIndex,0);
    assert.ok(start.focus && start.max>200 && start.summaryBottom<=start.paneTop,JSON.stringify(start));
    await editor.mouse.move(start.x,start.y);
    await editor.mouse.wheel(0,180);
    const down=await waitForFindingScroll(s=>s.top>0,'Wheel did not scroll findings down');
    assert.equal(down.outerTop,start.outerTop);
    assert.equal(down.summaryTop,start.summaryTop);
    await editor.mouse.wheel(0,-180);
    await waitForFindingScroll(s=>s.top<down.top,'Wheel did not scroll findings back up');
    await editor.keyboard.press('End');
    const end=await waitForFindingScroll(s=>s.max-s.top<=1 && s.lastVisible,'End did not show the last finding');
    if (!docked) {
      assert.ok(end.outerMax-end.outerTop>10,JSON.stringify(end));
      await editor.mouse.move(end.x,end.y);
      await editor.mouse.wheel(0,45);
      // An initial wheel may consume the fractional pixel left after End.
      // A fresh wheel at the edge must then scroll the outer page.
      await editor.waitForTimeout(350);
      if ((await locationReview('scroll-state')).outerTop === end.outerTop) await editor.mouse.wheel(0,45);
      await waitForFindingScroll(s=>s.outerTop>end.outerTop,'Wheel at the findings edge did not continue scrolling the page');
    }
    await editor.keyboard.press('Home');
    const beforeChatScroll=await waitForFindingScroll(s=>s.top<=1 && s.outerMax-s.outerTop>1,'Could not position chat above its end');
    await editor.mouse.move(beforeChatScroll.outerX,beforeChatScroll.outerY);
    await editor.mouse.wheel(0,2500);
    await waitForFindingScroll(s=>s.outerMax-s.outerTop<=1 && s.max-s.top<=1 && s.lastVisible,
      'Scrolling the chat down did not show the last finding');
    // Users can begin scrolling while the chat is already at its bottom.
    await editor.keyboard.press('Home');
    const chatAtEnd=await waitForFindingScroll(s=>s.top<=1 && s.outerMax-s.outerTop<=1,
      'Could not scroll findings up while the chat stayed at its end');
    await editor.mouse.move(chatAtEnd.outerX,chatAtEnd.outerY);
    await editor.mouse.wheel(0,180);
    await waitForFindingScroll(s=>s.max-s.top<=1 && s.lastVisible,
      'A downward wheel with the chat already at its end did not show the last finding');
    if (docked) await editor.setViewportSize({width:1280,height:720});
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
  async function assertInternationalFields(input) {
    const sample = 'Phone: +44 20 7946 0958\nPassword: "testing local passphrase"\nCard: 4242 4242 4242 4242\nIBAN: DE89 3704 0044 0532 0130 00\nPassport: XZ4625079';
    await input.fill(sample);
    const originalDraft = await input.innerText();
    const advisory = await waitWarning(/Passport: 1/);
    for (const expected of ['Phone number: 1', 'Password or passphrase: 1', 'Payment card: 1', 'IBAN: 1']) {
      assert.ok(advisory.includes(expected), expected);
    }
    for (const secret of ['testing local passphrase', '4242 4242', 'XZ4625079']) assert.ok(!advisory.includes(secret));
    assert.equal(await input.innerText(), originalDraft);
  }
  async function assertHybridDraft(input) {
    await input.fill('If the courier gets lost, ring +1 (202) 555-0198. Ship the replacement to 14 River Walk, Dublin D02 XY76.');
    const advisory = await waitWarning(/Rules \+ ML/);
    assert.match(advisory,/Postal address: 1/);
    assert.match(advisory,/Phone number: 1/);
    assert.ok(!advisory.includes('River Walk'));
    assert.deepEqual((await locationReview('rows')).map(row=>row.source), ['Rules + ML', 'ML']);
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
  await waitWarning(/Phone number: 1/); passed('Pasted text follows the same input scan path');
  await editor.locator('#replace').click(); await editor.locator('#prompt-textarea').fill('PROJECT MARIGOLD');
  text=await waitWarning(/Sensitive keyword: 1/); assert.ok(!text.includes('PROJECT MARIGOLD')); passed('Editor replacement and stored literal keywords');
  await editor.locator('#prompt-textarea').fill('sk-'+'A'.repeat(24));
  text=await waitWarning(/API key format: 1/); assert.ok(text.includes('[credential hidden]')); assert.ok(!text.includes('AAA')); passed('Live credentials are fully masked');
  await assertInternationalFields(editor.locator('#prompt-textarea'));
  passed('ChatGPT international phone, financial, password and passport findings are masked');
  await assertHybridDraft(editor.locator('#prompt-textarea'));
  passed('ChatGPT adds a masked ML-only address and counts the shared phone once');
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
  text = await waitWarning(/Phone number: 1/);
  assert.match(text,/Email: 1/); assert.ok(!text.includes('demo@example.test'));
  assert.equal(await workEditor.getAttribute('id'),null);
  passed('Work composer without an id scans existing nested paragraph/span draft only');
  // The unrelated textbox must never become a scan source even when focused.
  await editor.getByRole('textbox',{name:'Unrelated notes',exact:true}).focus();
  text = await waitWarning(/Phone number: 1/); assert.match(text,/Email: 1/);
  await workEditor.fill(''); await editor.waitForTimeout(30); assert.equal((await warning()).trim(),'');
  await workEditor.pressSequentially('Contact demo@example.test',{delay:1});
  await waitWarning(/Email: 1/);
  await editor.locator('#send').click(); assert.equal(await editor.locator('#sent').innerText(),'Sent: 1');
  passed('Work editor typing, clearing, unrelated-editor exclusion, and normal sending');
  await editor.locator('#replace').click();
  await workEditor.evaluate(el=>{ const p=document.createElement('p'); const span=document.createElement('span'); span.setAttribute('data-prompt-literal-paste',''); span.textContent='Call +92 300 1234567'; p.append(span); el.replaceChildren(p); el.dispatchEvent(new InputEvent('input',{bubbles:true,inputType:'insertFromPaste'})); });
  await waitWarning(/Phone number: 1/);
  const workStatus=await background.evaluate(tabId=>chrome.tabs.sendMessage(tabId,{type:'promptprivacy:status'}),connectedId);
  assert.deepEqual(workStatus,{status:'editor-found',site:'chatgpt'});
  passed('Work editor replacement, nested paste input, and connected diagnostic');
  async function pasteInto(locator, clipboardText) {
    await locator.evaluate((el,text)=>{
      const data=new DataTransfer();data.setData('text/plain',text);
      el.dispatchEvent(new ClipboardEvent('paste',{bubbles:true,cancelable:true,clipboardData:data}));
    },clipboardText);
  }
  await pasteInto(workEditor, hybridSample);
  await waitWarning(/Rules \+ ML/);
  assert.deepEqual((await locationReview('rows','Pasted text snapshot')).map(row=>row.source), ['Rules + ML', 'ML']);
  passed('Clipboard snapshots merge model findings after the paste becomes an attachment');
  await locationReview('open');
  const fullPasteRows = await locationReview('rows','Pasted text snapshot');
  assert.equal(fullPasteRows[1].preview,'42 Rue des Fleurs\n75011 Paris');
  await locationReview('locate','Pasted text snapshot',1);
  const addressSource = await locationReview('source');
  assert.equal(addressSource.match,fullPasteRows[1].preview);
  assert.match(addressSource.caption,/Pasted text · Lines 2–3/);
  assert.ok(addressSource.focused);
  await locationReview('close');
  assert.equal(await locationReview('source'),null);
  assert.ok(!(await warning()).includes('42 Rue des Fleurs'));
  passed('Full ML-only paste values jump to the exact multiline source and are hidden on collapse');
  await pasteInto(workEditor,await readFile('fixtures/manual/large-prompt.txt','utf8'));
  text=await waitWarning(/Pasted text snapshot/);
  for(const expected of ['Email: 2','Phone number: 1','CNIC-like number: 1','API key format: 1','Private key marker: 1']) assert.ok(text.includes(expected),expected);
  assert.equal((await workEditor.innerText()).trim(),'');
  assert.equal(await editor.locator('#pasted-chip').innerText(),'Pasted text attachment');
  assert.ok(!text.includes('beginning@example.test'));assert.ok(!text.includes('AAAA'));
  await editor.waitForTimeout(400);assert.match(await warning(),/Email: 2/);
  passed('Large clipboard paste is scanned before conversion to an attachment, even with an empty draft');
  await editor.locator('#send').click();assert.equal(await editor.locator('#sent').innerText(),'Sent: 2');
  await editor.waitForTimeout(30);assert.equal((await warning()).trim(),'');
  passed('ChatGPT clears paste snapshot on Send');
  const duplicatePaste = '🧪 First: repeat@example.test\r\n' + 'Ordinary library notes.\r\n'.repeat(700) +
    'Last: repeat@example.test after the final paragraph.';
  await pasteInto(workEditor,duplicatePaste);
  await waitWarning(/Email: 2/);
  await locationReview('open');
  await locationReview('locate','Pasted text snapshot',1);
  const secondSource = await locationReview('source');
  assert.match(secondSource.caption,/Line 702, column 7 · Bottom/);
  assert.equal(secondSource.match,'repeat@example.test');
  assert.match(secondSource.before,/\r\nLast: $/);
  assert.equal(secondSource.after,' after the final paragraph.');
  assert.equal((await workEditor.innerText()).trim(),'');
  for (let attempt=0; /Checking with ML/.test(await warning()) && attempt<120; attempt++) await editor.waitForTimeout(50);
  assert.deepEqual(await locationReview('source'),secondSource);
  await pasteInto(workEditor,'Replacement: next@example.test');
  assert.equal(await locationReview('source'),null);
  assert.ok(!(await warning()).includes('repeat@example.test'));
  await clickDismiss();
  passed('Duplicate and CRLF paste locations use the clicked offset, survive ML updates, and clear when replaced');
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
  const pendingPaste = hybridSample + '\n' + 'Ordinary library notes. '.repeat(2400);
  await pasteInto(workEditor,pendingPaste);
  await waitWarning(/Checking with ML/);
  await editor.locator('#send').click();
  await editor.waitForTimeout(1200);
  assert.equal((await warning()).trim(),'');
  await pasteInto(workEditor,pendingPaste);
  await waitWarning(/Checking with ML/);
  await clickDismiss();
  await editor.waitForTimeout(1200);
  assert.equal((await warning()).trim(),'');
  passed('Send and Dismiss discard an in-flight model response');
  const editorHeap = await editor.evaluate(()=>performance.memory?{usedJSHeapSize:performance.memory.usedJSHeapSize,totalJSHeapSize:performance.memory.totalJSHeapSize}:null);
  for (const provider of [
    {id:'claude',label:'Claude',url:'https://claude.ai/fixture',selector:'[data-composer-root] .ProseMirror'},
    {id:'gemini',label:'Gemini',url:'https://gemini.google.com/fixture',selector:'[data-composer-root] .ql-editor'}
  ]) {
    await editor.goto(provider.url);
    let input = editor.locator(provider.selector);
    await input.fill('Explain binary search.');
    await waitWarning(/No supported patterns found/);
    await assertInternationalFields(input);
    await assertHybridDraft(input);
    passed(provider.label + ': international fields use the shared detector and masked advisory');
    const before = performance.now();
    await input.fill('Contact demo@example.test and call +92 300 1234567');
    text = await waitWarning(/Phone number: 1/);
    siteRuns.push({site:provider.id,warningMs:performance.now()-before,verification:'local composer fixture'});
    assert.match(text,/Email: 1/);assert.ok(!text.includes('demo@example.test'));
    assert.ok(text.includes(`${provider.label} can access your draft`));assert.ok(!text.includes('ChatGPT can access your draft'));
    assert.ok(!(await input.innerText()).includes('PromptPrivacy'));
    await editor.locator('[data-promptprivacy="advisory"]').evaluate(el=>el.remove());
    await waitWarning(/Phone number: 1/);
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
    for(const expected of ['Email: 2','Phone number: 1','CNIC-like number: 1','API key format: 1','Private key marker: 1']) assert.ok(text.includes(expected),expected);
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
    await input.fill('Call 03001234567');await waitWarning(/Phone number: 1/);
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
    let occurrences=(await locationReview('rows')).filter(row=>row.source.startsWith('Rules'));assert.equal(occurrences.length,3);
    assert.deepEqual(occurrences.map(x=>x.location),['Line 2, column 8 · Top','Line 5, column 8 · Middle','Line 8, column 7 · Bottom']);
    assert.equal(occurrences[0].preview,'top@example.test');
    await locationReview('locate');
    assert.equal((await locationReview('source')).match,'top@example.test');
    await input.fill('Inserted ordinary line\n'+locationText);
    assert.equal(await locationReview('source'),null);
    await waitWarning(/Line 3, column 8/);
    await editor.screenshot({path:`artifacts/locations-${provider.id}.png`,fullPage:true});
    occurrences=(await locationReview('rows')).filter(row=>row.source.startsWith('Rules'));assert.match(occurrences[0].location,/Line 3, column 8/);
    await pasteInto(input,locationText);await waitWarning(/Pasted text snapshot/);
    occurrences=(await locationReview('rows','Pasted text snapshot')).filter(row=>row.source.startsWith('Rules'));assert.equal(occurrences.length,3);
    assert.match(occurrences[0].location,/Line 2, column 8 · Top/);
    await input.fill('');
    await pasteInto(input,Array(45).fill('demo@example.test').join('\n'));
    for (let attempt = 0; /Checking with ML/.test(await warning()) && attempt < 40; attempt++) await editor.waitForTimeout(50);
    assert.equal((await locationReview('email','Pasted text snapshot')).length,20);
    await locationReview('more','Pasted text snapshot');assert.equal((await locationReview('email','Pasted text snapshot')).length,40);
    await locationReview('more','Pasted text snapshot');occurrences=await locationReview('email','Pasted text snapshot');assert.equal(occurrences.length,45);
    assert.match(occurrences.at(-1).location,/Line 45, column 1 · Bottom/);
    passed(`${provider.id}: per-occurrence line/column/region updates, independent paste locations, and all repeated findings available`);
    await assertFindingScrolling(provider.id==='gemini');
    passed(`${provider.id}: findings scroll both ways and reach the last row when the chat scrolls to the bottom`);
    await locationReview('locate','Pasted text snapshot',44);
    assert.equal((await locationReview('source')).caption,'Pasted text · Line 45, column 1 · Bottom');
    passed(`${provider.id}: clicking a repeated finding opens the correct paste line`);
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
  const hybridEvaluation = await evaluateHybrid(page);
  passed('Packaged model matches Kaggle span references and is scored on the fixed 96-prompt challenge');
  const memory={scanner:await page.evaluate(()=>performance.memory?{usedJSHeapSize:performance.memory.usedJSHeapSize,totalJSHeapSize:performance.memory.totalJSHeapSize}:null),editor:editorHeap,method:'Chrome performance.memory after workload; coarse renderer snapshots, may share isolate/process and exclude document workers, browser, and peak memory. Not attributable extension overhead.'};
  await page.locator('#file').setInputFiles(resolve('fixtures/documents/pdf-findings.pdf')); await page.waitForFunction(()=>document.querySelector('#result').dataset.status==='Findings detected');
  await page.screenshot({path:'artifacts/scanner.png',fullPage:true});
  assert.equal(outbound.length,0); assert.equal(errors.length,0); passed('No attempted runtime HTTP(S) requests or page errors in fixtures');
  await writeFile(`${reportPath}.json`,JSON.stringify({browserProduct:browserName,browser:context.browser().version(),checks,documentRuns,promptRuns,siteRuns,hybridEvaluation,timingMethod:'performance.now around Playwright file selection or editor input through observed result; includes automation, 50ms polling (prompt), debounce, file reads and worker initialization (document). Not isolated CPU time.',memory,outboundRequests:outbound.length,pageErrors:errors.length,liveSites:'Local route fixtures for ChatGPT, Claude, and Gemini. Optional public Gemini check is reported separately in live-sites.json; signed-in testing remains manual.',paste:'Synthetic input and ClipboardEvent/DataTransfer events; native OS clipboard paste remains manual.'},null,2));
  const times = documentRuns.map(r=>r.durationMs).sort((a,b)=>a-b);
  const siteTable = siteRuns.map(run=>`| ${run.site} | ${run.warningMs.toFixed(2)} | ${(run.rendererHeapSnapshot.usedJSHeapSize/2**20).toFixed(2)} |`).join('\n');
  await writeFile(`${reportPath}.md`, `# ${browserName} integration measurements\n\n${browserName} (Chromium ${context.browser().version()}), Windows, production unpacked package. Local fixtures for ChatGPT, Claude, and Gemini; not signed-in live sessions.\n\n${checks.map(name=>`- PASS: ${name}`).join('\n')}\n\n${documentRuns.length} real-worker/preflight document cases: median ${times[Math.floor(times.length/2)].toFixed(2)} ms, min ${times[0].toFixed(2)} ms, max ${times.at(-1).toFixed(2)} ms. ChatGPT warning observations: ${promptRuns.map(r=>`${r.case}: ${r.durationMs.toFixed(2)} ms`).join('; ')}.\n\n| Additional site fixture | Warning latency ms | Renderer heap snapshot MiB |\n|---|---:|---:|\n${siteTable}\n\nTimings include automation, typing, polling, debounce, reads, and worker startup; not isolated CPU time. Renderer JS heap snapshots: scanner ${(memory.scanner.usedJSHeapSize/2**20).toFixed(2)} MiB, ChatGPT ${(memory.editor.usedJSHeapSize/2**20).toFixed(2)} MiB. ${memory.method} Worker/browser-process peak memory is unavailable.\n\nNo attempted HTTP(S) requests and no page errors observed in these scenarios. Signed-in live sites, OS clipboard paste, keyboard/IME, and screen-reader checks remain manual. Paste checks dispatch synthetic input and ClipboardEvent/DataTransfer events. Toolbar activation is automated through the browser debugging API. The optional public-page smoke check is reported separately in live-sites.json.\n`);
} finally {await context.close();}
