'use strict';

require('dotenv').config();
const axios = require('axios');
const db = require('../db/pool');
const { getValidToken } = require('../config/tokenManager');

const TWITCH_API_BASE = 'https://api.twitch.tv/helix';

/**
 * Creates authenticated Axios headers for the Twitch Helix API.
 * @param {'bot'|'main'} tokenType - Which OAuth token to use.
 * @returns {Promise<{ Authorization: string, 'Client-Id': string }>}
 */
async function getHeaders(tokenType = 'bot') {
  const token = await getValidToken(tokenType);
  if (!token) {
    throw new Error(`[twitch] No valid token for ${tokenType}`);
  }
  return {
    Authorization: `Bearer ${token}`,
    'Client-Id': process.env.TWITCH_CLIENT_ID,
  };
}

/**
 * Makes a Twitch Helix GET request with automatic retry on 429.
 * Returns null on 503 or persistent failure.
 * @param {string}  endpoint   - Path after /helix (e.g. '/users').
 * @param {object}  params     - Query parameters.
 * @param {string}  tokenType  - 'bot' or 'main'.
 * @returns {Promise<object|null>} Parsed response data or null.
 */
async function twitchGet(endpoint, params = {}, tokenType = 'bot') {
  let retries = 0;
  const maxRetries = 3;

  while (retries < maxRetries) {
    try {
      const headers = await getHeaders(tokenType);
      const response = await axios.get(`${TWITCH_API_BASE}${endpoint}`, {
        headers,
        params,
        timeout: 10000,
      });

      console.debug(`[twitch] GET ${endpoint} ✅`);
      return response.data;

    } catch (err) {
      const status = err.response?.status;
      const message = err.response?.data?.message || err.message;

      // Rate limited
      if (status === 429) {
        const retryAfter = parseInt(err.response?.headers?.['retry-after'] || '5', 10);
        console.warn(`[twitch] Rate limited on ${endpoint} — waiting ${retryAfter}s...`);
        await new Promise(r => setTimeout(r, retryAfter * 1000));
        retries++;
        continue;
      }

      // Service unavailable
      if (status === 503) {
        console.error(`[twitch] Twitch API unavailable (503) on ${endpoint}`);
        return null;
      }

      // Unauthorized - token issue
      if (status === 401) {
        console.error(`[twitch] Unauthorized (401) on ${endpoint} — token may be invalid`);
        return null;
      }

      // Other errors
      console.error(`[twitch] ${endpoint} failed (${status}):`, message);
      return null;
    }
  }

  console.error(`[twitch] Max retries exceeded for ${endpoint}`);
  return null;
}

/**
 * Fetches user information by login name.
 * @param {string} username - Twitch login name.
 * @returns {Promise<object|null>} User object or null.
 */
async function getUserInfo(username) {
  try {
    const data = await twitchGet('/users', { login: username });
    return data?.data?.[0] || null;
  } catch (err) {
    console.error('[twitch] getUserInfo error:', err.message);
    return null;
  }
}

/**
 * Fetches live stream info for a given username.
 * Returns null if the channel is offline.
 * @param {string} username - Twitch username.
 * @returns {Promise<{ live: boolean, title?: string, category?: string, viewerCount?: number }>}
 */
async function isUserLive(username) {
  try {
    const data = await twitchGet('/streams', { user_login: username });
    const stream = data?.data?.[0];

    if (!stream) {
      return { live: false };
    }

    return {
      live: true,
      title: stream.title,
      category: stream.game_name,
      viewerCount: stream.viewer_count,
    };
  } catch (err) {
    console.error('[twitch] isUserLive error:', err.message);
    return { live: false };
  }
}

/**
 * Fetches chat settings for a broadcaster.
 * @param {string} broadcasterId - Broadcaster's user ID.
 * @returns {Promise<object|null>} Chat settings or null.
 */
async function getChatSettings(broadcasterId) {
  try {
    const data = await twitchGet('/chat/settings', { broadcaster_id: broadcasterId });
    const settings = data?.data?.[0];

    if (!settings) return null;

    return {
      emoteOnly: settings.emote_mode,
      slowMode: settings.slow_mode,
      slowModeWaitTime: settings.slow_mode_wait_time,
      subscriberOnly: settings.subscriber_mode,
      followerOnly: settings.follower_mode,
    };
  } catch (err) {
    console.error('[twitch] getChatSettings error:', err.message);
    return null;
  }
}

/**
 * Fetches the list of viewers currently in chat for a broadcaster.
 * Requires moderator:read:chatters scope.
 * @param {string} broadcasterId - Broadcaster's user ID.
 * @param {string} moderatorId   - Moderator's user ID (bot account).
 * @returns {Promise<Array>} Array of chatter objects.
 */
