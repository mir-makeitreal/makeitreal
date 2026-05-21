import React, { useState } from 'react';
import { useDashboardStore } from '../store/dashboard-store';
import type { ApprovalScope, StatusModel } from '../types/model';

type ReviewState = 'idle' | 'submitting' | 'approved' | 'rejected' | 'error';

function deriveStatus(status: StatusModel, reviewState: ReviewState): 'approved' | 'pending' | 'rejected' {
  if (reviewState === 'approved') return 'approved';
  if (reviewState === 'rejected') return 'rejected';
  const bp = status.blueprintStatus;
  if (bp === 'approved' || bp === 'accepted') return 'approved';
  if (bp === 'rejected' || bp === 'denied') return 'rejected';
  return 'pending';
}

function StatusBadge({ status }: { status: 'approved' | 'pending' | 'rejected' }) {
  const map = {
    approved: { label: 'Approved', cls: 'approval-status--approved' },
    pending: { label: 'Pending review', cls: 'approval-status--pending' },
    rejected: { label: 'Rejected', cls: 'approval-status--rejected' },
  } as const;
  const entry = map[status];
  return (
    <span className={`approval-status ${entry.cls}`}>
      <span className="approval-status__dot" />
      {entry.label}
    </span>
  );
}

function ChipList({ label, items, kind }: { label: string; items: string[]; kind: 'work' | 'path' | 'contract' }) {
  return (
    <section className="approval-chip-group">
      <div className="approval-chip-group__head">
        <span className="approval-chip-group__label">{label}</span>
        <span className="approval-chip-group__count">{items.length}</span>
      </div>
      {items.length === 0 ? (
        <div className="approval-chip-group__empty">None</div>
      ) : (
        <div className="approval-chip-group__chips">
          {items.map(item => (
            <code key={item} className={`approval-chip approval-chip--${kind}`}>
              {item}
            </code>
          ))}
        </div>
      )}
    </section>
  );
}

export function ApprovalScopeView() {
  const model = useDashboardStore(s => s.model);
  const [reviewState, setReviewState] = useState<ReviewState>('idle');
  const [reviewError, setReviewError] = useState<string | null>(null);

  if (!model) return null;

  const scope: ApprovalScope = model.blueprint.systemDossier.approvalScope;
  const status = model.status;
  const derived = deriveStatus(status, reviewState);

  const submit = async (action: 'approve' | 'reject') => {
    setReviewState('submitting');
    setReviewError(null);
    try {
      const res = await fetch('/api/blueprint/review', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action,
          fingerprint: scope.blueprintFingerprint,
          timestamp: new Date().toISOString(),
        }),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      setReviewState(action === 'approve' ? 'approved' : 'rejected');
    } catch (err: unknown) {
      setReviewError(err instanceof Error ? err.message : String(err));
      setReviewState('error');
    }
  };

  const interactionLocked = reviewState === 'submitting' || derived === 'approved' || derived === 'rejected';

  return (
    <div className="approval-view">
      <div className="approval-banner">
        <div className="approval-banner__top">
          <div>
            <div className="approval-banner__eyebrow">Blueprint Review</div>
            <h1 className="approval-banner__title">{model.blueprint.title || 'System Blueprint'}</h1>
          </div>
          <StatusBadge status={derived} />
        </div>

        <div className="approval-banner__fingerprint">
          <span className="approval-banner__fingerprint-label">Fingerprint</span>
          <code>{scope.blueprintFingerprint ?? '(none)'}</code>
        </div>

        <div className="approval-banner__actions">
          <button
            type="button"
            className="approval-btn approval-btn--approve"
            onClick={() => submit('approve')}
            disabled={interactionLocked}
          >
            Approve Blueprint
          </button>
          <button
            type="button"
            className="approval-btn approval-btn--reject"
            onClick={() => submit('reject')}
            disabled={interactionLocked}
          >
            Reject
          </button>
          {reviewState === 'submitting' && (
            <span className="approval-banner__hint">Submitting…</span>
          )}
          {reviewError && reviewState === 'error' && (
            <span className="approval-banner__error">Error: {reviewError}</span>
          )}
        </div>
      </div>

      <div className="approval-scope-grid">
        <ChipList label="Required work items" items={scope.requiredWorkItems} kind="work" />
        <ChipList label="Authorized paths" items={scope.authorizedPaths} kind="path" />
        <ChipList label="Required contracts" items={scope.requiredContracts} kind="contract" />
      </div>
    </div>
  );
}
