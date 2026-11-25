"""Run the supplied ONNX weights on independently authored synthetic examples."""
import ast
import argparse
import hashlib
import json
import statistics
import unicodedata
import zipfile
from collections import defaultdict
from functools import lru_cache
from pathlib import Path
import numpy as np
import onnxruntime as ort

ROOT = Path(__file__).resolve().parent
parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument("bundle", nargs="?", type=Path, default=ROOT / "promptprivacy-global.zip")
parser.add_argument("--output", type=Path, default=ROOT.parent / "artifacts" / "ml-evaluation")
args = parser.parse_args()
OUT = args.output
OUT.mkdir(parents=True, exist_ok=True)
with zipfile.ZipFile(args.bundle) as archive:
    model = archive.read("model.onnx")
    manifest = json.loads(archive.read("manifest.json"))
    saved = json.loads(archive.read("training-report.json"))
    parity = json.loads(archive.read("parity.json"))
assert hashlib.sha256(model).hexdigest() == manifest["model_sha256"]
KINDS = tuple(t[2:] for t in manifest["tags"] if t.startswith("B-"))
BUCKETS, CORE, HALO = (manifest[k] for k in ("buckets", "core", "halo"))
CHAR_GROUPS = tuple(manifest["shape_groups"][:-1])
tree = ast.parse((ROOT / "kaggle_train.py").read_text(encoding="utf-8"))
names = {"encode", "char_id", "shape_group", "windows", "decode", "metrics", "score_spans", "annotated"}
exec(compile(ast.Module(body=[n for n in tree.body if isinstance(n, ast.FunctionDef) and n.name in names],
                        type_ignores=[]), "evaluation-helpers", "exec"))
options = ort.SessionOptions()
options.intra_op_num_threads = options.inter_op_num_threads = 1
session = ort.InferenceSession(model, sess_options=options, providers=["CPUExecutionProvider"])

def predict(text):
    ids = encode(text)
    tags, confidence = [], []
    for left, right, a, b in windows(len(ids)):
        logits = session.run(["logits"], {"ids":ids[None,left:right].astype(np.int32)})[0][0,a-left:b-left]
        tags.extend(logits.argmax(-1).tolist())
        confidence.extend((1 / np.exp(logits-logits.max(-1,keepdims=True)).sum(-1)).tolist())
    scores = {s:statistics.fmean(confidence[s[1]:s[2]]) for s in decode(tags)}
    return ids, tags, scores

for c in parity:
    ids,tags,scores = predict(c["text"])
    assert ids.tolist() == c["ids"] and tags == c["tags"]
    assert sorted(s for s,p in scores.items() if p >= manifest["min_span_score"]) == [tuple(s) for s in c["spans"]]

values = {
 "PERSON":["Tenzin Dorje","Imogen Brooks","Amina El-Sayed","Mary-Jane O'Brien","José Nuñez"],
 "ADDRESS":["Flat 7, 18 Cedar Lane, Bristol BS1 4QA","42 Rue des Fleurs\n75011 Paris","1600 Example Avenue, Apt 5B, Boston MA 02108","東京都新宿区西新宿2丁目8番1号","14 River Walk, Dublin D02 XY76"],
 "PHONE":["+1 (202) 555-0198","+92 321 4567890","+33 6 12 34 56 78","+81 90-1234-5678","+61 412 345 678"],
 "EMAIL":["mina.chen+lab@example.test","marie-claire@example.org","qa_team@example.net","zoë@example.test","测试@example.org"],
 "NATIONAL_ID":["12345-7654321-9","000-12-3456","1234 5678 9012","AB123456C","12.345.678-9"],
 "PASSPORT":["XZ4625079","AB7654321","503817294","PQ8216530","19 02 345678"],
 "BANK_ACCOUNT":["07200341962","000123456789","12345678","843502716","9876543210123456"],
 "IBAN":["GB82 WEST 1234 5698 7654 32","DE89 3704 0044 0532 0130 00","FR14 2004 1010 0505 0001 3M02 606","PK36SCBL0000001123456702","NL91 ABNA 0417 1643 00"],
 "PAYMENT_CARD":["4242 4242 4242 4242","5555-5555-5555-4444","378282246310005","6011 1111 1111 1117","3530111333300000"],
 "API_KEY":["ghp_SyntheticExampleForTesting0123456789AB","sk-syntheticOnlyForLocalTesting1234567890","AKIAIOSFODNN7EXAMPLE","key_ExampleOpaqueCredential7843","a813b950f0146e21cc4299053d724ba8"],
 "PASSWORD":["VelvetSparrow","paper cranes at midnight","Demo_DB-71!cat","Canopy-Delta-591","Sparrow!713"],
 "PIN":["7319","0082","582016","٤٢١٨","۰۹۳۱"],
}
contexts = ("Please put the reservation under ","Ship the replacement to ","If the courier gets lost, ring ",
            "Forward your reply to ","The employee's national identification number is ",
            "For the travel booking, my passport number reads ","The receiving bank account number is ",
            "Our international transfer should use IBAN ","The debit card number entered at checkout was ",
            "The service authenticates with API credential ","I sign in using the password ",
            "To withdraw cash at the ATM I type PIN ")
