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
import { ApprovalScopeView } from './components/ApprovalScopeView';
import { ContractSurfacesView } from './components/ContractSurfacesView';
import { ScenarioView } from './components/ScenarioView';
import { ReviewDecisionsView } from './components/ReviewDecisionsView';
import { EmptyState } from './components/EmptyState';
import { IconClipboard, IconWarn, IconX } from './components/Icons';
import type { ViewId } from './types/model';

function OverviewView() {
  const model = useDashboardStore(s => s.model);
  if (!model) return null;

  const allWorkItems = model.board?.lanes?.flatMap(l => l.workItems) ?? [];

  return (
    <div>
      <HeroSection status={model.status} cockpit={model.operatorCockpit} />

      <div className="cards-grid">
        <div className="card card--vercel transition-all hover:-translate-y-0.5 hover:shadow-xl">
          <div className="card-header">
            Architecture
            <span className="card-meta">
              {model.blueprint.architecture.nodes.length} modules
            </span>
          </div>
          <div className="card-body card-body--flush">
            <TopologyGraph
              nodes={model.blueprint.architecture.nodes}
              edges={model.blueprint.architecture.edges}
            />
          </div>
        </div>

        {allWorkItems.length > 0 && (
          <div className="card card--vercel transition-all hover:-translate-y-0.5 hover:shadow-xl">
            <div className="card-header">
              Task DAG
              <span className="card-meta">
                {allWorkItems.length} items
              </span>
            </div>
            <div className="card-body card-body--flush">
              <TaskDAG workItems={allWorkItems} />
            </div>
          </div>
        )}

        <div className="card card--vercel transition-all hover:-translate-y-0.5 hover:shadow-xl">
          <div className="card-header">
            Module Interfaces
            <span className="card-meta">
              {model.blueprint.moduleInterfaces.length} modules
            </span>
          </div>
          <div className="card-body card-body--flush">
            <ContractPanel moduleInterfaces={model.blueprint.moduleInterfaces} />
          </div>
        </div>

        {model.blueprint.contracts.length > 0 && (
          <div className="card card--vercel transition-all hover:-translate-y-0.5 hover:shadow-xl">
            <div className="card-header">Contracts</div>
            <div className="card-body">
              {model.blueprint.contracts.map(c => (
                <div key={c.contractId} className="contract-item contract-item--listed">
                  <div className="contract-id">{c.contractId}</div>
                  <div className="contract-kind">{c.kind} — {c.path}</div>
                </div>
              ))}
            </div>
          </div>
        )}

        {(model.operatorCockpit.evidenceLinks.length > 0 || model.operatorCockpit.firstRunChecklist.length > 0) && (
          <div className="card card--vercel transition-all hover:-translate-y-0.5 hover:shadow-xl">
            <div className="card-header">Evidence</div>
            <div className="card-body card-body--flush">
              <EvidencePanel cockpit={model.operatorCockpit} />
            </div>
          </div>
        )}

        {model.blueprint.boundaries.length > 0 && (
          <div className="card card--vercel transition-all hover:-translate-y-0.5 hover:shadow-xl">
            <div className="card-header">
              Responsibility Map
              <span className="card-meta">
                {model.blueprint.boundaries.length} boundaries
              </span>
            </div>
            <div className="card-body card-body--flush">
              <ResponsibilityMap
                boundaries={model.blueprint.boundaries}
                moduleInterfaces={model.blueprint.moduleInterfaces}
              />
            </div>
          </div>
        )}

        {model.board && (
          <div className="card card--vercel card--span-full transition-all hover:shadow-xl">
            <div className="card-header">Kanban Board</div>
            <div className="card-body card-body--flush">
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
    <div className="dedicated-flow-view">
      <TopologyGraph
        nodes={model.blueprint.architecture.nodes}
        edges={model.blueprint.architecture.edges}
        fullHeight
      />
    </div>
  );
}

function TasksView() {
  const model = useDashboardStore(s => s.model);
  if (!model) return null;
  const allWorkItems = model.board?.lanes?.flatMap(l => l.workItems) ?? [];

  return (
    <div className="dedicated-flow-view">
      <TaskDAG workItems={allWorkItems} fullHeight />
    </div>
  );
}

function ContractsView() {
  const model = useDashboardStore(s => s.model);
  if (!model) return null;

  return (
    <div className="dedicated-contracts-view">
      <ContractPanel moduleInterfaces={model.blueprint.moduleInterfaces} />
    </div>
  );
}

const VIEWS: Record<ViewId, React.FC> = {
  overview: OverviewView,
  approval: ApprovalScopeView,
  architecture: ArchitectureView,
  tasks: TasksView,
  contracts: ContractsView,
  surfaces: ContractSurfacesView,
  scenarios: ScenarioView,
  reviews: ReviewDecisionsView,
};

const VIEW_SHORTCUTS: Record<string, ViewId> = {
  '1': 'overview',
  '2': 'architecture',
  '3': 'tasks',
  '4': 'contracts',
  '5': 'approval',
  '6': 'surfaces',
  '7': 'scenarios',
  '8': 'reviews',
};

const KEYBOARD_SHORTCUTS = [
  { key: '1', action: 'Overview view' },
  { key: '2', action: 'Architecture view' },
  { key: '3', action: 'Tasks view' },
  { key: '4', action: 'Contracts view' },
  { key: '5', action: 'Approval view' },
  { key: '6', action: 'Surfaces view' },
  { key: '7', action: 'Scenarios view' },
  { key: '8', action: 'Reviews view' },
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
      className="dialog-overlay"
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="keyboard-shortcuts-title"
        onClick={event => event.stopPropagation()}
        className="dialog-panel"
      >
        <div className="dialog-header">
          <h2 id="keyboard-shortcuts-title">
            Keyboard Shortcuts
          </h2>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close keyboard shortcuts"
            className="dialog-close"
          >
            <IconX />
          </button>
        </div>

        <div className="dialog-body">
          {KEYBOARD_SHORTCUTS.map(shortcut => (
            <div key={shortcut.key} className="dialog-shortcut-row">
              <span className="dialog-shortcut-row__label">{shortcut.action}</span>
              <kbd>{shortcut.key}</kbd>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

function LoadingSkeleton() {
  return (
    <div className="skeleton-screen" aria-busy="true" aria-label="Loading dashboard">
      <div className="skeleton-sidebar">
        <div className="skeleton-row" />
        <div className="skeleton-row" />
        <div className="skeleton-row" />
        <div className="skeleton-row" />
        <div className="skeleton-row" />
        <div className="skeleton-row" />
        <div className="skeleton-row" />
      </div>
      <div className="skeleton-main">
        <div className="skeleton-hero" />
        <div className="skeleton-grid">
          <div className="skeleton-card" />
          <div className="skeleton-card" />
          <div className="skeleton-card" />
          <div className="skeleton-card" />
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
    return <LoadingSkeleton />;
  }

  if (error && !model) {
    return (
      <div className="error-screen">
        <div>
          <div className="error-screen__title">
            <IconWarn /> Dashboard Error
          </div>
          <div>{error}</div>
          <button
            type="button"
            className="error-screen__retry"
            onClick={() => fetchModel()}
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
        <div key={activeView} className="view-fade">
          <ViewComponent />
        </div>
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
