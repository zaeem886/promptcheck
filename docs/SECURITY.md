# Security analysis

## Threat model and privacy boundary

PromptPrivacy helps a cooperative user notice accidental disclosure of supported patterns. It trusts the local browser, installed extension package, and OS, while treating drafts, files, and keywords as untrusted input. A format match does not verify an identity or working credential.

ChatGPT, Claude, and Gemini can read their editors before warnings appear and transmit text independently. The extension does not intercept traffic or enforce upload policy. It cannot defend against a malicious host page, compromised browser, other extensions, screen capture, local malware, or a user choosing to share. A page can remove or obscure the advisory. The file workflow offers a separate local review before manual attachment.

Runtime processing stays on device. Drafts, the current paste snapshot, and extracted text live in ordinary JS memory. Documents remain selected until cleared or closed. The file extraction worker terminates on completion, cancellation, timeout, or replacement. The model worker cancels individual jobs and reuses its model session. The scanner page forwards extracted text in memory to the internal model port. Only keyword preferences persist. Entering a secret as a keyword stores it locally, as explained in settings. Shared profiles may expose those preferences. The chat advisory shows full values when details are expanded and nearby text when a value is selected. The document scanner displays full values on the extension page.

The UI renders source values and excerpt context as plain text. Parser errors map to fixed messages because raw errors may contain source text. The pure detector has no storage, logs, network, DOM, or Chrome API dependencies. CSP confines extension resource loads to the extension. WebAssembly compilation enables local inference. PDF.js disables evaluation of PDF code.

Large pastes can become site-managed Pasted text attachments, leaving no editor draft to inspect. A paste-event scan captures the plain text directed at the supported editor before conversion. The last-paste review keeps the scanned text in memory so findings can open at their original positions. The snapshot may outlive attachment removal or edits. It clears on an observed send action, dismissal, a replacement paste, keyword changes, or page unload. Send actions can be rejected or fail later. Unknown send controls or signals may require manual dismissal. More than 2,000,000 characters yields partial coverage. Main-thread scanning can add paste latency, and other handlers may run earlier.

The advisory mounts after the full composer and starts with the details collapsed. Dismissal suppresses the unchanged draft until an edit, paste, or preference change. Passive click, submit, and keydown observers allow normal site handling. Keyboard cleanup requires a cleared draft or response-start signal. Shift+Enter, IME, and normal newline edits retain review. A pending keyboard check may hold the current draft in page memory for at most two seconds. Draft values remain transient JS state. Layout and send semantics are DOM heuristics and cannot verify the website's network activity.

## Measured results

Run `npm run evaluate`; `npm run check` additionally runs the full build/test/browser suite. [evaluation.md](../artifacts/evaluation.md) and [evaluation.json](../artifacts/evaluation.json) contain actual environment, timings, memory samples, and all case scores.

| Workflow | TP | FP | FN | Precision | Recall |
| --- | ---: | ---: | ---: | ---: | ---: |
| 104 rule-only synthetic prompts | 79 | 2 | 1 | 97.5% | 98.8% |
| 24 documents, end-to-end | 14 | 0 | 5 | 100% | 73.7% |

Prompt matching requires category and exact start/end span. Document matching consumes exact category/value pairs one to one, so repeated values require repeated detections. Expected labels are independent of detector output. All 24 expected document statuses pass. Partial/unsupported inputs retain known unavailable ground-truth findings as false negatives: five document misses intentionally exercise no text layers, unsupported extraction, or omitted page/text-limit suffixes. Unreadable inputs with no known findings contribute status cases only, not true negatives.

The rule detector supports explicit international phones through bundled country metadata, checksum-checked cards and IBANs, and common labeled personal fields. Country metadata and checksums identify supported formats. They cannot establish ownership or whether a value is confidential. Local numbers generally need a field label, with legacy Pakistani mobile support retained. Labeled identity fields use broad shapes. Plain field values stop at a newline, semicolon, pipe, or next known label. Quoted values can span lines. This can include extra prose or omit continuation lines. Free-form confidential prose, obfuscated values, arbitrary unlabelled passwords, and unsupported credential schemes can be missed. User keywords provide additional literal matches.

This is a small, repetitive, synthetic corpus, not a real-world accuracy estimate. Vector-only PDF pages stand in for absent text layers, rather than photographic scan fixtures. Their conceptual unavailable labels are explicitly identified in ground truth; no OCR is claimed. The encrypted-PDF fixture uses a synthetic encryption dictionary to exercise password rejection, not successful encrypted extraction.

On the separate 96-prompt development benchmark, the hybrid system returned 58 correct findings, six false alarms and 18 misses. Rules alone returned 48 correct findings, zero false alarms and 28 misses. ML can catch contextual values that the rules miss and can also misclassify ordinary text. The 0.98 cutoff controls which candidates are displayed. The score is uncalibrated.

