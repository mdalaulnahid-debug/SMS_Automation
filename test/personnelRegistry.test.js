'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { PersonnelRegistry, normalizeEmail } = require('../src/personnelRegistry');

const RECORDS = [
  { name: 'SI Nazmul', designation: 'Sub-Inspector', unit: 'Bakerganj', phone: '01712345678', email: 'nazmul@police.gov.bd' },
  { name: 'OC Karim', designation: 'Officer in Charge', unit: 'Barishal Sadar', phone: '01899999999', email: 'karim@police.gov.bd' }
];

test('matches when phone AND email belong to the same registry record', () => {
  const registry = new PersonnelRegistry(RECORDS);
  const match = registry.matchByPhoneAndEmail('01712345678', 'nazmul@police.gov.bd');
  assert.equal(match.name, 'SI Nazmul');
});

test('normalizes +880/880 phone prefixes the same way domain.js does', () => {
  const registry = new PersonnelRegistry(RECORDS);
  const match = registry.matchByPhoneAndEmail('8801712345678', 'nazmul@police.gov.bd');
  assert.equal(match.name, 'SI Nazmul', 'registry data and submitted phone must normalize to the same form');
});

test('email match is case-insensitive', () => {
  const registry = new PersonnelRegistry(RECORDS);
  const match = registry.matchByPhoneAndEmail('01712345678', 'NAZMUL@Police.Gov.BD');
  assert.equal(match.name, 'SI Nazmul');
});

test('CRITICAL: rejects when phone matches one record and email matches a different record', () => {
  const registry = new PersonnelRegistry(RECORDS);
  // Nazmul's phone + Karim's email — an attacker mixing a known phone number
  // with an unrelated registered email must never be treated as a match.
  const match = registry.matchByPhoneAndEmail('01712345678', 'karim@police.gov.bd');
  assert.equal(match, null);
});

test('rejects when neither phone nor email is in the registry', () => {
  const registry = new PersonnelRegistry(RECORDS);
  assert.equal(registry.matchByPhoneAndEmail('01700000000', 'nobody@example.com'), null);
});

test('rejects empty or missing input rather than matching by coincidence', () => {
  const registry = new PersonnelRegistry(RECORDS);
  assert.equal(registry.matchByPhoneAndEmail('', ''), null);
  assert.equal(registry.matchByPhoneAndEmail(null, undefined), null);
});

test('addRecord() normalizes the same way the constructor does', () => {
  const registry = new PersonnelRegistry();
  registry.addRecord({ name: 'Late Add', phone: '+8801611112222', email: 'Late@Example.com' });
  assert.equal(registry.size(), 1);
  const match = registry.matchByPhoneAndEmail('01611112222', 'late@example.com');
  assert.equal(match.name, 'Late Add');
});

test('normalizeEmail trims and lowercases', () => {
  assert.equal(normalizeEmail('  Foo@BAR.com  '), 'foo@bar.com');
  assert.equal(normalizeEmail(null), '');
});
