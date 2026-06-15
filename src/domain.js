'use strict';

const OPERATORS = Object.freeze({
  GP: {
    name: 'GP',
    shortcode: '01714054239',
    gatewayId: 'GP_PHONE_01',
    msisdnPrefixes: ['013', '017'],
    trustedSenders: ['12345']
  },
  ROBI: {
    name: 'Robi',
    shortcode: '01833122144',
    gatewayId: 'ROBI_PHONE_01',
    msisdnPrefixes: ['016', '018'],
    trustedSenders: ['12345']   // overridden by config/gateways.json in production
  },
  BANGLALINK: {
    name: 'Banglalink',
    shortcode: '01924400990',
    gatewayId: 'BANGLALINK_PHONE_01',
    msisdnPrefixes: ['014', '019'],
    trustedSenders: ['12345']   // overridden by config/gateways.json in production
  }
});

const REQUEST_TYPES = Object.freeze({
  LRL: 'LRL',
  LCL: 'LCL',
  MS_NID: 'MS-NID',
  NID_MS: 'NID-MS',
  IMEI_MS: 'IMEI-MS'
});

const REQUEST_DEFINITIONS = Object.freeze({
  [REQUEST_TYPES.LRL]: {
    label: 'last radio location',
    target: 'RELEVANT_OPERATOR',
    payload: 'MSISDN'
  },
  [REQUEST_TYPES.LCL]: {
    label: 'last call location',
    target: 'RELEVANT_OPERATOR',
    payload: 'MSISDN'
  },
  [REQUEST_TYPES.MS_NID]: {
    label: 'mobile number to NID',
    target: 'RELEVANT_OPERATOR',
    payload: 'MSISDN'
  },
  [REQUEST_TYPES.NID_MS]: {
    label: 'NID to mobile number',
    target: 'ALL_OPERATORS',
    payload: 'NID'
  },
  [REQUEST_TYPES.IMEI_MS]: {
    label: 'IMEI number to mobile number',
    target: 'ALL_OPERATORS',
    payload: 'IMEI'
  }
});

const STATUSES = Object.freeze({
  RECEIVED: 'RECEIVED',
  VALIDATED: 'VALIDATED',
  QUEUED: 'QUEUED',
  SMS_SENT: 'SMS_SENT',
  WAITING_OPERATOR_REPLY: 'WAITING_OPERATOR_REPLY',
  REPLY_RECEIVED: 'REPLY_RECEIVED',
  WHATSAPP_REPLY_POSTED: 'WHATSAPP_REPLY_POSTED',
  COMPLETED: 'COMPLETED',
  FAILED: 'FAILED',
  TIMEOUT: 'TIMEOUT',
  NEEDS_MANUAL_REVIEW: 'NEEDS_MANUAL_REVIEW'
});

// Per-operator dispatch lifecycle for fan-out requests (architecture.md §5). Request-level
// status is derived from these: NEEDS_MANUAL_REVIEW once all dispatches are terminal and at
// least one reply arrived; TIMEOUT only when every dispatch timed out.
const DISPATCH_STATUSES = Object.freeze({
  QUEUED: 'QUEUED',
  WAITING_REPLY: 'WAITING_REPLY',
  REPLY_RECEIVED: 'REPLY_RECEIVED',
  TIMEOUT: 'TIMEOUT',
  FAILED: 'FAILED'
});

const TERMINAL_DISPATCH_STATUSES = Object.freeze([
  DISPATCH_STATUSES.REPLY_RECEIVED,
  DISPATCH_STATUSES.TIMEOUT,
  DISPATCH_STATUSES.FAILED
]);

