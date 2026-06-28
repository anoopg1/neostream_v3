'use strict';

const express = require('express');
const pool    = require('../../db/pool');
const { addToBlacklist, removeFromBlacklist, getAll } = require('../../safety/blacklist');

const router = express.Router();

/**
 * GET /api/blacklist
 * Returns all blacklisted channels.
 */
router.get('/', async (_req, res) => {
  try {
    const result = await pool.query(
      'SELECT * FROM blacklist ORDER BY added_at DESC',
    );
    res.json({ blacklist: result.rows });
  } catch (err) {
    console.error('[route/blacklist] GET / error:', err.message);
    res.status(500).json({ error: 'Failed to fetch blacklist' });
  }
});

/**
 * POST /api/blacklist
 * Adds a channel to the blacklist.
 * Body: { channel: string, reason?: string }
 */
router.post('/', async (req, res) => {
  try {
    const { channel, reason } = req.body;
    if (!channel || typeof channel !== 'string') {
      return res.status(400).json({ error: 'channel is required' });
    }
    await addToBlacklist(channel, reason || null);
    res.status(201).json({ added: channel.toLowerCase() });
  } catch (err) {
    if (err.code === '23505') {
      return res.status(409).json({ error: 'Channel already blacklisted' });
    }
    console.error('[route/blacklist] POST / error:', err.message);
    res.status(500).json({ error: 'Failed to add to blacklist' });
  }
});

/**
 * DELETE /api/blacklist/:channel
 * Removes a channel from the blacklist.
 */
router.delete('/:channel', async (req, res) => {
  try {
    const { channel } = req.params;
    await removeFromBlacklist(channel);
    res.json({ removed: channel.toLowerCase() });
  } catch (err) {
    console.error('[route/blacklist] DELETE /:channel error:', err.message);
    res.status(500).json({ error: 'Failed to remove from blacklist' });
  }
});

module.exports = router;
