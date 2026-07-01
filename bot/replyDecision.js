'use strict';

const pool = require('../db/pool');
const { checkCooldown } = require('../safety/cooldowns');
const { checkPoison, isUserIgnored } = require('../safety/poison');
const { classifyMessage } = require('../ai/claude');

/**
 * Filters out stop words and short tokens for meaningful overlap comparison.
 * Keeps streamer-directed tokens (neo, bro, hey) so short messages like
 * "had food neo" are never falsely collapsed to a single-token set.
 * @param {string} str
 * @returns {Set<string>}
 */
function tokenize(str) {
  const STOP_WORDS = new Set([
    'the','a','an','is','are','was','were','be','been','have','has',
    'had','do','does','did','will','would','could','should','may',
    'might','shall','can','to','of','in','on','at','by','for','with',
    'about','as','into','through','and','or','but','if','so','yet',
    'nor','i','you','he','she','it','we','they','me','him','her','us',
    'them','my','your','his','its','our','their','this','that','these',
    'those','what','which','who','how','all','just','not','no','up',
    'out','get','go','lol','lmao','omg','haha','oh','ah','uh','ok','okay',
  ]);
  return new Set(
    str.toLowerCase()
      .split(/\s+/)
      .map(w => w.replace(/[^a-z0-9]/g, ''))
      .filter(w => w.length > 2 && !STOP_WORDS.has(w))
  );
}

/**
 * Calculates meaningful word overlap between two messages.
 * Returns 0 if either message tokenizes to ≤1 word — prevents short messages
 * like "had food neo" from being falsely blocked as duplicates of each other.
 * @param {string} a
 * @param {string} b
 * @returns {number} 0-1
 */
function wordOverlap(a, b) {
  const wordsA = tokenize(a);
  const wordsB = tokenize(b);
  if (wordsA.size === 0 || wordsB.size === 0) return 0;
  // Guard: short messages share too few tokens to compare reliably
  if (wordsA.size <= 1 || wordsB.size <= 1) return 0;
  let shared = 0;
  for (const word of wordsA) {
    if (wordsB.has(word)) shared++;
  }
  return shared / Math.max(wordsA.size, wordsB.size);
}

/**
 * Full 8-step decision flow determining if the bot should reply.
 * Step order: repeat → continuation → velocity → user-rate → cooldown →
 *             poison → ignored → classify.
 * Continuation detection is in step 2 so steps 3-5 can be bypassed for
 * active threads (prevents dropping mid-conversation replies during busy chat).
 *
 * @param {string} message
 * @param {string} username
 * @param {string} viewerId
 * @param {string} channel
 * @param {number} sessionId
 * @returns {Promise<{shouldReply: boolean, reason: string, isQuestion?: boolean, isContinuation?: boolean}>}
 */
