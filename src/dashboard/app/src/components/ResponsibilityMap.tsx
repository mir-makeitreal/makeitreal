import React, { useState } from 'react';
import type { Boundary, ModuleInterface } from '../types/model';

export interface ResponsibilityMapProps {
  boundaries: Boundary[];
  moduleInterfaces: ModuleInterface[];
  onSelectModule?: (moduleId: string) => void;
  selectedModuleId?: string | null;
}

export function ResponsibilityMap({
  boundaries,
  moduleInterfaces,
  onSelectModule,
  selectedModuleId,
}: ResponsibilityMapProps) {
  const [expandedModules, setExpandedModules] = useState<Set<string>>(new Set());

  function toggleExpand(moduleId: string) {
    setExpandedModules(prev => {
      const next = new Set(prev);
      if (next.has(moduleId)) next.delete(moduleId);
      else next.add(moduleId);
      return next;
    });
  }

  // Map boundaries by responsibilityUnitId for quick lookup
  const boundaryMap = new Map(boundaries.map(b => [b.responsibilityUnitId, b]));

  if (moduleInterfaces.length === 0 && boundaries.length === 0) {
    return (
      <div style={{ padding: 16, color: 'var(--text-tertiary)', fontSize: 13 }}>
        No responsibility boundaries defined.
      </div>
    );
  }

  return (
    <div className="responsibility-map" style={{ padding: 12 }}>
      {moduleInterfaces.map(mod => {
        const boundary = boundaryMap.get(mod.responsibilityUnitId);
        const isSelected = selectedModuleId === mod.responsibilityUnitId;
        const isExpanded = expandedModules.has(mod.responsibilityUnitId);

        return (
          <div
            key={mod.responsibilityUnitId}
            className={`responsibility-unit ${isSelected ? 'selected' : ''}`}
            style={{
              marginBottom: 8,
              border: `1px solid ${isSelected ? 'var(--accent-blue)' : 'var(--border-primary)'}`,
              borderRadius: 6,
              background: isSelected ? 'var(--bg-selected, rgba(59,130,246,0.08))' : 'var(--bg-secondary)',
              cursor: 'pointer',
            }}
            onClick={() => onSelectModule?.(mod.responsibilityUnitId)}
          >
            <div
              style={{
                padding: '8px 12px',
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'center',
              }}
            >
              <div>
                <div style={{ fontWeight: 600, fontSize: 13 }}>{mod.moduleName}</div>
                <div style={{ fontSize: 11, color: 'var(--text-tertiary)' }}>
                  {mod.owner} — {mod.purpose}
                </div>
              </div>
              <button
                onClick={e => { e.stopPropagation(); toggleExpand(mod.responsibilityUnitId); }}
                style={{
                  background: 'none',
                  border: 'none',
                  cursor: 'pointer',
                  fontSize: 12,
                  color: 'var(--text-secondary)',
                }}
              >
                {isExpanded ? '▼' : '▶'}
              </button>
            </div>

            {isExpanded && (
              <div style={{ padding: '0 12px 8px', fontSize: 12 }}>
                {mod.owns.length > 0 && (
                  <div style={{ marginBottom: 4 }}>
                    <strong>Owns:</strong>
                    <ul style={{ margin: '2px 0', paddingLeft: 16 }}>
                      {mod.owns.map((p, i) => (
                        <li key={i} style={{ color: 'var(--text-secondary)' }}>{p}</li>
                      ))}
                    </ul>
                  </div>
                )}
                {boundary && boundary.mayUseContracts.length > 0 && (
                  <div style={{ marginBottom: 4 }}>
                    <strong>Contracts:</strong>
                    <ul style={{ margin: '2px 0', paddingLeft: 16 }}>
                      {boundary.mayUseContracts.map((c, i) => (
                        <li key={i} style={{ color: 'var(--text-secondary)' }}>{c}</li>
                      ))}
                    </ul>
                  </div>
                )}
                {mod.publicSurfaces.length > 0 && (
                  <div>
                    <strong>Public Surfaces:</strong>
                    <ul style={{ margin: '2px 0', paddingLeft: 16 }}>
                      {mod.publicSurfaces.map((s, i) => (
                        <li key={i} style={{ color: 'var(--text-secondary)' }}>
                          {s.name} ({s.kind})
                        </li>
                      ))}
                    </ul>
                  </div>
                )}
              </div>
            )}
          </div>
        );
      })}

      {/* Show orphan boundaries not linked to any module interface */}
      {boundaries
        .filter(b => !moduleInterfaces.some(m => m.responsibilityUnitId === b.responsibilityUnitId))
        .map(b => (
          <div
            key={b.responsibilityUnitId}
            style={{
              marginBottom: 8,
              padding: '8px 12px',
              border: '1px dashed var(--border-primary)',
              borderRadius: 6,
              fontSize: 12,
              color: 'var(--text-tertiary)',
            }}
          >
            <strong>{b.responsibilityUnitId}</strong> (boundary only)
            {b.owns.length > 0 && (
              <div style={{ marginTop: 2 }}>owns: {b.owns.join(', ')}</div>
            )}
          </div>
        ))}
    </div>
  );
}
