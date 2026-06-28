'use strict';

require('dotenv').config();
const axios = require('axios');
const pool  = require('../db/pool');
const { refreshTokenIfNeeded } = require('../config/tokenManager');

const TWITCH_API_BASE = 'https://api.twitch.tv/helix';

/**
 * Logs a Twitch API call to the api_calls table.
 * @param {string}  endpoint  - API endpoint path.
 * @param {boolean} success   - Whether the call succeeded.
 * @param {number|null} sessionId
 * @returns {Promise<void>}
 */
async function logTwitchCall(endpoint, success, sessionId) {
  try {
    await pool.query(
      `INSERT INTO api_calls (service, endpoint, success, session_id)
       VALUES ('twitch', $1, $2, $3)`,
      [endpoint, success, sessionId || null],
    );
  } catch (err) {
    console.error('[twitch] logTwitchCall error:', err.message);
  }
}

/**
 * Creates authenticated Axios headers for the Twitch Helix API.
 * Refreshes the bot token if it is near expiry.
 * @returns {Promise<{ Authorization: string, 'Client-Id': string }>}
 */
async function getHeaders() {
  const token = await refreshTokenIfNeeded('bot');
  return {
    Authorization: `Bearer ${token}`,
    'Client-Id':   process.env.TWITCH_CLIENT_ID,
  };
}

/**
 * Makes a Twitch Helix GET request with automatic 401 retry and 429 backoff.
 * Returns null on 503 or persistent failure.
 * @param {string}      endpoint   - Path after /helix (e.g. '/users').
 * @param {object}      params     - Query parameters.
 * @param {number|null} sessionId  - For cost logging.
 * @returns {Promise<object|null>} Parsed response data or null.
 */
async function twitchGet(endpoint, params, sessionId) {
  let retries = 0;
  const maxRetries = 3;

  while (retries < maxRetries) {
    try {
      const headers = await getHeaders();
      const response = await axios.get(`${TWITCH_API_BASE}${endpoint}`, {
        headers,
        params,
        timeout: 10_000,
      });
      await logTwitchCall(endpoint, true, sessionId);
      return response.data;
    } catch (err) {
      const status = err.response?.status;

      if (status === 401 && retries === 0) {
        console.warn('[twitch] 401 received — forcing token refresh and retrying...');
        try {
          await axios.post(
            'https://id.twitch.tv/oauth2/token',
            null,
            {
              params: {
                client_id:     process.env.TWITCH_CLIENT_ID,
                client_secret: process.env.TWITCH_CLIENT_SECRET,
                grant_type:    'refresh_token',
                refresh_token: (await require('../config/tokenManager').getToken('bot')).refresh_token,
              },
            },
          );
        } catch (_) {}
        retries++;
        continue;
      }

      if (status === 429) {
        const retryAfter = parseInt(err.response?.headers?.['retry-after'] || '5', 10);
        console.warn(`[twitch] Rate limited — waiting ${retryAfter}s...`);
        await new Promise((r) => setTimeout(r, retryAfter * 1000));
        retries++;
        continue;
      }

      if (status === 503) {
        console.error('[twitch] Twitch API unavailable (503)');
        await logTwitchCall(endpoint, false, sessionId);
        return null;
      }

      console.error(`[twitch] ${endpoint} failed (${status}):`, err.message);
      await logTwitchCall(endpoint, false, sessionId);
      return null;
    }
  }

  await logTwitchCall(endpoint, false, sessionId);
  return null;
}

/**
 * Fetches user information by login name or user ID.
 * @param {string}  identifier - Twitch login name or user ID.
 * @param {'login'|'id'} type  - Whether the identifier is a login or an ID.
 * @param {number|null} sessionId
 * @returns {Promise<object|null>} User object or null.
 */
async function getUserInfo(identifier, type, sessionId) {
  try {
    const data = await twitchGet('/users', { [type]: identifier }, sessionId);
    return data?.data?.[0] || null;
  } catch (err) {
    console.error('[twitch] getUserInfo error:', err.message);
    return null;
  }
}

/**
 * Fetches live stream info for a given user ID.
 * Returns null if the channel is offline.
 * @param {string} userId     - Twitch user ID of the broadcaster.
 * @param {number|null} sessionId
 * @returns {Promise<object|null>} Stream object or null if offline.
 */
