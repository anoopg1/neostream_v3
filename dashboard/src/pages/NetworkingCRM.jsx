import React, { useState, useEffect } from 'react';
import {
  DndContext, closestCenter, PointerSensor, useSensor, useSensors,
} from '@dnd-kit/core';
import {
  arrayMove, SortableContext, useSortable, verticalListSortingStrategy,
} from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { GripVertical, Trash2, ExternalLink } from 'lucide-react';
import { getFollowers, syncFollowers, getFavorites, addFavorite, removeFavorite, reorderFavorites } from '../api/client.js';

const TIER_TABS = ['Mutuals', 'One-sided', 'They Follow You'];

function SortableFavorite({ fav, onRemove }) {
  const { attributes, listeners, setNodeRef, transform, transition } = useSortable({ id: fav.username });
  return (
    <div
      ref={setNodeRef}
      style={{
        transform: CSS.Transform.toString(transform),
        transition,
        display: 'flex',
        alignItems: 'center',
        gap: 10,
        padding: '10px 12px',
        backgroundColor: 'var(--bg-elevated)',
        border: '1px solid var(--border)',
        borderRadius: 6,
        marginBottom: 6,
      }}
    >
      <span {...attributes} {...listeners} style={{ cursor: 'grab', color: 'var(--text-dim)' }}>
        <GripVertical size={14} />
      </span>
      <span style={{ flex: 1, fontSize: 13, color: 'var(--text-primary)' }}>
        {fav.display_name || fav.username}
      </span>
      <a
        href={`https://twitch.tv/${fav.username}`}
        target="_blank"
        rel="noopener noreferrer"
        style={{ color: 'var(--accent)', display: 'flex' }}
      >
        <ExternalLink size={13} />
      </a>
      <button
        onClick={() => onRemove(fav.username)}
        style={{ background: 'none', border: 'none', color: 'var(--danger)', cursor: 'pointer', display: 'flex' }}
      >
        <Trash2 size={13} />
      </button>
    </div>
  );
}

/**
 * Networking CRM — follower tiers, live status, and draggable favorites management.
 */
