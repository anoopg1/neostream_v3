'use strict';

const { spawn } = require('child_process');
const path      = require('path');

const isWindows = process.platform === 'win32';
const shell     = isWindows ? 'cmd' : '/bin/sh';
const shellFlag = isWindows ? '/c'  : '-c';
const node      = isWindows ? 'node.exe' : 'node';

const ROOT = path.join(__dirname, '..');

const BANNER = `
╔══════════════════════════════════════════════════════╗
║          NeoStream v3  —  neogrit's platform         ║
║                   Starting up...                     ║
╚══════════════════════════════════════════════════════╝
`;

console.log(BANNER);

/**
 * Spawns a child process and streams its output with a prefixed label.
 * @param {string} label   - Short label shown before each line of output.
 * @param {string} command - Shell command to run.
 * @param {string} cwd     - Working directory for the process.
 * @returns {import('child_process').ChildProcess}
 */
function spawnProcess(label, command, cwd) {
  const prefix = `[${label}] `;

  const child = spawn(shell, [shellFlag, command], {
    cwd,
    stdio: ['ignore', 'pipe', 'pipe'],
    env:   { ...process.env },
  });

  child.stdout.on('data', (data) => {
    String(data).split('\n').filter(Boolean).forEach((line) => {
      process.stdout.write(prefix + line + '\n');
    });
  });

  child.stderr.on('data', (data) => {
    String(data).split('\n').filter(Boolean).forEach((line) => {
      process.stderr.write(prefix + line + '\n');
    });
  });

  child.on('error', (err) => {
    console.error(`${prefix}Process error: ${err.message}`);
  });

  child.on('exit', (code, signal) => {
    if (code !== 0 && code !== null) {
      console.error(`${prefix}Process exited with code ${code}`);
    }
  });

  return child;
}

const botProcess       = spawnProcess('bot',       `${node} bot/index.js`,           ROOT);
const apiProcess       = spawnProcess('api',       `${node} api/index.js`,           ROOT);
const dashProcess      = spawnProcess('dashboard', `npm run dev`,                    path.join(ROOT, 'dashboard'));

console.log('  bot       → node bot/index.js');
console.log('  api       → node api/index.js');
console.log('  dashboard → cd dashboard && npm run dev');
console.log('\n  Dashboard: http://localhost:5173');
console.log('  API:       http://localhost:3500');
console.log('  WebSocket: ws://localhost:3501\n');

/**
 * Gracefully terminates all child processes on shutdown.
 * @param {string} signal - The OS signal received.
 */
function shutdown(signal) {
  console.log(`\n[start] Received ${signal}. Terminating child processes...`);
  [botProcess, apiProcess, dashProcess].forEach((p) => {
    try { p.kill('SIGTERM'); } catch (_) {}
  });
  setTimeout(() => process.exit(0), 3000);
}

process.on('SIGINT',  () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('unhandledRejection', (reason) => {
  console.error('[start] Unhandled rejection:', reason);
});
