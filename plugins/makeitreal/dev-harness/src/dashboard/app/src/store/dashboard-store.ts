import { create } from 'zustand';
import type { PreviewModel, SelectionState, NodeType } from '../types/model';

interface DashboardStore {
  model: PreviewModel | null;
  loading: boolean;
  error: string | null;
  lastUpdated: string | null;
  connected: boolean;

  selection: SelectionState;
  activeSection: string;

  setModel: (model: PreviewModel) => void;
  setLoading: (loading: boolean) => void;
  setError: (error: string | null) => void;
  setConnected: (connected: boolean) => void;

  selectNode: (nodeId: string, nodeType: NodeType) => void;
  clearSelection: () => void;

  setActiveSection: (sectionId: string) => void;

  fetchModel: () => Promise<void>;
}

const emptySelection: SelectionState = {
  nodeId: null,
  nodeType: null,
  relatedModuleIds: [],
  relatedContractIds: [],
  relatedWorkItemIds: [],
};

export const useDashboardStore = create<DashboardStore>()((set, get) => ({
  model: null,
  loading: true,
  error: null,
  lastUpdated: null,
  connected: false,

  selection: { ...emptySelection },
  activeSection: 'architecture',

  setModel: (model) => set({
    model,
    loading: false,
    error: null,
    lastUpdated: new Date().toISOString(),
  }),

  setLoading: (loading) => set({ loading }),
  setError: (error) => set({ error, loading: false }),
  setConnected: (connected) => set({ connected }),

  selectNode: (nodeId, nodeType) => {
    const model = get().model;
    if (!model) return;
    const related = computeRelatedItems(model, nodeId, nodeType);
    set({ selection: { nodeId, nodeType, ...related } });
  },

  clearSelection: () => set({ selection: { ...emptySelection } }),

  setActiveSection: (sectionId) => set({ activeSection: sectionId }),

  fetchModel: async () => {
    set({ loading: true });
    try {
      const res = await fetch('/api/model');
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      const model = data.model ?? data;
      set({ model, loading: false, error: null, lastUpdated: new Date().toISOString() });
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      set({ error: message, loading: false });
    }
  },
}));

function computeRelatedItems(model: PreviewModel, nodeId: string, nodeType: NodeType) {
  const result = {
    relatedModuleIds: [] as string[],
    relatedContractIds: [] as string[],
    relatedWorkItemIds: [] as string[],
  };

  const edges = model.blueprint?.architecture?.edges ?? [];
  const allWorkItems = model.board?.lanes?.flatMap(l => l.workItems) ?? [];

  switch (nodeType) {
    case 'module': {
      result.relatedModuleIds = [...new Set(
        edges
          .filter(e => e.from === nodeId || e.to === nodeId)
          .flatMap(e => [e.from, e.to])
          .filter(id => id !== nodeId)
      )];
      result.relatedContractIds = edges
        .filter(e => e.from === nodeId || e.to === nodeId)
        .map(e => e.contractId)
        .filter((contractId): contractId is string => Boolean(contractId));
      result.relatedWorkItemIds = allWorkItems
        .filter(wi => wi.responsibilityUnitId === nodeId)
        .map(wi => wi.id);
      break;
    }
    case 'workItem': {
      const wi = allWorkItems.find(w => w.id === nodeId);
      if (wi) {
        result.relatedModuleIds = wi.responsibilityUnitId ? [wi.responsibilityUnitId] : [];
        result.relatedContractIds = wi.contractIds ?? [];
      }
      break;
    }
    case 'contract': {
      result.relatedModuleIds = edges
        .filter(e => e.contractId === nodeId)
        .flatMap(e => [e.from, e.to]);
      result.relatedWorkItemIds = allWorkItems
        .filter(wi => (wi.contractIds ?? []).includes(nodeId))
        .map(wi => wi.id);
      break;
    }
  }

  return result;
}
