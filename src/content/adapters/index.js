import chatgpt from './chatgpt.js';
import claude from './claude.js';
import gemini from './gemini.js';
import { siteForOrigin } from '../../shared/sites.js';
const adapters = [chatgpt, claude, gemini];
export function adapterForOrigin(origin) {
  const site = siteForOrigin(origin);
  return site ? { ...adapters.find(adapter => adapter.id === site.id), ...site } : null;
}
function visibleEditor(element, doc) {
  if (!element.getClientRects().length || element.disabled || element.readOnly || element.getAttribute('aria-disabled') === 'true') return false;
  if (element.closest('[hidden], [inert], [aria-hidden="true"]')) return false;
  const style = doc.defaultView.getComputedStyle(element);
  return style.visibility !== 'hidden' && style.visibility !== 'collapse' && style.display !== 'none';
}
export function findEditor(doc, adapter) {
  // Ordered selector tiers prefer explicit composer markers over legacy fallbacks.
  for (const selector of adapter.selectors) {
    const candidates = [...doc.querySelectorAll(selector)].filter(element =>
      visibleEditor(element, doc) && !element.closest(adapter.excludeSelector));
    const focused = candidates.find(element => element === doc.activeElement || element.contains(doc.activeElement));
    if (focused) return focused;
    if (candidates.length === 1) return candidates[0];
    // Ambiguous editors are left unread until a supported candidate is focused.
    if (candidates.length > 1) return null;
  }
  return null;
}
export function composerForEditor(doc, editor, adapter) {
  if (!editor) return null;
  const explicit = editor.closest(adapter.composerSelector);
  let controlRoot = null;
  // Discover the smallest local composer containing both editor and send/stop
  // controls. Never choose body/main or a page-wide conversation container.
  for (let node = editor.parentElement, depth = 0; node && depth < 10; node = node.parentElement, depth++) {
    if (node === doc.body || node === doc.documentElement || node.matches('main, [role="main"]')) break;
    if (node.querySelector(`${adapter.sendSelector}, ${adapter.stopSelector}`)) { controlRoot = node; break; }
  }
  let root = explicit && (!controlRoot || explicit.contains(controlRoot)) ? explicit : controlRoot;
  if (!root) {
    // Markup without a form/control marker: prefer the enclosing visual card,
    // rather than placing the advisory in the editable/scrolling grid itself.
    for (let node = editor.parentElement, depth = 0; node && depth < 6; node = node.parentElement, depth++) {
      if (node === doc.body || node.matches('main, [role="main"]')) break;
      const style = doc.defaultView.getComputedStyle(node);
      if (parseFloat(style.borderRadius) >= 8) { root = node; break; }
    }
  }
  return root || (editor.parentElement === doc.body ? editor : editor.parentElement);
}
export function enabledSendButton(button, adapter) {
  return !!button && button.matches(adapter.sendSelector) && !button.matches(adapter.stopSelector) &&
    !button.disabled && button.getAttribute('aria-disabled') !== 'true' &&
    !button.closest('[hidden], [inert], [aria-hidden="true"]');
}
