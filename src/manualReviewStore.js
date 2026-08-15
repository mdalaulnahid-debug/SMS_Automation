'use strict';

const { existsSync, mkdirSync, readFileSync, writeFileSync } = require('node:fs');
const { join } = require('node:path');

class ManualReviewStore {
  constructor({
    rootDir = join(__dirname, '..', 'data', 'manual-review'),
    limitPerType = 100
  } = {}) {
    this.rootDir = rootDir;
    this.limitPerType = limitPerType;
  }

  record({ request, operator, messageBody, analysis, source }) {
    if (!request?.requestType || !messageBody) return null;

    mkdirSync(this.rootDir, { recursive: true });
    const filePath = join(this.rootDir, `${request.requestType}.json`);
    const current = this._read(filePath);
    const entry = {
      capturedAt: new Date().toISOString(),
      source: source || 'auto_match',
      requestId: request.requestId,
      requestType: request.requestType,
      operator: operator || request.operator || '',
      payload: request.payload,
      requesterName: request.requesterName || '',
      messageBody,
      analysis: {
        confidence: analysis?.confidence || 'UNKNOWN',
        payloadMatched: Boolean(analysis?.payloadMatched),
        payloadMatchCount: analysis?.payloadMatchCount || 0,
        matchedPatterns: analysis?.matchedPatterns || [],
        trainingScore: analysis?.trainingMatch?.score || 0,
        inferredReplyFamilies: analysis?.inferredReplyFamilies?.strongTypes || []
      }
    };

    const deduped = current.filter((item) => {
      return !(item.requestId === entry.requestId
        && item.operator === entry.operator
        && item.messageBody === entry.messageBody);
    });
    deduped.push(entry);
    const trimmed = deduped.slice(-this.limitPerType);
    writeFileSync(filePath, JSON.stringify(trimmed, null, 2), 'utf8');
    return entry;
  }

  _read(filePath) {
    if (!existsSync(filePath)) return [];
    try {
      const parsed = JSON.parse(readFileSync(filePath, 'utf8'));
      return Array.isArray(parsed) ? parsed : [];
    } catch {
      return [];
    }
  }
}

module.exports = { ManualReviewStore };
