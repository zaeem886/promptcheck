# %% Configuration and imports
"""Kaggle training/export pipeline. Run after the notebook's dependency cell.

Uses an uploaded train/validation/test JSONL dataset when DATA_DIR is set.
Otherwise creates a clearly labelled synthetic demonstration dataset.
This does not modify or integrate the browser extension.
"""
import os
os.environ.update(USE_TF="0", USE_FLAX="0", HF_HUB_DISABLE_TELEMETRY="1", TOKENIZERS_PARALLELISM="false")
import json
import random
import hashlib
import shutil
import subprocess
import sys
import time
from pathlib import Path
from contextlib import nullcontext
import numpy as np
import torch
from packaging.version import Version
from torch.utils.data import DataLoader
from transformers import AutoTokenizer, AutoModelForTokenClassification, DataCollatorForTokenClassification, get_linear_schedule_with_warmup
from seqeval.metrics import precision_score, recall_score, f1_score, classification_report
from seqeval.scheme import IOB2

assert Version(torch.__version__.split('+')[0]) >= Version("2.6"), "Use a Kaggle image with PyTorch >=2.6; do not replace its CUDA stack blindly."
BASE_MODEL = "prajjwal1/bert-tiny"
DATA_DIR = None  # e.g. "/kaggle/input/my-labelled-data"; None runs synthetic demo.
OUTPUT = Path("/kaggle/working/promptprivacy-ml")
SEED, EPOCHS, BATCH_SIZE, MAX_TOKENS = 42, 6, 32, 256
LEARNING_RATE, MAX_QUANTIZED_VALIDATION_F1_DROP = 3e-5, 0.02
LABELS = ["O", "B-PERSON", "I-PERSON", "B-ADDRESS", "I-ADDRESS", "B-SECRET", "I-SECRET"]
LABEL2ID = {name: index for index, name in enumerate(LABELS)}
ID2LABEL = dict(enumerate(LABELS))
OUTPUT.mkdir(parents=True, exist_ok=True)
random.seed(SEED); np.random.seed(SEED); torch.manual_seed(SEED)
if torch.cuda.is_available(): torch.cuda.manual_seed_all(SEED)
DEVICE = torch.device("cuda:0" if torch.cuda.is_available() else "cpu")
print("Device:", DEVICE, "| PyTorch:", torch.__version__)

# %% Prepare synthetic data, or load your labelled JSONL files
def compose(parts, group):
    tokens, labels = [], []
    for text, entity in parts:
        words = text.split()
        tokens.extend(words)
        labels.extend([("B-" if index == 0 else "I-") + entity if entity else "O" for index in range(len(words))])
    return {"tokens": tokens, "labels": labels, "group_id": group}

def demo_split(split, count):
    """Different templates AND identity pools per split; labels are authored."""
    pools = {
        "train": (["Ayesha", "Hamza", "Fatima", "Hassan", "Sana", "Bilal", "Mariam", "Ali"], ["Rahman", "Iqbal", "Khan", "Malik", "Shah", "Ahmed"], ["Example", "Maple", "Cedar", "Willow"]),
        "validation": (["Noor", "Faraz", "Hira", "Danish"], ["Siddiqui", "Akhtar", "Raza", "Zaman"], ["Orchard", "Pine"]),
        "test": (["Zoya", "Usman", "Mehak", "Saad"], ["Qureshi", "Abbasi", "Aslam", "Nawaz"], ["Meadow", "Birch"]),
    }
    prefixes = {
        "train": {"PERSON": ["My full name is", "Our customer is", "The employee is called", "Please contact"], "ADDRESS": ["My home address is", "Deliver the parcel to", "The customer lives at", "Send the letter to"], "SECRET": ["My password is", "The login password is", "Use this secret passphrase", "My account password reads"], "O": ["Explain password hashing and its purpose", "Describe how to store addresses safely", "Summarize the class notes about libraries", "The name and password fields are empty"]},
        "validation": {"PERSON": ["The applicant introduced herself as", "This patient's name is"], "ADDRESS": ["The residence is located at", "Record this delivery location"], "SECRET": ["I sign in with the password", "The password I use is"], "O": ["Discuss the difference between privacy and security", "Please explain why passwords should be unique"]},
        "test": {"PERSON": ["Our tenant goes by the name", "The registered guardian is"], "ADDRESS": ["The billing address on the form is", "I currently reside at"], "SECRET": ["For authentication my passphrase is", "The credential I type as my password is"], "O": ["Tell me how a password manager works", "Give instructions for updating an address without including one"]},
    }
    first, last, streets = pools[split]
    rng = random.Random(SEED + {"train": 1, "validation": 2, "test": 3}[split])
    rows, seen = [], set()
    while len(rows) < count:
        entity = ["PERSON", "ADDRESS", "SECRET", "O"][len(rows) % 4]
        templates = prefixes[split][entity]
        template_index = rng.randrange(len(templates))
        before = templates[template_index]
        if entity == "PERSON": value = rng.choice(first) + " " + rng.choice(last)
        elif entity == "ADDRESS": value = f"House {rng.randint(1, 900)} {rng.choice(streets)} Street"
        elif entity == "SECRET": value = f"demo-{split}-{rng.choice(['blue', 'amber', 'green'])}-{rng.randrange(10000, 99999)}"
        else: value = ""
        # The item id varies examples without reusing a private value across splits.
        tail = f". Synthetic record {rng.randrange(1000, 99999)} ."
        parts = [(before, None), (value, None if entity == "O" else entity), (tail, None)]
        row = compose(parts, f"{split}/{entity}/{template_index}")
        key = tuple(row["tokens"])
        if key not in seen: rows.append(row); seen.add(key)
    rng.shuffle(rows)
    return rows

