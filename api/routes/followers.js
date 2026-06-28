'use strict';

const express = require('express');
const pool    = require('../../db/pool');
const { getAllFollowers, getFollowing, getUserInfo } = require('../twitch');

const router = express.Router();

/** Cached result to avoid hammering the Twitch API on every page load. */
let cachedFollowersData = null;
let cacheExpiresAt      = 0;
const CACHE_TTL_MS      = 10 * 60 * 1000;

/**
 * Fetches fresh follower and following data from Twitch and builds
 * mutual/one-sided tier classifications.
 * @returns {Promise<object>}
 */
async function fetchFollowerData() {
  const channel = process.env.CHANNEL;
  const channelUser = await getUserInfo(channel, 'login', null);
  if (!channelUser) throw new Error('Could not fetch broadcaster info');

  const [followers, following] = await Promise.all([
    getAllFollowers(channelUser.id, channelUser.id, null),
    getFollowing(channelUser.id, null),
  ]);

  const followingSet = new Set(following.map((f) => f.broadcaster_login?.toLowerCase()));

  const enriched = followers.map((f) => ({
    user_id:      f.user_id,
    username:     f.user_login,
    display_name: f.user_name,
    followed_at:  f.followed_at,
    is_mutual:    followingSet.has(f.user_login?.toLowerCase()),
  }));

  const mutuals     = enriched.filter((f) => f.is_mutual);
  const oneSided    = enriched.filter((f) => !f.is_mutual);

  return { followers: enriched, mutuals, one_sided: oneSided, total: enriched.length };
}

/**
 * GET /api/followers
 * Returns all followers with mutual/one-sided classification.
 * Results are cached for 10 minutes.
 */
router.get('/', async (_req, res) => {
  try {
    if (cachedFollowersData && Date.now() < cacheExpiresAt) {
      return res.json(cachedFollowersData);
    }
    const data = await fetchFollowerData();
    cachedFollowersData = data;
    cacheExpiresAt      = Date.now() + CACHE_TTL_MS;
    res.json(data);
  } catch (err) {
    console.error('[route/followers] GET / error:', err.message);
    res.status(500).json({ error: 'Failed to fetch followers' });
  }
});

/**
 * GET /api/followers/sync
 * Forces a fresh fetch from Twitch, bypassing the cache.
 */
router.get('/sync', async (_req, res) => {
  try {
    const data = await fetchFollowerData();
    cachedFollowersData = data;
    cacheExpiresAt      = Date.now() + CACHE_TTL_MS;
    res.json({ synced: true, ...data });
  } catch (err) {
    console.error('[route/followers] GET /sync error:', err.message);
    res.status(500).json({ error: 'Failed to sync followers' });
  }
});

module.exports = router;
