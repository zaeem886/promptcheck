import { parsePhoneNumberFromString } from 'libphonenumber-js/max';
import { isValidIBAN } from 'ibantools';

// Each replacement preserves its UTF-16 length and the original source offsets.
const digitZeros = [0x660, 0x6f0, 0x7c0, 0x966, 0x9e6, 0xa66, 0xae6, 0xb66,
  0xbe6, 0xc66, 0xce6, 0xd66, 0xde6, 0xe50, 0xed0, 0xf20, 0x1040, 0x1090,
  0x17e0, 0x1810, 0x1946, 0x19d0, 0x1a80, 0x1a90, 0x1b50, 0x1bb0,
  0x1c40, 0x1c50, 0xa620, 0xa8d0, 0xa900, 0xa9d0, 0xa9f0, 0xaa50, 0xabf0, 0xff10];
export function normalizeSensitiveText(text) {
  return text.replace(/[\p{Nd}＋（）‐‑–−]/gu, char => {
    const n = char.codePointAt(0);
    for (const zero of digitZeros) if (n >= zero && n < zero + 10) return String(n - zero);
    return ({ '＋': '+', '（': '(', '）': ')', '‐': '-', '‑': '-', '–': '-', '−': '-' })[char] || char;
  });
}

export function luhn(value) {
  const digits = value.replace(/\D/g, '');
  if (digits.length < 13 || digits.length > 19 || /^(\d)\1+$/.test(digits)) return false;
  let sum = 0;
  for (let i = digits.length - 1; i >= 0; i--) {
    let n = Number(digits[i]);
    if ((digits.length - 1 - i) % 2) { n *= 2; if (n > 9) n -= 9; }
    sum += n;
  }
  return sum % 10 === 0;
}

function paymentCard(value) {
  const digits = value.replace(/\D/g, '');
  const issuer = /^(?:4\d{12}(?:\d{3})?(?:\d{3})?|3[47]\d{13}|5[1-5]\d{14}|2[2-7]\d{14}|220[0-4]\d{12}|6(?:011|5\d{2}|4[4-9]\d)\d{12,15}|62\d{14,17}|(?:50|5[6-9])\d{11,17}|35\d{14,17}|3(?:0[0-5]|[68]\d)\d{11})$/.test(digits);
  if (/^2[2-7]/.test(digits) && !digits.startsWith('220')) {
    const prefix = Number(digits.slice(0, 4));
    if (prefix < 2221 || prefix > 2720) return false;
  }
  return issuer && luhn(digits);
}

