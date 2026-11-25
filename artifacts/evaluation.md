# Measured synthetic evaluation

Generated 2026-11-25T22:03:17.117Z. Environment: win32 10.0.26200, Node v24.18.1, AMD Ryzen 7 4700U with Radeon Graphics         , 8 logical CPUs, 15.4 GiB RAM.

| Workflow | Cases | TP | FP | FN | Precision | Recall | Median ms | p95 ms | Max observed RSS MiB |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| Prompts | 104 | 79 | 2 | 1 | 0.975 | 0.988 | 0.212 | 0.871 | 89.957 |
| Documents | 24 | 14 | 0 | 5 | 1.000 | 0.737 | 2.906 | 20.304 | 100.066 |

Document statuses: 24/24 match the independent expected status. 5 labelled findings are unavailable because of unsupported extraction or partial coverage; they count as false negatives in end-to-end recall. Unreadable inputs with no known findings contribute status cases, not true negatives. Partial scans keep all successfully detected findings and include omitted labelled findings as false negatives.

One sequential cold/warm mixed run; high resolution performance.now; GC before each case. RSS sampled before/after, heap delta after minus before. Not peak allocation or browser process memory. Prompt timing excludes 300ms UI debounce. Node document timings exclude file I/O and worker startup; browser harness measures UI end-to-end separately.

The corpus is small, repetitive, synthetic, and not representative of real user data. The original labelled corpus includes obfuscated email, parenthesized phones, unlabelled order-like digits and a CNIC-shaped code literal. Current counts reflect the expanded detector; international-category regression checks are in tests/international-detector.test.mjs. Missing-text PDF fixtures use vector-only pages, not photographed documents. Their conceptual unavailable labels model information outside the text layer and are explicitly identified in document-labels.json. Actual Chrome memory is unavailable unless reported separately by the browser harness.
