'use strict';

require('dotenv').config();
const tmi = require('tmi.js');
const pool = require('../db/pool');

const { checkEnv } = require('../scripts/checkEnv');
const { loadBlacklist } = require('../safety/blacklist');
const { initTokens, getToken } = require('../config/tokenManager');
const { checkRateLimit } = require('../safety/rateLimiter');
const watchdog = require('../safety/watchdog');
const { startWebSocketServer, emit } = require('../websocket/server');
const { startPolling } = require('./pollers');
const { shouldReply } = require('./replyDecision');
const { getActiveConversation, updateConversation } = require('./continuity');
const { startFavoritesRotation } = require('./favorites');
const {
  generateWelcome,
  generateReply,
  generateShoutout,
} = require('../ai/claude');
const {
  updateViewerPoints,
  calculateRealness,
  POINTS_CHAT_MESSAGE,
  POINTS_SESSION_ATTENDANCE,
} = require('./ranking');
const { setCooldown } = require('../safety/cooldowns');
const { getUserInfo, getLastGame } = require('../api/twitch');

// ============================================================================
// CONFIG & STATE
// ============================================================================

const CHANNEL = process.env.CHANNEL;
const BOT_USERNAME = (process.env.BOT_USERNAME || '').toLowerCase();
const MAIN_USERNAME = (process.env.MAIN_USERNAME || '').toLowerCase();
const MAX_NEW_VIEWERS = parseInt(process.env.MAX_NEW_VIEWERS_PER_SESSION || '100', 10);

const IGNORED_BOTS = new Set([
  'nightbot', 'streamelements', 'streamlabs', 'fossabot',
  'moobot', 'wizebot', 'coebot', 'deepbot', 'ohbot',
  'botisimo', 'phantombot',
  BOT_USERNAME,
  MAIN_USERNAME,
]);

let sessionId = null;
let broadcasterId = null;
let botUserId = null;
let newViewerCount = 0;
let pollingHandle = null;
let favoritesHandle = null;

let botClient = null;
let mainClient = null;

// ============================================================================
// MESSAGE SENDING
// ============================================================================

/**
 * Sends a message via the MAIN client only.
 * @param {string} message
 * @param {string} type - 'chat', 'welcome', 'reply', 'shoutout', 'mod_action'
 * @param {string|null} recipient - Username of recipient or null
 * @returns {Promise<boolean>}
 */
async function sendMessage(message, type = 'chat', recipient = null) {
  if (watchdog.isKilled()) return false;

  const { allowed, retryAfterMs } = checkRateLimit();
  if (!allowed) {
    console.warn(`[bot] Rate limit hit — retry in ${retryAfterMs}ms`);
    return false;
  }

  try {
    // Typing delay: 33 WPM (2.75 chars/sec)
    const typingDelayMs = Math.max((message.length / 2.75) * 1000, 300);
    await new Promise(r => setTimeout(r, typingDelayMs));

    await mainClient.say(CHANNEL, message);

    // Log the message
    try {
      await pool.query(
        `INSERT INTO logs (type, recipient, channel, message, session_id)
         VALUES ($1, $2, $3, $4, $5)`,
        [type, recipient, CHANNEL, message, sessionId],
      );
    } catch (logErr) {
      console.error('[bot] Failed to log message:', logErr.message);
    }

    emit('MESSAGE_SENT', { type, recipient, channel: CHANNEL, message });
    console.log(`✅ ${type.toUpperCase()}: ${message.substring(0, 60)}...`);
    return true;

  } catch (err) {
    console.error('[bot] sendMessage failed:', err.message);
    return false;
  }
}

// ============================================================================
// VIEWER MESSAGE TRACKING
// ============================================================================

/**
 * Records a viewer message for repeat detection and continuity.
 * Must be called AFTER shouldReply to avoid self-matching.
 * @param {string} viewerId
 * @param {string} message
 * @returns {Promise<void>}
 */
