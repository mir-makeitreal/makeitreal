import React from 'react';
import type { ChecklistItem, EvidenceLink, OperatorCockpit } from '../types/model';
import { EmptyState } from './EmptyState';
import { IconCheck, IconDot, IconRing, IconX } from './Icons';

export interface EvidencePanelProps {
  cockpit: OperatorCockpit;
}

type VisualStepStatus = 'complete' | 'current' | 'pending' | 'failed';

function StatusIcon({ status }: { status: VisualStepStatus }) {
  switch (status) {
    case 'complete': return <IconCheck />;
    case 'current': return <IconDot />;
    case 'failed': return <IconX />;
    default: return <IconRing />;
  }
}

const STATUS_LABELS: Record<VisualStepStatus, string> = {
  complete: 'complete',
  current: 'current',
  pending: 'pending',
  failed: 'failed',
};

function visualStatus(status: ChecklistItem['status']): VisualStepStatus {
  if (status === 'blocked' || status === 'failed') return 'failed';
  return status;
}

function formatTimestamp(value?: string | null) {
  if (!value) return null;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;

  return new Intl.DateTimeFormat(undefined, {
    month: 'short',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  }).format(date);
}

function itemTimestamp(item: ChecklistItem | EvidenceLink) {
  return formatTimestamp(item.completedAt ?? item.startedAt ?? item.updatedAt ?? item.timestamp);
}

function PipelineStep({ item, index }: { item: ChecklistItem; index: number }) {
  const status = visualStatus(item.status);

  return (
    <div className={`pipeline-step pipeline-step--${status}`}>
      <div className="pipeline-step__icon" aria-hidden="true">
        <StatusIcon status={status} />
      </div>
      <div className="pipeline-step__body">
        <div className="pipeline-step__index">Step {index + 1}</div>
        <div className="pipeline-step__label">{item.label}</div>
      </div>
    </div>
  );
}

function ChecklistRow({ item }: { item: ChecklistItem }) {
  const status = visualStatus(item.status);
  const timestamp = itemTimestamp(item);

  return (
    <div className={`pipeline-row pipeline-row--${status}`}>
      <span className="pipeline-row__icon" aria-hidden="true">
        <StatusIcon status={status} />
      </span>
      <div className="pipeline-row__main">
        <div className="pipeline-row__titleline">
          <div className="pipeline-row__label">{item.label}</div>
          {timestamp && (
            <time className="pipeline-row__time" dateTime={item.completedAt ?? item.startedAt ?? item.updatedAt ?? item.timestamp ?? undefined}>
              {timestamp}
            </time>
          )}
        </div>
        {item.command && (
          <code className="pipeline-row__command">
            {item.command}
          </code>
        )}
      </div>
      <span className={`pipeline-row__badge pipeline-row__badge--${status}`}>
        {STATUS_LABELS[status]}
      </span>
    </div>
  );
}

function EvidenceLinkRow({ evidence }: { evidence: EvidenceLink }) {
  const timestamp = itemTimestamp(evidence);

  return (
    <div className="evidence-link-row">
      <span className="evidence-link-row__kind">{evidence.kind}</span>
      <div className="evidence-link-row__main">
        {evidence.href ? (
          <a href={evidence.href} target="_blank" rel="noopener noreferrer">
            {evidence.summary}
          </a>
        ) : (
          <span>{evidence.summary}</span>
        )}
        {evidence.path && <code>{evidence.path}</code>}
      </div>
      {timestamp && (
        <time className="evidence-link-row__time" dateTime={evidence.completedAt ?? evidence.startedAt ?? evidence.updatedAt ?? evidence.timestamp ?? undefined}>
          {timestamp}
        </time>
      )}
    </div>
  );
}

export function EvidencePanel({ cockpit }: EvidencePanelProps) {
  const { firstRunChecklist, evidenceLinks } = cockpit;
  const totalSteps = firstRunChecklist.length;
  const completeSteps = firstRunChecklist.filter(item => item.status === 'complete').length;
  const failedSteps = firstRunChecklist.filter(item => visualStatus(item.status) === 'failed').length;
  const progressPercent = totalSteps === 0 ? 0 : Math.round((completeSteps / totalSteps) * 100);

  return (
    <div className="evidence-panel">
      {firstRunChecklist.length > 0 && (
        <section className="pipeline-panel" aria-label="Verification pipeline">
          <div className="pipeline-panel__header">
            <div>
              <div className="pipeline-panel__eyebrow">CI/CD Pipeline</div>
              <div className="pipeline-panel__title">Verification Checklist</div>
            </div>
            <div className="pipeline-panel__percent">{progressPercent}%</div>
          </div>

          <div
            className={`pipeline-progress${failedSteps > 0 ? ' pipeline-progress--failed' : ''}`}
            role="progressbar"
            aria-valuenow={progressPercent}
            aria-valuemin={0}
            aria-valuemax={100}
            aria-label="Verification checklist completion"
          >
            <div className="pipeline-progress__bar" style={{ width: `${progressPercent}%` }} />
          </div>

          <div className="pipeline-panel__meta">
            <span>{completeSteps} of {totalSteps} complete</span>
            {failedSteps > 0 && <span>{failedSteps} failed</span>}
          </div>

          <div className="pipeline-steps" aria-hidden="true">
            {firstRunChecklist.map((item, index) => (
              <PipelineStep key={item.id} item={item} index={index} />
            ))}
          </div>

          <div className="pipeline-rows">
            {firstRunChecklist.map(item => (
              <ChecklistRow key={item.id} item={item} />
            ))}
          </div>
        </section>
      )}

      {evidenceLinks.length > 0 && (
        <section className="evidence-links-panel" aria-label="Evidence links">
          <div className="evidence-links-panel__title">Evidence Links</div>
          {evidenceLinks.map((evidence, index) => (
            <EvidenceLinkRow key={`${evidence.kind}-${evidence.path}-${index}`} evidence={evidence} />
          ))}
        </section>
      )}

      {firstRunChecklist.length === 0 && evidenceLinks.length === 0 && (
        <EmptyState
          icon={<IconRing />}
          title="No evidence"
          message="No evidence data has been recorded yet."
        />
      )}
    </div>
  );
}
