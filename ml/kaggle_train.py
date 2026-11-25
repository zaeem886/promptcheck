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
SEED, EPOCHS, BATCH_SIZE, MAX_TOKENS = 42, 20, 32, 256
LEARNING_RATE, MAX_QUANTIZED_VALIDATION_F1_DROP = 3e-4, 0.02  # BERT-Tiny needs a higher LR than base-size BERT
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
    """Synthetic demo data. Every split has its own identity/value pools AND its own sentence templates,
    so test scores measure generalisation to unseen names, places and wording. Labels are authored."""
    import re
    pools = {  # first names, last names, street words, areas, cities, password words - disjoint across splits
        "train": (
            ["Ayesha", "Hamza", "Fatima", "Hassan", "Sana", "Bilal", "Mariam", "Ali", "Zainab", "Omar", "Hina", "Kamran", "Rabia", "Imran", "Amna", "Tariq", "Sadia", "Waqas", "Nadia", "Asad",
             "Emily", "James", "Olivia", "Daniel", "Sophia", "Michael", "Grace", "Lucas", "Chloe", "Ethan", "Laila", "Junaid", "Saima", "Farhan", "Uzma", "Shahid", "Iqra", "Adeel", "Mahnoor", "Rizwan",
             "Aliya", "Arslan", "Bushra", "Danyal", "Erum", "Fawad", "Ghazala", "Haris", "Ibrahim", "Javeria", "Kinza", "Luqman", "Momina", "Nabeel", "Osama", "Parveen", "Qasim", "Rukhsana", "Shoaib", "Tehmina",
             "Umair", "Wajiha", "Yasir", "Zubair", "Anaya", "Babar", "Fiza", "Hadia", "Irfan", "Jahanzeb", "Komal", "Mohsin", "Nimra", "Rehan", "Shazia", "Tabish", "Warda", "Yusra", "Zeeshan", "Aiman",
             "Amelia", "Benjamin", "Charlotte", "David", "Emma", "George", "Hannah", "Isaac", "Jack", "Katie", "Liam", "Mia", "Nathan", "Oscar", "Poppy", "Robert", "Sarah", "Thomas", "Victoria", "William"],
            ["Rahman", "Iqbal", "Khan", "Malik", "Shah", "Ahmed", "Butt", "Chaudhry", "Mirza", "Hussain", "Javed", "Sheikh", "Baig", "Anwar", "Latif",
             "Smith", "Johnson", "Brown", "Taylor", "Wilson", "Clark", "Lewis", "Walker", "Hall", "Young", "Farooq", "Saleem", "Haider", "Rana", "Bhatti",
             "Awan", "Bajwa", "Cheema", "Dar", "Gondal", "Hashmi", "Jamil", "Khattak", "Lodhi", "Memon", "Niazi", "Paracha", "Rizvi", "Soomro", "Tiwana",
             "Warraich", "Yousaf", "Zafar", "Afridi", "Bukhari", "Gilani", "Hayat", "Kiani", "Mughal", "Naqvi", "Qadri", "Sethi", "Tahir", "Usmani", "Wattoo",
             "Adams", "Baker", "Campbell", "Davies", "Evans", "Fisher", "Green", "Harris", "Jenkins", "King", "Morgan", "Nelson", "Roberts", "Scott", "Ward"],
            ["Maple", "Cedar", "Willow", "Example", "Garden", "Canal", "Mall", "Park", "Lake", "River", "Hill", "Station", "Church", "Mill", "Bridge", "Forest", "Spring", "Rose", "Oak", "Ferozepur"],
            ["Gulberg", "Clifton", "Johar Town", "Bahria Town", "Model Town", "Garden Town", "Wapda Town", "Iqbal Town", "Defence", "North Nazimabad", "Gulshan", "Shadman"],
            ["Lahore", "Karachi", "Islamabad", "Multan", "Faisalabad", "Peshawar", "London", "Manchester", "Rawalpindi", "Bahawalpur", "Sargodha", "Abbottabad", "Birmingham", "Glasgow"],
            ["blue", "amber", "tiger", "cloud", "orange", "falcon", "pepper", "silver", "rocket", "mango", "copper", "eagle", "winter", "coffee", "pixel", "garnet"]),
        "validation": (
            ["Noor", "Faraz", "Hira", "Danish", "Sobia", "Kashif", "Ella", "Ryan", "Maira", "Owais", "Zara", "Henry"],
            ["Siddiqui", "Akhtar", "Raza", "Zaman", "Turner", "Parker", "Gill", "Durrani"],
            ["Orchard", "Pine", "Elm", "Sunset"], ["Saddar", "Cantt"], ["Quetta", "Sialkot", "Leeds"], ["violet", "comet", "panda"]),
        "test": (
            ["Zoya", "Usman", "Mehak", "Saad", "Areeba", "Fahad", "Lily", "Adam", "Ramsha", "Talha", "Ruby", "Noah"],
            ["Qureshi", "Abbasi", "Aslam", "Nawaz", "Cooper", "Bennett", "Jatoi", "Kazmi"],
            ["Meadow", "Birch", "Harbor", "Valley"], ["Township", "Satellite Town"], ["Hyderabad", "Gujranwala", "Bristol"], ["lemon", "storm", "otter"]),
    }
    templates = {
        "train": {
            "PERSON": ["My full name is {PERSON} .", "Our customer is {PERSON} and she needs help .", "The employee is called {PERSON} .", "Please contact {PERSON} about the invoice .",
                       "{PERSON} submitted the form yesterday .", "Write a reference letter for {PERSON} .", "Hi , I am {PERSON} from the accounts team .", "Forward this to {PERSON} before Friday .",
                       "The account holder {PERSON} asked for a refund .", "Schedule a meeting with {PERSON} next week ."],
            "ADDRESS": ["My home address is {ADDRESS} .", "Deliver the parcel to {ADDRESS} .", "The customer lives at {ADDRESS} .", "Send the letter to {ADDRESS} please .",
                        "{ADDRESS} is where the office moved .", "Ship it to {ADDRESS} by Monday .", "Our new flat is at {ADDRESS} .", "Update my address to {ADDRESS} ."],
            "SECRET": ["My password is {SECRET} .", "The login password is {SECRET}", "Use this secret passphrase : {SECRET}", "My account password reads {SECRET} .",
                       "{SECRET} is the wifi password .", "Log in with password {SECRET} and check the report .", "pwd = {SECRET}", "Can you check if {SECRET} is a strong password ?"],
            "MIXED": ["My name is {PERSON} and I live at {ADDRESS} .", "{PERSON} uses the password {SECRET} for the portal .", "Send the documents to {PERSON} at {ADDRESS} .", "Login for {PERSON} : password {SECRET}"],
            "O": ["Explain password hashing and its purpose .", "Describe how to store addresses safely .", "Summarize the class notes about libraries .", "The name and password fields are empty .",
                  "What makes a strong password ?", "How do I change my home address in the app ?", "Write a story about a dragon that lives near a river .", "List three tips for writing a cover letter .",
                  "The meeting is in Room 12 on Monday .", "Translate this sentence into Urdu please ."]},
        "validation": {
            "PERSON": ["The applicant introduced herself as {PERSON} .", "This patient's name is {PERSON} .", "Kindly email {PERSON} the final draft ."],
            "ADDRESS": ["The residence is located at {ADDRESS} .", "Record this delivery location : {ADDRESS}", "We moved to {ADDRESS} last month ."],
            "SECRET": ["I sign in with the password {SECRET} .", "The password I use is {SECRET}", "Is {SECRET} safe to use as a password ?"],
            "MIXED": ["{PERSON} lives at {ADDRESS} with her family .", "Reset the password {SECRET} for {PERSON} ."],
            "O": ["Discuss the difference between privacy and security .", "Please explain why passwords should be unique .", "Give me a recipe for vegetable soup .", "Where should I type my address on this form ?"]},
        "test": {
            "PERSON": ["Our tenant goes by the name {PERSON} .", "The registered guardian is {PERSON} .", "Book a taxi for {PERSON} tomorrow ."],
            "ADDRESS": ["The billing address on the form is {ADDRESS} .", "I currently reside at {ADDRESS} .", "Pick me up from {ADDRESS} at noon ."],
            "SECRET": ["For authentication my passphrase is {SECRET} .", "The credential I type as my password is {SECRET}", "Remember that the admin password is {SECRET} ."],
            "MIXED": ["{PERSON} , {ADDRESS} , is the shipping contact .", "The portal user {PERSON} has password {SECRET} ."],
            "O": ["Tell me how a password manager works .", "Give instructions for updating an address without including one .", "Summarize the history of the printing press .", "Name three famous rivers in Asia ."]},
    }
    first, last, streets, areas, cities, words = pools[split]
    rng = random.Random(SEED + {"train": 1, "validation": 2, "test": 3}[split])
    alphabet = "abcdefghijkmnpqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789"
    def person(): return rng.choice(first) + " " + rng.choice(last)
    def address():
        n, letter = rng.randint(1, 900), rng.choice("ABCDEFGHJK")
        return rng.choice([f"House {n} {rng.choice(streets)} Street , {rng.choice(cities)}", f"Flat {n} , Block {letter} , {rng.choice(areas)} , {rng.choice(cities)}",
                           f"{n} {rng.choice(streets)} Road , {rng.choice(areas)}", f"Street {n} , Sector {letter}-{rng.randint(1, 20)} , {rng.choice(cities)}"])
    def secret():  # always one whitespace-free token containing a digit, in several realistic shapes
        kind = rng.randrange(3)
        if kind == 0: return f"{rng.choice(words)}-{rng.choice(words)}-{rng.randint(10, 9999)}"
        if kind == 1:
            text = [rng.choice(alphabet) for _ in range(rng.randint(10, 16))]
            text[rng.randrange(len(text))] = rng.choice("23456789")  # bare letters would look like an unseen name to an uncased model
            return "".join(text)
        return f"{rng.choice(words).capitalize()}{rng.randint(1, 9999)}{rng.choice('!@#$%&*')}"
    makers = {"PERSON": person, "ADDRESS": address, "SECRET": secret}
    if split == "train":
        # Compositional training templates: many (lead-in, entity, continuation) combinations, entities at the
        # start/middle/end, so the model learns where an entity stops instead of memorising whole sentences.
        # Validation/test keep their own fixed, unseen templates, so their scores stay honest.
        lead = {
            "PERSON": ["My full name is", "Our customer is", "The employee is called", "Please contact", "Write a reference letter for", "Hi , I am", "Forward this to",
                       "The account holder is", "Schedule a meeting with", "The form was signed by", "Call", "My manager is", "Add a note for", "The student enrolled is", "I spoke with"],
            "ADDRESS": ["My home address is", "Deliver the parcel to", "The customer lives at", "Send the letter to", "Ship it to", "Our new flat is at", "Update my address to",
                        "The office is at", "Courier the box to", "Her permanent address is", "Drop the keys at", "The shop moved to", "Visit us at", "Address :"],
            "SECRET": ["My password is", "The login password is", "Use this secret passphrase :", "My account password reads", "Log in with password", "pwd =", "password :",
                       "The wifi key is", "My PIN and password combo is", "Set the database password to", "The vault passphrase is", "Temporary password :", "Use the password"],
        }
        tail = ["", "", "", "please", "and check the report", "before Friday", "by Monday", "for the new account", "and call me back", "if possible", "as soon as you can",
                "for my records", "thanks", "and confirm by email", "next week", "today"]
        first_phrase = {"PERSON": ["submitted the form yesterday", "asked for a refund", "joined the team last year", "will attend the meeting"],
                        "ADDRESS": ["is where the office moved", "is our billing location", "is listed on the invoice"],
                        "SECRET": ["is the wifi password", "is my email password", "works for the staff portal"]}
        mixed = ["My name is {PERSON} and I live at {ADDRESS} .", "{PERSON} uses the password {SECRET} for the portal .", "Send the documents to {PERSON} at {ADDRESS} .",
                 "Login for {PERSON} : password {SECRET}", "Name : {PERSON} , Address : {ADDRESS}",
                 "Ask {PERSON} to reset {SECRET} today .", "{PERSON} moved to {ADDRESS} and changed the password to {SECRET} .", "Customer {PERSON} at {ADDRESS} needs a callback .",
                 "{PERSON} shared the password {SECRET} by mistake ."]
        negatives = templates["train"]["O"] + ["The manager reset the router yesterday .", "Our team uses strong passphrases for every account .",
                     "Call the help desk if the login fails .", "The parcel arrived at the warehouse on time .", "Please book a room for the workshop .", "Order 4521 was shipped on Tuesday .",
                     "The user forgot which password field to fill .", "Write an email asking for a new address form .", "The library closes at six on weekdays .",
                     "Read chapter 7 and answer question 3 .", "Explain how a firewall filters traffic ."]
        def train_template(kind):
            if kind == "MIXED": index = rng.randrange(len(mixed)); return mixed[index], f"m{index}"
            if kind == "O": index = rng.randrange(len(negatives)); return negatives[index], f"o{index}"
            if rng.random() < 0.2:
                index = rng.randrange(len(first_phrase[kind])); return "{%s} %s ." % (kind, first_phrase[kind][index]), f"f{index}"
            a, b = rng.randrange(len(lead[kind])), rng.randrange(len(tail))
            return f"{lead[kind][a]} {{{kind}}} {tail[b]} .", f"l{a}-{b}"
    rows, seen = [], set()
    while len(rows) < count:
        kind = ["PERSON", "ADDRESS", "SECRET", "MIXED", "O"][len(rows) % 5]
        if split == "train": template, template_index = train_template(kind)
        else:
            template_index = rng.randrange(len(templates[split][kind]))
            template = templates[split][kind][template_index]
        parts = []
        for piece in re.split(r"(\{(?:PERSON|ADDRESS|SECRET)\})", template):
            if piece.startswith("{"): parts.append((makers[piece[1:-1]](), piece[1:-1]))
            elif piece.strip(): parts.append((piece, None))
        # A random record id on some rows varies the context without reusing private values across splits.
        if rng.random() < 0.5: parts.append((f"Record {rng.randrange(1000, 99999)} .", None))
        row = compose(parts, f"{split}/{kind}/{template_index}")
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
    splits = {split: demo_split(split, count) for split, count in [("train", 4000), ("validation", 600), ("test", 600)]}
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
INPUT_NAMES = ["input_ids", "attention_mask", "token_type_ids"]
# Padded batch of 2 so tracing sees padding and a non-trivial attention mask.
dummy = tokenizer(["Synthetic export example", "My name is Ayesha Rahman and I live at House 14 Example Street"], padding=True, return_tensors="pt")
PARITY_TEXTS = [["Example"], ["A synthetic name is Ayesha Rahman", "A longer ordinary sentence about a university library and its books"],
                ["Synthetic export example", "My name is Ayesha Rahman and I live at House 14 Example Street"]]
