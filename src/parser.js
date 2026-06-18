'use strict';

const {
  REQUEST_DEFINITIONS,
  REQUEST_TYPES,
  targetOperatorsForRequest
} = require('./domain');

const REQUEST_TYPE_SET = new Set(Object.values(REQUEST_TYPES));
const MAX_IDENTIFIERS = 5;

const DEFAULT_INVALID_FORMAT_MESSAGE =
  'Invalid format. Use English capital command, e.g. LCL 01710000000.';

const ERROR_DEFINITIONS = Object.freeze({
  EMPTY_MESSAGE: {
    message: 'Request message is empty.',
    replyText: DEFAULT_INVALID_FORMAT_MESSAGE
  },
  UNSUPPORTED_COMMAND: {
    message: 'Unsupported command. Supported commands: IMEI-MS, LCL, LRL, MS-NID, NID-MS.',
    replyText: 'Unsupported command. Supported commands: IMEI-MS, LCL, LRL, MS-NID, NID-MS.'
  },
  MISSING_IDENTIFIERS: {
    message: 'Request must include at least one identifier.',
    replyText: 'Request must include at least one identifier.'
  },
  TOO_MANY_IDENTIFIERS: {
    message: 'Maximum 5 identifiers allowed in one request.',
    replyText: 'Maximum 5 identifiers allowed in one request.'
  },
  MIXED_REQUEST_TYPES: {
    message: 'Only one request type is allowed per message.',
    replyText: 'Only one request type is allowed per message.'
  },
  REPEATED_COMMAND: {
    message: 'Do not repeat the command keyword inside the same message.',
    replyText: 'Do not repeat the command keyword inside the same message.'
  },
  INVALID_IDENTIFIER_CHARS: {
    message: 'Identifiers must contain digits only. Do not use +, -, comma, slash, or other symbols.',
    replyText: 'Identifiers must contain digits only. Do not use +, -, comma, slash, or other symbols.'
  },
  INVALID_IDENTIFIER_FORMAT: {
    message: 'One or more identifiers do not match the expected format for this command.',
    replyText: DEFAULT_INVALID_FORMAT_MESSAGE
  },
  OPERATOR_MISMATCH: {
    message: 'All identifiers in one request must belong to the same operator.',
    replyText: 'One request cannot target multiple operators.'
  },
  OPERATOR_UNRESOLVED: {
    message: 'Could not identify GP, Robi, or Banglalink from the provided mobile number prefix.',
    replyText: DEFAULT_INVALID_FORMAT_MESSAGE
  }
});

function parseRequestText(rawText) {
  const normalizedText = normalizeRequestText(rawText);
  const rawTokens = normalizedText ? normalizedText.split(' ') : [];

  if (rawTokens.length === 0) {
    return invalidResult('EMPTY_MESSAGE', rawText, normalizedText);
  }

  const commandToken = rawTokens[0];
  const requestType = normalizeRequestType(commandToken);
  if (!requestType) {
    return invalidResult('UNSUPPORTED_COMMAND', rawText, normalizedText);
  }

  const payloadTokens = rawTokens.slice(1);
  if (payloadTokens.length === 0) {
    return invalidResult('MISSING_IDENTIFIERS', rawText, normalizedText, requestType);
  }

  const nestedCommand = payloadTokens.find((token) => REQUEST_TYPE_SET.has(token.toUpperCase()));
  if (nestedCommand) {
    const code = nestedCommand.toUpperCase() === requestType ? 'REPEATED_COMMAND' : 'MIXED_REQUEST_TYPES';
    return invalidResult(code, rawText, normalizedText, requestType);
  }

  if (payloadTokens.length > MAX_IDENTIFIERS) {
    return invalidResult('TOO_MANY_IDENTIFIERS', rawText, normalizedText, requestType);
  }

  if (payloadTokens.some((token) => !/^\d+$/.test(token))) {
    return invalidResult('INVALID_IDENTIFIER_CHARS', rawText, normalizedText, requestType);
  }

  const definition = REQUEST_DEFINITIONS[requestType];
  if (!definition || payloadTokens.some((token) => !identifierMatchesType(definition.payload, token))) {
    return invalidResult('INVALID_IDENTIFIER_FORMAT', rawText, normalizedText, requestType);
  }

  const targetOperators = targetOperatorsForRequest(requestType, payloadTokens);
  if (definition.target === 'RELEVANT_OPERATOR' && targetOperators.length === 0) {
    const unresolved = payloadTokens.some((token) => !targetOperatorsForRequest(requestType, [token]).length);
    return invalidResult(unresolved ? 'OPERATOR_UNRESOLVED' : 'OPERATOR_MISMATCH', rawText, normalizedText, requestType);
  }

  const identifiers = payloadTokens;
  const canonicalPayload = identifiers.join(' ');
  const canonicalRequestText = `${requestType} ${canonicalPayload}`;

  return {
    ok: true,
    requestType,
    identifiers,
    payload: canonicalPayload,
    canonicalPayload,
    canonicalRequestText,
    normalizedText,
    targetOperators,
    errorCode: null,
    errors: [],
    replyText: null,
    correctionMessage: null,
    rawText
  };
}

function normalizeRequestText(rawText) {
  return String(rawText || '')
    .replace(/^@bot\s+/i, '')
    .trim()
    .replace(/\s+/g, ' ');
}

function invalidResult(errorCode, rawText, normalizedText, requestType = null) {
  const definition = ERROR_DEFINITIONS[errorCode] || ERROR_DEFINITIONS.INVALID_IDENTIFIER_FORMAT;
  return {
    ok: false,
    requestType,
    identifiers: [],
    payload: '',
    canonicalPayload: '',
    canonicalRequestText: '',
    normalizedText,
    targetOperators: [],
    errorCode,
    errors: [definition.message],
    replyText: definition.replyText,
    correctionMessage: definition.replyText,
    rawText
  };
}

function normalizeRequestType(value) {
  const normalized = String(value || '').trim().toUpperCase();
  return REQUEST_TYPE_SET.has(normalized) ? normalized : null;
}

function isMsisdn(value) {
  return /^01\d{9}$/.test(String(value || '').trim());
}

function identifierMatchesType(type, value) {
  const normalized = String(value || '').trim();
  if (type === 'MSISDN') return isMsisdn(normalized);
  if (type === 'NID') return /^\d{10,17}$/.test(normalized);
  if (type === 'IMEI') return /^\d{14,17}$/.test(normalized);
  return false;
}

module.exports = {
  DEFAULT_INVALID_FORMAT_MESSAGE,
  MAX_IDENTIFIERS,
  parseRequestText,
  normalizeRequestText,
  normalizeRequestType,
  identifierMatchesType,
  isMsisdn
};