async function recordViewerMessage(viewerId, message) {
  try {
    await pool.query(
      `INSERT INTO viewer_messages (viewer_id, session_id, message)
       VALUES ($1, $2, $3)`,
      [viewerId, sessionId, message],
    );
  } catch (err) {
    console.error('[bot] recordViewerMessage failed:', err.message);
  }
}

// ============================================================================
// MOD COMMANDS
// ============================================================================

/**
 * Handles mod commands: !killbot, !revivebot, !so
 * @param {string} command
 * @param {string} username
 * @param {string|null} target
 * @param {object} tags
 * @returns {Promise<boolean>}
 */
async function handleModCommand(command, username, target, tags) {
  const isMod = tags.mod || tags.badges?.broadcaster;
  if (!isMod) return false;

  if (command === '!killbot') {
    watchdog.kill();
    await sendMessage('Bot silenced.', 'mod_action', username);
    return true;
  }

  if (command === '!revivebot') {
    watchdog.revive();
    await sendMessage('Back!', 'mod_action', username);
    return true;
  }

  if (command === '!so' && target) {
    try {
      const targetUser = await getUserInfo(target);
      const lastGame = targetUser ? await getLastGame(targetUser.id) : null;
      const shoutout = await generateShoutout(target, lastGame, sessionId);
      if (shoutout) await sendMessage(shoutout, 'shoutout', target);
    } catch (err) {
      console.error('[bot] !so error:', err.message);
    }
    return true;
  }

  return false;
}

// ============================================================================
// REPLY FLOW
// ============================================================================

/**
 * Runs the reply flow — classify, generate, send, update conversation.
 * @param {string} username
 * @param {string} viewerId
 * @param {string} message
 * @returns {Promise<void>}
 */
async function handleReply(username, viewerId, message) {
  try {
    const decision = await shouldReply(message, username, viewerId, CHANNEL, sessionId);

    // Record message AFTER shouldReply to prevent self-matching
    await recordViewerMessage(viewerId, message);

    if (!decision.shouldReply) return;

    const convo = await getActiveConversation(viewerId, sessionId);
    const history = convo?.messages || [];
    const reply = await generateReply(username, message, history, sessionId);

    if (reply) {
      const sent = await sendMessage(reply, 'reply', username);
      if (sent) {
        await updateConversation(viewerId, sessionId, message, reply);
        if (!decision.isContinuation) {
          await setCooldown('chat_reply', username, 20 * 60 * 1000);
        }
      }
    }
  } catch (err) {
    console.error('[bot] handleReply failed:', err.message);
  }
}

// ============================================================================
// MESSAGE HANDLER
// ============================================================================

/**
 * Core message handler — processes all chat messages.
 * @param {string} channel
 * @param {object} tags
 * @param {string} message
 * @param {boolean} self
 * @returns {Promise<void>}
 */