session_options = ort.SessionOptions(); session_options.intra_op_num_threads = 1
def export_onnx(use_dynamo):
    fp32_path.unlink(missing_ok=True)
    # Export under no_grad, NOT inference_mode: tracing inference tensors can bake wrong constants into the graph.
    with torch.no_grad():
        # A new wrapper module starts in training mode; the exporter restores that mode afterwards,
        # which would switch the inner BERT back to training (dropout on). Keep everything in eval mode.
        torch.onnx.export(ExportWrapper(model).eval(), tuple(dummy[key] for key in INPUT_NAMES), str(fp32_path),
            input_names=INPUT_NAMES, output_names=["logits"], opset_version=18 if use_dynamo else 17, dynamo=use_dynamo, external_data=False,
            dynamic_axes={name: {0: "batch", 1: "sequence"} for name in INPUT_NAMES + ["logits"]})
    onnx.checker.check_model(str(fp32_path))
    return ort.InferenceSession(str(fp32_path), sess_options=session_options, providers=["CPUExecutionProvider"])
def parity_max_diff(session):
    model.eval()  # reference outputs must come from eval mode (no dropout)
    worst = 0.0
    for texts in PARITY_TEXTS:
        sample = tokenizer(texts, padding=True, return_tensors="pt")
        with torch.no_grad(): expected = model(**sample).logits.numpy()
        actual = session.run(None, {item.name: sample[item.name].numpy().astype(np.int64) for item in session.get_inputs()})[0]
        mask = sample["attention_mask"].numpy().astype(bool)  # padded positions are never read
        diff = float(np.max(np.abs(actual[mask] - expected[mask])))
        print(f"  batch={len(texts)} seq={sample['input_ids'].shape[1]} max |diff|={diff:.2e}")
        worst = max(worst, diff)
    return worst
