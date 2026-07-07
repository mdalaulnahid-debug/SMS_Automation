'use strict';

// Validates a registration attempt against a real Personnel Registry —
// self-declared identity (any email/phone someone types in) is never
// trusted. See docs/security-hardening-v1-design.md §6.

const { normalizePhoneNumber } = require('./domain');

function normalizeEmail(value) {
  return String(value || '').trim().toLowerCase();
}

class PersonnelRegistry {
  constructor(records = []) {
    this.records = records.map((record) => this._normalizeRecord(record));
  }

  _normalizeRecord(record) {
    return {
      ...record,
      phone: normalizePhoneNumber(record.phone),
      email: normalizeEmail(record.email)
    };
  }

  addRecord(record) {
    this.records.push(this._normalizeRecord(record));
  }

  size() {
    return this.records.length;
  }

  // Both phone AND email must match the SAME registry record. Matching
  // phone on one record and email on a different one must never pass —
  // that would let an attacker mix a stolen/guessed phone number with an
  // unrelated registered email to slip through.
  matchByPhoneAndEmail(phone, email) {
    const normalizedPhone = normalizePhoneNumber(phone);
    const normalizedEmail = normalizeEmail(email);
    if (!normalizedPhone || !normalizedEmail) return null;
    return this.records.find(
      (record) => record.phone === normalizedPhone && record.email === normalizedEmail
    ) || null;
  }
}

module.exports = { PersonnelRegistry, normalizeEmail };
