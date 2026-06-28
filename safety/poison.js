'use strict';

/**
 * Content poison detection layer.
 * Protects against prompt injection, slur baiting,
 * and coordinated content attacks.
 */

const pool = require('../db/pool');

const INJECTION_PATTERNS = [
  /ignore\s+previous\s+instructions/i,
  /ignore\s+all\s+instructions/i,
  /pretend\s+you\s+are/i,
  /\bact\s+as\b/i,
  /you\s+are\s+now/i,
  /forget\s+everything/i,
  /new\s+persona/i,
  /your\s+instructions/i,
  /system\s+prompt/i,
  /jailbreak/i,
  /dan\s+mode/i,
];

const REPEAT_COMMAND_PATTERNS = [
  /^say\s+/i,
  /^type\s+/i,
  /^write\s+/i,
  /^repeat\s+/i,
  /tell\s+everyone/i,
  /announce\s+that/i,
];

const NAMED_POLITICIANS = [
  /\btrump\b/i,
  /\bbiden\b/i,
  /\bobama\b/i,
  /\bclinton\b/i,
  /\bbush\b/i,
  /\bmacron\b/i,
  /\bboris\s+johnson\b/i,
  /\bputin\b/i,
  /\bxi\s+jinping\b/i,
];

const SLUR_PATTERNS = [
  /\bn[i1]gg[ae3]r\b/i,
  /\bf[a@]gg[o0]t\b/i,
  /\bch[i1]nk\b/i,
  /\bsp[i1]c\b/i,
  /\bk[i1]ke\b/i,
  /\bcr[a@]cker\b/i,
  /\bwh[o0]re\b/i,
  /\bc[u0]nt\b/i,
  /\br[e3]t[a@]rd\b/i,
];

const SEXUAL_KEYWORDS = [
  /\bporn\b/i,
  /\bsex(?:ual)?\b/i,
  /\bnud[ei]\b/i,
  /\bonlyfans\b/i,
  /\bnsfw\b/i,
  /\bpenis\b/i,
  /\bvagina\b/i,
  /\bboobs?\b/i,
  /\bdick\b/i,
  /\bfuck\b/i,
];

const RELIGIOUS_PROVOCATIONS = [
  /\ballah\s+is\s+/i,
  /\bgod\s+is\s+(?:fake|dead|not\s+real)/i,
  /\bmuslim[s]?\s+(?:are|should)\b/i,
  /\bjew[s]?\s+(?:are|control)\b/i,
];

/**
 * Runs all poison pattern checks against a raw chat message.
 * Escalates ignore timeouts on repeat offenders using the flagged_users table.
 * @param {string} message  - Raw chat message content.
 * @param {string} viewerId - Twitch user ID of the sender.
 * @returns {Promise<{ safe: boolean, reason: string|null }>}
 */
async function checkPoison(message, viewerId) {
  let detectedReason = null;

  for (const pattern of INJECTION_PATTERNS) {
    if (pattern.test(message)) { detectedReason = 'prompt_injection'; break; }
  }

  if (!detectedReason) {
    for (const pattern of REPEAT_COMMAND_PATTERNS) {
      if (pattern.test(message)) { detectedReason = 'repeat_command'; break; }
    }
  }

  if (!detectedReason) {
    for (const pattern of SLUR_PATTERNS) {
      if (pattern.test(message)) { detectedReason = 'slur'; break; }
    }
  }

  if (!detectedReason) {
    for (const pattern of SEXUAL_KEYWORDS) {
      if (pattern.test(message)) { detectedReason = 'sexual_content'; break; }
    }
  }

  if (!detectedReason) {
    for (const pattern of NAMED_POLITICIANS) {
      if (pattern.test(message)) { detectedReason = 'political_content'; break; }
    }
  }

  if (!detectedReason) {
    for (const pattern of RELIGIOUS_PROVOCATIONS) {
      if (pattern.test(message)) { detectedReason = 'religious_provocation'; break; }
    }
  }

  if (!detectedReason) {
    return { safe: true, reason: null };
  }

  try {
    const existing = await pool.query(
      'SELECT twitch_id, username, flag_count FROM flagged_users WHERE twitch_id = $1',
      [viewerId],
    );

    if (existing.rows.length === 0) {
      const ignoreUntil = new Date(Date.now() + 24 * 60 * 60 * 1000);
      await pool.query(
        `INSERT INTO flagged_users (twitch_id, username, flag_count, last_flagged_at, ignore_until, reason)
         VALUES ($1, $2, 1, NOW(), $3, $4)
         ON CONFLICT (twitch_id) DO NOTHING`,
        [viewerId, viewerId, ignoreUntil, detectedReason],
      );
    } else {
      const { flag_count } = existing.rows[0];
      if (flag_count === 1) {
        const ignoreUntil = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);
        await pool.query(
          `UPDATE flagged_users
           SET flag_count = 2, last_flagged_at = NOW(), ignore_until = $1, reason = $2
           WHERE twitch_id = $3`,
          [ignoreUntil, detectedReason, viewerId],
        );
      } else if (flag_count >= 2) {
        await pool.query(
          `UPDATE flagged_users
           SET flag_count = flag_count + 1, last_flagged_at = NOW(),
               permanently_ignored = true, reason = $1
           WHERE twitch_id = $2`,
          [detectedReason, viewerId],
        );
      }
    }

    try {
      const { emit } = require('../websocket/server');
      emit('POISON_DETECTED', { viewerId, reason: detectedReason });
    } catch (_) {}
  } catch (err) {
    console.error('[poison] DB update failed:', err.message);
  }

  return { safe: false, reason: detectedReason };
}

/**
 * Checks whether a user is currently on an active or permanent ignore list.
 * @param {string} viewerId - Twitch user ID to check.
 * @returns {Promise<boolean>} True if the user should be ignored.
 */
async function isUserIgnored(viewerId) {
  try {
    const result = await pool.query(
      `SELECT permanently_ignored, ignore_until
       FROM flagged_users
       WHERE twitch_id = $1`,
      [viewerId],
    );

    if (result.rows.length === 0) return false;

    const { permanently_ignored, ignore_until } = result.rows[0];
    if (permanently_ignored) return true;
    if (ignore_until && new Date(ignore_until) > new Date()) return true;

    return false;
  } catch (err) {
    console.error('[poison] isUserIgnored error:', err.message);
    return false;
  }
}

module.exports = { checkPoison, isUserIgnored };
