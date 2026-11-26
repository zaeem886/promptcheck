import { siteById } from './shared/sites.js';
import { isModelClient, MODEL_PAGE, PREPARE_MODEL } from './ml/protocol.js';

let preparingModelPage;
async function prepareModelPage() {
  const contexts = await chrome.runtime.getContexts({
    contextTypes: ['OFFSCREEN_DOCUMENT'],
    documentUrls: [chrome.runtime.getURL(MODEL_PAGE)]
  });
  if (!contexts.length) await chrome.offscreen.createDocument({
    url: MODEL_PAGE,
    reasons: ['WORKERS'],
    justification: 'Run and reuse the local privacy model in a worker for draft, paste, and document checks.'
  });
}

chrome.runtime.onMessage.addListener((message, sender, respond) => {
  if (message?.type !== PREPARE_MODEL || !isModelClient(sender)) return;
  preparingModelPage ??= prepareModelPage().finally(() => { preparingModelPage = null; });
  preparingModelPage.then(() => respond({ ready: true }), () => respond({ ready: false }));
  return true;
});

chrome.action.onClicked.addListener(async tab => {
  let status = 'not-connected';
  let site = null;
  if (tab.id !== undefined) {
    try {
      const response = await chrome.tabs.sendMessage(tab.id, { type: 'promptprivacy:status' });
      if (['editor-found', 'editor-not-found'].includes(response?.status) && siteById(response?.site)) {
        status = response.status; site = response.site;
      }
    } catch { /* Reloading an extension does not inject into already open tabs. */ }
  }
  chrome.tabs.create({ url: chrome.runtime.getURL(`scanner/index.html?live=${status}${site ? `&site=${site}` : ''}`) });
});
// Only preferences are persisted. Do not add scan results or draft state here.
