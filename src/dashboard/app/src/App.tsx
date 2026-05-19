import React, { useCallback, useEffect, useState } from 'react';
import { useDashboardStore } from './store/dashboard-store';
import { useWebSocket } from './hooks/useWebSocket';
import { HeroSection } from './components/HeroSection';
import { TopologyGraph } from './components/TopologyGraph';
import { TaskDAG } from './components/TaskDAG';
import { ContractPanel } from './components/ContractPanel';
import { Sidebar } from './components/Sidebar';
import { ResponsibilityMap } from './components/ResponsibilityMap';
import { KanbanBoard } from './components/KanbanBoard';
import { EvidencePanel } from './components/EvidencePanel';
import { DetailDrawer } from './components/DetailDrawer';
import type { ViewId } from './types/model';

function OverviewView() {
  const model = useDashboardStore(s => s.model);
  if (!model) return null;

  const allWorkItems = model.board?.lanes?.flatMap(l => l.workItems) ?? [];

  return (
    <div>
      <HeroSection status={model.status} cockpit={model.operatorCockpit} />

      <div className="cards-grid">
        <div className="card">
          <div className="card-header">
            Architecture
            <span style={{ fontSize: 11, color: 'var(--text-tertiary)' }}>
              {model.blueprint.architecture.nodes.length} modules
            </span>
          </div>
          <div className="card-body" style={{ padding: 0 }}>
            <TopologyGraph
              nodes={model.blueprint.architecture.nodes}
              edges={model.blueprint.architecture.edges}
            />
          </div>
        </div>

        {allWorkItems.length > 0 && (
          <div className="card">
            <div className="card-header">
              Task DAG
              <span style={{ fontSize: 11, color: 'var(--text-tertiary)' }}>
                {allWorkItems.length} items
              </span>
            </div>
            <div className="card-body" style={{ padding: 0 }}>
              <TaskDAG workItems={allWorkItems} />
            </div>
          </div>
        )}

        <div className="card">
          <div className="card-header">
            Module Interfaces
            <span style={{ fontSize: 11, color: 'var(--text-tertiary)' }}>
              {model.blueprint.moduleInterfaces.length} modules
            </span>
          </div>
          <div className="card-body" style={{ padding: 0 }}>
            <ContractPanel moduleInterfaces={model.blueprint.moduleInterfaces} />
          </div>
        </div>

        {model.blueprint.contracts.length > 0 && (
          <div className="card">
            <div className="card-header">Contracts</div>
            <div className="card-body">
              {model.blueprint.contracts.map(c => (
                <div key={c.contractId} className="contract-item" style={{ marginBottom: 8 }}>
                  <div className="contract-id">{c.contractId}</div>
                  <div className="contract-kind">{c.kind} — {c.path}</div>
                </div>
              ))}
            </div>
          </div>
        )}

        {(model.operatorCockpit.evidenceLinks.length > 0 || model.operatorCockpit.firstRunChecklist.length > 0) && (
          <div className="card">
            <div className="card-header">Evidence</div>
            <div className="card-body" style={{ padding: 0 }}>
              <EvidencePanel cockpit={model.operatorCockpit} />
            </div>
          </div>
        )}

        {model.blueprint.boundaries.length > 0 && (
          <div className="card">
            <div className="card-header">
              Responsibility Map
              <span style={{ fontSize: 11, color: 'var(--text-tertiary)' }}>
                {model.blueprint.boundaries.length} boundaries
              </span>
            </div>
            <div className="card-body" style={{ padding: 0 }}>
              <ResponsibilityMap
                boundaries={model.blueprint.boundaries}
                moduleInterfaces={model.blueprint.moduleInterfaces}
              />
            </div>
          </div>
        )}

        {model.board && (
          <div className="card" style={{ gridColumn: '1 / -1' }}>
            <div className="card-header">Kanban Board</div>
            <div className="card-body" style={{ padding: 0 }}>
              <KanbanBoard board={model.board} />
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

function ArchitectureView() {
  const model = useDashboardStore(s => s.model);
  if (!model) return null;

  return (
    <div style={{ padding: 24 }}>
      <h2 style={{ fontSize: 18, marginBottom: 16 }}>Service Topology</h2>
      <TopologyGraph
        nodes={model.blueprint.architecture.nodes}
        edges={model.blueprint.architecture.edges}
      />
    </div>
  );
}

function TasksView() {
  const model = useDashboardStore(s => s.model);
  if (!model) return null;
  const allWorkItems = model.board?.lanes?.flatMap(l => l.workItems) ?? [];

  return (
    <div style={{ padding: 24 }}>
      <h2 style={{ fontSize: 18, marginBottom: 16 }}>Task Dependency Graph</h2>
      <TaskDAG workItems={allWorkItems} />

      {model.board && (
        <div style={{ marginTop: 24 }}>
          <h3 style={{ fontSize: 15, marginBottom: 8 }}>Lane Summary</h3>
          <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
            {Object.entries(model.board.laneCounts).map(([lane, count]) => (
              <div key={lane} style={{
                padding: '8px 16px',
                background: 'var(--bg-secondary)',
                border: '1px solid var(--border-primary)',
                borderRadius: 6,
                fontSize: 13,
              }}>
                <strong>{lane}:</strong> {count}
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

function ContractsView() {
  const model = useDashboardStore(s => s.model);
  if (!model) return null;

  return (
    <div style={{ padding: 24 }}>
      <h2 style={{ fontSize: 18, marginBottom: 16 }}>Module Interfaces & Contracts</h2>
      <ContractPanel moduleInterfaces={model.blueprint.moduleInterfaces} />
    </div>
  );
}

const VIEWS: Record<ViewId, React.FC> = {
  overview: OverviewView,
  architecture: ArchitectureView,
  tasks: TasksView,
  contracts: ContractsView,
};

const VIEW_SHORTCUTS: Record<string, ViewId> = {
  '1': 'overview',
  '2': 'architecture',
  '3': 'tasks',
  '4': 'contracts',
};

const KEYBOARD_SHORTCUTS = [
  { key: '1', action: 'Overview view' },
  { key: '2', action: 'Architecture view' },
  { key: '3', action: 'Tasks view' },
  { key: '4', action: 'Contracts view' },
  { key: 'd', action: 'Toggle dark/light mode' },
  { key: '?', action: 'Show keyboard shortcuts' },
  { key: 'Escape', action: 'Close drawer or modal' },
];

function isEditableTarget(target: EventTarget | null) {
  return target instanceof HTMLInputElement
    || target instanceof HTMLTextAreaElement
    || document.activeElement instanceof HTMLInputElement
    || document.activeElement instanceof HTMLTextAreaElement;
}

function KeyboardShortcutsOverlay({ onClose }: { onClose: () => void }) {
  return (
    <div
      role="presentation"
      onClick={onClose}
      style={{
        position: 'fixed',
        inset: 0,
        background: 'rgba(0, 0, 0, 0.45)',
        zIndex: 2000,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: 24,
      }}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="keyboard-shortcuts-title"
        onClick={event => event.stopPropagation()}
        style={{
          width: 'min(420px, 100%)',
          background: 'var(--bg-primary)',
          border: '1px solid var(--border-primary)',
          borderRadius: 8,
          boxShadow: 'var(--shadow-md)',
          overflow: 'hidden',
        }}
      >
        <div
          style={{
            padding: '14px 16px',
            borderBottom: '1px solid var(--border-primary)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            gap: 12,
          }}
        >
          <h2 id="keyboard-shortcuts-title" style={{ fontSize: 16, fontWeight: 600 }}>
            Keyboard Shortcuts
          </h2>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close keyboard shortcuts"
            style={{
              background: 'none',
              border: 'none',
              color: 'var(--text-primary)',
              cursor: 'pointer',
              fontSize: 18,
              lineHeight: 1,
              padding: 4,
            }}
          >
            x
          </button>
        </div>

        <div style={{ padding: 16 }}>
          {KEYBOARD_SHORTCUTS.map(shortcut => (
            <div
              key={shortcut.key}
              style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                gap: 16,
                padding: '9px 0',
                borderBottom: '1px solid var(--border-secondary)',
                fontSize: 13,
              }}
            >
              <span style={{ color: 'var(--text-secondary)' }}>{shortcut.action}</span>
              <kbd
                style={{
                  minWidth: 32,
                  padding: '4px 8px',
                  borderRadius: 6,
                  border: '1px solid var(--border-primary)',
                  background: 'var(--bg-secondary)',
                  color: 'var(--text-primary)',
                  fontFamily: 'var(--font-mono)',
                  fontSize: 12,
                  textAlign: 'center',
                }}
              >
                {shortcut.key}
              </kbd>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

export default function App() {
  const {
    loading, error, model, connected,
    activeView, setActiveView: setView,
    selection, clearSelection,
    theme, toggleTheme,
    sidebarCollapsed, toggleSidebar,
    fetchModel,
  } = useDashboardStore();
  const [shortcutsOpen, setShortcutsOpen] = useState(false);
  const setSelectedNodeId = useCallback((nodeId: string | null) => {
    if (nodeId === null) clearSelection();
  }, [clearSelection]);

  useWebSocket();

  useEffect(() => {
    fetchModel();
  }, [fetchModel]);

  useEffect(() => {
    document.documentElement.setAttribute('data-theme', theme);
  }, [theme]);

  useEffect(() => {
    function handleKeyDown(event: KeyboardEvent) {
      if (isEditableTarget(event.target)) return;

      if (event.key === 'Escape') {
        const hadOpenShortcutOverlay = shortcutsOpen;
        const hadOpenDetailDrawer = selection.nodeId !== null;

        if (hadOpenShortcutOverlay) setShortcutsOpen(false);
        if (hadOpenDetailDrawer) setSelectedNodeId(null);
        if (hadOpenShortcutOverlay || hadOpenDetailDrawer) event.preventDefault();
        return;
      }

      const view = VIEW_SHORTCUTS[event.key];
      if (view) {
        event.preventDefault();
        setView(view);
        return;
      }

      if (event.key.toLowerCase() === 'd') {
        event.preventDefault();
        toggleTheme();
        return;
      }

      if (event.key === '?') {
        event.preventDefault();
        setShortcutsOpen(true);
      }
    }

    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [selection.nodeId, setSelectedNodeId, setView, shortcutsOpen, toggleTheme]);

  const ViewComponent = VIEWS[activeView] ?? OverviewView;

  if (loading && !model) {
    return <div className="loading-screen">Loading dashboard…</div>;
  }

  if (error && !model) {
    return (
      <div className="error-screen">
        <div>
          <div style={{ fontSize: 18, marginBottom: 8 }}>⚠ Dashboard Error</div>
          <div>{error}</div>
          <button
            onClick={() => fetchModel()}
            style={{
              marginTop: 16,
              padding: '8px 16px',
              background: 'var(--accent-blue)',
              color: '#fff',
              border: 'none',
              borderRadius: 6,
              cursor: 'pointer',
            }}
          >
            Retry
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="app-layout">
      <Sidebar
        activeView={activeView}
        onNavigate={setView}
        collapsed={sidebarCollapsed}
        onToggle={toggleSidebar}
        connected={connected}
        theme={theme}
        onToggleTheme={toggleTheme}
      />

      <main className="main-content">
        <ViewComponent />
      </main>

      <DetailDrawer
        selection={selection}
        model={model}
        onClose={clearSelection}
      />

      {shortcutsOpen && <KeyboardShortcutsOverlay onClose={() => setShortcutsOpen(false)} />}
    </div>
  );
}
