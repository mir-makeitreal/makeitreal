import React, { useCallback, useMemo } from 'react';
import Dagre from '@dagrejs/dagre';
import {
  ReactFlow,
  Background,
  Controls,
  Handle,
  Position,
  type Node as ReactFlowNode,
  type Edge,
  type NodeProps,
  type NodeMouseHandler,
} from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import type { WorkItem, WorkItemFlowNodeData } from '../types/model';
import { useDashboardStore } from '../store/dashboard-store';

// ── Custom Work Item Node ──

type WorkItemFlowNode = ReactFlowNode<WorkItemFlowNodeData, 'workItem'>;

const DEFAULT_VIEWPORT = { x: 0, y: 0, zoom: 1.0 };
const WORK_ITEM_NODE_WIDTH = 400;
const WORK_ITEM_NODE_HEIGHT = 110;
const WORK_ITEM_NODE_MIN_WIDTH = 360;

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
      <div className="node-id">{data.workItemId}</div>
      {data.isBlocked && (
        <div style={{ fontSize: 11, color: 'var(--accent-red)', marginTop: 4 }}>⚠ Blocked</div>
      )}
      <Handle type="source" position={Position.Bottom} />
    </div>
  );
}

const nodeTypes = { workItem: WorkItemNode };

// ── Layout: dagre hierarchy ──

function buildDagNodes(workItems: WorkItem[]): WorkItemFlowNode[] {
  const g = new Dagre.graphlib.Graph().setDefaultEdgeLabel(() => ({}));
  g.setGraph({ rankdir: 'TB', nodesep: 150, ranksep: 200, marginx: 40, marginy: 40 });
  const idSet = new Set(workItems.map(wi => wi.id));

  workItems.forEach(wi => {
    g.setNode(wi.id, {
      width: WORK_ITEM_NODE_WIDTH,
      height: WORK_ITEM_NODE_HEIGHT,
    });

    wi.dependsOn.forEach(dep => {
      if (idSet.has(dep)) {
        g.setEdge(dep, wi.id);
      }
    });
  });

  Dagre.layout(g);
  const graph = g.graph();
  const centerOffset = {
    x: (graph.width ?? 0) / 2,
    y: (graph.height ?? 0) / 2,
  };

  return workItems.map((wi, i) => ({
    id: wi.id,
    type: 'workItem',
    position: getNodePosition(g.node(wi.id), centerOffset, i),
    style: {
      minWidth: WORK_ITEM_NODE_MIN_WIDTH,
      width: WORK_ITEM_NODE_WIDTH,
    },
    data: {
      workItemId: wi.id,
      title: wi.title,
      lane: wi.lane,
      isBlocked: wi.isBlocked,
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
      x: index * (WORK_ITEM_NODE_WIDTH + 150) - centerOffset.x,
      y: -centerOffset.y,
    };
  }

  return {
    x: node.x - centerOffset.x - WORK_ITEM_NODE_WIDTH / 2,
    y: node.y - centerOffset.y - WORK_ITEM_NODE_HEIGHT / 2,
  };
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
        fitViewOptions={{ padding: 0.3 }}
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
