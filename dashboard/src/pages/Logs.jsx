import React, { useState, useEffect, useCallback } from 'react';
import { getLogs, deleteLogs, exportTable } from '../api/client.js';
import ConfirmModal from '../components/ConfirmModal.jsx';

const PAGE_SIZE = 50;

const LOG_TYPES = ['', 'welcome', 'reply', 'shoutout', 'visit', 'event', 'poison', 'mod_action'];

const TYPE_COLORS = {
  welcome:    'var(--success)',
  reply:      'var(--accent)',
  shoutout:   '#f59e0b',
  visit:      '#06b6d4',
  event:      '#8b5cf6',
  poison:     'var(--danger)',
  mod_action: 'var(--warning)',
};

function TypeBadge({ type }) {
  const color = TYPE_COLORS[type] || 'var(--text-muted)';
  return (
    <span style={{
      display: 'inline-block',
      padding: '2px 8px',
      borderRadius: 99,
      fontSize: 10,
      fontWeight: 700,
      color,
      backgroundColor: color + '22',
      border: `1px solid ${color}`,
      textTransform: 'uppercase',
      letterSpacing: '0.05em',
    }}>
      {type}
    </span>
  );
}

/**
 * Logs page with type filters, username search, date range, pagination, and CSV export.
 */
export default function Logs() {
  const [logs,        setLogs]        = useState([]);
  const [total,       setTotal]       = useState(0);
  const [offset,      setOffset]      = useState(0);
  const [type,        setType]        = useState('');
  const [search,      setSearch]      = useState('');
  const [from,        setFrom]        = useState('');
  const [to,          setTo]          = useState('');
  const [showConfirm, setShowConfirm] = useState(false);
  const [expandedId,  setExpandedId]  = useState(null);

  const load = useCallback(() => {
    const params = { limit: PAGE_SIZE, offset };
    if (type)   params.type = type;
    if (search) params.username = search;
    if (from)   params.from = from;
    if (to)     params.to   = to;

    getLogs(params).then((d) => {
      setLogs(d.logs || []);
      setTotal(d.total || 0);
    }).catch(() => {});
  }, [type, search, from, to, offset]);

  useEffect(() => { load(); }, [load]);

  const handleDeleteOld = async () => {
    try { await deleteLogs({ olderThanDays: 30 }); load(); } catch {}
    setShowConfirm(false);
  };

  const relativeTime = (ts) => {
    const diff = Math.floor((Date.now() - new Date(ts).getTime()) / 1000);
    if (diff < 60)   return `${diff}s ago`;
    if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
    if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;
    return `${Math.floor(diff / 86400)}d ago`;
  };

  return (
    <div>
      <h1 style={{ fontSize: 20, fontWeight: 700, marginBottom: 20 }}>Logs</h1>

      {/* Filter bar */}
      <div style={{ display: 'flex', gap: 10, marginBottom: 20, flexWrap: 'wrap', alignItems: 'center' }}>
        <select
          value={type}
          onChange={(e) => { setType(e.target.value); setOffset(0); }}
          style={{ padding: '7px 12px', backgroundColor: 'var(--bg-surface)', border: '1px solid var(--border)', borderRadius: 6, color: 'var(--text-primary)', fontSize: 13 }}
        >
          <option value="">All Types</option>
          {LOG_TYPES.filter(Boolean).map((t) => <option key={t} value={t}>{t}</option>)}
        </select>
        <input
          value={search}
          onChange={(e) => { setSearch(e.target.value); setOffset(0); }}
          placeholder="Username..."
          style={{ padding: '7px 12px', backgroundColor: 'var(--bg-surface)', border: '1px solid var(--border)', borderRadius: 6, color: 'var(--text-primary)', fontSize: 13, minWidth: 150 }}
        />
        <input type="date" value={from} onChange={(e) => setFrom(e.target.value)}
          style={{ padding: '7px 12px', backgroundColor: 'var(--bg-surface)', border: '1px solid var(--border)', borderRadius: 6, color: 'var(--text-primary)', fontSize: 13 }}
        />
        <input type="date" value={to} onChange={(e) => setTo(e.target.value)}
          style={{ padding: '7px 12px', backgroundColor: 'var(--bg-surface)', border: '1px solid var(--border)', borderRadius: 6, color: 'var(--text-primary)', fontSize: 13 }}
        />
        <a
          href={exportTable('logs')}
          target="_blank"
          rel="noopener noreferrer"
          style={{ padding: '7px 14px', backgroundColor: 'var(--bg-elevated)', border: '1px solid var(--border)', borderRadius: 6, color: 'var(--text-primary)', fontSize: 13, textDecoration: 'none' }}
        >
          Export CSV
        </a>
        <button
          onClick={() => setShowConfirm(true)}
          style={{ padding: '7px 14px', backgroundColor: 'rgba(239,68,68,0.15)', border: '1px solid var(--danger)', borderRadius: 6, color: 'var(--danger)', fontSize: 13, cursor: 'pointer' }}
        >
          Delete {'>'} 30 days
        </button>
      </div>

      <p style={{ fontSize: 12, color: 'var(--text-muted)', marginBottom: 12 }}>
        {total} logs total — showing {offset + 1}–{Math.min(offset + PAGE_SIZE, total)}
      </p>

      {/* Logs table */}
      <div style={{ backgroundColor: 'var(--bg-surface)', border: '1px solid var(--border)', borderRadius: 8, overflow: 'hidden' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
          <thead>
            <tr style={{ borderBottom: '1px solid var(--border)' }}>
              {['Type', 'Recipient', 'Channel', 'Message', 'Time'].map((h) => (
                <th key={h} style={{ padding: '10px 12px', textAlign: 'left', fontSize: 11, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.06em' }}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {logs.map((log) => (
              <tr
                key={log.id}
                style={{ borderBottom: '1px solid var(--border)', cursor: 'pointer' }}
                onClick={() => setExpandedId(expandedId === log.id ? null : log.id)}
                onMouseEnter={(e) => (e.currentTarget.style.backgroundColor = 'var(--bg-elevated)')}
                onMouseLeave={(e) => (e.currentTarget.style.backgroundColor = 'transparent')}
              >
                <td style={{ padding: '8px 12px' }}><TypeBadge type={log.type} /></td>
                <td style={{ padding: '8px 12px', color: 'var(--text-muted)' }}>{log.recipient || '—'}</td>
                <td style={{ padding: '8px 12px', color: 'var(--text-muted)' }}>{log.channel || '—'}</td>
                <td style={{ padding: '8px 12px', maxWidth: 300 }}>
                  <span title={log.message} style={{ color: 'var(--text-primary)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: expandedId === log.id ? 'normal' : 'nowrap', display: 'block' }}>
                    {log.message}
                  </span>
                </td>
                <td style={{ padding: '8px 12px', color: 'var(--text-muted)', whiteSpace: 'nowrap' }} title={new Date(log.sent_at).toLocaleString()}>
                  {relativeTime(log.sent_at)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {logs.length === 0 && (
          <p style={{ padding: '32px 0', textAlign: 'center', color: 'var(--text-muted)', fontSize: 14 }}>No logs found.</p>
        )}
      </div>

      {/* Pagination */}
      {total > PAGE_SIZE && (
        <div style={{ display: 'flex', gap: 8, justifyContent: 'center', marginTop: 16 }}>
          <button
            onClick={() => setOffset(Math.max(0, offset - PAGE_SIZE))}
            disabled={offset === 0}
            style={{ padding: '7px 14px', backgroundColor: 'var(--bg-surface)', border: '1px solid var(--border)', borderRadius: 6, color: 'var(--text-muted)', cursor: offset === 0 ? 'not-allowed' : 'pointer', fontSize: 13 }}
          >
            Previous
          </button>
          <button
            onClick={() => offset + PAGE_SIZE < total && setOffset(offset + PAGE_SIZE)}
            disabled={offset + PAGE_SIZE >= total}
            style={{ padding: '7px 14px', backgroundColor: 'var(--bg-surface)', border: '1px solid var(--border)', borderRadius: 6, color: 'var(--text-muted)', cursor: offset + PAGE_SIZE >= total ? 'not-allowed' : 'pointer', fontSize: 13 }}
          >
            Load More
          </button>
        </div>
      )}

      {showConfirm && (
        <ConfirmModal
          message="You are about to delete all logs older than 30 days."
          onConfirm={handleDeleteOld}
          onCancel={() => setShowConfirm(false)}
        />
      )}
    </div>
  );
}
