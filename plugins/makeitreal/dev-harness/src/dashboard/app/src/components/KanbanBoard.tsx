import React, { useState } from 'react';
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

function WorkItemCard({
  item,
  isSelected,
  onClick,
}: {
  item: WorkItem;
  isSelected: boolean;
  onClick: () => void;
}) {
  return (
    <div
      className={`kanban-card ${isSelected ? 'selected' : ''}`}
      onClick={onClick}
      style={{
        padding: '10px 12px',
        marginBottom: 8,
        background: isSelected ? 'var(--bg-elevated)' : 'var(--bg-primary)',
        border: `1px solid ${isSelected ? 'var(--accent-blue)' : 'var(--border-secondary)'}`,
        borderRadius: 8,
        cursor: 'pointer',
        fontSize: 12,
        transition: 'all 0.15s ease',
        boxShadow: isSelected ? '0 0 0 1px var(--accent-blue)' : 'var(--shadow-sm)',
      }}
      onMouseOver={e => {
        if (!isSelected) {
          e.currentTarget.style.borderColor = 'var(--border-primary)';
          e.currentTarget.style.background = 'var(--bg-elevated)';
        }
      }}
      onMouseOut={e => {
        if (!isSelected) {
          e.currentTarget.style.borderColor = 'var(--border-secondary)';
          e.currentTarget.style.background = 'var(--bg-primary)';
        }
      }}
    >
      <div style={{
        fontWeight: 600,
        marginBottom: 4,
        color: 'var(--text-primary)',
        lineHeight: 1.3,
      }}>{item.title}</div>
      <div style={{
        color: 'var(--text-tertiary)',
        fontSize: 10,
        fontFamily: 'var(--font-mono)',
        marginBottom: 4,
      }}>
        {item.id}
      </div>
      <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
        {item.isBlocked && (
          <span style={{
            color: 'var(--accent-red)',
            fontSize: 10,
            background: 'rgba(248, 81, 73, 0.1)',
            padding: '1px 6px',
            borderRadius: 4,
            fontWeight: 500,
          }}>● blocked</span>
        )}
        {item.isRetryReady && (
          <span style={{
            color: 'var(--accent-yellow)',
            fontSize: 10,
            background: 'rgba(210, 153, 34, 0.1)',
            padding: '1px 6px',
            borderRadius: 4,
            fontWeight: 500,
          }}>↻ retry</span>
        )}
        {item.isRework && (
          <span style={{
            color: 'var(--accent-purple)',
            fontSize: 10,
            background: 'rgba(188, 140, 255, 0.1)',
            padding: '1px 6px',
            borderRadius: 4,
            fontWeight: 500,
          }}>✎ rework</span>
        )}
        {item.attemptNumber != null && item.attemptNumber > 1 && (
          <span style={{
            color: 'var(--text-tertiary)',
            fontSize: 10,
            background: 'var(--bg-tertiary)',
            padding: '1px 6px',
            borderRadius: 4,
          }}>attempt #{item.attemptNumber}</span>
        )}
      </div>
      {item.dependsOn.length > 0 && (
        <div style={{
          color: 'var(--text-tertiary)',
          fontSize: 10,
          marginTop: 6,
          paddingTop: 6,
          borderTop: '1px solid var(--border-secondary)',
        }}>
          <span style={{ fontWeight: 500 }}>deps:</span>{' '}
          {item.dependsOn.map((dep, i) => (
            <span key={dep}>
              {i > 0 && ', '}
              <span style={{ fontFamily: 'var(--font-mono)' }}>{dep.split('/').pop()}</span>
            </span>
          ))}
        </div>
      )}
    </div>
  );
}

export function KanbanBoard({ board, onSelectWorkItem, selectedWorkItemId }: KanbanBoardProps) {
  const [showEmpty, setShowEmpty] = useState(false);

  if (!board || !board.lanes || board.lanes.length === 0) {
    return (
      <div style={{ padding: 16, color: 'var(--text-tertiary)', fontSize: 13 }}>
        No board data available.
      </div>
    );
  }

  const visibleLanes = showEmpty ? board.lanes : board.lanes.filter(l => l.workItems.length > 0);
  const hiddenCount = board.lanes.length - visibleLanes.length;

  return (
    <div>
      {hiddenCount > 0 && (
        <div style={{
          padding: '6px 12px',
          display: 'flex',
          justifyContent: 'flex-end',
        }}>
          <button
            onClick={() => setShowEmpty(!showEmpty)}
            style={{
              background: 'none',
              border: 'none',
              cursor: 'pointer',
              color: 'var(--text-tertiary)',
              fontSize: 11,
              padding: '2px 8px',
            }}
          >
            {showEmpty ? 'Hide' : 'Show'} {hiddenCount} empty lane{hiddenCount !== 1 ? 's' : ''}
          </button>
        </div>
      )}
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
                  isSelected={selectedWorkItemId === item.id}
                  onClick={() => onSelectWorkItem?.(item.id)}
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
