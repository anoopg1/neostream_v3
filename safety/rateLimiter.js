'use strict';

const WINDOW_MS     = 30_000;
const MAX_PER_WINDOW = 20;

/** @type {number[]} Timestamps of recent outgoing messages. */
const messageTimestamps = [];

/**
 * Sliding-window rate limiter for outgoing bot messages.
 * Enforces a maximum of 20 messages per 30-second window.
 * @returns {{ allowed: boolean, retryAfterMs: number }}
 */
function checkRateLimit() {
  const now = Date.now();
  const windowStart = now - WINDOW_MS;

  while (messageTimestamps.length > 0 && messageTimestamps[0] < windowStart) {
    messageTimestamps.shift();
  }

  if (messageTimestamps.length >= MAX_PER_WINDOW) {
    const oldestInWindow = messageTimestamps[0];
    const retryAfterMs   = oldestInWindow + WINDOW_MS - now;
    return { allowed: false, retryAfterMs };
  }

  messageTimestamps.push(now);
  return { allowed: true, retryAfterMs: 0 };
}

/**
 * Returns the current count of messages sent within the active window.
 * @returns {number}
 */
function getCurrentWindowCount() {
  const windowStart = Date.now() - WINDOW_MS;
  return messageTimestamps.filter((t) => t >= windowStart).length;
}

module.exports = { checkRateLimit, getCurrentWindowCount };
