'use strict';

require('dotenv').config();
const tmi = require('tmi.js');
const pool = require('../db/pool');

const { checkEnv } = require('../scripts/checkEnv');
const { loadBlacklist, isBlacklisted } = require('../safety/blacklist');
const { initTokens, getToken } = require('../config/tokenManager');
const { checkRateLimit } = require('../safety/rateLimiter');
const watchdog = require('../safety/watchdog');
const { startWebSocketServer, emit } = require('../websocket/server');
const { startPolling, resetSession } = require('./pollers');
const { shouldReply } = require('./replyDecision');
const { getActiveConversation, updateConversation } = require('./continuity');
const { startFavoritesRotation } = require('./favorites');
const {
  generateWelcome,
  generateReply,
  generateShoutout,
  generateEventThankYou,
} = require('../ai/claude');
const {
  updateViewerPoints,
  calculateRealness,
  POINTS_CHAT_MESSAGE,
  POINTS_SESSION_ATTENDANCE,
  POINTS_SUB,
  POINTS_CHEER_PER_100_BITS,
} = require('./ranking');
const { setCooldown } = require('../safety/cooldowns');
const { getUserInfo, getStreamInfo } = require('../api/twitch');

const CHANNEL = process.env.CHANNEL;
const BOT_USERNAME = process.env.BOT_USERNAME;
const MAIN_USERNAME = process.env.MAIN_USERNAME;
const MAX_NEW_VIEWERS = parseInt(process.env.MAX_NEW_VIEWERS_PER_SESSION || '100', 10);

const IGNORED_BOTS = new Set([
  'nightbot', 'streamelements', 'streamlabs', 'fossabot',
  'moobot', 'wizebot', 'coebot', 'deepbot', 'ohbot',
  'botisimo', 'phantombot',
  (process.env.BOT_USERNAME || '').toLowerCase(),
  (process.env.MAIN_USERNAME || '').toLowerCase(),
]);

let sessionId = null;
let broadcasterId = null;
let botUserId = null;
let newViewerCount = 0;
let pollingHandle = null;
let favoritesHandle = null;

/** @type {import('tmi.js').Client} Read-only bot client */
let botClient = null;
/** @type {import('tmi.js').Client} Write-only main client */
let mainClient = null;

/**
 * Sends a message to the channel via the MAIN client only.
 * Validates watchdog state and rate limits before sending.
 * Logs the message to the logs table and emits a WebSocket event.
 *
 * @param {string} message   - Message content to send.
 * @param {string} [type]    - Log type label (default 'chat').
 * @param {string} [recipient] - Recipient username for log context.
 * @returns {Promise<boolean>} True if the message was sent successfully.
 */
async function sendMessage(message, type = 'chat', recipient = null) {
  if (watchdog.isKilled()) return false;

  const { allowed, retryAfterMs } = checkRateLimit();
  if (!allowed) {
    console.warn(`[bot] Rate limit hit — retry in ${retryAfterMs}ms`);
    return false;
  }

  const charCount = message.length;
  const typingDelayMs = Math.min(charCount * 30 + 500, 3000);
  await new Promise((r) => setTimeout(r, typingDelayMs));

  try {
    await mainClient.say(CHANNEL, message);

    await pool.query(
      `INSERT INTO logs (type, recipient, channel, message, session_id)
       VALUES ($1, $2, $3, $4, $5)`,
      [type, recipient, CHANNEL, message, sessionId],
    );

    emit('MESSAGE_SENT', { type, recipient, channel: CHANNEL, message });
    return true;
  } catch (err) {
    console.error('[bot] sendMessage failed:', err.message);
    return false;
  }
}