async function getChatters(broadcasterId, moderatorId) {
  try {
    const results = [];
    let cursor = null;
    let pageCount = 0;

    do {
      const params = { broadcaster_id: broadcasterId, moderator_id: moderatorId, first: 1000 };
      if (cursor) params.after = cursor;

      const data = await twitchGet('/chat/chatters', params);
      if (!data) break;

      results.push(...(data.data || []));
      cursor = data.pagination?.cursor || null;
      pageCount++;

      // Safety limit to prevent infinite loops
      if (pageCount > 10) break;

    } while (cursor);

    console.log(`[twitch] Fetched ${results.length} chatters from ${pageCount} pages`);
    return results;
  } catch (err) {
    console.error('[twitch] getChatters error:', err.message);
    return [];
  }
}

/**
 * Fetches the last game streamed by a user.
 * @param {string} broadcasterId - Broadcaster's Twitch user ID.
 * @returns {Promise<string|null>} Game name or null.
 */
async function getLastGame(broadcasterId) {
  try {
    const data = await twitchGet('/channels', { broadcaster_id: broadcasterId });
    return data?.data?.[0]?.game_name || null;
  } catch (err) {
    console.error('[twitch] getLastGame error:', err.message);
    return null;
  }
}

/**
 * Fetches one page of followers for a broadcaster.
 * Requires moderator:read:followers scope.
 * @param {string}      broadcasterId - Broadcaster's user ID.
 * @param {string}      moderatorId   - Moderator's user ID.
 * @param {string|null} cursor        - Pagination cursor.
 * @returns {Promise<{ data: Array, cursor: string|null }>}
 */
async function getFollowersPage(broadcasterId, moderatorId, cursor = null) {
  try {
    const params = { broadcaster_id: broadcasterId, moderator_id: moderatorId, first: 100 };
    if (cursor) params.after = cursor;

    const data = await twitchGet('/channels/followers', params);
    if (!data) return { data: [], cursor: null };

    return {
      data: data.data || [],
      cursor: data.pagination?.cursor || null,
    };
  } catch (err) {
    console.error('[twitch] getFollowersPage error:', err.message);
    return { data: [], cursor: null };
  }
}

/**
 * Paginates through all followers for a broadcaster.
 * @param {string} broadcasterId - Broadcaster's user ID.
 * @param {string} moderatorId   - Moderator's user ID.
 * @returns {Promise<Array>} Complete follower list.
 */
async function getAllFollowers(broadcasterId, moderatorId) {
  try {
    const all = [];
    let cursor = null;
    let pageCount = 0;

    do {
      const page = await getFollowersPage(broadcasterId, moderatorId, cursor);
      all.push(...page.data);
      cursor = page.cursor;
      pageCount++;

      // Safety limit
      if (pageCount > 100) break;

    } while (cursor);

    console.log(`[twitch] Fetched ${all.length} followers`);
    return all;
  } catch (err) {
    console.error('[twitch] getAllFollowers error:', err.message);
    return [];
  }
}

/**
 * Fetches the list of channels that a user follows.
 * Requires user:read:follows scope on main account.
 * @param {string} userId - The user whose follows to retrieve.
 * @returns {Promise<Array>} Array of followed channel objects.
 */
async function getUserFollowing(userId) {
  try {
    const results = [];
    let cursor = null;
    let pageCount = 0;

    do {
      const params = { user_id: userId, first: 100 };
      if (cursor) params.after = cursor;

      const data = await twitchGet('/channels/followed', params, 'main');
      if (!data) break;

      results.push(...(data.data || []));
      cursor = data.pagination?.cursor || null;
      pageCount++;

      // Safety limit
      if (pageCount > 100) break;

    } while (cursor);

    console.log(`[twitch] User follows ${results.length} channels`);
    return results;
  } catch (err) {
    console.error('[twitch] getUserFollowing error:', err.message);
    return [];
  }
}

/**
 * Fetches live stream info by numeric user_id.
 * Returns null if the channel is offline.
 * @param {string} userId - Broadcaster's numeric Twitch user ID.
 * @returns {Promise<{ title: string, game_name: string, viewer_count: number }|null>}
 */
async function getStreamInfo(userId) {
  try {
    const data = await twitchGet('/streams', { user_id: userId });
    const stream = data?.data?.[0];
    if (!stream) return null;
    return {
      title: stream.title,
      game_name: stream.game_name,
      viewer_count: stream.viewer_count,
    };
  } catch (err) {
    console.error('[twitch] getStreamInfo error:', err.message);
    return null;
  }
}

module.exports = {
  getUserInfo,
  isUserLive,
  getStreamInfo,
  getChatSettings,
  getChatters,
  getLastGame,
  getFollowersPage,
  getAllFollowers,
  getUserFollowing,
}