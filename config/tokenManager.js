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
  } catch (err) {
    console.error(`[tokenManager] storeToken failed for ${accountType}:`, err.message);
    throw err;
  }
}

/**
 * Retrieves the stored OAuth token record for an account type.
 * Throws if no token is found — callers must not receive null tokens.
 * @param {'bot'|'main'} accountType - Which account to retrieve.
 * @returns {Promise<{username: string, access_token: string, refresh_token: string, expires_at: Date}>}
 */
async function getToken(accountType) {
  try {
    const result = await pool.query(
      'SELECT username, access_token, refresh_token, expires_at FROM oauth_tokens WHERE account_type = $1',
      [accountType],
    );
    if (result.rows.length === 0) {
      throw new Error(`No token stored for account type: ${accountType}. Run npm run token:${accountType}`);
    }
    return result.rows[0];
  } catch (err) {
    console.error(`[tokenManager] getToken failed for ${accountType}:`, err.message);
    throw err;
  }
}

/**
 * Refreshes the access token for the given account if it is within 5 minutes of expiry.
 * Logs every refresh attempt to the api_calls table.
 * @param {'bot'|'main'} accountType - Account to refresh.
 * @returns {Promise<string>} The valid access token (refreshed or existing).
 */
async function refreshTokenIfNeeded(accountType) {
  const record = await getToken(accountType);
  const expiresAt = new Date(record.expires_at);
  const fiveMinutes = 5 * 60 * 1000;
  const callStart = Date.now();

  if (expiresAt.getTime() - Date.now() > fiveMinutes) {
    return record.access_token;
  }

  console.log(`[tokenManager] Refreshing token for ${accountType}...`);

  let success = false;
  try {
    const response = await axios.post('https://id.twitch.tv/oauth2/token', null, {
      params: {
        client_id:     process.env.TWITCH_CLIENT_ID,
        client_secret: process.env.TWITCH_CLIENT_SECRET,
        grant_type:    'refresh_token',
        refresh_token: record.refresh_token,
      },
    });

    const { access_token, refresh_token, expires_in } = response.data;
    const newExpiry = new Date(Date.now() + expires_in * 1000);

    await storeToken(accountType, record.username, access_token, refresh_token, newExpiry);
    success = true;
    console.log(`[tokenManager] Token refreshed for ${accountType}.`);
    return access_token;
  } catch (err) {
    console.error(`[tokenManager] Token refresh failed for ${accountType}:`, err.message);
    throw err;
  } finally {
    try {
      await pool.query(
        `INSERT INTO api_calls (service, endpoint, success, called_at)
         VALUES ($1, $2, $3, NOW())`,
        ['twitch', 'token_refresh:' + accountType, success],
      );
    } catch (logErr) {
      console.error('[tokenManager] Failed to log refresh attempt:', logErr.message);
    }
  }
}

/**
 * Loads token pairs from environment variables into the database on first run.
 * Subsequent starts will use DB values and refresh as needed.
 * @returns {Promise<void>}
 */
async function initTokens() {
  try {
    const botExpiry  = new Date(Date.now() + 4 * 60 * 60 * 1000);
    const mainExpiry = new Date(Date.now() + 4 * 60 * 60 * 1000);

    const botRow  = await pool.query('SELECT 1 FROM oauth_tokens WHERE account_type = $1', ['bot']);
    const mainRow = await pool.query('SELECT 1 FROM oauth_tokens WHERE account_type = $1', ['main']);

    if (botRow.rows.length === 0) {
      await storeToken(
        'bot',
        process.env.BOT_USERNAME,
        process.env.BOT_OAUTH_TOKEN,
        process.env.BOT_REFRESH_TOKEN,
        botExpiry,
      );
      console.log('[tokenManager] Bot token seeded from environment.');
    }

    if (mainRow.rows.length === 0) {
      await storeToken(
        'main',
        process.env.MAIN_USERNAME,
        process.env.MAIN_OAUTH_TOKEN,
        process.env.MAIN_REFRESH_TOKEN,
        mainExpiry,
      );
      console.log('[tokenManager] Main token seeded from environment.');
    }
  } catch (err) {
    console.error('[tokenManager] initTokens failed:', err.message);
    throw err;
  }
}

module.exports = { storeToken, getToken, refreshTokenIfNeeded, initTokens };
