'use strict';

require('dotenv').config();

const REQUIRED_ENV_VARS = [
  'TWITCH_CLIENT_ID',
  'TWITCH_CLIENT_SECRET',
  'MAIN_USERNAME',
  'BOT_USERNAME',
  'ANTHROPIC_API_KEY',
  'CHANNEL',
  'DB_HOST',
  'DB_PORT',
  'DB_NAME',
  'DB_USER',
  'DB_PASSWORD',
  'API_PORT',
  'WS_PORT',
];

/**
 * Checks that all 17 required environment variables are present.
 * Prints each missing variable and exits with code 1 if any are absent.
 * @returns {void}
 */
function checkEnv() {
  const missing = REQUIRED_ENV_VARS.filter((key) => !process.env[key]);

  if (missing.length > 0) {
    console.error('❌ Missing required environment variables:');
    missing.forEach((key) => console.error(`   - ${key}`));
    console.error('\nCopy .env.example to .env and fill in all values.');
    process.exit(1);
  }

  console.log('✅ All environment variables are present.');
}

checkEnv();

module.exports = { checkEnv };
