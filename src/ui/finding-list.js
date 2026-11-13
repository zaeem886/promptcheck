import { formatLocation } from '../shared/locations.js';

// Both UIs receive masked records only. Render in batches so many findings do
// not create thousands of DOM nodes in one typing/paste event.
export function appendFindingList(parent, occurrences, label, batchSize = 20) {
  if (!occurrences?.length) return;
  const doc = parent.ownerDocument;
  const list = doc.createElement('ol'); list.className = 'occurrences';
  list.setAttribute('aria-label', `${label} occurrences`); parent.append(list);
  const more = doc.createElement('button'); more.type = 'button'; more.className = 'more-findings';
  let shown = 0;
  function appendBatch() {
    const end = Math.min(shown + batchSize, occurrences.length);
    for (; shown < end; shown++) {
      const occurrence = occurrences[shown];
      const row = doc.createElement('li'); row.className = 'occurrence';
      const preview = doc.createElement('span'); preview.className = 'occurrence-preview'; preview.textContent = occurrence.preview;
      const location = doc.createElement('span'); location.className = 'occurrence-location'; location.textContent = formatLocation(occurrence.location);
      row.append(preview, location); list.append(row);
    }
    const remaining = occurrences.length - shown;
    more.textContent = `Show ${Math.min(batchSize, remaining)} more ${label} findings (${remaining} remaining)`;
    more.hidden = remaining === 0;
  }
  more.onclick = appendBatch; parent.append(more); appendBatch();
}
