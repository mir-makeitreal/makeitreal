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

function StatusIcon({ status }: { status: string }) {
  if (status === 'complete') return <IconCheck />;
  if (status === 'current') return <IconDot />;
  if (status === 'blocked') return <IconX />;
  return <IconRing />;
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

  return (
    <div className="hero-section">
      <div className="hero-meta">
        <span className={`status-badge ${phaseClass(status.phase)}`}>
          <span className="status-dot" />
          {status.phase}
        </span>
        <span className="hero-blueprint-label">
          Blueprint: {status.blueprintStatus}
        </span>
      </div>

      <h2 className="hero-headline">
        <span className="hero-headline__icon"><PhaseIcon phase={status.phase} /></span>
        {status.headline}
      </h2>

      <div className="hero-next-action">
        <span className="hero-next-action__prefix">Next: </span>
        {cockpit.nextAction}
        {cockpit.nextCommand && (
          <>
            {' — '}
            <code>{cockpit.nextCommand}</code>
          </>
        )}
      </div>

      {needsReview && (
        <div className="hero-review-actions">
          {reviewState === 'idle' || reviewState === 'error' ? (
            <>
              <button
                type="button"
                onClick={() => handleReview('approve')}
                className="hero-review-btn hero-review-btn--approve"
              >
                <IconCheck /> Approve Blueprint
              </button>
              <button
                type="button"
                onClick={() => handleReview('reject')}
                className="hero-review-btn hero-review-btn--reject"
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

      <div className="checklist">
        {cockpit.firstRunChecklist.map((item) => (
          <div key={item.id} className={`checklist-item ${item.status}`}>
            <StatusIcon status={item.status} />
            <span>{item.label}</span>
          </div>
        ))}
      </div>
    </div>
  );
}
