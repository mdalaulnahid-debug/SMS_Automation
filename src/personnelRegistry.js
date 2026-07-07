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

// --- Spreadsheet loading (admin-upload path, design doc §6) ---
// Reuses the `xlsx` package already used by trainingData.js for the same
// admin-provided-workbook pattern, rather than inventing a new import
// format. Unlike the training workbooks (real-world operator logs, messy
// formatting), a Personnel Registry sheet is purpose-built and clean, so a
// simple first-row-is-headers assumption with case-insensitive column
// aliasing is enough — no title-row-skipping logic needed.

const COLUMN_ALIASES = Object.freeze({
  name: ['name', 'officer name', 'full name'],
  designation: ['designation', 'rank', 'title'],
  unit: ['unit', 'station', 'department'],
  phone: ['phone', 'official phone', 'mobile', 'msisdn', 'contact number'],
  email: ['email', 'official email', 'e-mail']
});

function loadXlsx() {
  try {
    return require('xlsx');
  } catch {
    return null;
  }
}

function findColumn(headerRow, aliases) {
  const lower = headerRow.map((cell) => String(cell || '').trim().toLowerCase());
  for (const alias of aliases) {
    const index = lower.indexOf(alias);
    if (index !== -1) return index;
  }
  return -1;
}

// Parses a Personnel Registry workbook from a Buffer — works equally for an
// uploaded file's raw bytes or a file read off disk, with no filesystem
// dependency of its own. Reads only the first sheet (a registry is a single
// flat roster, not a multi-sheet workbook like the training data).
function parseRegistryWorkbook(buffer) {
  const xlsx = loadXlsx();
  if (!xlsx) throw new Error('The xlsx package is not available.');

  const workbook = xlsx.read(buffer, { type: 'buffer' });
  const sheetName = workbook.SheetNames[0];
  if (!sheetName) return [];

  const aoa = xlsx.utils.sheet_to_json(workbook.Sheets[sheetName], { header: 1, defval: '', raw: false });
  if (aoa.length === 0) return [];

  const headerRow = aoa[0];
  const columns = {
    name: findColumn(headerRow, COLUMN_ALIASES.name),
    designation: findColumn(headerRow, COLUMN_ALIASES.designation),
    unit: findColumn(headerRow, COLUMN_ALIASES.unit),
    phone: findColumn(headerRow, COLUMN_ALIASES.phone),
    email: findColumn(headerRow, COLUMN_ALIASES.email)
  };
  if (columns.name === -1 || columns.phone === -1 || columns.email === -1) {
    throw new Error('Registry spreadsheet must have Name, Phone, and Email columns (Designation and Unit are optional).');
  }

  return aoa
    .slice(1)
    .filter((row) => row.some((cell) => String(cell || '').trim()))
    .map((row) => ({
      name: String(row[columns.name] || '').trim(),
      designation: columns.designation === -1 ? '' : String(row[columns.designation] || '').trim(),
      unit: columns.unit === -1 ? '' : String(row[columns.unit] || '').trim(),
      phone: String(row[columns.phone] || '').trim(),
      email: String(row[columns.email] || '').trim()
    }))
    .filter((record) => record.name && record.phone && record.email);
}

module.exports = { PersonnelRegistry, normalizeEmail, parseRegistryWorkbook };
