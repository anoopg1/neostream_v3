'use strict';

const express = require('express');
const pool    = require('../../db/pool');

const router = express.Router();

/**
 * GET /api/stats
 * Returns aggregate platform-wide totals across all sessions.
 */
router.get('/', async (_req, res) => {
  try {
    const [sessions, viewers, messages, apiCalls, claudeSpend] = await Promise.all([
      pool.query('SELECT COUNT(*) AS total_sessions FROM sessions'),
      pool.query('SELECT COUNT(*) AS total_viewers FROM viewers'),
      pool.query('SELECT COALESCE(SUM(total_messages), 0) AS total_messages FROM sessions'),
      pool.query('SELECT COUNT(*) AS total_api_calls FROM api_calls'),
      pool.query(
        `SELECT COALESCE(SUM(cost_usd), 0) AS total_claude_spend
         FROM api_calls WHERE service = 'claude'`,
      ),
    ]);

    const realnessBreakdown = await pool.query(
      `SELECT
         COUNT(*) FILTER (WHERE realness_score < 25) AS suspicious,
         COUNT(*) FILTER (WHERE realness_score >= 25 AND realness_score < 50) AS unverified,
         COUNT(*) FILTER (WHERE realness_score >= 50 AND realness_score < 75) AS real,
         COUNT(*) FILTER (WHERE realness_score >= 75) AS engaged
       FROM viewers`,
    );

    res.json({
      total_sessions:      parseInt(sessions.rows[0].total_sessions, 10),
      total_viewers:       parseInt(viewers.rows[0].total_viewers, 10),
      total_messages:      parseInt(messages.rows[0].total_messages, 10),
      total_api_calls:     parseInt(apiCalls.rows[0].total_api_calls, 10),
      total_claude_spend:  parseFloat(claudeSpend.rows[0].total_claude_spend),
      realness_breakdown:  realnessBreakdown.rows[0],
    });
  } catch (err) {
    console.error('[route/stats] GET / error:', err.message);
    res.status(500).json({ error: 'Failed to fetch stats' });
  }
});

module.exports = router;