def validate_splits(splits):
    fingerprints, groups = {}, {}
    for split, rows in splits.items():
        assert rows, f"Empty {split} split"
        fingerprints[split], groups[split] = set(), set()
        for index, row in enumerate(rows):
            words, labels = row.get("tokens"), row.get("labels")
            assert isinstance(words, list) and words and all(isinstance(x, str) and x.strip() for x in words), f"Invalid tokens at {split} row {index}"
            assert isinstance(labels, list) and len(words) == len(labels), f"Token/label mismatch at {split} row {index}"
            previous = "O"
            for label in labels:
                assert label in LABEL2ID, f"Unknown label at {split} row {index}"
                if label.startswith("I-"):
                    assert previous in ["B-" + label[2:], "I-" + label[2:]], f"Invalid BIO continuation at {split} row {index}"
                previous = label
            fingerprint = hashlib.sha256(" ".join(words).lower().encode()).hexdigest()
            fingerprints[split].add(fingerprint)
            if row.get("group_id"): groups[split].add(row["group_id"])
    names = list(splits)
    for index, a in enumerate(names):
        for b in names[index + 1:]:
            assert not fingerprints[a] & fingerprints[b], f"Duplicate text between {a} and {b}"
            assert not groups[a] & groups[b], f"Template/entity group leakage between {a} and {b}"
    for split, rows in splits.items():
        present = {label for row in rows for label in row["labels"]}
        assert {"B-PERSON", "B-ADDRESS", "B-SECRET"} <= present, f"{split} data must cover all three entity classes"

if DATA_DIR:
    splits = {}
    for split in ["train", "validation", "test"]:
        with (Path(DATA_DIR) / f"{split}.jsonl").open(encoding="utf-8") as file:
            splits[split] = [json.loads(line) for line in file if line.strip()]
    data_mode = "uploaded_labelled_data"
else:
    splits = {split: demo_split(split, count) for split, count in [("train", 2400), ("validation", 400), ("test", 400)]}
    data_mode = "synthetic_demo_only"
validate_splits(splits)
data_folder = OUTPUT / "data"; data_folder.mkdir(exist_ok=True)
for split, rows in splits.items():
    (data_folder / f"{split}.jsonl").write_text("\n".join(json.dumps(row) for row in rows), encoding="utf-8")
print("Data mode:", data_mode, "| Rows:", {name: len(rows) for name, rows in splits.items()})
print("Synthetic demo scores do not estimate real-world privacy accuracy.")