rows = [annotated(prefix,(kind,v),".") for (kind,items),prefix in zip(values.items(),contexts) for v in items]
rows += [annotated("Please summarize this record.\n",kind.lower().replace("_"," ")," → ",(kind,items[0]))
         for kind,items in values.items()]
negatives = ["Explain how passwords should be stored.","My PIN field is empty.","Email address: [redacted]",
 "The parcel weighs 4 kilograms.","Memory address 0x7FFE1234 was freed.","Order reference 07200341962 needs review.",
 "Product SKU 4242-4242 is out of stock.","I read 7319 words today.","Page 2025550198 was missing.",
 "The JSON key is account_number and its value is null.","What is an IBAN?","Please remove my personal information.",
 "CNIC and passport are types of identification.","The invoice total is 1234.56.","Version 12.34.567 is installed.",
 "The bank branch opens at 09:00.","کارڈ نمبر درج نہیں ہے۔","Le champ mot de passe est vide.",
 "電話番号は空欄です。","The example was marked [REDACTED]."]
rows += [annotated(s) for s in negatives]
for kind in ("EMAIL","PHONE","PASSWORD","PAYMENT_CARD"):
    rows.append(annotated("Ordinary background text. "*45,kind.lower().replace("_"," ")," = ",
                          (kind,values[kind][1]),"\nMore ordinary discussion. "*30))
found,detail = [],[]
for row in rows:
    _,_,scores = predict(row["text"])
    spans = {s for s,p in scores.items() if p >= manifest["min_span_score"]}
    found.append(spans)
    detail.append(dict(**row,predicted=[dict(label=s[0],start=s[1],end=s[2],score=p)
                                       for s,p in sorted(scores.items()) if s in spans]))
fresh = score_spans(rows,found)
result = dict(model_sha256=manifest["model_sha256"],cutoff=manifest["min_span_score"],
              parity_passed=len(parity),fresh_cases=len(rows),fresh_exact_span=fresh,
              saved_heldout=saved["heldout_exact_span"],saved_authored=saved["authored_exact_span"],cases=detail)
(OUT/"results.json").write_text(json.dumps(result,ensure_ascii=False,indent=2),encoding="utf-8")
lines = ["# Exported model evaluation","",
 f"Model SHA256 {manifest['model_sha256']}. Fixed supplied cutoff {manifest['min_span_score']}.",
 f"All {len(parity)} reference fixtures passed with the supplied ONNX weights.","",
 f"The fixed challenge contains {len(rows)} independently authored synthetic documents. Correct category and exact character boundaries are required.",
 "Each category has five values in natural requests and one field-style record. Four long documents exercise all windows.",
 "Regional formats are illustrative. This small challenge cannot establish accuracy in every country or language.","",
 "| Category | Precision | Recall | F1 | TP | FP | FN |","|---|---:|---:|---:|---:|---:|---:|"]
for kind,m in [("Overall",fresh["overall"]),*fresh["by_category"].items()]:
    lines.append(f"| {kind} | {m['precision']:.1%} | {m['recall']:.1%} | {m['f1']:.1%} | {m['tp']} | {m['fp']} | {m['fn']} |")
lines += ["",f"Benign documents with false alarms {fresh['benign_false_alarms']}/{fresh['benign_documents']}.",
 "","The ZIP's saved 5,000-document test report is a separate benchmark. The original test documents are absent from the ZIP.",
 "Inputs and predictions are in results.json. The model and cutoff were fixed throughout evaluation.",
 "These challenge examples have been used to inspect earlier models and serve as a development benchmark.",
 "",f"Evaluated bundle: {args.bundle.name}.",
 "",f'Reproduce with numpy and onnxruntime installed: python ml/evaluate_model.py "{args.bundle}" --output "{OUT}"']
(OUT/"README.md").write_text("\n".join(lines)+"\n",encoding="utf-8")
print("Fresh",fresh["overall"])
print("Saved",saved["heldout_exact_span"]["overall"])
print("Saved authored",saved["authored_exact_span"]["overall"])
