import { normalizeKeywords } from '../shared/detector.js';
import { DEFAULT_LIMITS, preflight, notScanned } from '../shared/scan.js';
const $ = id => document.getElementById(id);
const connectionMessages = {
  'editor-found': 'Connected: the live scanner found the prompt editor in the tab where you clicked the toolbar icon. Typed text stays unchanged; masked previews appear in a separate advisory near the editor.',
  'editor-not-found': 'The live scanner loaded, but could not find a supported prompt editor. Open a new chat and click the toolbar icon again. If this persists, the ChatGPT editor adapter needs updating.',
  'not-connected': 'The live scanner is not connected to that tab. Open https://chatgpt.com/, allow PromptPrivacy access to that site in your browser extension settings, and refresh the ChatGPT tab after loading or reloading the extension. Then click the toolbar icon from that tab again.'
};
const connection = new URLSearchParams(location.search).get('live');
if (Object.hasOwn(connectionMessages, connection)) {
  $('live-status').hidden = false;
  $('live-message').textContent = connectionMessages[connection];
}
let worker = null, generation = 0, deadline = null, keywords = [];
function stop() { generation++; clearTimeout(deadline); worker?.terminate(); worker = null; $('cancel').disabled = true; }
function render(result, duration) {
  const box = $('result'); box.replaceChildren(); box.dataset.status = result.status;
  const title = document.createElement('h3'); title.textContent = result.status; box.append(title);
  if (result.reason) { const p = document.createElement('p'); p.textContent = result.reason; box.append(p); }
  if (result.partial && result.findings.length) { const p = document.createElement('p'); p.textContent = `${result.findings.length} possible findings in the extracted portion.`; box.append(p); }
  for (const group of result.groups) {
    const row = document.createElement('div'); row.className = 'finding'; row.textContent = `${group.label} · ${group.count}`;
    const preview = document.createElement('span'); preview.textContent = group.previews.join(' · '); row.append(preview); box.append(row);
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
  // Deadline includes file read, worker initialization, extraction, and detection.
  deadline = setTimeout(() => { if (id === generation) { stop(); render(notScanned('Processing time limit exceeded. The worker was terminated.')); } }, config.timeoutMs);
  try {
    const buffer = await file.arrayBuffer(); if (id !== generation) return;
    worker = new Worker(new URL('worker.js', import.meta.url), { type: 'module' });
    worker.onmessage = ({ data }) => { if (id !== generation || data.id !== id) return; stop(); render(data.result, data.durationMs); };
    worker.onerror = event => { event.preventDefault(); if (id === generation) { stop(); render(notScanned('Document processing failed. No scan result is available.')); } };
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
