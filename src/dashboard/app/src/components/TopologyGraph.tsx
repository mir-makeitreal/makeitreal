import React, { useCallback, useMemo } from 'react';
import {
  ReactFlow,
  Background,
  Controls,
  MiniMap,
  Handle,
  Position,
  type Node,
  type Edge,
  type NodeProps,
  type NodeMouseHandler,
} from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import type { ArchNode, ArchEdge, ModuleFlowNodeData } from '../types/model';
import { useDashboardStore } from '../store/dashboard-store';

// ── Custom Module Node ──

type ModuleFlowNode = Node<ModuleFlowNodeData, 'module'>;

function ModuleNode({ data, selected }: NodeProps<ModuleFlowNode>) {
  const sel = useDashboardStore(s => s.selection);
  const isHighlighted = sel.nodeId === data.nodeId || sel.relatedModuleIds.includes(data.nodeId);

  return (
    <div className={`module-node ${selected || isHighlighted ? 'selected' : ''}`}>
      <Handle type="target" position={Position.Left} />
      <div className="node-label">{data.label}</div>
      {data.responsibilityUnitId && (
        <div className="node-sub">{data.responsibilityUnitId}</div>
      )}
      <Handle type="source" position={Position.Right} />
    </div>
  );
}

const nodeTypes = { module: ModuleNode };

const GRAPH_BASE_X = 100;
const GRAPH_BASE_Y = 100;
const GRAPH_X_SPACING = 400;
const GRAPH_Y_SPACING = 250;
const GRAPH_COLUMNS = 2;
const GRAPH_ROW_OFFSET = GRAPH_X_SPACING / 2;
const DEFAULT_VIEWPORT = { x: 0, y: 0, zoom: 1.0 };

// ── Auto-layout: staggered grid ──

function autoLayout(archNodes: ArchNode[]): ModuleFlowNode[] {
  return archNodes.map((n, i) => ({
    id: n.id,
    type: 'module',
    position: {
      x: GRAPH_BASE_X + (i % GRAPH_COLUMNS) * GRAPH_X_SPACING + (Math.floor(i / GRAPH_COLUMNS) % 2) * GRAPH_ROW_OFFSET,
      y: GRAPH_BASE_Y + Math.floor(i / GRAPH_COLUMNS) * GRAPH_Y_SPACING,
    },
    data: {
      label: n.label,
      nodeId: n.id,
      responsibilityUnitId: n.responsibilityUnitId ?? null,
    },
  }));
}

function buildEdges(archEdges: ArchEdge[]): Edge[] {
  return archEdges.map((e, i) => ({
    id: `edge-${i}`,
    source: e.from,
    target: e.to,
    label: e.contractId ?? undefined,
    style: { stroke: 'var(--rf-edge)' },
    labelStyle: { fontSize: 10, fill: 'var(--text-secondary)' },
    animated: true,
    type: 'smoothstep',
  }));
}

interface Props {
  nodes: ArchNode[];
  edges: ArchEdge[];
}

export function TopologyGraph({ nodes: archNodes, edges: archEdges }: Props) {
  const selectNode = useDashboardStore(s => s.selectNode);

  const nodes = useMemo(() => autoLayout(archNodes), [archNodes]);
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
    <div className="flow-container">
      <ReactFlow
        nodes={nodes}
        edges={edges}
        nodeTypes={nodeTypes}
        onNodeClick={onNodeClick}
        defaultViewport={DEFAULT_VIEWPORT}
        fitView
        fitViewOptions={{ padding: 0.2, maxZoom: 1.0 }}
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
