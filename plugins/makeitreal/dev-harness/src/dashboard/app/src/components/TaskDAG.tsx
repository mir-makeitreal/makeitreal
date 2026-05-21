import React, { useCallback, useEffect, useMemo, useState } from 'react';
import ELK, { type ElkNode, type ElkExtendedEdge } from 'elkjs/lib/elk.bundled.js';
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

// ── Layout: ELK.js layered (Sugiyama) ──

const elk = new ELK();

const ELK_DAG_OPTIONS = {
  'elk.algorithm': 'layered',
  'elk.direction': 'DOWN',
  'elk.layered.spacing.nodeNodeBetweenLayers': '120',
  'elk.spacing.nodeNode': '60',
  'elk.layered.nodePlacement.strategy': 'BRANDES_KOEPF',
  'elk.layered.crossingMinimization.strategy': 'LAYER_SWEEP',
  'elk.edgeRouting': 'ORTHOGONAL',
  'elk.padding': '[top=40,left=40,bottom=40,right=40]',
};

async function buildDagLayout(workItems: WorkItem[]): Promise<WorkItemFlowNode[]> {
  const idSet = new Set(workItems.map(wi => wi.id));
  const elkEdges: ElkExtendedEdge[] = [];
  let edgeCounter = 0;
  for (const wi of workItems) {
    for (const dep of wi.dependsOn) {
      if (idSet.has(dep)) {
        elkEdges.push({
          id: `de${edgeCounter++}`,
          sources: [dep],
          targets: [wi.id],
        });
      }
    }
  }

  const graph: ElkNode = {
    id: 'root',
    layoutOptions: ELK_DAG_OPTIONS,
    children: workItems.map(wi => ({
      id: wi.id,
      width: WORK_ITEM_NODE_WIDTH,
      height: WORK_ITEM_NODE_HEIGHT,
    })),
    edges: elkEdges,
  };

  const laidOut = await elk.layout(graph);
  const positionMap = new Map<string, { x: number; y: number }>();
  for (const child of laidOut.children ?? []) {
    positionMap.set(child.id, { x: child.x ?? 0, y: child.y ?? 0 });
  }

  return workItems.map((wi, i) => {
    const pos = positionMap.get(wi.id) ?? { x: i * (WORK_ITEM_NODE_WIDTH + 100), y: 0 };
    return {
      id: wi.id,
      type: 'workItem',
      position: pos,
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
    };
  });
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
  fullHeight?: boolean;
}

export function TaskDAG({ workItems, fullHeight = false }: Props) {
  const selectNode = useDashboardStore(s => s.selectNode);

  const [nodes, setNodes] = useState<WorkItemFlowNode[]>([]);
  const edges = useMemo(() => buildDagEdges(workItems), [workItems]);

  useEffect(() => {
    let cancelled = false;
    buildDagLayout(workItems).then(result => {
      if (!cancelled) setNodes(result);
    }).catch(err => {
      console.warn('ELK DAG layout failed, falling back to grid', err);
      if (!cancelled) {
        setNodes(workItems.map((wi, i) => ({
          id: wi.id,
          type: 'workItem',
          position: { x: (i % 3) * (WORK_ITEM_NODE_WIDTH + 100), y: Math.floor(i / 3) * (WORK_ITEM_NODE_HEIGHT + 80) },
          style: { minWidth: WORK_ITEM_NODE_MIN_WIDTH, width: WORK_ITEM_NODE_WIDTH },
          data: { workItemId: wi.id, title: wi.title, lane: wi.lane, isBlocked: wi.isBlocked },
        })));
      }
    });
    return () => { cancelled = true; };
  }, [workItems]);

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
      </ReactFlow>
    </div>
  );
}
