// Pure detection: no DOM, storage, network, or Chrome APIs.
export const CATEGORY_NAMES = { email: 'Email', phone: 'Pakistani phone', cnic: 'CNIC-like number', apiKey: 'API key format', privateKey: 'Private key marker', keyword: 'Sensitive keyword' };
const word = /[\p{L}\p{N}_]/u;
function bounded(text, start, end) {
  return (!text[start - 1] || !word.test(text[start - 1])) && (!text[end] || !word.test(text[end]));
}
export function normalizeKeywords(input) {
  return [...new Set((Array.isArray(input) ? input : []).filter(x => typeof x === 'string').map(x => x.trim().toLowerCase()).filter(Boolean))].slice(0, 100).map(x => x.slice(0, 100));
}
export function mask(category, value) {
  if (category === 'apiKey' || category === 'privateKey') return '[credential hidden]';
  if (category === 'keyword') return '[keyword hidden]';
  if (category === 'email') return `${value[0]}***@***`;
  return `***${value.replace(/\D/g, '').slice(-2)}`;
}
export function detect(text, keywords = []) {
  const candidates = [];
  const add = (category, pattern, priority, accept = () => true) => {
    for (const m of text.matchAll(pattern)) {
      const start = m.index, end = start + m[0].length;
      if (bounded(text, start, end) && accept(m, start)) candidates.push({ category, start, end, priority, preview: mask(category, m[0]) });
    }
  };
  add('privateKey', /-----BEGIN (?:RSA |EC |DSA |OPENSSH |ENCRYPTED )?PRIVATE KEY-----/g, 0);
  add('apiKey', /(?:sk-proj-[A-Za-z0-9_-]{20,200}|sk-[A-Za-z0-9]{20,100}|ghp_[A-Za-z0-9]{36}|github_pat_[A-Za-z0-9_]{22,255}|AKIA[A-Z0-9]{16}|AIza[A-Za-z0-9_-]{35})/g, 1);
  add('email', /[A-Za-z0-9.!#$%&'*+/=?^_`{|}~-]+@[A-Za-z0-9](?:[A-Za-z0-9-]*[A-Za-z0-9])?(?:\.[A-Za-z0-9](?:[A-Za-z0-9-]*[A-Za-z0-9])?)+/g, 2);
  add('cnic', /[1-7]\d{4}-\d{7}-\d/g, 3);
  add('cnic', /[1-7]\d{12}/g, 3, (_m, start) => /(?:cnic|national\s+id)\s*[:#=-]?\s*$/i.test(text.slice(Math.max(0, start - 35), start)));
  add('phone', /(?:\+92[ -]?3\d{2}[ -]?\d{7}|0092[ -]?3\d{2}[ -]?\d{7}|03\d{2}[ -]?\d{7})/g, 4, (_m, start) => {
    // An explicitly labelled order/invoice reference is usually not a telephone.
    return !/(?:order|invoice|reference|tracking)\s*(?:number|no\.?)?\s*[:#=-]?\s*$/i.test(text.slice(Math.max(0, start - 40), start));
  });
  for (const keyword of normalizeKeywords(keywords)) {
    // Escape every metacharacter: preferences are literal text, never executable patterns.
    const escaped = keyword.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    for (const match of text.matchAll(new RegExp(escaped, 'giu'))) {
      candidates.push({ category: 'keyword', start: match.index, end: match.index + match[0].length, priority: 5, preview: mask('keyword', keyword) });
    }
  }
  // Higher-priority category wins overlap; within it, longest then earliest wins.
  candidates.sort((a, b) => a.priority - b.priority || (b.end - b.start) - (a.end - a.start) || a.start - b.start);
  const accepted = [];
  const occupied = new Uint8Array(text.length);
  for (const candidate of candidates) {
    let overlaps = false;
    for (let i = candidate.start; i < candidate.end; i++) if (occupied[i]) { overlaps = true; break; }
    if (!overlaps) { occupied.fill(1, candidate.start, candidate.end); accepted.push(candidate); }
  }
  return accepted.sort((a, b) => a.start - b.start).map(({ priority, ...finding }) => finding);
}
export function summarize(findings) {
  return Object.entries(CATEGORY_NAMES).map(([category, label]) => {
    const group = findings.filter(f => f.category === category);
    return { category, label, count: group.length, previews: [...new Set(group.map(f => f.preview))].slice(0, 3) };
  }).filter(x => x.count);
}
