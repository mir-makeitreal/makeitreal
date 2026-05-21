import React, { useState } from 'react';
import type { OperatorCockpit, StatusModel } from '../types/model';
import {
  IconBlock,
  IconBolt,
  IconCheck,
  IconClock,
  IconDot,
  IconEye,
  IconRing,
  IconSearch,
  IconWarn,
  IconX,
} from './Icons';

interface Props {
  status: StatusModel;
  cockpit: OperatorCockpit;
}

function phaseClass(phase: string): string {
  if (phase === 'done') return 'done';
  if (phase === 'running' || phase === 'verifying') return 'running';
  if (phase === 'blocked' || phase === 'failed-fast' || phase === 'rework-required') return 'blocked';
  if (phase === 'approval-required' || phase === 'human-review') return 'approval-required';
  return 'pending';
}

function StepStatusIcon({ status }: { status: string }) {
  if (status === 'complete') {
    return (
      <span className="checklist-step__dot checklist-step__dot--complete" aria-hidden="true">
        <IconCheck />
      </span>
    );
  }
  if (status === 'current') {
    return (
      <span className="checklist-step__dot checklist-step__dot--current" aria-hidden="true">
        <span className="checklist-step__pulse" />
      </span>
    );
  }
  if (status === 'blocked') {
    return (
      <span className="checklist-step__dot checklist-step__dot--blocked" aria-hidden="true">
        <IconX />
      </span>
    );
  }
  return (
    <span className="checklist-step__dot checklist-step__dot--pending" aria-hidden="true">
      <IconRing />
    </span>
  );
}

function PhaseIcon({ phase }: { phase: string }) {
  switch (phase) {
    case 'done': return <IconCheck />;
    case 'running': return <IconBolt />;
    case 'verifying': return <IconSearch />;
    case 'blocked': return <IconBlock />;
    case 'failed-fast': return <IconWarn />;
    case 'rework-required': return <IconClock />;
    case 'approval-required':
    case 'human-review':
      return <IconEye />;
    default:
      return <IconClock />;
  }
}

export function HeroSection({ status, cockpit }: Props) {
  const [reviewState, setReviewState] = useState<'idle' | 'submitting' | 'approved' | 'rejected' | 'error'>('idle');
  const [reviewError, setReviewError] = useState<string | null>(null);

  const needsReview = status.phase === 'approval-required' || status.phase === 'human-review'
    || status.blueprintStatus === 'pending-review' || status.blueprintStatus === 'awaiting-approval';

  const handleReview = async (action: 'approve' | 'reject') => {
    setReviewState('submitting');
    setReviewError(null);
    try {
      const res = await fetch('/api/blueprint/review', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action, timestamp: new Date().toISOString() }),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      setReviewState(action === 'approve' ? 'approved' : 'rejected');
    } catch (err: unknown) {
      setReviewError(err instanceof Error ? err.message : String(err));
      setReviewState('error');
    }
  };

  const completeSteps = cockpit.firstRunChecklist.filter(i => i.status === 'complete').length;
  const totalSteps = cockpit.firstRunChecklist.length;

  return (
    <div className="hero-section">
      <div className="hero-section__top">
        <div className="hero-meta">
          <span className={`status-badge ${phaseClass(status.phase)}`}>
            <span className="status-dot" />
            {status.phase}
          </span>
          <span className="hero-blueprint-label">
            <span className="hero-blueprint-label__key">Blueprint</span>
            <span className="hero-blueprint-label__val">{status.blueprintStatus}</span>
          </span>
        </div>
      </div>

      <h2 className="hero-headline">
        <span className="hero-headline__icon"><PhaseIcon phase={status.phase} /></span>
        {status.headline}
      </h2>

      <div className="hero-next-action">
        <span className="hero-next-action__prefix">Next</span>
        <span className="hero-next-action__text">{cockpit.nextAction}</span>
        {cockpit.nextCommand && (
          <code className="hero-next-action__cmd">{cockpit.nextCommand}</code>
        )}
      </div>

      {needsReview && (
        <div className="hero-review-actions">
          {reviewState === 'idle' || reviewState === 'error' ? (
            <>
              <button
                type="button"
                onClick={() => handleReview('approve')}
                className="hero-review-btn hero-review-btn--approve transition-all hover:shadow-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-400/60"
              >
                <IconCheck /> Approve Blueprint
              </button>
              <button
                type="button"
                onClick={() => handleReview('reject')}
                className="hero-review-btn hero-review-btn--reject transition-all hover:shadow-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-red-400/60"
              >
                <IconX /> Reject
              </button>
              {reviewError && (
                <span className="hero-review-error">
                  Error: {reviewError}
                </span>
              )}
            </>
          ) : reviewState === 'submitting' ? (
            <span className="hero-review-status">Submitting…</span>
          ) : (
            <span className={`status-badge ${reviewState === 'approved' ? 'done' : 'blocked'}`}>
              <span className="status-dot" />
              {reviewState === 'approved' ? 'Blueprint Approved' : 'Blueprint Rejected'}
            </span>
          )}
        </div>
      )}

      {totalSteps > 0 && (
        <div className="checklist-pipeline">
          <div className="checklist-pipeline__header">
            <span className="checklist-pipeline__label">First-run pipeline</span>
            <span className="checklist-pipeline__progress">{completeSteps} / {totalSteps}</span>
          </div>
          <ol className="checklist">
            {cockpit.firstRunChecklist.map((item, idx) => (
              <li key={item.id} className={`checklist-step checklist-step--${item.status}`}>
                <span className="checklist-step__rail" aria-hidden="true" />
                <StepStatusIcon status={item.status} />
                <span className="checklist-step__body">
                  <span className="checklist-step__index">Step {idx + 1}</span>
                  <span className="checklist-step__label">{item.label}</span>
                </span>
                <span className={`checklist-step__pill checklist-step__pill--${item.status}`}>
                  {item.status}
                </span>
              </li>
            ))}
          </ol>
        </div>
      )}
    </div>
  );
}
