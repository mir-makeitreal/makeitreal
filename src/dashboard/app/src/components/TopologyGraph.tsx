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
} from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import type { ArchNode, ArchEdge } from '../types/model';
import { useDashboardStore } from '../store/dashboard-store';

// ── Custom Module Node ──

function ModuleNode({ data, selected }: { data: any; selected?: boolean }) {
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

// ── Auto-layout: simple horizontal ──

function autoLayout(archNodes: ArchNode[]): Node[] {
  const xSpacing = 320;
  const ySpacing = 160;
  const cols = Math.max(2, Math.ceil(Math.sqrt(archNodes.length)));

  return archNodes.map((n, i) => ({
    id: n.id,
    type: 'module',
    position: {
      x: (i % cols) * xSpacing + 40,
      y: Math.floor(i / cols) * ySpacing + 40,
    },
    data: {
      label: n.label,
      nodeId: n.id,
      responsibilityUnitId: n.responsibilityUnitId,
    },
  }));
}

function buildEdges(archEdges: ArchEdge[]): Edge[] {
  return archEdges.map((e, i) => ({
    id: `edge-${i}`,
    source: e.from,
    target: e.to,
    label: e.contractId,
    style: { stroke: 'var(--rf-edge)' },
    labelStyle: { fontSize: 10, fill: 'var(--text-secondary)' },
    animated: true,
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

  const onNodeClick = useCallback((_: React.MouseEvent, node: Node) => {
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
        fitView
        fitViewOptions={{ padding: 0.15, maxZoom: 1.5 }}
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
