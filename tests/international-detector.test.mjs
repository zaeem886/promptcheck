import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { getExampleNumber, getCountries } from 'libphonenumber-js/max';
import { detect } from '../src/shared/detector.js';

const categories = text => detect(text).map(f => f.category);
function expectValue(text, category, value) {
  const found = detect(text).filter(f => f.category === category);
  assert.equal(found.length, 1, text);
  assert.equal(text.slice(found[0].start, found[0].end), value, text);
  return found[0];
}

test('international numbers use country metadata for every provided mobile example', async () => {
  const examples = JSON.parse(await readFile(new URL('../node_modules/libphonenumber-js/examples.mobile.json', import.meta.url)));
  let checked = 0;
  for (const country of getCountries()) {
    const number = getExampleNumber(country, examples);
    if (!number) continue;
    for (const value of [number.number, number.formatInternational()]) {
      expectValue('Call ' + value + '.', 'phone', value);
      checked++;
    }
  }
  assert.ok(checked > 400);
});

test('phone punctuation, international dialing, extensions and labeled local numbers', () => {
  for (const value of ['+1 (202) 555-0198', '0044 20 7946 0958', '+81 90-1234-5678',
    '+92 (300) 1234567', '+1 202 555 0198 ext. 42']) expectValue('Call ' + value, 'phone', value);
  for (const value of ['020 7946 0958', '(202) 555-0198', '03-1234-5678']) expectValue('Phone: ' + value, 'phone', value);
  for (const value of ['+999 123456789', '+1 123', 'Phone: 123', 'Phone: 12345678901234567890',
    'Order: +44 20 7946 0958']) assert.deepEqual(categories(value), [], value);
});

test('localized digits preserve original UTF-16 spans and line locations', () => {
  const value = '＋۹۲ （۳۰۰） ۱۲۳۴۵۶۷';
  const f = expectValue('🙂 Notes\nCall ' + value, 'phone', value);
  assert.equal(f.location.line, 2);
  assert.equal(f.location.column, 6);
  assert.equal(f.preview, '***67');
  expectValue('联系 测试+标签@例子.test。', 'email', '测试+标签@例子.test');
});

test('cards require issuer format and checksum, IBANs require country format and checksum', () => {
  for (const value of ['4242 4242 4242 4242', '5555-5555-5555-4444', '378282246310005',
    '6011 1111 1111 1117', '3530111333300000']) expectValue('Pay with ' + value, 'paymentCard', value);
  for (const value of ['GB82 WEST 1234 5698 7654 32', 'DE89 3704 0044 0532 0130 00',
    'NL91ABNA0417164300', 'FR14 2004 1010 0505 0001 3M02 606',
    'de89 3704 0044 0532 0130 00']) expectValue(value + ' END', 'iban', value);
  for (const value of ['4242 4242 4242 4243', '0000000000000000', 'GB00 WEST 1234 5698 7654 32',
    'Order: 4242424242424242']) assert.deepEqual(categories(value), [], value);
});

test('labeled personal, financial, identity and medical fields have exact masked values', () => {
  const cases = [
    ['Full name', 'Zoë O’Shea', 'person'], ['Home address', '14 Cedar Road, Bristol BS1 4QA', 'address'],
    ['Date of birth', '1998-03-24', 'dateOfBirth'], ['Passport number', 'XZ4625079', 'passport'],
    ['Driving licence number', 'D123-456-789', 'driverLicense'], ['Aadhaar', '1234 5678 9012', 'nationalId'],
    ['Tax ID', 'AB123456C', 'nationalId'], ['Account number', '000123456789', 'bankAccount'],
    ['SWIFT', 'DEUTDEFF', 'bankAccount'], ['Medical record ID', 'MR-10492', 'medical'],
    ['Diagnosis', 'Type 2 diabetes', 'medical'], ['IP address', '192.168.1.42', 'location'],
    ['Coordinates', '51.5074, -0.1278', 'location'], ['PIN', '0082', 'pin'],
    ['CVV', '123', 'pin'], ['OTP', '572019', 'pin'], ['姓名', '李明', 'person'],
    ['رقم الهوية', '۱۲۳۴۵۶۷۸۹', 'nationalId']
  ];
  for (const [label, value, category] of cases) {
    const f = expectValue(label + ': ' + value, category, value);
    assert.ok(!f.preview.includes(value), label);
  }
});

test('credentials in quotes, JSON, connection URLs and pasted environment files stay hidden', () => {
  const cases = [
    ['My password is "paper cranes at midnight".', 'password', 'paper cranes at midnight'],
    ['{"password":"Demo_DB-71!cat","phone":"020 7946 0958"}', 'password', 'Demo_DB-71!cat'],
    ['API_KEY=opaque-secret-123', 'apiKey', 'opaque-secret-123'],
    ['CLIENT_SECRET="private_Example987"', 'apiKey', 'private_Example987'],
    ['postgres://demo:Demo123!@db.example.test/app', 'password', 'Demo123!'],
    ['Session token: random-session-12345', 'sessionToken', 'random-session-12345']
  ];
  for (const [text, category, value] of cases) {
    assert.equal(expectValue(text, category, value).preview, '[credential hidden]');
  }
  for (const token of ['sk-ant-api03-' + 'a'.repeat(35), 'sk_live_' + 'a'.repeat(24),
    'glpat-' + 'a'.repeat(20), 'xoxb-' + 'a'.repeat(24), 'ASIA' + 'A'.repeat(16)]) {
    expectValue(token, 'apiKey', token);
  }
  expectValue('password: "ab\\"cd987"', 'password', 'ab\\"cd987');
});

test('ordinary numbers and empty or instructional fields do not trigger findings', () => {
  for (const text of ['The parcel weighs 4 kilograms.', 'Build 123456789 passed.',
    'Password: [redacted]', 'Passport: optional', 'Full name: please enter your name',
    'Phone: N/A', 'My password should be longer.', 'Email is optional.',
    'Account number: null', 'IP address: unknown']) assert.deepEqual(categories(text), [], text);
});

test('long delimiter-free input completes and repeated fields retain separate locations', () => {
  assert.deepEqual(detect('a'.repeat(100000)), []);
  const text = 'password: "example one"\npassword: "example two"';
  const found = detect(text);
  assert.equal(found.length, 2);
  assert.deepEqual(found.map(f => f.location.line), [1, 2]);
  assert.ok(found.every(f => f.preview === '[credential hidden]'));
});
