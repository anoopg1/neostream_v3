'use strict';

require('dotenv').config();
const axios = require('axios');
const pool = require('../db/pool');
const CHARACTER = require('../config/character');

const ANTHROPIC_API_URL = 'https://api.anthropic.com/v1/messages';
const MODEL = 'claude-sonnet-4-6';
const ANTHROPIC_VERSION = '2023-06-01';

const INPUT_COST_PER_M = 3.0;
const OUTPUT_COST_PER_M = 15.0;

/**
 * Generates the system prompt based on character profile.
 * @returns {string}
 */
function getSystemPrompt() {
  return `You are ${CHARACTER.name} (${CHARACTER.realName}), streaming Euro Truck Simulator 2 on Twitch.

PERSONALITY & TONE:
${CHARACTER.personality}. ${CHARACTER.tone}

EXPERTISE:
- Euro Truck Simulator 2 (ALL routes, updates, DLCs, mechanics)
- Long haul trucking (your specialty)
- Scania trucks (your absolute favorite - S, R, Streamline series)
- Game physics, settings, mods, and optimization
- Truck handling, driving techniques, road culture

FAVORITE ROUTES:
${CHARACTER.expertise.knownRoutes.join(', ')}

CONVERSATION RULES:
1. SOUND HUMAN - Use casual language, contractions ("gonna", "wanna", "ain't", "lol", "haha")
2. NEVER say "as a bot", "I'm an AI", "Claude", or "I am" at the start
3. Be authentic - share genuine opinions about trucks, routes, games
4. Use truck/gaming emojis naturally (🚛 🎮) but sparingly
5. Ask follow-up questions to keep conversation going
6. Keep chat clean and welcoming - NO profanity, NO controversial topics
7. Reference specific ETS2 content (routes, trucks, updates, mods)
8. Vary your response patterns - never say the same thing twice
9. Keep responses under 15 words
10. Use imperfect grammar sometimes - real people don't speak perfect English

EXAMPLES OF YOUR AUTHENTIC TONE:
- "yo Scania S is clean af 🚛"
- "long haul through Scandinavia hits different man"
- "Volvo's solid but can't beat a Scania tbh"
- "yo caught that latest update? sick changes to the AI"
- "ah man that route was brutal in the rain"
- "Scania handling is smooth, love it"

WHAT NOT TO DO:
- Never repeat phrases or use templates
- Never sound corporate, robotic, or formal
- Never mention other streamers negatively
- Never discuss politics, religion, or controversial topics
- Never generate sexual content
- Never use these words: lurk, lurking, support, tabbed, tab
- Never start every response the same way
- Never use exclamation marks on every sentence

REMEMBER: You're a real person streaming ETS2 right now who knows this game inside-out. Chat naturally like you're hanging with friends, not like you're reading a script.`;
}

/**
 * Calculates the USD cost of a Claude API call.
 * @param {number} inputTokens
 * @param {number} outputTokens
 * @returns {number}
 */
function calculateCost(inputTokens, outputTokens) {
  return (inputTokens * INPUT_COST_PER_M + outputTokens * OUTPUT_COST_PER_M) / 1_000_000;
}

/**
 * Logs an API call to the api_calls table.
 * @param {string} endpoint
 * @param {number} inputTokens
 * @param {number} outputTokens
 * @param {boolean} success
 * @param {number|null} sessionId
 * @returns {Promise<void>}
 */
async function logApiCall(endpoint, inputTokens, outputTokens, success, sessionId) {
  try {
    const cost = calculateCost(inputTokens, outputTokens);
    await pool.query(
      `INSERT INTO api_calls (service, endpoint, tokens_used, cost_usd, success, session_id)
       VALUES ('claude', $1, $2, $3, $4, $5)`,
      [endpoint, inputTokens + outputTokens, cost, success, sessionId || null],
    );

    // Check daily spend limit
    const limit = parseFloat(process.env.CLAUDE_DAILY_SPEND_LIMIT || '5.00');
    const dailyResult = await pool.query(
      `SELECT COALESCE(SUM(cost_usd), 0) AS total
       FROM api_calls
       WHERE service = 'claude' AND called_at >= CURRENT_DATE`,
    );
    const dailyTotal = parseFloat(dailyResult.rows[0].total);

    if (dailyTotal >= limit) {
      try {
        const { emit } = require('../websocket/server');
        emit('SPEND_ALERT', { dailyTotal, limit });
      } catch (_) {}
    }
  } catch (err) {
    console.error('[claude] logApiCall error:', err.message);
  }
}