async function getStreamInfo(userId, sessionId) {
  try {
    const data = await twitchGet('/streams', { user_id: userId }, sessionId);
    return data?.data?.[0] || null;
  } catch (err) {
    console.error('[twitch] getStreamInfo error:', err.message);
    return null;
  }
}

/**
 * Fetches the list of viewers currently in chat for a broadcaster.
 * Requires moderator:read:chatters scope.
 * @param {string} broadcasterId - Broadcaster's user ID.
 * @param {string} moderatorId   - Moderator's user ID (bot account).
 * @param {number|null} sessionId
 * @returns {Promise<Array>} Array of chatter objects with user_id and user_login.
 */
async function getChatters(broadcasterId, moderatorId, sessionId) {
  try {
    const results = [];
    let cursor    = null;

    do {
      const params = { broadcaster_id: broadcasterId, moderator_id: moderatorId, first: 1000 };
      if (cursor) params.after = cursor;

      const data = await twitchGet('/chat/chatters', params, sessionId);
      if (!data) break;

      results.push(...(data.data || []));
      cursor = data.pagination?.cursor || null;
    } while (cursor);

    return results;
  } catch (err) {
    console.error('[twitch] getChatters error:', err.message);
    return [];
  }
}

/**
 * Fetches the last game streamed by a given user.
 * @param {string} userId     - Broadcaster's Twitch user ID.
 * @param {number|null} sessionId
 * @returns {Promise<string|null>} Game name or null.
 */
async function getLastGame(userId, sessionId) {
  try {
    const channelData = await twitchGet('/channels', { broadcaster_id: userId }, sessionId);
    return channelData?.data?.[0]?.game_name || null;
  } catch (err) {
    console.error('[twitch] getLastGame error:', err.message);
    return null;
  }
}

/**
 * Fetches one page of followers for a broadcaster.
 * Requires moderator:read:followers scope on the moderator account.
 * @param {string}      broadcasterId - Broadcaster's user ID.
 * @param {string}      moderatorId   - Moderator's user ID.
 * @param {string|null} cursor        - Pagination cursor for subsequent pages.
 * @param {number|null} sessionId
 * @returns {Promise<{ data: Array, cursor: string|null }>}
 */
async function getFollowers(broadcasterId, moderatorId, cursor, sessionId) {
  try {
    const params = { broadcaster_id: broadcasterId, moderator_id: moderatorId, first: 100 };
    if (cursor) params.after = cursor;

    const data = await twitchGet('/channels/followers', params, sessionId);
    if (!data) return { data: [], cursor: null };

    return {
      data:   data.data || [],
      cursor: data.pagination?.cursor || null,
    };
  } catch (err) {
    console.error('[twitch] getFollowers error:', err.message);
    return { data: [], cursor: null };
  }
}

/**
 * Paginates through all followers for a broadcaster and returns the complete list.
 * @param {string}      broadcasterId - Broadcaster's user ID.
 * @param {string}      moderatorId   - Moderator's user ID.
 * @param {number|null} sessionId
 * @returns {Promise<Array>} Complete follower list.
 */
async function getAllFollowers(broadcasterId, moderatorId, sessionId) {
  try {
    const all = [];
    let cursor = null;

    do {
      const page = await getFollowers(broadcasterId, moderatorId, cursor, sessionId);
      all.push(...page.data);
      cursor = page.cursor;
    } while (cursor);

    return all;
  } catch (err) {
    console.error('[twitch] getAllFollowers error:', err.message);
    return [];
  }
}

/**
 * Fetches the list of channels that a given user follows.
 * @param {string}      userId    - The user whose follows to retrieve.
 * @param {number|null} sessionId
 * @returns {Promise<Array>} Array of followed channel objects.
 */
async function getFollowing(userId, sessionId) {
  try {
    const results = [];
    let cursor    = null;

    do {
      const params = { user_id: userId, first: 100 };
      if (cursor) params.after = cursor;

      const data = await twitchGet('/channels/followed', params, sessionId);
      if (!data) break;

      results.push(...(data.data || []));
      cursor = data.pagination?.cursor || null;
    } while (cursor);

    return results;
  } catch (err) {
    console.error('[twitch] getFollowing error:', err.message);
    return [];
  }
}

module.exports = {
  getUserInfo,
  getStreamInfo,
  getChatters,
  getLastGame,
  getFollowers,
  getAllFollowers,
  getFollowing,
};
