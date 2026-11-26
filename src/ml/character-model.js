// The input and output layouts match the Kaggle export. The returned offsets
// are UTF-16 so they can use the rule detector's exact positions and masks.
export function createCharacterModel(config, runWindow) {
  const { core, halo, tags, min_span_score: cutoff } = config;
  const groups = config.shape_groups.slice(0, -1).map(name => new RegExp('\\p{' + name + '}', 'u'));
  const bucketSize = config.buckets / config.shape_groups.length;

  return async function predict(text, signal) {
    const ids = new Int32Array(text.length);
    const offsets = new Uint32Array(text.length + 1);
    let length = 0;
    let offset = 0;
    for (const character of text) {
      const point = character.codePointAt(0);
      offsets[length] = offset;
      if (point < 128) {
        ids[length] = point + 1;
      } else {
        const group = groups.findIndex(pattern => pattern.test(character));
        ids[length] = 129 + (group === -1 ? groups.length : group) * bucketSize + point % bucketSize;
      }
      length++;
      offset += character.length;
    }
    offsets[length] = offset;

    const spans = [];
    let label = null;
    let begin = 0;
    let confidence = 0;
    for (let start = 0; start < length; start += core) {
      signal.throwIfAborted();
      const end = Math.min(length, start + core);
      const left = Math.max(0, start - halo);
      const right = Math.min(length, end + halo);
      const logits = await runWindow(ids.subarray(left, right), signal);
      for (let index = start; index < end; index++) {
        const base = (index - left) * tags.length;
        let best = 0;
        for (let tag = 1; tag < tags.length; tag++) {
          if (logits[base + tag] > logits[base + best]) best = tag;
        }
        if (label === null || tags[best] !== 'I-' + label) {
          if (label !== null && confidence / (index - begin) >= cutoff) {
            spans.push({ label, start: offsets[begin], end: offsets[index] });
          }
          label = best === 0 ? null : tags[best].slice(2);
          begin = index;
          confidence = 0;
        }
        if (label !== null) {
          let sum = 0;
          for (let tag = 0; tag < tags.length; tag++) sum += Math.exp(logits[base + tag] - logits[base + best]);
          confidence += 1 / sum;
        }
      }
      // Let the worker receive cancellations and work from other tabs.
      if (start % (8 * core) === 7 * core) await new Promise(resolve => setTimeout(resolve, 0));
    }
    signal.throwIfAborted();
    if (label !== null && confidence / (length - begin) >= cutoff) {
      spans.push({ label, start: offsets[begin], end: offsets[length] });
    }
    return spans;
  };
}
