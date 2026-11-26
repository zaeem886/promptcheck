# PromptPrivacy

A local Data Loss Prevention prototype for the CS3002 Information Security term project. This Chrome Manifest V3 extension checks drafts on **ChatGPT, Claude, and Gemini**, pasted text, and user-selected documents for possible sensitive patterns. Sending, editing, and attachment stay under the user's control.

**Each AI website can access text already typed or pasted into its editor. The advisory cannot verify when the website transmits that text.** Use the extension-owned file scanner before manually attaching a document. A clear result does not certify safety.

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
4. Open/reload `https://chatgpt.com/`, `https://claude.ai/new`, or `https://gemini.google.com/app`. Type synthetic data in the draft editor; warnings appear after a 300 ms pause. Sending remains available.
5. Select a document in the scanner and review the full values and their locations. You can then attach the original file to your chosen AI chat manually.

If no live advisory appears, reload PromptPrivacy in `chrome://extensions` (or `brave://extensions`), then refresh the AI chat tab. Click the toolbar icon **from that chat tab**. The scanner page names the connected service and shows whether it found an editor, could not find an editor, or is not connected. Diagnostics include only a fixed site id and connection state, with no prompt text or findings. A disconnected status includes site-access and reload instructions. Typed text is never replaced with a mask; previews appear separately.

The compact advisory sits **below the full composer**, including its send controls, on ChatGPT, Claude, and Gemini. Category counts stay visible. Open **Finding details** to see the full values. The **×** dismisses the whole advisory until the draft changes or another paste occurs. Send-button clicks and form submissions clear the paste snapshot and current warning. A cleared draft or a new Stop control also clears it after a keyboard send. Shift+Enter, IME composition, and Enter configured as a newline preserve it. Cleanup observes local UI actions and cannot confirm transmission or send success.

Site access is restricted to these three exact HTTPS origins. On an existing installation, reload the extension, allow access to the added sites if your browser requests it, and refresh their open tabs. Version 1.1.0 introduced the separate site adapters and shared live scanner.

| Service | Allowed origin | Editor adapter | Verification |
| --- | --- | --- | --- |
| ChatGPT | `https://chatgpt.com` | Prompt id/test-id variants and Work `data-composer-markdown` composer | Chrome/Brave regression fixtures; signed-in session testing remains manual |
| Claude | `https://claude.ai` | Chat-input markers, labelled/fieldset ProseMirror, and a legacy ProseMirror fallback excluding messages/artifacts/dialogs | Chrome/Brave fixtures; live composer blocked by public browser-verification page |
| Gemini | `https://gemini.google.com` | `rich-textarea` Quill textbox and native textarea fallback, excluding clipboard helper and history | Chrome/Brave fixtures plus actual public signed-out page smoke test; no message sent |

Hidden, disabled, read-only, known history/artifact/dialog editors are excluded. Multiple equally plausible editors remain unread unless one is focused. If a site changes its markup, diagnostics can report a missing editor rather than treating another text field as the draft.

Version 1.0.2 adds the ChatGPT Work composer identified by `data-composer-markdown`, which does not have the older `prompt-textarea` id. The browser regression fixture reproduces its nested paragraph/paste span and verifies draft detection, masking, typing, clearing, replacement, paste events, and sending while excluding an unrelated textbox. Refresh ChatGPT after reloading the updated extension.

Large text pastes are scanned through the editor's paste event. A site may turn the paste into an attachment and empty the editor. The **Pasted text snapshot** keeps the scanned text and its findings in memory. It clears on observed send actions, dismissal, another paste, keyword changes, or page reload/close. Draft and paste counts describe separate sources. At most 2,000,000 pasted characters are scanned, with larger pastes marked partial. Clipboard access happens only through the paste event. The warning cannot stop the website from receiving pasted data.

Brave fixture integration is also exercised using the installed Brave executable; see [Brave results](artifacts/brave-results.md). Run it with `$env:CHROME_PATH = 'C:\Program Files\BraveSoftware\Brave-Browser\Application\brave.exe'; npm.cmd run test:browser` in PowerShell. This verifies local fixtures, not your signed-in tabs.

The ready-to-extract distributable is [artifacts/PromptPrivacy-unpacked.zip](artifacts/PromptPrivacy-unpacked.zip). Extract and load its folder, not the ZIP. `build/` includes all runtime bundles, PDF.js worker, CMaps, standard fonts, Mammoth, versions, and licenses; `node_modules` is unnecessary at runtime. See [scanner screenshot](artifacts/scanner.png).

## Rules and machine learning

The extension scans drafts, paste snapshots, and extracted document text with both rules and the trained character model. Rules appear first. The model reads the same original text in a background worker and adds findings that fall outside the rules' spans. If both engines agree on the category and exact span, the advisory counts one finding. Expand **Finding details** to see **Rules**, **ML**, or **Rules + ML** beside each location.

Try typing the synthetic sentence below. The phone should appear once with **Rules + ML**, and the address should appear with **ML**.

