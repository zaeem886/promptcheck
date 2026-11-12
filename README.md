# PromptPrivacy

A local Data Loss Prevention prototype for the CS3002 Information Security term project. This Chrome Manifest V3 extension checks the current ChatGPT draft and user-selected documents for possible sensitive patterns. Sending, editing, and attachment stay under the user's control.

**ChatGPT can access text already typed into its editor. The advisory cannot verify when the website transmits that text.** Use the extension-owned file scanner before manually attaching a document. A clear result does not certify safety.

## Build and install

Requirements: Node.js 24+, npm, and current desktop Chrome. Installation downloads development dependencies; the built extension uses no backend or remote runtime libraries. Exact dependency versions are pinned in `package-lock.json`.

```powershell
npm.cmd ci
npm.cmd run build
npm.cmd test
npm.cmd run evaluate
npm.cmd run test:browser
npm.cmd run package
```

Use `npm` instead of `npm.cmd` outside Windows PowerShell. `npm run check` runs build, tests, evaluation, and browser checks in sequence. Committed fixtures are ready to use; `npm run fixtures` regenerates them independently of the detector. Rebuild after source changes before packaging.

1. Open `chrome://extensions` and enable **Developer mode**.
2. Choose **Load unpacked** and select this repository's **build** folder containing `manifest.json`.
3. Pin PromptPrivacy in Chrome's toolbar. Click it to open the document scanner and keyword settings.
4. Open/reload `https://chatgpt.com/`. Type synthetic data in the draft editor; warnings appear after a 300 ms pause. Sending remains available.
5. Select a document in the scanner, review masked findings, and manually attach the original file on ChatGPT only if you choose.

If no live advisory appears, reload PromptPrivacy in `chrome://extensions` (or `brave://extensions`), then refresh the ChatGPT tab. Click the toolbar icon **from that ChatGPT tab**. The scanner page now shows whether the script connected and found an editor, could not find an editor, or is not connected. The status contains no prompt text or findings. A disconnected status includes site-access and reload instructions. Typed text is never replaced with a mask; previews appear separately.

Version 1.0.2 adds the ChatGPT Work composer identified by `data-composer-markdown`, which does not have the older `prompt-textarea` id. The browser regression fixture reproduces its nested paragraph/paste span and verifies draft detection, masking, typing, clearing, replacement, paste events, and sending while excluding an unrelated textbox. Refresh ChatGPT after reloading the updated extension.

Version 1.0.3 also scans plain text from a paste event directed at the supported editor. ChatGPT may turn a large paste into a **Pasted text** attachment and empty the editor. A separate **Pasted text snapshot** preserves masked results from that event; it does not read uploaded attachments or track attachment edits, removal, or sending. It remains until dismissed, replaced by another paste in the editor, keywords change, or the page closes/reloads. Current-draft findings remain separate and clear normally. Only masked groups are retained; clipboard text is not persisted. At most 2,000,000 pasted characters are scanned, with larger pastes marked partial. Clipboard access happens only through the paste event, with no clipboard permission or polling. The warning cannot stop the website from receiving the pasted data.

Brave fixture integration is also exercised using the installed Brave executable; see [Brave results](artifacts/brave-results.md). Run it with `$env:CHROME_PATH = 'C:\Program Files\BraveSoftware\Brave-Browser\Application\brave.exe'; npm.cmd run test:browser` in PowerShell. This verifies the local fixture, not your signed-in ChatGPT tab.

The ready-to-extract distributable is [artifacts/PromptPrivacy-unpacked.zip](artifacts/PromptPrivacy-unpacked.zip). Extract and load its folder, not the ZIP. `build/` includes all runtime bundles, PDF.js worker, CMaps, standard fonts, Mammoth, versions, and licenses; `node_modules` is unnecessary at runtime. See [scanner screenshot](artifacts/scanner.png).

## Detection coverage

| Category | Exact supported coverage |
| --- | --- |
| Email | ASCII email-like addresses with a dotted domain. No deliverability check, obfuscated addresses, or internationalized email support. |
| Pakistani phone | Mobile only: `03xx1234567`, `03xx-1234567`, `03xx 1234567`, `+923xx1234567`, `+92 3xx 1234567`, `+92-3xx-1234567`, equivalent `0092` forms. One optional ASCII space/hyphen per break. No parentheses or landlines. A directly preceding order/invoice/reference/tracking label suppresses the candidate. |
| CNIC-like | `DDDDD-DDDDDDD-D`, first digit 1–7. Compact 13 digits require a directly preceding `CNIC` or `national id` label, optionally followed by `: # = -`. No spaced forms, checksum, or identity validation. |
| API-key formats | `sk-` + 20–100 ASCII alphanumerics; `sk-proj-` + 20–200 ASCII alphanumerics/underscore/hyphen; `ghp_` + exactly 36 ASCII alphanumerics; `github_pat_` + 22–255 ASCII alphanumerics/underscore; `AKIA` + exactly 16 uppercase ASCII alphanumerics; `AIza` + exactly 35 ASCII alphanumerics/underscore/hyphen. These are selected format heuristics, not complete provider validators. AWS `ASIA` and other unlisted formats are not covered. |
| Private key | Exact uppercase PEM begin markers for PRIVATE KEY, RSA, EC, DSA, OPENSSH, or ENCRYPTED PRIVATE KEY. Counts markers, not whole key bodies. Public-key markers do not match. |
| Keywords | Case-insensitive literal substrings, including punctuation; one per line, trimmed/deduplicated, maximum 100 preferences of 100 UTF-16 code units each. Regex metacharacters are escaped. No fuzzy/semantic matching. |