/**
 * Makes a single call to the Anthropic Messages API.
 * @param {string} endpoint
 * @param {string} systemPrompt
 * @param {Array} messages
 * @param {number} maxTokens
 * @param {number|null} sessionId
 * @returns {Promise<string|null>}
 */
async function callClaude(endpoint, systemPrompt, messages, maxTokens, sessionId) {
  let inputTokens = 0;
  let outputTokens = 0;
  let success = false;

  try {
    const response = await axios.post(
      ANTHROPIC_API_URL,
      { model: MODEL, max_tokens: maxTokens, system: systemPrompt, messages },
      {
        headers: {
          'x-api-key': process.env.ANTHROPIC_API_KEY,
          'anthropic-version': ANTHROPIC_VERSION,
          'content-type': 'application/json',
        },
        timeout: 15_000,
      },
    );

    const data = response.data;
    inputTokens = data.usage?.input_tokens || 0;
    outputTokens = data.usage?.output_tokens || 0;

    if (!data.content || !data.content[0] || typeof data.content[0].text !== 'string') {
      console.error('[claude] Unexpected response shape');
      return null;
    }

    const text = data.content[0].text.trim();
    if (!text) return null;

    success = true;
    return text;
  } catch (err) {
    const status = err.response?.status;
    console.error(`[claude] ${endpoint} error (HTTP ${status || 'unknown'}):`, err.message);
    return null;
  } finally {
    await logApiCall(endpoint, inputTokens, outputTokens, success, sessionId);
  }
}

/**
 * Generates a welcome message for a first-time viewer.
 * @param {string} username
 * @param {boolean} isFirstEver
 * @param {number|null} sessionId
 * @returns {Promise<string|null>}
 */
async function generateWelcome(username, isFirstEver, sessionId) {
  const instruction = isFirstEver
    ? `${username} is typing in chat for the FIRST TIME EVER on neogrit's ETS2 stream.

Write ONE casual, natural acknowledgment. Rules:
- Under 12 words
- Sound like a real viewer noticing them
- NOT a greeter - be spontaneous
- Never use: welcome, glad, thanks for, enjoy, support, lurk, tab, drop follow
- No exclamation marks at the end
- Examples: "oh ${username}", "yo ${username}", "${username} in chat", "aye ${username}"
- DIFFERENT structure every time - never repeat patterns`
    : `${username} is back in chat for the session on neogrit's ETS2 stream.

Write ONE casual acknowledgment. Rules:
- Under 12 words
- Sound natural like a friend noticing them
- Never use: welcome back, glad, support, lurk, tab
- Examples: "${username} is back", "aye ${username} again", "${username} showed up"
- Fresh every time`;

  return callClaude(
    'generate_welcome',
    getSystemPrompt(),
    [{ role: 'user', content: instruction }],
    60,
    sessionId,
  );
}

/**
 * Generates a context-aware reply to a viewer message.
 * @param {string} username
 * @param {string} message
 * @param {Array} conversationHistory
 * @param {number|null} sessionId
 * @returns {Promise<string|null>}
 */
async function generateReply(username, message, conversationHistory, sessionId) {
  const replySystem = `${getSystemPrompt()}

REPLY RULES:
- Read what they said carefully and reply directly to it
- If about trucks/routes/mods/game - answer specifically with ETS2 knowledge
- If asking how you are - keep it casual and brief
- If they're hyped about something - match their energy
- If they disagree with you - have a friendly debate
- Sound engaged, not robotic
- Never give generic non-answers
- Ask follow-up questions to keep chat alive`;

  const messages = [
    ...conversationHistory,
    { role: 'user', content: `${username} said: "${message}"` },
  ];

  return callClaude(
    'generate_reply',
    replySystem,
    messages,
    80,
    sessionId,
  );
}

/**
 * Classifies if a message needs a bot reply.
 * @param {string} message
 * @returns {Promise<{needsReply: boolean, isQuestion: boolean, isContinuation: boolean}|null>}
 */
