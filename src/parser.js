'use strict';

const {
  REQUEST_DEFINITIONS,
  REQUEST_TYPES,
  targetOperatorsForRequest
} = require('./domain');

const REQUEST_TYPE_SET = new Set(Object.values(REQUEST_TYPES));
const MAX_IDENTIFIERS = 5;

const HYPHENATED_COMMANDS = Object.freeze({
  'MS NID': 'MS-NID',
  'NID MS': 'NID-MS',
  'IMEI MS': 'IMEI-MS'
});

const GLUED_PREFIX_RE = /^(IMEI-?MS|MS-?NID|NID-?MS|LRL|LCL)[-:_,.]?(\d.*)$/i;

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
    replyText: null
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

function tryAutoCorrectCommand(tokens) {
  if (tokens.length === 0) return null;

  const first = tokens[0].toUpperCase();

  // Pattern 1: two leading tokens form a known hyphenated command
  // e.g. ['MS', 'NID', '01625242040'] → ['MS-NID', '01625242040']
  if (tokens.length >= 2) {
    const twoTokenKey = `${first} ${tokens[1].toUpperCase()}`;
    const joined = HYPHENATED_COMMANDS[twoTokenKey];
    if (joined) {
      return { correctedTokens: [joined, ...tokens.slice(2)], correctedCommand: joined };
    }
  }

  // Pattern 2: first token has a known command glued to digits
  // e.g. 'LRL01308218563' → ['LRL', '01308218563']
  // e.g. 'MSNID01625242040' → ['MS-NID', '01625242040']
  const gluedMatch = first.match(GLUED_PREFIX_RE);
  if (gluedMatch) {
    let prefix = gluedMatch[1].toUpperCase();
    const remainder = gluedMatch[2];
    // Normalize unhyphenated compound prefixes
    if (prefix === 'MSNID' || prefix === 'MS-NID') prefix = 'MS-NID';
    else if (prefix === 'NIDMS' || prefix === 'NID-MS') prefix = 'NID-MS';
    else if (prefix === 'IMEIMS' || prefix === 'IMEI-MS') prefix = 'IMEI-MS';
    if (REQUEST_TYPE_SET.has(prefix)) {
      return { correctedTokens: [prefix, remainder, ...tokens.slice(1)], correctedCommand: prefix };
    }
  }

  return null;
}

function parseRequestText(rawText) {
  const normalizedText = normalizeRequestText(rawText);
  const rawTokens = normalizedText ? normalizedText.split(' ') : [];

  if (rawTokens.length === 0) {
    return invalidResult('EMPTY_MESSAGE', rawText, normalizedText);
  }

  let commandToken = rawTokens[0];
  let requestType = normalizeRequestType(commandToken);
  let correctionApplied = null;
  let tokens = rawTokens;

  if (!requestType) {
    const correction = tryAutoCorrectCommand(rawTokens);
    if (correction) {
      tokens = correction.correctedTokens;
      commandToken = tokens[0];
      requestType = normalizeRequestType(commandToken);
      correctionApplied = `Auto-corrected to: ${tokens.join(' ')}`;
    }
  }

  if (!requestType) {
    return invalidResult('UNSUPPORTED_COMMAND', rawText, normalizedText);
  }

  const payloadTokens = tokens.slice(1);
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

  const sanitizedPayload = payloadTokens.map((token) => {
    let cleaned = token.replace(/[-:_,.+]/g, '');
    if (/^880[1-9]\d{9}$/.test(cleaned)) cleaned = '0' + cleaned.slice(3);
    return cleaned;
  });
  if (sanitizedPayload.some((token) => !/^\d+$/.test(token))) {
    return invalidResult('INVALID_IDENTIFIER_CHARS', rawText, normalizedText, requestType);
  }
  if (sanitizedPayload.some((t, i) => t !== payloadTokens[i])) {
    correctionApplied = `Auto-corrected to: ${requestType} ${sanitizedPayload.join(' ')}`;
  }

  const definition = REQUEST_DEFINITIONS[requestType];
  if (!definition) {
    return invalidResult('INVALID_IDENTIFIER_FORMAT', rawText, normalizedText, requestType);
  }
  const formatError = diagnoseIdentifierError(definition.payload, sanitizedPayload, requestType);
  if (formatError) {
    return invalidResultWithText('INVALID_IDENTIFIER_FORMAT', formatError, rawText, normalizedText, requestType);
  }

  const targetOperators = targetOperatorsForRequest(requestType, sanitizedPayload);
  if (definition.target === 'RELEVANT_OPERATOR' && targetOperators.length === 0) {
    const unresolved = sanitizedPayload.some((token) => !targetOperatorsForRequest(requestType, [token]).length);
    return invalidResult(unresolved ? 'OPERATOR_UNRESOLVED' : 'OPERATOR_MISMATCH', rawText, normalizedText, requestType);
  }

  const identifiers = sanitizedPayload;
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
    correctionMessage: correctionApplied,
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
  const replyText = definition.replyText || DEFAULT_INVALID_FORMAT_MESSAGE;
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
    replyText,
    correctionMessage: replyText,
    rawText
  };
}