## Performance measurements and limits

Node uses high-resolution `performance.now()` and `process.memoryUsage()` before/after each case with GC requested first. RSS samples and heap deltas are not peak allocation. Parser modules contribute baseline memory even in prompt tests. Document timing excludes disk reads and browser worker startup; prompt timing excludes the 300 ms debounce. A single sequential run mixes cold/warm scans, limiting repeatability of small timing differences.

[browser-results.json](../artifacts/browser-results.json) records actual Chrome version, per-document and warning elapsed times, and coarse `performance.memory` snapshots for scanner/editor pages. Elapsed time includes Playwright overhead, result polling, debounce, file reads, and worker creation. Snapshots may share renderer/isolate accounting and exclude worker/process peaks. Browser peak memory and isolated extension overhead are explicitly unavailable. They are not directly comparable with Node detector CPU time.

The Chrome/Brave harness loads the production unpacked package in a fresh profile, scans with real workers, and fulfills local editor fixtures at all three supported origins without contacting AI services. It records zero attempted HTTP(S) requests and no page errors in tested paths. This does not prove every parser branch is network-free or include browser background traffic. The timeout test uses a deterministic hung-worker test double, without production test hooks; it does not bound every malicious input.

The Claude/Gemini fixtures cover per-site warnings, shared keywords, normal sending, textarea fallbacks, SPA replacement, large-paste conversion, and missing composers. Tests leave historical editors, Claude artifacts, Gemini's clipboard buffer, and unrelated fields on the page and assert they are not scanned. Additional geometric checks use nested editor grids/flex rows and desktop/mobile widths to detect overlay regressions. Send, form-submit, Enter, attachment-only send, dismissal, Shift+Enter, newline mode, and IME are exercised across providers. Claude's unmarked ProseMirror fallback is heuristic; ambiguous candidates fail closed until focused. Exact-origin tests reject unrelated/lookalike domains. Per-site latency/memory snapshots have the same coarse measurement limits as ChatGPT.

A separate internet-dependent check in a fresh signed-out browser verified the public Gemini composer: discovery, masked synthetic email/phone warnings, provider wording, compact placement outside/below the full `input-area-v2` composer, and clearing an empty draft passed; no message was sent. See [live-sites.json](../artifacts/live-sites.json), [layout screenshot](../artifacts/gemini-live-layout.png), and [public metadata](../artifacts/site-probe.json). Claude's public URL returned browser verification, so its signed-in composer could not be tested live. No challenge bypass or account access was attempted. Development scripts are not shipped in the extension; their website traffic is separate from local runtime processing.

Default file/time/page/text limits and worker termination reduce routine stalls. A DOCX ZIP bomb or parser allocation can expand before the character cap applies. This is not a hard CPU/memory sandbox or complete exploit mitigation. Browser timer throttling can delay deadlines. Large live drafts scan on the page thread and may delay interaction. Character occupancy avoids pairwise accepted-match overlap comparisons but still uses space proportional to input length. No scan result certifies that an untrusted file is safe to open.

## Extraction and compatibility

PDF text order may differ from visual order; joining text items can split or accidentally join patterns. Blank and image-only pages conservatively reduce coverage. A mixed text/image page can appear complete within text scope, since the extension cannot reliably infer missing image information. Broken fonts, unusual encodings, hidden layers, annotations, metadata, and images are not fully analyzed. Local CMaps/fonts improve supported text extraction without OCR. DOCX covers body text, not headers, footers, comments, metadata, or images. Other-than-UTF-8 text may be rejected.

Each site's selectors, draft serialization, and layout can change independently. Separate adapters contain those assumptions. The shared scanner watches replacements without searching message text to recover a draft. Unknown layouts can yield a missing-editor diagnostic; unmarked Claude legacy editors remain the most heuristic fallback, and new artifact/history layouts may require exclusion updates. Signed-in sessions on all three services, actual Claude composer variants, native clipboard paste, keyboard/IME sending, screen readers, toolbar UI activation, and the minimum browser version remain manual checks in [MANUAL-CHECKS.md](MANUAL-CHECKS.md).

## Dependencies and lessons

Initial resolution exposed PDF.js and esbuild advisories. Both were upgraded before packaging; the final install audit reported zero known vulnerabilities. The lockfile pins tested versions and notices are bundled. An audit is a time-specific advisory check, not proof of parser security; rerun it before submission and review future upgrades.

Detection quality and extraction coverage must be reported separately: a clear result after failed extraction would hide serious misses. Generation tokens, termination, and static errors matter because stale UI or parser diagnostics can undermine an otherwise accurate engine. Finally, warning before Send cannot prevent a website from receiving a draft; that boundary is communicated explicitly.