> If the courier gets lost, ring +1 (202) 555-0198. Ship the replacement to 14 River Walk, Dublin D02 XY76.

The build uses the width-64 model from `ml/promptprivacy-global (1).zip` with its saved 0.98 confidence cutoff. ONNX Runtime and the model ship in the extension ZIP. The worker starts on the first model scan and reuses its loaded session. Live drafts and pastes check up to 2,000,000 characters with a five-second ML deadline. The document deadline covers reading, extraction, and both checks. If the model cannot finish, users see the rule findings and a partial status.

In version **1.4.0**, click a value in **Finding details** to open a highlighted excerpt at its exact position in the draft or last paste. This also works when the chatbot has turned the paste into an attachment. Each repeated value opens its own location. Document scans show full values alongside extraction locations and PDF page numbers where available.

Scroll inside the findings list or press **Tab** to focus it and use the arrow keys, **Home**, or **End**. Scrolling the chat to its bottom moves the open list to the last displayed finding. Model updates preserve the reading position and the rows already revealed with **Show more**.

## Detection coverage

| Category | Supported coverage |
| --- | --- |
| Email | ASCII and Unicode email-like addresses with dotted domains. |
| International phone | Explicit +country-code and 00-country-code numbers checked against bundled libphonenumber country metadata. Spaces, parentheses, hyphens, extensions and localized BMP decimal digits are supported. National numbers with a phone/mobile/tel/fax label are identified by shape and length. Existing Pakistani mobile formats remain supported without a label. |
| Financial | Major payment-card issuer shapes with Luhn checks, IBAN country layouts with checksums, labeled bank accounts, routing/sort codes, IFSC and SWIFT/BIC. |
| Identity | Existing CNIC formats, US SSN shapes with excluded impossible groups, labeled national/tax IDs, passports and driving licences. Local identity formats are broad labeled heuristics. |
| Credentials | OpenAI, Anthropic, GitHub, GitLab, Google, AWS, Stripe, Slack, npm and SendGrid token shapes; JWT and Bearer/Basic authentication; PEM private-key markers and SSH key material. Labeled API/client secrets, passwords, passphrases, session cookies/tokens, PINs, CVV/CVC, OTPs and recovery codes; passwords in connection URLs. |
| Personal fields | Labeled names, postal addresses, dates of birth, medical/insurance identifiers and diagnoses, GPS coordinates, IP addresses and cryptocurrency wallets. |
| Keywords | Case-insensitive literal substrings, one per line, up to 100 saved phrases of 100 UTF-16 code units each. |

Field rules support English labels and selected translated labels, quoted JSON values, environment assignments, and colon/equal/is/arrow separators. Plain values end at a newline, semicolon, pipe or recognized next field. Quoted values can span lines. A label can identify a shape even when its format or identity cannot be verified. Explicit order, invoice, reference, tracking, SKU and ticket labels suppress unlabelled phone/card candidates.

Ambiguous national phone numbers need a field label because their country cannot be reliably inferred from digits alone. Regional metadata and checksums verify supported structure. Actual ownership, deliverability, account status and confidentiality require context. Free-form names, addresses, medical prose, obfuscation, images and every country's identity format remain outside comprehensive rule coverage. No detector can guarantee identification of every private statement.

Findings retain their original UTF-16 start/end offsets and line/column/region locations. Labeled fields outrank generic shapes, except specific location fields outrank the generic address label. Within a priority, longest then earliest wins. Accepted matches never overlap. Keywords use the original text after other categories.

The detector returns masked previews and source locations. The interfaces use the original spans to display full values in the expanded chat findings and document scan results. All runtime dependencies and country metadata are bundled locally.

## Document coverage and limits

TXT/CSV use fatal UTF-8 decoding; CSV is scanned as ordinary text. PDF.js extracts page text from PDFs. Mammoth extracts DOCX body text, including body tables. Formatting is discarded. OCR, embedded images, comments, metadata, headers/footers, encrypted extraction, automatic redaction, and automatic attachment are outside scope.

Defaults: **10 MiB**, **15 seconds** total deadline, **200 PDF pages**, **2,000,000 extracted UTF-16 code units**. In **Limits & coverage**, file size can be set to 1–25 MiB and time to 1–60 seconds for the current page session. Other defaults are configurable in `src/shared/scan.js`; limits are never persisted. The deadline includes file read and worker startup. Timeout/cancel terminates the worker; a pending `File.arrayBuffer()` cannot be aborted, but its result is ignored. Compressed documents can allocate substantial memory before limits apply; these are not hard memory quotas.

| State | Meaning |
| --- | --- |
| Findings detected | Supported extraction completed with possible patterns. |
| No supported patterns found | Supported extraction completed without matching patterns; no safety guarantee. |
| Partially scanned | Extraction had limited coverage or the ML check could not finish. Available findings remain visible. |
| Not scanned | Unsupported, empty, oversized, encrypted, unreadable, cancelled, timed out, or no extractable text; a static reason is shown. |

