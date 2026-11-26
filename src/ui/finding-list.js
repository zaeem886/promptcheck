import { formatLocation } from '../shared/locations.js';

const sourceLabels = { rules: 'Rules', ml: 'ML', both: 'Rules + ML' };
// Recover exact values from the same source the detector scanned. Render in
// batches so many findings do not create thousands of nodes at once.
export function appendFindingList(parent, occurrences, label, { text, onLocate, batchSize = 20, initialCount = batchSize, onReveal } = {}) {
  if (!occurrences?.length) return;
  const doc = parent.ownerDocument;
  const list = doc.createElement('ol'); list.className = 'occurrences';
  list.setAttribute('aria-label', `${label} occurrences`); parent.append(list);
  const more = doc.createElement('button'); more.type = 'button'; more.className = 'more-findings';
  let shown = 0;
  function appendBatch(count) {
    const end = Math.min(shown + count, occurrences.length);
    for (; shown < end; shown++) {
      const occurrence = occurrences[shown];
      const row = doc.createElement('li'); row.className = 'occurrence';
      const preview = doc.createElement(onLocate ? 'button' : 'span');
      preview.className = 'occurrence-preview'; preview.textContent = text?.slice(occurrence.start, occurrence.end) ?? occurrence.preview;
      const metadata = doc.createElement('div'); metadata.className = 'occurrence-meta';
      const location = doc.createElement('span'); location.className = 'occurrence-location'; location.textContent = formatLocation(occurrence.location);
      if (onLocate) {
        preview.type = 'button';
        preview.title = `Show in source text · ${location.textContent}`;
        preview.onclick = () => onLocate(occurrence);
      }
      const source = doc.createElement('span'); source.className = 'occurrence-source'; source.textContent = sourceLabels[occurrence.source];
      metadata.append(location, source);
      row.append(preview, metadata); list.append(row);
    }
    const remaining = occurrences.length - shown;
    more.textContent = `Show ${Math.min(batchSize, remaining)} more ${label} findings (${remaining} remaining)`;
    more.hidden = remaining === 0;
    onReveal?.(shown);
  }
  more.onclick = () => appendBatch(batchSize);
  parent.append(more);
  appendBatch(Math.max(initialCount, batchSize));
}