# %% Tokenize and align BIO labels to WordPiece tokens
tokenizer = AutoTokenizer.from_pretrained(BASE_MODEL, use_fast=True)
assert tokenizer.is_fast, "A fast tokenizer is required for word/offset alignment"
tokenizer.model_max_length = MAX_TOKENS
def encode(row):
    encoded = tokenizer(row["tokens"], is_split_into_words=True, truncation=False)
    assert len(encoded["input_ids"]) <= MAX_TOKENS, "Split long labelled examples before training; no silent truncation is allowed"
    labels, first_positions, previous = [], [], None
    for position, word_index in enumerate(encoded.word_ids()):
        if word_index is None: labels.append(-100)
        else:
            label = row["labels"][word_index]
            if word_index != previous: first_positions.append(position)
            elif label.startswith("B-"): label = "I-" + label[2:]
            labels.append(LABEL2ID[label])
        previous = word_index
    encoded["labels"] = labels
    return {**encoded, "first_positions": first_positions}
encoded_splits = {name: [encode(row) for row in rows] for name, rows in splits.items()}
padding = DataCollatorForTokenClassification(tokenizer, pad_to_multiple_of=8)
def collate(rows):
    positions = [row["first_positions"] for row in rows]
    batch = padding([{key: value for key, value in row.items() if key != "first_positions"} for row in rows])
    return batch, positions
loaders = {name: DataLoader(rows, batch_size=BATCH_SIZE, shuffle=name == "train", collate_fn=collate, num_workers=0) for name, rows in encoded_splits.items()}

# %% Train; select checkpoints using validation F1, never test F1
model = AutoModelForTokenClassification.from_pretrained(BASE_MODEL, num_labels=len(LABELS), id2label=ID2LABEL, label2id=LABEL2ID, attn_implementation="eager").to(DEVICE)
base_revision = getattr(model.config, "_commit_hash", None)
parameter_count = sum(parameter.numel() for parameter in model.parameters())
print("Parameters:", f"{parameter_count:,}")
def scores(references, predictions):
    options = dict(mode="strict", scheme=IOB2, zero_division=0)
    return {
        "precision": float(precision_score(references, predictions, **options)),
        "recall": float(recall_score(references, predictions, **options)),
        "f1": float(f1_score(references, predictions, **options)),
        "per_class": classification_report(references, predictions, output_dict=True, **options),
    }
def evaluate_torch(loader):
    model.eval(); references, predictions = [], []
    with torch.inference_mode():
        for batch, positions in loader:
            inputs = {key: value.to(DEVICE) for key, value in batch.items() if key != "labels"}
            guessed = model(**inputs).logits.argmax(-1).cpu().numpy()
            for index, firsts in enumerate(positions):
                references.append([ID2LABEL[int(batch["labels"][index, pos])] for pos in firsts])
                predictions.append([ID2LABEL[int(guessed[index, pos])] for pos in firsts])
    return scores(references, predictions)
optimizer = torch.optim.AdamW(model.parameters(), lr=LEARNING_RATE, weight_decay=0.01)
steps = EPOCHS * len(loaders["train"])
scheduler = get_linear_schedule_with_warmup(optimizer, int(steps * 0.1), steps)
use_amp = DEVICE.type == "cuda"
scaler = torch.amp.GradScaler("cuda", enabled=use_amp)
checkpoint = OUTPUT / "checkpoint"
best_f1, history = -1.0, []
for epoch in range(EPOCHS):
    model.train(); total_loss = 0.0; started = time.perf_counter()
    for batch, _ in loaders["train"]:
        optimizer.zero_grad(set_to_none=True)
        context = torch.autocast("cuda", dtype=torch.float16) if use_amp else nullcontext()
        with context: loss = model(**{key: value.to(DEVICE) for key, value in batch.items()}).loss
        scaler.scale(loss).backward(); scaler.unscale_(optimizer)
        torch.nn.utils.clip_grad_norm_(model.parameters(), 1.0)
        old_scale = scaler.get_scale(); scaler.step(optimizer); scaler.update()
        if scaler.get_scale() >= old_scale: scheduler.step()
        total_loss += loss.item()
    validation = evaluate_torch(loaders["validation"])
    history.append({"epoch": epoch + 1, "loss": total_loss / len(loaders["train"]), "validation": validation, "seconds": time.perf_counter() - started})
    print(f"Epoch {epoch+1}/{EPOCHS}: loss={history[-1]['loss']:.4f} validation F1={validation['f1']:.4f}")
    if validation["f1"] > best_f1:
        best_f1 = validation["f1"]
        model.save_pretrained(checkpoint, safe_serialization=True); tokenizer.save_pretrained(checkpoint)
