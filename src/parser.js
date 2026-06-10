'use strict';

const { REQUEST_DEFINITIONS, REQUEST_TYPES, targetOperatorsForRequest } = require('./domain');

const INVALID_FORMAT_MESSAGE = [
  'Invalid format.',
  'Use: REQUEST_TYPE VALUE',
  'Valid request types: LRL, LCL, MS-NID, NID-MS, IMEI-MS',
  'Example: LRL 017XXXXXXXX'
].join('\n');

function parseRequestText(rawText) {
  const cleaned = String(rawText || '')
    .replace(/^@bot\s+/i, '')
    .trim()
    .replace(/\s+/g, ' ');

  const [typeToken, ...payloadParts] = cleaned.split(' ');
  const requestType = normalizeRequestType(typeToken);
  const payload = payloadParts.join(' ').trim();
  const targetOperators = requestType ? targetOperatorsForRequest(requestType, payload) : [];

  const errors = [];
  if (!requestType) {
    errors.push('Unsupported request type. Use LRL, LCL, MS-NID, NID-MS, or IMEI-MS.');
  }
  if (!payload) errors.push('Missing request value.');
  if (requestType && REQUEST_DEFINITIONS[requestType]?.payload === 'MSISDN' && !isMsisdn(payload)) {
    errors.push('MSISDN must be an 11 digit Bangladeshi mobile number starting with 01.');
  }
  if (requestType === REQUEST_TYPES.NID_MS && !/^\d{10,17}$/.test(payload)) {
    errors.push('NID must be 10 to 17 digits.');
  }
  if (requestType === REQUEST_TYPES.IMEI_MS && !/^\d{14,17}$/.test(payload)) {
    errors.push('IMEI must be 14 to 17 digits.');
  }
  if (
    requestType &&
    REQUEST_DEFINITIONS[requestType]?.target === 'RELEVANT_OPERATOR' &&
    targetOperators.length === 0
  ) {
    errors.push('Could not identify GP, Robi, or Banglalink from the mobile number prefix.');
  }

  return {
    ok: errors.length === 0,
    requestType,
    payload,
    targetOperators,
    rawText,
    errors,
    correctionMessage: INVALID_FORMAT_MESSAGE
  };
}

function normalizeRequestType(value) {
  const normalized = String(value || '').trim().toUpperCase();
  return Object.values(REQUEST_TYPES).includes(normalized) ? normalized : null;
}

function isMsisdn(value) {
  return /^01\d{9}$/.test(String(value || '').trim());
}

module.exports = {
  INVALID_FORMAT_MESSAGE,
  parseRequestText,
  normalizeRequestType,
  isMsisdn
};
