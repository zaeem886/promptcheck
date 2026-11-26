import { detect, normalizeKeywords, summarize } from '../shared/detector.js';
import { DEFAULT_LIMITS } from '../shared/limits.js';
import { mergeFindings } from '../shared/hybrid.js';
import { formatLocation } from '../shared/locations.js';
import { requestModel } from '../ml/client.js';
import { findEditor, composerForEditor, enabledSendButton } from './adapters/index.js';
import advisoryStyles from './advisory.css';
import { appendFindingList } from '../ui/finding-list.js';

const outsideChat = 'aside, nav, [role="complementary"], [role="navigation"], [role="dialog"], pre, textarea, [contenteditable="true"]';
const remainingScroll = element => element.scrollHeight - element.clientHeight - element.scrollTop;

export function startLiveScanner(adapter, doc = document, storage = chrome.storage) {
  let editor = null, composer = null, host = null, panel = null, timer;
  let keywords = [], lastText = null, draftReview = null, pasteReview = null;
  let suppressedDraft = null, detailsView = null, expanded = false, pendingEnter = null, enterTimer;
  let located = null;
  const chatPositions = new WeakMap();
  const win = doc.defaultView;
  const textOf = element => element ? ('value' in element ? element.value : element.innerText) || '' : '';
  const read = () => textOf(editor);

  function addText(parent, tag, text, className) {
    const element = doc.createElement(tag); element.textContent = text;
    if (className) element.className = className;
    parent.append(element); return element;
  }
  function renderSource() {
    const { source, viewport } = detailsView;
    source.replaceChildren();
    source.hidden = !located;
    if (!located) return;
    const { review, occurrence } = located;
    const { text } = review;
    const { start, end, location } = occurrence;
    const heading = addText(source, 'div', '', 'source-heading');
    const label = review === pasteReview ? 'Pasted text' : 'Draft text';
    const caption = `${label} · ${formatLocation(location)}`;
    addText(heading, 'span', caption);
    source.setAttribute('aria-label', caption);
    const close = addText(heading, 'button', '×', 'close');
    close.type = 'button';
    close.setAttribute('aria-label', 'Close source excerpt');
    close.onclick = () => { located = null; renderSource(); viewport.focus({ preventScroll: true }); };

    // Context stays bounded for long pastes. Keep the entire matched span and
    // its original whitespace, using offsets to distinguish repeats.
    const before = Math.max(0, start - 180), after = Math.min(text.length, end + 180);
    const excerpt = addText(source, 'pre', '', 'source-excerpt');
    excerpt.tabIndex = 0;
    excerpt.append((before ? '…' : '') + text.slice(before, start));
    const match = addText(excerpt, 'mark', text.slice(start, end));
    excerpt.append(text.slice(end, after) + (after < text.length ? '…' : ''));
    const bounds = excerpt.getBoundingClientRect();
    excerpt.scrollTop += match.getBoundingClientRect().top - bounds.top - bounds.height / 3;
  }
  function render() {
    if (located && located.review !== draftReview && located.review !== pasteReview) located = null;
    if (!panel) return;
    const previous = detailsView;
    const sameDraft = draftReview && previous?.draft === draftReview;
    const samePaste = pasteReview && previous?.paste === pasteReview;
    const retainPosition = sameDraft || samePaste;
    const previousTop = retainPosition ? previous.viewport.scrollTop : 0;
    const atEnd = previousTop > 0 && remainingScroll(previous.viewport) <= 1;
    const focus = retainPosition ? panel.getRootNode().activeElement : null;
    // The draft section can arrive or disappear above a paste the user is reading.
    const pasteTop = samePaste && (!previous.draft || previousTop >= previous.pasteBlock.offsetTop)
      ? previous.pasteBlock.offsetTop : null;
    if (previous) expanded = previous.details.open;
    panel.replaceChildren();
    detailsView = null;
    host.hidden = !draftReview && !pasteReview;
    if (host.hidden) return;
    const scopes = [];
    if (draftReview) scopes.push({ label: 'Current draft', review: draftReview });
    if (pasteReview) scopes.push({ label: 'Pasted text snapshot', review: pasteReview });
    const hasFindings = scopes.some(({ review }) => review.groups.length);
    const partial = scopes.some(({ review }) => review.partial || review.modelStatus === 'unavailable');
    const checking = scopes.some(({ review }) => review.modelStatus === 'checking');
    const header = doc.createElement('header'); panel.append(header);
    addText(header, 'span', 'PromptPrivacy', 'brand');
    const state = addText(header, 'span', partial ? 'Partially scanned' : hasFindings ? 'Possible sensitive information'
      : checking ? 'Checking with ML…' : 'No supported patterns found', 'state');
    state.setAttribute('role', 'status');
    const dismiss = addText(header, 'button', '×', 'close'); dismiss.type = 'button';
    dismiss.dataset.promptprivacyDismiss = '';
    dismiss.setAttribute('aria-label', 'Dismiss warning');
    dismiss.title = 'Dismiss until the draft changes or you paste again';
    dismiss.onclick = clearAfterSendOrDismiss;
    for (const { label, review } of scopes) {
      const row = doc.createElement('div'); row.className = 'scope'; panel.append(row);
      addText(row, 'span', label === 'Current draft' ? 'Draft' : 'Last paste', 'scope-label');
      for (const group of review.groups) addText(row, 'span', `${group.label} · ${group.count}`, 'tag');
      if (review.modelStatus === 'checking' && (hasFindings || partial)) addText(row, 'span', 'Checking with ML…', 'tag');
      if (!review.groups.length && review.modelStatus !== 'checking') {
        addText(row, 'span', review.partial || review.modelStatus === 'unavailable' ? 'Limited coverage' : 'No supported patterns found', 'tag');
      }
    }
    const details = doc.createElement('details');
    details.open = expanded;
    const summary = addText(details, 'summary', 'Finding details');
    const source = addText(details, 'div', '', 'source-view');
    source.hidden = true;
    source.tabIndex = -1;
    source.setAttribute('role', 'region');
    const viewport = addText(details, 'div', '', 'findings-scroll');
    viewport.tabIndex = 0;
    viewport.setAttribute('role', 'region');
    viewport.setAttribute('aria-label', 'Findings');
    viewport.onkeydown = event => {
      if (event.target !== viewport || event.altKey || event.ctrlKey || event.metaKey || event.shiftKey) return;
      if (event.key !== 'Home' && event.key !== 'End') return;
      event.preventDefault();
      viewport.scrollTop = event.key === 'Home' ? 0 : viewport.scrollHeight;
    };
    detailsView = { details, summary, viewport, source, draft: draftReview, paste: pasteReview };
    details.ontoggle = () => {
      if (detailsView?.details !== details || details.open === expanded) return;
      if (!details.open) located = null;
      render();
    };
    for (const { label, review } of scopes) {
      const block = doc.createElement('div'); block.className = 'detail-scope'; viewport.append(block);
      if (review === pasteReview) detailsView.pasteBlock = block;
      const status = review.partial || review.modelStatus === 'unavailable' ? 'Partially scanned'
        : review.groups.length ? (review === draftReview ? 'Possible sensitive information' : 'Findings detected')
        : review.modelStatus === 'checking' ? 'Checking with ML…' : 'No supported patterns found';
      addText(block, 'strong', `${label} · ${status}`);
      for (const group of review.groups) {
        addText(block, 'div', `${group.label}: ${group.count}`, 'finding');
        appendFindingList(block, group.occurrences, group.label, {
          text: expanded ? review.text : undefined,
          onLocate: expanded ? occurrence => {
            located = { review, occurrence };
            renderSource();
            source.focus({ preventScroll: true });
            source.scrollIntoView({ block: 'nearest' });
          } : undefined,
          initialCount: review.revealed.get(group.category),
          onReveal: count => review.revealed.set(group.category, count)
        });
      }
      if (review.partial) addText(block, 'p', 'Only the first 2,000,000 characters were scanned.');
      if (review.modelStatus === 'unavailable') addText(block, 'p', 'The ML check could not finish. Rule results are shown.');
    }
    if (pasteReview) addText(viewport, 'p', 'Last-paste review only. Attachment edits/removal are not tracked. This review clears on an observed send action or when dismissed.');
    if (hasFindings) addText(viewport, 'p', 'Lines count actual line breaks, not screen wrapping. Top/Middle/Bottom are thirds of the scanned text. Paste locations refer to the last paste, not the current draft.');
    panel.append(details);
    if (expanded) renderSource();
    addText(panel, 'p', `Advisory only. ${adapter.label} can access your draft. PromptPrivacy cannot verify transmission timing.`, 'privacy');
    if (retainPosition) {
      const change = pasteTop === null ? 0 : detailsView.pasteBlock.offsetTop - pasteTop;
      viewport.scrollTop = atEnd ? viewport.scrollHeight : previousTop + change;
    }
    if (focus && previous.viewport.contains(focus)) viewport.focus({ preventScroll: true });
    if (focus && previous.source.contains(focus) && !source.hidden) source.focus({ preventScroll: true });
    if (focus && focus === previous.summary) summary.focus({ preventScroll: true });
  }

  function isChatScroller(element) {
    if (!element || element.nodeType !== 1 || host.contains(element) || composer.contains(element) || element.closest(outsideChat)) return false;
    if (element === doc.scrollingElement || element.contains(host)) return true;
    const chat = composer.closest('main, [role="main"]');
    return !!chat?.contains(element);
  }

  // Capture element scrolls as well as viewport scrolls. The chat history can
  // scroll in a separate pane alongside the composer dock.
  doc.addEventListener('scroll', event => {
    if (!detailsView) return;
    const scroller = event.target === doc ? doc.scrollingElement : event.target;
    if (!isChatScroller(scroller)) return;
    const before = chatPositions.get(scroller) ?? 0;
    const top = scroller.scrollTop;
    chatPositions.set(scroller, top);
    if (detailsView.details.open && top > before && remainingScroll(scroller) <= 1) {
      detailsView.viewport.scrollTop = detailsView.viewport.scrollHeight;
    }
  }, { capture: true, passive: true });

  // A downward wheel at the end of chat may not move the outer scrollbar.
  // Let it reach the end of the open findings without cancelling site events.
  doc.addEventListener('wheel', event => {
    if (!detailsView?.details.open || remainingScroll(detailsView.viewport) <= 1 ||
        event.ctrlKey || event.shiftKey || event.deltaY <= Math.abs(event.deltaX)) return;
    const target = event.target;
    if (target?.nodeType !== 1 || host.contains(target) || composer.contains(target) || target.closest(outsideChat)) return;
    let scroller = doc.scrollingElement;
    for (let node = target; node && node !== doc.scrollingElement; node = node.parentElement) {
      if (node.scrollHeight > node.clientHeight + 1 && /^(auto|scroll|overlay)$/.test(win.getComputedStyle(node).overflowY)) {
        scroller = node;
        break;
      }
    }
    if (isChatScroller(scroller) && remainingScroll(scroller) <= 1) {
      detailsView.viewport.scrollTop = detailsView.viewport.scrollHeight;
    }
  }, { capture: true, passive: true });

  function reviewText(text) {
    const partial = text.length > DEFAULT_LIMITS.maxTextChars;
    const scannedText = text.slice(0, DEFAULT_LIMITS.maxTextChars);
    const rules = detect(scannedText, keywords);
    const controller = new AbortController();
    const review = { text: scannedText, groups: summarize(rules), partial, modelStatus: 'checking', controller, revealed: new Map() };
    const timeout = setTimeout(() => controller.abort(), 5000);
    requestModel(scannedText, controller.signal).then(findings => {
      clearTimeout(timeout);
      if (review !== draftReview && review !== pasteReview) return;
      if (review === draftReview && (!editor?.isConnected || read() !== lastText)) { reconcile(); return; }
      review.modelStatus = findings ? 'complete' : 'unavailable';
      if (findings?.length) review.groups = summarize(mergeFindings(rules, findings));
      render();
    });
    return review;
  }

  function clearAfterSendOrDismiss() {
    clearTimeout(timer); clearTimeout(enterTimer); pendingEnter = null;
    pasteReview?.controller.abort(); draftReview?.controller.abort();
    pasteReview = null; draftReview = null; detailsView = null; expanded = false;
    // Do not immediately re-open for the same unchanged draft after dismissal
    // or while a site's send animation still leaves its text in the editor.
    suppressedDraft = read(); lastText = suppressedDraft; render();
  }
  function queue() {
    const text = read();
    if (text === lastText) return;
    lastText = text; clearTimeout(timer);
    draftReview?.controller.abort(); draftReview = null; render();
    if (text !== suppressedDraft) suppressedDraft = null;
    if (!text.trim() || text === suppressedDraft) return;
    timer = setTimeout(() => {
      if (!editor?.isConnected || read() !== text) return;
      draftReview = reviewText(text); render();
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
    const active = findEditor(doc, adapter, doc.activeElement === host ? editor : doc.activeElement);
    const root = composerForEditor(doc, active, adapter);
    checkKeyboardSend(active, root);
    if (active !== editor || (active && !host?.isConnected)) {
      editor?.removeEventListener('input', onInput);
      if (detailsView) expanded = detailsView.details.open;
      clearTimeout(timer); host?.remove(); editor = active; composer = root;
      draftReview?.controller.abort();
      lastText = null; draftReview = null; panel = null; detailsView = null;
      if (!editor) { render(); return; }
      host = doc.createElement('div'); host.dataset.promptprivacy = 'advisory'; host.hidden = true;
      const shadow = host.attachShadow({ mode: 'closed' });
      const style = doc.createElement('style'); style.textContent = advisoryStyles;
      panel = doc.createElement('section'); panel.setAttribute('aria-label', 'PromptPrivacy');
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
    pasteReview?.controller.abort();
    pasteReview = text?.trim() ? reviewText(text) : null;
    suppressedDraft = null; pendingEnter = null; clearTimeout(enterTimer);
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
      keywords = normalizeKeywords(changes.keywords.newValue);
      pasteReview?.controller.abort(); pasteReview = null; suppressedDraft = null; lastText = null; reconcile();
    }
  });
  doc.defaultView.addEventListener('pagehide', clearAfterSendOrDismiss);
  doc.defaultView.addEventListener('pageshow', event => {
    if (event.persisted) { suppressedDraft = null; lastText = null; reconcile(); }
  });
  reconcile();
}