async function classifyMessage(message) {
  const classifySystem =
    'You are a Twitch ETS2 gaming stream chat classifier.\n' +
    'Reply with ONLY JSON, no explanation:\n' +
    '{"needsReply": boolean, "isQuestion": boolean, "isContinuation": boolean}\n\n' +
    'needsReply = true for:\n' +
    '- Questions (even without ?)\n' +
    '- Directed at streamer or chat\n' +
    '- Truck/game/route talk\n' +
    '- Conversational and expects response\n' +
    '- Comparisons ("scania vs volvo")\n' +
    '- Opinions/recommendations asked\n' +
    '- Reacting to stream inviting discussion\n' +
    '- STATEMENTS ABOUT THE STREAMER (criticism, observations, jokes about their driving)\n' +
    '- Observations that invite response ("you always miss exits", "your truck setup is", "that was sick")\n\n' +
    'needsReply = false for:\n' +
    '- Pure emotes/emoji only\n' +
    '- Single word hype: GG, pog, lol, nice, wow\n' +
    '- Spam/random characters\n' +
    '- Just "hello" with no follow-up\n\n' +
    'isQuestion = true if contains question even without ?\n' +
    'isContinuation = true if clearly follows previous exchange';

  const raw = await callClaude(
    'classify_message',
    classifySystem,
    [{ role: 'user', content: message }],
    50,
    null,
  );

  if (!raw) return null;

  try {
    const jsonMatch = raw.match(/\{[\s\S]*\}/);
    if (!jsonMatch) return null;
    const parsed = JSON.parse(jsonMatch[0]);
    return {
      needsReply: Boolean(parsed.needsReply),
      isQuestion: Boolean(parsed.isQuestion),
      isContinuation: Boolean(parsed.isContinuation),
    };
  } catch (err) {
    console.error('[claude] classifyMessage parse error:', err.message);
    return null;
  }
}

/**
 * Generates a shoutout for another streamer.
 * @param {string} username
 * @param {string|null} lastGame
 * @param {number|null} sessionId
 * @returns {Promise<string|null>}
 */
async function generateShoutout(username, lastGame, sessionId) {
  const context = lastGame
    ? `Give hype shoutout for ${username} who streams ${lastGame}. Under 15 words. Natural, not corporate.`
    : `Give hype shoutout for ${username}. Under 15 words. Natural, not corporate.`;

  return callClaude(
    'generate_shoutout',
    getSystemPrompt(),
    [{ role: 'user', content: context }],
    60,
    sessionId,
  );
}

/**
 * Generates a visit message for another streamer's chat.
 * @param {string} channel
 * @param {string} streamTitle
 * @param {string} gameCategory
 * @param {number|null} sessionId
 * @returns {Promise<string|null>}
 */
async function generateVisitMessage(channel, streamTitle, gameCategory, sessionId) {
  const context =
    `Write a genuine drop-in message for ${channel}'s Twitch chat.\n` +
    `They stream "${gameCategory}" with title "${streamTitle}".\n` +
    `Sound like a real viewer dropping in. Under 15 words. No hashtags.`;

  return callClaude(
    'generate_visit_message',
    getSystemPrompt(),
    [{ role: 'user', content: context }],
    60,
    sessionId,
  );
}

/**
 * Generates a thank-you message for follow/sub/cheer events.
 * @param {'follow'|'sub'|'cheer'} type
 * @param {string} username
 * @param {object} extra
 * @param {number|null} sessionId
 * @returns {Promise<string|null>}
 */
async function generateEventThankYou(type, username, extra, sessionId) {
  let context;

  if (type === 'follow') {
    context = `Thank ${username} for following. Genuine, casual. Under 15 words.`;
  } else if (type === 'sub') {
    const tier = extra?.tier ? `Tier ${extra.tier}` : '';
    context = `Thank ${username} for subbing${tier ? ` (${tier})` : ''}. Genuine, casual. Under 15 words.`;
  } else if (type === 'cheer') {
    const bits = extra?.bits || 0;
    context = `Thank ${username} for cheering ${bits} bits. Genuine, casual. Under 15 words.`;
  } else {
    context = `Thank ${username} for the support. Under 15 words.`;
  }

  return callClaude(
    `generate_event_thankyou_${type}`,
    getSystemPrompt(),
    [{ role: 'user', content: context }],
    60,
    sessionId,
  );
}

module.exports = {
  generateWelcome,
  generateReply,
  classifyMessage,
  generateShoutout,
  generateVisitMessage,
  generateEventThankYou,
  getSystemPrompt,
};