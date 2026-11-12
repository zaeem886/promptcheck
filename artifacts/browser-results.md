# Chrome integration measurements

Chrome (Chromium 157.0.8103.51), Windows, production unpacked package, synthetic local editor fixture.

- PASS: Production MV3 extension loads in Chrome
- PASS: Literal keyword preferences save in local storage
- PASS: Real browser worker extraction/status/masking for 21 documents
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
- PASS: Clipboard review does not cancel normal paste behavior
- PASS: Work composer without an id scans existing nested paragraph/span draft only
- PASS: Work editor typing, clearing, unrelated-editor exclusion, and normal sending
- PASS: Work editor replacement, nested paste input, and connected diagnostic
- PASS: Large clipboard paste is scanned before conversion to an attachment, even with an empty draft
- PASS: Paste reviews survive conversion/editor replacement, allow sending, ignore unrelated inputs, and replace older snapshots
- PASS: Clipboard scan character limit is explicitly reported as partial
- PASS: Dismiss removes the masked clipboard snapshot
- PASS: Only configured keyword preferences persisted
- PASS: No attempted runtime HTTP(S) requests or page errors in fixtures

21 real-worker/preflight document cases: median 166.89 ms, min 13.60 ms, max 285.57 ms. Prompt end-to-end observations: clear: 329.76 ms; email: 660.65 ms. Includes automation, typing, polling, debounce, reads, and worker startup; not isolated CPU time.

Renderer JS heap snapshots: scanner 7.10 MiB, editor 15.42 MiB. Chrome performance.memory after workload; coarse renderer snapshots, may share isolate/process and exclude document workers, browser, and peak memory. Not attributable extension overhead. Worker/browser-process peak memory is unavailable.

No attempted HTTP(S) requests and no page errors observed in these scenarios. Live signed-in ChatGPT, OS clipboard paste, keyboard/IME, and screen-reader checks remain manual. The paste check dispatches a synthetic insertFromPaste input event. Toolbar activation is automated through the browser debugging API.
