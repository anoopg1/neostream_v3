'use strict';

const express = require('express');
const pool    = require('../../db/pool');

const router = express.Router();

/**
 * GET /api/logs
 * Returns paginated logs with optional filters.
 * Query params: type, username, channel, from, to, limit, offset
 */
router.get('/', async (req, res) => {
  try {
    const {
      type,
      username,
      channel,
      from,
      to,
      limit  = '50',
      offset = '0',
    } = req.query;

    const conditions = [];
    const params     = [];

    if (type) {
      params.push(type);
      conditions.push(`type = $${params.length}`);
    }
    if (username) {
      params.push(username.toLowerCase());
      conditions.push(`LOWER(recipient) = $${params.length}`);
    }
    if (channel) {
      params.push(channel.toLowerCase());
      conditions.push(`LOWER(channel) = $${params.length}`);
    }
    if (from) {
      params.push(from);
      conditions.push(`sent_at >= $${params.length}`);
    }
    if (to) {
      params.push(to);
      conditions.push(`sent_at <= $${params.length}`);
    }

    const where = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';

    params.push(parseInt(limit, 10));
    params.push(parseInt(offset, 10));

    const result = await pool.query(
      `SELECT * FROM logs
       ${where}
       ORDER BY sent_at DESC
       LIMIT $${params.length - 1} OFFSET $${params.length}`,
      params,
    );

    const countResult = await pool.query(
      `SELECT COUNT(*) AS total FROM logs ${where}`,
      params.slice(0, params.length - 2),
    );

    res.json({
      logs:   result.rows,
      total:  parseInt(countResult.rows[0].total, 10),
      limit:  parseInt(limit, 10),
      offset: parseInt(offset, 10),
    });
  } catch (err) {
    console.error('[route/logs] GET / error:', err.message);
    res.status(500).json({ error: 'Failed to fetch logs' });
  }
});

/**
 * DELETE /api/logs
 * Deletes logs older than the specified number of days.
 * Requires body: { olderThanDays: number }
 * Requires confirmation header: X-Confirm: DELETE
 */
router.delete('/', async (req, res) => {
  try {
    const confirm = req.headers['x-confirm'];
    if (confirm !== 'DELETE') {
      return res.status(400).json({ error: 'Missing confirmation header: X-Confirm: DELETE' });
    }

    const { olderThanDays } = req.body;
    if (!olderThanDays || typeof olderThanDays !== 'number' || olderThanDays < 1) {
      return res.status(400).json({ error: 'olderThanDays must be a positive number' });
    }

    const result = await pool.query(
      `DELETE FROM logs WHERE sent_at < NOW() - INTERVAL '${Math.floor(olderThanDays)} days'`,
    );

    res.json({ deleted: result.rowCount });
  } catch (err) {
    console.error('[route/logs] DELETE / error:', err.message);
    res.status(500).json({ error: 'Failed to delete logs' });
  }
});

module.exports = router;