function invalidResultWithText(errorCode, replyText, rawText, normalizedText, requestType = null) {
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
    replyText,
    correctionMessage: replyText,
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
  if (type === 'NID') return isNid(normalized);
  if (type === 'IMEI') return isImei(normalized);
  return false;
}

function isNid(value) {
  const len = value.length;
  return /^\d+$/.test(value) && (len === 10 || len === 13 || len === 17);
}

function isImei(value) {
  const len = value.length;
  return /^\d+$/.test(value) && (len === 14 || len === 15);
}

function looksLikeNid(value) {
  const len = value.length;
  return /^\d+$/.test(value) && (len === 10 || len === 13 || len === 17);
}

function looksLikeImei(value) {
  const len = value.length;
  return /^\d+$/.test(value) && (len === 14 || len === 15);
}

function looksLikeMsisdn(value) {
  return /^01\d{9}$/.test(value);
}

function diagnoseIdentifierError(expectedType, identifiers, requestType) {
  for (const id of identifiers) {
    if (identifierMatchesType(expectedType, id)) continue;

    const len = id.length;

    if (expectedType === 'MSISDN') {
      if (looksLikeNid(id)) {
        return `"${id}" looks like an NID (${len} digits), not a phone number. ${requestType} requires an 11-digit mobile number starting with 01.`;
      }
      if (looksLikeImei(id)) {
        return `"${id}" looks like an IMEI (${len} digits), not a phone number. ${requestType} requires an 11-digit mobile number starting with 01.`;
      }
      if (len < 11) {
        return `"${id}" is too short (${len} digits). Phone numbers must be 11 digits starting with 01, e.g. 01710000000.`;
      }
      if (len > 11) {
        return `"${id}" is too long (${len} digits). Phone numbers must be 11 digits starting with 01, e.g. 01710000000.`;
      }
      if (!/^01/.test(id)) {
        return `"${id}" does not start with 01. Bangladesh mobile numbers must start with 01.`;
      }
      return `"${id}" is not a valid mobile number. ${requestType} requires an 11-digit number starting with 01.`;
    }

    if (expectedType === 'NID') {
      if (looksLikeMsisdn(id)) {
        return `"${id}" looks like a phone number, not an NID. ${requestType} requires an NID (10, 13, or 17 digits).`;
      }
      if (looksLikeImei(id)) {
        return `"${id}" looks like an IMEI (${len} digits), not an NID. ${requestType} requires an NID (10, 13, or 17 digits).`;
      }
      if (len < 10) {
        return `"${id}" is too short (${len} digits). NID must be 10 digits (smart NID), 13 digits, or 17 digits (old NID with birth year).`;
      }
      if (len === 11 || len === 12 || (len > 13 && len < 17)) {
        return `"${id}" has ${len} digits which is not a valid NID length. NID must be exactly 10, 13, or 17 digits.`;
      }
      if (len > 17) {
        return `"${id}" is too long (${len} digits). NID must be 10 digits (smart NID), 13 digits, or 17 digits (old NID with birth year).`;
      }
      return `"${id}" is not a valid NID. ${requestType} requires an NID (10, 13, or 17 digits).`;
    }

    if (expectedType === 'IMEI') {
      if (looksLikeMsisdn(id)) {
        return `"${id}" looks like a phone number, not an IMEI. ${requestType} requires a 14 or 15 digit IMEI.`;
      }
      if (looksLikeNid(id)) {
        return `"${id}" looks like an NID (${len} digits), not an IMEI. ${requestType} requires a 14 or 15 digit IMEI.`;
      }
      if (len < 14) {
        return `"${id}" is too short (${len} digits). IMEI must be 14 digits (without check digit) or 15 digits (with check digit).`;
      }
      if (len > 15) {
        return `"${id}" is too long (${len} digits). IMEI must be 14 digits (without check digit) or 15 digits (with check digit).`;
      }
      return `"${id}" is not a valid IMEI. ${requestType} requires a 14 or 15 digit IMEI.`;
    }
  }
  return null;
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
