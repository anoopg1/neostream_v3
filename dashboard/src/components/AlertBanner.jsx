import React, { useState } from 'react';
import { X } from 'lucide-react';

/**
 * Dismissible alert banner for cluster and poison events.
 * @param {{ type?: 'danger'|'warning'|'info', children: React.ReactNode }} props
 */
export default function AlertBanner({ type = 'danger', children }) {
  const [dismissed, setDismissed] = useState(false);
  if (dismissed) return null;

  const colorMap = {
    danger:  { bg: 'rgba(239,68,68,0.12)',  border: 'var(--danger)',  text: 'var(--danger)' },
    warning: { bg: 'rgba(245,158,11,0.12)', border: 'var(--warning)', text: 'var(--warning)' },
    info:    { bg: 'rgba(99,102,241,0.12)', border: 'var(--accent)',  text: 'var(--accent)' },
  };
  const c = colorMap[type] || colorMap.danger;

  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        gap: 12,
        padding: '10px 16px',
        backgroundColor: c.bg,
        border: `1px solid ${c.border}`,
        borderRadius: 8,
        color: c.text,
        fontSize: 13,
        fontWeight: 500,
      }}
    >
      <span>{children}</span>
      <button
        onClick={() => setDismissed(true)}
        style={{ background: 'none', border: 'none', color: c.text, cursor: 'pointer', flexShrink: 0 }}
      >
        <X size={14} />
      </button>
    </div>
  );
}
