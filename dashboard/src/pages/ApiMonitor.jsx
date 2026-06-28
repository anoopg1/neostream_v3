import React, { useState, useEffect } from 'react';
import MetricCard from '../components/MetricCard.jsx';
import { getApiCalls, getSpend, getHealth } from '../api/client.js';

/**
 * API Monitor page — spend tracking, health check, live call log.
 * @param {{ lastEvent: object|null }} props
 */
export default function ApiMonitor({ lastEvent }) {
  const [spend,  setSpend]  = useState(null);
  const [health, setHealth] = useState(null);
  const [calls,  setCalls]  = useState([]);

  const loadAll = () => {
    getSpend().then(setSpend).catch(() => {});
    getHealth().then(setHealth).catch(() => {});
    getApiCalls({ limit: 100 }).then((d) => setCalls(d.calls || [])).catch(() => {});
  };

  useEffect(loadAll, []);

  useEffect(() => {
    if (!lastEvent) return;
    if (lastEvent.type === 'API_CALL') {
      setCalls((prev) => [{ ...lastEvent.data, called_at: lastEvent.timestamp }, ...prev].slice(0, 100));
    }
    if (lastEvent.type === 'SPEND_ALERT') {
      setSpend((prev) => prev ? { ...prev, today_spend: lastEvent.data.dailyTotal } : prev);
    }
  }, [lastEvent]);

  const tw = health?.health?.twitch;
  const cl = health?.health?.claude;
  const healthColor = (v) => v === 'ok' ? 'var(--success)' : v === 'unreachable' ? 'var(--danger)' : 'var(--text-muted)';

  return (
    <div>
      <h1 style={{ fontSize: 20, fontWeight: 700, marginBottom: 20 }}>API Monitor</h1>

      {/* Health row */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, marginBottom: 24 }}>
        <div style={{ backgroundColor: 'var(--bg-surface)', border: '1px solid var(--border)', borderRadius: 8, padding: 16 }}>
          <p style={{ fontSize: 11, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 8 }}>Twitch API</p>
          <p style={{ fontWeight: 700, color: healthColor(tw), fontSize: 18 }}>{tw?.toUpperCase() || '—'}</p>
        </div>
        <div style={{ backgroundColor: 'var(--bg-surface)', border: '1px solid var(--border)', borderRadius: 8, padding: 16 }}>
          <p style={{ fontSize: 11, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 8 }}>Claude API</p>
          <p style={{ fontWeight: 700, color: healthColor(cl), fontSize: 18 }}>{cl?.toUpperCase() || '—'}</p>
        </div>
      </div>

      {/* Spend */}
      <div style={{ backgroundColor: 'var(--bg-surface)', border: '1px solid var(--border)', borderRadius: 8, padding: 16, marginBottom: 24 }}>
        <p style={{ fontSize: 13, fontWeight: 600, color: 'var(--text-muted)', marginBottom: 12 }}>CLAUDE SPEND</p>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 12, marginBottom: 16 }}>
          <MetricCard title="Today"      value={`$${(spend?.today_spend ?? 0).toFixed(2)}`}      accent />
          <MetricCard title="This Month" value={`$${(spend?.month_spend ?? 0).toFixed(2)}`} />
          <MetricCard title="Projected"  value={`$${(spend?.monthly_projection ?? 0).toFixed(2)}`} />
        </div>

        {spend && (
          <div>
            <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 11, color: 'var(--text-muted)', marginBottom: 4 }}>
              <span>Daily limit: ${spend.daily_limit?.toFixed(2)}</span>
              <span>{spend.limit_pct}% used</span>
            </div>
            <div style={{ backgroundColor: 'var(--bg-elevated)', borderRadius: 4, height: 8 }}>
              <div style={{
                height: 8, borderRadius: 4,
                width: `${Math.min(100, parseFloat(spend.limit_pct || 0))}%`,
                backgroundColor: parseFloat(spend.limit_pct || 0) > 90 ? 'var(--danger)' : parseFloat(spend.limit_pct || 0) > 70 ? 'var(--warning)' : 'var(--accent)',
                transition: 'width 300ms ease',
              }} />
            </div>
          </div>
        )}
      </div>

      {/* Live call log */}
      <h2 style={{ fontSize: 15, fontWeight: 700, marginBottom: 12 }}>Live API Call Log</h2>
      <div style={{ backgroundColor: 'var(--bg-surface)', border: '1px solid var(--border)', borderRadius: 8, overflow: 'hidden' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
          <thead>
            <tr style={{ borderBottom: '1px solid var(--border)' }}>
              {['Service', 'Endpoint', 'Tokens', 'Cost', 'Status', 'Time'].map((h) => (
                <th key={h} style={{ padding: '8px 12px', textAlign: 'left', fontSize: 10, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.06em' }}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {calls.map((c, i) => (
              <tr key={c.id ?? i} style={{ borderBottom: '1px solid var(--border)' }}>
                <td style={{ padding: '7px 12px' }}>
                  <span style={{
                    padding: '2px 8px', borderRadius: 99, fontSize: 10, fontWeight: 700,
                    color: c.service === 'claude' ? 'var(--accent)' : '#0ea5e9',
                    backgroundColor: c.service === 'claude' ? 'rgba(99,102,241,0.15)' : 'rgba(14,165,233,0.15)',
                  }}>
                    {(c.service || '').toUpperCase()}
                  </span>
                </td>
                <td style={{ padding: '7px 12px', color: 'var(--text-muted)', maxWidth: 180, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{c.endpoint || '—'}</td>
                <td style={{ padding: '7px 12px', color: 'var(--text-muted)' }}>{c.tokens_used ?? '—'}</td>
                <td style={{ padding: '7px 12px', color: c.cost_usd ? 'var(--text-primary)' : 'var(--text-muted)' }}>
                  {c.cost_usd ? `$${parseFloat(c.cost_usd).toFixed(5)}` : '—'}
                </td>
                <td style={{ padding: '7px 12px' }}>
                  <span style={{ color: c.success ? 'var(--success)' : 'var(--danger)', fontWeight: 600 }}>
                    {c.success ? '✓' : '✗'}
                  </span>
                </td>
                <td style={{ padding: '7px 12px', color: 'var(--text-muted)', whiteSpace: 'nowrap', fontSize: 11 }}>
                  {c.called_at ? new Date(c.called_at).toLocaleTimeString() : '—'}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {calls.length === 0 && (
          <p style={{ padding: '24px 0', textAlign: 'center', color: 'var(--text-muted)', fontSize: 13 }}>No API calls logged yet.</p>
        )}
      </div>
    </div>
  );
}
