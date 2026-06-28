'use strict';

require('dotenv').config();
const pool        = require('../db/pool');
const { getChatters } = require('../api/twitch');

/** Set of viewer IDs seen in the current session, used to detect new arrivals. */
const seenViewerIds = new Set();

/**
 * Detects coordinated bot waves by analyzing whether many new viewers
 * joined within the same short polling window with zero message history.
 * Stores confirmed clusters in the bot_clusters table and emits a WebSocket event.
 *
 * @param {Array<{ user_id: string, user_login: string }>} newViewers - Viewers first seen this cycle.
 * @param {number} sessionId - Current session ID.
 * @returns {Promise<void>}
 */
async function detectClusters(newViewers, sessionId) {
  if (newViewers.length < 10) return;

  try {
    const zeroHistory = [];

    for (const viewer of newViewers) {
      const result = await pool.query(
        'SELECT COUNT(*) AS cnt FROM viewer_messages WHERE viewer_id = $1',
        [viewer.user_id],
      );
      const count = parseInt(result.rows[0].cnt, 10);
      if (count === 0) {
        zeroHistory.push(viewer.user_id);
      }
    }

    if (zeroHistory.length < 8) return;

    await pool.query(
      `INSERT INTO bot_clusters (account_count, account_list, session_id)
       VALUES ($1, $2::jsonb, $3)`,
      [zeroHistory.length, JSON.stringify(zeroHistory), sessionId],
    );

    // Flag all cluster accounts
    for (const viewerId of zeroHistory) {
      await pool.query(
        'UPDATE viewers SET flagged = true WHERE twitch_id = $1',
        [viewerId],
      );
    }

    try {
      const { emit } = require('../websocket/server');
      emit('CLUSTER_DETECTED', { count: zeroHistory.length, accounts: zeroHistory, sessionId });
    } catch (_) {}

    console.warn(`[pollers] Bot cluster detected — ${zeroHistory.length} suspicious accounts flagged.`);
  } catch (err) {
    console.error('[pollers] detectClusters error:', err.message);
  }
}

/**
 * Polls the Twitch chatters endpoint and upserts viewer records.
 * Runs cluster detection after each cycle.
 * Called on a timed interval during an active stream session.
 *
 * @param {string} broadcasterId - Broadcaster's Twitch user ID.
 * @param {string} moderatorId   - Bot account's Twitch user ID.
 * @param {number} sessionId     - Current session ID.
 * @returns {Promise<void>}
 */
async function pollChatters(broadcasterId, moderatorId, sessionId) {
  try {
    const chatters = await getChatters(broadcasterId, moderatorId, sessionId);
    if (!chatters || chatters.length === 0) return;

    const newThisCycle = [];

    for (const chatter of chatters) {
      const { user_id: viewerId, user_login: username } = chatter;

      // Upsert viewer record
      await pool.query(
        `INSERT INTO viewers (twitch_id, username, last_seen)
         VALUES ($1, $2, NOW())
         ON CONFLICT (twitch_id) DO UPDATE
           SET username = EXCLUDED.username,
               last_seen = NOW()`,
        [viewerId, username],
      );

      if (!seenViewerIds.has(viewerId)) {
        seenViewerIds.add(viewerId);
        newThisCycle.push({ user_id: viewerId, user_login: username });
      }
    }

    // Update session peak viewers
    await pool.query(
      `UPDATE sessions
       SET peak_viewers = GREATEST(peak_viewers, $1)
       WHERE id = $2`,
      [chatters.length, sessionId],
    );

    await detectClusters(newThisCycle, sessionId);
  } catch (err) {
    console.error('[pollers] pollChatters error:', err.message);
  }
}

/**
 * Starts the chatter polling loop on a fixed interval.
 * Returns the interval handle for cleanup on shutdown.
 *
 * @param {string} broadcasterId - Broadcaster's Twitch user ID.
 * @param {string} moderatorId   - Bot account's Twitch user ID.
 * @param {number} sessionId     - Current session ID.
 * @param {number} [intervalMs]  - Poll interval in milliseconds (default 60000).
 * @returns {NodeJS.Timeout}
 */
function startPolling(broadcasterId, moderatorId, sessionId, intervalMs = 60_000) {
  seenViewerIds.clear();
  console.log(`[pollers] Chatter polling started (every ${intervalMs / 1000}s)`);
  pollChatters(broadcasterId, moderatorId, sessionId);
  return setInterval(() => pollChatters(broadcasterId, moderatorId, sessionId), intervalMs);
}

/**
 * Clears the in-memory viewer tracking set.
 * Call this when a session ends to reset state for the next session.
 * @returns {void}
 */
function resetSession() {
  seenViewerIds.clear();
}

module.exports = { startPolling, resetSession, detectClusters };
