'use strict';
require('dotenv').config();
const { Pool } = require('pg');

const pool = new Pool({
  host:     process.env.DB_HOST,
  port:     parseInt(process.env.DB_PORT, 10),
  database: process.env.DB_NAME,
  user:     process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  max:      20,
  idleTimeoutMillis:    30000,
  connectionTimeoutMillis: 5000,
});

pool.on('error', (err) => {
  console.error('[db/pool] Unexpected pool error:', err.message);
});

// Test connection on startup
pool.query('SELECT current_database(), current_schema(), COUNT(*) as conversation_history_count FROM conversation_history')
  .then(res => {
    console.log(`[db/pool] Connected to ${res.rows[0].current_database} / ${res.rows[0].current_schema}`);
    console.log(`[db/pool] conversation_history has ${res.rows[0].conversation_history_count} rows`);
  })
  .catch(err => {
    console.error('[db/pool] Connection test failed:', err.message);
  });

module.exports = pool;