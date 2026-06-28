import React, { useState, useEffect, useCallback } from 'react';
import { getDbStats, getDbMemory, deleteDbLogs, deleteDbViewers, exportTable } from '../api/client.js';
import ConfirmModal from '../components/ConfirmModal.jsx';

/**
 * Database Manager — memory stats, per-table info, and controlled delete operations.
 */
export default function DatabaseManager() {
  const [tables,      setTables]      = useState([]);
  const [memory,      setMemory]      = useState(null);
  const [confirmCtx,  setConfirmCtx]  = useState(null);

  const load = useCallback(() => {
    getDbStats().then((d) => setTables(d.tables || [])).catch(() => {});
    getDbMemory().then(setMemory).catch(() => {});
  }, []);

  useEffect(() => {
    load();
    const id = setInterval(load, 10_000);
    return () => clearInterval(id);
  }, [load]);

  const handleConfirm = async () => {
    if (!confirmCtx) return;
    try {
      if (confirmCtx.action === 'delete_logs') {
        await deleteDbLogs({ olderThanDays: confirmCtx.days });
      } else if (confirmCtx.action === 'delete_viewers') {
        await deleteDbViewers({ type: confirmCtx.type });
      }
      load();
    } catch {}
    setConfirmCtx(null);
  };

  const memItems = memory ? [
    { label: 'RSS',         value: memory.rss },
    { label: 'Heap Used',   value: memory.heap_used },
    { label: 'Heap Total',  value: memory.heap_total },
    { label: 'External',    value: memory.external },
  ] : [];

  return (
    <div>
      <h1 style={{ fontSize: 20, fontWeight: 700, marginBottom: 20 }}>Database Manager</h1>

      {/* Memory panel */}
      <div style={{ backgroundColor: 'var(--bg-surface)', border: '1px solid var(--border)', borderRadius: 8, padding: 16, marginBottom: 24 }}>
        <p style={{ fontSize: 11, fontWeight: 600, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 12 }}>
          Node.js Memory Usage
        </p>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 10 }}>
          {memItems.map(({ label, value }) => (
            <div key={label} style={{ backgroundColor: 'var(--bg-elevated)', borderRadius: 6, padding: '10px 12px' }}>
              <p style={{ fontSize: 10, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 4 }}>{label}</p>
              <p style={{ fontWeight: 700, color: 'var(--text-primary)', fontSize: 16 }}>{value}</p>
            </div>
          ))}
        </div>
      </div>

      {/* Quick delete actions */}
      <div style={{ display: 'flex', gap: 10, marginBottom: 24, flexWrap: 'wrap' }}>
        <button
          onClick={() => setConfirmCtx({ action: 'delete_logs', days: 30, msg: 'You are about to delete all logs older than 30 days.' })}
          style={{ padding: '7px 14px', backgroundColor: 'rgba(239,68,68,0.12)', border: '1px solid var(--danger)', borderRadius: 6, color: 'var(--danger)', fontSize: 13, cursor: 'pointer' }}
        >
          Delete Logs {'>'} 30 days
        </button>
        <button
          onClick={() => setConfirmCtx({ action: 'delete_viewers', type: 'flagged', msg: 'You are about to delete all flagged viewer records.' })}
          style={{ padding: '7px 14px', backgroundColor: 'rgba(239,68,68,0.12)', border: '1px solid var(--danger)', borderRadius: 6, color: 'var(--danger)', fontSize: 13, cursor: 'pointer' }}
        >
          Delete Flagged Viewers
        </button>
        <button
          onClick={() => setConfirmCtx({ action: 'delete_viewers', type: 'suspicious', msg: 'You are about to delete all suspicious viewer records (realness &lt; 25).' })}
          style={{ padding: '7px 14px', backgroundColor: 'rgba(239,68,68,0.12)', border: '1px solid var(--danger)', borderRadius: 6, color: 'var(--danger)', fontSize: 13, cursor: 'pointer' }}
        >
          Delete Suspicious Viewers
        </button>
      </div>

      {/* Table stats */}
      <h2 style={{ fontSize: 15, fontWeight: 700, marginBottom: 12 }}>Table Statistics</h2>
      <div style={{ backgroundColor: 'var(--bg-surface)', border: '1px solid var(--border)', borderRadius: 8, overflow: 'hidden' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
          <thead>
            <tr style={{ borderBottom: '1px solid var(--border)' }}>
              {['Table', 'Rows', 'Size', 'Export'].map((h) => (
                <th key={h} style={{ padding: '10px 12px', textAlign: 'left', fontSize: 11, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.06em' }}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {tables.map((t) => (
              <tr key={t.tablename} style={{ borderBottom: '1px solid var(--border)' }}
                onMouseEnter={(e) => (e.currentTarget.style.backgroundColor = 'var(--bg-elevated)')}
                onMouseLeave={(e) => (e.currentTarget.style.backgroundColor = 'transparent')}
              >
                <td style={{ padding: '10px 12px', fontWeight: 600, color: 'var(--text-primary)' }}>{t.tablename}</td>
                <td style={{ padding: '10px 12px', color: 'var(--text-muted)' }}>
                  {parseInt(t.row_count || 0, 10).toLocaleString()}
                </td>
                <td style={{ padding: '10px 12px', color: 'var(--text-muted)' }}>{t.total_size || '—'}</td>
                <td style={{ padding: '10px 12px' }}>
                  {t.tablename !== 'oauth_tokens' ? (
                    <a
                      href={exportTable(t.tablename)}
                      target="_blank"
                      rel="noopener noreferrer"
                      style={{ color: 'var(--accent)', fontSize: 12, textDecoration: 'none', fontWeight: 600 }}
                    >
                      CSV ↗
                    </a>
                  ) : (
                    <span style={{ color: 'var(--text-dim)', fontSize: 12 }}>Protected</span>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {tables.length === 0 && (
          <p style={{ padding: '24px 0', textAlign: 'center', color: 'var(--text-muted)', fontSize: 13 }}>No table data available.</p>
        )}
      </div>

      {confirmCtx && (
        <ConfirmModal
          message={confirmCtx.msg}
          onConfirm={handleConfirm}
          onCancel={() => setConfirmCtx(null)}
        />
      )}
    </div>
  );
}
