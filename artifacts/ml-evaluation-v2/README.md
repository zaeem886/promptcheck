# Exported model evaluation

Model SHA256 d50fc514f24876438c882c84382390055b9ee09a4166cf34588860b9b0d4cd8b. Fixed supplied cutoff 0.98.
All 5 reference fixtures passed with the supplied ONNX weights.

The fixed challenge contains 96 independently authored synthetic documents. Correct category and exact character boundaries are required.
Each category has five values in natural requests and one field-style record. Four long documents exercise all windows.
Regional formats are illustrative. This small challenge cannot establish accuracy in every country or language.

| Category | Precision | Recall | F1 | TP | FP | FN |
|---|---:|---:|---:|---:|---:|---:|
| Overall | 83.0% | 57.9% | 68.2% | 44 | 9 | 32 |
| PERSON | 100.0% | 16.7% | 28.6% | 1 | 0 | 5 |
| ADDRESS | 80.0% | 66.7% | 72.7% | 4 | 1 | 2 |
| PHONE | 100.0% | 100.0% | 100.0% | 7 | 0 | 0 |
| EMAIL | 85.7% | 85.7% | 85.7% | 6 | 1 | 1 |
| NATIONAL_ID | 0.0% | 0.0% | 0.0% | 0 | 0 | 6 |
| PASSPORT | 50.0% | 16.7% | 25.0% | 1 | 1 | 5 |
| BANK_ACCOUNT | 100.0% | 83.3% | 90.9% | 5 | 0 | 1 |
| IBAN | 100.0% | 83.3% | 90.9% | 5 | 0 | 1 |
| PAYMENT_CARD | 100.0% | 100.0% | 100.0% | 7 | 0 | 0 |
| API_KEY | 66.7% | 33.3% | 44.4% | 2 | 1 | 4 |
| PASSWORD | 37.5% | 42.9% | 40.0% | 3 | 5 | 4 |
| PIN | 100.0% | 50.0% | 66.7% | 3 | 0 | 3 |

Benign documents with false alarms 1/20.

The ZIP's saved 5,000-document test report is a separate benchmark. The original test documents are absent from the ZIP.
Inputs and predictions are in results.json. The model and cutoff were fixed throughout evaluation.
These challenge examples have been used to inspect earlier models and serve as a development benchmark.

Evaluated bundle: promptprivacy-global (1).zip.

Reproduce with numpy and onnxruntime installed: python ml/evaluate_model.py "ml\promptprivacy-global (1).zip" --output "artifacts\ml-evaluation-v2"
