'use strict';

const { emit } = require('../websocket/server');

let killed = false;

/**
 * Returns whether the bot is currently in killed (silenced) state.
 * @returns {boolean}
 */
function isKilled() {
  return killed;
}

/**
 * Kills the bot, preventing any further outgoing messages.
 * Emits a BOT_KILLED WebSocket event.
 * @returns {void}
 */
function kill() {
  if (!killed) {
    killed = true;
    console.warn('[watchdog] Bot killed. All outgoing messages suppressed.');
    try { emit('BOT_KILLED', {}); } catch (_) {}
  }
}

/**
 * Revives the bot, re-enabling outgoing messages.
 * Emits a BOT_REVIVED WebSocket event.
 * @returns {void}
 */
function revive() {
  if (killed) {
    killed = false;
    console.log('[watchdog] Bot revived. Outgoing messages re-enabled.');
    try { emit('BOT_REVIVED', {}); } catch (_) {}
  }
}

module.exports = { isKilled, kill, revive };