async function onMessage(channel, tags, message, self) {
  if (self) return;
  if (!broadcasterId || !sessionId) return;

  try {
    // Only process messages from neogrit's channel
    const roomId = tags['room-id'];
    if (roomId !== String(broadcasterId)) return;

    const username = (tags.username || '').toLowerCase();
    const viewerId = tags['user-id'];

    if (!username || !viewerId) return;

    // Ignore bots and own accounts
    if (IGNORED_BOTS.has(username)) return;
    if (watchdog.isKilled()) return;

    const emoteOnly = Boolean(tags['emote-only']);

    // ── MOD COMMANDS ──────────────────────────────────────────────────────

    const parts = message.trim().split(/\s+/);
    const command = parts[0].toLowerCase();
    const cmdTarget = parts[1]?.replace(/^@/, '') || null;
    const handled = await handleModCommand(command, username, cmdTarget, tags);
    if (handled) return;

    // ── UPSERT VIEWER ─────────────────────────────────────────────────────

    try {
      await pool.query(
        `INSERT INTO viewers
           (twitch_id, username, broadcaster_type, is_turbo, sub_tier, is_mod, is_vip, last_seen)
         VALUES ($1, $2, $3, $4, $5, $6, $7, NOW())
         ON CONFLICT (twitch_id) DO UPDATE
           SET username         = EXCLUDED.username,
               broadcaster_type = EXCLUDED.broadcaster_type,
               is_turbo         = EXCLUDED.is_turbo,
               sub_tier         = COALESCE(EXCLUDED.sub_tier, viewers.sub_tier),
               is_mod           = EXCLUDED.is_mod,
               is_vip           = EXCLUDED.is_vip,
               last_seen        = NOW()`,
        [
          viewerId,
          username,
          tags['broadcaster-type'] || 'none',
          Boolean(tags.turbo),
          tags['subscriber']
            ? (tags['badge-info']?.subscriber
              ? String(Math.floor(parseInt(tags['badge-info'].subscriber, 10) / 1000) || 1)
              : '1')
            : null,
          Boolean(tags.mod),
          Boolean(tags.badges?.vip),
        ],
      );
    } catch (err) {
      console.error('[bot] Viewer upsert failed:', err.message);
    }

    // ── FIRST MESSAGE IN SESSION ──────────────────────────────────────────

    const sessionChatterResult = await pool.query(
      'SELECT message_count FROM session_chatters WHERE session_id = $1 AND viewer_id = $2',
      [sessionId, viewerId],
    ).catch(() => ({ rows: [] }));

    const isFirstInSession = sessionChatterResult.rows.length === 0;

    if (isFirstInSession) {
      // DB flood protection
      if (newViewerCount >= MAX_NEW_VIEWERS) {
        console.warn(`[bot] MAX_NEW_VIEWERS limit reached — skipping.`);
        return;
      }
      newViewerCount++;

      // Insert into session_chatters
      try {
        await pool.query(
          `INSERT INTO session_chatters (session_id, viewer_id, message_count, first_message_at)
           VALUES ($1, $2, 1, NOW())
           ON CONFLICT (session_id, viewer_id) DO NOTHING`,
          [sessionId, viewerId],
        );
      } catch (err) {
        console.error('[bot] session_chatters insert failed:', err.message);
      }

      // Count first message in session total (subsequent messages do this in their own branch)
      pool.query('UPDATE sessions SET total_messages = total_messages + 1 WHERE id = $1', [sessionId])
        .catch(() => {});

      // Check if first ever visit
      const priorSessions = await pool.query(
        'SELECT COUNT(*) AS cnt FROM session_chatters WHERE viewer_id = $1 AND session_id != $2',
        [viewerId, sessionId],
      ).catch(() => ({ rows: [{ cnt: '1' }] }));
      const isFirstEver = parseInt(priorSessions.rows[0].cnt, 10) === 0;

      emit('VIEWER_JOINED', { username, isFirstEver, realnessScore: 50 });

      // Send welcome for text messages only
      if (!emoteOnly) {
        const welcome = await generateWelcome(username, isFirstEver, sessionId);
        if (welcome) {
          await sendMessage(welcome, 'welcome', username);
          if (!isFirstEver) {
            await pool.query(
              'UPDATE viewers SET stream_streak = stream_streak + 1 WHERE twitch_id = $1',
              [viewerId],
            );
          }
        }

        // Attempt reply on first message too
        await handleReply(username, viewerId, message);
      } else {
        // Emote only — still record the message
        await recordViewerMessage(viewerId, message);
      }

      await updateViewerPoints(viewerId, POINTS_SESSION_ATTENDANCE);
      return;
    }

    // ── SUBSEQUENT MESSAGES ───────────────────────────────────────────────

    // Update message counts
    try {
      await pool.query(
        `UPDATE session_chatters
         SET message_count = message_count + 1
         WHERE session_id = $1 AND viewer_id = $2`,
        [sessionId, viewerId],
      );
      await pool.query(
        'UPDATE sessions SET total_messages = total_messages + 1 WHERE id = $1',
        [sessionId],
      );
    } catch (err) {
      console.error('[bot] message count update failed:', err.message);
    }

    await updateViewerPoints(viewerId, POINTS_CHAT_MESSAGE);

    if (!emoteOnly) {
      await handleReply(username, viewerId, message);
      // Non-blocking realness recalculation
      calculateRealness(viewerId, sessionId).catch(() => {});
    } else {
      await recordViewerMessage(viewerId, message);
    }

  } catch (err) {
    console.error('[bot] onMessage error:', err.message);
  }
}

