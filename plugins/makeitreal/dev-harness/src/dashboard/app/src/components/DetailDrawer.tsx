import React from 'react';
import type { PreviewModel, SelectionState } from '../types/model';

export interface DetailDrawerProps {
  selection: SelectionState;
  model: PreviewModel;
  onClose: () => void;
}

export function DetailDrawer({ selection, model, onClose }: DetailDrawerProps) {
  if (!selection.nodeId || !selection.nodeType) {
    return null;
  }

  const detail = getDetail(selection, model);

  return (
    <div
      className="detail-drawer"
      style={{
        position: 'fixed',
        top: 0,
        right: 0,
        width: 360,
        height: '100vh',
        background: 'var(--bg-primary)',
        borderLeft: '1px solid var(--border-primary)',
        boxShadow: '-4px 0 12px rgba(0,0,0,0.15)',
        zIndex: 1000,
        display: 'flex',
        flexDirection: 'column',
        overflow: 'hidden',
      }}
    >
      {/* Header */}
      <div
        style={{
          padding: '12px 16px',
          borderBottom: '1px solid var(--border-primary)',
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
        }}
      >
        <div>
          <div style={{ fontSize: 14, fontWeight: 600 }}>{detail.title}</div>
          <div style={{ fontSize: 11, color: 'var(--text-tertiary)' }}>
            {selection.nodeType} — {selection.nodeId}
          </div>
        </div>
        <button
          onClick={onClose}
          style={{
            background: 'none',
            border: 'none',
            cursor: 'pointer',
            fontSize: 16,
            color: 'var(--text-primary)',
            padding: '4px 8px',
          }}
          aria-label="Close detail drawer"
        >
          ✕
        </button>
      </div>

      {/* Content */}
      <div style={{ flex: 1, overflow: 'auto', padding: 16, fontSize: 12 }}>
        {detail.sections.map((section, i) => (
          <div key={i} style={{ marginBottom: 16 }}>
            <div style={{ fontWeight: 600, fontSize: 13, marginBottom: 6 }}>
              {section.heading}
            </div>
            {section.items.map((item, j) => (
              <div
                key={j}
                style={{
                  padding: '4px 0',
                  borderBottom: '1px solid var(--border-primary)',
                  color: 'var(--text-secondary)',
                }}
              >
                {item}
              </div>
            ))}
            {section.items.length === 0 && (
              <div style={{ color: 'var(--text-tertiary)', fontStyle: 'italic' }}>None</div>
            )}
          </div>
        ))}
      </div>

      {/* Footer: Related items */}
      <div
        style={{
          padding: '8px 16px',
          borderTop: '1px solid var(--border-primary)',
          fontSize: 11,
          color: 'var(--text-tertiary)',
        }}
      >
        {selection.relatedModuleIds.length > 0 && (
          <div>Related modules: {selection.relatedModuleIds.join(', ')}</div>
        )}
        {selection.relatedContractIds.length > 0 && (
          <div>Related contracts: {selection.relatedContractIds.join(', ')}</div>
        )}
        {selection.relatedWorkItemIds.length > 0 && (
          <div>Related work items: {selection.relatedWorkItemIds.join(', ')}</div>
        )}
      </div>
    </div>
  );
}

interface DetailSection {
  heading: string;
  items: string[];
}

interface DetailInfo {
  title: string;
  sections: DetailSection[];
}

function getDetail(selection: SelectionState, model: PreviewModel): DetailInfo {
  const { nodeId, nodeType } = selection;

  if (nodeType === 'module') {
    const mod = model.blueprint.moduleInterfaces.find(m => m.responsibilityUnitId === nodeId);
    if (mod) {
      return {
        title: mod.moduleName,
        sections: [
          { heading: 'Purpose', items: mod.purpose ? [mod.purpose] : [] },
          { heading: 'Owner', items: mod.owner ? [mod.owner] : [] },
          { heading: 'Owned Paths', items: mod.owns },
          {
            heading: 'Public Surfaces',
            items: mod.publicSurfaces.map(s => `${s.name} (${s.kind}): ${s.description}`),
          },
          {
            heading: 'Imports',
            items: mod.imports.map(
              i => `${i.surface} from ${i.providerResponsibilityUnitId} [${i.contractId}]`
            ),
          },
        ],
      };
    }
    const node = model.blueprint.architecture.nodes.find(n => n.id === nodeId);
    return {
      title: node?.label ?? nodeId!,
      sections: [{ heading: 'Architecture Node', items: [nodeId!] }],
    };
  }

  if (nodeType === 'workItem') {
    const allWorkItems = model.board?.lanes?.flatMap(l => l.workItems) ?? [];
    const wi = allWorkItems.find(w => w.id === nodeId);
    if (wi) {
      return {
        title: wi.title,
        sections: [
          { heading: 'Lane', items: [wi.lane] },
          { heading: 'Module', items: wi.responsibilityUnitId ? [wi.responsibilityUnitId] : [] },
          { heading: 'Dependencies', items: wi.dependsOn },
          { heading: 'Allowed Paths', items: wi.allowedPaths },
          { heading: 'Contracts', items: wi.contractIds },
          {
            heading: 'Status',
            items: [
              wi.isBlocked ? 'Blocked' : '',
              wi.isRetryReady ? 'Retry Ready' : '',
              wi.isRework ? 'Rework' : '',
              wi.attemptNumber != null ? `Attempt #${wi.attemptNumber}` : '',
            ].filter(Boolean),
          },
        ],
      };
    }
  }

  if (nodeType === 'contract') {
    const c = model.blueprint.contracts.find(c => c.contractId === nodeId);
    if (c) {
      return {
        title: c.contractId ?? 'Unspecified contract',
        sections: [
          { heading: 'Kind', items: [c.kind] },
          { heading: 'Path', items: c.path ? [c.path] : [] },
          { heading: 'Reason', items: c.reason ? [c.reason] : [] },
        ],
      };
    }
  }

  return {
    title: nodeId ?? 'Unknown',
    sections: [{ heading: 'Details', items: ['No additional details available.'] }],
  };
}
