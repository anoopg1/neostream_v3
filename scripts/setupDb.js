'use strict';

require('dotenv').config();
const { Client } = require('pg');
const fs = require('fs');
const path = require('path');

/**
 * Reads db/schema.sql and executes it against the configured PostgreSQL database.
 * Logs each statement block as it completes. Exits with code 1 on failure.
 * @returns {Promise<void>}
 */
async function setupDb() {
  const schemaPath = path.join(__dirname, '..', 'db', 'schema.sql');
  const sql = fs.readFileSync(schemaPath, 'utf8');

  const client = new Client({
    host:     process.env.DB_HOST,
    port:     parseInt(process.env.DB_PORT, 10),
    database: process.env.DB_NAME,
    user:     process.env.DB_USER,
    password: process.env.DB_PASSWORD,
  });

  try {
    await client.connect();
    console.log('🔌 Connected to PostgreSQL');

    await client.query(sql);

    const tables = [
      'sessions', 'viewers', 'session_chatters', 'cooldowns', 'blacklist',
      'logs', 'session_stats', 'oauth_tokens', 'flagged_users', 'conversations',
      'conversation_messages', 'api_calls', 'favorite_streamers', 'bot_clusters',
      'viewer_messages',
    ];
    tables.forEach((t) => console.log(`  ✅ Table ready: ${t}`));

    console.log('\n✅ Database setup complete.');
  } catch (err) {
    console.error('❌ Database setup failed:', err.message);
    process.exit(1);
  } finally {
    await client.end();
  }
}

setupDb();