// ============================================================================
// STARTUP
// ============================================================================

/**
 * Main startup sequence.
 * @returns {Promise<void>}
 */
async function start() {
  try {
    console.log('[1/9] Checking environment variables...');
    checkEnv();

    console.log('[2/9] Connecting to PostgreSQL...');
    await pool.query('SELECT 1');
    console.log('      PostgreSQL connected.');

    console.log('[3/9] Loading blacklist...');
    await loadBlacklist();

    console.log('[4/9] Initializing OAuth tokens...');
    await initTokens();
    const botToken = await getToken('bot');
    const mainToken = await getToken('main');

    console.log('[5/9] Starting session in database...');
    const sessionResult = await pool.query(
      'INSERT INTO sessions DEFAULT VALUES RETURNING id',
    );
    sessionId = sessionResult.rows[0].id;
    console.log(`      Session #${sessionId} started.`);

    console.log('[6/9] Fetching channel info...');
    const channelUser = await getUserInfo(CHANNEL);
    if (!channelUser) throw new Error(`Could not fetch user info for channel: ${CHANNEL}`);
    broadcasterId = channelUser.id;

    const botUser = await getUserInfo(BOT_USERNAME);
    if (!botUser) throw new Error(`Could not fetch user info for bot: ${BOT_USERNAME}`);
    botUserId = botUser.id;
    console.log(`      broadcaster_id=${broadcasterId}, bot_id=${botUserId}`);

    console.log('[7/9] Connecting clients...');

    botClient = new tmi.Client({
      options: { debug: false },
      connection: { reconnect: true, secure: true },
      identity: { username: BOT_USERNAME, password: `oauth:${botToken.access_token}` },
      channels: [CHANNEL],
    });

    mainClient = new tmi.Client({
      options: { debug: false },
      connection: { reconnect: true, secure: true },
      identity: { username: MAIN_USERNAME, password: `oauth:${mainToken.access_token}` },
      channels: [CHANNEL],
    });

    // BOT client reads only
    botClient.on('message', onMessage);

    await botClient.connect();
    await mainClient.connect();
    console.log('      Both clients connected.');

    console.log('[8/9] Starting background services...');
    pollingHandle = startPolling(broadcasterId, botUserId, sessionId);
    favoritesHandle = await startFavoritesRotation(sessionId, sendMessage);

    console.log('[9/9] Starting WebSocket server...');
    startWebSocketServer();

    emit('SESSION_STARTED', { sessionId });
    console.log('\n✅ NeoStream v3 is live.\n');

  } catch (err) {
    console.error('[bot] Fatal startup error:', err.message);
    console.error('[bot] Stack:', err.stack);
    process.exit(1);
  }
}

// ============================================================================
// SHUTDOWN
// ============================================================================

/**
 * Graceful shutdown handler.
 * @param {string} signal
 * @returns {Promise<void>}
 */
async function shutdown(signal) {
  console.log(`\n[bot] Received ${signal}. Shutting down gracefully...`);
  try {
    if (pollingHandle) clearInterval(pollingHandle);
    if (favoritesHandle) clearTimeout(favoritesHandle);

    if (sessionId) {
      await pool.query(
        'UPDATE sessions SET ended_at = NOW() WHERE id = $1',
        [sessionId],
      );
      console.log(`[bot] Session #${sessionId} closed.`);
    }

    if (botClient) await botClient.disconnect().catch(() => {});
    if (mainClient) await mainClient.disconnect().catch(() => {});

    await pool.end();
    console.log('[bot] Shutdown complete.');
  } catch (err) {
    console.error('[bot] Error during shutdown:', err.message);
  }
  process.exit(0);
}

// ============================================================================
// SIGNAL HANDLERS
// ============================================================================

process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('unhandledRejection', (reason) => {
  console.error('[bot] Unhandled rejection:', reason);
});

// ============================================================================
// START
// ============================================================================

start();