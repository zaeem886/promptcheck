// Pure detection: no DOM, storage, network, or Chrome APIs.
import { locateFindings } from './locations.js';
import { collectSensitivePatterns, normalizeSensitiveText, phoneContext } from './sensitive-patterns.js';
export const CATEGORY_NAMES = {
  email: 'Email', phone: 'Phone number', cnic: 'CNIC-like number',
  apiKey: 'API key format', privateKey: 'Private key marker', sshKey: 'SSH key material', password: 'Password or passphrase',
  sessionToken: 'Authentication or session token', paymentCard: 'Payment card',
  iban: 'IBAN', bankAccount: 'Bank account or routing details', pin: 'PIN, security or recovery code',
  nationalId: 'National or tax ID', passport: 'Passport', driverLicense: 'Driving licence',
  person: 'Personal name', address: 'Postal address', dateOfBirth: 'Date of birth',
  medical: 'Medical or insurance details', location: 'Location or IP address',
  cryptoWallet: 'Cryptocurrency wallet', keyword: 'Sensitive keyword'
};
const wordBefore = /[\p{L}\p{N}_]$/u;
const wordAfter = /^[\p{L}\p{N}_]/u;
function bounded(text, start, end) {
  return !wordBefore.test(text.slice(Math.max(0, start - 2), start)) && !wordAfter.test(text.slice(end, end + 2));
}
export function normalizeKeywords(input) {
  return [...new Set((Array.isArray(input) ? input : []).filter(x => typeof x === 'string').map(x => x.trim().toLowerCase()).filter(Boolean))].slice(0, 100).map(x => x.slice(0, 100));
}
export function mask(category, value) {
  if (['apiKey', 'privateKey', 'sshKey', 'password', 'sessionToken', 'pin'].includes(category)) return '[credential hidden]';
  if (category === 'keyword') return '[keyword hidden]';
  if (category === 'email') return `${value[0]}***@***`;
  if (['phone', 'cnic', 'paymentCard', 'iban', 'bankAccount', 'nationalId', 'passport', 'driverLicense'].includes(category)) {
    return '***' + normalizeSensitiveText(value).replace(/[^\p{L}\d]/gu, '').slice(-2);
  }
  return '[value hidden]';
}
export function detect(text, keywords = []) {
  const candidates = [];
  const original = text;
  text = normalizeSensitiveText(text);
  const emit = (category, start, end, priority, requireBoundary = true) => {
    if (!requireBoundary || bounded(text, start, end)) {
      candidates.push({ category, start, end, priority, preview: mask(category, original.slice(start, end)) });
    }
  };
  const add = (category, pattern, priority, accept = () => true) => {
    for (const m of text.matchAll(pattern)) {
      const start = m.index, end = start + m[0].length;
      if (accept(m, start)) emit(category, start, end, priority);
    }
  };
  add('privateKey', /-----BEGIN (?:RSA |EC |DSA |OPENSSH |ENCRYPTED )?PRIVATE KEY-----/g, 0);
  add('apiKey', /(?:sk-proj-[A-Za-z0-9_-]{20,200}|sk-[A-Za-z0-9]{20,100}|ghp_[A-Za-z0-9]{36}|github_pat_[A-Za-z0-9_]{22,255}|AKIA[A-Z0-9]{16}|AIza[A-Za-z0-9_-]{35})/g, 1);
  add('cnic', /[1-7]\d{4}-\d{7}-\d/g, 3);
  add('cnic', /[1-7]\d{12}/g, 3, (_m, start) => /(?:cnic|national\s+id)\s*[:#=-]?\s*$/i.test(text.slice(Math.max(0, start - 35), start)));
  add('phone', /(?:\+92[ -]?3\d{2}[ -]?\d{7}|0092[ -]?3\d{2}[ -]?\d{7}|03\d{2}[ -]?\d{7})/g, 4, (_m, start) => {
    // An explicitly labelled order/invoice reference is usually not a telephone.
    return phoneContext(text, start);
  });
  collectSensitivePatterns(text, add, emit);
  for (const keyword of normalizeKeywords(keywords)) {
    // Escape every metacharacter: preferences are literal text, never executable patterns.
    const escaped = keyword.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    for (const match of original.matchAll(new RegExp(escaped, 'giu'))) {
      candidates.push({ category: 'keyword', start: match.index, end: match.index + match[0].length, priority: 10, preview: mask('keyword', keyword) });
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
  return locateFindings(original, accepted.sort((a, b) => a.start - b.start).map(({ priority, ...finding }) => finding));
}
export function summarize(findings) {
  return Object.entries(CATEGORY_NAMES).map(([category, label]) => {
    const group = findings.filter(f => f.category === category);
    return {
      category, label, count: group.length, previews: [...new Set(group.map(f => f.preview))].slice(0, 3),
      // Keep original offsets even when repeated values have the same preview.
      occurrences: group.map(({ start, end, preview, location, source = 'rules' }) => ({ start, end, preview, location, source }))
    };
  }).filter(x => x.count);
}
