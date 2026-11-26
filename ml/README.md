# Train the international PromptPrivacy model

The current notebook uses a width-64 CNN, a starting learning rate of 0.0007, a learning-rate scheduler and four-epoch early-stopping patience. Password and passport examples receive extra sampling, including quoted fields, support dialogue, tables and varied complete values. Benign documents make up approximately 25% of generated examples. Each epoch reports training-sample and validation scores, loss, learning rate and per-category validation F1.

Train this revision from the beginning. The full width-64 run is available as `promptprivacy-global (1).zip` and is the model bundled with PromptPrivacy 1.3.0. See [the trained model evaluation](../artifacts/ml-evaluation-v2/README.md) and [the combined evaluation](../README.md#verification-and-measured-results). The existing authored examples serve as a development diagnostic after their errors have been inspected. Use a separately reserved final test dataset for final evaluation.

1. In Kaggle, create a notebook and import [kaggle-train-promptprivacy.ipynb](kaggle-train-promptprivacy.ipynb). All ten code cells are self-contained. The default run needs no attached dataset or API token.
2. Enable **Internet** for the dependency install, select a **GPU** accelerator, and run the cells in order. Kaggle supplies PyTorch. To check the pipeline quickly, set `SMOKE = True` in cell 2 before running it.
3. Open the **Output** panel and download `/kaggle/working/promptprivacy-global/promptprivacy-global.zip`. The full run also writes `best-weights.pt` for further training. The quick run produces `promptprivacy-global-smoke.zip`.
4. Read `training-report.json` in the ZIP. Start with per-category precision and recall, false alarms on benign documents, and the separately authored challenge. A hit requires the correct category and both character boundaries. The 18 authored examples are a small diagnostic.

## Training coverage

The default corpus contains **100,000 training, 5,000 validation and 5,000 test documents**. It includes multilingual field captions, natural requests, multiline pastes, mixed entities, unlabeled-looking values, empty fields, order numbers and other hard negatives. Ten field-caption languages cover English, Spanish, French, German, Portuguese, Arabic, Urdu, Hindi, Chinese and Japanese. Generated documents have original-text Unicode code point offsets for every labeled span.

| Category | Source of the examples |
| --- | --- |
| International phone | National, international and E.164 formatting from libphonenumber examples with varied subscriber digits |
| Email | ASCII and Unicode mailbox names, subdomains and plus tags on example domains |
| National ID | Localized Faker identity-number providers and Pakistani CNIC shapes |
| Passport | Localized Austrian, Russian and US providers plus generic numeric and alphanumeric shapes |
| Domestic bank account | Account components from IBAN specifications plus eight domestic length ranges |
| IBAN | Registry-backed country layouts, compact and space-separated, with generated checksums |
| Payment card | Synthetic debit/credit card number shapes from Visa, Mastercard, Amex, Discover and JCB |
| PIN | Four-, five- and six-digit values with contextual labels, including localized digits |
| API key | Synthetic prefixed credentials and opaque hexadecimal keys |
| Password | Random strings, word-only passwords, punctuation and multiword passphrases |
| Person and address | Names and postal addresses from localized providers, including non-Latin scripts |

In a local generation run, the 100,000 training documents contained phone samples from **245 regions**, IBANs from **105**, domestic account examples from **111**, and national IDs from **49**. Region-specific passport providers covered three countries. The report lists actual counts by region and split, plus exact hits and support for recall by region. A country-code format can appear in a prompt written in any language. Generic passport shapes and international card networks have separate markers. Small regional test counts and errors on natural prompts matter when interpreting the scores.

The generator separates outer prompt templates by split, rejects duplicate normalized documents and avoids reusing normalized labeled values of the same category across generated splits. Validation exact-span F1 selects the checkpoint. A second validation pass selects a span-score cutoff using F0.5, which gives precision extra weight. The report shows both filtered and unfiltered scores on held-out documents and the authored examples so you can see how many findings the cutoff drops.

## Attach a larger labeled corpus

Attach a Kaggle dataset containing `train.jsonl`, `validation.jsonl` and `test.jsonl`. Set `EXTRA_DATA` in cell 2 to its directory. The loader adds these records to the generated splits and reports their scores separately. Use synthetic or appropriately authorized data. Keep records from the same source document, template family or identity group in one split.

Each line contains one document. Spans are sorted, nonoverlapping and half-open. Count Unicode code points starting at zero. The optional region is a country code or a descriptive marker.

~~~json
{"text":"Email ana@example.test today.","spans":[{"start":6,"end":22,"label":"EMAIL","region":"global"}],"group_id":"support-family-017"}
~~~

Use the class names in cell 2 and an empty spans array for benign documents. A group ID is required for each attached document. The loader rejects duplicate documents, groups shared across splits, unknown labels and invalid offsets.

## Measure browser speed

The character CNN uses original Unicode text and a small hashed character embedding. Overlapping windows supply context for long prompts. The decoder joins predictions before finding span boundaries. The export cell enforces a **2 MiB weight budget**, compares PyTorch and ONNX outputs, and writes Unicode and window-boundary fixtures.

From the project root on Windows, install the benchmark dependencies and give the harness your downloaded ZIP. The benchmark uses locally installed Chrome by default. The optional environment variable selects Brave.

~~~powershell
npm.cmd ci
npm.cmd ci --prefix ml
$env:CHROME_PATH = 'C:\Program Files\BraveSoftware\Brave-Browser\Application\brave.exe'
node ml/bench-browser.mjs "$env:USERPROFILE\Downloads\promptprivacy-global.zip"
~~~

The harness serves the model and WASM runtime on loopback and launches a fresh browser. It checks Python/browser parity before measuring cold load and warm median/p95 at 128, 1,024 and 4,096 characters. It also times the extension’s existing detector on the same input. Sub-millisecond values are limited by browser timer resolution. The runtime and weights have separate byte counts. The notebook's own latency measurements use Python CPU.

### Local pilot results

An eight-epoch CPU pilot trained on 4,000 generated documents, selected its cutoff on 400 validation documents and evaluated 400 held-out documents. At the selected cutoff of 0.95, the model returned **135 correct findings and 105 false alarms** and missed **442** labeled spans. Exact-span precision was **56.3%**, recall **23.4%**, and F1 **33.0%**. On the 18 separately authored cases it found one of 14 labeled spans and produced one false alarm. Full-scale Kaggle accuracy is still unmeasured.

The pilot's 261,326 parameters exported to **1,051,695 bytes**. In a fresh Brave browser on the development machine the single-thread WASM runtime and weights loaded in 379 ms. The separate uncompressed runtime files totaled 12,436,016 bytes. Warm model timings across 40 scans per length were:

| Characters | Median | 95th percentile |
| ---: | ---: | ---: |
| 128 | 1.6 ms | 2.7 ms |
| 1,024 | 11.4 ms | 13.9 ms |
| 4,096 | 44.6 ms | 47.6 ms |

The extension runs this export in a shared local worker. It stitches predictions through the overlapping windows and converts code point offsets to UTF-16 before merging with the rules. See [architecture and data flow](../docs/ARCHITECTURE.md).

## Source

Edit [kaggle_train.py](kaggle_train.py) and regenerate the notebook with `py ml/create_notebook.py`. Data formats come from [python-phonenumbers](https://github.com/daviddrysdale/python-phonenumbers), [Faker](https://faker.readthedocs.io/) and [schwifty](https://schwifty.readthedocs.io/en/stable/). Browser tests use [ONNX Runtime Web](https://onnxruntime.ai/docs/tutorials/web/).
