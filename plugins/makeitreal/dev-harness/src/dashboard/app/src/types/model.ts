// Preview model types matching preview-model.json schema

export type JsonPrimitive = string | number | boolean | null;
export type JsonValue = JsonPrimitive | JsonObject | JsonValue[];

export interface JsonObject {
  [key: string]: JsonValue;
}

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
  systemDossier: SystemDossier;
}

export interface Contract {
  contractId: string | null;
  kind: string;
  path: string | null;
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
  owner: string | null;
  purpose: string | null;
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
  signature: PublicSurfaceSignature;
}

export interface PublicSurfaceSignature {
  inputs: PublicSurfaceInput[];
  outputs: PublicSurfaceOutput[];
  errors: PublicSurfaceError[];
}

export interface PublicSurfaceInput {
  name: string;
  type: string;
  description: string;
  required: boolean;
}

export interface PublicSurfaceOutput {
  name: string;
  type: string;
  description: string;
}

export interface PublicSurfaceError {
  code: string;
  when: string;
  handling: string;
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
  responsibilityUnitId?: string | null;
}

export interface ArchEdge {
  from: string;
  to: string;
  contractId: string | null;
}

export interface Sequence {
  id?: string;
  title: string;
  participants: string[];
  messages: SequenceMessage[];
}

