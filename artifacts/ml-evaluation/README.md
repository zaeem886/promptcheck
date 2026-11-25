# Exported model evaluation

Model SHA256 d9b940a91f57ecda70e424f3197d25e4be8bc79abb3dfb5069c1bd77a2b0dc42. Fixed supplied cutoff 0.98.
All 5 reference fixtures passed with the supplied ONNX weights.

The fresh challenge contains 96 independently authored synthetic documents. Correct category and exact character boundaries are required.
Each category has five values in natural requests and one field-style record. Four long documents exercise all windows.
Regional formats are illustrative. This small challenge cannot establish accuracy in every country or language.

| Category | Precision | Recall | F1 | TP | FP | FN |
|---|---:|---:|---:|---:|---:|---:|
| Overall | 73.2% | 53.9% | 62.1% | 41 | 15 | 35 |
| PERSON | 50.0% | 33.3% | 40.0% | 2 | 2 | 4 |
| ADDRESS | 80.0% | 66.7% | 72.7% | 4 | 1 | 2 |
| PHONE | 85.7% | 85.7% | 85.7% | 6 | 1 | 1 |
| EMAIL | 57.1% | 57.1% | 57.1% | 4 | 3 | 3 |
| NATIONAL_ID | 75.0% | 50.0% | 60.0% | 3 | 1 | 3 |
| PASSPORT | 33.3% | 16.7% | 22.2% | 1 | 2 | 5 |
| BANK_ACCOUNT | 85.7% | 100.0% | 92.3% | 6 | 1 | 0 |
| IBAN | 100.0% | 100.0% | 100.0% | 6 | 0 | 0 |
| PAYMENT_CARD | 100.0% | 71.4% | 83.3% | 5 | 0 | 2 |
| API_KEY | 50.0% | 33.3% | 40.0% | 2 | 2 | 4 |
| PASSWORD | 0.0% | 0.0% | 0.0% | 0 | 2 | 7 |
| PIN | 100.0% | 33.3% | 50.0% | 2 | 0 | 4 |

Benign documents with false alarms 1/20.

The ZIP's saved 5,000-document test report is a separate benchmark. The original test documents are absent from the ZIP.
Fresh inputs and predictions are in results.json. The model and cutoff were fixed throughout evaluation.

Reproduce with numpy and onnxruntime installed by running python ml/evaluate_model.py.
