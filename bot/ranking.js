'use strict';

const pool = require('../db/pool');

// Point values awarded for viewer actions
const POINTS_CHAT_MESSAGE        = 1;
const POINTS_SESSION_ATTENDANCE  = 10;
const POINTS_SUB                 = 500;
const POINTS_CHEER_PER_100_BITS  = 50;

const RANK_THRESHOLDS = [
  { rank: 'Legend',  min: 5000 },
  { rank: 'Veteran', min: 1000 },
  { rank: 'Regular', min: 250  },
  { rank: 'Chatter', min: 50   },
  { rank: 'Lurker',  min: 0    },
];

/**
 * Awards points to a viewer and updates their rank if a threshold is crossed.
 * @param {string} viewerId - Twitch user ID.
 * @param {number} points   - Number of points to add.
 * @returns {Promise<void>}
 */
async function updateViewerPoints(viewerId, points) {
  try {
    await pool.query(
      `UPDATE viewers
       SET points = points + $1, last_seen = NOW()
       WHERE twitch_id = $2`,
      [points, viewerId],
    );
    await recalculateRank(viewerId);
  } catch (err) {
    console.error('[ranking] updateViewerPoints error:', err.message);
  }
}

/**
 * Determines the rank label for a given point total.
 * @param {number} points - Current viewer point total.
 * @returns {string} Rank label.
 */
function calculateRank(points) {
  for (const tier of RANK_THRESHOLDS) {
    if (points >= tier.min) return tier.rank;
  }
  return 'Lurker';
}

/**
 * Reads a viewer's current points and writes the correct rank to the database.
 * @param {string} viewerId - Twitch user ID.
 * @returns {Promise<void>}
 */
async function recalculateRank(viewerId) {
  try {
    const result = await pool.query(
      'SELECT points FROM viewers WHERE twitch_id = $1',
      [viewerId],
    );
    if (result.rows.length === 0) return;
    const rank = calculateRank(result.rows[0].points);
    await pool.query('UPDATE viewers SET rank = $1 WHERE twitch_id = $2', [rank, viewerId]);
  } catch (err) {
    console.error('[ranking] recalculateRank error:', err.message);
  }
}

/**
 * Calculates a viewer realness score (0–100) based on behavioral signals.
 * Higher scores indicate a more likely real, engaged viewer.
 * Persists the result to the viewers table.
 *
 * @param {string} viewerId  - Twitch user ID.
 * @param {number} sessionId - Current session ID.
 * @returns {Promise<number>} Realness score between 0 and 100.
 */
async function calculateRealness(viewerId, sessionId) {
  let score = 50;

  try {
    // Positive — message count this session
    const msgResult = await pool.query(
      'SELECT message_count FROM session_chatters WHERE viewer_id = $1 AND session_id = $2',
      [viewerId, sessionId],
    );
    const msgCount = msgResult.rows[0]?.message_count || 0;
    if (msgCount >= 1) score += 20;
    if (msgCount >= 3) score += 10;

    // Positive — sessions attended
    const sessionResult = await pool.query(
      'SELECT COUNT(*) AS cnt FROM session_chatters WHERE viewer_id = $1',
      [viewerId],
    );
    const sessionCount = parseInt(sessionResult.rows[0].cnt, 10);
    if (sessionCount >= 3)  score += 15;
    if (sessionCount >= 10) score += 10;

    // Positive — viewer profile signals
    const viewerResult = await pool.query(
      'SELECT stream_streak, sub_tier, is_mod, is_vip, first_seen FROM viewers WHERE twitch_id = $1',
      [viewerId],
    );
    if (viewerResult.rows.length > 0) {
      const v = viewerResult.rows[0];
      if (v.stream_streak >= 2)  score += 10;
      if (v.sub_tier !== null)   score += 15;
      if (v.is_mod || v.is_vip) score += 10;

      const ageMs     = Date.now() - new Date(v.first_seen).getTime();
      const ageDays   = ageMs / (1000 * 60 * 60 * 24);
      if (ageDays > 90)  score += 10;
      if (ageDays > 365) score += 5;

      // Positive — responded to bot (engaged in conversation this session)
      const respondedResult = await pool.query(
        `SELECT 1 FROM conversation_history
         WHERE viewer_id = $1 AND session_id = $2
         LIMIT 1`,
        [viewerId, sessionId],
      );
      if (respondedResult.rows.length > 0) score += 10;

      // Negative — lurks across many sessions but never chats
      if (msgCount === 0 && sessionCount > 3) score -= 30;

      // Negative — very new account
      if (ageDays < 30) score -= 20;
    }

    // Negative — found in a bot cluster this session
    const clusterResult = await pool.query(
      `SELECT 1 FROM bot_clusters
       WHERE account_list @> jsonb_build_array($1::text)
         AND session_id = $2`,
      [viewerId, sessionId],
    );
    if (clusterResult.rows.length > 0) score -= 25;

    // Negative — sends identical messages across multiple sessions (bot pattern)
    const identicalResult = await pool.query(
      `SELECT COUNT(*) AS cnt FROM (
         SELECT message FROM viewer_messages
         WHERE viewer_id = $1
         GROUP BY message
         HAVING COUNT(DISTINCT session_id) > 2
       ) AS repeated`,
      [viewerId],
    );
    const identicalCount = parseInt(identicalResult.rows[0].cnt, 10);
    if (identicalCount > 0) score -= 20;

    score = Math.max(0, Math.min(100, score));

    await pool.query(
      'UPDATE viewers SET realness_score = $1 WHERE twitch_id = $2',
      [score, viewerId],
    );

    return score;
  } catch (err) {
    console.error('[ranking] calculateRealness error:', err.message);
    return 50;
  }
}

module.exports = {
  updateViewerPoints,
  calculateRank,
  calculateRealness,
  POINTS_CHAT_MESSAGE,
  POINTS_SESSION_ATTENDANCE,
  POINTS_SUB,
  POINTS_CHEER_PER_100_BITS,
};
