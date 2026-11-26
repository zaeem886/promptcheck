import { siteForOrigin } from '../shared/sites.js';

export const MODEL_PAGE = 'ml/offscreen.html';
export const PREPARE_MODEL = 'promptprivacy:prepare-model';
export const MODEL_PORT = 'promptprivacy:scan-model';

export function isModelClient(sender) {
  if (sender?.id !== chrome.runtime.id || !sender.url || sender.frameId !== 0) return false;
  const url = new URL(sender.url);
  return !!siteForOrigin(url.origin) ||
    (url.protocol === 'chrome-extension:' && url.hostname === chrome.runtime.id && url.pathname === '/scanner/index.html');
}
