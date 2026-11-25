"""Dependency-free checks of the notebook's synthetic data and BIO validators."""
import ast
import hashlib
import json
import random
import unittest
from pathlib import Path

SOURCE = Path(__file__).with_name("kaggle_train.py")
tree = ast.parse(SOURCE.read_text(encoding="utf-8"))
names = {"compose", "demo_split", "validate_splits"}
functions = ast.Module(body=[node for node in tree.body if isinstance(node, ast.FunctionDef) and node.name in names], type_ignores=[])
labels = ["O", "B-PERSON", "I-PERSON", "B-ADDRESS", "I-ADDRESS", "B-SECRET", "I-SECRET"]
scope = {"random": random, "hashlib": hashlib, "SEED": 42, "LABEL2ID": dict(zip(labels, range(len(labels))))}
exec(compile(functions, str(SOURCE), "exec"), scope)

class NotebookDataTests(unittest.TestCase):
    def make_splits(self):
        return {name: scope["demo_split"](name, count) for name, count in [("train", 2400), ("validation", 400), ("test", 400)]}

    def test_full_demo_has_valid_labels_and_disjoint_groups(self):
        splits = self.make_splits()
        scope["validate_splits"](splits)
        self.assertEqual(sum(map(len, splits.values())), 3200)
        for name, rows in splits.items():
            self.assertEqual(sum(all(label == "O" for label in row["labels"]) for row in rows), len(rows) // 4, name)

    def test_duplicate_text_across_splits_is_rejected(self):
        splits = self.make_splits()
        splits["test"].append(splits["train"][0].copy())
        with self.assertRaisesRegex(AssertionError, "Duplicate text"):
            scope["validate_splits"](splits)

    def test_invalid_bio_is_rejected(self):
        splits = self.make_splits()
        splits["train"][0] = {"tokens": ["Example"], "labels": ["I-PERSON"]}
        with self.assertRaisesRegex(AssertionError, "BIO continuation"):
            scope["validate_splits"](splits)

    def test_notebook_cells_are_python_and_match_source(self):
        notebook = json.loads(SOURCE.with_name("kaggle-train-promptprivacy.ipynb").read_text(encoding="utf-8"))
        self.assertEqual(notebook["nbformat"], 4)
        cells = ["".join(cell["source"]) for cell in notebook["cells"] if cell["cell_type"] == "code"]
        for cell in cells:
            if not cell.startswith("%pip"): ast.parse(cell)
        self.assertTrue(any('quantize_dynamic(' in cell for cell in cells))
        chunks = SOURCE.read_text(encoding="utf-8").split("# %% ")[1:]
        for chunk in chunks:
            code = chunk.split("\n", 1)[1]
            self.assertIn(code, cells)

if __name__ == "__main__": unittest.main()
