import React, { useMemo, useState } from 'react';
import { useDashboardStore } from '../store/dashboard-store';
import type { Board, WorkItem } from '../types/model';

export interface KanbanBoardProps {
  board: Board | null;
  onSelectWorkItem?: (workItemId: string) => void;
  selectedWorkItemId?: string | null;
}

const LANE_COLORS: Record<string, string> = {
  Ready: 'var(--accent-blue, #3b82f6)',
  'In-Progress': 'var(--accent-yellow, #f59e0b)',
  Review: 'var(--accent-purple, #a855f7)',
  Done: 'var(--accent-green, #22c55e)',
  Blocked: 'var(--accent-red, #ef4444)',
};

const LANE_ICONS: Record<string, string> = {
  Ready: '📋',
  'In-Progress': '⚡',
  Review: '👁️',
  Done: '✅',
  Blocked: '🚫',
};

function laneColor(laneName: string): string {
  return LANE_COLORS[laneName] ?? 'var(--border-primary)';
}

function laneClass(laneName: string): string {
  return laneName.replace(/[^a-zA-Z0-9]/g, '');
}

function shortWorkItemId(id: string) {
  return id.split('/').pop() ?? id;
}

function workItemStatusLabel(item: WorkItem) {
  if (item.isBlocked) return 'Blocked';
  if (item.isRetryReady) return 'Retry Ready';
  if (item.isRework) return 'Rework';
  if (item.claim) return 'Claimed';
  return item.lane;
}

function WorkItemCard({
  item,
  isSelected,
  onClick,
}: {
  item: WorkItem;
  isSelected: boolean;
  onClick: () => void;
}) {
  const contractCount = item.contractIds?.length ?? 0;
  const statusLabel = workItemStatusLabel(item);
  const laneClassName = laneClass(item.lane);

  return (
    <button
      type="button"
      className={`kanban-card ${isSelected ? 'selected' : ''}`}
      onClick={onClick}
      aria-pressed={isSelected}
      aria-label={`Open details for ${item.title}`}
    >
      <div className="kanban-card__topline">
        <span className={`kanban-card__status lane-${laneClassName}`}>
          {statusLabel}
        </span>
        <span className="kanban-card__contracts">
          {contractCount} contract{contractCount === 1 ? '' : 's'}
        </span>
      </div>
      <div className="kanban-card__title" title={item.title}>{item.title}</div>
      <div className="kanban-card__id">{shortWorkItemId(item.id)}</div>
      <div className="kanban-card__tags">
        {item.isBlocked && (
          <span className="kanban-card__tag kanban-card__tag--blocked">blocked</span>
        )}
        {item.isRetryReady && (
          <span className="kanban-card__tag kanban-card__tag--retry">retry</span>
        )}
        {item.isRework && (
          <span className="kanban-card__tag kanban-card__tag--rework">rework</span>
        )}
        {item.attemptNumber != null && item.attemptNumber > 1 && (
          <span className="kanban-card__tag">attempt #{item.attemptNumber}</span>
        )}
      </div>
      {item.dependsOn.length > 0 && (
        <div className="kanban-card__deps">
          <span>deps:</span>{' '}
          {item.dependsOn.map((dep, i) => (
            <span key={dep}>
              {i > 0 && ', '}
              <span>{shortWorkItemId(dep)}</span>
            </span>
          ))}
        </div>
      )}
    </button>
  );
}

export function KanbanBoard({ board, onSelectWorkItem, selectedWorkItemId }: KanbanBoardProps) {
  const [showEmpty, setShowEmpty] = useState(false);
  const selectNode = useDashboardStore(s => s.selectNode);
  const selection = useDashboardStore(s => s.selection);
  const allWorkItems = useMemo(() => board?.lanes?.flatMap(lane => lane.workItems) ?? [], [board]);
  const totalItems = allWorkItems.length;
  const doneItems = allWorkItems.filter(item => item.lane === 'Done').length;
  const donePercent = totalItems === 0 ? 0 : Math.round((doneItems / totalItems) * 100);

  if (!board || !board.lanes || board.lanes.length === 0) {
    return (
      <div style={{ padding: 16, color: 'var(--text-tertiary)', fontSize: 13 }}>
        No board data available.
      </div>
    );
  }

  const visibleLanes = showEmpty ? board.lanes : board.lanes.filter(l => l.workItems.length > 0);
  const hiddenCount = board.lanes.length - visibleLanes.length;
  const selectedId = selectedWorkItemId ?? (selection.nodeType === 'workItem' ? selection.nodeId : null);

  return (
    <div>
      <div className="kanban-summary">
        <div>
          <div className="kanban-summary__title">Board Progress</div>
          <div className="kanban-summary__meta">
            {doneItems} done / {totalItems} total
          </div>
        </div>
        <div className="kanban-summary__meter">
          <div
            className="kanban-summary__progress"
            role="progressbar"
            aria-valuenow={donePercent}
            aria-valuemin={0}
            aria-valuemax={100}
            aria-label="Done work item progress"
          >
            <div className="kanban-summary__progress-bar" style={{ width: `${donePercent}%` }} />
          </div>
          <span>{donePercent}%</span>
        </div>
        {hiddenCount > 0 && (
          <button
            type="button"
            className="kanban-summary__toggle"
            onClick={() => setShowEmpty(!showEmpty)}
          >
            {showEmpty ? 'Hide' : 'Show'} {hiddenCount} empty lane{hiddenCount !== 1 ? 's' : ''}
          </button>
        )}
      </div>

      <div
        className="kanban-board"
        style={{
          display: 'flex',
          gap: 12,
          padding: 12,
          overflowX: 'auto',
          minHeight: 200,
        }}
      >
        {visibleLanes.map(lane => (
          <div
            key={lane.name}
            className="kanban-lane"
            style={{
              minWidth: 220,
              maxWidth: 320,
              flex: '1 0 220px',
              background: 'var(--bg-secondary)',
              borderRadius: 8,
              border: '1px solid var(--border-primary)',
              display: 'flex',
              flexDirection: 'column',
            }}
          >
            <div
              style={{
                padding: '10px 12px',
                fontWeight: 600,
                fontSize: 13,
                borderBottom: `2px solid ${laneColor(lane.name)}`,
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'center',
              }}
            >
              <span style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                <span style={{ fontSize: 14 }}>{LANE_ICONS[lane.name] ?? '📌'}</span>
                {lane.name}
              </span>
              <span
                style={{
                  fontSize: 11,
                  color: laneColor(lane.name),
                  background: 'var(--bg-primary)',
                  padding: '2px 8px',
                  borderRadius: 10,
                  fontWeight: 700,
                  minWidth: 22,
                  textAlign: 'center',
                }}
              >
                {lane.workItems.length}
              </span>
            </div>
            <div style={{ padding: 8, flex: 1, overflowY: 'auto', maxHeight: 400 }}>
              {lane.workItems.map(item => (
                <WorkItemCard
                  key={item.id}
                  item={item}
                  isSelected={selectedId === item.id}
                  onClick={() => {
                    if (onSelectWorkItem) {
                      onSelectWorkItem(item.id);
                    } else {
                      selectNode(item.id, 'workItem');
                    }
                  }}
                />
              ))}
              {lane.workItems.length === 0 && (
                <div style={{
                  padding: 16,
                  color: 'var(--text-tertiary)',
                  fontSize: 11,
                  textAlign: 'center',
                  fontStyle: 'italic',
                }}>
                  No items
                </div>
              )}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