Blank and image-only PDF pages both lack text, conservatively making mixed PDFs partial. A PDF with no text is Not scanned. Successful DOCX extraction is complete only within body-text scope. A page with both text and an image may appear complete within text scope; the prototype cannot reliably identify missing image content.

## Verification and measured results

The rule detector benchmark uses **104 independently labelled synthetic prompts and 24 documents**. Inputs and ground truth are separate: `fixtures/prompts.json`, `fixtures/prompt-labels.json`, `fixtures/documents/`, and `fixtures/document-labels.json`. Fixture generation never imports the detector. Some unavailable document labels are explicitly conceptual content outside a text layer.

| Workflow | TP | FP | FN | Precision | Recall |
| --- | ---: | ---: | ---: | ---: | ---: |
| Prompts | 79 | 2 | 1 | 97.5% | 98.8% |
| Documents, end to end | 14 | 0 | 5 | 100% | 73.7% |

All 24 document status expectations pass. Five unavailable findings in partial/unsupported cases count as false negatives. These are small, synthetic-corpus measurements, not deployment accuracy claims. Actual timings, RSS/heap samples, environment, method, and per-case results are in [evaluation.md](artifacts/evaluation.md) and [evaluation.json](artifacts/evaluation.json). Chrome timings and coarse memory snapshots are in [browser-results.json](artifacts/browser-results.json). Browser worker/process peak memory and isolated extension overhead are unavailable.

Browser tests run the unpacked extension on the same 96 synthetic prompts used to compare model versions. A correct finding requires both the category and exact character boundaries.

| Scanner | Correct | Incorrect | Missed | Precision | Recall | F1 |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| Rules | 48 | 0 | 28 | 100.0% | 63.2% | 77.4% |
| ML | 44 | 9 | 32 | 83.0% | 57.9% | 68.2% |
| Rules + ML | 58 | 6 | 18 | 90.6% | 76.3% | 82.9% |

The combined scan adds ten correct findings and six false alarms on this development benchmark. Browser reports include the scores and model round-trip timings.

International detector tests check mobile examples in both E.164 and formatted form for all 245 bundled regions, plus financial checksums, localized digits, contextual fields and exact masking. Node tests cover every detector, masks, literal keywords, overlaps, common false positives, UTF-16 offsets, document status/extraction, preflight limits, exact-origin selection, lookalike hosts, and production assets/permissions. Browser tests exercise all three sites' drafts, paste events, editor replacement, keywords, diagnostics, and real file workers. Layout regressions reproduce an editable grid and textarea flex row, asserting that the advisory sits outside/below the full composer at desktop and mobile widths. Lifecycle tests cover × dismissal, no stale reappearance, send-button/form/keyboard cleanup (including attachment-only sends), Shift+Enter, IME, and Enter-as-newline. They also cover textarea fallbacks, history/artifact/clipboard exclusion, ambiguous Claude editors, cancellation, limits, and hung workers. Fixtures block unexpected HTTP(S) requests without contacting live services. Results, per-site latency, and memory snapshots are in [browser-results.md](artifacts/browser-results.md) and [Brave results](artifacts/brave-results.md).

The separate, optional `npm run probe:sites` checks public Claude/Gemini editor metadata without typing. `npm run test:live` loads the build on public Gemini in a fresh signed-out browser, types synthetic email/phone data, checks masked findings, then clears the draft without clicking Send. These development commands need internet access; the sites can read the synthetic draft. They do not run as part of the offline fixture suite or ship in the extension. Actual observations are in [site-probe.json](artifacts/site-probe.json) and [live-sites.json](artifacts/live-sites.json), with a [Gemini advisory screenshot](artifacts/gemini-live-advisory.png). Claude's browser-verification page was left untouched, so no live Claude composer is claimed as tested.

Browser tests require a current Chrome supporting `Extensions.loadUnpacked`; set `CHROME_PATH` if Chrome is elsewhere. The default path is `C:/Program Files/Google/Chrome/Application/chrome.exe`. Each run uses a fresh profile under `artifacts/browser-profile/`. Tested on Windows/Chrome 157. The manifest declares minimum Chrome 120, which has not been tested.

**Still manual:** signed-in live sessions and navigation on all three services, actual Claude composer variants, native clipboard paste, toolbar UI activation, keyboard sending/IME, screen-reader announcements, and minimum-version Chrome. See [manual checks](docs/MANUAL-CHECKS.md). Fixture success and a signed-out smoke check do not establish every signed-in layout's compatibility.

## Architecture and submission

The [international ML training notebook and instructions](ml/README.md) cover dataset generation, Kaggle training, exact-span evaluation and browser timing. The build verifies the selected bundle's model hash and packages its weights and label configuration.

```text
src/content/      Shared live scanner and exact-origin entrypoint
src/content/adapters/  Separate ChatGPT, Claude, and Gemini editor adapters
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
