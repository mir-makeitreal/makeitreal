// Preview model types matching preview-model.json schema

export interface PreviewModel {
  schemaVersion: string;
  generatedAt: string;
  run: {
    runDir: string;
    runId: string;
    workItemId: string;
    prdId: string;
  };
  blueprint: Blueprint;
  design: DesignSummary;
  status: StatusModel;
  operatorCockpit: OperatorCockpit;
  board: Board | null;
}

export interface DesignSummary {
  architectureEdges: string[];
  stateTransitions: string[];
  apiSpecs: string[];
  responsibilityBoundaries: string[];
  moduleInterfaces: string[];
  callStacks: string[];
  sequences: string[];
}

export interface Blueprint {
  title: string;
  summary: string[];
  goals: string[];
  nonGoals: string[];
  acceptanceCriteria: { id: string; statement: string }[];
  primaryContract: Contract | null;
  contracts: Contract[];
  boundaries: Boundary[];
  moduleInterfaces: ModuleInterface[];
  architecture: {
    nodes: ArchNode[];
    edges: ArchEdge[];
  };
  stateTransitions: { from: string; to: string; gate: string }[];
  callStacks: { entrypoint: string; calls: string[] }[];
  sequences: Sequence[];
  systemDossier: any;
}

export interface Contract {
  contractId: string;
  kind: string;
  path: string;
  reason: string | null;
}

export interface Boundary {
  responsibilityUnitId: string;
  owns: string[];
  mayUseContracts: string[];
}

export interface ModuleInterface {
  responsibilityUnitId: string;
  moduleName: string;
  owner: string;
  purpose: string;
  owns: string[];
  publicSurfaces: PublicSurface[];
  imports: Import[];
}

export interface PublicSurface {
  name: string;
  kind: string;
  description: string;
  consumers: string[];
  contractIds: string[];
  signature: {
    inputs: { name: string; type: string; description: string; required: boolean }[];
    outputs: { name: string; type: string; description: string }[];
    errors: { code: string; when: string; handling: string }[];
  };
}

export interface Import {
  contractId: string;
  surface: string;
  providerResponsibilityUnitId: string;
  allowedUse: string;
}

export interface ArchNode {
  id: string;
  label: string;
  responsibilityUnitId: string;
}

export interface ArchEdge {
  from: string;
  to: string;
  contractId: string;
}

export interface Sequence {
  title: string;
  participants: string[];
  messages: { from: string; to: string; label: string }[];
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
  firstRunChecklist: ChecklistItem[];
  evidenceLinks: { kind: string; summary: string; path: string; href: string | null }[];
}

export interface ChecklistItem {
  id: string;
  label: string;
  command: string;
  status: 'complete' | 'current' | 'pending' | 'blocked';
}

export interface Board {
  boardId: string;
  laneCounts: Record<string, number>;
  lanes: { name: string; workItems: WorkItem[] }[];
  activeClaims: any[];
  blockedWork: any[];
  failedFast: any[];
  retryReady: any[];
  rework: any[];
  runtimeState: any;
  audit: any;
}

export interface WorkItem {
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
  claim: any;
}

export type ViewId =
  | 'overview'
  | 'architecture'
  | 'tasks'
  | 'contracts';

export type NodeType = 'module' | 'workItem' | 'contract' | 'boundary';

export interface SelectionState {
  nodeId: string | null;
  nodeType: NodeType | null;
  relatedModuleIds: string[];
  relatedContractIds: string[];
  relatedWorkItemIds: string[];
}