model = AutoModelForTokenClassification.from_pretrained(checkpoint, attn_implementation="eager").to(DEVICE).eval()
torch_test = evaluate_torch(loaders["test"])
print("Held-out PyTorch test scores:", {key: value for key, value in torch_test.items() if key != "per_class"})

# %% Export FP32 ONNX and verify dynamic input lengths against PyTorch
import onnx
import onnxruntime as ort
from onnxruntime.quantization import quantize_dynamic, QuantType
export_dir = OUTPUT / "export"; export_dir.mkdir(exist_ok=True)
fp32_path, int8_path = export_dir / "model.fp32.onnx", export_dir / "model.int8.onnx"
model = model.cpu().float().eval(); DEVICE = torch.device("cpu")
class ExportWrapper(torch.nn.Module):
    def __init__(self, base): super().__init__(); self.base = base
    def forward(self, input_ids, attention_mask, token_type_ids):
        return self.base(input_ids=input_ids, attention_mask=attention_mask, token_type_ids=token_type_ids, return_dict=False)[0]
dummy = tokenizer("Synthetic export example", return_tensors="pt")
with torch.inference_mode():
    torch.onnx.export(ExportWrapper(model), tuple(dummy[key] for key in ["input_ids", "attention_mask", "token_type_ids"]), str(fp32_path),
        input_names=["input_ids", "attention_mask", "token_type_ids"], output_names=["logits"], opset_version=17, dynamo=False, external_data=False,
        dynamic_axes={name: {0: "batch", 1: "sequence"} for name in ["input_ids", "attention_mask", "token_type_ids", "logits"]})
onnx.checker.check_model(str(fp32_path))
session_options = ort.SessionOptions(); session_options.intra_op_num_threads = 1
fp32_session = ort.InferenceSession(str(fp32_path), sess_options=session_options, providers=["CPUExecutionProvider"])
for texts in [["Example"], ["A synthetic name is Ayesha Rahman", "A longer ordinary sentence about a university library and its books"]]:
    sample = tokenizer(texts, padding=True, return_tensors="pt")
    with torch.inference_mode(): expected = model(**sample).logits.numpy()
    actual = fp32_session.run(None, {item.name: sample[item.name].numpy() for item in fp32_session.get_inputs()})[0]
    np.testing.assert_allclose(actual, expected, rtol=1e-3, atol=1e-4)
print("FP32 ONNX/PyTorch parity passed for different batch sizes and sequence lengths.")

# %% Quantize, evaluate both exports, and choose using validation only
def evaluate_onnx(session, loader):
    references, predictions = [], []
    for batch, positions in loader:
        feed = {item.name: batch[item.name].numpy().astype(np.int64) for item in session.get_inputs()}
        guessed = session.run(None, feed)[0].argmax(-1)
        for index, firsts in enumerate(positions):
            references.append([ID2LABEL[int(batch["labels"][index, pos])] for pos in firsts])
            predictions.append([ID2LABEL[int(guessed[index, pos])] for pos in firsts])
    return scores(references, predictions)
fp32_validation = evaluate_onnx(fp32_session, loaders["validation"])
fp32_test = evaluate_onnx(fp32_session, loaders["test"])
selected_path, selected_session, quantization = fp32_path, fp32_session, {"status": "not completed"}
try:
    quantize_dynamic(str(fp32_path), str(int8_path), weight_type=QuantType.QInt8, op_types_to_quantize=["MatMul", "Gemm"])
    int8_session = ort.InferenceSession(str(int8_path), sess_options=session_options, providers=["CPUExecutionProvider"])
    int8_validation = evaluate_onnx(int8_session, loaders["validation"])
    if int8_validation["f1"] >= fp32_validation["f1"] - MAX_QUANTIZED_VALIDATION_F1_DROP:
        selected_path, selected_session = int8_path, int8_session
    quantization = {"status": "completed", "validation": int8_validation, "test": evaluate_onnx(int8_session, loaders["test"])}
except Exception as error:
    quantization = {"status": "failed; FP32 retained", "error_type": type(error).__name__}
