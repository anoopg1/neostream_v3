'use strict';

require('dotenv').config();
const tmi  = require('tmi.js');
const pool = require('../db/pool');

const { checkEnv }                       = require('../scripts/checkEnv');
const { loadBlacklist }                  = require('../safety/blacklist');
const { initTokens, getToken }           = require('../config/tokenManager');
const { checkRateLimit }                 = require('../safety/rateLimiter');
const watchdog                           = require('../safety/watchdog');
const { startWebSocketServer, emit }     = require('../websocket/server');
const { startPolling }                   = require('./pollers');
const { shouldReply }                    = require('./replyDecision');
const { getActiveConversation, updateConversation } = require('./continuity');
const { startFavoritesRotation }         = require('./favorites');
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
const { setCooldown }                    = require('../safety/cooldowns');
const { getUserInfo, getLastGame }       = require('../api/twitch');

const CHANNEL        = process.env.CHANNEL;
const BOT_USERNAME   = (process.env.BOT_USERNAME  || '').toLowerCase();
const MAIN_USERNAME  = (process.env.MAIN_USERNAME || '').toLowerCase();
const MAX_NEW_VIEWERS = parseInt(process.env.MAX_NEW_VIEWERS_PER_SESSION || '100', 10);

const IGNORED_BOTS = new Set([
  'nightbot', 'streamelements', 'streamlabs', 'fossabot',
  'moobot', 'wizebot', 'coebot', 'deepbot', 'ohbot',
  'botisimo', 'phantombot',
  BOT_USERNAME,
  MAIN_USERNAME,
]);

let sessionId       = null;
let broadcasterId   = null;
let botUserId       = null;
let newViewerCount  = 0;
let pollingHandle   = null;
let favoritesHandle = null;

/** @type {import('tmi.js').Client} */
let botClient  = null;
/** @type {import('tmi.js').Client} */
let mainClient = null;

/**
 * Sends a message via the MAIN client only.
 * @param {string} message
 * @param {string} type
 * @param {string|null} recipient
 * @returns {Promise<boolean>}
 */
async function sendMessage(message, type = 'chat', recipient = null) {
  if (watchdog.isKilled()) return false;

  const { allowed, retryAfterMs } = checkRateLimit();
  if (!allowed) {
    console.warn(`[bot] Rate limit hit — retry in ${retryAfterMs}ms`);
    return false;
  }

  const typingDelayMs = Math.min(message.length * 30 + 500, 3000);
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
 * Records a viewer message for repeat detection.
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
    console.error('[bot] viewer_messages insert failed:', err.message);
  }
}

/**
 * Handles mod commands.
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
      const targetUser = await getUserInfo(target, 'login', sessionId);
      const lastGame   = targetUser ? await getLastGame(targetUser.id, sessionId) : null;
      const shoutout   = await generateShoutout(target, lastGame, sessionId);
      if (shoutout) await sendMessage(shoutout, 'shoutout', target);
    } catch (err) {
      console.error('[bot] !so error:', err.message);
    }
    return true;
  }

  return false;
}

/**
 * Runs the reply flow — classify, generate, send, update conversation.
 * @param {string} username
 * @param {string} viewerId
 * @param {string} message
 * @returns {Promise<void>}
 */
async function handleReply(username, viewerId, message) {
  const decision = await shouldReply(message, username, viewerId, CHANNEL, sessionId);

  // Record message AFTER shouldReply to prevent self-matching in repeat check
  await recordViewerMessage(viewerId, message);

  if (!decision.shouldReply) return;

  const convo   = await getActiveConversation(viewerId, sessionId);
  const history = convo?.messages || [];
  const reply   = await generateReply(username, message, history, sessionId);

  if (reply) {
    await sendMessage(reply, 'reply', username);
    await updateConversation(viewerId, sessionId, message, reply);
    if (!decision.isContinuation) {
      await setCooldown('chat_reply', username, 20 * 60 * 1000);
    }
  }
}

/**
 * Core message handler.
 * @param {string}  channel
 * @param {object}  tags
 * @param {string}  message
 * @param {boolean} self
 * @returns {Promise<void>}
 */
async function onMessage(channel, tags, message, self) {
  if (self) return;
  if (!broadcasterId) return;

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

  // Handle mod commands first
  const parts      = message.trim().split(/\s+/);
  const command    = parts[0].toLowerCase();
  const cmdTarget  = parts[1]?.replace(/^@/, '') || null;
  const handled    = await handleModCommand(command, username, cmdTarget, tags);
  if (handled) return;

  // Upsert viewer record
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

  // Check if first message in this session
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

  // ── Subsequent messages ───────────────────────────────────────────────

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
}

/**
 * Main startup sequence.
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
  const botToken  = await getToken('bot');
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
    options:    { debug: false },
    connection: { reconnect: true, secure: true },
    identity:   { username: process.env.BOT_USERNAME, password: `oauth:${botToken.access_token}` },
    channels:   [CHANNEL],
  });

  mainClient = new tmi.Client({
    options:    { debug: false },
    connection: { reconnect: true, secure: true },
    identity:   { username: process.env.MAIN_USERNAME, password: `oauth:${mainToken.access_token}` },
    channels:   [CHANNEL],
  });

  // BOT client reads only — mainClient has NO message listener
  botClient.on('message', onMessage);

  await botClient.connect();
  await mainClient.connect();
  console.log('      Both clients connected.');

  console.log('[8/9] Starting background services...');
  pollingHandle   = startPolling(broadcasterId, botUserId, sessionId);
  favoritesHandle = await startFavoritesRotation(sessionId);

  console.log('[9/9] Starting WebSocket server...');
  startWebSocketServer();

  emit('SESSION_STARTED', { sessionId });
  console.log('\n✅ NeoStream v3 is live.\n');
}

/**
 * Graceful shutdown handler.
 * @param {string} signal
 * @returns {Promise<void>}
 */
async function shutdown(signal) {
  console.log(`\n[bot] Received ${signal}. Shutting down gracefully...`);
  try {
    if (pollingHandle)   clearInterval(pollingHandle);
    if (favoritesHandle) clearTimeout(favoritesHandle);

    if (sessionId) {
      await pool.query(
        'UPDATE sessions SET ended_at = NOW() WHERE id = $1',
        [sessionId],
      );
      console.log(`[bot] Session #${sessionId} closed.`);
    }

    if (botClient)  await botClient.disconnect().catch(() => {});
    if (mainClient) await mainClient.disconnect().catch(() => {});

    await pool.end();
    console.log('[bot] Shutdown complete.');
  } catch (err) {
    console.error('[bot] Error during shutdown:', err.message);
  }
}

process.on('SIGINT',  () => shutdown('SIGINT').then(() => process.exit(0)));
process.on('SIGTERM', () => shutdown('SIGTERM').then(() => process.exit(0)));
process.on('unhandledRejection', (reason) => {
  console.error('[bot] Unhandled rejection:', reason);
});

start().catch((err) => {
  console.error('[bot] Fatal startup error:', err.message);
  process.exit(1);
});