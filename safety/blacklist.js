'use strict';

const pool = require('../db/pool');

/** @type {Set<string>} In-memory cache of blacklisted channel names (lowercase). */
let blacklistedChannels = new Set();

/**
 * Loads all blacklisted channels from the database into memory.
 * Must be called once at bot startup.
 * @returns {Promise<void>}
 */
async function loadBlacklist() {
  try {
    const result = await pool.query('SELECT channel_name FROM blacklist');
    blacklistedChannels = new Set(result.rows.map((r) => r.channel_name.toLowerCase()));
    console.log(`[blacklist] Loaded ${blacklistedChannels.size} blacklisted channel(s).`);
  } catch (err) {
    console.error('[blacklist] Failed to load blacklist:', err.message);
    throw err;
  }
}

/**
 * Checks whether a channel name is currently blacklisted.
 * @param {string} channelName - Channel name to check.
 * @returns {boolean}
 */
function isBlacklisted(channelName) {
  return blacklistedChannels.has(channelName.toLowerCase());
}

/**
 * Adds a channel to the blacklist in both the database and in-memory cache.
 * @param {string} channelName - Channel name to blacklist.
 * @param {string} [reason]    - Optional reason for blacklisting.
 * @returns {Promise<void>}
 */
async function addToBlacklist(channelName, reason) {
  try {
    const name = channelName.toLowerCase();
    await pool.query(
      `INSERT INTO blacklist (channel_name, reason)
       VALUES ($1, $2)
       ON CONFLICT (channel_name) DO UPDATE SET reason = EXCLUDED.reason`,
      [name, reason || null],
    );
    blacklistedChannels.add(name);
    console.log(`[blacklist] Added: ${name}`);
  } catch (err) {
    console.error('[blacklist] addToBlacklist failed:', err.message);
    throw err;
  }
}

/**
 * Removes a channel from the blacklist.
 * @param {string} channelName - Channel name to remove.
 * @returns {Promise<void>}
 */
async function removeFromBlacklist(channelName) {
  try {
    const name = channelName.toLowerCase();
    await pool.query('DELETE FROM blacklist WHERE channel_name = $1', [name]);
    blacklistedChannels.delete(name);
    console.log(`[blacklist] Removed: ${name}`);
  } catch (err) {
    console.error('[blacklist] removeFromBlacklist failed:', err.message);
    throw err;
  }
}

/**
 * Returns all currently blacklisted channel names.
 * @returns {string[]}
 */
function getAll() {
  return Array.from(blacklistedChannels);
}

module.exports = { loadBlacklist, isBlacklisted, addToBlacklist, removeFromBlacklist, getAll };