const referenceLabel = /(?:order|invoice|reference|tracking|sku|ticket)\s*(?:number|no\.?|id)?\s*[:#=-]?\s*$/i;
export function phoneContext(text, start) {
  return !referenceLabel.test(text.slice(Math.max(0, start - 60), start));
}

const fields = [
  ['password', /password|passwd|passphrase|pwd|mot de passe|contraseña|senha|passwort|كلمة المرور|پاس[ \t]*ورڈ|密码|パスワード/, 'secret'],
  ['apiKey', /api[ _-]?key|api[ _-]?secret|client[ _-]?secret|access[ _-]?token|refresh[ _-]?token|auth[ _-]?token|secret[ _-]?key|aws[ _-]?secret[ _-]?access[ _-]?key/, 'secret'],
  ['sessionToken', /session[ _-]?(?:id|token|cookie)|cookie|authorization/, 'secret'],
  ['pin', /(?:atm|card|security)[ _-]?pin|pin(?:[ _-]?(?:code|number))?|cvv2?|cvc2?|card[ _-]?security[ _-]?code|otp|one[ _-]?time[ _-]?(?:password|code)|recovery[ _-]?code|backup[ _-]?code/, 'pin'],
  ['paymentCard', /(?:(?:credit|debit|atm|payment)[ _-]?)card[ _-]?(?:number|no\.?)|card[ _-]?pan|银行卡号|رقم البطاقة|کارڈ نمبر/, 'card'],
  ['bankAccount', /swift(?:[ _-]?code)?|bic(?:[ _-]?code)?/, 'bankcode'],
  ['bankAccount', /(?:bank[ _-]?)?account[ _-]?(?:number|no\.?)|bank[ _-]?account|routing[ _-]?(?:number|no\.?)|sort[ _-]?code|bsb|ifsc|conta bancária|numéro de compte|kontonummer|رقم الحساب|اکاؤنٹ نمبر|银行账号/, 'account'],
  ['nationalId', /national[ _-]?(?:id|identification)(?:[ _-]?(?:number|no\.?))?|(?:tax|voter|resident|residence)[ _-]?(?:id|number)|ssn|social[ _-]?security(?:[ _-]?(?:number|no\.?))?|nino|national insurance(?: number)?|aadhaar(?: number)?|aadhar(?: number)?|pan(?: number)?|cpf|cnpj|sin|nie|dni|nif|steuer[ _-]?id|身份证号|رقم الهوية|شناختی نمبر/, 'id'],
  ['passport', /passport(?:[ _-]?(?:number|no\.?|id))?|passeport|pasaporte|reisepass|جواز السفر|پاسپورٹ|护照号/, 'id'],
  ['driverLicense', /driver'?s?[ _-]?licen[cs]e(?:[ _-]?(?:number|no\.?))?|driving[ _-]?licen[cs]e(?:[ _-]?(?:number|no\.?))?/, 'id'],
  ['phone', /phone(?:[ _-]?(?:number|no\.?))?|mobile(?:[ _-]?(?:number|no\.?))?|telephone|tel|whatsapp|fax|téléphone|teléfono|telefon|فون نمبر|رقم الهاتف|电话号码/, 'phone'],
  ['person', /(?:full|first|last|given|family)[ _-]?name|patient[ _-]?name|customer[ _-]?name|employee[ _-]?name|my name|nombre completo|nom complet|पूरा नाम|姓名|الاسم|نام/, 'person'],
  ['address', /(?:(?:home|postal|mailing|street|residential|shipping|billing)[ _-]?)address|address|domicilio|adresse|anschrift|endereço|住址|住所|العنوان|پتہ/, 'address'],
  ['dateOfBirth', /date[ _-]?of[ _-]?birth|birth[ _-]?date|dob|fecha de nacimiento|date de naissance|geburtsdatum|出生日期|تاريخ الميلاد|تاریخ پیدائش/, 'date'],
  ['medical', /(?:medical|patient|health|insurance|policy)[ _-]?(?:record[ _-]?)?(?:number|no\.?|id)|diagnosis|medical[ _-]?condition/, 'medical'],
  ['location', /(?:gps[ _-]?)?coordinates|latitude|longitude|ip[ _-]?address/, 'location'],
  ['cryptoWallet', /(?:crypto|bitcoin|ethereum|eth|btc)[ _-]?(?:wallet|address)|wallet[ _-]?address/, 'wallet'],
];
const labels = fields.map(([, label]) => label.source).join('|');
const separator = /["']?[ \t]*(?::|=|：|\bis\b|→)[ \t]*/.source;
const nextField = new RegExp('[, \\t]+(?:' + labels + ')' + separator, 'iu');
const emptyValue = /^(?:null|none|undefined|false|true|n\/a|na|unknown|optional|empty|blank|not provided|not set|redacted|omitted|\[.*\]|[•*xX-]{2,})$/iu;

function fieldValue(text, offset) {
  const tail = text.slice(offset, offset + 513);
  const quote = /^["']/.test(tail) ? tail[0] : null;
  let value;
  let start = offset;
  if (quote) {
    start++;
    let end = 1;
    while (end < tail.length && tail[end] !== quote) {
      if (tail[end] === '\\') end++;
      end++;
    }
    if (end >= tail.length) return null;
    value = tail.slice(1, end);
  } else {
    value = tail.split(/[\r\n;|]/, 1)[0];
    const next = nextField.exec(value);
    if (next) value = value.slice(0, next.index);
    value = value.replace(/[ \t,}]+$/, '');
  }
  start += value.length - value.trimStart().length;
  value = value.trim();
  if (!value || value.length > 500 || emptyValue.test(value)) return null;
  return { value, start };
}

function acceptsField(kind, value) {
  switch (kind) {
    case 'secret': return value.length >= 3 && !/^(?:is |should |must |can |please |reset |field |required\b)/i.test(value);
    case 'pin': return /^[A-Za-z0-9][A-Za-z0-9 -]{2,63}$/.test(value) && /\d/.test(value);
    case 'account': return /^[A-Za-z0-9][A-Za-z0-9 .-]{3,59}$/.test(value) && /\d/.test(value);
    case 'bankcode': return /^[A-Z]{6}[A-Z0-9]{2}(?:[A-Z0-9]{3})?$/.test(value);
    case 'card': return /^[\d -]{13,25}$/.test(value) && paymentCard(value);
    case 'wallet': return /^(?:0x[a-fA-F0-9]{40}|[13][a-km-zA-HJ-NP-Z1-9]{25,34}|bc1[a-z0-9]{25,87})$/.test(value);
    case 'id': return /^[\p{L}\d][\p{L}\d ./()-]{2,39}$/u.test(value) && /\d/.test(value);
    case 'phone': {
      const digits = value.replace(/(?:ext\.?|x|#).*/i, '').replace(/\D/g, '');
      return /^[+(\d][\d(). \t+-]{4,38}(?:(?:ext\.?|x|#)[ \t]*\d{1,6})?$/i.test(value) && digits.length >= 7 && digits.length <= 15;
    }
    case 'person': return /^[\p{L}\p{M}][\p{L}\p{M} .’'-]{1,99}$/u.test(value) && !/^(?:required|optional|unknown|here|please|enter)\b/i.test(value);
    case 'address': return value.length >= 6 && value.length <= 300 && !/^(?:required|optional|unknown|here|please|enter)\b/i.test(value);
    case 'date': return /^(?:\d{1,4}[-/.]\d{1,2}[-/.]\d{1,4}|\d{1,2}[ \t]+\p{L}{3,12}[ \t]+\d{4}|\p{L}{3,12}[ \t]+\d{1,2},?[ \t]+\d{4})$/u.test(value);
    case 'medical': return value.length >= 2 && !/^(?:required|optional|unknown|here|please|enter)\b/i.test(value);
    case 'location': return /^[\d.,+:a-f -]{3,80}$/i.test(value) && /\d/.test(value);
    default: return false;
  }
}

export function collectSensitivePatterns(text, add, emit) {
  add('email', /(?<![\p{L}\p{M}\p{N}.!#$%&'*+/=?^_\x60{|}~-])[\p{L}\p{M}\p{N}.!#$%&'*+/=?^_\x60{|}~-]{1,64}@[\p{L}\p{N}](?:[\p{L}\p{M}\p{N}-]{0,61}[\p{L}\p{N}])?(?:\.[\p{L}\p{N}](?:[\p{L}\p{M}\p{N}-]{0,61}[\p{L}\p{N}])?)+/gu, 2);
  add('apiKey', /(?:sk-(?:proj-|ant-api\d{2}-)[A-Za-z0-9_-]{16,255}|(?:sk|rk)_(?:live|test)_[A-Za-z0-9]{16,100}|(?:gh[opsu]_|glpat-)[A-Za-z0-9_-]{20,255}|xox[baprs]-[A-Za-z0-9-]{10,255}|npm_[A-Za-z0-9]{36}|SG\.[A-Za-z0-9_-]{20,24}\.[A-Za-z0-9_-]{40,50}|ASIA[A-Z0-9]{16})/g, 1);
  add('sessionToken', /eyJ[A-Za-z0-9_-]{5,}\.[A-Za-z0-9_-]{5,}\.[A-Za-z0-9_-]{8,}/g, 1);
  add('sessionToken', /(?:Bearer|Basic)[ \t]+[A-Za-z0-9_+/.=-]{8,}/gi, 1);
  add('sshKey', /(?:ssh-ed25519|ssh-rsa|ecdsa-sha2-nistp\d+)[ \t]+[A-Za-z0-9+/]{40,}={0,3}/g, 1);
  add('paymentCard', /(?:\d[ -]?){12,18}\d/g, 3, (m, start) => paymentCard(m[0]) && phoneContext(text, start));
  for (const m of text.matchAll(/[A-Z]{2}\d{2}(?:[ \t]?[A-Z0-9]){11,30}/gi)) {
    for (let end = m[0].length; end >= 15; end--) {
      const value = m[0].slice(0, end).trimEnd();
      if (isValidIBAN(value.replace(/[ \t]/g, '').toUpperCase())) { emit('iban', m.index, m.index + value.length, 2); break; }
    }
  }
  add('nationalId', /\d{3}-\d{2}-\d{4}/g, 3, m =>
    !/^(?:000|666|9\d\d)-/.test(m[0]) && !/-00-|-0000$/.test(m[0]));
  for (const m of text.matchAll(/(?:\+|00)[1-9]\d{0,2}(?:[ \t().-]*\d){4,14}(?:[ \t]*(?:ext\.?|x|#)[ \t]*\d{1,6})?/gi)) {
    if (!phoneContext(text, m.index)) continue;
    const raw = m[0].startsWith('00') ? '+' + m[0].slice(2) : m[0];
    const number = parsePhoneNumberFromString(raw, { extract: false });
    if (number?.isPossible()) emit('phone', m.index, m.index + m[0].length, 4);
  }
  for (const [category, label, kind] of fields) {
    const pattern = new RegExp('(?<![\\p{L}\\p{N}_])(?:' + label.source + ')' + separator, 'giu');
    for (const match of text.matchAll(pattern)) {
      const field = fieldValue(text, match.index + match[0].length);
      if (!field) continue;
      if (['phone', 'id', 'account', 'bankcode', 'card', 'pin', 'date'].includes(kind)) field.value = field.value.replace(/\.$/, '');
      if (!acceptsField(kind, field.value)) continue;
      let foundCategory = category;
      if (category === 'bankAccount' && isValidIBAN(field.value.replace(/[ \t]/g, '').toUpperCase())) foundCategory = 'iban';
      emit(foundCategory, field.start, field.start + field.value.length, category === 'location' ? -1 : 0, false);
    }
  }
  for (const m of text.matchAll(/\b[a-z][a-z0-9+.-]*:\/\/[^ \t\r\n/@:]{1,100}:([^ \t\r\n/@]{1,200})@/gi)) {
    const end = m.index + m[0].length - 1;
    emit('password', end - m[1].length, end, 0, false);
  }
}