export interface SequenceMessage {
  from: string;
  to: string;
  label: string;
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

export interface StatusModel {
  phase: string;
  blueprintStatus: string;
  headline: string;
  blockers: string[];
  nextAction: string;
  nextCommand: string;
  evidenceSummary: EvidenceSummaryItem[];
}

export interface EvidenceSummaryItem {
  kind: string;
  summary: string;
  path: string;
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
  evidenceLinks: EvidenceLink[];
}

export interface EvidenceLink {
  kind: string;
  summary: string;
  path: string;
  href: string | null;
  timestamp?: string | null;
  startedAt?: string | null;
  completedAt?: string | null;
  updatedAt?: string | null;
}

export interface ChecklistItem {
  id: string;
  label: string;
  command: string;
  status: 'complete' | 'current' | 'pending' | 'blocked' | 'failed';
  timestamp?: string | null;
  startedAt?: string | null;
  completedAt?: string | null;
  updatedAt?: string | null;
}

export interface Board {
  boardId: string;
  laneCounts: Record<string, number>;
  lanes: BoardLane[];
  activeClaims: WorkClaim[];
  blockedWork: BlockedWorkSummary[];
  failedFast: FailedFastWorkSummary[];
  retryReady: RetryReadyWorkSummary[];
  rework: ReworkSummary[];
  runtimeState: RuntimeState | null;
  audit: BoardAudit | null;
}

export interface BoardLane {
  name: string;
  workItems: WorkItem[];
}

export interface WorkClaim {
  workItemId: string;
  workerId: string;
  responsibilityUnitId: string | null;
  claimedAt: string;
  leaseExpiresAt: string;
}

export interface BlockedWorkSummary {
  id: string;
  dependsOn: string[];
}

export interface FailedFastWorkSummary {
  id: string;
  nextRetryAt: string | null;
  attemptNumber: number | null;
  errorCode: string | null;
  errorCategory: string | null;
  errorReason: string | null;
  latestAttemptId: string | null;
}

export interface RetryReadyWorkSummary {
  id: string;
  nextRetryAt: string | null;
}

export interface ReworkSummary {
  id: string;
}

export type RuntimeEventName =
  | 'claim_created'
  | 'claim_expired'
  | 'work_ready'
  | 'work_started'
  | 'rework_resolved'
  | 'verification_completed'
  | 'wiki_synced'
  | 'session_started'
  | 'startup_failed'
  | 'turn_completed'
  | 'turn_failed'
  | 'turn_cancelled'
  | 'turn_ended_with_error'
  | 'turn_input_required'
  | 'unsupported_tool_call'
  | 'notification'
  | 'other_message'
  | 'malformed'
  | 'work_decomposed'
  | 'children_complete';

export interface RuntimeState {
  schemaVersion: string;
  boardId: string;
  claimed: Record<string, WorkClaim>;
  running: Record<string, RuntimeRunningWork>;
  retryAttempts: Record<string, RuntimeRetryAttempt>;
  completedBookkeeping: Record<string, RuntimeCompletedBookkeeping>;
  sessionMetrics: RuntimeSessionMetrics;
  rateLimitSnapshots: Record<string, JsonValue>;
}

export interface RuntimeRunningWork {
  workItemId: string;
  workerId: string;
  attemptId: string | null;
  startedAt: string;
  lastEventAt: string;
  lastEvent?: RuntimeEventName;
}

export interface RuntimeRetryAttempt {
  workItemId: string;
  attemptNumber: number;
  dueAt: string;
  errorCode: string;
  errorCategory: string | null;
  errorReason: string | null;
  latestAttemptId: string | null;
}

export interface RuntimeCompletedBookkeeping {
  workItemId: string;
  completedAt: string;
  evidencePath: string | null;
  wikiPath: string | null;
}

export interface RuntimeSessionMetrics {
  turnCount: number;
  startedSessions: number;
  failedTurns: number;
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
}

export interface BoardAudit {
  ok: boolean;
  skipped?: boolean;
  code?: string;
  reason?: string;
  runDir?: string;
  blueprintBlockedWorkItemIds?: string[];
  staleBlueprintWorkItemIds?: string[];
  gateFailures: HarnessError[];
  gateFailureAuthority?: string;
}

export interface HarnessError {
  code: string;
  reason: string;
  workItemId?: string;
  ownerModule?: string | null;
  evidence?: string[];
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
  claim: WorkClaim | null;
}

export interface SystemDossier {
  title: string;
  summary: string[];
  goals: string[];
  modules: SystemDossierModule[];
  approvalScope: ApprovalScope;
  taskDag: SystemTaskDag;
  workerTopology: WorkerTopology;
  dependencyEdges: DependencyEdge[];
  contractMatrix: ContractMatrixEntry[];
  contractSurfaces: ContractSurface[];
  surfaceTraceReference: SurfaceTraceReference[];
  systemPlacement: SystemPlacement;
  scenarioIndex: ScenarioIndexEntry[];
  scenarioDetails: ScenarioDetail[];
  reviewDecisions: string[];
  sources: DossierSource[];
  signalFlows: Sequence[];
  callStacks: CallStack[];
  stateTransitions: StateTransition[];
  deliveryScope: DeliveryScope;
  designPatterns: DesignPattern[];
}

export interface SystemDossierModule {
  responsibilityUnitId: string;
  moduleName: string;
  owner: string | null;
  purpose: string | null;
  owns: string[];
  ownedFileTree: FileTreeNode;
  publicSurfaces: PublicSurface[];
  imports: Import[];
}

export interface FileTreeNode {
  name: string;
  type: 'file' | 'folder' | string;
  children: FileTreeNode[];
}

export interface ApprovalScope {
  blueprintFingerprint: string | null;
  requiredWorkItems: string[];
  authorizedPaths: string[];
  requiredContracts: string[];
}

export interface SystemTaskDag {
  nodes: SystemTaskDagNode[];
  edges: SystemTaskDagEdge[];
}

export interface SystemTaskDagNode {
  id: string;
  kind: string;
  requiredForDone: boolean;
  responsibilityUnitId: string;
  moduleName: string;
  owner: string | null;
  title: string;
  lane: string | null;
  allowedPaths: string[];
  contractIds: string[];
}

export interface SystemTaskDagEdge {
  from: string;
  to: string;
  contractId: string | null;
  fromLabel: string;
  toLabel: string;
}

export interface WorkerTopology {
  assignments: WorkerAssignment[];
  reviewRoles: string[];
}

export interface WorkerAssignment {
  workItemId: string;
  evidenceRole: string;
  responsibilityUnitId: string;
  moduleName: string;
  owner: string | null;
  contractIds: string[];
  allowedPaths: string[];
  handoff: string;
}

export interface DependencyEdge {
  from: string;
  fromLabel: string;
  to: string;
  toLabel: string;
  contractId: string | null;
  contractKind: string;
  allowedUse: string;
  relation: string;
  surface?: string | null;
}

export interface ContractMatrixEntry {
  contractId: string;
  kind: string;
  path: string | null;
  summary: string;
  providers: string[];
  consumers: string[];
}

export interface ContractSurface {
  responsibilityUnitId: string;
  moduleName: string;
  owner: string | null;
  name: string;
  kind: string;
  description: string;
  contractIds: string[];
  consumers: string[];
  signature: PublicSurfaceSignature;
}

export interface SurfaceTraceReference {
  moduleName: string;
  responsibilityUnitId: string;
  owner: string | null;
  surfaceName: string;
  surfaceKind: string;
  contractIds: string[];
  providerWorkItems: string[];
  consumers: string[];
  allowedUses: string[];
  callStacks: string[];
  scenarios: string[];
}

export interface SystemPlacement {
  title: string;
  summary: string;
  modules: SystemPlacementModule[];
  edges: SystemPlacementEdge[];
}

export interface SystemPlacementModule {
  responsibilityUnitId: string;
  moduleName: string;
  purpose: string;
  owner: string | null;
}

export interface SystemPlacementEdge {
  from: string;
  fromLabel: string;
  to: string;
  toLabel: string;
  contractId: string | null;
  surface: string | null;
}

export type ScenarioVisualizationKind = 'mermaid' | 'workflow' | 'text';

export interface ScenarioIndexEntry {
  id: string;
  title: string;
  participantCount: number;
  stepCount: number;
  visualizationKind: ScenarioVisualizationKind;
}

export interface ScenarioDetail extends Sequence {
  id: string;
  visualizationKind: ScenarioVisualizationKind;
}

export interface DossierSource {
  label: string;
  path: string;
  kind: string;
}

export interface DeliveryScope {
  ownedPaths: string[];
  responsibilityUnitIds: string[];
  acceptanceCriteriaIds: string[];
}

export interface DesignPattern {
  name: string;
  rationale: string;
}

export type ModuleFlowNodeData = Record<string, unknown> & {
  label: string;
  nodeId: string;
  responsibilityUnitId: string | null;
};

export type WorkItemFlowNodeData = Record<string, unknown> & {
  workItemId: string;
  title: string;
  lane: string;
  isBlocked: boolean;
};

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
