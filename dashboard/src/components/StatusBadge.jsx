import React from 'react';

/**
 * Displays a colored pill indicating bot live/killed state.
 * @param {{ alive: boolean, connected: boolean }} props
 */
export default function StatusBadge({ alive, connected }) {
  const label = !connected ? 'DISCONNECTED' : alive ? 'LIVE' : 'KILLED';
  const color = !connected ? 'var(--text-muted)' : alive ? 'var(--success)' : 'var(--danger)';
  const bg    = !connected ? 'rgba(100,116,139,0.15)' : alive ? 'rgba(34,197,94,0.15)' : 'rgba(239,68,68,0.15)';

  return (
    <span
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: 5,
        padding: '3px 10px',
        borderRadius: 99,
        fontSize: 11,
        fontWeight: 700,
        letterSpacing: '0.05em',
        color,
        backgroundColor: bg,
        border: `1px solid ${color}`,
        userSelect: 'none',
      }}
    >
      <span
        style={{
          width: 6,
          height: 6,
          borderRadius: '50%',
          backgroundColor: color,
          animation: alive && connected ? 'pulse 2s infinite' : 'none',
        }}
      />
      {label}
      <style>{`
        @keyframes pulse {
          0%, 100% { opacity: 1; }
          50% { opacity: 0.3; }
        }
      `}</style>
    </span>
  );
}
