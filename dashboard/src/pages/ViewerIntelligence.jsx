import React, { useState, useEffect } from 'react';
import DataTable from '../components/DataTable.jsx';
import { getViewers, getViewer } from '../api/client.js';

const FILTER_OPTIONS = [
  { label: 'All',         value: ''           },
  { label: '🔴 Suspicious', value: 'suspicious' },
  { label: '🟡 Unverified', value: 'unverified' },
  { label: '🟢 Real',       value: 'real'       },
  { label: '⭐ Engaged',    value: 'engaged'    },
];

const SORT_OPTIONS = [
  { label: 'Points',         value: 'points'   },
  { label: 'Realness Score', value: 'realness' },
  { label: 'Streak',         value: 'streak'   },
  { label: 'First Seen',     value: 'first_seen' },
];

function RealnessBar({ score }) {
  const color = score < 25 ? 'var(--danger)' : score < 50 ? 'var(--warning)' : score < 75 ? 'var(--accent)' : 'var(--success)';
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
      <div style={{ flex: 1, backgroundColor: 'var(--bg-elevated)', borderRadius: 4, height: 6 }}>
        <div style={{ width: `${score}%`, backgroundColor: color, height: 6, borderRadius: 4, transition: 'width 300ms ease' }} />
      </div>
      <span style={{ fontSize: 12, color, fontWeight: 600, minWidth: 24 }}>{score}</span>
    </div>
  );
}

function ViewerDrawer({ viewerId, onClose }) {
  const [profile, setProfile] = useState(null);
  const [tab,     setTab]     = useState('overview');

  useEffect(() => {
    if (!viewerId) return;
    getViewer(viewerId).then(setProfile).catch(() => {});
  }, [viewerId]);

  if (!viewerId) return null;

  const v = profile?.viewer;

  return (
    <div
      style={{
        position: 'fixed', top: 0, right: 0, bottom: 0, width: 400,
        backgroundColor: 'var(--bg-surface)',
        borderLeft: '1px solid var(--border)',
        zIndex: 100, overflowY: 'auto', padding: 24,
        boxShadow: '-4px 0 24px rgba(0,0,0,0.4)',
      }}
    >
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20 }}>
        <h2 style={{ fontSize: 18, fontWeight: 700 }}>{v?.username || '...'}</h2>
        <button onClick={onClose} style={{ background: 'none', border: 'none', color: 'var(--text-muted)', cursor: 'pointer', fontSize: 20 }}>×</button>
      </div>

      {v && (
        <>
          <div style={{ display: 'flex', gap: 8, marginBottom: 16 }}>
            {['overview', 'sessions', 'conversations', 'flags'].map((t) => (
              <button
                key={t}
                onClick={() => setTab(t)}
                style={{
                  padding: '5px 12px', borderRadius: 6, fontSize: 12, fontWeight: 600,
                  backgroundColor: tab === t ? 'var(--accent)' : 'var(--bg-elevated)',
                  border: '1px solid var(--border)', color: tab === t ? '#fff' : 'var(--text-muted)',
                  cursor: 'pointer', textTransform: 'capitalize',
                }}
              >
                {t}
              </button>
            ))}
          </div>

          {tab === 'overview' && (
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10, fontSize: 13 }}>
              {[
                ['Points',     v.points],
                ['Rank',       v.rank],
                ['Realness',   v.realness_score],
                ['Streak',     v.stream_streak],
                ['Sub Tier',   v.sub_tier || 'None'],
                ['Mod',        v.is_mod ? 'Yes' : 'No'],
                ['VIP',        v.is_vip ? 'Yes' : 'No'],
                ['Flagged',    v.flagged ? '⚠️ Yes' : 'No'],
                ['First Seen', new Date(v.first_seen).toLocaleDateString()],
                ['Last Seen',  new Date(v.last_seen).toLocaleDateString()],
              ].map(([label, val]) => (
                <div key={label} style={{ backgroundColor: 'var(--bg-elevated)', borderRadius: 6, padding: '8px 10px' }}>
                  <p style={{ fontSize: 10, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 2 }}>{label}</p>
                  <p style={{ fontWeight: 600, color: 'var(--text-primary)' }}>{val ?? '—'}</p>
                </div>
              ))}
            </div>
          )}

          {tab === 'sessions' && (
            <div style={{ fontSize: 12 }}>
              {(profile?.session_history || []).map((s, i) => (
                <div key={i} style={{ padding: '8px 0', borderBottom: '1px solid var(--border)', color: 'var(--text-muted)' }}>
                  Session #{s.session_id} — {s.message_count} msgs — {new Date(s.joined_at).toLocaleDateString()}
                </div>
              ))}
            </div>
          )}

          {tab === 'conversations' && (
            <div>
              {(profile?.conversations || []).map((c, i) => (
                <div key={i} style={{ marginBottom: 16, backgroundColor: 'var(--bg-elevated)', borderRadius: 6, padding: 12 }}>
                  <p style={{ fontSize: 11, color: 'var(--text-muted)', marginBottom: 8 }}>
                    Session #{c.session_id} — {c.exchange_count} exchanges
                  </p>
                  {(c.messages || []).map((m, j) => (
                    <div key={j} style={{ marginBottom: 6, display: 'flex', gap: 6 }}>
                      <span style={{ fontSize: 11, fontWeight: 600, color: m.role === 'user' ? 'var(--accent)' : 'var(--success)', flexShrink: 0 }}>
                        {m.role === 'user' ? v.username : 'Bot'}:
                      </span>
                      <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>{m.content}</span>
                    </div>
                  ))}
                </div>
              ))}
            </div>
          )}

          {tab === 'flags' && (
            <div style={{ fontSize: 13 }}>
              {profile?.flags ? (
                <div>
                  <p style={{ color: 'var(--danger)', fontWeight: 600, marginBottom: 8 }}>⚠️ Flagged User</p>
                  <p style={{ color: 'var(--text-muted)' }}>Flag count: {profile.flags.flag_count}</p>
                  <p style={{ color: 'var(--text-muted)' }}>Reason: {profile.flags.reason}</p>
                  <p style={{ color: 'var(--text-muted)' }}>Permanently ignored: {profile.flags.permanently_ignored ? 'Yes' : 'No'}</p>
                </div>
              ) : (
                <p style={{ color: 'var(--text-muted)' }}>No flags recorded.</p>
              )}
            </div>
          )}
        </>
      )}
    </div>
  );
}