export default function NetworkingCRM() {
  const [followers,   setFollowers]   = useState({ followers: [], mutuals: [], one_sided: [] });
  const [favorites,   setFavorites]   = useState([]);
  const [activeTier,  setActiveTier]  = useState('Mutuals');
  const [addInput,    setAddInput]    = useState('');
  const [syncing,     setSyncing]     = useState(false);

  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 8 } }));

  const load = () => {
    getFollowers().then(setFollowers).catch(() => {});
    getFavorites().then((d) => setFavorites(d.favorites || [])).catch(() => {});
  };

  useEffect(load, []);

  const handleSync = async () => {
    setSyncing(true);
    try { const d = await syncFollowers(); setFollowers(d); } catch {}
    setSyncing(false);
  };

  const handleAdd = async () => {
    if (!addInput.trim()) return;
    try { await addFavorite({ username: addInput.trim() }); setAddInput(''); load(); } catch {}
  };

  const handleRemove = async (username) => {
    try { await removeFavorite(username); load(); } catch {}
  };

  const handleDragEnd = async ({ active, over }) => {
    if (!over || active.id === over.id) return;
    const next = arrayMove(favorites, favorites.findIndex((f) => f.username === active.id), favorites.findIndex((f) => f.username === over.id));
    setFavorites(next);
    try { await reorderFavorites(next.map((f) => f.username)); } catch {}
  };

  const displayedFollowers =
    activeTier === 'Mutuals'         ? (followers.mutuals   || []) :
    activeTier === 'One-sided'       ? (followers.one_sided || []) :
    activeTier === 'They Follow You' ? (followers.followers || []).filter((f) => !f.is_mutual) :
    (followers.followers || []);

  return (
    <div>
      <h1 style={{ fontSize: 20, fontWeight: 700, marginBottom: 4 }}>Networking CRM</h1>
      <p style={{ color: 'var(--text-muted)', fontSize: 13, marginBottom: 20 }}>
        Total followers: {followers.total || 0} — Mutuals: {(followers.mutuals || []).length}
      </p>

      {/* Top bar */}
      <div style={{ display: 'flex', gap: 10, marginBottom: 20, flexWrap: 'wrap', alignItems: 'center' }}>
        <button
          onClick={handleSync}
          disabled={syncing}
          style={{ padding: '7px 16px', borderRadius: 6, fontSize: 13, backgroundColor: 'var(--accent)', border: 'none', color: '#fff', cursor: syncing ? 'not-allowed' : 'pointer', fontWeight: 600 }}
        >
          {syncing ? 'Syncing...' : '↻ Sync Followers'}
        </button>
        <div style={{ display: 'flex', gap: 6 }}>
          <input
            value={addInput}
            onChange={(e) => setAddInput(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && handleAdd()}
            placeholder="Add favorite streamer..."
            style={{ padding: '7px 12px', backgroundColor: 'var(--bg-surface)', border: '1px solid var(--border)', borderRadius: 6, color: 'var(--text-primary)', fontSize: 13, minWidth: 200 }}
          />
          <button onClick={handleAdd} style={{ padding: '7px 14px', backgroundColor: 'var(--success)', border: 'none', borderRadius: 6, color: '#fff', fontSize: 13, cursor: 'pointer' }}>
            Add
          </button>
        </div>
      </div>

      {/* Tier tabs */}
      <div style={{ display: 'flex', gap: 8, marginBottom: 16, borderBottom: '1px solid var(--border)', paddingBottom: 0 }}>
        {TIER_TABS.map((t) => (
          <button
            key={t}
            onClick={() => setActiveTier(t)}
            style={{
              padding: '8px 16px', background: 'none',
              border: 'none', borderBottom: activeTier === t ? '2px solid var(--accent)' : '2px solid transparent',
              color: activeTier === t ? 'var(--text-primary)' : 'var(--text-muted)',
              cursor: 'pointer', fontSize: 13, fontWeight: activeTier === t ? 600 : 400,
              marginBottom: -1,
            }}
          >
            {t}
          </button>
        ))}
      </div>

      {/* Streamer cards */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(240px, 1fr))', gap: 12, marginBottom: 32 }}>
        {displayedFollowers.slice(0, 50).map((f) => (
          <div
            key={f.user_id || f.username}
            style={{ backgroundColor: 'var(--bg-surface)', border: '1px solid var(--border)', borderRadius: 8, padding: 14 }}
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
              <span style={{ fontWeight: 600, fontSize: 14 }}>{f.display_name || f.username}</span>
              {f.is_mutual && (
                <span style={{ fontSize: 10, fontWeight: 700, color: 'var(--accent)', backgroundColor: 'rgba(99,102,241,0.15)', padding: '2px 6px', borderRadius: 99 }}>
                  MUTUAL
                </span>
              )}
            </div>
            <p style={{ fontSize: 12, color: 'var(--text-muted)', marginBottom: 8 }}>
              Followed: {f.followed_at ? new Date(f.followed_at).toLocaleDateString() : '—'}
            </p>
            <div style={{ display: 'flex', gap: 6 }}>
              <a
                href={`https://twitch.tv/${f.username}`}
                target="_blank"
                rel="noopener noreferrer"
                style={{ padding: '4px 10px', backgroundColor: 'rgba(99,102,241,0.15)', border: '1px solid var(--accent)', borderRadius: 4, color: 'var(--accent)', fontSize: 11, textDecoration: 'none', fontWeight: 600 }}
              >
                Visit
              </a>
            </div>
          </div>
        ))}
        {displayedFollowers.length === 0 && (
          <p style={{ color: 'var(--text-muted)', fontSize: 13, gridColumn: '1/-1' }}>No data — try syncing followers.</p>
        )}
      </div>

      {/* Favorites management */}
      <h2 style={{ fontSize: 16, fontWeight: 700, marginBottom: 12 }}>Favorites — Visit Rotation</h2>
      {favorites.length === 0 ? (
        <p style={{ color: 'var(--text-muted)', fontSize: 13 }}>No favorites added yet.</p>
      ) : (
        <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
          <SortableContext items={favorites.map((f) => f.username)} strategy={verticalListSortingStrategy}>
            {favorites.map((fav) => (
              <SortableFavorite key={fav.username} fav={fav} onRemove={handleRemove} />
            ))}
          </SortableContext>
        </DndContext>
      )}
    </div>
  );
}
