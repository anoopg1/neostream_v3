import React, { useState, useEffect } from 'react';
import { Zap, ZapOff } from 'lucide-react';
import StatusBadge from './StatusBadge.jsx';
import { getSpend, getCurrentSession } from '../api/client.js';

/**
 * Fixed top navigation bar showing session timer, spend, and bot status.
 * @param {{ isConnected: boolean, lastEvent: object|null }} props
 */
export default function TopBar({ isConnected, lastEvent }) {
  const [botAlive,      setBotAlive]      = useState(true);
  const [sessionStart,  setSessionStart]  = useState(null);
  const [elapsed,       setElapsed]       = useState('—');
  const [claudeSpend,   setClaudeSpend]   = useState('0.00');

  // Track kill/revive events from WebSocket
  useEffect(() => {
    if (!lastEvent) return;
    if (lastEvent.type === 'BOT_KILLED')  setBotAlive(false);
    if (lastEvent.type === 'BOT_REVIVED') setBotAlive(true);
    if (lastEvent.type === 'SESSION_STARTED') {
      setSessionStart(new Date());
    }
  }, [lastEvent]);

  // Fetch current session on mount
  useEffect(() => {
    getCurrentSession().then((d) => {
      if (d?.session?.started_at) setSessionStart(new Date(d.session.started_at));
    }).catch(() => {});

    getSpend().then((d) => {
      if (d?.today_spend !== undefined) setClaudeSpend(d.today_spend.toFixed(2));
    }).catch(() => {});
  }, []);

  // Live session duration timer
  useEffect(() => {
    if (!sessionStart) return;
    const id = setInterval(() => {
      const diff = Math.floor((Date.now() - sessionStart.getTime()) / 1000);
      const h = Math.floor(diff / 3600);
      const m = Math.floor((diff % 3600) / 60);
      const s = diff % 60;
      setElapsed(
        `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`,
      );
    }, 1000);
    return () => clearInterval(id);
  }, [sessionStart]);

  return (
    <header
      style={{
        height: 56,
        flexShrink: 0,
        backgroundColor: 'var(--bg-surface)',
        borderBottom: '1px solid var(--border)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        padding: '0 24px',
        gap: 16,
      }}
    >
      <span style={{ fontWeight: 700, fontSize: 16, color: 'var(--text-primary)' }}>
        NeoStream v3
      </span>

      <div style={{ display: 'flex', alignItems: 'center', gap: 8, color: 'var(--text-muted)', fontSize: 14 }}>
        <span style={{ fontVariantNumeric: 'tabular-nums', color: 'var(--text-primary)', fontWeight: 500 }}>
          {elapsed}
        </span>
      </div>

      <div style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
        <span style={{ fontSize: 13, color: 'var(--text-muted)' }}>
          Claude:{' '}
          <span style={{ color: 'var(--text-primary)', fontWeight: 600 }}>${claudeSpend}</span>
        </span>

        <StatusBadge alive={botAlive} connected={isConnected} />

        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 6,
            fontSize: 12,
            color: isConnected ? 'var(--success)' : 'var(--text-muted)',
          }}
        >
          <span style={{
            width: 6,
            height: 6,
            borderRadius: '50%',
            backgroundColor: isConnected ? 'var(--success)' : 'var(--text-muted)',
            display: 'inline-block',
          }} />
          {isConnected ? 'WS' : 'OFFLINE'}
        </div>
      </div>
    </header>
  );
}
