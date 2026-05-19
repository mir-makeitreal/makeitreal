import React from 'react';
import type { ChecklistItem, OperatorCockpit } from '../types/model';

export interface EvidencePanelProps {
  cockpit: OperatorCockpit;
}

const STATUS_ICONS: Record<string, string> = {
  complete: '✅',
  current: '🔵',
  pending: '⬜',
  blocked: '🔴',
};

function ChecklistRow({ item }: { item: ChecklistItem }) {
  return (
    <div
      className="checklist-row"
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 8,
        padding: '6px 0',
        borderBottom: '1px solid var(--border-primary)',
        fontSize: 13,
      }}
    >
      <span style={{ fontSize: 14, flexShrink: 0 }}>
        {STATUS_ICONS[item.status] ?? '⬜'}
      </span>
      <div style={{ flex: 1 }}>
        <div style={{ fontWeight: item.status === 'current' ? 600 : 400 }}>
          {item.label}
        </div>
        {item.command && (
          <div
            style={{
              fontSize: 11,
              color: 'var(--text-tertiary)',
              fontFamily: 'monospace',
              marginTop: 1,
            }}
          >
            {item.command}
          </div>
        )}
      </div>
      <span
        style={{
          fontSize: 10,
          padding: '1px 6px',
          borderRadius: 4,
          background: item.status === 'complete' ? 'var(--accent-green, #22c55e)' :
                      item.status === 'current' ? 'var(--accent-blue, #3b82f6)' :
                      item.status === 'blocked' ? 'var(--accent-red, #ef4444)' :
                      'var(--bg-secondary)',
          color: item.status === 'pending' ? 'var(--text-tertiary)' : '#fff',
        }}
      >
        {item.status}
      </span>
    </div>
  );
}

export function EvidencePanel({ cockpit }: EvidencePanelProps) {
  const { firstRunChecklist, evidenceLinks } = cockpit;

  return (
    <div className="evidence-panel" style={{ padding: 12 }}>
      {/* Checklist */}
      {firstRunChecklist.length > 0 && (
        <div style={{ marginBottom: 16 }}>
          <div style={{ fontWeight: 600, fontSize: 14, marginBottom: 8 }}>
            Verification Checklist
          </div>
          <div>
            {firstRunChecklist.map(item => (
              <ChecklistRow key={item.id} item={item} />
            ))}
          </div>
          <div style={{ fontSize: 11, color: 'var(--text-tertiary)', marginTop: 6 }}>
            {firstRunChecklist.filter(i => i.status === 'complete').length} of{' '}
            {firstRunChecklist.length} complete
          </div>
        </div>
      )}

      {/* Evidence Links */}
      {evidenceLinks.length > 0 && (
        <div>
          <div style={{ fontWeight: 600, fontSize: 14, marginBottom: 8 }}>
            Evidence Links
          </div>
          {evidenceLinks.map((ev, i) => (
            <div
              key={i}
              style={{
                padding: '6px 0',
                borderBottom: '1px solid var(--border-primary)',
                fontSize: 12,
              }}
            >
              <span
                style={{
                  display: 'inline-block',
                  padding: '1px 6px',
                  borderRadius: 3,
                  background: 'var(--bg-secondary)',
                  color: 'var(--text-tertiary)',
                  fontSize: 10,
                  marginRight: 6,
                }}
              >
                {ev.kind}
              </span>
              {ev.href ? (
                <a
                  href={ev.href}
                  target="_blank"
                  rel="noopener noreferrer"
                  style={{ color: 'var(--accent-blue)' }}
                >
                  {ev.summary}
                </a>
              ) : (
                <span>{ev.summary}</span>
              )}
              {ev.path && (
                <div style={{ fontSize: 10, color: 'var(--text-tertiary)', marginTop: 1 }}>
                  {ev.path}
                </div>
              )}
            </div>
          ))}
        </div>
      )}

      {firstRunChecklist.length === 0 && evidenceLinks.length === 0 && (
        <div style={{ color: 'var(--text-tertiary)', fontSize: 13 }}>
          No evidence data available.
        </div>
      )}
    </div>
  );
}
