import React, { useState } from 'react';
import type { ModuleInterface } from '../types/model';

interface Props {
  moduleInterfaces: ModuleInterface[];
}

function CollapsibleSection({ title, badge, children, defaultOpen = false }: {
  title: string;
  badge?: string;
  children: React.ReactNode;
  defaultOpen?: boolean;
}) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <div style={{ marginTop: 8 }}>
      <button
        onClick={() => setOpen(!open)}
        style={{
          background: 'none',
          border: 'none',
          cursor: 'pointer',
          display: 'flex',
          alignItems: 'center',
          gap: 6,
          width: '100%',
          padding: '4px 0',
          color: 'var(--text-secondary)',
          fontSize: 11,
          fontWeight: 600,
          textTransform: 'uppercase',
          letterSpacing: '0.5px',
        }}
      >
        <span style={{
          display: 'inline-block',
          transform: open ? 'rotate(90deg)' : 'rotate(0deg)',
          transition: 'transform 0.15s',
          fontSize: 10,
        }}>▶</span>
        {title}
        {badge && (
          <span style={{
            fontSize: 10,
            color: 'var(--text-tertiary)',
            background: 'var(--bg-tertiary)',
            padding: '1px 6px',
            borderRadius: 8,
            fontWeight: 400,
          }}>{badge}</span>
        )}
      </button>
      {open && <div style={{ paddingLeft: 16, paddingTop: 4 }}>{children}</div>}
    </div>
  );
}

export function ContractPanel({ moduleInterfaces }: Props) {
  if (moduleInterfaces.length === 0) {
    return (
      <div style={{ padding: 16, color: 'var(--text-tertiary)', fontSize: 13 }}>
        No module interfaces defined.
      </div>
    );
  }

  return (
    <div className="contract-panel">
      {moduleInterfaces.map((mod) => (
        <div key={mod.responsibilityUnitId} className="contract-item" style={{
          borderLeft: '3px solid var(--accent-blue)',
        }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}>
            <span className="contract-id" style={{ fontSize: 13, fontWeight: 700 }}>{mod.moduleName}</span>
            <span style={{
              fontSize: 10,
              color: 'var(--text-tertiary)',
              background: 'var(--bg-tertiary)',
              padding: '2px 8px',
              borderRadius: 10,
            }}>{mod.owner}</span>
          </div>
          <div style={{ fontSize: 12, color: 'var(--text-secondary)', marginBottom: 4 }}>
            {mod.purpose}
          </div>
          <div style={{
            fontSize: 11,
            color: 'var(--text-tertiary)',
            display: 'flex',
            flexWrap: 'wrap',
            gap: 4,
          }}>
            {mod.owns.map(path => (
              <span key={path} style={{
                background: 'var(--bg-tertiary)',
                padding: '1px 6px',
                borderRadius: 4,
                fontFamily: 'var(--font-mono)',
                fontSize: 10,
              }}>{path}</span>
            ))}
          </div>

          {mod.publicSurfaces.length > 0 && (
            <CollapsibleSection
              title="Public Surfaces"
              badge={String(mod.publicSurfaces.length)}
              defaultOpen={mod.publicSurfaces.length <= 3}
            >
              {mod.publicSurfaces.map((surface) => (
                <div key={surface.name} style={{
                  marginBottom: 10,
                  padding: '8px 10px',
                  background: 'var(--bg-tertiary)',
                  borderRadius: 6,
                }}>
                  <div style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: 6,
                    marginBottom: 4,
                  }}>
                    <span style={{
                      fontSize: 10,
                      fontWeight: 600,
                      textTransform: 'uppercase',
                      color: 'var(--accent-purple)',
                      background: 'rgba(188, 140, 255, 0.1)',
                      padding: '1px 6px',
                      borderRadius: 4,
                    }}>{surface.kind}</span>
                    <span style={{ fontWeight: 600, fontSize: 12, color: 'var(--accent-blue)' }}>
                      {surface.name}
                    </span>
                  </div>
                  <div style={{ fontSize: 11, color: 'var(--text-secondary)', marginBottom: 6 }}>
                    {surface.description}
                  </div>

                  {surface.signature.inputs.length > 0 && (
                    <div style={{ marginBottom: 4 }}>
                      <div className="sig-header">Inputs</div>
                      <div style={{
                        display: 'grid',
                        gridTemplateColumns: 'auto 1fr',
                        gap: '2px 10px',
                        fontSize: 11,
                        fontFamily: 'var(--font-mono)',
                      }}>
                        {surface.signature.inputs.map((input) => (
                          <React.Fragment key={input.name}>
                            <span style={{ color: 'var(--text-primary)' }}>
                              {input.name}{input.required && <span style={{ color: 'var(--accent-red)' }}>*</span>}
                            </span>
                            <span style={{ color: 'var(--accent-purple)' }}>{input.type}</span>
                          </React.Fragment>
                        ))}
                      </div>
                    </div>
                  )}

                  {surface.signature.outputs.length > 0 && (
                    <div style={{ marginBottom: 4 }}>
                      <div className="sig-header">Outputs</div>
                      <div style={{
                        display: 'grid',
                        gridTemplateColumns: 'auto 1fr',
                        gap: '2px 10px',
                        fontSize: 11,
                        fontFamily: 'var(--font-mono)',
                      }}>
                        {surface.signature.outputs.map((output) => (
                          <React.Fragment key={output.name}>
                            <span style={{ color: 'var(--text-primary)' }}>{output.name}</span>
                            <span style={{ color: 'var(--accent-purple)' }}>{output.type}</span>
                          </React.Fragment>
                        ))}
                      </div>
                    </div>
                  )}

                  {surface.signature.errors.length > 0 && (
                    <div>
                      <div className="sig-header">Errors</div>
                      {surface.signature.errors.map((err) => (
                        <div key={err.code} style={{
                          fontSize: 11,
                          fontFamily: 'var(--font-mono)',
                          color: 'var(--accent-red)',
                          padding: '1px 0',
                        }}>
                          {err.code}: <span style={{ color: 'var(--text-secondary)', fontFamily: 'var(--font-sans)' }}>{err.when}</span>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              ))}
            </CollapsibleSection>
          )}

          {mod.imports.length > 0 && (
            <CollapsibleSection
              title="Imports"
              badge={String(mod.imports.length)}
            >
              {mod.imports.map((imp) => (
                <div key={imp.contractId} style={{
                  fontSize: 11,
                  fontFamily: 'var(--font-mono)',
                  padding: '3px 0',
                  display: 'flex',
                  alignItems: 'center',
                  gap: 6,
                }}>
                  <span style={{ color: 'var(--text-primary)' }}>{imp.surface}</span>
                  <span style={{ color: 'var(--text-tertiary)', fontSize: 10 }}>via</span>
                  <span style={{ color: 'var(--accent-blue)' }}>{imp.contractId}</span>
                  <span style={{ color: 'var(--text-tertiary)', fontSize: 10 }}>
                    ← {imp.providerResponsibilityUnitId}
                  </span>
                </div>
              ))}
            </CollapsibleSection>
          )}
        </div>
      ))}
    </div>
  );
}
