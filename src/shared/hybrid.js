import { locateFindings } from './locations.js';

export const MODEL_CATEGORIES = Object.freeze({
  PERSON: 'person',
  ADDRESS: 'address',
  PHONE: 'phone',
  EMAIL: 'email',
  NATIONAL_ID: 'nationalId',
  PASSPORT: 'passport',
  BANK_ACCOUNT: 'bankAccount',
  IBAN: 'iban',
  PAYMENT_CARD: 'paymentCard',
  API_KEY: 'apiKey',
  PASSWORD: 'password',
  PIN: 'pin'
});

export function maskModelFindings(text, spans) {
  return locateFindings(text, spans.map(({ label, start, end }) => ({
    category: MODEL_CATEGORIES[label],
    start,
    end,
    preview: '[value hidden]',
    source: 'ml'
  })));
}

// Both inputs are already sorted and nonoverlapping. A rule finding keeps its
// category, bounds and preview. Only an exact agreement gets credit from both.
export function mergeFindings(rules, model) {
  const findings = [];
  let nextRule = 0;
  for (const predicted of model) {
    while (nextRule < rules.length && rules[nextRule].end <= predicted.start) {
      findings.push(rules[nextRule++]);
    }
    const rule = rules[nextRule];
    if (!rule || rule.start >= predicted.end) {
      findings.push(predicted);
    } else if (rule.start === predicted.start && rule.end === predicted.end &&
      (rule.category === predicted.category || (rule.category === 'cnic' && predicted.category === 'nationalId'))) {
      findings.push({ ...rule, source: 'both' });
      nextRule++;
    }
  }
  while (nextRule < rules.length) findings.push(rules[nextRule++]);
  return findings;
}
