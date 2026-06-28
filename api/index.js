'use strict';

require('dotenv').config();
const net     = require('net');
const express = require('express');
const cors    = require('cors');

const sessionRoutes    = require('./routes/session');
const viewerRoutes     = require('./routes/viewers');
const logRoutes        = require('./routes/logs');
const statsRoutes      = require('./routes/stats');
const followerRoutes   = require('./routes/followers');
const favoritesRoutes  = require('./routes/favorites');
const blacklistRoutes  = require('./routes/blacklist');
const databaseRoutes   = require('./routes/database');
const apiMonitorRoutes = require('./routes/apiMonitor');

const PORT = parseInt(process.env.API_PORT || '3500', 10);

const app = express();

app.use(cors({ origin: 'http://localhost:5173', credentials: true }));
app.use(express.json());

app.use('/api/session',   sessionRoutes);
app.use('/api/viewers',   viewerRoutes);
app.use('/api/logs',      logRoutes);
app.use('/api/stats',     statsRoutes);
app.use('/api/followers', followerRoutes);
app.use('/api/favorites', favoritesRoutes);
app.use('/api/blacklist', blacklistRoutes);
app.use('/api/database',  databaseRoutes);
app.use('/api/monitor',   apiMonitorRoutes);

app.get('/api/health', (_req, res) => {
  res.json({ status: 'ok', ts: new Date().toISOString() });
});

app.use((err, _req, res, _next) => {
  console.error('[api] Unhandled error:', err.message);
  res.status(500).json({ error: 'Internal server error' });
});

/**
 * Checks whether a TCP port is already in use.
 * Cross-platform alternative to lsof/netstat.
 * @param {number} port - Port number to test.
 * @returns {Promise<boolean>} True if the port is busy.
 */
function isPortInUse(port) {
  return new Promise((resolve) => {
    const server = net.createServer();
    server.once('error', () => resolve(true));
    server.once('listening', () => { server.close(); resolve(false); });
    server.listen(port, '127.0.0.1');
  });
}

/**
 * Starts the Express API server after verifying the port is free.
 * @returns {Promise<void>}
 */
async function startApi() {
  try {
    const busy = await isPortInUse(PORT);
    if (busy) {
      console.error(`❌ Port ${PORT} is already in use. Is the API already running?`);
      process.exit(1);
    }

    app.listen(PORT, () => {
      console.log(`✅ NeoStream API listening on http://localhost:${PORT}`);
    });
  } catch (err) {
    console.error('[api] Startup error:', err.message);
    process.exit(1);
  }
}

startApi();

module.exports = app;
