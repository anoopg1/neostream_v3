'use strict';

const express = require('express');
const axios   = require('axios');
const pool    = require('../../db/pool');

const router = express.Router();

/**
 * GET /api/monitor/calls
 * Returns recent API calls log, filterable by service and date range.
 * Query params: service (twitch|claude), from, to, limit
 */
router.get('/calls', async (req, res) => {
  try {
    const { service, from, to, limit = '100' } = req.query;
    const conditions = [];
    const params     = [];

    if (service) {
      params.push(service);
      conditions.push(`service = $${params.length}`);
    }
    if (from) {
      params.push(from);
      conditions.push(`called_at >= $${params.length}`);
    }
    if (to) {
      params.push(to);
      conditions.push(`called_at <= $${params.length}`);
    }

    const where = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';
    params.push(parseInt(limit, 10));

    const result = await pool.query(
      `SELECT * FROM api_calls
       ${where}
       ORDER BY called_at DESC
       LIMIT $${params.length}`,
      params,
    );

    res.json({ calls: result.rows });
  } catch (err) {
    console.error('[route/apiMonitor] GET /calls error:', err.message);
    res.status(500).json({ error: 'Failed to fetch API calls' });
  }
});

/**
 * GET /api/monitor/spend
 * Returns Claude API spend for today, this month, and a monthly projection.
 */
router.get('/spend', async (_req, res) => {
  try {
    const [today, month] = await Promise.all([
      pool.query(
        `SELECT COALESCE(SUM(cost_usd), 0) AS total,
                COUNT(*) AS calls
         FROM api_calls
         WHERE service = 'claude' AND called_at >= CURRENT_DATE`,
      ),
      pool.query(
        `SELECT COALESCE(SUM(cost_usd), 0) AS total,
                COUNT(*) AS calls
         FROM api_calls
         WHERE service = 'claude'
           AND called_at >= DATE_TRUNC('month', NOW())`,
      ),
    ]);

    const dailyAvg = parseFloat(today.rows[0].total);
    const daysInMonth = new Date(
      new Date().getFullYear(),
      new Date().getMonth() + 1,
      0,
    ).getDate();
    const monthlyProjection = dailyAvg * daysInMonth;
    const limit = parseFloat(process.env.CLAUDE_DAILY_SPEND_LIMIT || '5.00');

    res.json({
      today_spend:        parseFloat(today.rows[0].total),
      today_calls:        parseInt(today.rows[0].calls, 10),
      month_spend:        parseFloat(month.rows[0].total),
      month_calls:        parseInt(month.rows[0].calls, 10),
      monthly_projection: monthlyProjection,
      daily_limit:        limit,
      limit_pct:          Math.min(100, (dailyAvg / limit) * 100).toFixed(1),
    });
  } catch (err) {
    console.error('[route/apiMonitor] GET /spend error:', err.message);
    res.status(500).json({ error: 'Failed to fetch spend data' });
  }
});

/**
 * GET /api/monitor/health
 * Checks live connectivity to both Twitch and Anthropic APIs.
 */
router.get('/health', async (_req, res) => {
  const results = { twitch: 'unknown', claude: 'unknown' };

  try {
    await axios.get('https://api.twitch.tv/helix', {
      headers: {
        'Client-Id':   process.env.TWITCH_CLIENT_ID || 'test',
        Authorization: 'Bearer invalid',
      },
      timeout:         5000,
      validateStatus:  (s) => s < 500,
    });
    results.twitch = 'ok';
  } catch (_) {
    results.twitch = 'unreachable';
  }

  try {
    await axios.post(
      'https://api.anthropic.com/v1/messages',
      {},
      {
        headers: {
          'x-api-key':         process.env.ANTHROPIC_API_KEY || 'test',
          'anthropic-version': '2023-06-01',
        },
        timeout:        5000,
        validateStatus: (s) => s < 500,
      },
    );
    results.claude = 'ok';
  } catch (_) {
    results.claude = 'unreachable';
  }

  res.json({ health: results, checked_at: new Date().toISOString() });
});

module.exports = router;
