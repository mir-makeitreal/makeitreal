# Make It Real — React Component Library Specification

**Status:** SPEC — Ready for implementation agents
**Date:** 2026-05-19
**Supersedes:** FINAL-ARCHITECTURE.md Change 10 (live server) — replaces d3-force with React Flow
**Key Insight:** AI generates JSON data only. Pre-built React app handles ALL rendering.

---

## Table of Contents

1. [Architecture Overview](#1-architecture-overview)
2. [Pre-Build Strategy](#2-pre-build-strategy)
3. [Data Store (Zustand)](#3-data-store-zustand)
4. [Theme System](#4-theme-system)
5. [Routing & Layout](#5-routing--layout)
6. [Component Specifications](#6-component-specifications)
   - 6A. HeroSection
   - 6B. TopologyGraph
   - 6C. TaskDAG
   - 6D. ContractPanel
   - 6E. ResponsibilityMap
   - 6F. SequenceDiagram
   - 6G. KanbanBoard
   - 6H. EvidencePanel
   - 6I. DetailDrawer
7. [Shared Types](#7-shared-types)
8. [WebSocket Integration](#8-websocket-integration)
9. [Cross-Panel Linking Protocol](#9-cross-panel-linking-protocol)
10. [Implementation Order](#10-implementation-order)

---

## 1. Architecture Overview

```
┌─────────────────────────────────────────────────────────────┐
│  dashboard-server.cjs (zero npm deps, node:http)            │
│  ├── GET /                  → serves dist/index.html        │
│  ├── GET /assets/*          → serves dist/assets/*          │
│  ├── GET /api/model         → returns preview-model.json    │
│  ├── POST /api/action       → receives user actions         │
│  ├── WS /ws                 → pushes model-changed events   │
│  └── fs.watch on preview-model.json → triggers WS push      │
└─────────────────────────────────────────────────────────────┘
         │
         ▼
┌─────────────────────────────────────────────────────────────┐
│  Pre-built React SPA (committed as dist/)                   │
│  ├── Zustand store ← fetches /api/model on load + WS push  │
│  ├── React Flow for graph panels (topology, DAG)            │
│  ├── HTML/CSS for content panels (contracts, evidence, etc) │
│  └── DetailDrawer overlay for node inspection               │
└─────────────────────────────────────────────────────────────┘
```

The AI agent writes `preview-model.json`. The server detects the change. The React
app fetches the new model and re-renders. The AI never generates HTML, SVG, or CSS.

---

## 2. Pre-Build Strategy

### Tool: Vite (build only — NOT used at runtime)

**Why Vite over esbuild directly:**
- First-class React + TypeScript support
- CSS modules / PostCSS built in
- Tree-shaking for React Flow (only import what we use)
- `vite build` produces optimized dist/ with hashed assets

**What gets committed to the repo:**

```
dev-harness/
├── src/dashboard/                    # Source (TypeScript + React)
│   ├── package.json                  # React, React Flow, Zustand, etc.
│   ├── vite.config.ts
│   ├── tsconfig.json
│   ├── index.html                    # Vite entry HTML
│   ├── src/
│   │   ├── main.tsx                  # React root mount
│   │   ├── App.tsx                   # Router + layout
│   │   ├── store/                    # Zustand store
│   │   ├── components/               # All components
│   │   ├── theme/                    # Theme system
│   │   └── types/                    # TypeScript interfaces
│   └── dist/                         # ← COMMITTED pre-built output
│       ├── index.html
│       └── assets/
│           ├── index-[hash].js       # ~300-400KB (React + React Flow + app)
│           └── index-[hash].css      # ~15KB
└── src/server/
    └── public/ → symlink or copy from src/dashboard/dist/
```

**Build command (run by developers, NOT by the AI agent):**

```bash
cd dev-harness/src/dashboard
npm install        # one-time
npm run build      # vite build → dist/
```

**The dist/ directory is committed to git.** The server serves it directly. No runtime
build step. This is the superpowers pattern: pre-built assets, server just serves them.

### package.json (dashboard)

```json
{
  "name": "@makeitreal/dashboard",
  "private": true,
  "type": "module",
  "scripts": {
    "dev": "vite",
    "build": "tsc && vite build",
    "preview": "vite preview"
  },
  "dependencies": {
    "react": "^19.1.0",
    "react-dom": "^19.1.0",
    "@xyflow/react": "^12.6.0",
    "zustand": "^5.0.0"
  },
  "devDependencies": {
    "@types/react": "^19.1.0",
    "@types/react-dom": "^19.1.0",
    "@vitejs/plugin-react": "^4.4.0",
    "typescript": "^5.8.0",
    "vite": "^6.3.0"
  }
}
```

### vite.config.ts

```typescript
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  base: './',  // relative paths so it works when served from any URL
  build: {
    outDir: 'dist',
    sourcemap: false,  // keep dist/ small for git
    rollupOptions: {
      output: {
        // Single JS bundle (no code splitting — simpler for committed assets)
        manualChunks: undefined,
      },
    },
  },
  server: {
    proxy: {
      '/api': 'http://localhost:3847',
      '/ws': { target: 'ws://localhost:3847', ws: true },
    },
  },
});
```

---

## 3. Data Store (Zustand)

### Why Zustand

- 1KB, no Provider wrapper needed
- Works with React 19
- Simple subscription model for cross-panel linking
- Middleware for WebSocket integration

### Store Definition

```typescript
// src/store/dashboard-store.ts

import { create } from 'zustand';
import { subscribeWithSelector } from 'zustand/middleware';
import type { PreviewModel, SelectionState } from '../types/model';

interface DashboardStore {
  // ── Data ──
  model: PreviewModel | null;
  loading: boolean;
  error: string | null;
  lastUpdated: string | null;

  // ── Selection (cross-panel linking) ──
  selection: SelectionState;

  // ── UI State ──
  activeView: ViewId;
  drawerOpen: boolean;
  drawerContent: DrawerContent | null;
  theme: 'dark' | 'light';
  sidebarCollapsed: boolean;

  // ── Actions ──
  setModel: (model: PreviewModel) => void;
  setLoading: (loading: boolean) => void;
  setError: (error: string | null) => void;

  selectNode: (nodeId: string, nodeType: NodeType) => void;
  selectWorkItem: (workItemId: string) => void;
  selectContract: (contractId: string) => void;
  selectModule: (moduleId: string) => void;
  clearSelection: () => void;

  openDrawer: (content: DrawerContent) => void;
  closeDrawer: () => void;

  setActiveView: (view: ViewId) => void;
  toggleTheme: () => void;
  toggleSidebar: () => void;

  // ── Data Fetching ──
  fetchModel: () => Promise<void>;
}

type ViewId =
  | 'overview'      // HeroSection + summary
  | 'architecture'  // TopologyGraph + ContractPanel
  | 'tasks'         // TaskDAG + KanbanBoard
  | 'contracts'     // ContractPanel full view
  | 'boundaries'    // ResponsibilityMap
  | 'sequences'     // SequenceDiagram
  | 'evidence';     // EvidencePanel

type NodeType = 'module' | 'workItem' | 'contract' | 'boundary' | 'sequence';

interface SelectionState {
  nodeId: string | null;
  nodeType: NodeType | null;
  // Derived selections (computed from nodeId + model data)
  relatedModuleIds: string[];
  relatedContractIds: string[];
  relatedWorkItemIds: string[];
  relatedFilePatterns: string[];
}

interface DrawerContent {
  type: NodeType;
  id: string;
  title: string;
  // The drawer component reads full data from store.model using this id
}

export const useDashboardStore = create<DashboardStore>()(
  subscribeWithSelector((set, get) => ({
    // Initial state
    model: null,
    loading: true,
    error: null,
    lastUpdated: null,

    selection: {
      nodeId: null,
      nodeType: null,
      relatedModuleIds: [],
      relatedContractIds: [],
      relatedWorkItemIds: [],
      relatedFilePatterns: [],
    },

    activeView: 'overview',
    drawerOpen: false,
    drawerContent: null,
    theme: 'dark',
    sidebarCollapsed: false,

    // ── Actions ──

    setModel: (model) => set({
      model,
      loading: false,
      error: null,
      lastUpdated: new Date().toISOString(),
    }),

    setLoading: (loading) => set({ loading }),
    setError: (error) => set({ error, loading: false }),

    selectNode: (nodeId, nodeType) => {
      const model = get().model;
      if (!model) return;

      // Compute related items based on what was selected
      const related = computeRelatedItems(model, nodeId, nodeType);
      set({
        selection: { nodeId, nodeType, ...related },
      });
    },

    selectWorkItem: (workItemId) => get().selectNode(workItemId, 'workItem'),
    selectContract: (contractId) => get().selectNode(contractId, 'contract'),
    selectModule: (moduleId) => get().selectNode(moduleId, 'module'),

    clearSelection: () => set({
      selection: {
        nodeId: null,
        nodeType: null,
        relatedModuleIds: [],
        relatedContractIds: [],
        relatedWorkItemIds: [],
        relatedFilePatterns: [],
      },
    }),

    openDrawer: (content) => set({ drawerOpen: true, drawerContent: content }),
    closeDrawer: () => set({ drawerOpen: false, drawerContent: null }),

    setActiveView: (view) => set({ activeView: view }),
    toggleTheme: () => set((s) => ({ theme: s.theme === 'dark' ? 'light' : 'dark' })),
    toggleSidebar: () => set((s) => ({ sidebarCollapsed: !s.sidebarCollapsed })),

    fetchModel: async () => {
      set({ loading: true });
      try {
        const res = await fetch('/api/model');
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const data = await res.json();
        // The API returns { ok, model, ... } — extract .model
        const model = data.model ?? data;
        set({ model, loading: false, error: null, lastUpdated: new Date().toISOString() });
      } catch (err: any) {
        set({ error: err.message, loading: false });
      }
    },
  }))
);
```

### Relation Computation Helper

```typescript
// src/store/compute-relations.ts

import type { PreviewModel, NodeType } from '../types/model';

interface RelatedItems {
  relatedModuleIds: string[];
  relatedContractIds: string[];
  relatedWorkItemIds: string[];
  relatedFilePatterns: string[];
}

export function computeRelatedItems(
  model: PreviewModel,
  nodeId: string,
  nodeType: NodeType
): RelatedItems {
  const result: RelatedItems = {
    relatedModuleIds: [],
    relatedContractIds: [],
    relatedWorkItemIds: [],
    relatedFilePatterns: [],
  };

  switch (nodeType) {
    case 'module': {
      // Find edges connected to this module
      const edges = model.blueprint.architecture.edges;
      const connectedModules = edges
        .filter(e => e.from === nodeId || e.to === nodeId)
        .flatMap(e => [e.from, e.to])
        .filter(id => id !== nodeId);
      result.relatedModuleIds = [...new Set(connectedModules)];

      // Find contracts referenced by edges from/to this module
      result.relatedContractIds = edges
        .filter(e => e.from === nodeId || e.to === nodeId)
        .map(e => e.contractId)
        .filter(Boolean);

      // Find work items that belong to this module's responsibility unit
      const allWorkItems = model.board?.lanes?.flatMap(l => l.workItems) ?? [];
      result.relatedWorkItemIds = allWorkItems
        .filter(wi => wi.responsibilityUnitId === nodeId)
        .map(wi => wi.id);

      // Find file patterns from responsibility boundaries
      const boundary = model.blueprint.boundaries?.find(b => b.id === nodeId);
      result.relatedFilePatterns = boundary?.owns ?? [];
      break;
    }

    case 'workItem': {
      const allWorkItems = model.board?.lanes?.flatMap(l => l.workItems) ?? [];
      const wi = allWorkItems.find(w => w.id === nodeId);
      if (wi) {
        result.relatedModuleIds = wi.responsibilityUnitId ? [wi.responsibilityUnitId] : [];
        result.relatedContractIds = wi.contractIds ?? [];
        result.relatedFilePatterns = wi.allowedPaths ?? [];
        // Related work items = those this depends on + those that depend on this
        const dagEdges = model.blueprint.systemDossier?.workItemDag?.edges ?? [];
        result.relatedWorkItemIds = dagEdges
          .filter(e => e.from === nodeId || e.to === nodeId)
          .flatMap(e => [e.from, e.to])
          .filter(id => id !== nodeId);
      }
      break;
    }

    case 'contract': {
      // Find modules connected via this contract
      const edges = model.blueprint.architecture.edges;
      result.relatedModuleIds = edges
        .filter(e => e.contractId === nodeId)
        .flatMap(e => [e.from, e.to]);

      // Find work items referencing this contract
      const allWorkItems = model.board?.lanes?.flatMap(l => l.workItems) ?? [];
      result.relatedWorkItemIds = allWorkItems
        .filter(wi => (wi.contractIds ?? []).includes(nodeId))
        .map(wi => wi.id);
      break;
    }

    case 'boundary': {
      const boundary = model.blueprint.boundaries?.find(b => b.id === nodeId);
      if (boundary) {
        result.relatedModuleIds = [nodeId]; // boundary ID = module ID
        result.relatedFilePatterns = boundary.owns ?? [];
      }
      break;
    }
  }

  return result;
}
```

---

## 4. Theme System

### CSS Custom Properties (not a CSS-in-JS solution)

```typescript
// src/theme/theme.ts

export const themes = {
  dark: {
    '--bg-primary': '#0d1117',
    '--bg-secondary': '#161b22',
    '--bg-tertiary': '#21262d',
    '--bg-surface': '#1c2128',
    '--bg-elevated': '#2d333b',
    '--border-primary': '#30363d',
    '--border-secondary': '#21262d',
    '--text-primary': '#e6edf3',
    '--text-secondary': '#8b949e',
    '--text-tertiary': '#6e7681',
    '--text-link': '#58a6ff',
    '--accent-blue': '#58a6ff',
    '--accent-green': '#3fb950',
    '--accent-yellow': '#d29922',
    '--accent-red': '#f85149',
    '--accent-purple': '#bc8cff',
    '--accent-orange': '#d18616',
    // Status colors
    '--status-done': '#3fb950',
    '--status-active': '#58a6ff',
    '--status-blocked': '#f85149',
    '--status-pending': '#6e7681',
    '--status-review': '#d29922',
    // React Flow specific
    '--rf-bg': '#0d1117',
    '--rf-node-bg': '#161b22',
    '--rf-node-border': '#30363d',
    '--rf-edge': '#30363d',
    '--rf-edge-selected': '#58a6ff',
    '--rf-minimap-bg': '#0d1117',
    '--rf-minimap-mask': 'rgba(22, 27, 34, 0.7)',
    // Shadows
    '--shadow-sm': '0 1px 2px rgba(0, 0, 0, 0.3)',
    '--shadow-md': '0 4px 12px rgba(0, 0, 0, 0.4)',
    '--shadow-lg': '0 8px 24px rgba(0, 0, 0, 0.5)',
    // Font
    '--font-mono': "'JetBrains Mono', 'Fira Code', 'Cascadia Code', monospace",
    '--font-sans': "'Inter', -apple-system, BlinkMacSystemFont, sans-serif",
  },
  light: {
    '--bg-primary': '#ffffff',
    '--bg-secondary': '#f6f8fa',
    '--bg-tertiary': '#eaeef2',
    '--bg-surface': '#ffffff',
    '--bg-elevated': '#ffffff',
    '--border-primary': '#d0d7de',
    '--border-secondary': '#eaeef2',
    '--text-primary': '#1f2328',
    '--text-secondary': '#656d76',
    '--text-tertiary': '#8b949e',
    '--text-link': '#0969da',
    '--accent-blue': '#0969da',
    '--accent-green': '#1a7f37',
    '--accent-yellow': '#9a6700',
    '--accent-red': '#cf222e',
    '--accent-purple': '#8250df',
    '--accent-orange': '#bc4c00',
    '--status-done': '#1a7f37',
    '--status-active': '#0969da',
    '--status-blocked': '#cf222e',
    '--status-pending': '#8b949e',
    '--status-review': '#9a6700',
    '--rf-bg': '#ffffff',
    '--rf-node-bg': '#f6f8fa',
    '--rf-node-border': '#d0d7de',
    '--rf-edge': '#d0d7de',
    '--rf-edge-selected': '#0969da',
    '--rf-minimap-bg': '#f6f8fa',
    '--rf-minimap-mask': 'rgba(255, 255, 255, 0.7)',
    '--shadow-sm': '0 1px 2px rgba(0, 0, 0, 0.07)',
    '--shadow-md': '0 4px 12px rgba(0, 0, 0, 0.1)',
    '--shadow-lg': '0 8px 24px rgba(0, 0, 0, 0.15)',
    '--font-mono': "'JetBrains Mono', 'Fira Code', 'Cascadia Code', monospace",
    '--font-sans': "'Inter', -apple-system, BlinkMacSystemFont, sans-serif",
  },
} as const;

export type ThemeId = keyof typeof themes;
```

### Theme Application

```typescript
// src/theme/ThemeProvider.tsx

import { useEffect } from 'react';
import { useDashboardStore } from '../store/dashboard-store';
import { themes } from './theme';

export function ThemeProvider({ children }: { children: React.ReactNode }) {
  const theme = useDashboardStore((s) => s.theme);

  useEffect(() => {
    const vars = themes[theme];
    const root = document.documentElement;
    for (const [key, value] of Object.entries(vars)) {
      root.style.setProperty(key, value);
    }
    root.setAttribute('data-theme', theme);
  }, [theme]);

  return <>{children}</>;
}
```

### Global CSS

```css
/* src/styles/global.css */

@import url('https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&family=JetBrains+Mono:wght@400;500&display=swap');

*, *::before, *::after {
  box-sizing: border-box;
  margin: 0;
  padding: 0;
}

html, body, #root {
  height: 100%;
  font-family: var(--font-sans);
  background: var(--bg-primary);
  color: var(--text-primary);
  overflow: hidden;
}

/* React Flow overrides */
.react-flow {
  background: var(--rf-bg) !important;
}

.react-flow__node {
  background: var(--rf-node-bg);
  border: 1px solid var(--rf-node-border);
  border-radius: 8px;
  padding: 12px 16px;
  font-family: var(--font-sans);
  font-size: 13px;
  color: var(--text-primary);
  box-shadow: var(--shadow-sm);
  transition: border-color 0.15s, box-shadow 0.15s;
}

.react-flow__node:hover {
  border-color: var(--accent-blue);
  box-shadow: var(--shadow-md);
}

.react-flow__node.selected {
  border-color: var(--accent-blue);
  box-shadow: 0 0 0 2px var(--accent-blue);
}

.react-flow__edge-path {
  stroke: var(--rf-edge);
  stroke-width: 2;
}

.react-flow__edge.selected .react-flow__edge-path {
  stroke: var(--rf-edge-selected);
  stroke-width: 2.5;
}

.react-flow__minimap {
  background: var(--rf-minimap-bg) !important;
  border: 1px solid var(--border-primary);
  border-radius: 8px;
}

/* Scrollbar styling */
::-webkit-scrollbar {
  width: 8px;
  height: 8px;
}
::-webkit-scrollbar-track {
  background: var(--bg-secondary);
}
::-webkit-scrollbar-thumb {
  background: var(--border-primary);
  border-radius: 4px;
}
```

---

## 5. Routing & Layout

### No React Router — use Zustand view state

The dashboard is a single-page app with sidebar navigation. There's only one "page"
with different panel configurations. No URL routing needed (the server serves the
app at / and the runDir comes from the API).

### Layout Structure

```typescript
// src/App.tsx

import { ReactFlowProvider } from '@xyflow/react';
import { ThemeProvider } from './theme/ThemeProvider';
import { Sidebar } from './components/layout/Sidebar';
import { MainContent } from './components/layout/MainContent';
import { DetailDrawer } from './components/DetailDrawer';
import { useWebSocket } from './hooks/useWebSocket';
import { useInitialLoad } from './hooks/useInitialLoad';

export function App() {
  useInitialLoad();  // fetch model on mount
  useWebSocket();    // connect to WS for live updates

  return (
    <ThemeProvider>
      <ReactFlowProvider>
        <div className="app-layout">
          <Sidebar />
          <MainContent />
          <DetailDrawer />
        </div>
      </ReactFlowProvider>
    </ThemeProvider>
  );
}
```

```css
/* Layout CSS */
.app-layout {
  display: grid;
  grid-template-columns: auto 1fr auto;
  grid-template-rows: 1fr;
  height: 100vh;
  overflow: hidden;
}

.sidebar {
  width: 220px;
  background: var(--bg-secondary);
  border-right: 1px solid var(--border-primary);
  display: flex;
  flex-direction: column;
  padding: 16px 0;
  overflow-y: auto;
  transition: width 0.2s;
}

.sidebar.collapsed {
  width: 56px;
}

.main-content {
  overflow-y: auto;
  padding: 24px;
}

.detail-drawer {
  width: 0;
  overflow: hidden;
  transition: width 0.25s ease;
  background: var(--bg-surface);
  border-left: 1px solid var(--border-primary);
}

.detail-drawer.open {
  width: 400px;
}
```

### Sidebar Component

```typescript
// src/components/layout/Sidebar.tsx

import { useDashboardStore } from '../../store/dashboard-store';
import type { ViewId } from '../../types/model';

const NAV_ITEMS: { id: ViewId; label: string; icon: string }[] = [
  { id: 'overview',     label: 'Overview',        icon: '◉' },
  { id: 'architecture', label: 'Architecture',    icon: '⬡' },
  { id: 'tasks',        label: 'Tasks',           icon: '▦' },
  { id: 'contracts',    label: 'Contracts',       icon: '⟐' },
  { id: 'boundaries',   label: 'Boundaries',      icon: '⊞' },
  { id: 'sequences',    label: 'Sequences',       icon: '→' },
  { id: 'evidence',     label: 'Evidence',        icon: '✓' },
];

export function Sidebar() {
  const activeView = useDashboardStore((s) => s.activeView);
  const setActiveView = useDashboardStore((s) => s.setActiveView);
  const collapsed = useDashboardStore((s) => s.sidebarCollapsed);
  const toggleSidebar = useDashboardStore((s) => s.toggleSidebar);
  const toggleTheme = useDashboardStore((s) => s.toggleTheme);
  const theme = useDashboardStore((s) => s.theme);
  const model = useDashboardStore((s) => s.model);

  return (
    <aside className={`sidebar ${collapsed ? 'collapsed' : ''}`}>
      <div className="sidebar-header">
        <button onClick={toggleSidebar} className="sidebar-toggle">
          {collapsed ? '▸' : '◂'}
        </button>
        {!collapsed && (
          <span className="sidebar-title">Make It Real</span>
        )}
      </div>

      <nav className="sidebar-nav">
        {NAV_ITEMS.map((item) => (
          <button
            key={item.id}
            className={`nav-item ${activeView === item.id ? 'active' : ''}`}
            onClick={() => setActiveView(item.id)}
            title={item.label}
          >
            <span className="nav-icon">{item.icon}</span>
            {!collapsed && <span className="nav-label">{item.label}</span>}
          </button>
        ))}
      </nav>

      <div className="sidebar-footer">
        <button onClick={toggleTheme} className="theme-toggle" title="Toggle theme">
          {theme === 'dark' ? '☀' : '☾'}
        </button>
        {!collapsed && model && (
          <div className="sidebar-meta">
            <div className="meta-phase">{model.status?.phase ?? 'unknown'}</div>
          </div>
        )}
      </div>
    </aside>
  );
}
```

### MainContent Router

```typescript
// src/components/layout/MainContent.tsx

import { useDashboardStore } from '../../store/dashboard-store';
import { OverviewView } from '../views/OverviewView';
import { ArchitectureView } from '../views/ArchitectureView';
import { TasksView } from '../views/TasksView';
import { ContractsView } from '../views/ContractsView';
import { BoundariesView } from '../views/BoundariesView';
import { SequencesView } from '../views/SequencesView';
import { EvidenceView } from '../views/EvidenceView';
import { LoadingScreen } from './LoadingScreen';
import { ErrorScreen } from './ErrorScreen';

const VIEW_MAP = {
  overview: OverviewView,
  architecture: ArchitectureView,
  tasks: TasksView,
  contracts: ContractsView,
  boundaries: BoundariesView,
  sequences: SequencesView,
  evidence: EvidenceView,
} as const;

export function MainContent() {
  const activeView = useDashboardStore((s) => s.activeView);
  const loading = useDashboardStore((s) => s.loading);
  const error = useDashboardStore((s) => s.error);
  const model = useDashboardStore((s) => s.model);

  if (loading && !model) return <LoadingScreen />;
  if (error && !model) return <ErrorScreen error={error} />;
  if (!model) return <ErrorScreen error="No model data available" />;

  const ViewComponent = VIEW_MAP[activeView] ?? OverviewView;

  return (
    <main className="main-content">
      <ViewComponent />
    </main>
  );
}
```

### View Compositions

Each view composes 1-3 components from the library:

```typescript
// src/components/views/OverviewView.tsx
// Shows HeroSection + compact TopologyGraph + compact KanbanBoard
export function OverviewView() {
  return (
    <div className="view-overview">
      <HeroSection />
      <div className="overview-grid">
        <TopologyGraph compact />
        <KanbanBoard compact />
      </div>
    </div>
  );
}

// src/components/views/ArchitectureView.tsx
// Full-size TopologyGraph with ContractPanel sidebar
export function ArchitectureView() {
  return (
    <div className="view-architecture">
      <TopologyGraph />
      <ContractPanel />
    </div>
  );
}

// src/components/views/TasksView.tsx
// TaskDAG on top, KanbanBoard below
export function TasksView() {
  return (
    <div className="view-tasks">
      <TaskDAG />
      <KanbanBoard />
    </div>
  );
}
```

---

## 6. Component Specifications

---

### 6A. HeroSection

**Purpose:** Status badge + metrics + next action. The first thing the operator sees.

#### Props Interface

```typescript
interface HeroSectionProps {
  // No props — reads from store
}

// Data it reads from store:
// store.model.status.phase
// store.model.status.headline
// store.model.status.nextAction
// store.model.status.nextCommand
// store.model.status.blockers
// store.model.blueprint.title
// store.model.blueprint.metrics (schemaVersion 1.1)
// store.model.operatorCockpit.firstRunChecklist
```

#### Data Shape from preview-model.json

```typescript
// From model.status
interface StatusModel {
  phase: 'planning-required' | 'approval-required' | 'launch-ready' |
         'running' | 'verifying' | 'human-review' | 'failed-fast' |
         'rework-required' | 'blocked' | 'done';
  blueprintStatus: string;
  headline: string;
  blockers: string[];
  nextAction: string;
  nextCommand: string;
  evidenceSummary: { kind: string; summary: string; path: string }[];
}

// From model.blueprint.metrics (v1.1)
interface BlueprintMetrics {
  moduleCount: number;
  contractCount: number;
  workItemCount: number;
  gatesPassed: number;
  gatesTotal: number;
  estimatedEffortDays: number | null;
}

// From model.operatorCockpit
interface OperatorCockpit {
  phase: string;
  headline: string;
  nextAction: string;
  nextCommand: string;
  firstRunChecklist: {
    id: string;
    label: string;
    command: string;
    status: 'complete' | 'current' | 'pending' | 'blocked';
  }[];
  evidenceLinks: { kind: string; summary: string; path: string; href: string | null }[];
}
```

#### Rendering (HTML)

```typescript
// src/components/HeroSection.tsx

export function HeroSection() {
  const model = useDashboardStore((s) => s.model);
  if (!model) return null;

  const { status, blueprint, operatorCockpit } = model;

  // Compute metrics — fall back to counting if v1.1 metrics not present
  const metrics = blueprint.metrics ?? {
    moduleCount: blueprint.architecture?.nodes?.length ?? 0,
    contractCount: blueprint.contracts?.length ?? 0,
    workItemCount: countWorkItems(model.board),
    gatesPassed: 0,
    gatesTotal: 0,
  };

  return (
    <section className="hero">
      {/* Status Row */}
      <div className="hero-status-row">
        <StatusBadge phase={status.phase} />
        <h1 className="hero-title">{blueprint.title}</h1>
      </div>

      {/* Headline */}
      <p className="hero-headline">{status.headline}</p>

      {/* Metrics Grid */}
      <div className="hero-metrics">
        <MetricCard label="Modules" value={metrics.moduleCount} icon="⬡" />
        <MetricCard label="Contracts" value={metrics.contractCount} icon="⟐" />
        <MetricCard label="Work Items" value={metrics.workItemCount} icon="▦" />
        <MetricCard label="Gates" value={`${metrics.gatesPassed}/${metrics.gatesTotal}`} icon="◎" />
      </div>

      {/* Progress Checklist (stepper) */}
      <div className="hero-checklist">
        {operatorCockpit.firstRunChecklist.map((step) => (
          <ChecklistStep key={step.id} step={step} />
        ))}
      </div>

      {/* Next Action */}
      <div className="hero-next-action">
        <span className="next-label">Next:</span>
        <code className="next-command">{status.nextCommand}</code>
        <p className="next-description">{status.nextAction}</p>
      </div>

      {/* Blockers (if any) */}
      {status.blockers.length > 0 && (
        <div className="hero-blockers">
          <h3>⚠ Blockers</h3>
          <ul>
            {status.blockers.map((b, i) => <li key={i}>{b}</li>)}
          </ul>
        </div>
      )}
    </section>
  );
}
```

#### Sub-components

```typescript
function StatusBadge({ phase }: { phase: string }) {
  const colorMap: Record<string, string> = {
    'done': 'var(--status-done)',
    'running': 'var(--status-active)',
    'verifying': 'var(--status-active)',
    'approval-required': 'var(--status-review)',
    'launch-ready': 'var(--accent-green)',
    'failed-fast': 'var(--status-blocked)',
    'rework-required': 'var(--status-blocked)',
    'blocked': 'var(--status-blocked)',
  };
  const color = colorMap[phase] ?? 'var(--status-pending)';

  return (
    <span className="status-badge" style={{ '--badge-color': color } as any}>
      <span className="badge-dot" />
      {phase.replace(/-/g, ' ')}
    </span>
  );
}

function MetricCard({ label, value, icon }: { label: string; value: number | string; icon: string }) {
  return (
    <div className="metric-card">
      <span className="metric-icon">{icon}</span>
      <span className="metric-value">{value}</span>
      <span className="metric-label">{label}</span>
    </div>
  );
}

function ChecklistStep({ step }: { step: OperatorCockpit['firstRunChecklist'][0] }) {
  const icons: Record<string, string> = {
    complete: '✓',
    current: '●',
    pending: '○',
    blocked: '✕',
  };
  return (
    <div className={`checklist-step ${step.status}`}>
      <span className="step-icon">{icons[step.status]}</span>
      <span className="step-label">{step.label}</span>
    </div>
  );
}
```

#### Interactive Behaviors

- **Click on metric card** → navigates to relevant view (modules → architecture, contracts → contracts, work items → tasks)
- **Click on checklist step** → opens drawer with step details + command to copy
- **Click on blocker** → selects the blocking entity if identifiable

#### Cross-Panel Linking

- MetricCard "Modules" click → `setActiveView('architecture')`
- MetricCard "Work Items" click → `setActiveView('tasks')`
- MetricCard "Contracts" click → `setActiveView('contracts')`

---

### 6B. TopologyGraph

**Purpose:** Architecture diagram showing modules as nodes and contract/dependency edges.
Uses React Flow for pan, zoom, and node interaction.

#### Props Interface

```typescript
interface TopologyGraphProps {
  compact?: boolean;  // If true, renders in a fixed-height container without controls
}
```

#### Data Shape from preview-model.json

```typescript
// From model.blueprint.architecture
interface Architecture {
  nodes: ArchitectureNode[];
  edges: ArchitectureEdge[];
}

interface ArchitectureNode {
  id: string;             // e.g., "ru.api-gateway"
  label: string;          // e.g., "API Gateway"
  type: string;           // e.g., "service", "library", "database", "external"
  group?: string;         // for visual grouping
}

interface ArchitectureEdge {
  from: string;           // source node id
  to: string;             // target node id
  contractId: string;     // the contract governing this edge
  type?: string;          // "dependency", "call", "event", "data"
}

// Also uses model.blueprint.boundaries for grouping info
interface Boundary {
  id: string;             // matches node id
  responsibilityUnitId: string;
  owns: string[];         // file paths
}
```

#### Rendering (React Flow)

```typescript
// src/components/TopologyGraph.tsx

import { useCallback, useMemo } from 'react';
import {
  ReactFlow,
  Background,
  Controls,
  MiniMap,
  useNodesState,
  useEdgesState,
  type Node,
  type Edge,
  type NodeTypes,
  MarkerType,
} from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import { useDashboardStore } from '../store/dashboard-store';
import { ModuleNode } from './nodes/ModuleNode';

const nodeTypes: NodeTypes = {
  module: ModuleNode,
};

export function TopologyGraph({ compact = false }: TopologyGraphProps) {
  const model = useDashboardStore((s) => s.model);
  const selection = useDashboardStore((s) => s.selection);
  const selectModule = useDashboardStore((s) => s.selectModule);
  const openDrawer = useDashboardStore((s) => s.openDrawer);

  const architecture = model?.blueprint?.architecture;
  if (!architecture) return <div className="empty-panel">No architecture data</div>;

  // Convert model data → React Flow nodes
  const rfNodes: Node[] = useMemo(() => {
    return layoutNodes(architecture.nodes, architecture.edges);
  }, [architecture]);

  // Convert model data → React Flow edges
  const rfEdges: Edge[] = useMemo(() => {
    return architecture.edges.map((edge) => ({
      id: `${edge.from}-${edge.to}`,
      source: edge.from,
      target: edge.to,
      label: edge.contractId,
      type: 'smoothstep',
      animated: edge.type === 'event',
      markerEnd: { type: MarkerType.ArrowClosed },
      style: {
        stroke: selection.relatedContractIds.includes(edge.contractId)
          ? 'var(--accent-blue)'
          : 'var(--rf-edge)',
      },
      data: { contractId: edge.contractId, edgeType: edge.type },
    }));
  }, [architecture, selection]);

  // Apply selection highlighting
  const highlightedNodes = useMemo(() => {
    return rfNodes.map((node) => ({
      ...node,
      data: {
        ...node.data,
        highlighted: selection.relatedModuleIds.includes(node.id) || selection.nodeId === node.id,
        selected: selection.nodeId === node.id && selection.nodeType === 'module',
      },
    }));
  }, [rfNodes, selection]);

  const onNodeClick = useCallback((_: React.MouseEvent, node: Node) => {
    selectModule(node.id);
    openDrawer({
      type: 'module',
      id: node.id,
      title: node.data.label as string,
    });
  }, [selectModule, openDrawer]);

  const onEdgeClick = useCallback((_: React.MouseEvent, edge: Edge) => {
    const contractId = edge.data?.contractId as string;
    if (contractId) {
      useDashboardStore.getState().selectContract(contractId);
      useDashboardStore.getState().openDrawer({
        type: 'contract',
        id: contractId,
        title: contractId,
      });
    }
  }, []);

  return (
    <div className={`topology-graph ${compact ? 'compact' : 'full'}`}>
      <div className="panel-header">
        <h2>System Architecture</h2>
        <span className="panel-count">{architecture.nodes.length} modules</span>
      </div>
      <div className="graph-container" style={{ height: compact ? 300 : '100%' }}>
        <ReactFlow
          nodes={highlightedNodes}
          edges={rfEdges}
          nodeTypes={nodeTypes}
          onNodeClick={onNodeClick}
          onEdgeClick={onEdgeClick}
          fitView
          fitViewOptions={{ padding: 0.2 }}
          proOptions={{ hideAttribution: true }}
          minZoom={0.1}
          maxZoom={2}
          nodesDraggable={!compact}
          nodesConnectable={false}
          elementsSelectable={true}
        >
          {!compact && <Background gap={20} color="var(--border-secondary)" />}
          {!compact && <Controls />}
          {!compact && (
            <MiniMap
              nodeColor={(n) => n.data?.highlighted ? 'var(--accent-blue)' : 'var(--rf-node-bg)'}
              maskColor="var(--rf-minimap-mask)"
            />
          )}
        </ReactFlow>
      </div>
    </div>
  );
}
```

#### Custom Node: ModuleNode

```typescript
// src/components/nodes/ModuleNode.tsx

import { Handle, Position, type NodeProps } from '@xyflow/react';

interface ModuleNodeData {
  label: string;
  moduleType: string;     // service, library, database, external
  highlighted: boolean;
  selected: boolean;
}

const TYPE_ICONS: Record<string, string> = {
  service: '⬡',
  library: '📦',
  database: '🗄',
  external: '☁',
  default: '◻',
};

const TYPE_COLORS: Record<string, string> = {
  service: 'var(--accent-blue)',
  library: 'var(--accent-purple)',
  database: 'var(--accent-orange)',
  external: 'var(--text-tertiary)',
};

export function ModuleNode({ data }: NodeProps<ModuleNodeData>) {
  const icon = TYPE_ICONS[data.moduleType] ?? TYPE_ICONS.default;
  const accentColor = TYPE_COLORS[data.moduleType] ?? 'var(--accent-blue)';

  return (
    <div
      className={`module-node ${data.highlighted ? 'highlighted' : ''} ${data.selected ? 'selected' : ''}`}
      style={{
        borderLeftColor: accentColor,
        borderLeftWidth: 3,
      }}
    >
      <Handle type="target" position={Position.Top} />
      <div className="module-node-content">
        <span className="module-icon">{icon}</span>
        <div>
          <div className="module-label">{data.label}</div>
          <div className="module-type">{data.moduleType}</div>
        </div>
      </div>
      <Handle type="source" position={Position.Bottom} />
    </div>
  );
}
```

#### Layout Algorithm

```typescript
// src/components/topology/layout.ts

import type { Node } from '@xyflow/react';
import type { ArchitectureNode, ArchitectureEdge } from '../../types/model';

/**
 * Simple hierarchical layout: topological sort, then layer assignment.
 * This avoids needing dagre/elkjs as a dependency.
 *
 * If the graph is complex (>20 nodes), consider adding dagre:
 *   npm install @dagrejs/dagre
 * and using it here instead.
 */
export function layoutNodes(
  nodes: ArchitectureNode[],
  edges: ArchitectureEdge[]
): Node[] {
  const NODE_WIDTH = 180;
  const NODE_HEIGHT = 60;
  const H_GAP = 60;
  const V_GAP = 100;

  // Build adjacency for topological sort
  const inDegree = new Map<string, number>();
  const children = new Map<string, string[]>();
  for (const n of nodes) {
    inDegree.set(n.id, 0);
    children.set(n.id, []);
  }
  for (const e of edges) {
    inDegree.set(e.to, (inDegree.get(e.to) ?? 0) + 1);
    children.get(e.from)?.push(e.to);
  }

  // BFS layering (Kahn's algorithm)
  const layers: string[][] = [];
  let queue = nodes.filter(n => (inDegree.get(n.id) ?? 0) === 0).map(n => n.id);

  while (queue.length > 0) {
    layers.push([...queue]);
    const nextQueue: string[] = [];
    for (const id of queue) {
      for (const child of children.get(id) ?? []) {
        const newDeg = (inDegree.get(child) ?? 1) - 1;
        inDegree.set(child, newDeg);
        if (newDeg === 0) nextQueue.push(child);
      }
    }
    queue = nextQueue;
  }

  // Assign positions
  const nodeMap = new Map(nodes.map(n => [n.id, n]));
  const result: Node[] = [];

  for (let layerIdx = 0; layerIdx < layers.length; layerIdx++) {
    const layer = layers[layerIdx];
    const totalWidth = layer.length * NODE_WIDTH + (layer.length - 1) * H_GAP;
    const startX = -totalWidth / 2;

    for (let nodeIdx = 0; nodeIdx < layer.length; nodeIdx++) {
      const nodeData = nodeMap.get(layer[nodeIdx]);
      if (!nodeData) continue;

      result.push({
        id: nodeData.id,
        type: 'module',
        position: {
          x: startX + nodeIdx * (NODE_WIDTH + H_GAP),
          y: layerIdx * (NODE_HEIGHT + V_GAP),
        },
        data: {
          label: nodeData.label,
          moduleType: nodeData.type ?? 'service',
          highlighted: false,
          selected: false,
        },
      });
    }
  }

  // Any nodes not in layers (cycles) — place in last row
  const placed = new Set(result.map(n => n.id));
  const orphans = nodes.filter(n => !placed.has(n.id));
  const orphanY = layers.length * (NODE_HEIGHT + V_GAP);
  orphans.forEach((n, i) => {
    result.push({
      id: n.id,
      type: 'module',
      position: { x: i * (NODE_WIDTH + H_GAP), y: orphanY },
      data: {
        label: n.label,
        moduleType: n.type ?? 'service',
        highlighted: false,
        selected: false,
      },
    });
  });

  return result;
}
```

#### Interactive Behaviors

- **Pan/Zoom:** Built-in React Flow (mouse drag, scroll wheel, pinch)
- **Click node:** Selects module → highlights related edges, updates selection store, opens DetailDrawer
- **Click edge:** Selects contract → highlights connected modules
- **Hover node:** CSS :hover effect (border glow, shadow)
- **Double-click node:** Centers and zooms to node
- **Minimap:** Click to navigate (React Flow built-in)
- **Controls:** Zoom in/out, fit view, lock (React Flow built-in)

#### Cross-Panel Linking

- When a module is selected: ContractPanel highlights contracts that touch that module
- When a module is selected: KanbanBoard highlights work items for that module's responsibility unit
- When a module is selected: ResponsibilityMap highlights the file tree for that module
- When a contract is selected (via edge click): TopologyGraph highlights both endpoint modules

---

### 6C. TaskDAG

**Purpose:** Work item dependency graph with status-colored nodes. Shows execution order
and parallelism opportunities.

#### Props Interface

```typescript
interface TaskDAGProps {
  compact?: boolean;
}
```

#### Data Shape from preview-model.json

```typescript
// The DAG edges come from work item dependsOn fields.
// Reconstruct from model.board.lanes[].workItems[].dependsOn

// Each work item in model.board.lanes[].workItems:
interface WorkItemModel {
  id: string;
  title: string;
  lane: string;               // "ready", "in-progress", "done", "blocked", "verify"
  responsibilityUnitId: string;
  contractIds: string[];
  dependsOn: string[];         // IDs of work items this depends on
  allowedPaths: string[];
  isBlocked: boolean;
  isRetryReady: boolean;
  isRework: boolean;
  attemptNumber: number | null;
  nextRetryAt: string | null;
  claim: { workItemId: string; claimedAt: string; claimedBy: string } | null;
}
```

#### Rendering (React Flow)

```typescript
// src/components/TaskDAG.tsx

import { useMemo, useCallback } from 'react';
import {
  ReactFlow,
  Background,
  Controls,
  type Node,
  type Edge,
  type NodeTypes,
  MarkerType,
} from '@xyflow/react';
import { useDashboardStore } from '../store/dashboard-store';
import { WorkItemNode } from './nodes/WorkItemNode';
import { layoutNodes as layoutDAG } from './topology/layout';

const nodeTypes: NodeTypes = {
  workItem: WorkItemNode,
};

export function TaskDAG({ compact = false }: TaskDAGProps) {
  const model = useDashboardStore((s) => s.model);
  const selection = useDashboardStore((s) => s.selection);
  const selectWorkItem = useDashboardStore((s) => s.selectWorkItem);
  const openDrawer = useDashboardStore((s) => s.openDrawer);

  // Flatten all work items from board lanes
  const allWorkItems = useMemo(() => {
    return model?.board?.lanes?.flatMap(l => l.workItems) ?? [];
  }, [model]);

  // Build DAG edges from dependsOn
  const dagEdges = useMemo(() => {
    const edges: { from: string; to: string }[] = [];
    for (const wi of allWorkItems) {
      for (const dep of wi.dependsOn ?? []) {
        edges.push({ from: dep, to: wi.id });
      }
    }
    return edges;
  }, [allWorkItems]);

  // Build React Flow nodes
  const rfNodes: Node[] = useMemo(() => {
    const archNodes = allWorkItems.map(wi => ({
      id: wi.id,
      label: wi.title,
      type: 'workItem',  // node type for layout
    }));
    const archEdges = dagEdges.map(e => ({
      from: e.from,
      to: e.to,
      contractId: '',
    }));
    const positioned = layoutDAG(archNodes, archEdges);
    // Overlay work item data onto positioned nodes
    return positioned.map(node => {
      const wi = allWorkItems.find(w => w.id === node.id);
      return {
        ...node,
        type: 'workItem',
        data: {
          ...node.data,
          title: wi?.title ?? node.id,
          lane: wi?.lane ?? 'unknown',
          isBlocked: wi?.isBlocked ?? false,
          isRetryReady: wi?.isRetryReady ?? false,
          isRework: wi?.isRework ?? false,
          claim: wi?.claim,
          highlighted: selection.relatedWorkItemIds.includes(node.id),
          selected: selection.nodeId === node.id,
        },
      };
    });
  }, [allWorkItems, dagEdges, selection]);

  const rfEdges: Edge[] = useMemo(() => {
    return dagEdges.map((e, i) => ({
      id: `dag-${e.from}-${e.to}`,
      source: e.from,
      target: e.to,
      type: 'smoothstep',
      markerEnd: { type: MarkerType.ArrowClosed },
      style: { stroke: 'var(--rf-edge)' },
    }));
  }, [dagEdges]);

  const onNodeClick = useCallback((_: React.MouseEvent, node: Node) => {
    selectWorkItem(node.id);
    openDrawer({
      type: 'workItem',
      id: node.id,
      title: node.data.title as string,
    });
  }, [selectWorkItem, openDrawer]);

  if (allWorkItems.length === 0) {
    return <div className="empty-panel">No work items</div>;
  }

  return (
    <div className={`task-dag ${compact ? 'compact' : 'full'}`}>
      <div className="panel-header">
        <h2>Task Dependencies</h2>
        <span className="panel-count">{allWorkItems.length} items</span>
      </div>
      <div className="graph-container" style={{ height: compact ? 250 : '100%' }}>
        <ReactFlow
          nodes={rfNodes}
          edges={rfEdges}
          nodeTypes={nodeTypes}
          onNodeClick={onNodeClick}
          fitView
          fitViewOptions={{ padding: 0.3 }}
          proOptions={{ hideAttribution: true }}
          nodesDraggable={!compact}
          nodesConnectable={false}
        >
          {!compact && <Background gap={20} color="var(--border-secondary)" />}
          {!compact && <Controls />}
        </ReactFlow>
      </div>
    </div>
  );
}
```

#### Custom Node: WorkItemNode

```typescript
// src/components/nodes/WorkItemNode.tsx

import { Handle, Position, type NodeProps } from '@xyflow/react';

interface WorkItemNodeData {
  title: string;
  lane: string;
  isBlocked: boolean;
  isRetryReady: boolean;
  isRework: boolean;
  claim: { claimedBy: string } | null;
  highlighted: boolean;
  selected: boolean;
}

const LANE_COLORS: Record<string, string> = {
  'done': 'var(--status-done)',
  'in-progress': 'var(--status-active)',
  'verify': 'var(--accent-yellow)',
  'ready': 'var(--text-tertiary)',
  'blocked': 'var(--status-blocked)',
  'failed': 'var(--status-blocked)',
};

export function WorkItemNode({ data }: NodeProps<WorkItemNodeData>) {
  const statusColor = data.isBlocked
    ? 'var(--status-blocked)'
    : LANE_COLORS[data.lane] ?? 'var(--text-tertiary)';

  const statusIcon = data.isBlocked ? '🔴'
    : data.isRetryReady ? '🔄'
    : data.isRework ? '⚠'
    : data.claim ? '⚡'
    : data.lane === 'done' ? '✅'
    : data.lane === 'in-progress' ? '🔵'
    : '⬜';

  return (
    <div
      className={`work-item-node ${data.highlighted ? 'highlighted' : ''} ${data.selected ? 'selected' : ''}`}
      style={{ borderLeftColor: statusColor, borderLeftWidth: 3 }}
    >
      <Handle type="target" position={Position.Top} />
      <div className="wi-node-content">
        <span className="wi-status-icon">{statusIcon}</span>
        <div className="wi-details">
          <div className="wi-title">{data.title}</div>
          <div className="wi-lane">{data.lane}</div>
        </div>
      </div>
      <Handle type="source" position={Position.Bottom} />
    </div>
  );
}
```

#### Interactive Behaviors

- **Click node:** Select work item → highlight in KanbanBoard, show in DetailDrawer
- **Pan/Zoom:** React Flow built-in
- **Color coding:** Node border color reflects lane status (green=done, blue=active, red=blocked, yellow=verify, gray=pending)
- **Animated nodes:** Pulse animation on in-progress items (CSS animation on the node border)

#### Cross-Panel Linking

- Select work item → KanbanBoard scrolls to and highlights that card
- Select work item → TopologyGraph highlights the responsible module
- Select work item → ContractPanel highlights referenced contracts

---

### 6D. ContractPanel

**Purpose:** Display interface signatures (API specs, contracts) with syntax highlighting.

#### Props Interface

```typescript
interface ContractPanelProps {
  compact?: boolean;       // Show only names + types; expand on click
  filterModuleId?: string; // Only show contracts for this module
}
```

#### Data Shape from preview-model.json

```typescript
// From model.blueprint.contracts
interface Contract {
  contractId: string;
  kind: string;          // "rest", "graphql", "event", "rpc", "none"
  path?: string;         // e.g., "/api/v1/users"
  method?: string;       // e.g., "GET", "POST"
  reason?: string;       // when kind is "none"
  description?: string;
}

// From model.blueprint.moduleInterfaces
interface ModuleInterface {
  responsibilityUnitId: string;
  publicSurfaces: {
    name: string;
    type: string;        // "function", "class", "endpoint", "event"
    signature?: string;  // e.g., "createUser(input: CreateUserInput): User"
    description?: string;
  }[];
}

// From model.design.apiSpecs (string representations)
// From model.blueprint.callStacks
interface CallStack {
  entrypoint: string;
  calls: string[];
}
```

#### Rendering (HTML with CSS syntax highlighting)

```typescript
// src/components/ContractPanel.tsx

export function ContractPanel({ compact = false, filterModuleId }: ContractPanelProps) {
  const model = useDashboardStore((s) => s.model);
  const selection = useDashboardStore((s) => s.selection);
  const selectContract = useDashboardStore((s) => s.selectContract);
  const openDrawer = useDashboardStore((s) => s.openDrawer);

  if (!model) return null;

  const contracts = model.blueprint.contracts ?? [];
  const moduleInterfaces = model.blueprint.moduleInterfaces ?? [];

  // Filter by module if specified
  const filteredInterfaces = filterModuleId
    ? moduleInterfaces.filter(mi => mi.responsibilityUnitId === filterModuleId)
    : moduleInterfaces;

  // Filter by selection
  const filteredContracts = selection.relatedContractIds.length > 0
    ? contracts.filter(c => selection.relatedContractIds.includes(c.contractId))
    : contracts;

  return (
    <div className={`contract-panel ${compact ? 'compact' : 'full'}`}>
      <div className="panel-header">
        <h2>Contracts & Interfaces</h2>
        <span className="panel-count">{contracts.length} contracts</span>
      </div>

      <div className="contract-list">
        {/* API Contracts */}
        {filteredContracts.map((contract) => (
          <ContractCard
            key={contract.contractId}
            contract={contract}
            isHighlighted={selection.relatedContractIds.includes(contract.contractId)}
            isSelected={selection.nodeId === contract.contractId}
            onClick={() => {
              selectContract(contract.contractId);
              if (!compact) {
                openDrawer({
                  type: 'contract',
                  id: contract.contractId,
                  title: contract.contractId,
                });
              }
            }}
          />
        ))}

        {/* Module Interfaces */}
        {filteredInterfaces.map((mi) => (
          <ModuleInterfaceCard
            key={mi.responsibilityUnitId}
            moduleInterface={mi}
            isHighlighted={selection.relatedModuleIds.includes(mi.responsibilityUnitId)}
          />
        ))}
      </div>
    </div>
  );
}

function ContractCard({
  contract,
  isHighlighted,
  isSelected,
  onClick,
}: {
  contract: Contract;
  isHighlighted: boolean;
  isSelected: boolean;
  onClick: () => void;
}) {
  const kindBadge: Record<string, { label: string; color: string }> = {
    rest: { label: 'REST', color: 'var(--accent-green)' },
    graphql: { label: 'GQL', color: 'var(--accent-purple)' },
    event: { label: 'EVENT', color: 'var(--accent-orange)' },
    rpc: { label: 'RPC', color: 'var(--accent-blue)' },
    none: { label: 'NONE', color: 'var(--text-tertiary)' },
  };
  const badge = kindBadge[contract.kind] ?? kindBadge.none;

  return (
    <div
      className={`contract-card ${isHighlighted ? 'highlighted' : ''} ${isSelected ? 'selected' : ''}`}
      onClick={onClick}
    >
      <div className="contract-header">
        <span className="contract-kind-badge" style={{ color: badge.color }}>
          {badge.label}
        </span>
        <span className="contract-id">{contract.contractId}</span>
      </div>
      {contract.method && contract.path && (
        <div className="contract-endpoint">
          <code>
            <span className="syntax-method">{contract.method}</span>
            {' '}
            <span className="syntax-path">{contract.path}</span>
          </code>
        </div>
      )}
      {contract.description && (
        <p className="contract-description">{contract.description}</p>
      )}
    </div>
  );
}

function ModuleInterfaceCard({
  moduleInterface,
  isHighlighted,
}: {
  moduleInterface: ModuleInterface;
  isHighlighted: boolean;
}) {
  return (
    <div className={`module-interface-card ${isHighlighted ? 'highlighted' : ''}`}>
      <div className="mi-header">
        <span className="mi-module-id">{moduleInterface.responsibilityUnitId}</span>
        <span className="mi-count">{moduleInterface.publicSurfaces?.length ?? 0} surfaces</span>
      </div>
      <div className="mi-surfaces">
        {(moduleInterface.publicSurfaces ?? []).map((surface, i) => (
          <div key={i} className="mi-surface">
            <span className="surface-type-badge">{surface.type}</span>
            <code className="surface-signature">
              <span className="syntax-fn">{surface.name}</span>
              {surface.signature && (
                <span className="syntax-params">
                  {surface.signature.replace(surface.name, '')}
                </span>
              )}
            </code>
          </div>
        ))}
      </div>
    </div>
  );
}
```

#### CSS Syntax Highlighting (no runtime dependency)

```css
/* Syntax highlighting via CSS classes — no Prism/Highlight.js needed */
.syntax-method {
  color: var(--accent-green);
  font-weight: 600;
}
.syntax-path {
  color: var(--accent-blue);
}
.syntax-fn {
  color: var(--accent-purple);
  font-weight: 500;
}
.syntax-params {
  color: var(--text-secondary);
}
.syntax-type {
  color: var(--accent-orange);
}
.syntax-keyword {
  color: var(--accent-red);
  font-weight: 500;
}
```

#### Interactive Behaviors

- **Click contract card:** Select contract → highlights in TopologyGraph edges, opens DetailDrawer
- **Hover:** Card elevation increases
- **Filter:** When a module is selected in TopologyGraph, only contracts touching that module are shown
- **Expand/Collapse:** In compact mode, click to expand full signature

#### Cross-Panel Linking

- Contract selected → TopologyGraph highlights edges using that contract
- Contract selected → TaskDAG highlights work items referencing it

---

### 6E. ResponsibilityMap

**Purpose:** Ownership boundaries with file tree visualization. Shows which module owns
which files/directories.

#### Props Interface

```typescript
interface ResponsibilityMapProps {
  filterModuleId?: string;  // Only show this module's boundary
}
```

#### Data Shape from preview-model.json

```typescript
// From model.blueprint.boundaries
interface BoundaryModel {
  id: string;                    // responsibility unit id
  responsibilityUnitId: string;
  owns: string[];                // file/directory patterns: ["src/api/", "src/models/user.ts"]
}

// Also from model.design.responsibilityBoundaries (string summaries)
// "ru.api-gateway: owns src/api/, src/middleware/"
```

#### Rendering (HTML — nested file tree)

```typescript
// src/components/ResponsibilityMap.tsx

export function ResponsibilityMap({ filterModuleId }: ResponsibilityMapProps) {
  const model = useDashboardStore((s) => s.model);
  const selection = useDashboardStore((s) => s.selection);
  const selectModule = useDashboardStore((s) => s.selectModule);

  if (!model) return null;

  const boundaries = model.blueprint.boundaries ?? [];
  const filtered = filterModuleId
    ? boundaries.filter(b => b.id === filterModuleId)
    : boundaries;

  // Build a unified file tree with ownership colors
  const tree = buildOwnershipTree(filtered);

  return (
    <div className="responsibility-map">
      <div className="panel-header">
        <h2>Responsibility Boundaries</h2>
        <span className="panel-count">{boundaries.length} units</span>
      </div>

      <div className="boundary-list">
        {filtered.map((boundary) => (
          <BoundaryCard
            key={boundary.id}
            boundary={boundary}
            isHighlighted={
              selection.nodeId === boundary.id ||
              selection.relatedModuleIds.includes(boundary.id)
            }
            onClick={() => selectModule(boundary.id)}
          />
        ))}
      </div>

      <div className="file-tree-section">
        <h3>Ownership Tree</h3>
        <FileTreeView
          tree={tree}
          highlightedPaths={selection.relatedFilePatterns}
        />
      </div>
    </div>
  );
}

interface TreeNode {
  name: string;
  path: string;
  isDir: boolean;
  owner: string | null;
  ownerColor: string | null;
  children: TreeNode[];
}

function buildOwnershipTree(boundaries: BoundaryModel[]): TreeNode {
  const root: TreeNode = { name: '/', path: '', isDir: true, owner: null, ownerColor: null, children: [] };

  // Color palette for different owners
  const colors = [
    'var(--accent-blue)', 'var(--accent-green)', 'var(--accent-purple)',
    'var(--accent-orange)', 'var(--accent-yellow)', 'var(--accent-red)',
  ];

  for (let i = 0; i < boundaries.length; i++) {
    const boundary = boundaries[i];
    const color = colors[i % colors.length];

    for (const ownedPath of boundary.owns) {
      const parts = ownedPath.split('/').filter(Boolean);
      let current = root;

      for (let j = 0; j < parts.length; j++) {
        const part = parts[j];
        const isLast = j === parts.length - 1;
        const isDir = ownedPath.endsWith('/') || !isLast;

        let child = current.children.find(c => c.name === part);
        if (!child) {
          child = {
            name: part,
            path: parts.slice(0, j + 1).join('/'),
            isDir,
            owner: isLast ? boundary.id : null,
            ownerColor: isLast ? color : null,
            children: [],
          };
          current.children.push(child);
        }
        if (isLast) {
          child.owner = boundary.id;
          child.ownerColor = color;
        }
        current = child;
      }
    }
  }

  return root;
}

function FileTreeView({ tree, highlightedPaths }: { tree: TreeNode; highlightedPaths: string[] }) {
  return (
    <div className="file-tree">
      {tree.children.map((child) => (
        <FileTreeNode
          key={child.path}
          node={child}
          depth={0}
          highlightedPaths={highlightedPaths}
        />
      ))}
    </div>
  );
}

function FileTreeNode({
  node,
  depth,
  highlightedPaths,
}: {
  node: TreeNode;
  depth: number;
  highlightedPaths: string[];
}) {
  const isHighlighted = highlightedPaths.some(p =>
    node.path.startsWith(p) || p.startsWith(node.path)
  );

  return (
    <div className="tree-node">
      <div
        className={`tree-node-row ${isHighlighted ? 'highlighted' : ''}`}
        style={{ paddingLeft: depth * 20 }}
      >
        <span className="tree-icon">{node.isDir ? '📁' : '📄'}</span>
        <span className="tree-name">{node.name}</span>
        {node.owner && (
          <span
            className="tree-owner-badge"
            style={{ backgroundColor: node.ownerColor ?? undefined }}
          >
            {node.owner}
          </span>
        )}
      </div>
      {node.children.map((child) => (
        <FileTreeNode
          key={child.path}
          node={child}
          depth={depth + 1}
          highlightedPaths={highlightedPaths}
        />
      ))}
    </div>
  );
}
```

#### Interactive Behaviors

- **Click boundary card:** Selects module → highlights in TopologyGraph, shows files in tree
- **Hover on file:** Shows full path tooltip
- **Highlight:** Selected module's files are highlighted in the tree with the owner's color

#### Cross-Panel Linking

- Module selected → ResponsibilityMap highlights that boundary
- File patterns highlighted when any related entity is selected

---

### 6F. SequenceDiagram

**Purpose:** Call flow / scenario visualization. Shows message exchanges between modules.

#### Props Interface

```typescript
interface SequenceDiagramProps {
  compact?: boolean;
}
```

#### Data Shape from preview-model.json

```typescript
// From model.blueprint.sequences
interface Sequence {
  title: string;
  messages: SequenceMessage[];
}

interface SequenceMessage {
  from: string;      // participant/module id
  to: string;        // participant/module id
  label: string;     // message description
  type?: string;     // "sync", "async", "return"
}

// From model.blueprint.callStacks
interface CallStack {
  entrypoint: string;
  calls: string[];    // ordered call chain
}
```

#### Rendering (HTML/CSS — custom sequence diagram, NOT React Flow)

Sequence diagrams are fundamentally different from graph layouts. They are
vertical timelines with horizontal arrows. Custom HTML/CSS rendering is more
appropriate than React Flow here.

```typescript
// src/components/SequenceDiagram.tsx

export function SequenceDiagram({ compact = false }: SequenceDiagramProps) {
  const model = useDashboardStore((s) => s.model);
  const selection = useDashboardStore((s) => s.selection);

  if (!model) return null;

  const sequences = model.blueprint.sequences ?? [];
  const callStacks = model.blueprint.callStacks ?? [];

  if (sequences.length === 0 && callStacks.length === 0) {
    return <div className="empty-panel">No sequence data</div>;
  }

  return (
    <div className="sequence-diagram-panel">
      <div className="panel-header">
        <h2>Sequences & Call Flows</h2>
        <span className="panel-count">{sequences.length} scenarios</span>
      </div>

      {/* Sequence Diagrams */}
      {sequences.map((seq, i) => (
        <SequenceChart
          key={i}
          sequence={seq}
          highlightedParticipants={selection.relatedModuleIds}
          compact={compact}
        />
      ))}

      {/* Call Stacks */}
      {callStacks.length > 0 && (
        <div className="call-stacks-section">
          <h3>Call Stacks</h3>
          {callStacks.map((stack, i) => (
            <CallStackView key={i} stack={stack} />
          ))}
        </div>
      )}
    </div>
  );
}

function SequenceChart({
  sequence,
  highlightedParticipants,
  compact,
}: {
  sequence: Sequence;
  highlightedParticipants: string[];
  compact: boolean;
}) {
  // Extract unique participants in order of appearance
  const participants = [...new Set(
    sequence.messages.flatMap(m => [m.from, m.to])
  )];

  const PARTICIPANT_WIDTH = 140;
  const ROW_HEIGHT = 40;
  const HEADER_HEIGHT = 50;

  return (
    <div className="sequence-chart">
      <h3 className="sequence-title">{sequence.title}</h3>

      <div
        className="sequence-canvas"
        style={{
          width: participants.length * PARTICIPANT_WIDTH,
          height: HEADER_HEIGHT + sequence.messages.length * ROW_HEIGHT + 20,
          position: 'relative',
        }}
      >
        {/* Participant headers */}
        {participants.map((p, i) => (
          <div
            key={p}
            className={`seq-participant ${highlightedParticipants.includes(p) ? 'highlighted' : ''}`}
            style={{
              left: i * PARTICIPANT_WIDTH + PARTICIPANT_WIDTH / 2 - 50,
              top: 0,
              width: 100,
              position: 'absolute',
            }}
          >
            {p}
          </div>
        ))}

        {/* Lifelines (vertical dashed lines) */}
        {participants.map((p, i) => (
          <div
            key={`line-${p}`}
            className="seq-lifeline"
            style={{
              left: i * PARTICIPANT_WIDTH + PARTICIPANT_WIDTH / 2,
              top: HEADER_HEIGHT,
              height: sequence.messages.length * ROW_HEIGHT,
              position: 'absolute',
            }}
          />
        ))}

        {/* Messages (horizontal arrows) */}
        {sequence.messages.map((msg, i) => {
          const fromIdx = participants.indexOf(msg.from);
          const toIdx = participants.indexOf(msg.to);
          const fromX = fromIdx * PARTICIPANT_WIDTH + PARTICIPANT_WIDTH / 2;
          const toX = toIdx * PARTICIPANT_WIDTH + PARTICIPANT_WIDTH / 2;
          const y = HEADER_HEIGHT + i * ROW_HEIGHT + ROW_HEIGHT / 2;
          const isReverse = fromIdx > toIdx;

          return (
            <div key={i} className="seq-message" style={{ position: 'absolute', top: y }}>
              {/* Arrow line */}
              <svg
                className="seq-arrow"
                style={{
                  position: 'absolute',
                  left: Math.min(fromX, toX),
                  top: -1,
                  width: Math.abs(toX - fromX),
                  height: 2,
                }}
              >
                <line
                  x1={isReverse ? Math.abs(toX - fromX) : 0}
                  y1={1}
                  x2={isReverse ? 0 : Math.abs(toX - fromX)}
                  y2={1}
                  stroke="var(--accent-blue)"
                  strokeWidth={2}
                  markerEnd="url(#arrowhead)"
                  strokeDasharray={msg.type === 'async' ? '5,5' : undefined}
                />
                <defs>
                  <marker id="arrowhead" markerWidth="10" markerHeight="7" refX="10" refY="3.5" orient="auto">
                    <polygon points="0 0, 10 3.5, 0 7" fill="var(--accent-blue)" />
                  </marker>
                </defs>
              </svg>

              {/* Label */}
              <span
                className="seq-label"
                style={{
                  position: 'absolute',
                  left: (fromX + toX) / 2 - 50,
                  top: -16,
                  width: 100,
                  textAlign: 'center',
                }}
              >
                {msg.label}
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function CallStackView({ stack }: { stack: CallStack }) {
  return (
    <div className="call-stack">
      <div className="call-entrypoint">
        <code>{stack.entrypoint}</code>
      </div>
      <div className="call-chain">
        {stack.calls.map((call, i) => (
          <div key={i} className="call-step" style={{ paddingLeft: (i + 1) * 16 }}>
            <span className="call-arrow">→</span>
            <code>{call}</code>
          </div>
        ))}
      </div>
    </div>
  );
}
```

#### Interactive Behaviors

- **Hover on message arrow:** Tooltip with full message details
- **Click on participant header:** Selects that module → cross-panel highlighting
- **Scroll:** Horizontal scroll for wide diagrams

#### Cross-Panel Linking

- Click participant → `selectModule(participantId)`
- Module selected elsewhere → participant header highlighted in sequence

---

### 6G. KanbanBoard

**Purpose:** Work items displayed in swim lanes by status.

#### Props Interface

```typescript
interface KanbanBoardProps {
  compact?: boolean;  // If true, shows counts per lane instead of full cards
}
```

#### Data Shape from preview-model.json

```typescript
// From model.board
interface BoardModel {
  boardId: string;
  laneCounts: Record<string, number>;
  lanes: {
    name: string;
    workItems: WorkItemModel[];
  }[];
  activeClaims: { workItemId: string; claimedAt: string; claimedBy: string }[];
  blockedWork: { id: string }[];
  failedFast: { id: string; attemptNumber: number; nextRetryAt: string }[];
  retryReady: { id: string }[];
  rework: { id: string }[];
  runtimeState: any;
  audit: any;
}
```

#### Rendering (HTML — CSS Grid lanes)

```typescript
// src/components/KanbanBoard.tsx

const LANE_ORDER = ['ready', 'in-progress', 'verify', 'done', 'blocked', 'failed'];
const LANE_COLORS: Record<string, string> = {
  'ready': 'var(--text-tertiary)',
  'in-progress': 'var(--status-active)',
  'verify': 'var(--accent-yellow)',
  'done': 'var(--status-done)',
  'blocked': 'var(--status-blocked)',
  'failed': 'var(--status-blocked)',
};

export function KanbanBoard({ compact = false }: KanbanBoardProps) {
  const model = useDashboardStore((s) => s.model);
  const selection = useDashboardStore((s) => s.selection);
  const selectWorkItem = useDashboardStore((s) => s.selectWorkItem);
  const openDrawer = useDashboardStore((s) => s.openDrawer);

  if (!model?.board) return <div className="empty-panel">No board data</div>;

  const { board } = model;

  // Sort lanes by predefined order
  const sortedLanes = [...(board.lanes ?? [])].sort((a, b) => {
    const ai = LANE_ORDER.indexOf(a.name);
    const bi = LANE_ORDER.indexOf(b.name);
    return (ai === -1 ? 99 : ai) - (bi === -1 ? 99 : bi);
  });

  return (
    <div className={`kanban-board ${compact ? 'compact' : 'full'}`}>
      <div className="panel-header">
        <h2>Work Board</h2>
        <div className="lane-summary">
          {sortedLanes.map(lane => (
            <span
              key={lane.name}
              className="lane-badge"
              style={{ color: LANE_COLORS[lane.name] ?? 'var(--text-secondary)' }}
            >
              {lane.name}: {lane.workItems.length}
            </span>
          ))}
        </div>
      </div>

      <div className="kanban-lanes" style={{
        gridTemplateColumns: `repeat(${sortedLanes.length}, minmax(200px, 1fr))`,
      }}>
        {sortedLanes.map((lane) => (
          <div key={lane.name} className="kanban-lane">
            <div
              className="lane-header"
              style={{ borderBottomColor: LANE_COLORS[lane.name] }}
            >
              <span className="lane-name">{lane.name}</span>
              <span className="lane-count">{lane.workItems.length}</span>
            </div>

            {!compact && (
              <div className="lane-cards">
                {lane.workItems.map((wi) => (
                  <KanbanCard
                    key={wi.id}
                    workItem={wi}
                    isHighlighted={selection.relatedWorkItemIds.includes(wi.id)}
                    isSelected={selection.nodeId === wi.id}
                    onClick={() => {
                      selectWorkItem(wi.id);
                      openDrawer({
                        type: 'workItem',
                        id: wi.id,
                        title: wi.title,
                      });
                    }}
                  />
                ))}
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}

function KanbanCard({
  workItem,
  isHighlighted,
  isSelected,
  onClick,
}: {
  workItem: WorkItemModel;
  isHighlighted: boolean;
  isSelected: boolean;
  onClick: () => void;
}) {
  return (
    <div
      className={`kanban-card ${isHighlighted ? 'highlighted' : ''} ${isSelected ? 'selected' : ''}`}
      onClick={onClick}
    >
      <div className="card-title">{workItem.title}</div>
      <div className="card-meta">
        {workItem.responsibilityUnitId && (
          <span className="card-module">{workItem.responsibilityUnitId}</span>
        )}
        {workItem.isBlocked && <span className="card-tag blocked">blocked</span>}
        {workItem.isRetryReady && <span className="card-tag retry">retry</span>}
        {workItem.isRework && <span className="card-tag rework">rework</span>}
        {workItem.claim && (
          <span className="card-tag claimed">
            ⚡ {workItem.claim.claimedBy ?? 'agent'}
          </span>
        )}
      </div>
      {workItem.contractIds.length > 0 && (
        <div className="card-contracts">
          {workItem.contractIds.map(cid => (
            <span key={cid} className="card-contract-badge">{cid}</span>
          ))}
        </div>
      )}
    </div>
  );
}
```

#### Interactive Behaviors

- **Click card:** Selects work item → opens DetailDrawer, highlights in TaskDAG
- **Hover card:** Elevation shadow
- **Compact mode:** Shows only lane headers with counts
- **Auto-scroll:** When a work item is selected externally, the board scrolls that card into view

#### Cross-Panel Linking

- Work item selected → TaskDAG highlights node
- Work item selected → TopologyGraph highlights responsible module
- Work item selected → ContractPanel highlights referenced contracts

---

### 6H. EvidencePanel

**Purpose:** Verification results checklist showing what evidence exists and its status.

#### Props Interface

```typescript
interface EvidencePanelProps {
  // No props — reads from store
}
```

#### Data Shape from preview-model.json

```typescript
// From model.status.evidenceSummary
interface EvidenceItem {
  kind: string;       // "test-pass", "lint-clean", "type-check", "integration", "custom"
  summary: string;    // Human-readable description
  path: string;       // Relative path to evidence file
}

// From model.operatorCockpit.evidenceLinks
interface EvidenceLink {
  kind: string;
  summary: string;
  path: string;
  href: string | null;  // Resolved relative URL
}
```

#### Rendering (HTML — checklist)

```typescript
// src/components/EvidencePanel.tsx

const KIND_ICONS: Record<string, string> = {
  'test-pass': '🧪',
  'lint-clean': '🧹',
  'type-check': '🔤',
  'integration': '🔗',
  'custom': '📋',
  'evidence': '📎',
};

const KIND_LABELS: Record<string, string> = {
  'test-pass': 'Tests Passing',
  'lint-clean': 'Lint Clean',
  'type-check': 'Type Check',
  'integration': 'Integration',
  'custom': 'Custom Check',
  'evidence': 'Evidence',
};

export function EvidencePanel() {
  const model = useDashboardStore((s) => s.model);
  if (!model) return null;

  const evidence = model.operatorCockpit?.evidenceLinks ?? [];
  const checklist = model.operatorCockpit?.firstRunChecklist ?? [];

  return (
    <div className="evidence-panel">
      <div className="panel-header">
        <h2>Verification & Evidence</h2>
        <span className="panel-count">
          {evidence.length} items
        </span>
      </div>

      {/* Pipeline Checklist */}
      <div className="evidence-section">
        <h3>Pipeline Status</h3>
        <div className="pipeline-checklist">
          {checklist.map((step) => (
            <div key={step.id} className={`pipeline-step ${step.status}`}>
              <span className="step-indicator">
                {step.status === 'complete' ? '✅' :
                 step.status === 'current' ? '🔵' :
                 step.status === 'blocked' ? '🔴' : '⬜'}
              </span>
              <span className="step-label">{step.label}</span>
              <code className="step-command">{step.command}</code>
            </div>
          ))}
        </div>
      </div>

      {/* Evidence Items */}
      {evidence.length > 0 && (
        <div className="evidence-section">
          <h3>Evidence Artifacts</h3>
          <div className="evidence-list">
            {evidence.map((item, i) => (
              <div key={i} className="evidence-item">
                <span className="evidence-icon">
                  {KIND_ICONS[item.kind] ?? '📎'}
                </span>
                <div className="evidence-content">
                  <span className="evidence-kind">
                    {KIND_LABELS[item.kind] ?? item.kind}
                  </span>
                  <span className="evidence-summary">{item.summary}</span>
                  {item.path && (
                    <code className="evidence-path">{item.path}</code>
                  )}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
```

#### Interactive Behaviors

- **Click evidence item:** If href is available, could open in new tab (but localhost only)
- **Status indicators:** Visual distinction between complete/current/pending/blocked

#### Cross-Panel Linking

- Minimal — evidence panel is mostly a read-only status display
- The pipeline checklist steps could link to relevant views (e.g., "Plan" step → overview)

---

### 6I. DetailDrawer

**Purpose:** Slide-out panel showing full details when clicking any node across any panel.

#### Props Interface

```typescript
interface DetailDrawerProps {
  // No props — reads from store (drawerOpen, drawerContent)
}
```

#### Rendering (HTML — slide-out panel)

```typescript
// src/components/DetailDrawer.tsx

export function DetailDrawer() {
  const drawerOpen = useDashboardStore((s) => s.drawerOpen);
  const drawerContent = useDashboardStore((s) => s.drawerContent);
  const closeDrawer = useDashboardStore((s) => s.closeDrawer);
  const model = useDashboardStore((s) => s.model);

  return (
    <aside className={`detail-drawer ${drawerOpen ? 'open' : ''}`}>
      {drawerContent && (
        <>
          <div className="drawer-header">
            <h2>{drawerContent.title}</h2>
            <span className="drawer-type-badge">{drawerContent.type}</span>
            <button className="drawer-close" onClick={closeDrawer}>✕</button>
          </div>

          <div className="drawer-body">
            <DrawerContent type={drawerContent.type} id={drawerContent.id} model={model} />
          </div>
        </>
      )}
    </aside>
  );
}

function DrawerContent({
  type,
  id,
  model,
}: {
  type: NodeType;
  id: string;
  model: PreviewModel | null;
}) {
  if (!model) return null;

  switch (type) {
    case 'module':
      return <ModuleDrawer moduleId={id} model={model} />;
    case 'workItem':
      return <WorkItemDrawer workItemId={id} model={model} />;
    case 'contract':
      return <ContractDrawer contractId={id} model={model} />;
    case 'boundary':
      return <BoundaryDrawer boundaryId={id} model={model} />;
    default:
      return <div>Unknown type: {type}</div>;
  }
}

function ModuleDrawer({ moduleId, model }: { moduleId: string; model: PreviewModel }) {
  const node = model.blueprint.architecture.nodes.find(n => n.id === moduleId);
  const boundary = model.blueprint.boundaries?.find(b => b.id === moduleId);
  const moduleInterface = model.blueprint.moduleInterfaces?.find(
    mi => mi.responsibilityUnitId === moduleId
  );
  const edges = model.blueprint.architecture.edges.filter(
    e => e.from === moduleId || e.to === moduleId
  );
  const workItems = model.board?.lanes?.flatMap(l => l.workItems)
    .filter(wi => wi.responsibilityUnitId === moduleId) ?? [];

  return (
    <div className="drawer-module">
      {/* Module Info */}
      <section className="drawer-section">
        <h3>Module</h3>
        <dl className="drawer-dl">
          <dt>ID</dt><dd><code>{moduleId}</code></dd>
          <dt>Label</dt><dd>{node?.label ?? moduleId}</dd>
          <dt>Type</dt><dd>{node?.type ?? 'unknown'}</dd>
        </dl>
      </section>

      {/* Connections */}
      <section className="drawer-section">
        <h3>Connections ({edges.length})</h3>
        {edges.map((edge, i) => (
          <div key={i} className="drawer-connection">
            <code>{edge.from}</code>
            <span className="connection-arrow">→</span>
            <code>{edge.to}</code>
            <span className="connection-contract">via {edge.contractId}</span>
          </div>
        ))}
      </section>

      {/* Owned Files */}
      {boundary && (
        <section className="drawer-section">
          <h3>Owned Paths ({boundary.owns.length})</h3>
          <ul className="drawer-file-list">
            {boundary.owns.map((p, i) => (
              <li key={i}><code>{p}</code></li>
            ))}
          </ul>
        </section>
      )}

      {/* Public Interfaces */}
      {moduleInterface && (
        <section className="drawer-section">
          <h3>Public Surfaces ({moduleInterface.publicSurfaces?.length ?? 0})</h3>
          {(moduleInterface.publicSurfaces ?? []).map((surface, i) => (
            <div key={i} className="drawer-surface">
              <span className="surface-type">{surface.type}</span>
              <code>{surface.signature ?? surface.name}</code>
            </div>
          ))}
        </section>
      )}

      {/* Work Items */}
      <section className="drawer-section">
        <h3>Work Items ({workItems.length})</h3>
        {workItems.map((wi) => (
          <div key={wi.id} className="drawer-work-item">
            <span className="wi-lane-dot" style={{
              backgroundColor: LANE_COLORS[wi.lane] ?? 'var(--text-tertiary)',
            }} />
            <span>{wi.title}</span>
            <span className="wi-lane-label">{wi.lane}</span>
          </div>
        ))}
      </section>
    </div>
  );
}

function WorkItemDrawer({ workItemId, model }: { workItemId: string; model: PreviewModel }) {
  const allWorkItems = model.board?.lanes?.flatMap(l => l.workItems) ?? [];
  const wi = allWorkItems.find(w => w.id === workItemId);
  if (!wi) return <div>Work item not found: {workItemId}</div>;

  const dependencies = allWorkItems.filter(w => wi.dependsOn.includes(w.id));
  const dependents = allWorkItems.filter(w => w.dependsOn.includes(workItemId));

  return (
    <div className="drawer-work-item-detail">
      <section className="drawer-section">
        <h3>Work Item</h3>
        <dl className="drawer-dl">
          <dt>ID</dt><dd><code>{wi.id}</code></dd>
          <dt>Title</dt><dd>{wi.title}</dd>
          <dt>Lane</dt><dd>{wi.lane}</dd>
          <dt>Module</dt><dd><code>{wi.responsibilityUnitId}</code></dd>
          <dt>Blocked</dt><dd>{wi.isBlocked ? 'Yes ⛔' : 'No'}</dd>
          <dt>Retry Ready</dt><dd>{wi.isRetryReady ? 'Yes 🔄' : 'No'}</dd>
          {wi.claim && (
            <>
              <dt>Claimed By</dt><dd>{wi.claim.claimedBy}</dd>
              <dt>Claimed At</dt><dd>{wi.claim.claimedAt}</dd>
            </>
          )}
        </dl>
      </section>

      <section className="drawer-section">
        <h3>Allowed Paths</h3>
        <ul className="drawer-file-list">
          {wi.allowedPaths.map((p, i) => (
            <li key={i}><code>{p}</code></li>
          ))}
        </ul>
      </section>

      <section className="drawer-section">
        <h3>Contracts</h3>
        {wi.contractIds.map((cid) => (
          <div key={cid} className="drawer-contract-ref">
            <code>{cid}</code>
          </div>
        ))}
      </section>

      <section className="drawer-section">
        <h3>Dependencies ({dependencies.length})</h3>
        {dependencies.map(dep => (
          <div key={dep.id} className="drawer-dep">
            <span className="wi-lane-dot" style={{
              backgroundColor: LANE_COLORS[dep.lane],
            }} />
            {dep.title} ({dep.lane})
          </div>
        ))}
      </section>

      <section className="drawer-section">
        <h3>Dependents ({dependents.length})</h3>
        {dependents.map(dep => (
          <div key={dep.id} className="drawer-dep">
            <span className="wi-lane-dot" style={{
              backgroundColor: LANE_COLORS[dep.lane],
            }} />
            {dep.title} ({dep.lane})
          </div>
        ))}
      </section>
    </div>
  );
}

function ContractDrawer({ contractId, model }: { contractId: string; model: PreviewModel }) {
  const contract = model.blueprint.contracts?.find(c => c.contractId === contractId);
  const edges = model.blueprint.architecture.edges.filter(e => e.contractId === contractId);

  return (
    <div className="drawer-contract-detail">
      <section className="drawer-section">
        <h3>Contract</h3>
        <dl className="drawer-dl">
          <dt>ID</dt><dd><code>{contractId}</code></dd>
          <dt>Kind</dt><dd>{contract?.kind ?? 'unknown'}</dd>
          {contract?.method && <><dt>Method</dt><dd>{contract.method}</dd></>}
          {contract?.path && <><dt>Path</dt><dd><code>{contract.path}</code></dd></>}
        </dl>
      </section>

      <section className="drawer-section">
        <h3>Used By ({edges.length} edges)</h3>
        {edges.map((edge, i) => (
          <div key={i} className="drawer-connection">
            <code>{edge.from}</code> → <code>{edge.to}</code>
          </div>
        ))}
      </section>
    </div>
  );
}

function BoundaryDrawer({ boundaryId, model }: { boundaryId: string; model: PreviewModel }) {
  const boundary = model.blueprint.boundaries?.find(b => b.id === boundaryId);
  if (!boundary) return <div>Boundary not found: {boundaryId}</div>;

  return (
    <div className="drawer-boundary-detail">
      <section className="drawer-section">
        <h3>Responsibility Boundary</h3>
        <dl className="drawer-dl">
          <dt>Unit</dt><dd><code>{boundary.responsibilityUnitId}</code></dd>
        </dl>
      </section>

      <section className="drawer-section">
        <h3>Owned Paths ({boundary.owns.length})</h3>
        <ul className="drawer-file-list">
          {boundary.owns.map((p, i) => (
            <li key={i}><code>{p}</code></li>
          ))}
        </ul>
      </section>
    </div>
  );
}
```

#### Interactive Behaviors

- **Slide animation:** 250ms ease transition on width
- **Close:** Click X button or press Escape
- **Navigate:** Clicking a related entity inside the drawer (e.g., a contract in a module drawer) should update the drawer to show that entity
- **Resize:** Optional drag handle for drawer width

#### Cross-Panel Linking

- The drawer is the TARGET of cross-panel linking — any component can open it
- Links within the drawer update the selection store, causing other panels to react

---

## 7. Shared Types

```typescript
// src/types/model.ts

/** Top-level preview model as returned by /api/model */
export interface PreviewModel {
  schemaVersion: string;
  generatedAt: string;

  run: {
    runDir: string;
    runId: string;
    workItemId: string | null;
    prdId: string;
  };

  blueprint: {
    title: string;
    summary: string[];
    goals: string[];
    nonGoals: string[];
    acceptanceCriteria: string[];
    primaryContract: Contract | null;
    contracts: Contract[];
    boundaries: BoundaryModel[];
    moduleInterfaces: ModuleInterface[];
    architecture: {
      nodes: ArchitectureNode[];
      edges: ArchitectureEdge[];
    };
    stateTransitions: StateTransition[];
    callStacks: CallStack[];
    sequences: Sequence[];
    systemDossier: any; // Complex nested object — used by DetailDrawer
    metrics?: BlueprintMetrics; // v1.1
  };

  design: {
    architectureEdges: string[];
    stateTransitions: string[];
    apiSpecs: string[];
    responsibilityBoundaries: string[];
    moduleInterfaces: string[];
    callStacks: string[];
    sequences: string[];
  };

  status: StatusModel;
  operatorCockpit: OperatorCockpit;
  board: BoardModel | null;
}

export interface ArchitectureNode {
  id: string;
  label: string;
  type: string;
  group?: string;
}

export interface ArchitectureEdge {
  from: string;
  to: string;
  contractId: string;
  type?: string;
}

export interface Contract {
  contractId: string;
  kind: string;
  path?: string;
  method?: string;
  reason?: string;
  description?: string;
}

export interface BoundaryModel {
  id: string;
  responsibilityUnitId: string;
  owns: string[];
}

export interface ModuleInterface {
  responsibilityUnitId: string;
  publicSurfaces: {
    name: string;
    type: string;
    signature?: string;
    description?: string;
  }[];
}

export interface StateTransition {
  from: string;
  to: string;
  gate: string;
}

export interface CallStack {
  entrypoint: string;
  calls: string[];
}

export interface Sequence {
  title: string;
  messages: {
    from: string;
    to: string;
    label: string;
    type?: string;
  }[];
}

export interface StatusModel {
  phase: string;
  blueprintStatus: string;
  headline: string;
  blockers: string[];
  nextAction: string;
  nextCommand: string;
  evidenceSummary: { kind: string; summary: string; path: string }[];
}

export interface OperatorCockpit {
  readOnly: boolean;
  controlSurface: string;
  phase: string;
  blueprintStatus: string;
  headline: string;
  nextAction: string;
  nextCommand: string;
  firstRunChecklist: {
    id: string;
    label: string;
    command: string;
    status: 'complete' | 'current' | 'pending' | 'blocked';
  }[];
  evidenceLinks: {
    kind: string;
    summary: string;
    path: string;
    href: string | null;
  }[];
}

export interface BoardModel {
  boardId: string;
  laneCounts: Record<string, number>;
  lanes: {
    name: string;
    workItems: WorkItemModel[];
  }[];
  activeClaims: any[];
  blockedWork: any[];
  failedFast: any[];
  retryReady: any[];
  rework: any[];
  runtimeState: any;
  audit: any;
}

export interface WorkItemModel {
  id: string;
  title: string;
  lane: string;
  responsibilityUnitId: string;
  contractIds: string[];
  dependsOn: string[];
  allowedPaths: string[];
  isBlocked: boolean;
  isRetryReady: boolean;
  isRework: boolean;
  attemptNumber: number | null;
  nextRetryAt: string | null;
  claim: { workItemId: string; claimedAt: string; claimedBy: string } | null;
}

export interface BlueprintMetrics {
  moduleCount: number;
  contractCount: number;
  workItemCount: number;
  gatesPassed: number;
  gatesTotal: number;
  estimatedEffortDays: number | null;
}

export type ViewId =
  | 'overview'
  | 'architecture'
  | 'tasks'
  | 'contracts'
  | 'boundaries'
  | 'sequences'
  | 'evidence';

export type NodeType = 'module' | 'workItem' | 'contract' | 'boundary' | 'sequence';

export interface DrawerContent {
  type: NodeType;
  id: string;
  title: string;
}

export interface SelectionState {
  nodeId: string | null;
  nodeType: NodeType | null;
  relatedModuleIds: string[];
  relatedContractIds: string[];
  relatedWorkItemIds: string[];
  relatedFilePatterns: string[];
}
```

---

## 8. WebSocket Integration

```typescript
// src/hooks/useWebSocket.ts

import { useEffect, useRef } from 'react';
import { useDashboardStore } from '../store/dashboard-store';

export function useWebSocket() {
  const fetchModel = useDashboardStore((s) => s.fetchModel);
  const wsRef = useRef<WebSocket | null>(null);

  useEffect(() => {
    function connect() {
      const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
      const ws = new WebSocket(`${protocol}//${window.location.host}/ws`);
      wsRef.current = ws;

      ws.onopen = () => {
        console.log('[dashboard] WebSocket connected');
      };

      ws.onmessage = (event) => {
        try {
          const msg = JSON.parse(event.data);
          if (msg.type === 'model-changed') {
            // Re-fetch the model when server signals a change
            fetchModel();
          }
        } catch {
          // Ignore non-JSON messages
        }
      };

      ws.onclose = (event) => {
        console.log('[dashboard] WebSocket closed, reconnecting in 2s...');
        wsRef.current = null;
        // Auto-reconnect
        setTimeout(connect, 2000);
      };

      ws.onerror = () => {
        ws.close();
      };
    }

    connect();

    return () => {
      wsRef.current?.close();
      wsRef.current = null;
    };
  }, [fetchModel]);
}
```

```typescript
// src/hooks/useInitialLoad.ts

import { useEffect } from 'react';
import { useDashboardStore } from '../store/dashboard-store';

export function useInitialLoad() {
  const fetchModel = useDashboardStore((s) => s.fetchModel);

  useEffect(() => {
    fetchModel();
  }, [fetchModel]);
}
```

### WebSocket Message Protocol (server → client)

```typescript
// Messages the server sends:
interface WsModelChanged {
  type: 'model-changed';
  runDir: string;
  timestamp: string;
}

// The client ALWAYS re-fetches via GET /api/model after receiving
// model-changed. We do NOT stream the full model over WebSocket.
// This keeps the WS protocol simple and the model fetch idempotent.
```

---

## 9. Cross-Panel Linking Protocol

### How It Works

1. User clicks a node in ANY component (TopologyGraph, TaskDAG, KanbanBoard, etc.)
2. The component calls `store.selectNode(nodeId, nodeType)` (or the typed variant like `selectModule`)
3. The store computes related items via `computeRelatedItems(model, nodeId, nodeType)`
4. The store updates `selection.relatedModuleIds`, `relatedContractIds`, etc.
5. ALL components subscribe to the selection state via `useDashboardStore((s) => s.selection)`
6. Each component checks if its items are in the related lists and applies highlighting

### Selection Flow Example

```
User clicks "API Gateway" node in TopologyGraph
  → selectModule("ru.api-gateway")
  → computeRelatedItems finds:
      relatedModuleIds: ["ru.database", "ru.auth"]      (connected modules)
      relatedContractIds: ["contract.user-api"]          (edge contracts)
      relatedWorkItemIds: ["wi.1", "wi.3"]               (work items for this module)
      relatedFilePatterns: ["src/api/", "src/middleware/"] (owned files)
  → TopologyGraph: highlights ru.database, ru.auth nodes; highlights edges
  → ContractPanel: highlights contract.user-api card
  → KanbanBoard: highlights wi.1, wi.3 cards
  → ResponsibilityMap: highlights src/api/, src/middleware/ in tree
  → TaskDAG: highlights wi.1, wi.3 nodes
  → DetailDrawer: opens with ModuleDrawer for ru.api-gateway
```

### Deselection

- Click on empty space in any React Flow panel → `clearSelection()`
- Click the same node again → toggles off (clear selection)
- Press Escape → `clearSelection()` + `closeDrawer()`

---

## 10. Implementation Order

### Phase 1: Foundation (Day 1)

1. Scaffold `src/dashboard/` with Vite + React + TypeScript
2. Implement `package.json`, `vite.config.ts`, `tsconfig.json`
3. Implement `src/types/model.ts` (all TypeScript interfaces)
4. Implement `src/theme/theme.ts` and `ThemeProvider`
5. Implement `src/store/dashboard-store.ts` (without WebSocket)
6. Implement `src/store/compute-relations.ts`
7. Implement `App.tsx`, `Sidebar.tsx`, `MainContent.tsx`
8. Implement `LoadingScreen` and `ErrorScreen`
9. First `vite build` → verify dist/ output
10. Test: App renders with mock data

### Phase 2: Graph Components (Day 2)

1. Implement `ModuleNode` custom node
2. Implement `layout.ts` (hierarchical layout)
3. Implement `TopologyGraph` component
4. Implement `WorkItemNode` custom node
5. Implement `TaskDAG` component
6. Test: Both graph components render with mock architecture/DAG data

### Phase 3: Content Panels (Day 3)

1. Implement `ContractPanel` + `ContractCard` + `ModuleInterfaceCard`
2. Implement `ResponsibilityMap` + `FileTreeView` + `buildOwnershipTree`
3. Implement `SequenceDiagram` + `SequenceChart` + `CallStackView`
4. Implement `HeroSection` + `StatusBadge` + `MetricCard` + `ChecklistStep`
5. Test: All content panels render with mock data

### Phase 4: Interactive Features (Day 4)

1. Implement `KanbanBoard` + `KanbanCard`
2. Implement `EvidencePanel`
3. Implement `DetailDrawer` + all drawer variants (Module, WorkItem, Contract, Boundary)
4. Wire up cross-panel linking (selection → highlighting in all components)
5. Implement `useWebSocket` + `useInitialLoad` hooks
6. Test: Click a node → drawer opens, all panels highlight correctly

### Phase 5: Integration & Polish (Day 5)

1. Connect to real `dashboard-server.cjs`
2. Test with real `preview-model.json` data
3. Polish CSS: responsive layout, scrollbar styling, animations
4. Run `vite build` → commit dist/ to repo
5. Update `dashboard-server.cjs` to serve from dist/
6. End-to-end test: agent generates preview-model.json → dashboard updates live

### File Tree (final)

```
dev-harness/src/dashboard/
├── package.json
├── vite.config.ts
├── tsconfig.json
├── index.html
├── src/
│   ├── main.tsx
│   ├── App.tsx
│   ├── types/
│   │   └── model.ts
│   ├── store/
│   │   ├── dashboard-store.ts
│   │   └── compute-relations.ts
│   ├── theme/
│   │   ├── theme.ts
│   │   └── ThemeProvider.tsx
│   ├── hooks/
│   │   ├── useWebSocket.ts
│   │   └── useInitialLoad.ts
│   ├── styles/
│   │   └── global.css
│   ├── components/
│   │   ├── layout/
│   │   │   ├── Sidebar.tsx
│   │   │   ├── MainContent.tsx
│   │   │   ├── LoadingScreen.tsx
│   │   │   └── ErrorScreen.tsx
│   │   ├── views/
│   │   │   ├── OverviewView.tsx
│   │   │   ├── ArchitectureView.tsx
│   │   │   ├── TasksView.tsx
│   │   │   ├── ContractsView.tsx
│   │   │   ├── BoundariesView.tsx
│   │   │   ├── SequencesView.tsx
│   │   │   └── EvidenceView.tsx
│   │   ├── nodes/
│   │   │   ├── ModuleNode.tsx
│   │   │   └── WorkItemNode.tsx
│   │   ├── topology/
│   │   │   └── layout.ts
│   │   ├── HeroSection.tsx
│   │   ├── TopologyGraph.tsx
│   │   ├── TaskDAG.tsx
│   │   ├── ContractPanel.tsx
│   │   ├── ResponsibilityMap.tsx
│   │   ├── SequenceDiagram.tsx
│   │   ├── KanbanBoard.tsx
│   │   ├── EvidencePanel.tsx
│   │   └── DetailDrawer.tsx
│   └── __tests__/
│       ├── store.test.ts
│       ├── compute-relations.test.ts
│       └── layout.test.ts
└── dist/                              # COMMITTED
    ├── index.html
    └── assets/
        ├── index-[hash].js
        └── index-[hash].css
```

---

## Appendix A: Mock Data for Development

Create a `src/dashboard/src/__fixtures__/mock-model.ts` that exports a
complete PreviewModel matching the real shape. This enables development
without a running server:

```typescript
// In main.tsx, for development:
if (import.meta.env.DEV && !window.location.port.startsWith('38')) {
  // Running in Vite dev mode, not behind the real server
  import('./__fixtures__/mock-model').then(({ mockModel }) => {
    useDashboardStore.getState().setModel(mockModel);
  });
}
```

## Appendix B: Bundle Size Budget

| Dependency      | Size (minified+gzip) |
|-----------------|---------------------|
| React 19        | ~42KB               |
| React DOM 19    | ~42KB               |
| @xyflow/react   | ~65KB               |
| Zustand 5       | ~1KB                |
| App code + CSS  | ~30KB               |
| **Total**       | **~180KB**          |

This is acceptable. The dashboard loads once and stays open.
No repeated page loads, no SSR, no SEO concern.

## Appendix C: Server API Contract

The dashboard expects these server endpoints:

```
GET  /                     → serves dist/index.html
GET  /assets/*             → serves dist/assets/
GET  /api/model            → returns preview-model.json content
     Response: { ok: true, model: PreviewModel, errors: [] }
POST /api/action           → receives user actions
     Body: { action: "approve" | "reject" | "navigate", payload: any }
     Response: { ok: true }
WS   /ws                   → WebSocket connection
     Server sends: { type: "model-changed", timestamp: string }
```

The dashboard does NOT know or care about runDir — the server resolves that.
The server is started with a specific runDir and serves that one model.