selected_test = evaluate_onnx(selected_session, loaders["test"])
sample = tokenizer("Synthetic example " * 30, truncation=True, max_length=128, return_tensors="np")
feed = {item.name: sample[item.name].astype(np.int64) for item in selected_session.get_inputs()}
for _ in range(5): selected_session.run(None, feed)
timings = []
for _ in range(30):
    start = time.perf_counter(); selected_session.run(None, feed); timings.append((time.perf_counter() - start) * 1000)
report = {
    "data_mode": data_mode, "seed": SEED, "base_model": BASE_MODEL, "base_revision": base_revision,
    "parameter_count": parameter_count, "split_sizes": {name: len(rows) for name, rows in splits.items()},
    "metric_method": "Strict IOB2 entity precision/recall/F1 at original word boundaries; test split never used for checkpoint or quantization selection.",
    "history": history, "pytorch_test": torch_test, "onnx_fp32_validation": fp32_validation, "onnx_fp32_test": fp32_test,
    "quantization": quantization, "selected_export": selected_path.name, "selected_test": selected_test,
    "file_bytes": {path.name: path.stat().st_size for path in [fp32_path, int8_path] if path.exists()},
    "python_cpu_ort_timing": {"tokens": int(sample["input_ids"].shape[1]), "median_ms": float(np.median(timings)), "p95_ms": float(np.percentile(timings, 95)), "threads": 1, "runs": 30},
    "limitations": ["Synthetic demo data is not representative of deployment", "CPU ONNX timing is not browser/WASM timing", "Browser memory, startup and operator compatibility not measured", "Privacy intent and non-English support not established", "Scores are not calibrated privacy probabilities"],
}
(OUTPUT / "training-report.json").write_text(json.dumps(report, indent=2), encoding="utf-8")
print("Selected:", selected_path.name, "| Test:", {key: value for key, value in selected_test.items() if key != "per_class"})
print("Export sizes (MiB):", {key: round(value / 2**20, 2) for key, value in report["file_bytes"].items()})
print("Timing is Python CPU ONNX Runtime, NOT browser performance:", report["python_cpu_ort_timing"])

# %% Package only browser artifacts, tokenizer parity fixtures and reports
bundle = OUTPUT / "browser-bundle"; bundle.mkdir(exist_ok=True)
shutil.copy2(selected_path, bundle / "model.onnx")
tokenizer.save_pretrained(bundle); model.config.save_pretrained(bundle)
parity_texts = ["My name is Ayesha Rahman.", "House 14 Example Street", "password: demo-blue-47", "Two\nlines", "Unicode café and emoji 😀", "Literal <script> and [a-z]+"]
parity = []
for text in parity_texts:
    item = tokenizer(text, return_offsets_mapping=True)
    parity.append({"text": text, "input_ids": item["input_ids"], "attention_mask": item["attention_mask"], "token_type_ids": item["token_type_ids"], "offset_mapping": item["offset_mapping"]})
(bundle / "tokenizer-parity.json").write_text(json.dumps({"python_offset_units": "Unicode code points; convert to JS UTF-16 for extension locations", "cases": parity}, indent=2), encoding="utf-8")
(bundle / "manifest.json").write_text(json.dumps({
    "base_model": BASE_MODEL, "base_model_license": "MIT; retain the upstream model notices", "labels": LABELS,
    "task": "token-classification", "max_sequence_length": MAX_TOKENS, "suggested_chunk_overlap": 32,
    "selected_export": selected_path.name, "data_mode": data_mode, "requires_browser_validation": True,
    "confidence_threshold": None, "note": "Select thresholds on independent validation data. PERSON/ADDRESS are entity hypotheses, not confirmed confidentiality.",
}, indent=2), encoding="utf-8")
shutil.copy2(OUTPUT / "training-report.json", bundle / "training-report.json")
freeze = subprocess.check_output([sys.executable, "-m", "pip", "freeze"], text=True)
(bundle / "requirements-freeze.txt").write_text(freeze, encoding="utf-8")
zip_path = shutil.make_archive("/kaggle/working/promptprivacy-ml-browser", "zip", bundle)
print("Download:", zip_path)
print("PyTorch checkpoint for future fine-tuning:", checkpoint)
print("This is a provisional model export, not an installed extension feature.")
