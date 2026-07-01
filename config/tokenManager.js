'use strict';

require('dotenv').config();
const axios = require('axios');
const pool = require('../db/pool');

/**
 * Stores or updates an OAuth token pair in the database.
 * @param {'bot'|'main'} accountType - Which account this token belongs to.
 * @param {string} username - Twitch username for this account.
 * @param {string} accessToken - The OAuth access token.
 * @param {string} refreshToken - The OAuth refresh token.
 * @param {Date} expiresAt - When the access token expires.
 * @returns {Promise<void>}
 */
async function storeToken(accountType, username, accessToken, refreshToken, expiresAt) {
  try {
    await pool.query(
      `INSERT INTO oauth_tokens (account_type, username, access_token, refresh_token, expires_at)
       VALUES ($1, $2, $3, $4, $5)
       ON CONFLICT (account_type) DO UPDATE
         SET username      = EXCLUDED.username,
             access_token  = EXCLUDED.access_token,
             refresh_token = EXCLUDED.refresh_token,
             expires_at    = EXCLUDED.expires_at`,
      [accountType, username, accessToken, refreshToken, expiresAt],
    );
    console.log(`[tokenManager] Token stored for ${accountType}.`);
  } catch (err) {
    console.error(`[tokenManager] storeToken failed for ${accountType}:`, err.message);
    throw err;
  }
}

/**
 * Retrieves the stored OAuth token record for an account type.
 * @param {'bot'|'main'} accountType - Which account to retrieve.
 * @returns {Promise<{username: string, access_token: string, refresh_token: string, expires_at: Date}|null>}
 */
async function getToken(accountType) {
  try {
    const result = await pool.query(
      'SELECT username, access_token, refresh_token, expires_at FROM oauth_tokens WHERE account_type = $1',
      [accountType],
    );
    if (result.rows.length === 0) {
      console.warn(`[tokenManager] No token found for ${accountType}. Regenerate via config/userAuth.js`);
      return null;
    }
    return result.rows[0];
  } catch (err) {
    console.error(`[tokenManager] getToken failed for ${accountType}:`, err.message);
    return null;
  }
}

/**
 * Refreshes the access token for the given account if within 5 minutes of expiry.
 * Updates environment variables AND database.
 * @param {'bot'|'main'} accountType - Account to refresh.
 * @returns {Promise<string|null>} The valid access token or null if refresh failed.
 */
async function refreshTokenIfNeeded(accountType) {
  try {
    const record = await getToken(accountType);
    if (!record) {
      console.error(`[tokenManager] Cannot refresh - no token found for ${accountType}`);
      return null;
    }

    const expiresAt = new Date(record.expires_at);
    const fiveMinutes = 5 * 60 * 1000;
    const now = Date.now();

    // Token still valid for more than 5 minutes
    if (expiresAt.getTime() - now > fiveMinutes) {
      return record.access_token;
    }

    console.log(`[tokenManager] Refreshing token for ${accountType}...`);

    const response = await axios.post('https://id.twitch.tv/oauth2/token', null, {
      params: {
        client_id: process.env.TWITCH_CLIENT_ID,
        client_secret: process.env.TWITCH_CLIENT_SECRET,
        grant_type: 'refresh_token',
        refresh_token: record.refresh_token,
      },
    });

    const newAccessToken = response.data.access_token;
    const newRefreshToken = response.data.refresh_token;
    const expiresIn = response.data.expires_in;
    const newExpiry = new Date(now + expiresIn * 1000);

    // Store in database
    await storeToken(accountType, record.username, newAccessToken, newRefreshToken, newExpiry);

    // Update environment variables for tmi.js
    if (accountType === 'bot') {
      process.env.BOT_OAUTH_TOKEN = newAccessToken;
      process.env.BOT_REFRESH_TOKEN = newRefreshToken;
    } else if (accountType === 'main') {
      process.env.MAIN_OAUTH_TOKEN = newAccessToken;
      process.env.MAIN_REFRESH_TOKEN = newRefreshToken;
    }

    console.log(`[tokenManager] Token refreshed for ${accountType}.`);
    return newAccessToken;
  } catch (err) {
    console.error(`[tokenManager] Token refresh failed for ${accountType}:`, err.message);
    return null;
  }
}

/**
 * Gets a valid token, refreshing if needed.
 * @param {'bot'|'main'} accountType - Which account.
 * @returns {Promise<string|null>} Valid access token or null.
 */
async function getValidToken(accountType) {
  return await refreshTokenIfNeeded(accountType);
}

/**
 * Loads token pairs from environment variables into the database on first run.
 * Subsequent starts will use DB values and refresh as needed.
 * @returns {Promise<void>}
 */
async function initTokens() {
  try {
    console.log('[tokenManager] Initializing OAuth tokens...');

    // Use 60 days so tokens seeded from .env don't trigger premature refreshes
    // during normal streaming sessions. Actual Twitch token expiry is ~60 days.
    const botExpiry  = new Date(Date.now() + 60 * 24 * 60 * 60 * 1000);
    const mainExpiry = new Date(Date.now() + 60 * 24 * 60 * 60 * 1000);

    // Check if tokens already exist
    const botRow = await pool.query(
      'SELECT 1 FROM oauth_tokens WHERE account_type = $1',
      ['bot'],
    );
    const mainRow = await pool.query(
      'SELECT 1 FROM oauth_tokens WHERE account_type = $1',
      ['main'],
    );

    // Seed bot token if not exists
    if (botRow.rows.length === 0 && process.env.BOT_OAUTH_TOKEN) {
      await storeToken(
        'bot',
        process.env.BOT_USERNAME,
        process.env.BOT_OAUTH_TOKEN,
        process.env.BOT_REFRESH_TOKEN,
        botExpiry,
      );
      console.log('[tokenManager] Bot token seeded from environment.');
    }

    // Seed main token if not exists
    if (mainRow.rows.length === 0 && process.env.MAIN_OAUTH_TOKEN) {
      await storeToken(
        'main',
        process.env.MAIN_USERNAME,
        process.env.MAIN_OAUTH_TOKEN,
        process.env.MAIN_REFRESH_TOKEN,
        mainExpiry,
      );
      console.log('[tokenManager] Main token seeded from environment.');
    }

    // Refresh both tokens if needed
    await refreshTokenIfNeeded('bot');
    await refreshTokenIfNeeded('main');

    console.log('[tokenManager] Tokens initialized and refreshed.');
  } catch (err) {
    console.error('[tokenManager] initTokens failed:', err.message);
    throw err;
  }
}

module.exports = {
  storeToken,
  getToken,
  refreshTokenIfNeeded,
  getValidToken,
  initTokens,
};