'use strict';

require('dotenv').config();
const { WebSocketServer } = require('ws');

/** @type {WebSocketServer|null} */
let wss = null;

/**
 * Broadcasts a typed event to all connected WebSocket clients.
 * Skips clients whose connections are not in OPEN state.
 * @param {string} eventType - One of the defined event type strings.
 * @param {object} data      - Event payload to include.
 * @returns {void}
 */
function emit(eventType, data) {
  if (!wss) return;
  const payload = JSON.stringify({ type: eventType, data, timestamp: new Date().toISOString() });
  for (const client of wss.clients) {
    if (client.readyState === 1) {
      try {
        client.send(payload);
      } catch (err) {
        console.error('[ws] Failed to send to client:', err.message);
      }
    }
  }
}

/**
 * Starts the WebSocket server on the port defined by WS_PORT (default 3501).
 * Handles client connections, pings for liveness, and disconnects gracefully.
 * @returns {WebSocketServer}
 */
function startWebSocketServer() {
  const port = parseInt(process.env.WS_PORT || '3501', 10);

  wss = new WebSocketServer({ port });

  wss.on('listening', () => {
    console.log(`[ws] WebSocket server listening on port ${port}`);
  });

  wss.on('connection', (ws, req) => {
    const ip = req.socket.remoteAddress;
    console.log(`[ws] Client connected from ${ip} (${wss.clients.size} total)`);

    ws.isAlive = true;
    ws.on('pong', () => { ws.isAlive = true; });

    ws.on('close', () => {
      console.log(`[ws] Client disconnected (${wss.clients.size} remaining)`);
    });

    ws.on('error', (err) => {
      console.error('[ws] Client error:', err.message);
    });

    // Send initial connection confirmation
    try {
      ws.send(JSON.stringify({ type: 'CONNECTED', data: {}, timestamp: new Date().toISOString() }));
    } catch (_) {}
  });

  wss.on('error', (err) => {
    console.error('[ws] Server error:', err.message);
  });

  // Ping all clients every 30s to detect stale connections
  const pingInterval = setInterval(() => {
    for (const ws of wss.clients) {
      if (!ws.isAlive) {
        ws.terminate();
        continue;
      }
      ws.isAlive = false;
      ws.ping();
    }
  }, 30_000);

  wss.on('close', () => {
    clearInterval(pingInterval);
  });

  return wss;
}

module.exports = { startWebSocketServer, emit };
