# Measured synthetic evaluation

Generated 2026-11-12T22:19:14.118Z. Environment: win32 10.0.26200, Node v24.18.1, AMD Ryzen 7 4700U with Radeon Graphics         , 8 logical CPUs, 15.4 GiB RAM.

| Workflow | Cases | TP | FP | FN | Precision | Recall | Median ms | p95 ms | Max observed RSS MiB |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| Prompts | 104 | 78 | 2 | 2 | 0.975 | 0.975 | 0.078 | 0.322 | 81.418 |
| Documents | 24 | 14 | 0 | 5 | 1.000 | 0.737 | 0.731 | 10.003 | 91.844 |

Document statuses: 24/24 match the independent expected status. 5 labelled findings are unavailable because of unsupported extraction or partial coverage; they count as false negatives in end-to-end recall. Unreadable inputs with no known findings contribute status cases, not true negatives. Partial scans keep all successfully detected findings and include omitted labelled findings as false negatives.

One sequential cold/warm mixed run; high resolution performance.now; GC before each case. RSS sampled before/after, heap delta after minus before. Not peak allocation or browser process memory. Prompt timing excludes 300ms UI debounce. Node document timings exclude file I/O and worker startup; browser harness measures UI end-to-end separately.

The corpus is small, repetitive, synthetic, and not representative of real user data. Two deliberate prompt misses cover obfuscated email and parenthesized phone; two deliberate false alarms cover unlabelled order-like phone digits and a CNIC-shaped code literal. Missing-text PDF fixtures use vector-only pages, not photographed documents. Their conceptual unavailable labels model information outside the text layer and are explicitly identified in document-labels.json. Actual Chrome memory is unavailable unless reported separately by the browser harness.
