'use strict';

const pool = require('../db/pool');

/**
 * Retrieves active conversation history for a viewer in current session.
 * @param {string} viewerId
 * @param {number} sessionId
 * @returns {Promise<{messages: Array}|null>}
 */
async function getActiveConversation(viewerId, sessionId) {
  try {
    const result = await pool.query(
      `SELECT viewer_message, bot_reply 
       FROM conversation_history 
       WHERE viewer_id = $1 AND session_id = $2 
       ORDER BY created_at DESC 
       LIMIT 10`,
      [viewerId, sessionId],
    );

    if (result.rows.length === 0) {
      return { messages: [] };
    }

    // Build conversation history in chronological order
    const messages = [];
    for (let i = result.rows.length - 1; i >= 0; i--) {
      const row = result.rows[i];
      messages.push({ role: 'user', content: row.viewer_message });
      messages.push({ role: 'assistant', content: row.bot_reply });
    }

    return { messages };
  } catch (err) {
    console.error('[continuity] getActiveConversation error:', err.message);
    return { messages: [] };
  }
}

/**
 * Saves a viewer message and bot reply to conversation history.
 * @param {string} viewerId
 * @param {number} sessionId
 * @param {string} viewerMessage
 * @param {string} botReply
 * @returns {Promise<void>}
 */
async function updateConversation(viewerId, sessionId, viewerMessage, botReply) {
  try {
    await pool.query(
      `INSERT INTO conversation_history (viewer_id, session_id, viewer_message, bot_reply)
       VALUES ($1, $2, $3, $4)`,
      [viewerId, sessionId, viewerMessage, botReply],
    );

    // Keep conversations table in sync so the continuation bypass in
    // replyDecision.js (step 2) can detect active threads via last_message_at.
    await pool.query(
      `INSERT INTO conversations (viewer_id, session_id, last_message_at, exchange_count)
       VALUES ($1, $2, NOW(), 1)
       ON CONFLICT (viewer_id, session_id) DO UPDATE
         SET last_message_at = NOW(),
             exchange_count  = conversations.exchange_count + 1,
             is_active       = true`,
      [viewerId, sessionId],
    );
  } catch (err) {
    console.error('[continuity] updateConversation error:', err.message);
  }
}

module.exports = {
  getActiveConversation,
  updateConversation,
};