# Pending manual verification

Automated Chrome/Brave fixture checks are recorded in `artifacts/browser-results.json` and `artifacts/brave-results.json`. The signed-out public Gemini smoke check passed (discovery, masked synthetic draft, clearing; no Send click), recorded in `artifacts/live-sites.json`. Claude's public page stopped at browser verification, so live Claude remains unverified. Leave the checks below pending until a team member performs and dates them. Use only synthetic content.

| Check | Expected outcome | Result / date / tester |
| --- | --- | --- |
| Toolbar icon after Load unpacked | Opens scanner/settings tab | Pending |
| Signed-in ChatGPT new chat | Current draft only; usable nearby warning after pause | Pending |
| Signed-in Claude new chat and existing conversation | Chat-input/ProseMirror composer found; history and artifacts excluded | Pending; public inspection blocked by browser verification |
| Signed-in Gemini new chat and existing conversation | Quill composer found; history and clipboard helper excluded | Pending; signed-out public smoke passed |
| Toolbar on each supported site | Correct provider name and connection state; browser site access enabled | Pending manual UI; debugging-API action tests passed |
| Production editor variants | Accurate multiline text serialization and placement | Pending |
| OS clipboard paste | Same scan path as typing; content remains editable | Pending |
| Large OS clipboard paste converted to Pasted text chip | Separate last-paste snapshot shows masked findings even if draft is empty; dismissal works; no transmission guarantee | Pending; conversion is simulated in browser fixture |
| Edit/delete draft | Old findings immediately clear | Pending |
| Send button and Enter | Sending works with/without findings, no duplicate submission | Pending |
| Send cleanup on all three sites | Draft/paste review disappears after send; next edit/paste enables review again | Pending live; click, form, Enter, and attachment-only fixture checks passed |
| Advisory outside composer at desktop/mobile widths | Compact card below full chat box, no overlay or inherited center alignment | Pending signed-in; geometry fixtures and actual public Gemini passed |
| Compact × and Masked details | Accessible dismissal, no stale reappearance for unchanged draft, details expand safely | Pending manual keyboard/screen reader; automated dismissal passed |
| IME composition | Typing remains usable and final text is scanned | Pending |
| Switch conversations / new chat | Old warning removed; replacement active editor scanned | Pending |
| Multiple/hidden editors | Visible active prompt chosen; history ignored | Pending |
| Screen reader, zoom, dark mode | Polite warning, accessible labels/focus and usable layout | Pending |
| Offline scanner | Supported file types work without external resources | Pending manual; fixture monitoring passed |
| Native picker cancel/reselect | No new scan on cancel; Clear permits same-file selection | Pending |
| Real mixed/image-only PDFs | No OCR claim; clear partial/no-text explanation | Pending |
| Real encrypted PDF/DOCX | Not scanned with static reason | Pending |
| Chrome 120 and current non-Windows Chrome | Installation, workers, advisory operate | Pending |

Repeat editing, paste, navigation, sending, and accessibility checks on all three sites. If a site changes, update its adapter in `src/content/adapters/`, rebuild, and repeat relevant checks. Use the missing-editor diagnostic and inspect only the editor's opening tag/attributes to identify new markup. Do not broaden reads into conversation history or enable all-site permissions to hide selector failure.
