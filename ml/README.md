# Kaggle training notebook

Import [kaggle-train-promptprivacy.ipynb](kaggle-train-promptprivacy.ipynb) into Kaggle. Enable Internet so the public base model and dependencies can download, select an available GPU accelerator, and run cells in order. The first cell installs text-model/export dependencies without replacing Kaggle's PyTorch/CUDA installation. PyTorch 2.6+ is required. A warning about newly initialized token-classification weights is expected: that head is being trained. To download the result, open the right-side **Output** panel, find `promptprivacy-ml-browser.zip` under `/kaggle/working`, and choose **⋮ → Download**; an in-notebook file link returns 404 in the Kaggle editor.

The notebook uses `prajjwal1/bert-tiny`, trains a seven-label BIO token classifier for PERSON, ADDRESS, and SECRET, and writes `/kaggle/working/promptprivacy-ml-browser.zip`. It does not install ML in the extension, upload to Hugging Face, or require an account token. Training on Kaggle is hosted processing: use only synthetic, consented, or appropriately licensed data, never actual passwords or customer secrets.

The default generates 4,000 training, 600 validation, and 600 test examples with separate template and identity pools. Each split has its own names, streets, areas, cities, and password words, plus its own sentence templates. Training sentences are composed from separate lead-in, entity, and continuation pools (about 680 distinct templates), so entities appear at the start, middle, and end; validation and test keep a small set of fixed, unseen templates. The data includes several address and password shapes (every synthetic password contains a digit), sentences with two entities, and negatives that mention names, addresses, or passwords without containing one. BERT-Tiny is uncased, so capitalisation cannot distinguish names from other words. Training defaults are 20 epochs at learning rate 3e-4; BERT-Tiny underfits at the 3e-5 rate typical for base-size BERT. This is a demonstration corpus, not enough evidence for production privacy detection. A PERSON/ADDRESS finding identifies a possible entity; confidentiality is not established. English is the starting scope; Urdu, Roman Urdu, and broad privacy understanding are not claimed.

For your data, attach a Kaggle dataset with `train.jsonl`, `validation.jsonl`, and `test.jsonl`, then change `DATA_DIR` in the notebook's configuration cell. One JSON object per line:

```json
{"tokens":["My","name","is","Ayesha","Rahman","."],"labels":["O","O","O","B-PERSON","I-PERSON","O"],"group_id":"person-template-1"}
```

Allowed labels: `O`, `B-PERSON`, `I-PERSON`, `B-ADDRESS`, `I-ADDRESS`, `B-SECRET`, `I-SECRET`. Every token needs exactly one label, and I-labels must continue the same entity type. Each split must contain positive examples of all three entity classes. `group_id` is optional; if used, keep template/entity groups entirely within one split. The code rejects exact normalized cross-split duplicates and overlapping supplied groups, but cannot detect semantic leakage automatically. Keep identities/templates separate manually too. Include varied ordinary content and difficult negatives. Examples longer than 256 WordPiece tokens are rejected; split them intentionally before training instead of silently losing labels.

Training selects the best checkpoint using validation entity F1. Evaluation uses strict IOB2 entity precision/recall/F1 at original word boundaries, not token accuracy or exact character-span evaluation. Quantization is selected using validation F1 with a configurable maximum drop of 0.02; the test set is not used to choose the checkpoint/export. Both original and quantized exports are tested. FP32 export logits are compared against PyTorch at different batch sizes/lengths. INT8 quantization covers supported matrix operations; embeddings can remain floating point, so measure the actual size. If quantization fails or exceeds the validation drop, FP32 is retained.

The downloadable browser ZIP contains:

- `model.onnx`: the selected FP32 or INT8 model.
- Tokenizer assets and `config.json`: label maps and tokenization configuration.
- `tokenizer-parity.json`: synthetic reference token IDs and original-text offsets for future browser tests.
- `training-report.json`: split counts, validation history, per-class metrics, export sizes, and measured Python CPU ONNX timing.
- `manifest.json`: model scope and provisional integration metadata.
- `requirements-freeze.txt`: actual installed package versions.

Training data and the PyTorch checkpoint remain outside that ZIP. The separate checkpoint is under `/kaggle/working/promptprivacy-ml/checkpoint` for future fine-tuning. No real training data appears in the notebook's sample outputs or browser bundle, although raw dataset files are saved in Kaggle working output for reproducibility—do not publish outputs containing sensitive data.

Python CPU ONNX timing is not browser/WASM performance. Chrome/Brave operator support, cold-start time, peak browser memory, held-out deployment accuracy, and confidence thresholds must still be validated. Python tokenizer offsets use Unicode code points; the extension uses UTF-16, so convert offsets correctly before reusing its line/location helper. Chunk long prompts with overlap during integration; never pass an entire long prompt through truncation and report it as fully scanned.

`kaggle_train.py` contains the same code with `# %%` cell markers. After editing it, regenerate the notebook with `node ml/create-notebook.mjs`. Dataset helper tests run without ML dependencies: `py -3.14 -m unittest discover -s ml -p "test_*.py"`. These local checks do not train the model or exercise GPU/ONNX packages.

References: [BERT-Tiny model card](https://huggingface.co/prajjwal1/bert-tiny), [Transformers token classification](https://huggingface.co/docs/transformers/v4.57.1/tasks/token_classification), [PyTorch ONNX export](https://docs.pytorch.org/docs/stable/onnx.html), and [ONNX quantization](https://onnxruntime.ai/docs/performance/model-optimizations/quantization.html). Retain upstream model/package license notices when distributing derived artifacts.
