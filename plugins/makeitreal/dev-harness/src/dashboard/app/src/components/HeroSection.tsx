import React, { useState } from 'react';
import type { OperatorCockpit, StatusModel } from '../types/model';

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

function statusIcon(status: string): string {
  if (status === 'complete') return '✓';
  if (status === 'current') return '●';
  if (status === 'blocked') return '✗';
  return '○';
}

const PHASE_ICONS: Record<string, string> = {
  done: '✅',
  running: '⚡',
  verifying: '🔍',
  blocked: '🚫',
  'failed-fast': '💥',
  'rework-required': '🔄',
  'approval-required': '👁️',
  'human-review': '👁️',
  pending: '⏳',
};

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
    } catch (err: any) {
      setReviewError(err.message);
      setReviewState('error');
    }
  };

  const phaseIcon = PHASE_ICONS[status.phase] ?? PHASE_ICONS.pending;

  return (
    <div className="hero-section">
      <div className="hero-meta">
        <span className={`status-badge ${phaseClass(status.phase)}`}>
          <span className="status-dot" />
          {status.phase}
        </span>
        <span style={{ fontSize: 12, color: 'var(--text-tertiary)' }}>
          Blueprint: {status.blueprintStatus}
        </span>
      </div>

      <h2 className="hero-headline">
        <span style={{ marginRight: 8 }}>{phaseIcon}</span>
        {status.headline}
      </h2>

      <div className="hero-next-action">
        <span style={{ color: 'var(--text-secondary)' }}>Next: </span>
        {cockpit.nextAction}
        {cockpit.nextCommand && (
          <>
            {' — '}
            <code>{cockpit.nextCommand}</code>
          </>
        )}
      </div>

      {needsReview && (
        <div className="hero-review-actions" style={{
          marginTop: 16,
          display: 'flex',
          gap: 12,
          alignItems: 'center',
        }}>
          {reviewState === 'idle' || reviewState === 'error' ? (
            <>
              <button
                onClick={() => handleReview('approve')}
                className="btn-approve"
                style={{
                  padding: '10px 24px',
                  background: 'var(--accent-green)',
                  color: '#fff',
                  border: 'none',
                  borderRadius: 8,
                  cursor: 'pointer',
                  fontWeight: 600,
                  fontSize: 14,
                  display: 'flex',
                  alignItems: 'center',
                  gap: 6,
                  transition: 'opacity 0.15s',
                }}
                onMouseOver={e => (e.currentTarget.style.opacity = '0.85')}
                onMouseOut={e => (e.currentTarget.style.opacity = '1')}
              >
                ✓ Approve Blueprint
              </button>
              <button
                onClick={() => handleReview('reject')}
                className="btn-reject"
                style={{
                  padding: '10px 24px',
                  background: 'transparent',
                  color: 'var(--accent-red)',
                  border: '1px solid var(--accent-red)',
                  borderRadius: 8,
                  cursor: 'pointer',
                  fontWeight: 600,
                  fontSize: 14,
                  display: 'flex',
                  alignItems: 'center',
                  gap: 6,
                  transition: 'opacity 0.15s',
                }}
                onMouseOver={e => (e.currentTarget.style.opacity = '0.85')}
                onMouseOut={e => (e.currentTarget.style.opacity = '1')}
              >
                ✗ Reject
              </button>
              {reviewError && (
                <span style={{ color: 'var(--accent-red)', fontSize: 12 }}>
                  Error: {reviewError}
                </span>
              )}
            </>
          ) : reviewState === 'submitting' ? (
            <span style={{ color: 'var(--text-secondary)', fontSize: 13 }}>Submitting…</span>
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
            <span>{statusIcon(item.status)}</span>
            <span>{item.label}</span>
          </div>
        ))}
      </div>
    </div>
  );
}
