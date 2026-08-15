'use strict';

// Behavioral anomaly tripwire (security-hardening v1 §11) — a soft net
// underneath the hard quota/OTP wall (src/quota.js, src/otp.js), not a
// replacement for it. Runs on metadata already available from every
// Telegram submission (no new Bot API capability needed) and flags review
// items for admins; it never blocks a request itself.
//
// Signals:
//  - Off-hours submission timing
//  - Burst/bulk volume (a softer, earlier warning than the hard quota)
//  - language_code / username drift for a given linked officer
//  - Sudden request-type pattern shift

const DEFAULT_OFF_HOURS_START = 22; // 22:00 local
const DEFAULT_OFF_HOURS_END = 6; // 06:00 local
const DEFAULT_BURST_THRESHOLD = 8;
const DEFAULT_BURST_WINDOW_MS = 5 * 60 * 1000;
const DEFAULT_MIN_HISTORY_FOR_PATTERN_SHIFT = 5;
const DEFAULT_PATTERN_DOMINANCE_RATIO = 0.7;
// Bangladesh Standard Time — UTC+6, no DST. The system this analyzes has
// exactly one real-world timezone of officers, so a fixed offset is
// correct, not a simplification that will need revisiting.
const DEFAULT_UTC_OFFSET_MINUTES = 360;

class AnomalyDetector {
  constructor({
    now = () => Date.now(),
    offHoursStart = DEFAULT_OFF_HOURS_START,
    offHoursEnd = DEFAULT_OFF_HOURS_END,
    burstThreshold = DEFAULT_BURST_THRESHOLD,
    burstWindowMs = DEFAULT_BURST_WINDOW_MS,
    minHistoryForPatternShift = DEFAULT_MIN_HISTORY_FOR_PATTERN_SHIFT,
    patternDominanceRatio = DEFAULT_PATTERN_DOMINANCE_RATIO,
    utcOffsetMinutes = DEFAULT_UTC_OFFSET_MINUTES
  } = {}) {
    this.now = now;
    this.offHoursStart = offHoursStart;
    this.offHoursEnd = offHoursEnd;
    this.burstThreshold = burstThreshold;
    this.burstWindowMs = burstWindowMs;
    this.minHistoryForPatternShift = minHistoryForPatternShift;
    this.patternDominanceRatio = patternDominanceRatio;
    this.utcOffsetMinutes = utcOffsetMinutes;
    this.profiles = new Map(); // officerId -> profile
  }

  _getOrCreateProfile(officerId) {
    let profile = this.profiles.get(officerId);
    if (!profile) {
      profile = {
        recentTimestamps: [],
        lastLanguageCode: null,
        lastUsername: null,
        requestTypeCounts: {},
        totalTypedRequests: 0
      };
      this.profiles.set(officerId, profile);
    }
    return profile;
  }

  _localHour(timestamp) {
    return new Date(timestamp + this.utcOffsetMinutes * 60 * 1000).getUTCHours();
  }

  _isOffHours(timestamp) {
    const hour = this._localHour(timestamp);
    // The window wraps midnight (e.g. 22:00-06:00), so a simple range check
    // depends on which bound is larger.
    if (this.offHoursStart > this.offHoursEnd) {
      return hour >= this.offHoursStart || hour < this.offHoursEnd;
    }
    return hour >= this.offHoursStart && hour < this.offHoursEnd;
  }

  // Records one submission attempt for the given officer and returns an
  // array of flags (empty if nothing looked anomalous). languageCode/
  // username/requestType may be null — a garbled request that never parsed
  // still has a sender and a timestamp, just no requestType yet.
  recordAndCheck(officerId, { timestamp, languageCode = null, username = null, requestType = null } = {}) {
    const ts = timestamp ?? this.now();
    const profile = this._getOrCreateProfile(officerId);
    const flags = [];

    if (this._isOffHours(ts)) {
      flags.push({
        type: 'OFF_HOURS_SUBMISSION',
        detail: `Submitted at ${new Date(ts).toISOString()} (outside the ${String(this.offHoursEnd).padStart(2, '0')}:00-${String(this.offHoursStart).padStart(2, '0')}:00 normal window)`
      });
    }

    profile.recentTimestamps = profile.recentTimestamps.filter((t) => ts - t < this.burstWindowMs);
    profile.recentTimestamps.push(ts);
    if (profile.recentTimestamps.length > this.burstThreshold) {
      flags.push({
        type: 'BURST_VOLUME',
        detail: `${profile.recentTimestamps.length} requests within ${Math.round(this.burstWindowMs / 60000)} minute(s)`
      });
    }

    if (profile.lastLanguageCode && languageCode && profile.lastLanguageCode !== languageCode) {
      flags.push({ type: 'IDENTITY_DRIFT', detail: `language_code changed from "${profile.lastLanguageCode}" to "${languageCode}"` });
    }
    if (profile.lastUsername && username && profile.lastUsername !== username) {
      flags.push({ type: 'IDENTITY_DRIFT', detail: `Telegram username changed from @${profile.lastUsername} to @${username}` });
    }
    if (languageCode) profile.lastLanguageCode = languageCode;
    if (username) profile.lastUsername = username;

    if (requestType) {
      // Compared against history BEFORE this request is folded in — a
      // pattern shift is measured against what came before, not itself.
      if (profile.totalTypedRequests >= this.minHistoryForPatternShift) {
        const [dominantType, dominantCount] = Object.entries(profile.requestTypeCounts)
          .sort((a, b) => b[1] - a[1])[0] || [null, 0];
        if (dominantType && dominantType !== requestType && dominantCount / profile.totalTypedRequests >= this.patternDominanceRatio) {
          flags.push({
            type: 'REQUEST_TYPE_SHIFT',
            detail: `Usually submits ${dominantType} (${dominantCount}/${profile.totalTypedRequests}); this request is ${requestType}`
          });
        }
      }
      profile.requestTypeCounts[requestType] = (profile.requestTypeCounts[requestType] || 0) + 1;
      profile.totalTypedRequests += 1;
    }

    return flags;
  }
}

module.exports = { AnomalyDetector };
