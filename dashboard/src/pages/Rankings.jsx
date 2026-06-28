import React, { useState, useEffect } from 'react';
import { getViewers } from '../api/client.js';

const RANK_TIERS = ['All', 'Lurker', 'Chatter', 'Regular', 'Veteran', 'Legend'];

const RANK_BADGE = {
  Lurker:  { emoji: '🟤', color: '#92400e' },
  Chatter: { emoji: '🟢', color: '#15803d' },
  Regular: { emoji: '🔵', color: '#1d4ed8' },
  Veteran: { emoji: '🟣', color: '#7e22ce' },
  Legend:  { emoji: '🟡', color: '#92400e' },
};

const SUB_TIER_LABEL = { '1': 'T1', '2': 'T2', '3': 'T3' };

/**
 * Rankings page with tier tabs and gold-glow Legend rows.
 */
export default function Rankings() {
  const [viewers, setViewers]   = useState([]);
  const [tier,    setTier]      = useState('All');

  useEffect(() => {
    getViewers({ sort: 'points' }).then((d) => setViewers(d.viewers || [])).catch(() => {});
  }, []);

  const displayed = tier === 'All' ? viewers : viewers.filter((v) => v.rank === tier);

  return (
    <div>
      <h1 style={{ fontSize: 20, fontWeight: 700, marginBottom: 20 }}>Rankings</h1>

      <div style={{ display: 'flex', gap: 8, marginBottom: 20, flexWrap: 'wrap' }}>
        {RANK_TIERS.map((t) => (
          <button
            key={t}
            onClick={() => setTier(t)}
            style={{
              padding: '6px 16px', borderRadius: 6, fontSize: 13, fontWeight: tier === t ? 700 : 400,
              backgroundColor: tier === t ? 'var(--accent)' : 'var(--bg-surface)',
              border: '1px solid var(--border)', color: tier === t ? '#fff' : 'var(--text-muted)',
              cursor: 'pointer',
            }}
          >
            {RANK_BADGE[t]?.emoji || ''} {t}
          </button>
        ))}
      </div>

      <div style={{ backgroundColor: 'var(--bg-surface)', border: '1px solid var(--border)', borderRadius: 8, overflow: 'hidden' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
          <thead>
            <tr style={{ borderBottom: '1px solid var(--border)' }}>
              {['#', 'Rank', 'Username', 'Points', 'Streak', 'Sub', 'Type', 'Realness', 'Sessions'].map((h) => (
                <th key={h} style={{ padding: '10px 12px', textAlign: 'left', fontSize: 11, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.06em' }}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {displayed.map((v, i) => {
              const isLegend = v.rank === 'Legend';
              const badge = RANK_BADGE[v.rank] || {};
              return (
                <tr
                  key={v.twitch_id}
                  style={{
                    borderBottom: '1px solid var(--border)',
                    backgroundColor: isLegend ? 'rgba(234,179,8,0.06)' : 'transparent',
                    boxShadow: isLegend ? 'inset 0 0 0 1px rgba(234,179,8,0.15)' : 'none',
                    transition: 'background-color 150ms ease',
                  }}
                  onMouseEnter={(e) => !isLegend && (e.currentTarget.style.backgroundColor = 'var(--bg-elevated)')}
                  onMouseLeave={(e) => !isLegend && (e.currentTarget.style.backgroundColor = 'transparent')}
                >
                  <td style={{ padding: '10px 12px', color: 'var(--text-muted)', fontWeight: 600 }}>{i + 1}</td>
                  <td style={{ padding: '10px 12px' }}>
                    <span style={{ fontSize: 14, marginRight: 6 }}>{badge.emoji}</span>
                    <span style={{ color: badge.color, fontWeight: 600 }}>{v.rank}</span>
                  </td>
                  <td style={{ padding: '10px 12px', fontWeight: 600, color: isLegend ? '#fbbf24' : 'var(--text-primary)' }}>
                    {v.username}
                  </td>
                  <td style={{ padding: '10px 12px' }}>{(v.points || 0).toLocaleString()}</td>
                  <td style={{ padding: '10px 12px' }}>{v.stream_streak || 0}</td>
                  <td style={{ padding: '10px 12px', color: v.sub_tier ? 'var(--success)' : 'var(--text-muted)' }}>
                    {SUB_TIER_LABEL[v.sub_tier] || '—'}
                  </td>
                  <td style={{ padding: '10px 12px', color: 'var(--text-muted)', fontSize: 11 }}>{v.broadcaster_type || '—'}</td>
                  <td style={{ padding: '10px 12px' }}>
                    <span style={{
                      color: v.realness_score < 25 ? 'var(--danger)' : v.realness_score < 50 ? 'var(--warning)' : v.realness_score < 75 ? 'var(--accent)' : 'var(--success)',
                      fontWeight: 600,
                    }}>
                      {v.realness_score ?? '—'}
                    </span>
                  </td>
                  <td style={{ padding: '10px 12px', color: 'var(--text-muted)' }}>{v.session_count ?? '—'}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
        {displayed.length === 0 && (
          <p style={{ padding: '32px 0', textAlign: 'center', color: 'var(--text-muted)', fontSize: 14 }}>No viewers in this tier.</p>
        )}
      </div>
    </div>
  );
}
