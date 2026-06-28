import React, { useState, useEffect } from 'react';
import { NavLink } from 'react-router-dom';
import {
  LayoutDashboard, Eye, Trophy, Network,
  ScrollText, Activity, Database, ChevronLeft, ChevronRight,
} from 'lucide-react';

const NAV_ITEMS = [
  { to: '/',           icon: LayoutDashboard, label: 'Command Center'   },
  { to: '/viewers',    icon: Eye,             label: 'Viewer Intel'     },
  { to: '/rankings',   icon: Trophy,          label: 'Rankings'         },
  { to: '/networking', icon: Network,         label: 'Networking CRM'   },
  { to: '/logs',       icon: ScrollText,      label: 'Logs'             },
  { to: '/monitor',    icon: Activity,        label: 'API Monitor'      },
  { to: '/database',   icon: Database,        label: 'Database Manager' },
];

export default function Sidebar() {
  const [collapsed, setCollapsed] = useState(() => {
    try { return localStorage.getItem('sidebar_collapsed') === 'true'; } catch { return false; }
  });

  const toggle = () => {
    setCollapsed((c) => {
      const next = !c;
      try { localStorage.setItem('sidebar_collapsed', String(next)); } catch {}
      return next;
    });
  };

  const width = collapsed ? 64 : 240;

  return (
    <aside
      style={{
        width,
        minWidth: width,
        backgroundColor: 'var(--bg-surface)',
        borderRight: '1px solid var(--border)',
        display: 'flex',
        flexDirection: 'column',
        transition: 'width 150ms ease',
        overflow: 'hidden',
        position: 'relative',
      }}
    >
      {/* Logo */}
      <div
        style={{
          height: 56,
          display: 'flex',
          alignItems: 'center',
          padding: collapsed ? '0 20px' : '0 20px',
          borderBottom: '1px solid var(--border)',
          flexShrink: 0,
        }}
      >
        {!collapsed && (
          <span style={{ fontWeight: 700, fontSize: 15, color: 'var(--accent)', whiteSpace: 'nowrap' }}>
            NeoStream v3
          </span>
        )}
      </div>

      {/* Nav links */}
      <nav style={{ flex: 1, padding: '8px 0', overflowY: 'auto' }}>
        {NAV_ITEMS.map(({ to, icon: Icon, label }) => (
          <NavLink
            key={to}
            to={to}
            end={to === '/'}
            title={collapsed ? label : undefined}
            style={({ isActive }) => ({
              display: 'flex',
              alignItems: 'center',
              gap: 12,
              padding: '10px 20px',
              textDecoration: 'none',
              color: isActive ? 'var(--text-primary)' : 'var(--text-muted)',
              backgroundColor: isActive ? 'rgba(99,102,241,0.12)' : 'transparent',
              borderLeft: isActive ? '3px solid var(--accent)' : '3px solid transparent',
              transition: 'all 150ms ease',
              whiteSpace: 'nowrap',
              fontSize: 14,
              fontWeight: isActive ? 600 : 400,
            })}
          >
            <Icon size={18} style={{ flexShrink: 0 }} />
            {!collapsed && label}
          </NavLink>
        ))}
      </nav>

      {/* Collapse toggle */}
      <button
        onClick={toggle}
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          padding: '12px 20px',
          borderTop: '1px solid var(--border)',
          background: 'none',
          border: 'none',
          borderTop: '1px solid var(--border)',
          color: 'var(--text-muted)',
          cursor: 'pointer',
          width: '100%',
        }}
        title={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
      >
        {collapsed ? <ChevronRight size={16} /> : <ChevronLeft size={16} />}
      </button>
    </aside>
  );
}
