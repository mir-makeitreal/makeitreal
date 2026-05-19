import React from 'react';
import type { ViewId } from '../types/model';

export interface SidebarProps {
  activeView: ViewId;
  onNavigate: (view: ViewId) => void;
  collapsed: boolean;
  onToggle: () => void;
  connected: boolean;
  theme: 'dark' | 'light';
  onToggleTheme: () => void;
}

const NAV_ITEMS: { id: ViewId; label: string; icon: string }[] = [
  { id: 'overview', label: 'Overview', icon: '📊' },
  { id: 'architecture', label: 'Architecture', icon: '🏗️' },
  { id: 'tasks', label: 'Tasks', icon: '📋' },
  { id: 'contracts', label: 'Contracts', icon: '📜' },
];

export function Sidebar({
  activeView,
  onNavigate,
  collapsed,
  onToggle,
  connected,
  theme,
  onToggleTheme,
}: SidebarProps) {
  return (
    <div className={`sidebar ${collapsed ? 'collapsed' : ''}`}>
      <div className="sidebar-header">
        <button
          onClick={onToggle}
          className="sidebar-toggle"
          aria-label={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
          style={{
            background: 'none',
            border: 'none',
            cursor: 'pointer',
            fontSize: 16,
            color: 'var(--text-primary)',
          }}
        >
          {collapsed ? '☰' : '✕'}
        </button>
        {!collapsed && <h1>Make It Real</h1>}
      </div>

      <nav className="sidebar-nav">
        {NAV_ITEMS.map(item => (
          <button
            key={item.id}
            className={`nav-item ${activeView === item.id ? 'active' : ''}`}
            onClick={() => onNavigate(item.id)}
            title={item.label}
          >
            <span className="icon">{item.icon}</span>
            {!collapsed && item.label}
          </button>
        ))}
      </nav>

      <div className="sidebar-footer">
        <button className="nav-item" onClick={onToggleTheme}>
          <span className="icon">{theme === 'dark' ? '☀️' : '🌙'}</span>
          {!collapsed && (theme === 'dark' ? 'Light mode' : 'Dark mode')}
        </button>
        <div className="connection-indicator">
          <span className={`dot ${connected ? 'connected' : 'disconnected'}`} />
          {!collapsed && (connected ? 'Live' : 'Disconnected')}
        </div>
      </div>
    </div>
  );
}
