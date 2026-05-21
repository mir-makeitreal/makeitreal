import React, { useCallback, useEffect, useMemo, useState } from 'react';
import ELK, { type ElkNode, type ElkExtendedEdge } from 'elkjs/lib/elk.bundled.js';
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

// ── Auto-layout: ELK.js layered (Sugiyama) ──

const elk = new ELK();

const ELK_LAYERED_OPTIONS = {
  'elk.algorithm': 'layered',
  'elk.direction': 'DOWN',
  'elk.layered.spacing.nodeNodeBetweenLayers': '120',
  'elk.spacing.nodeNode': '80',
  'elk.layered.nodePlacement.strategy': 'BRANDES_KOEPF',
  'elk.layered.crossingMinimization.strategy': 'LAYER_SWEEP',
  'elk.edgeRouting': 'ORTHOGONAL',
  'elk.padding': '[top=40,left=40,bottom=40,right=40]',
};

async function elkLayout(
  archNodes: ArchNode[],
  archEdges: ArchEdge[]
): Promise<ModuleFlowNode[]> {
  const graph: ElkNode = {
    id: 'root',
    layoutOptions: ELK_LAYERED_OPTIONS,
    children: archNodes.map(n => ({
      id: n.id,
      width: MODULE_NODE_WIDTH,
      height: MODULE_NODE_HEIGHT,
    })),
    edges: archEdges.map((e, i): ElkExtendedEdge => ({
      id: `e${i}`,
      sources: [e.from],
      targets: [e.to],
    })),
  };

  const laidOut = await elk.layout(graph);
  const positionMap = new Map<string, { x: number; y: number }>();
  for (const child of laidOut.children ?? []) {
    positionMap.set(child.id, { x: child.x ?? 0, y: child.y ?? 0 });
  }

  return archNodes.map((n, i) => {
    const pos = positionMap.get(n.id) ?? { x: i * (MODULE_NODE_WIDTH + 100), y: 0 };
    return {
      id: n.id,
      type: 'module',
      position: pos,
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
    };
  });
}

function buildEdges(archEdges: ArchEdge[]): Edge[] {
  return archEdges.map((e, i) => ({
    id: `edge-${i}`,
    source: e.from,
    target: e.to,
    label: e.contractId ?? undefined,
    style: {
      stroke: 'var(--rf-edge)',
      strokeWidth: 1.75,
    },
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

  const [nodes, setNodes] = useState<ModuleFlowNode[]>([]);
  const edges = useMemo(() => buildEdges(archEdges), [archEdges]);

  useEffect(() => {
    let cancelled = false;
    elkLayout(archNodes, archEdges).then(result => {
      if (!cancelled) setNodes(result);
    }).catch(err => {
      console.warn('ELK layout failed, falling back to grid', err);
      if (!cancelled) {
        setNodes(archNodes.map((n, i) => ({
          id: n.id,
          type: 'module',
          position: { x: (i % 3) * (MODULE_NODE_WIDTH + 100), y: Math.floor(i / 3) * (MODULE_NODE_HEIGHT + 80) },
          style: { minWidth: MODULE_NODE_MIN_WIDTH, minHeight: MODULE_NODE_MIN_HEIGHT, width: MODULE_NODE_WIDTH },
          data: {
            label: n.label,
            nodeId: n.id,
            responsibilityUnitId: n.responsibilityUnitId ?? null,
            moduleType: archNodeModuleType(n),
          },
        })));
      }
    });
    return () => { cancelled = true; };
  }, [archNodes, archEdges]);

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
