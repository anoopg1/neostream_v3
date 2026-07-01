'use strict';
require('dotenv').config();
const http = require('http');
const url = require('url');
const pool = require('../db/pool');

const CLIENT_ID = process.env.TWITCH_CLIENT_ID;
const CLIENT_SECRET = process.env.TWITCH_CLIENT_SECRET;
const REDIRECT_URI = 'http://localhost:3500/callback';

const SCOPES = 'chat:read chat:edit moderator:read:chatters channel:read:subscriptions bits:read moderator:read:followers user:read:broadcast';

const server = http.createServer(async (req, res) => {
  const parsedUrl = url.parse(req.url, true);
  
  if (parsedUrl.pathname === '/callback') {
    const code = parsedUrl.query.code;
    if (!code) {
      res.writeHead(400);
      res.end('No code');
      return;
    }

    try {
      const tokenRes = await fetch('https://id.twitch.tv/oauth2/token', {
        method: 'POST',
        body: new URLSearchParams({
          client_id: CLIENT_ID,
          client_secret: CLIENT_SECRET,
          code,
          grant_type: 'authorization_code',
          redirect_uri: REDIRECT_URI,
        }),
      });

      const tokenData = await tokenRes.json();
      if (!tokenData.access_token) throw new Error(tokenData.error);

      const userRes = await fetch('https://api.twitch.tv/helix/users', {
        headers: {
          'Client-ID': CLIENT_ID,
          'Authorization': `Bearer ${tokenData.access_token}`,
        },
      });

      const userData = await userRes.json();
      const username = userData.data[0].login;
      const accountType = username === process.env.BOT_USERNAME ? 'bot' : 'main';

      await pool.query(
        `INSERT INTO oauth_tokens (account_type, username, access_token, refresh_token, expires_at)
         VALUES ($1, $2, $3, $4, NOW() + INTERVAL '60 days')
         ON CONFLICT (account_type) DO UPDATE SET access_token = $3, refresh_token = $4, expires_at = NOW() + INTERVAL '60 days'`,
        [accountType, username, tokenData.access_token, tokenData.refresh_token]
      );

      res.writeHead(200, { 'Content-Type': 'text/html' });
      res.end(`<h1>✅ ${accountType} (${username}) authorized!</h1><p>Close this and run the script again for the other account.</p>`);
      console.log(`\n✅ ${accountType.toUpperCase()} authorized: ${username}\n`);
      server.close();
    } catch (err) {
      console.error('ERROR:', err.message);
      res.writeHead(500);
      res.end(err.message);
      server.close();
    }
  }
});

server.listen(3500, () => {
  const authUrl = `https://id.twitch.tv/oauth2/authorize?client_id=${CLIENT_ID}&redirect_uri=${encodeURIComponent(REDIRECT_URI)}&response_type=code&scope=${encodeURIComponent(SCOPES)}`;
  console.log('\n🔗 Auth URL:\n' + authUrl + '\n');
});