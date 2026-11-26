import * as ort from '../vendor/onnxruntime/ort.wasm.min.mjs';
import { createCharacterModel } from './character-model.js';
import { maskModelFindings } from '../shared/hybrid.js';

ort.env.wasm.numThreads = 1;
ort.env.wasm.proxy = false;
ort.env.wasm.wasmPaths = new URL('../vendor/onnxruntime/', import.meta.url).href;
ort.env.logLevel = 'fatal';

let model;
const jobs = new Map();
async function loadModel() {
  const config = await fetch(new URL('model.json', import.meta.url)).then(response => response.json());
  const session = await ort.InferenceSession.create(new URL('model.onnx', import.meta.url).href, {
    executionProviders: ['wasm'], logSeverityLevel: 4
  });
  let inference = Promise.resolve();
  return createCharacterModel(config, (ids, signal) => {
    const window = inference.then(async () => {
      signal.throwIfAborted();
      const input = new ort.Tensor('int32', ids, [1, ids.length]);
      let logits;
      try {
        ({ logits } = await session.run({ ids: input }));
        return logits.data.slice();
      } finally {
        logits?.dispose();
        input.dispose();
      }
    });
    inference = window.then(() => undefined, () => undefined);
    return window;
  });
}

self.onmessage = async ({ data: { id, text } }) => {
  if (text === undefined) { jobs.get(id)?.abort(); return; }
  const controller = new AbortController();
  jobs.set(id, controller);
  try {
    model ??= loadModel().catch(error => { model = null; throw error; });
    const predict = await model;
    controller.signal.throwIfAborted();
    const spans = await predict(text, controller.signal);
    self.postMessage({ id, findings: maskModelFindings(text, spans) });
  } catch {
    if (!controller.signal.aborted) self.postMessage({ id, findings: null });
  } finally {
    jobs.delete(id);
  }
};
