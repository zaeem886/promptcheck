# Chrome integration measurements

Chrome (Chromium 158.0.8127.88), Windows, production unpacked package. Local fixtures for ChatGPT, Claude, and Gemini; not signed-in live sessions.

- PASS: Production MV3 extension loads in Chrome
- PASS: Literal keyword preferences save in local storage
- PASS: Real browser worker extraction/status/masking for 21 documents
- PASS: Document worker uses expanded categories with masked credentials and identity previews
- PASS: Document locations include every repeated occurrence, logical lines, regions, PDF pages, and batched reveal
- PASS: Replacing a scan prevents stale results
- PASS: Cancel terminates active processing
- PASS: Deadline terminates a simulated hung worker
- PASS: Configured size limit preflight
- PASS: Privacy-preserving live-scanner connection diagnostic
- PASS: Actual toolbar action reports connected, missing-editor, and disconnected states
- PASS: Live adapter reads draft only, excludes conversation history
- PASS: Typing produces masked advisory after debounce
- PASS: Normal sending remains available with findings
- PASS: Empty draft clears stale findings immediately
- PASS: Pasted text follows the same input scan path
- PASS: Editor replacement and stored literal keywords
- PASS: Live credentials are fully masked
- PASS: ChatGPT international phone, financial, password and passport findings are masked
- PASS: Clipboard review does not cancel normal paste behavior
- PASS: Work composer without an id scans existing nested paragraph/span draft only
- PASS: Work editor typing, clearing, unrelated-editor exclusion, and normal sending
- PASS: Work editor replacement, nested paste input, and connected diagnostic
- PASS: Large clipboard paste is scanned before conversion to an attachment, even with an empty draft
- PASS: ChatGPT clears paste snapshot on Send
- PASS: Paste reviews survive conversion/editor replacement, allow sending, ignore unrelated inputs, and replace older snapshots
- PASS: Clipboard scan character limit is explicitly reported as partial
- PASS: Dismiss removes the masked clipboard snapshot
- PASS: Claude: international fields use the shared detector and masked advisory
- PASS: Claude: draft scanning, masking, clearing, advisory remounting, and normal sending
- PASS: Claude: shared keywords, typing, editor replacement, and toolbar diagnostic
- PASS: Claude: large paste snapshots, unrelated-input exclusion, and SPA editor replacement
- PASS: Claude: native textarea fallback and paste remains available
- PASS: Claude: missing composer fails closed without scanning messages or helper buffers
- PASS: Claude: legacy ProseMirror composer without test id, role, or fieldset
- PASS: Claude: ambiguous composers are not scanned until a matching editor is focused
- PASS: Gemini: international fields use the shared detector and masked advisory
- PASS: Gemini: draft scanning, masking, clearing, advisory remounting, and normal sending
- PASS: Gemini: shared keywords, typing, editor replacement, and toolbar diagnostic
- PASS: Gemini: large paste snapshots, unrelated-input exclusion, and SPA editor replacement
- PASS: Gemini: native textarea fallback and paste remains available
- PASS: Gemini: missing composer fails closed without scanning messages or helper buffers
- PASS: chatgpt: compact advisory is outside and below the full composer; dismiss remains closed until draft changes
- PASS: chatgpt: Send clears the snapshot without blocking submission or re-opening stale findings
- PASS: chatgpt: Enter-send and attachment-only send clear reviews; newline and IME do not
- PASS: chatgpt: per-occurrence line/column/region updates, independent paste locations, and all repeated findings available
- PASS: claude: compact advisory is outside and below the full composer; dismiss remains closed until draft changes
- PASS: claude: Send clears the snapshot without blocking submission or re-opening stale findings
- PASS: claude: Enter-send and attachment-only send clear reviews; newline and IME do not
- PASS: claude: per-occurrence line/column/region updates, independent paste locations, and all repeated findings available
- PASS: gemini: compact advisory is outside and below the full composer; dismiss remains closed until draft changes
- PASS: gemini: Send clears the snapshot without blocking submission or re-opening stale findings
- PASS: gemini: Enter-send and attachment-only send clear reviews; newline and IME do not
- PASS: gemini: per-occurrence line/column/region updates, independent paste locations, and all repeated findings available
- PASS: Native form submit clears a paste snapshot
- PASS: Unrelated sites and lookalike domains receive no content script
- PASS: Only configured keyword preferences persisted
- PASS: No attempted runtime HTTP(S) requests or page errors in fixtures

21 real-worker/preflight document cases: median 181.25 ms, min 17.71 ms, max 318.82 ms. ChatGPT warning observations: clear: 343.84 ms; email: 628.06 ms.

| Additional site fixture | Warning latency ms | Renderer heap snapshot MiB |
|---|---:|---:|
| claude | 322.13 | 6.09 |
| gemini | 336.47 | 6.11 |

Timings include automation, typing, polling, debounce, reads, and worker startup; not isolated CPU time. Renderer JS heap snapshots: scanner 2.74 MiB, ChatGPT 18.05 MiB. Chrome performance.memory after workload; coarse renderer snapshots, may share isolate/process and exclude document workers, browser, and peak memory. Not attributable extension overhead. Worker/browser-process peak memory is unavailable.

No attempted HTTP(S) requests and no page errors observed in these scenarios. Signed-in live sites, OS clipboard paste, keyboard/IME, and screen-reader checks remain manual. Paste checks dispatch synthetic input and ClipboardEvent/DataTransfer events. Toolbar activation is automated through the browser debugging API. The optional public-page smoke check is reported separately in live-sites.json.
