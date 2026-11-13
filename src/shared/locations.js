// Lines/columns are one-based UTF-16 positions, matching JS string offsets.
// Screen wrapping does not add lines. Regions are thirds of scanned text length.
export function locateFindings(text, findings) {
  if (!findings.length) return [];
  const starts = [0];
  for (const match of text.matchAll(/\r\n|[\n\r\u2028\u2029]/g)) starts.push(match.index + match[0].length);
  function position(offset) {
    let low = 0, high = starts.length;
    while (low + 1 < high) {
      const middle = Math.floor((low + high) / 2);
      if (starts[middle] <= offset) low = middle; else high = middle;
    }
    return { line: low + 1, column: offset - starts[low] + 1 };
  }
  return findings.map(finding => {
    const first = position(finding.start), last = position(Math.max(finding.start, finding.end - 1));
    return { ...finding, location: {
      line: first.line, column: first.column, endLine: last.line, endColumn: last.column,
      section: ['Top', 'Middle', 'Bottom'][Math.min(2, Math.floor(finding.start * 3 / Math.max(1, text.length)))]
    } };
  });
}
export function formatLocation(location) {
  if (!location) return 'Location unavailable';
  const pages = location.page ? (location.endPage && location.endPage !== location.page ? `Pages ${location.page}–${location.endPage} · ` : `Page ${location.page} · `) : '';
  const lines = location.line === location.endLine ? `Line ${location.line}` : `Lines ${location.line}–${location.endLine}`;
  return `${pages}${lines}, column ${location.column} · ${location.section}`;
}
