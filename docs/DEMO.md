# In-class demo (about five minutes)

Use synthetic data only. Build, load `build/` in Chrome, pin PromptPrivacy, and reload ChatGPT. Keep the scanner page and `fixtures/documents/` ready. If sign-in or live access is unavailable, show automated local-fixture results as an explicitly labelled fallback, not as live-site verification.

1. **Boundary (30 s):** explain local advisory DLP, no sending/attachment enforcement. ChatGPT can already read drafts; the extension cannot verify transmission time.
2. **Prompt warning (60 s):** type `Contact demo@example.test and call +92 300 1234567. CNIC: 35202-1234567-1`. Pause for masked category counts. Delete the draft to clear findings, then paste it again. Show sending remains available; send only the synthetic example if appropriate.
3. **Preferences (30 s):** open the toolbar scanner and save `project marigold`. Type `PROJECT MARIGOLD` on ChatGPT; the preview hides the keyword. Explain that only keyword preferences are stored. Punctuation such as `[a-z]+` is literal.
4. **Document finding (45 s):** choose `pdf-findings.pdf` or `docx-mixed.docx`. Show findings, masks, local duration, and page counts where applicable. Nothing attaches automatically.
5. **Clear scan (30 s):** choose `txt-clear.txt`. Read **No supported patterns found**, explaining that unknown/excluded secrets can still exist.
6. **Incomplete scan (45 s):** choose `partial.pdf`: one text page plus a vector-only page without text. Show **Partially scanned**, retained email finding, and page coverage. Choose `encrypted.pdf` or `broken.docx` for **Not scanned** with a reason.
7. **Evidence (60 s):** open `artifacts/evaluation.md` and browser-results.json. Explain individual-finding TP/FP/FN and document misses caused by unavailable extraction. Mention an obfuscated-email miss and CNIC-shaped code false alarm. Team contribution claims must reflect actual work.

Optional: set the file limit to 1 MiB and select `large.txt` for oversized rejection. Reset it afterwards. Clear results and save an empty keyword list at the end to remove demo preferences.
