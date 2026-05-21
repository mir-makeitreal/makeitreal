import React from 'react';
import type { ViewId } from '../types/model';
import { useDashboardStore } from '../store/dashboard-store';

export interface SidebarProps {
  activeView: ViewId;
  onNavigate: (view: ViewId) => void;
  collapsed: boolean;
  onToggle: () => void;
  connected: boolean;
  theme: 'dark' | 'light';
  onToggleTheme: () => void;
}

const NAV_ITEMS: { id: ViewId; label: string; mark: string }[] = [
  { id: 'overview', label: 'Overview', mark: 'OV' },
  { id: 'architecture', label: 'Architecture', mark: 'AR' },
  { id: 'tasks', label: 'Tasks', mark: 'TK' },
  { id: 'contracts', label: 'Contracts', mark: 'CN' },
  { id: 'approval', label: 'Approval', mark: 'AP' },
  { id: 'surfaces', label: 'Surfaces', mark: 'SF' },
  { id: 'scenarios', label: 'Scenarios', mark: 'SC' },
  { id: 'reviews', label: 'Reviews', mark: 'RV' },
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
  const model = useDashboardStore(s => s.model);
  const allWorkItems = model?.board?.lanes?.flatMap(lane => lane.workItems) ?? [];
  const totalWorkItems = allWorkItems.length;
  const doneWorkItems = allWorkItems.filter(item => item.lane === 'Done').length;
  const donePercent = totalWorkItems === 0 ? 0 : Math.round((doneWorkItems / totalWorkItems) * 100);
  const phase = model?.status.phase ?? 'Unknown';
  const moduleCount = model?.blueprint.architecture.nodes.length ?? 0;

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
          {collapsed ? '≡' : 'x'}
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
            <span className="icon nav-mark">{item.mark}</span>
            {!collapsed && item.label}
          </button>
        ))}
      </nav>

      <div className="sidebar-footer">
        {!collapsed && model && (
          <section className="sidebar-status" aria-label="Status summary">
            <div className="sidebar-status__title">Status</div>
            <div className="sidebar-status__row">
              <span>Work items</span>
              <span>{doneWorkItems}/{totalWorkItems} done</span>
            </div>
            <div
              className="sidebar-status__progress"
              role="progressbar"
              aria-valuenow={donePercent}
              aria-valuemin={0}
              aria-valuemax={100}
              aria-label="Done work item progress"
            >
              <div className="sidebar-status__progress-bar" style={{ width: `${donePercent}%` }} />
            </div>
            <div className="sidebar-status__row">
              <span>Phase</span>
              <span>{phase}</span>
            </div>
            <div className="sidebar-status__row">
              <span>Modules</span>
              <span>{moduleCount}</span>
            </div>
          </section>
        )}
        <button className="nav-item" onClick={onToggleTheme}>
          <span className="icon nav-mark">{theme === 'dark' ? 'LT' : 'DK'}</span>
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
