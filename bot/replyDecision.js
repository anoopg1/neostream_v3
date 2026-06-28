'use strict';

const pool = require('../db/pool');
const { checkCooldown } = require('../safety/cooldowns');
const { checkPoison, isUserIgnored } = require('../safety/poison');
const { classifyMessage } = require('../ai/claude');

/**
 * Calculates word-overlap ratio between two strings.
 * Used to detect repeated messages.
 * @param {string} a
 * @param {string} b
 * @returns {number} Overlap ratio between 0 and 1.
 */
function wordOverlap(a, b) {
  const wordsA = new Set(a.toLowerCase().split(/\s+/).filter(Boolean));
  const wordsB = new Set(b.toLowerCase().split(/\s+/).filter(Boolean));
  if (wordsA.size === 0 || wordsB.size === 0) return 0;
  let shared = 0;
  for (const word of wordsA) {
    if (wordsB.has(word)) shared++;
  }
  return shared / Math.max(wordsA.size, wordsB.size);
}

/**
 * Determines whether the bot should reply to a given message.
 * Implements a 7-step decision flow covering repeat detection, velocity,
 * per-user rate limits, cooldowns, poison checks, ignored-user checks,
 * and AI-based message classification.
 *
 * @param {string} message   - The raw chat message content.
 * @param {string} username  - Twitch username of the sender.
 * @param {string} viewerId  - Twitch user ID of the sender.
 * @param {string} channel   - Twitch channel name (without #).
 * @param {number} sessionId - Current session ID from the sessions table.
 * @returns {Promise<{ shouldReply: boolean, reason: string, isQuestion?: boolean, isContinuation?: boolean }>}
 */
async function shouldReply(message, username, viewerId, channel, sessionId) {
  try {
    // Step 1 — Repeat message check
    try {
      const recentMsgs = await pool.query(
        `SELECT message FROM viewer_messages
         WHERE viewer_id = $1
         ORDER BY sent_at DESC
         LIMIT 5`,
        [viewerId],
      );
      for (const row of recentMsgs.rows) {
        if (wordOverlap(message, row.message) > 0.8) {
          console.log('[replyDecision]', username, 'blocked at step 1: repeat message');
          return { shouldReply: false, reason: 'repeat' };
        }
      }
    } catch (err) {
      console.error('[replyDecision] Step 1 error:', err.message);
    }

   // Step 2 — Chat velocity check
try {
  const velocityResult = await pool.query(
    `SELECT COUNT(*) AS cnt FROM viewer_messages
     WHERE session_id = $1 AND sent_at > NOW() - INTERVAL '1 minute'`,
    [sessionId],
  );
  const chatCount = parseInt(velocityResult.rows[0].cnt, 10);
  if (chatCount >= 5 && Math.random() < 0.7) {
    console.log('[replyDecision]', username, 'blocked at step 2: high velocity');
    return { shouldReply: false, reason: 'high_velocity' };
  }
} catch (err) {
  console.error('[replyDecision] Step 2 error:', err.message);
}

    // Step 3 — Per-user rate limit (max 5 messages per minute)
    try {
      const userRateResult = await pool.query(
        `SELECT COUNT(*) AS cnt FROM viewer_messages
         WHERE viewer_id = $1 AND sent_at > NOW() - INTERVAL '1 minute'`,
        [viewerId],
      );
      const userMsgCount = parseInt(userRateResult.rows[0].cnt, 10);
      if (userMsgCount >= 5) {
        console.log('[replyDecision]', username, 'blocked at step 3: user rate limit');
        return { shouldReply: false, reason: 'user_rate_limit' };
      }
    } catch (err) {
      console.error('[replyDecision] Step 3 error:', err.message);
    }

    // Step 4 — Cooldown check with continuation bypass
    try {
      // Check for active conversation thread
      const activeConvo = await pool.query(
        `SELECT id FROM conversations
         WHERE viewer_id = $1
           AND session_id = $2
           AND is_active = true
           AND last_message_at > NOW() - INTERVAL '5 minutes'
         LIMIT 1`,
        [viewerId, sessionId],
      );
      const hasActiveConvo = activeConvo.rows.length > 0;

      // Check if bot sent a welcome to this user recently (within 5 min)
      const recentWelcome = await pool.query(
        `SELECT 1 FROM logs
         WHERE recipient = $1
           AND type = 'welcome'
           AND session_id = $2
           AND sent_at > NOW() - INTERVAL '5 minutes'
         LIMIT 1`,
        [username, sessionId],
      );
      const hasRecentWelcome = recentWelcome.rows.length > 0;

      // Check if bot sent any reply to this user recently (within 5 min)
      const recentReply = await pool.query(
        `SELECT 1 FROM logs
         WHERE recipient = $1
           AND type = 'reply'
           AND session_id = $2
           AND sent_at > NOW() - INTERVAL '5 minutes'
         LIMIT 1`,
        [username, sessionId],
      );
      const hasRecentReply = recentReply.rows.length > 0;

      const isContinuation = hasActiveConvo || hasRecentWelcome || hasRecentReply;

      if (!isContinuation) {
        const { allowed } = await checkCooldown('chat_reply', username);
        if (!allowed) {
          console.log('[replyDecision]', username, 'blocked at step 4: cooldown');
          return { shouldReply: false, reason: 'cooldown' };
        }
      }
    } catch (err) {
      console.error('[replyDecision] Step 4 error:', err.message);
    }

    // Step 5 — Poison check
    const { safe, reason: poisonReason } = await checkPoison(message, viewerId);
    if (!safe) {
      console.log('[replyDecision]', username, 'blocked at step 5: poison -', poisonReason);
      return { shouldReply: false, reason: `poison_${poisonReason}` };
    }

    // Step 6 — Ignored user check
    const ignored = await isUserIgnored(viewerId);
    if (ignored) {
      console.log('[replyDecision]', username, 'blocked at step 6: user ignored');
      return { shouldReply: false, reason: 'ignored' };
    }

    // Step 7 — Message classification via Claude
    const classification = await classifyMessage(message);
    if (!classification || !classification.needsReply) {
      console.log('[replyDecision]', username, 'blocked at step 7: classifier says no reply needed');
      return { shouldReply: false, reason: 'no_response_needed' };
    }

    console.log('[replyDecision]', username, 'REPLY APPROVED');
    return {
      shouldReply:    true,
      reason:         'ok',
      isQuestion:     classification.isQuestion || false,
      isContinuation: classification.isContinuation || false,
    };
  } catch (err) {
    console.error('[replyDecision] Unhandled error in shouldReply:', err.message);
    return { shouldReply: false, reason: 'internal_error' };
  }
}

module.exports = { shouldReply };
