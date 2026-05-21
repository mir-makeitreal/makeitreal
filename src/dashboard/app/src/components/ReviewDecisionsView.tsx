import React from 'react';
import { useDashboardStore } from '../store/dashboard-store';
import type { DossierSource, EvidenceSummaryItem, HarnessError } from '../types/model';

function EvidenceCard({ item }: { item: EvidenceSummaryItem }) {
  return (
    <div className="reviews-evidence-row">
      <span className="reviews-evidence-row__kind">{item.kind}</span>
      <div className="reviews-evidence-row__main">
        <div className="reviews-evidence-row__summary">{item.summary}</div>
        {item.path && <code className="reviews-evidence-row__path">{item.path}</code>}
      </div>
    </div>
  );
}

function SourceRow({ source }: { source: DossierSource }) {
  return (
    <div className="reviews-source-row">
      <span className="reviews-source-row__kind">{source.kind}</span>
      <div className="reviews-source-row__main">
        <div className="reviews-source-row__label">{source.label}</div>
        <code className="reviews-source-row__path">{source.path}</code>
      </div>
    </div>
  );
}

function DiagnosticRow({ error }: { error: HarnessError }) {
  return (
    <div className="reviews-diagnostic">
      <div className="reviews-diagnostic__head">
        <code className="reviews-diagnostic__code">{error.code}</code>
        {error.workItemId && <code className="reviews-diagnostic__work">{error.workItemId}</code>}
      </div>
      <div className="reviews-diagnostic__reason">{error.reason}</div>
      {error.ownerModule && (
        <div className="reviews-diagnostic__owner">Owner: <code>{error.ownerModule}</code></div>
      )}
      {error.evidence && error.evidence.length > 0 && (
        <ul className="reviews-diagnostic__evidence">
          {error.evidence.map((path, idx) => (
            <li key={idx}><code>{path}</code></li>
          ))}
        </ul>
      )}
    </div>
  );
}

export function ReviewDecisionsView() {
  const model = useDashboardStore(s => s.model);
  if (!model) return null;

  const dossier = model.blueprint.systemDossier;
  const decisions: string[] = dossier.reviewDecisions ?? [];
  const sources: DossierSource[] = dossier.sources ?? [];
  const evidence = model.status.evidenceSummary ?? [];
  const diagnostics = model.board?.audit?.gateFailures ?? [];

  return (
    <div className="reviews-view">
      <header className="reviews-view__header">
        <div className="reviews-view__eyebrow">Audit Trail</div>
        <h1 className="reviews-view__title">Review Decisions</h1>
        <p className="reviews-view__lead">
          Recorded blueprint review outcomes, verification evidence, and the sources used
          to produce the current dossier.
        </p>
      </header>

      <section className="reviews-section">
        <div className="reviews-section__head">
          <h2 className="reviews-section__title">Review decisions</h2>
          <span className="reviews-section__count">{decisions.length}</span>
        </div>
        {decisions.length === 0 ? (
          <div className="reviews-empty">No review decisions recorded.</div>
        ) : (
          <ol className="reviews-decisions">
            {decisions.map((entry, idx) => (
              <li key={idx} className="reviews-decision">
                <span className="reviews-decision__index">{String(idx + 1).padStart(2, '0')}</span>
                <span className="reviews-decision__body">{entry}</span>
              </li>
            ))}
          </ol>
        )}
      </section>

      <section className="reviews-section">
        <div className="reviews-section__head">
          <h2 className="reviews-section__title">Verification evidence</h2>
          <span className="reviews-section__count">{evidence.length}</span>
        </div>
        {evidence.length === 0 ? (
          <div className="reviews-empty">No verification evidence yet.</div>
        ) : (
          <div className="reviews-evidence-list">
            {evidence.map((item, idx) => (
              <EvidenceCard key={`${item.kind}-${item.path}-${idx}`} item={item} />
            ))}
          </div>
        )}
      </section>

      <section className="reviews-section">
        <div className="reviews-section__head">
          <h2 className="reviews-section__title">Sources</h2>
          <span className="reviews-section__count">{sources.length}</span>
        </div>
        {sources.length === 0 ? (
          <div className="reviews-empty">No sources declared.</div>
        ) : (
          <div className="reviews-sources-list">
            {sources.map((s, idx) => (
              <SourceRow key={`${s.path}-${idx}`} source={s} />
            ))}
          </div>
        )}
      </section>

      <section className="reviews-section">
        <div className="reviews-section__head">
          <h2 className="reviews-section__title">Diagnostics</h2>
          <span className="reviews-section__count">{diagnostics.length}</span>
        </div>
        {diagnostics.length === 0 ? (
          <div className="reviews-empty">No diagnostic gate failures.</div>
        ) : (
          <div className="reviews-diagnostics-list">
            {diagnostics.map((d, idx) => (
              <DiagnosticRow key={`${d.code}-${idx}`} error={d} />
            ))}
          </div>
        )}
      </section>
    </div>
  );
}
