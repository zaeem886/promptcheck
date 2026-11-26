import { DEFAULT_LIMITS } from '../shared/limits.js';
import { isModelClient, MODEL_PORT } from './protocol.js';

let worker;
let nextId = 0;
const pending = new Map();

function getWorker() {
  if (worker) return worker;
  worker = new Worker(new URL('worker.js', import.meta.url), { type: 'module' });
  worker.onmessage = ({ data: { id, findings } }) => pending.get(id)?.(findings);
  worker.onerror = event => {
    event.preventDefault();
    worker.terminate();
    worker = null;
    for (const finish of pending.values()) finish(null);
  };
  return worker;
}

chrome.runtime.onConnect.addListener(port => {
  if (port.name !== MODEL_PORT) return;
  if (!isModelClient(port.sender)) { port.disconnect(); return; }
  const id = ++nextId;
  function finish(findings) {
    pending.delete(id);
    try { port.postMessage({ findings }); } catch { /* The sender already disconnected. */ }
  }
  port.onDisconnect.addListener(() => {
    if (pending.delete(id)) worker?.postMessage({ id });
  });
  port.onMessage.addListener(function start(message) {
    port.onMessage.removeListener(start);
    const text = message?.text;
    if (typeof text !== 'string' || !text.length || text.length > DEFAULT_LIMITS.maxTextChars) {
      finish(null);
      return;
    }
    try {
      pending.set(id, finish);
      getWorker().postMessage({ id, text });
    } catch { finish(null); }
  });
});
