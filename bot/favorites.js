'use strict';

require('dotenv').config();
const pool = require('../db/pool');
const { getStreamInfo, getUserInfo } = require('../api/twitch');
const { generateVisitMessage } = require('../ai/claude');
const { isBlacklisted } = require('../safety/blacklist');
const { emit } = require('../websocket/server');

/** Rotation check interval in milliseconds — checks every 15 minutes. */
const CHECK_INTERVAL_MS = 15 * 60 * 1000;

/**
 * Visits a favorite streamer's channel if they are live and not blacklisted.
 * Sends a generated visit message using the MAIN account (injected via callback).
 * Updates last_visited_at and visit_count after a successful visit.
 *
 * @param {{ id: number, username: string, display_name: string }} favorite - Favorite record.
 * @param {Function} sendMessage - Bound sendMessage function from bot/index.js.
 * @param {number|null} sessionId - Current session ID.
 * @returns {Promise<boolean>} True if a visit message was sent.
 */
async function visitFavorite(favorite, sendMessage, sessionId) {
  const { username, display_name } = favorite;

  try {
    if (isBlacklisted(username)) {
      console.log(`[favorites] Skipping blacklisted channel: ${username}`);
      return false;
    }

    const userInfo = await getUserInfo(username, 'login', sessionId);
    if (!userInfo) return false;

    const stream = await getStreamInfo(userInfo.id, sessionId);
    if (!stream) return false;

    const visitMsg = await generateVisitMessage(
      username,
      stream.title,
      stream.game_name,
      sessionId,
    );
    if (!visitMsg) return false;

    await sendMessage(visitMsg, 'visit', username);

    await pool.query(
      `UPDATE favorite_streamers
       SET last_visited_at = NOW(), visit_count = visit_count + 1
       WHERE id = $1`,
      [favorite.id],
    );

    emit('FAVORITE_VISITED', { channel: username, message: visitMsg });
    console.log(`[favorites] Visited ${display_name || username}`);
    return true;
  } catch (err) {
    console.error(`[favorites] visitFavorite error for ${username}:`, err.message);
    return false;
  }
}

/**
 * Loads all favorites from the database, ordered by priority_order.
 * @returns {Promise<Array>}
 */
async function loadFavorites() {
  try {
    const result = await pool.query(
      'SELECT id, username, display_name FROM favorite_streamers ORDER BY priority_order ASC, added_at ASC',
    );
    return result.rows;
  } catch (err) {
    console.error('[favorites] loadFavorites error:', err.message);
    return [];
  }
}

/**
 * Starts the favorites rotation loop.
 * Checks each live favorite on a fixed interval and visits them in priority order.
 * Returns a timeout handle that can be used to cancel the loop on shutdown.
 *
 * @param {number|null} sessionId         - Current session ID.
 * @param {Function}    sendMessageFn     - Bound sendMessage from bot/index.js.
 * @returns {Promise<NodeJS.Timeout|null>}
 */
async function startFavoritesRotation(sessionId, sendMessageFn) {
  const favorites = await loadFavorites();

  if (favorites.length === 0) {
    console.warn('[favorites] No favorites configured. Add favorites via the dashboard or API.');
    emit('DASHBOARD_ALERT', { message: 'No favorite streamers configured. Use the Networking CRM to add them.' });
    return null;
  }

  console.log(`[favorites] Rotation started — ${favorites.length} favorite(s) loaded.`);

  let currentIndex = 0;

  async function runCycle() {
    const fresh = await loadFavorites();
    if (fresh.length === 0) return;
    if (currentIndex >= fresh.length) currentIndex = 0;
    const favorite = fresh[currentIndex];
    if (sendMessageFn) {
      await visitFavorite(favorite, sendMessageFn, sessionId);
    }
    currentIndex++;
  }

  await runCycle();

  return setInterval(runCycle, CHECK_INTERVAL_MS);
}

module.exports = { startFavoritesRotation, loadFavorites, visitFavorite };
