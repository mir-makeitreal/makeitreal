import React, { useCallback, useMemo } from 'react';
import Dagre from '@dagrejs/dagre';
import {
  ReactFlow,
  Background,
  Controls,
  MiniMap,
  Handle,
  Position,
  type Node as ReactFlowNode,
  type Edge,
  type NodeProps,
  type NodeMouseHandler,
} from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import type { ArchNode, ArchEdge, ModuleFlowNodeData } from '../types/model';
import { useDashboardStore } from '../store/dashboard-store';

// ── Custom Module Node ──

type ModuleFlowNode = ReactFlowNode<ModuleFlowNodeData, 'module'>;

function normalizeModuleType(value: unknown): string | null {
  return typeof value === 'string' && value.trim().length > 0 ? value.trim() : null;
}

function moduleTypeClass(moduleType: unknown): string {
  return `module-type-${(normalizeModuleType(moduleType) ?? 'module').toLowerCase().replace(/[^a-z0-9]+/g, '-') || 'module'}`;
}

function archNodeModuleType(node: ArchNode): string {
  const typedNode = node as ArchNode & { kind?: unknown; moduleType?: unknown };
  return normalizeModuleType(typedNode.moduleType) ?? normalizeModuleType(typedNode.kind) ?? 'module';
}

function ModuleNode({ data, selected }: NodeProps<ModuleFlowNode>) {
  const sel = useDashboardStore(s => s.selection);
  const isHighlighted = sel.nodeId === data.nodeId || sel.relatedModuleIds.includes(data.nodeId);

  return (
    <div className={`module-node ${moduleTypeClass(data.moduleType)} ${selected || isHighlighted ? 'selected' : ''}`}>
      <Handle type="target" position={Position.Top} />
      <div className="node-label">{data.label}</div>
      {data.responsibilityUnitId && (
        <div className="node-sub">{data.responsibilityUnitId}</div>
      )}
      <Handle type="source" position={Position.Bottom} />
    </div>
  );
}

const nodeTypes = { module: ModuleNode };

const DEFAULT_VIEWPORT = { x: 0, y: 0, zoom: 1.0 };
const MODULE_NODE_WIDTH = 380;
const MODULE_NODE_HEIGHT = 100;
const MODULE_NODE_MIN_WIDTH = 350;
const MODULE_NODE_MIN_HEIGHT = 80;

// ── Auto-layout: dagre hierarchy ──

function autoLayout(archNodes: ArchNode[], archEdges: ArchEdge[]): ModuleFlowNode[] {
  const g = new Dagre.graphlib.Graph().setDefaultEdgeLabel(() => ({}));
  g.setGraph({ rankdir: 'TB', nodesep: 150, ranksep: 200, marginx: 40, marginy: 40 });

  archNodes.forEach(n => {
    g.setNode(n.id, {
      width: MODULE_NODE_WIDTH,
      height: MODULE_NODE_HEIGHT,
    });
  });

  archEdges.forEach(e => {
    g.setEdge(e.from, e.to);
  });

  Dagre.layout(g);
  const graph = g.graph();
  const centerOffset = {
    x: (graph.width ?? 0) / 2,
    y: (graph.height ?? 0) / 2,
  };

  return archNodes.map((n, i) => ({
    id: n.id,
    type: 'module',
    position: getNodePosition(g.node(n.id), centerOffset, i),
    style: {
      minWidth: MODULE_NODE_MIN_WIDTH,
      minHeight: MODULE_NODE_MIN_HEIGHT,
      width: MODULE_NODE_WIDTH,
    },
    data: {
      label: n.label,
      nodeId: n.id,
      responsibilityUnitId: n.responsibilityUnitId ?? null,
      moduleType: archNodeModuleType(n),
    },
  }));
}

function getNodePosition(
  node: { x: number; y: number } | undefined,
  centerOffset: { x: number; y: number },
  index: number
) {
  if (!node || typeof node.x !== 'number' || typeof node.y !== 'number') {
    return {
      x: index * (MODULE_NODE_WIDTH + 150) - centerOffset.x,
      y: -centerOffset.y,
    };
  }

  return {
    x: node.x - centerOffset.x - MODULE_NODE_WIDTH / 2,
    y: node.y - centerOffset.y - MODULE_NODE_HEIGHT / 2,
  };
}

function buildEdges(archEdges: ArchEdge[]): Edge[] {
  return archEdges.map((e, i) => ({
    id: `edge-${i}`,
    source: e.from,
    target: e.to,
    label: e.contractId ?? undefined,
    style: { stroke: 'var(--rf-edge)' },
    labelStyle: { fontSize: 12, fontWeight: 600, fill: 'var(--text-secondary)' },
    labelShowBg: true,
    labelBgStyle: { fill: 'var(--bg-secondary)', fillOpacity: 0.95 },
    labelBgPadding: [6, 4],
    labelBgBorderRadius: 4,
    animated: true,
    type: 'smoothstep',
  }));
}

interface Props {
  nodes: ArchNode[];
  edges: ArchEdge[];
  fullHeight?: boolean;
}

export function TopologyGraph({ nodes: archNodes, edges: archEdges, fullHeight = false }: Props) {
  const selectNode = useDashboardStore(s => s.selectNode);

  const nodes = useMemo(() => autoLayout(archNodes, archEdges), [archNodes, archEdges]);
  const edges = useMemo(() => buildEdges(archEdges), [archEdges]);

  const onNodeClick = useCallback<NodeMouseHandler<ModuleFlowNode>>((_: React.MouseEvent, node) => {
    selectNode(node.id, 'module');
  }, [selectNode]);

  if (archNodes.length === 0) {
    return (
      <div style={{ padding: 16, color: 'var(--text-tertiary)', fontSize: 13 }}>
        No architecture nodes defined.
      </div>
    );
  }

  return (
    <div className={`flow-container${fullHeight ? ' flow-container-full' : ''}`}>
      <ReactFlow
        nodes={nodes}
        edges={edges}
        nodeTypes={nodeTypes}
        onNodeClick={onNodeClick}
        defaultViewport={DEFAULT_VIEWPORT}
        fitView
        fitViewOptions={{ padding: 0.3 }}
        minZoom={0.5}
        maxZoom={2}
        proOptions={{ hideAttribution: true }}
      >
        <Background gap={20} size={1} />
        <Controls />
        <MiniMap
          nodeStrokeWidth={3}
          pannable
          zoomable
        />
      </ReactFlow>
    </div>
  );
}
