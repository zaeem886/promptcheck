import { detect, normalizeKeywords, summarize } from '../shared/detector.js';
import { DEFAULT_LIMITS } from '../shared/scan.js';
// Site-specific adapter. Never read conversation messages or other inputs.
const SELECTOR = [
  '#prompt-textarea[contenteditable="true"]',
  'textarea#prompt-textarea',
  '[contenteditable="true"][data-testid="prompt-textarea"]',
  // ChatGPT Work composer: observed in the user's live DOM; it has no editor id.
  '[contenteditable="true"][role="textbox"][data-composer-markdown]'
].join(', ');
export function startAdapter(doc = document, storage = chrome.storage) {
  let editor = null, host = null, panel = null, timer, keywords = [], lastText = null;
  let draftGroups = null, pasteReview = null;
  function read() { return editor ? ('value' in editor ? editor.value : editor.innerText) || '' : ''; }
  function appendGroups(groups) {
    for (const group of groups) {
      const line = doc.createElement('div');
      line.textContent = `${group.label}: ${group.count} · ${group.previews.join(', ')}`;
      panel.append(line);
    }
  }
  function render() {
    if (!panel) return;
    panel.replaceChildren();
    if (draftGroups !== null) {
      const title = doc.createElement('strong');
      title.textContent = draftGroups.length ? 'PromptPrivacy · Current draft · Possible sensitive information' : 'PromptPrivacy · Current draft · No supported patterns found';
      panel.append(title); appendGroups(draftGroups);
    }
    if (pasteReview) {
      const title = doc.createElement('strong');
      title.textContent = `PromptPrivacy · Pasted text snapshot · ${pasteReview.partial ? 'Partially scanned' : pasteReview.groups.length ? 'Findings detected' : 'No supported patterns found'}`;
      panel.append(title); appendGroups(pasteReview.groups);
      const explanation = doc.createElement('p');
      explanation.textContent = 'This reviews the last text pasted into this editor. ChatGPT may convert it into a Pasted text attachment. This snapshot does not track attachment edits, removal, or sending.';
      panel.append(explanation);
      if (pasteReview.partial) {
        const reason = doc.createElement('p'); reason.textContent = 'Only the first 2,000,000 characters were scanned.'; panel.append(reason);
      }
      const dismiss = doc.createElement('button'); dismiss.type = 'button';
      dismiss.textContent = 'Dismiss paste review'; dismiss.dataset.promptprivacyDismiss = '';
      dismiss.onclick = () => { pasteReview = null; render(); };
      panel.append(dismiss);
    }
    if (draftGroups !== null || pasteReview) {
      const note = doc.createElement('p');
      note.textContent = 'Advisory only. ChatGPT can access text already typed or pasted here. PromptPrivacy cannot verify when the site transmits it. You control editing and sending.';
      panel.append(note);
    }
  }
  function clear() { draftGroups = null; render(); }
  function queue() {
    const text = read();
    if (text === lastText) return;
    lastText = text;
    clearTimeout(timer); clear(); // Old findings must never describe a changed draft.
    if (!text.trim()) return;
    timer = setTimeout(() => {
      if (!editor?.isConnected || read() !== text) return;
      draftGroups = summarize(detect(text, keywords)); render();
    }, 300);
  }
  function reconcile() {
    const candidates = [...doc.querySelectorAll(SELECTOR)].filter(x => x.getClientRects().length && !x.disabled && x.getAttribute('aria-hidden') !== 'true');
    const active = candidates.find(x => x === doc.activeElement || x.contains(doc.activeElement)) || candidates.at(-1) || null;
    if (active !== editor) {
      editor?.removeEventListener('input', queue);
      clearTimeout(timer); host?.remove(); editor = active; lastText = null; draftGroups = null; panel = null;
      if (!editor) return;
      host = doc.createElement('div'); host.dataset.promptprivacy = 'advisory';
      const shadow = host.attachShadow({ mode: 'closed' });
      const style = doc.createElement('style');
      style.textContent = ':host{display:block;margin:8px 0;font:12px/1.5 system-ui;color:light-dark(#223548,#e4edf6);color-scheme:light dark}section:not(:empty){border:1px solid #889bae;border-radius:10px;padding:10px 12px;background:light-dark(#f2f7fa,#17232d)}strong{font-size:12px}p{margin:5px 0 0;max-width:680px}';
      panel = doc.createElement('section'); panel.setAttribute('role', 'status'); panel.setAttribute('aria-live', 'polite'); panel.setAttribute('aria-atomic', 'true');
      shadow.append(style, panel);
      const controlsStyle = doc.createElement('style');
      controlsStyle.textContent = 'strong{display:block;margin:4px 0}button{font:inherit;margin-top:8px;padding:5px 9px;border:1px solid #889bae;border-radius:6px;background:transparent;color:inherit;cursor:pointer}button:focus-visible{outline:2px solid #c1a15e;outline-offset:2px}';
      shadow.append(controlsStyle);
      (editor.closest('form') || editor.parentElement).after(host);
      editor.addEventListener('input', queue);
    }
    if (editor) queue();
  }
  const observer = new MutationObserver(reconcile);
  observer.observe(doc.documentElement, { childList: true, subtree: true, characterData: true, attributes: true, attributeFilter: ['contenteditable', 'id', 'data-testid', 'data-composer-markdown', 'role', 'hidden', 'aria-hidden'] });
  doc.addEventListener('focusin', reconcile);
  // Capture only user paste events directed at the supported active editor. Do not
  // poll the clipboard, read files, or prevent the site's normal paste handling.
  doc.addEventListener('paste', event => {
    reconcile();
    if (!editor || !(event.target === editor || editor.contains(event.target))) return;
    const text = event.clipboardData?.getData('text/plain');
    pasteReview = null;
    if (text?.trim()) {
      pasteReview = {
        groups: summarize(detect(text.slice(0, DEFAULT_LIMITS.maxTextChars), keywords)),
        partial: text.length > DEFAULT_LIMITS.maxTextChars
      };
    }
    // Retain only masked groups, never the clipboard text or matched values.
    render();
  }, true);
  chrome.runtime.onMessage.addListener((message, sender, respond) => {
    if (sender.id !== chrome.runtime.id || message?.type !== 'promptprivacy:status') return;
    reconcile();
    // Static connection status only: no draft, finding, URL, or DOM contents leave the tab.
    respond({ status: editor?.isConnected ? 'editor-found' : 'editor-not-found' });
  });
  storage.local.get({ keywords: [] }).then(value => { keywords = normalizeKeywords(value.keywords); lastText = null; reconcile(); });
  storage.onChanged.addListener((changes, area) => {
    if (area === 'local' && changes.keywords) { keywords = normalizeKeywords(changes.keywords.newValue); pasteReview = null; lastText = null; reconcile(); }
  });
  reconcile();
}
startAdapter();
