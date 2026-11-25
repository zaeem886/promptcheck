"""Rebuild the self-contained Kaggle notebook from the percent-marked source."""
import json
import re
from pathlib import Path

root = Path(__file__).resolve().parent
parts = re.split(r"^# %% (.+)\n", (root / "kaggle_train.py").read_text(encoding="utf-8"), flags=re.M)
assert not parts[0].strip()

def cell(kind, source, ident):
    item = {"id":ident, "cell_type":kind, "metadata":{}, "source":source.strip("\n").splitlines(True)}
    if kind == "code":
        item.update(execution_count=None, outputs=[])
    return item

cells = [cell("markdown", """# PromptPrivacy • International privacy spans

Import this notebook into Kaggle, enable Internet for the install cell, select a GPU, and run all cells in order. The default creates 110,000 synthetic documents. To check the pipeline quickly, set SMOKE to True in step 2.

The model learns exact character spans for 12 categories from annotated examples. Each split reports the regions actually sampled for each category. The benchmark at the end measures Python CPU inference. The repository includes a separate local browser benchmark for the downloaded weights.

This revision uses a width-64 CNN, extra password and passport samples, varied complete-value annotations, and 25% harmless documents. Natural requests, quoted fields, tables and support dialogue supply additional context. Each epoch reports training-sample and validation scores, loss, learning rate and per-category validation F1. The learning rate decreases when validation performance stalls.

Train this revision from the beginning. MODEL_WIDTH, LEARNING_RATE and PATIENCE are editable in cell 2. The confidence cutoff is selected using validation data and both filtered and unfiltered test scores are reported. The authored challenge is a development diagnostic because its examples have been inspected during development. Reserve a separate untouched final test dataset for a final accuracy claim. The wider model needs new browser timing measurements after training.""", "introduction")]
for i, (heading, body) in enumerate(zip(parts[1::2], parts[2::2]), 1):
    cells.extend([cell("markdown", f"## {i}. {heading}", f"step-{i}"), cell("code", body, f"code-{i}")])
notebook = {"nbformat":4, "nbformat_minor":5, "cells":cells, "metadata":{
    "kernelspec":{"display_name":"Python 3", "language":"python", "name":"python3"},
    "language_info":{"name":"python"}}}
(root / "kaggle-train-promptprivacy.ipynb").write_text(json.dumps(notebook, ensure_ascii=False, indent=1) + "\n", encoding="utf-8")
print(f"Built {len(cells)//2} executable cells.")
