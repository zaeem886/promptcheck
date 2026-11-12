# Security analysis

## Threat model and privacy boundary

PromptPrivacy helps a cooperative user notice accidental disclosure of supported patterns. It trusts the local browser, installed extension package, and OS, while treating drafts, files, and keywords as untrusted input. A format match does not verify an identity or working credential.

ChatGPT can read its editor before the warning appears and transmit text independently. The extension does not intercept traffic or enforce upload policy. It cannot defend against a malicious host page, compromised browser, other extensions, screen capture, local malware, or a user choosing to share. A page can remove or obscure the advisory. The file workflow offers a separate local review before manual attachment.

Runtime processing stays on device. Drafts and extracted text live in ordinary JS memory; documents remain selected until cleared/closed. Workers terminate after completion/cancel/timeout/replacement, and GC reclaims memory eventually. No forensic erasure is promised. Only keyword preferences persist; entering a secret as a keyword deliberately stores it locally, as explained in settings. Shared profiles may expose those preferences. The host page may observe masked categories/counts in the advisory DOM; the warning is not confidential from the site.

UI uses `textContent`/`replaceChildren`, never document HTML, eval, or unescaped keyword regex. Credentials/private markers and keywords are fully hidden. Parser errors map to fixed messages because raw errors may contain source text. The pure detector has no storage, logs, network, DOM, or Chrome API dependencies. CSP permits packaged scripts and workers only; PDF evaluation is disabled.

Large pastes can become site-managed Pasted text attachments, leaving no editor draft to inspect. A paste-event scan now provides a separate masked snapshot before that conversion. Only plain text from a paste directed at the supported editor is processed, without clipboard polling/permissions or attachment inspection. The snapshot may outlive attachment removal, edits, or sending, so it is explicitly labelled as historical last-paste content with a dismiss control. It never claims the current attachment was inspected. Raw clipboard text is not retained after synchronous detection; only masked groups and a partial flag remain in page memory. More than 2,000,000 characters yields partial coverage. Scanning is on the content-script thread and can add paste latency, particularly with many matches/keywords. Other paste handlers may run earlier, so the extension offers no transmission prevention guarantee.

## Measured results

Run `npm run evaluate`; `npm run check` additionally runs the full build/test/browser suite. [evaluation.md](../artifacts/evaluation.md) and [evaluation.json](../artifacts/evaluation.json) contain actual environment, timings, memory samples, and all case scores.

| Workflow | TP | FP | FN | Precision | Recall |
| --- | ---: | ---: | ---: | ---: | ---: |
| 104 synthetic prompts | 78 | 2 | 2 | 97.5% | 97.5% |
| 24 documents, end-to-end | 14 | 0 | 5 | 100% | 73.7% |

Prompt matching requires category and exact start/end span. Document matching consumes exact category/value pairs one to one, so repeated values require repeated detections. Expected labels are independent of detector output. All 24 expected document statuses pass. Partial/unsupported inputs retain known unavailable ground-truth findings as false negatives: five document misses intentionally exercise no text layers, unsupported extraction, or omitted page/text-limit suffixes. Unreadable inputs with no known findings contribute status cases only, not true negatives.

Two prompt misses cover parenthesized phones and obfuscated email. Two false alarms cover an unlabelled order-like mobile number and a CNIC-shaped code literal. Nearby order/invoice/reference/tracking labels reduce some false alarms but may suppress true phones in misleading context. Requiring a label for compact CNIC reduces numeric false alarms but misses unlabelled identities. ASCII/boundary choices miss internationalized addresses and some punctuation variants. Credential formats evolve; unlisted keys are missed and random strings matching covered shapes can trigger alarms. Arbitrary passwords, private prose, encoded secrets, and context-specific information are not detected without suitable keywords.

This is a small, repetitive, synthetic corpus, not a real-world accuracy estimate. Vector-only PDF pages stand in for absent text layers, rather than photographic scan fixtures. Their conceptual unavailable labels are explicitly identified in ground truth; no OCR is claimed. The encrypted-PDF fixture uses a synthetic encryption dictionary to exercise password rejection, not successful encrypted extraction.

## Performance measurements and limits

Node uses high-resolution `performance.now()` and `process.memoryUsage()` before/after each case with GC requested first. RSS samples and heap deltas are not peak allocation. Parser modules contribute baseline memory even in prompt tests. Document timing excludes disk reads and browser worker startup; prompt timing excludes the 300 ms debounce. A single sequential run mixes cold/warm scans, limiting repeatability of small timing differences.

[browser-results.json](../artifacts/browser-results.json) records actual Chrome version, per-document and warning elapsed times, and coarse `performance.memory` snapshots for scanner/editor pages. Elapsed time includes Playwright overhead, result polling, debounce, file reads, and worker creation. Snapshots may share renderer/isolate accounting and exclude worker/process peaks. Browser peak memory and isolated extension overhead are explicitly unavailable. They are not directly comparable with Node detector CPU time.

The Chrome harness loads the production unpacked package in a fresh profile, scans with real workers, and fulfills an editor fixture at the supported origin without contacting ChatGPT. It records zero attempted HTTP(S) requests and no page errors in tested paths. This does not prove every parser branch is network-free or include browser background traffic. The timeout test uses a deterministic hung-worker test double, without production test hooks; it does not bound every malicious input.

Default file/time/page/text limits and worker termination reduce routine stalls. A DOCX ZIP bomb or parser allocation can expand before the character cap applies. This is not a hard CPU/memory sandbox or complete exploit mitigation. Browser timer throttling can delay deadlines. Large live drafts scan on the page thread and may delay interaction. Character occupancy avoids pairwise accepted-match overlap comparisons but still uses space proportional to input length. No scan result certifies that an untrusted file is safe to open.

## Extraction and compatibility

PDF text order may differ from visual order; joining text items can split or accidentally join patterns. Blank and image-only pages conservatively reduce coverage. A mixed text/image page can appear complete within text scope, since the extension cannot reliably infer missing image information. Broken fonts, unusual encodings, hidden layers, annotations, metadata, and images are not fully analyzed. Local CMaps/fonts improve supported text extraction without OCR. DOCX covers body text, not headers, footers, comments, metadata, or images. Other-than-UTF-8 text may be rejected.

ChatGPT selectors, draft serialization, and layout can change. The adapter watches replacements but does not widen reads into conversation history when discovery fails. Signed-in production ChatGPT, native clipboard paste, keyboard/IME sending, screen readers, toolbar activation, and the declared minimum browser version remain manual checks in [MANUAL-CHECKS.md](MANUAL-CHECKS.md).

## Dependencies and lessons

Initial resolution exposed PDF.js and esbuild advisories. Both were upgraded before packaging; the final install audit reported zero known vulnerabilities. The lockfile pins tested versions and notices are bundled. An audit is a time-specific advisory check, not proof of parser security; rerun it before submission and review future upgrades.

Detection quality and extraction coverage must be reported separately: a clear result after failed extraction would hide serious misses. Generation tokens, termination, and static errors matter because stale UI or parser diagnostics can undermine an otherwise accurate engine. Finally, warning before Send cannot prevent a website from receiving a draft; that boundary is communicated explicitly.
