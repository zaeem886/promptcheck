# PromptPrivacy 1.3.0 stress test

Copy the entire [synthetic test prompt](hybrid-stress-test.txt) into a supported chat composer. Expand **Masked details** after the ML status clears. Use **Last paste** if the site moves the text into an attachment. For a repeatable reference, select the original TXT file in the PromptPrivacy document scanner. Use an empty keyword list for the totals below.

| Check | Expected result on the original TXT file |
|---|---|
| Deduplication | Line 10, column 32 shows one phone occurrence with `***98` and **Rules + ML**. |
| Model context and window boundaries | Line 10, column 75 shows the unlabelled postal address with `[value hidden]` and **ML**. The address crosses a model window boundary. |
| UTF-16 locations | Line 19, column 9 shows the Unicode email after the flag emoji, with `测***@***`. |
| International phone formats | Lines 14, 16, and 18 show the UK number with extension, international `00` prefix, and Persian digits. The previews end in `42`, `25`, and `67` respectively. |
| Identity and personal fields | Lines 23–36 include a name, birth date, two CNIC occurrences, passport, licence, national ID, multiline address, medical information, IP address, coordinates, and a wallet address. The multiline address spans lines 30–31. |
| Financial and security fields | Lines 108–117 include two valid card samples, one valid IBAN sample, three bank or routing fields, and four security codes. Security codes use `[credential hidden]`. |
| Credential masking | Lines 120–129 cover escaped JSON, a quoted passphrase, test key strings, authorization, a token-shaped string, a URL password, a private key marker, and SSH key material. The previews hide credential values. |
| First, middle, and last locations | The contact emails on lines 6, 107, and 246 are marked **Top**, **Middle**, and **Bottom**. |
| Repeated findings and pagination | The same email appears 24 times on lines 220–243 with a location for each occurrence. The Email group shows 20 rows initially. Use **Show 10 more Email findings** to see the final contact on line 246. |

## False alarm probes

Section 09 contains lookalike values, including a card and IBAN with invalid checksums. The rules flagged zero of these lines. In the tested build, ML flagged four of them. These are false alarms to look for on lines 210–213.

| Line | Observed ML label |
|---:|---|
| 210 | Payment card for the invalid card sample |
| 211 | IBAN for the invalid IBAN sample |
| 212 | Phone number for the invalid identity number sample |
| 213 | Email for the missing dotted domain |

The original file produced **71 combined findings**. This includes 66 findings supported by rules, one extra true address from ML, and the four ML false alarms above. The Email group had **30** findings including one false alarm. The CRLF variant produced 74 findings and preserved the main phone and address checks on line 10. Newline and text changes can affect the ML predictions.

## Optional interaction checks

- Add `PROJECT[A-Z]+` to **Your keywords**. Scan again and look for two **Sensitive keyword** matches at lines 132–133. Line 134 stays clear for that keyword.
- Open **Masked details**, then click **×** and confirm the advisory clears. Paste again to start a fresh scan. You can also send the synthetic draft to check that the paste snapshot clears.
- Replace the sample with `Explain binary search.` to check that results clear for ordinary text.
- Select [partial.pdf](../documents/partial.pdf) in the document scanner to check **Partially scanned** and retained masked findings when a page has no text.

Verified with the production build in a fresh Brave profile. The large-paste and Send checks used the local ChatGPT Work fixture.
