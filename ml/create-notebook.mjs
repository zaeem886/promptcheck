import { readFile, writeFile } from 'node:fs/promises';
const source = await readFile(new URL('kaggle_train.py', import.meta.url), 'utf8');
const textLines = text => text.match(/[^\n]*\n|[^\n]+$/g) || [];
const cells = [];
const markdown = text => cells.push({ cell_type: 'markdown', metadata: {}, source: textLines(text) });
const code = text => cells.push({ cell_type: 'code', metadata: {}, source: textLines(text), execution_count: null, outputs: [] });
markdown(`# PromptPrivacy: tiny local NER model\n\nIn Kaggle, enable **Internet** and select an available **GPU** accelerator. Import this notebook, then run cells in order. Do not replace Kaggle's PyTorch/CUDA stack; PyTorch 2.6+ is required.\n\nThe default uses **synthetic demonstration data**, not a production privacy dataset. It predicts PERSON, ADDRESS, and SECRET spans; it cannot establish whether an entity is confidential. Use only synthetic, consented, or appropriately licensed training data on Kaggle.\n\nFor your own data, attach a Kaggle dataset containing train.jsonl, validation.jsonl, and test.jsonl, then set DATA_DIR in the configuration cell. The format is explained in the repository's ml/README.md. No Hugging Face login or publishing is required.\n\nTraining and CPU ONNX checks happen here. Browser/WASM integration, memory, latency, and tokenizer parity still require testing in the extension.\n`);
markdown('## 1. Install text-model and export dependencies\nRun this before importing ML packages. If the kernel already imported another Transformers version, restart the session after installation and run from the top.\n');
code('%pip install -q "transformers==4.57.1" "seqeval==1.2.2" "onnx>=1.16,<2" "onnxruntime>=1.20,<2" "onnxscript>=0.3"\n');
let number = 2;
for (const part of source.split(/^# %% /m).filter(Boolean)) {
  const newline = part.indexOf('\n');
  markdown(`## ${number++}. ${part.slice(0, newline)}\n`);
  code(part.slice(newline + 1));
}
markdown('## Download the result\nThe browser artifact ZIP contains one selected model, tokenizer/configuration files, reports, and tokenizer parity cases. It excludes training data and the PyTorch checkpoint to keep the deployment package smaller. You can download the separate checkpoint from Kaggle output files if you need to resume fine-tuning.\n\nSynthetic demo scores are not a real-world accuracy claim. Model scores are not calibrated privacy probabilities. Inspect the report before integrating.\n');
code('# FileLink returns 404 in the Kaggle editor, so download from the Output panel instead.\nfrom pathlib import Path\nzip_file = Path("/kaggle/working/promptprivacy-ml-browser.zip")\nassert zip_file.exists(), "ZIP not found: run the packaging cell first"\nprint(f"Ready: {zip_file} ({zip_file.stat().st_size / 2**20:.1f} MiB)")\nprint("Download: right-side panel > Output > /kaggle/working > promptprivacy-ml-browser.zip > three dots (...) > Download.")\nprint("Or: Save Version > Save & Run All (Commit), then the version\'s Output tab > Download.")\n');
const notebook = { cells, metadata: { kernelspec: { display_name: 'Python 3', language: 'python', name: 'python3' }, language_info: { name: 'python', file_extension: '.py' } }, nbformat: 4, nbformat_minor: 5 };
for (let i = 0; i < cells.length; i++) cells[i].id = `promptprivacy-${i}`;
await writeFile(new URL('kaggle-train-promptprivacy.ipynb', import.meta.url), JSON.stringify(notebook, null, 2) + '\n');
console.log(`Created notebook with ${cells.filter(cell => cell.cell_type === 'code').length} executable cells.`);