/**
 * Viewer Intelligence page with realness table, filters, and profile drawer.
 */
export default function ViewerIntelligence() {
  const [viewers,     setViewers]     = useState([]);
  const [filter,      setFilter]      = useState('');
  const [sort,        setSort]        = useState('points');
  const [search,      setSearch]      = useState('');
  const [selectedId,  setSelectedId]  = useState(null);

  useEffect(() => {
    getViewers({ sort, filter: filter || undefined, search: search || undefined })
      .then((d) => setViewers(d.viewers || []))
      .catch(() => {});
  }, [sort, filter, search]);

  const columns = [
    {
      key: 'realness_score',
      label: 'Realness',
      render: (v) => <RealnessBar score={v ?? 50} />,
    },
    { key: 'username',     label: 'Username' },
    { key: 'points',       label: 'Points',   render: (v) => v?.toLocaleString() },
    { key: 'stream_streak', label: 'Streak' },
    { key: 'rank',         label: 'Rank' },
    { key: 'first_seen',   label: 'First Seen', render: (v) => v ? new Date(v).toLocaleDateString() : '—' },
    {
      key: 'flagged',
      label: 'Flagged',
      render: (v) => v ? <span style={{ color: 'var(--danger)' }}>⚠️</span> : '—',
    },
  ];

  return (
    <div>
      <h1 style={{ fontSize: 20, fontWeight: 700, marginBottom: 20 }}>Viewer Intelligence</h1>

      <div style={{ display: 'flex', gap: 10, marginBottom: 20, flexWrap: 'wrap' }}>
        {FILTER_OPTIONS.map((o) => (
          <button
            key={o.value}
            onClick={() => setFilter(o.value)}
            style={{
              padding: '6px 14px', borderRadius: 6, fontSize: 13, fontWeight: filter === o.value ? 600 : 400,
              backgroundColor: filter === o.value ? 'var(--accent)' : 'var(--bg-surface)',
              border: '1px solid var(--border)', color: filter === o.value ? '#fff' : 'var(--text-muted)',
              cursor: 'pointer',
            }}
          >
            {o.label}
          </button>
        ))}
        <select
          value={sort}
          onChange={(e) => setSort(e.target.value)}
          style={{ padding: '6px 12px', backgroundColor: 'var(--bg-surface)', border: '1px solid var(--border)', borderRadius: 6, color: 'var(--text-primary)', fontSize: 13 }}
        >
          {SORT_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
        </select>
        <input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search username..."
          style={{ padding: '6px 12px', backgroundColor: 'var(--bg-surface)', border: '1px solid var(--border)', borderRadius: 6, color: 'var(--text-primary)', fontSize: 13, minWidth: 180 }}
        />
      </div>

      <div
        style={{ backgroundColor: 'var(--bg-surface)', border: '1px solid var(--border)', borderRadius: 8, overflow: 'hidden' }}
        onClick={(e) => {
          const row = e.target.closest('tr[data-id]');
          if (row) setSelectedId(row.dataset.id);
        }}
      >
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
          <thead>
            <tr style={{ borderBottom: '1px solid var(--border)' }}>
              {columns.map((c) => (
                <th key={c.key} style={{ padding: '10px 12px', textAlign: 'left', fontSize: 11, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.06em' }}>
                  {c.label}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {viewers.map((v) => (
              <tr
                key={v.twitch_id}
                data-id={v.twitch_id}
                onClick={() => setSelectedId(v.twitch_id)}
                style={{ borderBottom: '1px solid var(--border)', cursor: 'pointer', transition: 'background-color 150ms ease' }}
                onMouseEnter={(e) => (e.currentTarget.style.backgroundColor = 'var(--bg-elevated)')}
                onMouseLeave={(e) => (e.currentTarget.style.backgroundColor = 'transparent')}
              >
                {columns.map((c) => (
                  <td key={c.key} style={{ padding: '10px 12px', color: 'var(--text-primary)' }}>
                    {c.render ? c.render(v[c.key], v) : (v[c.key] ?? '—')}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
        {viewers.length === 0 && (
          <p style={{ padding: '32px 0', textAlign: 'center', color: 'var(--text-muted)', fontSize: 14 }}>No viewers found.</p>
        )}
      </div>

      <ViewerDrawer viewerId={selectedId} onClose={() => setSelectedId(null)} />
    </div>
  );
}
