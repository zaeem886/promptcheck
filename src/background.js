chrome.action.onClicked.addListener(async tab => {
  let status = 'not-connected';
  if (tab.id !== undefined) {
    try {
      const response = await chrome.tabs.sendMessage(tab.id, { type: 'promptprivacy:status' });
      if (['editor-found', 'editor-not-found'].includes(response?.status)) status = response.status;
    } catch { /* Reloading an extension does not inject into already open tabs. */ }
  }
  chrome.tabs.create({ url: chrome.runtime.getURL(`scanner/index.html?live=${status}`) });
});
// Only preferences are persisted. Do not add scan results or draft state here.
