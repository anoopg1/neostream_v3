'use strict';

require('dotenv').config();
const http = require('http');
const https = require('https');
const url = require('url');
const { storeToken } = require('../config/tokenManager');

const PORT = 3000;
const REDIRECT_URI = `http://localhost:${PORT}/callback`;

const SCOPES = [
  'chat:read',
  'chat:edit',
  'channel:moderate',
  'moderator:read:chatters',
  'channel:read:subscriptions',
  'moderator:read:followers',
].join(' ');

/**
 * Exchanges an authorization code for an access/refresh token pair.
 * @param {string} code - The authorization code from Twitch redirect.
 * @returns {Promise<{access_token: string, refresh_token: string, expires_in: number}>}
 */
async function exchangeCode(code) {
  return new Promise((resolve, reject) => {
    const body = new URLSearchParams({
      client_id:     process.env.TWITCH_CLIENT_ID,
      client_secret: process.env.TWITCH_CLIENT_SECRET,
      code,
      grant_type:    'authorization_code',
      redirect_uri:  REDIRECT_URI,
    }).toString();

    const options = {
      hostname: 'id.twitch.tv',
      path:     '/oauth2/token',
      method:   'POST',
      headers: {
        'Content-Type':   'application/x-www-form-urlencoded',
        'Content-Length': Buffer.byteLength(body),
      },
    };

    const req = https.request(options, (res) => {
      let data = '';
      res.on('data', (chunk) => { data += chunk; });
      res.on('end', () => {
        try {
          const parsed = JSON.parse(data);
          if (parsed.access_token) {
            resolve(parsed);
          } else {
            reject(new Error(`Token exchange failed: ${data}`));
          }
        } catch (e) {
          reject(new Error(`Failed to parse token response: ${data}`));
        }
      });
    });

    req.on('error', reject);
    req.write(body);
    req.end();
  });
}

/**
 * Retrieves the Twitch user info for a given access token.
 * @param {string} accessToken - The access token to validate.
 * @returns {Promise<{id: string, login: string}>}
 */
async function getUserInfo(accessToken) {
  return new Promise((resolve, reject) => {
    const options = {
      hostname: 'api.twitch.tv',
      path:     '/helix/users',
      method:   'GET',
      headers: {
        'Authorization': `Bearer ${accessToken}`,
        'Client-Id':     process.env.TWITCH_CLIENT_ID,
      },
    };

    const req = https.request(options, (res) => {
      let data = '';
      res.on('data', (chunk) => { data += chunk; });
      res.on('end', () => {
        try {
          const parsed = JSON.parse(data);
          if (parsed.data && parsed.data[0]) {
            resolve(parsed.data[0]);
          } else {
            reject(new Error(`Could not fetch user info: ${data}`));
          }
        } catch (e) {
          reject(new Error(`Failed to parse user response: ${data}`));
        }
      });
    });

    req.on('error', reject);
    req.end();
  });
}

/**
 * Starts the local OAuth callback server and opens the Twitch auth URL.
 * Accepts 'bot' or 'main' as the account type argument.
 * @param {'bot'|'main'} accountType - Which account to authorize.
 * @returns {Promise<void>}
 */
async function runOAuthFlow(accountType) {
  if (accountType !== 'bot' && accountType !== 'main') {
    console.error('❌ Invalid account type. Use: node scripts/getToken.js bot|main');
    process.exit(1);
  }

  const authUrl = `https://id.twitch.tv/oauth2/authorize?${new URLSearchParams({
    client_id:     process.env.TWITCH_CLIENT_ID,
    redirect_uri:  REDIRECT_URI,
    response_type: 'code',
    scope:         SCOPES,
  }).toString()}`;

  console.log(`\n🔑 Authorizing ${accountType} account...`);
  console.log('\n📋 Open this URL in your browser:\n');
  console.log(authUrl);
  console.log(`\nWaiting for callback on port ${PORT}...\n`);

  await new Promise((resolve, reject) => {
    const server = http.createServer(async (req, res) => {
      try {
        const parsed = url.parse(req.url, true);
        if (parsed.pathname !== '/callback') {
          res.writeHead(404);
          res.end('Not found');
          return;
        }

        const { code, error } = parsed.query;
        if (error) {
          res.writeHead(400, { 'Content-Type': 'text/html' });
          res.end(`<h2>Authorization denied: ${error}</h2><p>You may close this tab.</p>`);
          server.close(() => reject(new Error(`OAuth denied: ${error}`)));
          return;
        }

        if (!code) {
          res.writeHead(400, { 'Content-Type': 'text/html' });
          res.end('<h2>No code received.</h2><p>You may close this tab.</p>');
          server.close(() => reject(new Error('No authorization code received')));
          return;
        }

        const tokens = await exchangeCode(code);
        const user   = await getUserInfo(tokens.access_token);
        const expiry = new Date(Date.now() + tokens.expires_in * 1000);

        await storeToken(accountType, user.login, tokens.access_token, tokens.refresh_token, expiry);

        res.writeHead(200, { 'Content-Type': 'text/html' });
        res.end(`<h2>✅ Authorized ${user.login} as ${accountType}!</h2><p>You may close this tab.</p>`);

        console.log(`✅ Token stored for ${accountType} (${user.login})`);
        server.close(resolve);
      } catch (err) {
        console.error('[getToken] Callback error:', err.message);
        res.writeHead(500, { 'Content-Type': 'text/html' });
        res.end(`<h2>Error: ${err.message}</h2>`);
        server.close(() => reject(err));
      }
    });

    server.listen(PORT, '127.0.0.1', () => {
      console.log(`Listening on http://localhost:${PORT}`);
    });

    server.on('error', (err) => {
      reject(new Error(`Server error: ${err.message}`));
    });
  });
}

const accountType = process.argv[2];
runOAuthFlow(accountType).catch((err) => {
  console.error('❌ Token generation failed:', err.message);
  process.exit(1);
});
