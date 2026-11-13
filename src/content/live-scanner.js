import { detect, normalizeKeywords, summarize } from '../shared/detector.js';
import { DEFAULT_LIMITS } from '../shared/scan.js';
import { findEditor, composerForEditor, enabledSendButton } from './adapters/index.js';
import advisoryStyles from './advisory.css';
import { appendFindingList } from '../ui/finding-list.js';

export function startLiveScanner(adapter, doc = document, storage = chrome.storage) {
  let editor = null, composer = null, host = null, panel = null, timer;
  let keywords = [], lastText = null, draftGroups = null, pasteReview = null;
  let suppressedDraft = null, expanded = false, pendingEnter = null, enterTimer;
  const textOf = element => element ? ('value' in element ? element.value : element.innerText) || '' : '';
  const read = () => textOf(editor);

  function addText(parent, tag, text, className) {
    const element = doc.createElement(tag); element.textContent = text;
    if (className) element.className = className;
    parent.append(element); return element;
  }
  function render() {
    if (!panel) return;
    panel.replaceChildren();
    host.hidden = draftGroups === null && !pasteReview;
    if (host.hidden) return;
    const scopes = [];
    if (draftGroups !== null) scopes.push({ label: 'Current draft', groups: draftGroups, partial: false });
    if (pasteReview) scopes.push({ label: 'Pasted text snapshot', ...pasteReview });
    const hasFindings = scopes.some(scope => scope.groups.length);
    const partial = scopes.some(scope => scope.partial);
    const header = doc.createElement('header'); panel.append(header);
    addText(header, 'span', 'PromptPrivacy', 'brand');
    addText(header, 'span', partial ? 'Partially scanned' : hasFindings ? 'Possible sensitive information' : 'No supported patterns found', 'state');
    const dismiss = addText(header, 'button', '×', 'close'); dismiss.type = 'button';
    dismiss.dataset.promptprivacyDismiss = '';
    dismiss.setAttribute('aria-label', 'Dismiss warning');
    dismiss.title = 'Dismiss until the draft changes or you paste again';
    dismiss.onclick = clearAfterSendOrDismiss;
    for (const scope of scopes) {
      const row = doc.createElement('div'); row.className = 'scope'; panel.append(row);
      addText(row, 'span', scope.label === 'Current draft' ? 'Draft' : 'Last paste', 'scope-label');
      for (const group of scope.groups) addText(row, 'span', `${group.label} · ${group.count}`, 'tag');
      if (!scope.groups.length) addText(row, 'span', scope.partial ? 'Limited coverage' : 'No supported patterns found', 'tag');
    }
    const details = doc.createElement('details'); panel.append(details);
    details.open = expanded;
    details.ontoggle = () => { if (details.isConnected) expanded = details.open; };
    addText(details, 'summary', 'Masked details');
    for (const scope of scopes) {
      const block = doc.createElement('div'); block.className = 'detail-scope'; details.append(block);
      const status = scope.partial ? 'Partially scanned' : scope.groups.length ? (scope.label === 'Current draft' ? 'Possible sensitive information' : 'Findings detected') : 'No supported patterns found';
      addText(block, 'strong', `${scope.label} · ${status}`);
      for (const group of scope.groups) {
        addText(block, 'div', `${group.label}: ${group.count}`, 'finding');
        appendFindingList(block, group.occurrences, group.label);
      }
      if (scope.partial) addText(block, 'p', 'Only the first 2,000,000 characters were scanned.');
    }
    if (pasteReview) addText(details, 'p', 'Last-paste review only. Attachment edits/removal are not tracked. This review clears on an observed send action or when dismissed.');
    if (hasFindings) addText(details, 'p', 'Lines count actual line breaks, not screen wrapping. Top/Middle/Bottom are thirds of the scanned text. Paste locations refer to the last paste, not the current draft.');
    addText(panel, 'p', `Advisory only. ${adapter.label} can access your draft. PromptPrivacy cannot verify transmission timing.`, 'privacy');
  }

  function clearAfterSendOrDismiss() {
    clearTimeout(timer); clearTimeout(enterTimer); pendingEnter = null;
    pasteReview = null; draftGroups = null; expanded = false;
    // Do not immediately re-open for the same unchanged draft after dismissal
    // or while a site's send animation still leaves its text in the editor.
    suppressedDraft = read(); lastText = suppressedDraft; render();
  }
  function queue() {
    const text = read();
    if (text === lastText) return;
    lastText = text; clearTimeout(timer); draftGroups = null; render();
    if (text !== suppressedDraft) suppressedDraft = null;
    if (!text.trim() || text === suppressedDraft) return;
    timer = setTimeout(() => {
      if (!editor?.isConnected || read() !== text) return;
      draftGroups = summarize(detect(text, keywords)); render();
    }, 300);
  }
  function stopControlPresent(root) {
    return !!root && [...root.querySelectorAll(adapter.stopSelector)].some(button =>
      button.getClientRects().length && !button.closest('[hidden], [aria-hidden="true"]'));
  }
  function checkKeyboardSend(active, root) {
    if (!pendingEnter) return;
    const current = textOf(active);
    const clearedText = pendingEnter.text.trim() && !current.trim();
    const startedResponse = !pendingEnter.hadStop && stopControlPresent(root || composer);
    if (clearedText || startedResponse) { clearAfterSendOrDismiss(); return; }
    // Enter configured as a newline must not dismiss a review.
    if (current !== pendingEnter.text && current.trim()) { clearTimeout(enterTimer); pendingEnter = null; }
  }
  function onInput() { checkKeyboardSend(editor, composer); queue(); }
  function reconcile() {
    const active = findEditor(doc, adapter);
    const root = composerForEditor(doc, active, adapter);
    checkKeyboardSend(active, root);
    if (active !== editor || (active && !host?.isConnected)) {
      editor?.removeEventListener('input', onInput);
      clearTimeout(timer); host?.remove(); editor = active; composer = root;
      lastText = null; draftGroups = null; panel = null;
      if (!editor) return;
      host = doc.createElement('div'); host.dataset.promptprivacy = 'advisory'; host.hidden = true;
      const shadow = host.attachShadow({ mode: 'closed' });
      const style = doc.createElement('style'); style.textContent = advisoryStyles;
      panel = doc.createElement('section'); panel.setAttribute('role', 'status');
      panel.setAttribute('aria-live', 'polite'); panel.setAttribute('aria-atomic', 'true');
      shadow.append(style, panel); composer.after(host);
      editor.addEventListener('input', onInput);
    } else if (editor && (root !== composer || host.previousElementSibling !== root)) {
      composer = root; composer.after(host);
    }
    if (editor) queue();
  }
  const observer = new MutationObserver(reconcile);
  observer.observe(doc.documentElement, {
    childList: true, subtree: true, characterData: true, attributes: true,
    attributeFilter: ['contenteditable', 'id', 'class', 'style', 'data-testid', 'data-composer-markdown', 'role', 'hidden', 'inert', 'aria-hidden', 'aria-disabled', 'aria-busy', 'aria-label', 'disabled', 'readonly']
  });
  doc.addEventListener('focusin', reconcile);
  doc.addEventListener('paste', event => {
    reconcile();
    if (!editor || !(event.target === editor || editor.contains(event.target))) return;
    const text = event.clipboardData?.getData('text/plain');
    pasteReview = null; suppressedDraft = null; pendingEnter = null; clearTimeout(enterTimer);
    if (text?.trim()) pasteReview = {
      groups: summarize(detect(text.slice(0, DEFAULT_LIMITS.maxTextChars), keywords)),
      partial: text.length > DEFAULT_LIMITS.maxTextChars
    };
    // Raw clipboard text is not retained after the event handler.
    lastText = null; queue(); render();
  }, { capture: true, passive: true });

  // Observe send actions only. No default actions or propagation are cancelled.
  doc.addEventListener('click', event => {
    const button = event.target?.closest?.(adapter.sendSelector);
    if (composer?.contains(button) && enabledSendButton(button, adapter)) clearAfterSendOrDismiss();
  }, { capture: true, passive: true });
  doc.addEventListener('submit', event => {
    if (editor && event.target?.matches?.('form') && event.target.contains(editor)) clearAfterSendOrDismiss();
  }, { capture: true, passive: true });
  doc.addEventListener('keydown', event => {
    if (event.key !== 'Enter' || event.shiftKey || event.altKey || event.isComposing || event.keyCode === 229 || event.repeat) return;
    if (!editor || !(event.target === editor || editor.contains(event.target))) return;
    pendingEnter = { text: read(), hadStop: stopControlPresent(composer) };
    clearTimeout(enterTimer);
    enterTimer = setTimeout(() => { pendingEnter = null; }, 2000);
    // Confirm via a cleared draft, form submit, or new Stop control, rather than
    // assuming every Enter key means Send (some users configure Enter=newline).
    setTimeout(reconcile, 0);
  }, { capture: true, passive: true });
  chrome.runtime.onMessage.addListener((message, sender, respond) => {
    if (sender.id !== chrome.runtime.id || message?.type !== 'promptprivacy:status') return;
    reconcile(); respond({ status: editor?.isConnected ? 'editor-found' : 'editor-not-found', site: adapter.id });
  });
  storage.local.get({ keywords: [] }).then(value => { keywords = normalizeKeywords(value.keywords); lastText = null; reconcile(); });
  storage.onChanged.addListener((changes, area) => {
    if (area === 'local' && changes.keywords) {
      keywords = normalizeKeywords(changes.keywords.newValue); pasteReview = null; suppressedDraft = null; lastText = null; reconcile();
    }
  });
  reconcile();
}
