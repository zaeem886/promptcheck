import { siteById } from './shared/sites.js';
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