const STATUS_TRANSITIONS = Object.freeze({
  [STATUSES.RECEIVED]: [STATUSES.VALIDATED, STATUSES.FAILED],
  [STATUSES.VALIDATED]: [STATUSES.QUEUED, STATUSES.FAILED],
  [STATUSES.QUEUED]: [STATUSES.SMS_SENT, STATUSES.FAILED],
  [STATUSES.SMS_SENT]: [STATUSES.WAITING_OPERATOR_REPLY, STATUSES.FAILED],
  [STATUSES.WAITING_OPERATOR_REPLY]: [
    STATUSES.REPLY_RECEIVED,
    STATUSES.TIMEOUT,
    STATUSES.NEEDS_MANUAL_REVIEW,
    STATUSES.FAILED
  ],
  [STATUSES.REPLY_RECEIVED]: [STATUSES.NEEDS_MANUAL_REVIEW, STATUSES.WHATSAPP_REPLY_POSTED],
  [STATUSES.NEEDS_MANUAL_REVIEW]: [STATUSES.WHATSAPP_REPLY_POSTED, STATUSES.FAILED, STATUSES.QUEUED],
  [STATUSES.WHATSAPP_REPLY_POSTED]: [STATUSES.COMPLETED],
  [STATUSES.COMPLETED]: [],
  [STATUSES.FAILED]: [STATUSES.QUEUED],
  [STATUSES.TIMEOUT]: [STATUSES.QUEUED, STATUSES.WAITING_OPERATOR_REPLY]
});

function normalizeOperator(value) {
  const normalized = String(value || '').trim().toUpperCase();
  if (normalized === 'BANGLA' || normalized === 'BL') return 'BANGLALINK';
  if (normalized === 'ROBI') return 'ROBI';
  if (normalized === 'GP') return 'GP';
  return null;
}

function operatorForMsisdn(msisdn) {
  const normalized = String(msisdn || '').trim();
  return Object.entries(OPERATORS).find(([, operator]) =>
    operator.msisdnPrefixes.some((prefix) => normalized.startsWith(prefix))
  )?.[0] || null;
}

function targetOperatorsForRequest(requestType, payload) {
  const definition = REQUEST_DEFINITIONS[requestType];
  if (!definition) return [];
  if (definition.target === 'ALL_OPERATORS') return Object.keys(OPERATORS);
  const operator = operatorForMsisdn(payload);
  return operator ? [operator] : [];
}

function formatOperatorSms(request, operatorKey) {
  return `${request.requestType} ${request.payload}`;
}

function operatorForGateway(gatewayId) {
  return Object.entries(OPERATORS).find(([, operator]) => operator.gatewayId === gatewayId)?.[0] || null;
}

function isTrustedSenderForGateway(gatewayId, sender) {
  const operatorKey = operatorForGateway(gatewayId);
  if (!operatorKey) return false;
  const normalizedSender = String(sender || '').trim().toUpperCase();
  return OPERATORS[operatorKey].trustedSenders.some((trustedSender) => {
    return normalizedSender === String(trustedSender).trim().toUpperCase();
  });
}

function assertTransition(from, to) {
  if (from === to) return;
  const allowed = STATUS_TRANSITIONS[from] || [];
  if (!allowed.includes(to)) {
    throw new Error(`Invalid request status transition: ${from} -> ${to}`);
  }
}

function normalizePhoneNumber(value) {
  const digits = String(value || '').replace(/\D/g, '');
  if (!digits) return '';
  if (digits.startsWith('880') && digits.length >= 12) {
    return `0${digits.slice(3)}`;
  }
  return digits;
}

function normalizeSenderId(value) {
  const phone = normalizePhoneNumber(value);
  if (phone) return phone;
  return String(value || '').trim().toUpperCase();
}

function createRequestId(date = new Date(), sequence = 1) {
  const yyyy = date.getUTCFullYear();
  const mm = String(date.getUTCMonth() + 1).padStart(2, '0');
  const dd = String(date.getUTCDate()).padStart(2, '0');
  const unique = Math.random().toString(36).slice(2, 6).toUpperCase();
  return `REQ-${yyyy}${mm}${dd}-${String(sequence).padStart(4, '0')}-${unique}`;
}

module.exports = {
  OPERATORS,
  REQUEST_TYPES,
  REQUEST_DEFINITIONS,
  STATUSES,
  DISPATCH_STATUSES,
  TERMINAL_DISPATCH_STATUSES,
  STATUS_TRANSITIONS,
  normalizeOperator,
  normalizePhoneNumber,
  normalizeSenderId,
  operatorForMsisdn,
  targetOperatorsForRequest,
  formatOperatorSms,
  operatorForGateway,
  isTrustedSenderForGateway,
  createRequestId,
  assertTransition
};
