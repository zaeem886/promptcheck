import { normalizeKeywords } from '../shared/detector.js';
import { DEFAULT_LIMITS, preflight, incompleteModelScan, notScanned } from '../shared/scan.js';
import { requestModel } from '../ml/client.js';
import { siteById } from '../shared/sites.js';
import { appendFindingList } from '../ui/finding-list.js';
const $ = id => document.getElementById(id);
const params = new URLSearchParams(location.search);
const site = siteById(params.get('site'));
const label = site?.label || 'AI chat';
const connectionMessages = {
  'editor-found': `Connected: the live scanner found the ${label} prompt editor in the tab where you clicked the toolbar icon. Finding details appear in a separate advisory near the editor.`,
  'editor-not-found': `The ${label} live scanner loaded, but could not find a supported prompt editor. Open a new chat and click the toolbar icon again. If this persists, the ${label} editor adapter needs updating.`,
  'not-connected': 'The live scanner is not connected to that tab. Open chatgpt.com, claude.ai, or gemini.google.com, allow PromptPrivacy access to that site in your browser extension settings, and refresh the chat tab after loading or reloading the extension. Then click the toolbar icon from that tab again.'
};
const connection = params.get('live');
if (Object.hasOwn(connectionMessages, connection)) {
  $('live-status').hidden = false;
  $('live-title').textContent = `${label} live scanner`;
  $('live-message').textContent = connectionMessages[connection];
}
let worker = null, generation = 0, deadline = null, modelRequest = null, keywords = [];
function stop() {
  generation++;
  clearTimeout(deadline);
  modelRequest?.abort(); modelRequest = null;
  worker?.terminate(); worker = null;
  $('cancel').disabled = true;
}
function render(result, { duration, checkingModel = false, extractedText } = {}) {
  const box = $('result'); box.replaceChildren(); box.dataset.status = checkingModel ? 'Scanning' : result.status;
  const title = document.createElement('h3');
  title.textContent = checkingModel && !result.findings.length && !result.partial ? 'Checking with ML…' : result.status;
  box.append(title);
  if (checkingModel && title.textContent !== 'Checking with ML…') {
    const pending = document.createElement('p'); pending.textContent = 'Checking with ML…'; box.append(pending);
  }
  if (result.reason) { const p = document.createElement('p'); p.textContent = result.reason; box.append(p); }
  if (result.partial && result.findings.length) { const p = document.createElement('p'); p.textContent = `${result.findings.length} possible findings so far.`; box.append(p); }
  for (const group of result.groups) {
    const row = document.createElement('div'); row.className = 'finding'; row.textContent = `${group.label} · ${group.count}`;
    appendFindingList(row, group.occurrences, group.label, { text: extractedText }); box.append(row);
  }
  if (result.findings.length) {
    const note = document.createElement('p'); note.className = 'footnote';
    note.textContent = `Locations refer to ${result.locationBasis}${result.partial ? ' in the scanned portion' : ''}. Lines count actual line breaks; Top/Middle/Bottom are thirds of that text. PDF/DOCX visual lines and screen wrapping may differ.`;
    box.append(note);
  }
  if (result.pages) { const p = document.createElement('p'); p.textContent = `${result.scannedPages} of ${result.pages} pages yielded text.`; box.append(p); }
  if (duration !== undefined) { const p = document.createElement('p'); p.textContent = `Processed locally in ${(duration / 1000).toFixed(2)} s. Nothing was attached or uploaded.`; box.append(p); }
}
function limits() {
  const size = Number($('max-size').value), seconds = Number($('timeout').value);
  if (!Number.isFinite(size) || size < 1 || size > 25 || !Number.isFinite(seconds) || seconds < 1 || seconds > 60) return null;
  return { ...DEFAULT_LIMITS, maxBytes: size * 1024 * 1024, timeoutMs: seconds * 1000 };
}
async function scan(file) {
  stop(); const id = generation;
  const config = limits();
  if (!config) return render(notScanned('Choose a size limit from 1–25 MiB and time limit from 1–60 seconds.'));
  const reason = preflight(file, config); if (reason) return render(notScanned(reason));
  $('result').dataset.status = 'Scanning'; $('result').textContent = 'Scanning locally…'; $('cancel').disabled = false;
  let ruleResult = null, extractedText;
  // The deadline includes file read, extraction, rules, and model inference.
  deadline = setTimeout(() => {
    if (id !== generation) return;
    stop();
    render(ruleResult ? incompleteModelScan(ruleResult, 'The ML check reached the time limit. Rule results are shown.')
      : notScanned('Processing time limit exceeded. The worker was terminated.'), { extractedText });
  }, config.timeoutMs);
  try {
    const buffer = await file.arrayBuffer(); if (id !== generation) return;
    worker = new Worker(new URL('worker.js', import.meta.url), { type: 'module' });
    worker.onmessage = ({ data }) => {
      if (id !== generation || data.id !== id) return;
      if (data.modelText === undefined) { stop(); render(data.result, { duration: data.durationMs, extractedText }); return; }
      ruleResult = data.result;
      extractedText = data.modelText;
      modelRequest = new AbortController();
      const pending = requestModel(extractedText, modelRequest.signal);
      render(ruleResult, { checkingModel: true, extractedText });
      pending.then(findings => {
        if (id === generation) worker.postMessage({ id, findings });
      });
    };
    worker.onerror = event => {
      event.preventDefault();
      if (id !== generation) return;
      stop();
      render(ruleResult ? incompleteModelScan(ruleResult, 'The ML check could not finish. Rule results are shown.')
        : notScanned('Document processing failed. No scan result is available.'), { extractedText });
    };
    worker.postMessage({ id, buffer, name: file.name, limits: config, keywords }, [buffer]);
  } catch { if (id === generation) { stop(); render(notScanned('The selected file could not be read.')); } }
}
$('file').addEventListener('change', () => { if ($('file').files[0]) scan($('file').files[0]); });
$('cancel').onclick = () => { stop(); render(notScanned('Scan cancelled.')); };
$('clear').onclick = () => { stop(); $('file').value = ''; $('result').removeAttribute('data-status'); $('result').textContent = 'Ready when you are. Select a document. No file is attached or uploaded.'; };
chrome.storage.local.get({ keywords: [] }).then(value => { keywords = normalizeKeywords(value.keywords); $('keywords').value = keywords.join('\n'); });
$('save').onclick = async () => {
  const next = normalizeKeywords($('keywords').value.split('\n'));
  try { await chrome.storage.local.set({ keywords: next }); keywords = next; $('keywords').value = keywords.join('\n'); $('saved').textContent = 'Keyword preferences saved on this device.'; }
  catch { $('saved').textContent = 'Could not save preferences. Please reload the extension.'; }
};
window.addEventListener('pagehide', stop);
