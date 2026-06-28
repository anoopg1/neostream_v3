import React, { useState, useEffect, useRef } from 'react';
import {
  DndContext, closestCenter, PointerSensor, useSensor, useSensors,
} from '@dnd-kit/core';
import {
  arrayMove, SortableContext, useSortable, verticalListSortingStrategy,
} from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { PieChart, Pie, Cell, Tooltip, ResponsiveContainer } from 'recharts';
import MetricCard from '../components/MetricCard.jsx';
import AlertBanner from '../components/AlertBanner.jsx';
import { getStats, getCurrentSession, getSpend, addToBlacklist } from '../api/client.js';

const CARD_STORAGE_KEY = 'cc_card_order';
const DEFAULT_ORDER    = ['session', 'realness', 'spend', 'events', 'clusters', 'poison', 'actions', 'favorites'];

const REALNESS_COLORS = {
  suspicious: '#EF4444',
  unverified: '#F59E0B',
  real:       '#6366F1',
  engaged:    '#22C55E',
};

function SortableCard({ id, children }) {
  const { attributes, listeners, setNodeRef, transform, transition } = useSortable({ id });
  const style = { transform: CSS.Transform.toString(transform), transition };
  return (
    <div ref={setNodeRef} style={style} {...attributes} {...listeners}>
      {children}
    </div>
  );
}

function Card({ title, children }) {
  return (
    <div style={{
      backgroundColor: 'var(--bg-surface)',
      border: '1px solid var(--border)',
      borderRadius: 8,
      padding: 16,
      marginBottom: 16,
      cursor: 'grab',
    }}>
      {title && (
        <p style={{ fontSize: 11, fontWeight: 600, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 12 }}>
          {title}
        </p>
      )}
      {children}
    </div>
  );
}

/**
 * Command Center — draggable card grid with live stats, alerts, and quick actions.
 * @param {{ lastEvent: object|null }} props
 */
