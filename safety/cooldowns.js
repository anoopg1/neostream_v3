'use strict';

const pool = require('../db/pool');

/**
 * Checks whether a cooldown is active for the given target and type.
 * All cooldowns are stored in PostgreSQL so they survive bot restarts.
 * @param {string} type   - Cooldown category (e.g. 'chat_reply', 'welcome').
 * @param {string} target - The user or entity the cooldown applies to.
 * @returns {Promise<{ allowed: boolean, remainingMs: number }>}
 */
async function checkCooldown(type, target) {
  try {
    const result = await pool.query(
      'SELECT expires_at FROM cooldowns WHERE target = $1 AND type = $2',
      [target, type],
    );

    if (result.rows.length === 0) {
      return { allowed: true, remainingMs: 0 };
    }

    const expiresAt = new Date(result.rows[0].expires_at);
    const now       = new Date();

    if (expiresAt <= now) {
      await pool.query('DELETE FROM cooldowns WHERE target = $1 AND type = $2', [target, type]);
      return { allowed: true, remainingMs: 0 };
    }

    return { allowed: false, remainingMs: expiresAt.getTime() - now.getTime() };
  } catch (err) {
    console.error(`[cooldowns] checkCooldown error (${type}/${target}):`, err.message);
    return { allowed: true, remainingMs: 0 };
  }
}

/**
 * Sets a cooldown for the given target and type.
 * Overwrites any existing cooldown for the same target+type pair.
 * @param {string} type        - Cooldown category.
 * @param {string} target      - The user or entity to cooldown.
 * @param {number} durationMs  - How long the cooldown lasts in milliseconds.
 * @returns {Promise<void>}
 */
async function setCooldown(type, target, durationMs) {
  try {
    const expiresAt = new Date(Date.now() + durationMs);
    await pool.query(
      `INSERT INTO cooldowns (target, type, expires_at)
       VALUES ($1, $2, $3)
       ON CONFLICT (target, type) DO UPDATE SET expires_at = EXCLUDED.expires_at`,
      [target, type, expiresAt],
    );
  } catch (err) {
    console.error(`[cooldowns] setCooldown error (${type}/${target}):`, err.message);
  }
}

/**
 * Clears an existing cooldown immediately.
 * @param {string} type   - Cooldown category.
 * @param {string} target - The user or entity to unblock.
 * @returns {Promise<void>}
 */
async function clearCooldown(type, target) {
  try {
    await pool.query('DELETE FROM cooldowns WHERE target = $1 AND type = $2', [target, type]);
  } catch (err) {
    console.error(`[cooldowns] clearCooldown error (${type}/${target}):`, err.message);
  }
}

module.exports = { checkCooldown, setCooldown, clearCooldown };
