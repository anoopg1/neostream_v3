import React from 'react';

/**
 * Reusable sortable data table.
 * @param {{ columns: Array<{key: string, label: string, render?: Function}>, rows: Array, emptyMessage?: string }} props
 */
export default function DataTable({ columns, rows, emptyMessage = 'No data.' }) {
  if (!rows || rows.length === 0) {
    return (
      <div style={{ padding: '32px 0', textAlign: 'center', color: 'var(--text-muted)', fontSize: 14 }}>
        {emptyMessage}
      </div>
    );
  }

  return (
    <div style={{ overflowX: 'auto' }}>
      <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
        <thead>
          <tr style={{ borderBottom: '1px solid var(--border)' }}>
            {columns.map((col) => (
              <th
                key={col.key}
                style={{
                  padding: '10px 12px',
                  textAlign: 'left',
                  color: 'var(--text-muted)',
                  fontWeight: 500,
                  fontSize: 11,
                  textTransform: 'uppercase',
                  letterSpacing: '0.06em',
                  whiteSpace: 'nowrap',
                }}
              >
                {col.label}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row, i) => (
            <tr
              key={row.id ?? row.twitch_id ?? row.username ?? i}
              style={{
                borderBottom: '1px solid var(--border)',
                transition: 'background-color 150ms ease',
              }}
              onMouseEnter={(e) => (e.currentTarget.style.backgroundColor = 'var(--bg-elevated)')}
              onMouseLeave={(e) => (e.currentTarget.style.backgroundColor = 'transparent')}
            >
              {columns.map((col) => (
                <td key={col.key} style={{ padding: '10px 12px', color: 'var(--text-primary)' }}>
                  {col.render ? col.render(row[col.key], row) : (row[col.key] ?? '—')}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