export default function CommandCenter({ lastEvent }) {
  const [cardOrder, setCardOrder] = useState(() => {
    try {
      const saved = localStorage.getItem(CARD_STORAGE_KEY);
      return saved ? JSON.parse(saved) : DEFAULT_ORDER;
    } catch { return DEFAULT_ORDER; }
  });

  const [stats,        setStats]        = useState(null);
  const [session,      setSession]      = useState(null);
  const [spend,        setSpend]        = useState(null);
  const [events,       setEvents]       = useState([]);
  const [clusterAlerts, setClusterAlerts] = useState([]);
  const [poisonAlerts,  setPoisonAlerts]  = useState([]);
  const [blInput,      setBlInput]      = useState('');
  const [blReason,     setBlReason]     = useState('');
  const [soInput,      setSoInput]      = useState('');

  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 8 } }));

  useEffect(() => {
    Promise.all([getStats(), getCurrentSession(), getSpend()]).then(([s, sess, sp]) => {
      setStats(s);
      setSession(sess?.session);
      setSpend(sp);
    }).catch(() => {});
  }, []);

  useEffect(() => {
    if (!lastEvent) return;
    setEvents((prev) => [lastEvent, ...prev].slice(0, 20));
    if (lastEvent.type === 'CLUSTER_DETECTED') {
      setClusterAlerts((prev) => [lastEvent.data, ...prev]);
    }
    if (lastEvent.type === 'POISON_DETECTED') {
      setPoisonAlerts((prev) => [lastEvent.data, ...prev]);
    }
  }, [lastEvent]);

  const handleDragEnd = ({ active, over }) => {
    if (!over || active.id === over.id) return;
    setCardOrder((prev) => {
      const next = arrayMove(prev, prev.indexOf(active.id), prev.indexOf(over.id));
      try { localStorage.setItem(CARD_STORAGE_KEY, JSON.stringify(next)); } catch {}
      return next;
    });
  };

  const handleAddBlacklist = async () => {
    if (!blInput.trim()) return;
    try { await addToBlacklist({ channel: blInput.trim(), reason: blReason.trim() || undefined }); } catch {}
    setBlInput(''); setBlReason('');
  };

  const rb = stats?.realness_breakdown || {};
  const realnessData = [
    { name: 'Suspicious', value: parseInt(rb.suspicious || 0, 10), key: 'suspicious' },
    { name: 'Unverified',  value: parseInt(rb.unverified  || 0, 10), key: 'unverified'  },
    { name: 'Real',        value: parseInt(rb.real        || 0, 10), key: 'real'        },
    { name: 'Engaged',     value: parseInt(rb.engaged     || 0, 10), key: 'engaged'     },
  ].filter((d) => d.value > 0);

  const cardMap = {
    session: (
      <Card title="Session Stats">
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
          <MetricCard title="Live Viewers"  value={session?.live_viewer_count ?? '—'} />
          <MetricCard title="Peak Viewers"  value={session?.peak_viewers ?? '—'} />
          <MetricCard title="Messages"      value={session?.total_messages ?? '—'} />
          <MetricCard title="Session #"     value={session?.id ?? '—'} />
        </div>
      </Card>
    ),
    realness: (
      <Card title="Realness Breakdown">
        {realnessData.length > 0 ? (
          <ResponsiveContainer width="100%" height={160}>
            <PieChart>
              <Pie data={realnessData} dataKey="value" nameKey="name" cx="50%" cy="50%" outerRadius={60}>
                {realnessData.map((d) => (
                  <Cell key={d.key} fill={REALNESS_COLORS[d.key]} />
                ))}
              </Pie>
              <Tooltip contentStyle={{ backgroundColor: 'var(--bg-elevated)', border: '1px solid var(--border)', fontSize: 12 }} />
            </PieChart>
          </ResponsiveContainer>
        ) : (
          <p style={{ color: 'var(--text-muted)', fontSize: 13, textAlign: 'center', padding: '16px 0' }}>No viewer data yet.</p>
        )}
      </Card>
    ),
    spend: (
      <Card title="API Spend">
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
          <MetricCard title="Today"       value={`$${(spend?.today_spend ?? 0).toFixed(2)}`} accent />
          <MetricCard title="Calls Today" value={spend?.today_calls ?? '—'} />
        </div>
        {spend && (
          <div style={{ marginTop: 12 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 11, color: 'var(--text-muted)', marginBottom: 4 }}>
              <span>Daily limit ${spend.daily_limit?.toFixed(2)}</span>
              <span>{spend.limit_pct}%</span>
            </div>
            <div style={{ backgroundColor: 'var(--bg-elevated)', borderRadius: 4, height: 6 }}>
              <div style={{ height: 6, borderRadius: 4, width: `${Math.min(100, spend.limit_pct)}%`, backgroundColor: spend.limit_pct > 90 ? 'var(--danger)' : 'var(--accent)', transition: 'width 300ms ease' }} />
            </div>
          </div>
        )}
      </Card>
    ),
    events: (
      <Card title="Recent Events">
        <div style={{ maxHeight: 200, overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: 4 }}>
          {events.length === 0 ? (
            <p style={{ color: 'var(--text-muted)', fontSize: 12 }}>Waiting for events...</p>
          ) : events.map((e, i) => (
            <div key={i} style={{ fontSize: 11, color: 'var(--text-muted)', display: 'flex', gap: 8 }}>
              <span style={{ color: 'var(--accent)', flexShrink: 0 }}>{e.type}</span>
              <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                {JSON.stringify(e.data)}
              </span>
            </div>
          ))}
        </div>
      </Card>
    ),
    clusters: (
      <Card title="Cluster Alerts">
        {clusterAlerts.length === 0 ? (
          <p style={{ color: 'var(--text-muted)', fontSize: 12 }}>No clusters detected.</p>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {clusterAlerts.map((c, i) => (
              <AlertBanner key={i} type="danger">
                🤖 Bot cluster detected: {c.count} accounts joined simultaneously.
              </AlertBanner>
            ))}
          </div>
        )}
      </Card>
    ),
    poison: (
      <Card title="Poison Alerts">
        {poisonAlerts.length === 0 ? (
          <p style={{ color: 'var(--text-muted)', fontSize: 12 }}>No attacks detected.</p>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {poisonAlerts.map((p, i) => (
              <AlertBanner key={i} type="warning">
                ⚠️ Poison detected from viewer — reason: {p.reason}
              </AlertBanner>
            ))}
          </div>
        )}
      </Card>
    ),
    actions: (
      <Card title="Quick Actions">
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          <div style={{ display: 'flex', gap: 6 }}>
            <input
              value={blInput}
              onChange={(e) => setBlInput(e.target.value)}
              placeholder="Channel to blacklist..."
              style={{ flex: 1, padding: '6px 10px', backgroundColor: 'var(--bg-elevated)', border: '1px solid var(--border)', borderRadius: 6, color: 'var(--text-primary)', fontSize: 13 }}
            />
            <input
              value={blReason}
              onChange={(e) => setBlReason(e.target.value)}
              placeholder="Reason..."
              style={{ flex: 1, padding: '6px 10px', backgroundColor: 'var(--bg-elevated)', border: '1px solid var(--border)', borderRadius: 6, color: 'var(--text-primary)', fontSize: 13 }}
            />
            <button
              onClick={handleAddBlacklist}
              style={{ padding: '6px 14px', backgroundColor: 'var(--danger)', border: 'none', borderRadius: 6, color: '#fff', fontSize: 13, cursor: 'pointer' }}
            >
              Block
            </button>
          </div>
        </div>
      </Card>
    ),
    favorites: (
      <Card title="Favorite Streamers Status">
        <p style={{ color: 'var(--text-muted)', fontSize: 12 }}>
          Manage favorites in the Networking CRM page.
        </p>
      </Card>
    ),
  };

  return (
    <div>
      <h1 style={{ fontSize: 20, fontWeight: 700, marginBottom: 20, color: 'var(--text-primary)' }}>
        Command Center
      </h1>
      <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
        <SortableContext items={cardOrder} strategy={verticalListSortingStrategy}>
          {cardOrder.map((id) => (
            <SortableCard key={id} id={id}>
              {cardMap[id]}
            </SortableCard>
          ))}
        </SortableContext>
      </DndContext>
    </div>
  );
}
