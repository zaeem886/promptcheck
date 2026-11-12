// Synthetic source data and independent labels; this file never imports the detector.
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { PDFDocument, StandardFonts } from 'pdf-lib';
import JSZip from 'jszip';
await mkdir('fixtures/documents', { recursive: true });
const prompts = [], labels = {};
function prompt(text, spans = [], keywords = []) {
  const id = `prompt-${String(prompts.length + 1).padStart(3, '0')}`;
  prompts.push({ id, text, keywords });
  labels[id] = spans.map(([category, value, occurrence = 0]) => {
    let start = -1; for (let i = 0; i <= occurrence; i++) start = text.indexOf(value, start + 1);
    if (start < 0) throw new Error('Invalid synthetic label');
    return { category, start, end: start + value.length };
  });
}
for (let i = 0; i < 20; i++) {
  const email = `person${i}@example.test`; prompt(`Draft ${i}: reply to ${email}.`, [['email', email]]);
}
const phones = ['03001234567', '0300-1234567', '0300 1234567', '+923001234567', '+92 300 1234567', '+92-300-1234567', '0092 300 1234567'];
for (let i = 0; i < 14; i++) prompt(`Call the synthetic contact ${phones[i % 7]}. Case ${i}.`, [['phone', phones[i % 7]]]);
for (let i = 0; i < 10; i++) {
  const value = i % 2 ? '3520212345671' : '35202-1234567-1'; prompt(`CNIC: ${value}. Sample ${i}.`, [['cnic', value]]);
}
const credentials = ['sk-' + 'A'.repeat(24), 'sk-proj-' + 'bC_8-'.repeat(8), 'ghp_' + 'a'.repeat(36), 'github_pat_' + 'a'.repeat(40), 'AKIA' + 'A1'.repeat(8), 'AIza' + 'b'.repeat(35)];
for (let i = 0; i < 12; i++) prompt(`Synthetic token ${credentials[i % 6]} case ${i}`, [['apiKey', credentials[i % 6]]]);
for (const prefix of ['', 'RSA ', 'EC ', 'DSA ', 'OPENSSH ', 'ENCRYPTED ']) {
  const value = `-----BEGIN ${prefix}PRIVATE KEY-----`; prompt(`Example ${value}\nSYNTHETIC ONLY`, [['privateKey', value]]);
}
for (let i = 0; i < 10; i++) prompt(`Discuss PROJECT MARIGOLD. Case ${i}`, [['keyword', 'PROJECT MARIGOLD']], ['project marigold']);
prompt('demo@example.test demo@example.test', [['email','demo@example.test',0],['email','demo@example.test',1]], ['demo']);
prompt('Literal [a-z]+ and <script> only.', [['keyword','[a-z]+'],['keyword','<script>']], ['[a-z]+','<script>']);
prompt('Email demo@example.test and call 0300-1234567.', [['email','demo@example.test'],['phone','0300-1234567']]);
const normal = ['Order: 03001234567', 'Invoice no: 03001234567', 'Order: 3520212345671', 'Date 2026-11-13', 'Version 1.2.3', 'invalid@localhost', 'sk-short ghp_short', '-----BEGIN PUBLIC KEY-----', 'Read the class notes.', 'Budget 25000 PKR.', '2030012345678', 'CNIC example omitted.', 'Meeting at 10:30.', 'The national park is open.', 'Tracking: 03001234567', 'Use a placeholder for contact details.', 'Explain regex syntax.', 'What is the weather?', 'CSV columns: name,department', 'a@.test', '85202-1234567-1', 'No private information here.', '030012345678', 'The value 3520212345671 is an order number.', 'Summarize chapter six.'];
for (const text of normal) prompt(text);
// Honest known misses/false alarm challenge cases, explicitly labelled.
prompt('Call +92 (300) 1234567', [['phone', '+92 (300) 1234567']]);
prompt('Contact member at person [at] example [dot] test', [['email', 'person [at] example [dot] test']]);
prompt('Unlabelled synthetic order reference value: 03001234567', []);
prompt('Illustrative code literal 35202-1234567-1; no identity intended.', []);
await writeFile('fixtures/prompts.json', JSON.stringify(prompts, null, 2));
await writeFile('fixtures/prompt-labels.json', JSON.stringify(labels, null, 2));
const docs = [];
async function add(name, content, status, findings = [], extra = {}) {
  const path = `fixtures/documents/${name}`;
  let existing; try { existing = await readFile(path); } catch {}
  if (!existing?.equals(Buffer.from(content))) await writeFile(path, content);
  docs.push({ name, status, expected: findings.map(([category, value]) => ({ category, value })), ...extra });
}
async function pdf(texts) {
  const doc = await PDFDocument.create(); const font = await doc.embedFont(StandardFonts.Helvetica);
  for (const text of texts) { const page = doc.addPage(); if (text) page.drawText(text, {x:40,y:740,size:12,font}); else page.drawRectangle({x:40,y:400,width:250,height:120}); }
  return doc.save();
}
async function docx(text) {
  const zip = new JSZip();
  zip.file('[Content_Types].xml', '<?xml version="1.0"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>');
  zip.file('_rels/.rels','<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>');
  zip.file('word/document.xml', `<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body><w:p><w:r><w:t>${text}</w:t></w:r></w:p></w:body></w:document>`);
  return zip.generateAsync({type:'nodebuffer'});
}
for (const type of ['txt','csv','pdf','docx']) {
  for (const kind of ['findings','clear','mixed']) {
    const text = kind === 'clear' ? 'Normal class notes. Order: 3520212345671.' : kind === 'findings' ? 'Contact demo@example.test' : 'Call 0300-1234567; CNIC: 35202-1234567-1';
    const expected = kind === 'clear' ? [] : kind === 'findings' ? [['email','demo@example.test']] : [['phone','0300-1234567'],['cnic','35202-1234567-1']];
    const content = type === 'pdf' ? await pdf([text]) : type === 'docx' ? await docx(text) : type === 'csv' ? `record,notes\nsynthetic,"${text}"\n` : text;
    await add(`${type}-${kind}.${type}`, content, expected.length ? 'Findings detected' : 'No supported patterns found', expected);
  }
}
await add('partial.pdf', await pdf(['Contact demo@example.test', '']), 'Partially scanned', [['email','demo@example.test'], ['phone','03001234567']], { unavailableFindings: 1, note: 'Second page has no text layer; conceptual phone is only in ground truth, standing in for an unexamined image. No OCR claim.' });
await add('image-only.pdf', await pdf(['']), 'Not scanned', [['email','image@example.test']], { unavailableFindings: 1, note: 'Vector-only page simulates missing text layer; conceptual label unavailable to extraction.' });
await add('broken.pdf', '%PDF-1.7\nsynthetic invalid', 'Not scanned');
await add('broken.docx', 'not a ZIP', 'Not scanned');
// Minimal standard-encryption dictionary with deliberately non-matching user/owner keys.
// No real document contents or password are included; PDF.js must reject it for a password.
function encryptedPdf() {
  const objects = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] >>',
    `<< /Filter /Standard /V 1 /R 2 /Length 40 /O <${'ab'.repeat(32)}> /U <${'cd'.repeat(32)}> /P -4 >>`
  ];
  let body = '%PDF-1.4\n'; const offsets=[0];
  for(let i=0;i<objects.length;i++){offsets.push(Buffer.byteLength(body));body+=`${i+1} 0 obj\n${objects[i]}\nendobj\n`;}
  const xref=Buffer.byteLength(body);
  body+=`xref\n0 5\n0000000000 65535 f \n${offsets.slice(1).map(x=>String(x).padStart(10,'0')+' 00000 n ').join('\n')}\ntrailer\n<< /Size 5 /Root 1 0 R /Encrypt 4 0 R /ID [<${'ef'.repeat(16)}><${'ef'.repeat(16)}>] >>\nstartxref\n${xref}\n%%EOF`;
  return body;
}
await add('encrypted.pdf', encryptedPdf(), 'Not scanned', [], { note: 'Synthetic standard-encryption dictionary exercises password rejection, not successful encrypted extraction.' });
await add('unsupported.rtf', '{\\rtf1 Synthetic demo@example.test}', 'Not scanned', [['email','demo@example.test']], { unavailableFindings: 1 });
await add('empty.txt', '', 'Not scanned');
await add('invalid-utf8.txt', Buffer.from([0xff,0xfe,0,0]), 'Not scanned');
await add('large.txt', 'normal notes '.repeat(100000), 'Not scanned', [], { limits: {maxBytes:1024} });
await add('keyword.txt', 'PROJECT MARIGOLD', 'Findings detected', [['keyword','PROJECT MARIGOLD']], {keywords:['project marigold']});
await add('page-limit.pdf', await pdf(['Normal notes.', 'Contact hidden@example.test']), 'Partially scanned', [['email','hidden@example.test']], {limits:{maxPages:1},unavailableFindings:1});
await add('text-limit.txt', 'Normal notes. '.repeat(20) + 'hidden@example.test', 'Partially scanned', [['email','hidden@example.test']], {limits:{maxTextChars:30},unavailableFindings:1});
await writeFile('fixtures/document-labels.json', JSON.stringify(docs, null, 2));
console.log(`Created ${prompts.length} independently labelled prompts and ${docs.length} test documents.`);