async function shouldReply(message, username, viewerId, channel, sessionId) {
  try {

    // ── Step 1 — Repeat message check (current session only) ──────────────
    try {
      const recentMsgs = await pool.query(
        `SELECT message FROM viewer_messages
         WHERE viewer_id = $1
           AND session_id = $2
         ORDER BY sent_at DESC
         LIMIT 5`,
        [viewerId, sessionId],
      );
      for (const row of recentMsgs.rows) {
        if (wordOverlap(message, row.message) > 0.9) {
          console.log('[replyDecision]', username, 'blocked at step 1: repeat message');
          return { shouldReply: false, reason: 'repeat' };
        }
      }
    } catch (err) {
      console.error('[replyDecision] Step 1 error:', err.message);
    }

    // ── Step 2 — Continuation detection (MUST run before velocity/cooldown) ─
    // Checks logs (always populated) and conversations (populated after C4 fix).
    // If a welcome or reply was sent to this user in the last 5 minutes, or if
    // they have an active conversation thread, skip velocity/rate/cooldown gates.
    let isContinuation = false;
    try {
      const recentInteraction = await pool.query(
        `SELECT 1 FROM logs
         WHERE recipient = $1
           AND type IN ('welcome', 'reply')
           AND session_id = $2
           AND sent_at > NOW() - INTERVAL '5 minutes'
         LIMIT 1`,
        [username, sessionId],
      );
      if (recentInteraction.rows.length > 0) {
        isContinuation = true;
      } else {
        // Also check conversations table (populated via updateConversation)
        const activeConvo = await pool.query(
          `SELECT 1 FROM conversations
           WHERE viewer_id = $1
             AND session_id = $2
             AND last_message_at > NOW() - INTERVAL '5 minutes'
           LIMIT 1`,
          [viewerId, sessionId],
        );
        isContinuation = activeConvo.rows.length > 0;
      }
    } catch (err) {
      console.error('[replyDecision] Step 2 error:', err.message);
    }

    // ── Step 3 — Chat velocity (bypassed for continuations) ───────────────
    if (!isContinuation) {
      try {
        const velocityResult = await pool.query(
          `SELECT COUNT(*) AS cnt FROM viewer_messages
           WHERE session_id = $1
             AND sent_at > NOW() - INTERVAL '1 minute'`,
          [sessionId],
        );
        const chatCount = parseInt(velocityResult.rows[0].cnt, 10);
        if (chatCount >= 5 && Math.random() < 0.7) {
          console.log('[replyDecision]', username, 'blocked at step 3: high velocity');
          return { shouldReply: false, reason: 'high_velocity' };
        }
      } catch (err) {
        console.error('[replyDecision] Step 3 error:', err.message);
      }
    }

    // ── Step 4 — Per-user rate limit (bypassed for continuations) ────────
    if (!isContinuation) {
      try {
        const userRateResult = await pool.query(
          `SELECT COUNT(*) AS cnt FROM viewer_messages
           WHERE viewer_id = $1
             AND session_id = $2
             AND sent_at > NOW() - INTERVAL '1 minute'`,
          [viewerId, sessionId],
        );
        const userMsgCount = parseInt(userRateResult.rows[0].cnt, 10);
        if (userMsgCount >= 5) {
          console.log('[replyDecision]', username, 'blocked at step 4: user rate limit');
          return { shouldReply: false, reason: 'user_rate_limit' };
        }
      } catch (err) {
        console.error('[replyDecision] Step 4 error:', err.message);
      }
    }

    // ── Step 5 — Cooldown (bypassed for continuations) ───────────────────
    if (!isContinuation) {
      try {
        const { allowed } = await checkCooldown('chat_reply', username);
        if (!allowed) {
          console.log('[replyDecision]', username, 'blocked at step 5: cooldown');
          return { shouldReply: false, reason: 'cooldown' };
        }
      } catch (err) {
        console.error('[replyDecision] Step 5 error:', err.message);
      }
    }

    // ── Step 6 — Poison check ─────────────────────────────────────────────
    try {
      const { safe, reason: poisonReason } = await checkPoison(message, viewerId, username);
      if (!safe) {
        console.log('[replyDecision]', username, 'blocked at step 6: poison -', poisonReason);
        return { shouldReply: false, reason: `poison_${poisonReason}` };
      }
    } catch (err) {
      console.error('[replyDecision] Step 6 error:', err.message);
    }

    // ── Step 7 — Ignored user check ──────────────────────────────────────
    try {
      const ignored = await isUserIgnored(viewerId);
      if (ignored) {
        console.log('[replyDecision]', username, 'blocked at step 7: user ignored');
        return { shouldReply: false, reason: 'ignored' };
      }
    } catch (err) {
      console.error('[replyDecision] Step 7 error:', err.message);
    }

    // ── Step 8 — Claude message classification ────────────────────────────
    try {
      const classification = await classifyMessage(message, sessionId);
      if (!classification || !classification.needsReply) {
        console.log('[replyDecision]', username, 'blocked at step 8: classifier says no reply needed');
        return { shouldReply: false, reason: 'no_response_needed' };
      }

      console.log('[replyDecision]', username, 'REPLY APPROVED');
      return {
        shouldReply:    true,
        reason:         'ok',
        isQuestion:     classification.isQuestion                      || false,
        isContinuation: isContinuation || classification.isContinuation || false,
      };
    } catch (err) {
      console.error('[replyDecision] Step 8 error:', err.message);
      return { shouldReply: false, reason: 'classifier_error' };
    }

  } catch (err) {
    console.error('[replyDecision] Unhandled error:', err.message);
    return { shouldReply: false, reason: 'internal_error' };
  }
}

module.exports = { shouldReply };
