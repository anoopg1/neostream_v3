'use strict';

const express = require('express');
const pool    = require('../../db/pool');

const router = express.Router();

const EXPORTABLE_TABLES = [
  'sessions', 'viewers', 'session_chatters', 'cooldowns', 'blacklist',
  'logs', 'oauth_tokens', 'flagged_users', 'conversations',
  'api_calls', 'favorite_streamers', 'bot_clusters', 'viewer_messages',
];

/**
 * GET /api/database/stats
 * Returns per-table row counts and on-disk size estimates.
 */
router.get('/stats', async (_req, res) => {
  try {
    const result = await pool.query(
      `SELECT
         relname AS table_name,
         n_live_tup AS row_count,
         pg_size_pretty(pg_total_relation_size(relid)) AS size
       FROM pg_stat_user_tables
       ORDER BY relname`,
    );
    res.json({ tables: result.rows });
  } catch (err) {
    console.error('[route/database] GET /stats error:', err.message);
    res.status(500).json({ error: 'Failed to fetch database stats' });
  }
});

/**
 * GET /api/database/memory
 * Returns current Node.js process memory usage in megabytes.
 */
router.get('/memory', (_req, res) => {
  const mem = process.memoryUsage();
  res.json({
    rss:        (mem.rss        / 1024 / 1024).toFixed(2) + ' MB',
    heap_used:  (mem.heapUsed   / 1024 / 1024).toFixed(2) + ' MB',
    heap_total: (mem.heapTotal  / 1024 / 1024).toFixed(2) + ' MB',
    external:   (mem.external   / 1024 / 1024).toFixed(2) + ' MB',
  });
});

/**
 * DELETE /api/database/logs
 * Deletes log records older than the specified number of days.
 * Requires body: { olderThanDays: number }
 * Requires confirmation header: X-Confirm: DELETE
 */
router.delete('/logs', async (req, res) => {
  try {
    if (req.headers['x-confirm'] !== 'DELETE') {
      return res.status(400).json({ error: 'Missing header: X-Confirm: DELETE' });
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
    console.error('[route/database] DELETE /logs error:', err.message);
    res.status(500).json({ error: 'Failed to delete logs' });
  }
});

/**
 * DELETE /api/database/viewers
 * Deletes viewer records by type: 'flagged' or 'suspicious'.
 * Requires body: { type: 'flagged'|'suspicious' }
 * Requires confirmation header: X-Confirm: DELETE
 */
router.delete('/viewers', async (req, res) => {
  try {
    if (req.headers['x-confirm'] !== 'DELETE') {
      return res.status(400).json({ error: 'Missing header: X-Confirm: DELETE' });
    }
    const { type } = req.body;
    if (type !== 'flagged' && type !== 'suspicious') {
      return res.status(400).json({ error: 'type must be "flagged" or "suspicious"' });
    }

    const condition = type === 'flagged'
      ? 'flagged = true'
      : 'realness_score < 25';

    const result = await pool.query(
      `DELETE FROM viewers WHERE ${condition}`,
    );
    res.json({ deleted: result.rowCount });
  } catch (err) {
    console.error('[route/database] DELETE /viewers error:', err.message);
    res.status(500).json({ error: 'Failed to delete viewers' });
  }
});

/**
 * GET /api/database/export/:table
 * Returns a CSV representation of the specified table.
 * Only allows exporting from a predefined safe table list.
 */
router.get('/export/:table', async (req, res) => {
  try {
    const { table } = req.params;
    if (!EXPORTABLE_TABLES.includes(table)) {
      return res.status(400).json({ error: 'Table not available for export' });
    }

    // oauth_tokens is blocked from export to protect credentials
    if (table === 'oauth_tokens') {
      return res.status(403).json({ error: 'oauth_tokens cannot be exported' });
    }

    const result = await pool.query(`SELECT * FROM ${table} LIMIT 10000`);
    if (result.rows.length === 0) {
      res.setHeader('Content-Type', 'text/csv');
      res.setHeader('Content-Disposition', `attachment; filename="${table}.csv"`);
      return res.send('');
    }

    const headers = Object.keys(result.rows[0]);
    const csvLines = [
      headers.join(','),
      ...result.rows.map((row) =>
        headers.map((h) => {
          const val = row[h];
          if (val === null || val === undefined) return '';
          const str = String(val).replace(/"/g, '""');
          return str.includes(',') || str.includes('"') || str.includes('\n') ? `"${str}"` : str;
        }).join(','),
      ),
    ];

    res.setHeader('Content-Type', 'text/csv');
    res.setHeader('Content-Disposition', `attachment; filename="${table}.csv"`);
    res.send(csvLines.join('\n'));
  } catch (err) {
    console.error('[route/database] GET /export error:', err.message);
    res.status(500).json({ error: 'Failed to export table' });
  }
});

module.exports = router;
