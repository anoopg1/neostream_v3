import React from 'react';

/**
 * Displays a single metric in a styled card.
 * @param {{ title: string, value: string|number, sub?: string, accent?: boolean }} props
 */
export default function MetricCard({ title, value, sub, accent }) {
  return (
    <div
      style={{
        backgroundColor: 'var(--bg-surface)',
        border: `1px solid ${accent ? 'var(--accent)' : 'var(--border)'}`,
        borderRadius: 8,
        padding: '16px 20px',
      }}
    >
      <p style={{ fontSize: 12, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 6 }}>
        {title}
      </p>
      <p style={{ fontSize: 28, fontWeight: 700, color: accent ? 'var(--accent)' : 'var(--text-primary)', lineHeight: 1 }}>
        {value ?? '—'}
      </p>
      {sub && (
        <p style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 4 }}>{sub}</p>
      )}
    </div>
  );
}
