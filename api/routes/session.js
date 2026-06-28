'use strict';

const express = require('express');
const pool    = require('../../db/pool');

const router = express.Router();

/**
 * GET /api/session/current
 * Returns the currently active session with a live viewer count estimate.
 */
router.get('/current', async (_req, res) => {
  try {
    const result = await pool.query(
      `SELECT s.*,
              COUNT(sc.viewer_id) AS live_viewer_count
       FROM sessions s
       LEFT JOIN session_chatters sc ON sc.session_id = s.id
       WHERE s.ended_at IS NULL
       GROUP BY s.id
       ORDER BY s.started_at DESC
       LIMIT 1`,
    );
    if (result.rows.length === 0) {
      return res.json({ session: null });
    }
    res.json({ session: result.rows[0] });
  } catch (err) {
    console.error('[route/session] /current error:', err.message);
    res.status(500).json({ error: 'Failed to fetch current session' });
  }
});

/**
 * GET /api/session/history
 * Returns the last 20 sessions in descending order.
 */
router.get('/history', async (_req, res) => {
  try {
    const result = await pool.query(
      `SELECT s.*,
              COUNT(DISTINCT sc.viewer_id) AS unique_chatters
       FROM sessions s
       LEFT JOIN session_chatters sc ON sc.session_id = s.id
       WHERE s.ended_at IS NOT NULL
       GROUP BY s.id
       ORDER BY s.started_at DESC
       LIMIT 20`,
    );
    res.json({ sessions: result.rows });
  } catch (err) {
    console.error('[route/session] /history error:', err.message);
    res.status(500).json({ error: 'Failed to fetch session history' });
  }
});

module.exports = router;
