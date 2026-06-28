'use strict';

const express = require('express');
const pool    = require('../../db/pool');

const router = express.Router();

/**
 * GET /api/favorites
 * Returns all favorite streamers ordered by priority.
 */
router.get('/', async (_req, res) => {
  try {
    const result = await pool.query(
      `SELECT * FROM favorite_streamers
       ORDER BY priority_order ASC, added_at ASC`,
    );
    res.json({ favorites: result.rows });
  } catch (err) {
    console.error('[route/favorites] GET / error:', err.message);
    res.status(500).json({ error: 'Failed to fetch favorites' });
  }
});

/**
 * POST /api/favorites
 * Adds a new favorite streamer.
 * Body: { username: string, display_name?: string }
 */
router.post('/', async (req, res) => {
  try {
    const { username, display_name } = req.body;
    if (!username || typeof username !== 'string') {
      return res.status(400).json({ error: 'username is required' });
    }

    const maxOrder = await pool.query(
      'SELECT COALESCE(MAX(priority_order), 0) AS max FROM favorite_streamers',
    );

    const result = await pool.query(
      `INSERT INTO favorite_streamers (username, display_name, priority_order)
       VALUES ($1, $2, $3)
       RETURNING *`,
      [username.toLowerCase(), display_name || username, maxOrder.rows[0].max + 1],
    );

    res.status(201).json({ favorite: result.rows[0] });
  } catch (err) {
    if (err.code === '23505') {
      return res.status(409).json({ error: 'Already in favorites' });
    }
    console.error('[route/favorites] POST / error:', err.message);
    res.status(500).json({ error: 'Failed to add favorite' });
  }
});

/**
 * DELETE /api/favorites/:username
 * Removes a favorite streamer by username.
 */
router.delete('/:username', async (req, res) => {
  try {
    const { username } = req.params;
    const result = await pool.query(
      'DELETE FROM favorite_streamers WHERE username = $1 RETURNING *',
      [username.toLowerCase()],
    );
    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Favorite not found' });
    }
    res.json({ deleted: result.rows[0] });
  } catch (err) {
    console.error('[route/favorites] DELETE /:username error:', err.message);
    res.status(500).json({ error: 'Failed to remove favorite' });
  }
});

/**
 * PUT /api/favorites/reorder
 * Updates the priority_order of favorites.
 * Body: { ordered: string[] } — array of usernames in desired order.
 */
router.put('/reorder', async (req, res) => {
  try {
    const { ordered } = req.body;
    if (!Array.isArray(ordered)) {
      return res.status(400).json({ error: 'ordered must be an array of usernames' });
    }

    await Promise.all(
      ordered.map((username, index) =>
        pool.query(
          'UPDATE favorite_streamers SET priority_order = $1 WHERE username = $2',
          [index, username.toLowerCase()],
        ),
      ),
    );

    res.json({ reordered: true });
  } catch (err) {
    console.error('[route/favorites] PUT /reorder error:', err.message);
    res.status(500).json({ error: 'Failed to reorder favorites' });
  }
});

module.exports = router;
