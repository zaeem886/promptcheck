# Pending manual verification

Automated fixture checks are recorded in `artifacts/browser-results.json`. Leave these pending until a team member performs and dates them. Use only synthetic content.

| Check | Expected outcome | Result / date / tester |
| --- | --- | --- |
| Toolbar icon after Load unpacked | Opens scanner/settings tab | Pending |
| Signed-in ChatGPT new chat | Current draft only; usable nearby warning after pause | Pending |
| Production editor variants | Accurate multiline text serialization and placement | Pending |
| OS clipboard paste | Same scan path as typing; content remains editable | Pending |
| Large OS clipboard paste converted to Pasted text chip | Separate last-paste snapshot shows masked findings even if draft is empty; dismissal works; no transmission guarantee | Pending; conversion is simulated in browser fixture |
| Edit/delete draft | Old findings immediately clear | Pending |
| Send button and Enter | Sending works with/without findings, no duplicate submission | Pending |
| IME composition | Typing remains usable and final text is scanned | Pending |
| Switch conversations / new chat | Old warning removed; replacement active editor scanned | Pending |
| Multiple/hidden editors | Visible active prompt chosen; history ignored | Pending |
| Screen reader, zoom, dark mode | Polite warning, accessible labels/focus and usable layout | Pending |
| Offline scanner | Supported file types work without external resources | Pending manual; fixture monitoring passed |
| Native picker cancel/reselect | No new scan on cancel; Clear permits same-file selection | Pending |
| Real mixed/image-only PDFs | No OCR claim; clear partial/no-text explanation | Pending |
| Real encrypted PDF/DOCX | Not scanned with static reason | Pending |
| Chrome 120 and current non-Windows Chrome | Installation, workers, advisory operate | Pending |

If ChatGPT changes, update the explicit adapter in `src/content/chatgpt.js`, rebuild, and repeat relevant checks. Do not broaden reads into conversation history to hide selector failure.