/**
 * Handles mod commands issued in chat.
 * Only processes commands from verified moderators.
 * @param {string} command - Command string (e.g. '!killbot').
 * @param {string} username - Username of the person issuing the command.
 * @param {string} target   - Target username for commands like !so.
 * @param {object} tags     - TMI message tags.
 * @returns {Promise<boolean>} True if a command was handled.
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
      const targetUser = await getUserInfo(target, 'login', sessionId);
      const lastGame = targetUser ? await require('../api/twitch').getLastGame(targetUser.id, sessionId) : null;
      const shoutout = await generateShoutout(target, lastGame, sessionId);
      if (shoutout) await sendMessage(shoutout, 'shoutout', target);
    } catch (err) {
      console.error('[bot] !so error:', err.message);
    }
    return true;
  }

  return false;
}

/**
 * Core message handler. Processes every incoming chat message through
 * validation, viewer tracking, and the reply decision flow.
 *
 * @param {string} channel    - Channel the message came from (with #).
 * @param {object} tags       - TMI userstate tags.
 * @param {string} message    - Raw message content.
 * @param {boolean} self      - True if the message was sent by this client.
 * @returns {Promise<void>}
 */
async function onMessage(channel, tags, message, self) {
  if (self) return;
  if (!broadcasterId) return;

  // Validate source room
  const roomId = tags['room-id'];
  if (roomId !== String(broadcasterId)) return;

  const username = (tags.username || '').toLowerCase();
  const viewerId = tags['user-id'];

  if (!username || !viewerId) return;
  if (username === (process.env.BOT_USERNAME || '').toLowerCase()) return;
  if (username === (process.env.MAIN_USERNAME || '').toLowerCase()) return;
  if (IGNORED_BOTS.has(username)) return;
  if (watchdog.isKilled()) return;

  // Emote-only messages — skip reply logic but still track
  const emoteOnly = tags['emote-only'];

  // Mod commands
  const parts = message.trim().split(/\s+/);
  const command = parts[0].toLowerCase();
  const cmdTarget = parts[1] || null;
  const handled = await handleModCommand(command, username, cmdTarget, tags);
  if (handled) return;

  // Upsert viewer record with current tag data
  try {
    await pool.query(
      `INSERT INTO viewers (twitch_id, username, broadcaster_type, is_turbo, sub_tier, is_mod, is_vip, last_seen)
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
        tags['subscriber'] ? (tags['badge-info']?.subscriber ? `${Math.floor(parseInt(tags['badge-info'].subscriber, 10) / 1000) || 1}` : '1') : null,
        Boolean(tags.mod),
        Boolean(tags.badges?.vip),
      ],
    );
  } catch (err) {
    console.error('[bot] Viewer upsert failed:', err.message);
  }

  // Record this message for repeat detection and stats
  try {
    await pool.query(
      `INSERT INTO viewer_messages (viewer_id, session_id, message)
       VALUES ($1, $2, $3)`,
      [viewerId, sessionId, message],
    );
  } catch (err) {
    console.error('[bot] viewer_messages insert failed:', err.message);
  }

  // Check if this viewer has been seen in the current session
  const sessionChatterResult = await pool.query(
    'SELECT message_count FROM session_chatters WHERE session_id = $1 AND viewer_id = $2',
    [sessionId, viewerId],
  ).catch(() => ({ rows: [] }));

  const isFirstInSession = sessionChatterResult.rows.length === 0;

  if (isFirstInSession) {
    // Enforce DB flood protection
    if (newViewerCount >= MAX_NEW_VIEWERS) {
      console.warn(`[bot] MAX_NEW_VIEWERS_PER_SESSION (${MAX_NEW_VIEWERS}) reached — skipping new viewer insert.`);
      return;
    }
    newViewerCount++;

    // Insert session_chatters record
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

    // Check if they have ever appeared in any session before
    const priorSessions = await pool.query(
      'SELECT COUNT(*) AS cnt FROM session_chatters WHERE viewer_id = $1 AND session_id != $2',
      [viewerId, sessionId],
    ).catch(() => ({ rows: [{ cnt: '1' }] }));
    const isFirstEver = parseInt(priorSessions.rows[0].cnt, 10) === 0;

    emit('VIEWER_JOINED', { username, isFirstEver, realnessScore: 50 });

    // Welcome message (non-emote messages only)
    if (!emoteOnly) {
      const welcome = await generateWelcome(username, isFirstEver, sessionId);
      if (welcome) {
        await sendMessage(welcome, 'welcome', username);
        // Update stream_streak for repeat visitors
        if (!isFirstEver) {
          await pool.query(
            'UPDATE viewers SET stream_streak = stream_streak + 1 WHERE twitch_id = $1',
            [viewerId],
          );
        }
      }

      // Run reply decision on first message too
      if (!emoteOnly) {
        const decision = await shouldReply(message, username, viewerId, CHANNEL, sessionId);
        if (decision.shouldReply) {
          const convo = await getActiveConversation(viewerId, sessionId);
          const history = convo?.messages || [];
          const reply = await generateReply(username, message, history, sessionId);
          if (reply) {
            await sendMessage(reply, 'reply', username);
            await updateConversation(viewerId, sessionId, message, reply);
            if (!decision.isContinuation) {
              await setCooldown('chat_reply', username, 20 * 60 * 1000);
            }
          }
        }
      }
    }

    await updateViewerPoints(viewerId, POINTS_SESSION_ATTENDANCE);
    return;
  }

  // Subsequent messages in session
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
    const decision = await shouldReply(message, username, viewerId, CHANNEL, sessionId);
    if (decision.shouldReply) {
      const convo = await getActiveConversation(viewerId, sessionId);
      const history = convo?.messages || [];
      const reply = await generateReply(username, message, history, sessionId);
      if (reply) {
        await sendMessage(reply, 'reply', username);
        await updateConversation(viewerId, sessionId, message, reply);
        if (!decision.isContinuation) {
          await setCooldown('chat_reply', username, 20 * 60 * 1000);
        }
        // Non-blocking realness score recalculation
        calculateRealness(viewerId, sessionId).catch(() => { });
      }
    }
  }
}

/**
 * Main startup sequence for the NeoStream v3 bot.
 * Connects both clients, starts a session, and begins background services.
 * @returns {Promise<void>}
 */
async function start() {
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
  const channelUser = await getUserInfo(CHANNEL, 'login', sessionId);
  if (!channelUser) throw new Error(`Could not fetch user info for channel: ${CHANNEL}`);
  broadcasterId = channelUser.id;

  const botUser = await getUserInfo(BOT_USERNAME, 'login', sessionId);
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

  // BOT client: reads only, never posts
  botClient.on('message', onMessage);

  await botClient.connect();
  await mainClient.connect();
  console.log('      Both clients connected.');

  console.log('[8/9] Starting background services...');
  pollingHandle = startPolling(broadcasterId, botUserId, sessionId);
  favoritesHandle = await startFavoritesRotation(sessionId);

  console.log('[9/9] Starting WebSocket server...');
  startWebSocketServer();

  emit('SESSION_STARTED', { sessionId });

  console.log('\n✅ NeoStream v3 is live.\n');
}

/**
 * Graceful shutdown handler.
 * Closes the session, disconnects clients, and cleans up polling handles.
 * Never calls process.exit() directly.
 * @param {string} signal - The OS signal that triggered shutdown.
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

    if (botClient) await botClient.disconnect().catch(() => { });
    if (mainClient) await mainClient.disconnect().catch(() => { });

    await pool.end();
    console.log('[bot] Shutdown complete.');
  } catch (err) {
    console.error('[bot] Error during shutdown:', err.message);
  }
}

process.on('SIGINT', () => shutdown('SIGINT').then(() => process.exit(0)));
process.on('SIGTERM', () => shutdown('SIGTERM').then(() => process.exit(0)));
process.on('unhandledRejection', (reason) => {
  console.error('[bot] Unhandled rejection:', reason);
});

start().catch((err) => {
  console.error('[bot] Fatal startup error:', err.message);
  process.exit(1);
});