Format boundaries reject adjacent Unicode letters, numbers, or underscores. Overlap priority is private marker, API key, email, CNIC, phone, keyword. Within a priority, longest then earliest wins. Accepted matches never overlap. Repeated separate occurrences count individually. Overlapping occurrences of the same keyword are consumed left to right without overlap. Counts describe occurrences, not unique people or credentials.

The shared engine returns `category`, `start`, `end` (UTF-16, end exclusive), and `preview`. Both workflows use identical category counts and up to three unique masked previews. Email previews reveal one initial and mask the domain; phone/CNIC reveal only the last two digits. API/private-key previews are always `[credential hidden]`; keywords are always `[keyword hidden]`. Raw matched values are never returned by the detector. The original document remains unmodified.

## Document coverage and limits

TXT/CSV use fatal UTF-8 decoding; CSV is scanned as ordinary text. PDF.js extracts page text from PDFs. Mammoth extracts DOCX body text, including body tables. Formatting is discarded. OCR, embedded images, comments, metadata, headers/footers, encrypted extraction, automatic redaction, and automatic attachment are outside scope.

Defaults: **10 MiB**, **15 seconds** total deadline, **200 PDF pages**, **2,000,000 extracted UTF-16 code units**. In **Limits & coverage**, file size can be set to 1–25 MiB and time to 1–60 seconds for the current page session. Other defaults are configurable in `src/shared/scan.js`; limits are never persisted. The deadline includes file read and worker startup. Timeout/cancel terminates the worker; a pending `File.arrayBuffer()` cannot be aborted, but its result is ignored. Compressed documents can allocate substantial memory before limits apply; these are not hard memory quotas.

| State | Meaning |
| --- | --- |
| Findings detected | Supported extraction completed with possible patterns. |
| No supported patterns found | Supported extraction completed without matching patterns; no safety guarantee. |
| Partially scanned | Some text was scanned but page/text limits, no-text pages, or extraction warnings limited coverage. Findings from scanned text remain visible. |
| Not scanned | Unsupported, empty, oversized, encrypted, unreadable, cancelled, timed out, or no extractable text; a static reason is shown. |

Blank and image-only PDF pages both lack text, conservatively making mixed PDFs partial. A PDF with no text is Not scanned. Successful DOCX extraction is complete only within body-text scope. A page with both text and an image may appear complete within text scope; the prototype cannot reliably identify missing image content.

## Verification and measured results

**104 independently labelled synthetic prompts and 24 documents** are committed. Inputs and ground truth are separate: `fixtures/prompts.json`, `fixtures/prompt-labels.json`, `fixtures/documents/`, and `fixtures/document-labels.json`. Fixture generation never imports the detector. Some unavailable document labels are explicitly conceptual content outside a text layer.

| Workflow | TP | FP | FN | Precision | Recall |
| --- | ---: | ---: | ---: | ---: | ---: |
| Prompts | 78 | 2 | 2 | 97.5% | 97.5% |
| Documents, end to end | 14 | 0 | 5 | 100% | 73.7% |

All 24 document status expectations pass. Five unavailable findings in partial/unsupported cases count as false negatives. These are small, synthetic-corpus measurements, not deployment accuracy claims. Actual timings, RSS/heap samples, environment, method, and per-case results are in [evaluation.md](artifacts/evaluation.md) and [evaluation.json](artifacts/evaluation.json). Chrome timings and coarse memory snapshots are in [browser-results.json](artifacts/browser-results.json). Browser worker/process peak memory and isolated extension overhead are unavailable.

Node tests cover every detector, masks, literal keywords, overlaps, common false positives, UTF-16 offsets, document status/extraction, preflight limits, and production assets/permissions. Chrome tests load the production MV3 build, use real document workers, and exercise typing, synthetic paste events, clearing, editor replacement, sending, preferences, masking, stale results, cancellation, size limits, and a simulated hung worker. The harness fulfills a local editor fixture at the supported origin and blocks unexpected HTTP(S) requests; it does not contact live ChatGPT. A readable browser measurement summary is in [browser-results.md](artifacts/browser-results.md).

Browser tests require a current Chrome supporting `Extensions.loadUnpacked`; set `CHROME_PATH` if Chrome is elsewhere. The default path is `C:/Program Files/Google/Chrome/Application/chrome.exe`. Each run uses a fresh profile under `artifacts/browser-profile/`. Tested on Windows/Chrome 157. The manifest declares minimum Chrome 120, which has not been tested.

**Still manual:** signed-in live ChatGPT selectors/navigation, native clipboard paste, toolbar activation, keyboard sending/IME, screen-reader announcements, and minimum-version Chrome. See [manual checks](docs/MANUAL-CHECKS.md). Fixture success does not establish live-site compatibility.

## Architecture and submission

```text
src/content/      ChatGPT-specific editor adapter and advisory
src/scanner/      Extension-owned file/settings UI and processing worker
src/extractors/   PDF.js / Mammoth / UTF-8 adapters
src/shared/       Pure detection and scan-state logic
scripts/          Build, fixtures, evaluation, Chrome tests, ZIP
tests/            Node tests
fixtures/         Synthetic inputs and separate expected labels
artifacts/        Actual measurements, screenshot, distributable ZIP
build/            Generated self-contained extension
```

Read [architecture/data flow](docs/ARCHITECTURE.md), [security analysis](docs/SECURITY.md), and [in-class demo](docs/DEMO.md). Team members should complete any contribution statement based only on their actual work; none are prefilled.

Implementation references: Chrome's [content-script isolation](https://developer.chrome.com/docs/extensions/develop/concepts/content-scripts), the [PDF.js API](https://mozilla.github.io/pdf.js/api/draft/module-pdfjsLib.html), and Mammoth's [raw text extraction](https://github.com/mwilliamson/mammoth.js#extracting-raw-text). Third-party notices are packaged under `build/vendor/`.
