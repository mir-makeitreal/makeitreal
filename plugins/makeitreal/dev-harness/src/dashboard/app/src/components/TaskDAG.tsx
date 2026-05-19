import React, { useCallback, useMemo } from 'react';
import {
  ReactFlow,
  Background,
  Controls,
  Handle,
  Position,
  type Node,
  type Edge,
  type NodeProps,
  type NodeMouseHandler,
} from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import type { WorkItem, WorkItemFlowNodeData } from '../types/model';
import { useDashboardStore } from '../store/dashboard-store';

// ── Custom Work Item Node ──

type WorkItemFlowNode = Node<WorkItemFlowNodeData, 'workItem'>;

const DAG_BASE_X = 100;
const DAG_BASE_Y = 100;
const DAG_X_SPACING = 400;
const DAG_Y_SPACING = 250;
const DAG_ROW_OFFSET = DAG_X_SPACING / 2;
const DEFAULT_VIEWPORT = { x: 0, y: 0, zoom: 1.0 };

function laneStatusClass(lane: string, isBlocked: boolean): string {
  if (isBlocked || lane === 'Blocked') return 'status-blocked';

  switch (lane) {
    case 'Done':
      return 'status-done';
    case 'Ready':
      return 'status-ready';
    case 'Running':
    case 'In-Progress':
      return 'status-running';
    case 'Contract Frozen':
      return 'status-contract-frozen';
    default:
      return 'status-unknown';
  }
}

function WorkItemNode({ data, selected }: NodeProps<WorkItemFlowNode>) {
  const sel = useDashboardStore(s => s.selection);
  const isHighlighted = sel.nodeId === data.workItemId || sel.relatedWorkItemIds.includes(data.workItemId);
  const statusClass = laneStatusClass(data.lane, data.isBlocked);

  return (
    <div className={`work-item-node ${statusClass} ${selected || isHighlighted ? 'selected' : ''}`}>
      <Handle type="target" position={Position.Top} />
      <div className={`lane-badge ${data.lane?.replace(/\s+/g, '')}`}>{data.lane}</div>
      <div className="node-title">{data.title}</div>
      {data.isBlocked && (
        <div style={{ fontSize: 10, color: 'var(--accent-red)', marginTop: 2 }}>⚠ Blocked</div>
      )}
      <Handle type="source" position={Position.Bottom} />
    </div>
  );
}

const nodeTypes = { workItem: WorkItemNode };

// ── Layout: topological layers ──

function buildDagNodes(workItems: WorkItem[]): WorkItemFlowNode[] {
  // Build dependency layers for Y positioning
  const byId = new Map(workItems.map(wi => [wi.id, wi]));
  const layers = new Map<string, number>();

  function getLayer(id: string, visited = new Set<string>()): number {
    if (layers.has(id)) return layers.get(id)!;
    if (visited.has(id)) return 0; // cycle guard
    visited.add(id);
    const wi = byId.get(id);
    if (!wi || wi.dependsOn.length === 0) {
      layers.set(id, 0);
      return 0;
    }
    const maxDep = Math.max(...wi.dependsOn.map(dep => getLayer(dep, visited)));
    const layer = maxDep + 1;
    layers.set(id, layer);
    return layer;
  }

  workItems.forEach(wi => getLayer(wi.id));

  // Group by layer
  const layerGroups = new Map<number, WorkItem[]>();
  workItems.forEach(wi => {
    const layer = layers.get(wi.id) ?? 0;
    if (!layerGroups.has(layer)) layerGroups.set(layer, []);
    layerGroups.get(layer)!.push(wi);
  });

  const nodes: WorkItemFlowNode[] = [];

  for (const [layer, items] of Array.from(layerGroups.entries()).sort(([a], [b]) => a - b)) {
    items.forEach((wi, colIdx) => {
      nodes.push({
        id: wi.id,
        type: 'workItem',
        position: {
          x: DAG_BASE_X + colIdx * DAG_X_SPACING + (layer % 2) * DAG_ROW_OFFSET,
          y: DAG_BASE_Y + layer * DAG_Y_SPACING,
        },
        data: {
          workItemId: wi.id,
          title: wi.title,
          lane: wi.lane,
          isBlocked: wi.isBlocked,
        },
      });
    });
  }

  return nodes;
}

function buildDagEdges(workItems: WorkItem[]): Edge[] {
  const edges: Edge[] = [];
  const idSet = new Set(workItems.map(wi => wi.id));
  workItems.forEach(wi => {
    wi.dependsOn.forEach((dep) => {
      if (!idSet.has(dep)) return;
      edges.push({
        id: `dag-${dep}-${wi.id}`,
        source: dep,
        target: wi.id,
        style: {
          stroke: wi.isBlocked ? 'var(--accent-red)' : 'var(--rf-edge)',
          strokeWidth: wi.isBlocked ? 2 : 1.5,
        },
        animated: true,
        type: 'smoothstep',
      });
    });
  });
  return edges;
}

interface Props {
  workItems: WorkItem[];
}

export function TaskDAG({ workItems }: Props) {
  const selectNode = useDashboardStore(s => s.selectNode);

  const nodes = useMemo(() => buildDagNodes(workItems), [workItems]);
  const edges = useMemo(() => buildDagEdges(workItems), [workItems]);

  const onNodeClick = useCallback<NodeMouseHandler<WorkItemFlowNode>>((_: React.MouseEvent, node) => {
    selectNode(node.id, 'workItem');
  }, [selectNode]);

  if (workItems.length === 0) {
    return (
      <div style={{ padding: 16, color: 'var(--text-tertiary)', fontSize: 13 }}>
        No work items on the board.
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
      </ReactFlow>
    </div>
  );
}
