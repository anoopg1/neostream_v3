import React, { useState } from 'react';

/**
 * Confirmation modal requiring the user to type "DELETE" before proceeding.
 * @param {{ message: string, onConfirm: Function, onCancel: Function }} props
 */
export default function ConfirmModal({ message, onConfirm, onCancel }) {
  const [typed, setTyped] = useState('');

  return (
    <div
      style={{
        position: 'fixed', inset: 0, zIndex: 1000,
        backgroundColor: 'rgba(0,0,0,0.7)',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
      }}
      onClick={(e) => e.target === e.currentTarget && onCancel()}
    >
      <div
        style={{
          backgroundColor: 'var(--bg-elevated)',
          border: '1px solid var(--border)',
          borderRadius: 8,
          padding: 24,
          maxWidth: 420,
          width: '90%',
        }}
      >
        <h3 style={{ fontSize: 16, fontWeight: 600, marginBottom: 12, color: 'var(--danger)' }}>
          Confirm Deletion
        </h3>
        <p style={{ fontSize: 14, color: 'var(--text-muted)', marginBottom: 16 }}>
          {message} <strong style={{ color: 'var(--text-primary)' }}>This cannot be undone.</strong>
        </p>
        <p style={{ fontSize: 13, color: 'var(--text-muted)', marginBottom: 8 }}>
          Type <strong>DELETE</strong> to confirm:
        </p>
        <input
          value={typed}
          onChange={(e) => setTyped(e.target.value)}
          placeholder="DELETE"
          style={{
            width: '100%',
            padding: '8px 12px',
            backgroundColor: 'var(--bg-surface)',
            border: '1px solid var(--border)',
            borderRadius: 6,
            color: 'var(--text-primary)',
            fontSize: 14,
            marginBottom: 16,
            outline: 'none',
          }}
        />
        <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
          <button
            onClick={onCancel}
            style={{
              padding: '8px 16px', borderRadius: 6, fontSize: 13,
              backgroundColor: 'var(--bg-surface)', border: '1px solid var(--border)',
              color: 'var(--text-muted)', cursor: 'pointer',
            }}
          >
            Cancel
          </button>
          <button
            onClick={onConfirm}
            disabled={typed !== 'DELETE'}
            style={{
              padding: '8px 16px', borderRadius: 6, fontSize: 13, fontWeight: 600,
              backgroundColor: typed === 'DELETE' ? 'var(--danger)' : 'var(--text-dim)',
              border: 'none', color: '#fff', cursor: typed === 'DELETE' ? 'pointer' : 'not-allowed',
            }}
          >
            Delete
          </button>
        </div>
      </div>
    </div>
  );
}
