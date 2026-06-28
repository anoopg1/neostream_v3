'use strict';

const express = require('express');
const pool    = require('../../db/pool');

const router = express.Router();

/**
 * GET /api/viewers
 * Returns all viewers with optional sorting, filtering, and username search.
 * Query params: sort (points|realness|streak), filter (suspicious|unverified|real|engaged), search
 */
router.get('/', async (req, res) => {
  try {
    const { sort = 'points', filter, search } = req.query;

    const sortMap = {
      points:   'v.points DESC',
      realness: 'v.realness_score DESC',
      streak:   'v.stream_streak DESC',
      first_seen: 'v.first_seen ASC',
    };
    const orderBy = sortMap[sort] || 'v.points DESC';

    const conditions = [];
    const params     = [];

    if (filter === 'suspicious') {
      conditions.push('(v.flagged = true OR v.realness_score < 25)');
    } else if (filter === 'unverified') {
      conditions.push('(v.realness_score >= 25 AND v.realness_score < 50)');
    } else if (filter === 'real') {
      conditions.push('(v.realness_score >= 50 AND v.realness_score < 75)');
    } else if (filter === 'engaged') {
      conditions.push('v.realness_score >= 75');
    }

    if (search) {
      params.push(`%${search.toLowerCase()}%`);
      conditions.push(`LOWER(v.username) LIKE $${params.length}`);
    }

    const where = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';

    const result = await pool.query(
      `SELECT v.*,
              COUNT(DISTINCT sc.session_id) AS session_count
       FROM viewers v
       LEFT JOIN session_chatters sc ON sc.viewer_id = v.twitch_id
       ${where}
       GROUP BY v.twitch_id
       ORDER BY ${orderBy}`,
      params,
    );

    res.json({ viewers: result.rows });
  } catch (err) {
    console.error('[route/viewers] GET / error:', err.message);
    res.status(500).json({ error: 'Failed to fetch viewers' });
  }
});

/**
 * GET /api/viewers/:id
 * Returns a full viewer profile including session history, conversation history, and flags.
 */
router.get('/:id', async (req, res) => {
  try {
    const { id } = req.params;

    const viewerResult = await pool.query(
      'SELECT * FROM viewers WHERE twitch_id = $1',
      [id],
    );
    if (viewerResult.rows.length === 0) {
      return res.status(404).json({ error: 'Viewer not found' });
    }

    const sessionHistory = await pool.query(
      `SELECT sc.*, s.started_at AS session_started_at
       FROM session_chatters sc
       JOIN sessions s ON s.id = sc.session_id
       WHERE sc.viewer_id = $1
       ORDER BY s.started_at DESC
       LIMIT 20`,
      [id],
    );

    const conversations = await pool.query(
      `SELECT c.*,
              COALESCE(
                json_agg(cm ORDER BY cm.sent_at) FILTER (WHERE cm.id IS NOT NULL),
                '[]'::json
              ) AS messages
       FROM conversations c
       LEFT JOIN conversation_messages cm ON cm.conversation_id = c.id
       WHERE c.viewer_id = $1
       GROUP BY c.id
       ORDER BY c.started_at DESC
       LIMIT 10`,
      [id],
    );

    const flags = await pool.query(
      'SELECT * FROM flagged_users WHERE twitch_id = $1',
      [id],
    );

    res.json({
      viewer:          viewerResult.rows[0],
      session_history: sessionHistory.rows,
      conversations:   conversations.rows,
      flags:           flags.rows[0] || null,
    });
  } catch (err) {
    console.error('[route/viewers] GET /:id error:', err.message);
    res.status(500).json({ error: 'Failed to fetch viewer profile' });
  }
});

module.exports = router;
