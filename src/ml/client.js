import { MODEL_PORT, PREPARE_MODEL } from './protocol.js';

// A port carries one scan. Closing it cancels inference for that input.
export function requestModel(text, signal) {
  return new Promise(resolve => {
    let port;
    let settled = false;
    function finish(findings = null) {
      if (settled) return;
      settled = true;
      signal.removeEventListener('abort', cancel);
      try { port?.disconnect(); } catch { /* The extension may have reloaded. */ }
      text = null;
      resolve(findings);
    }
    function cancel() { finish(); }
    if (signal.aborted) { finish(); return; }
    signal.addEventListener('abort', cancel, { once: true });
    Promise.resolve().then(() => {
      if (!settled) return chrome.runtime.sendMessage({ type: PREPARE_MODEL });
    }).then(response => {
      if (settled) return;
      if (!response?.ready) { finish(); return; }
      port = chrome.runtime.connect({ name: MODEL_PORT });
      port.onDisconnect.addListener(() => {
        // A missing offscreen receiver or an extension reload is a recoverable failure.
        void chrome.runtime?.lastError;
        finish();
      });
      port.onMessage.addListener(message => finish(Array.isArray(message?.findings) ? message.findings : null));
      port.postMessage({ text });
      text = null;
    }).catch(cancel);
  });
}