fp32_session, export_method = None, None
for use_dynamo in (False, True):
    label = "dynamo" if use_dynamo else "legacy TorchScript"
    print(f"Trying {label} ONNX export...")
    try:
        candidate = export_onnx(use_dynamo)
    except Exception as error:
        print(f"  {label} export failed: {type(error).__name__}: {str(error)[:300]}")
        continue
    worst = parity_max_diff(candidate)
    if worst <= 1e-3:
        fp32_session, export_method = candidate, label
        break
    print(f"  {label} export does not match PyTorch (max diff {worst:.3f}); trying next exporter.")
if fp32_session is None:
    raise RuntimeError("No ONNX export matched PyTorch outputs. Copy the printed diffs and package versions when reporting this.")
print(f"FP32 ONNX/PyTorch parity passed with the {export_method} exporter for different batch sizes and sequence lengths.")

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
    "quantization": quantization, "onnx_export_method": export_method, "selected_export": selected_path.name, "selected_test": selected_test,
    "file_bytes": {path.name: path.stat().st_size for path in [fp32_path, int8_path] if path.exists()},
    "python_cpu_ort_timing": {"tokens": int(sample["input_ids"].shape[1]), "median_ms": float(np.median(timings)), "p95_ms": float(np.percentile(timings, 95)), "threads": 1, "runs": 30},
    "limitations": ["Synthetic demo data is not representative of deployment", "CPU ONNX timing is not browser/WASM timing", "Browser memory, startup and operator compatibility not measured", "Privacy intent and non-English support not established", "Scores are not calibrated privacy probabilities"],
}
def json_default(value):
    # seqeval's per-class report contains numpy numbers (e.g. int64 support counts).
    if isinstance(value, np.integer): return int(value)
    if isinstance(value, np.floating): return float(value)
    if isinstance(value, np.ndarray): return value.tolist()
    raise TypeError(f"Object of type {type(value).__name__} is not JSON serializable")
(OUTPUT / "training-report.json").write_text(json.dumps(report, indent=2, default=json_default), encoding="utf-8")
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
