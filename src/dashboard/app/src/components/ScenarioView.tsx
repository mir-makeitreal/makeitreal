import React, { useMemo, useState } from 'react';
import { useDashboardStore } from '../store/dashboard-store';
import type { ScenarioDetail, ScenarioIndexEntry, SequenceMessage } from '../types/model';

interface SequenceDiagramProps {
  participants: string[];
  messages: SequenceMessage[];
}

function SequenceDiagram({ participants, messages }: SequenceDiagramProps) {
  if (participants.length === 0) {
    return <div className="seq-empty">No participants.</div>;
  }

  const colWidth = 180;
  const totalWidth = participants.length * colWidth;
  const indexFor = (p: string) => Math.max(0, participants.indexOf(p));

  return (
    <div className="seq-diagram" style={{ minWidth: totalWidth }}>
      <div className="seq-diagram__participants" style={{ gridTemplateColumns: `repeat(${participants.length}, ${colWidth}px)` }}>
        {participants.map(p => (
          <div key={p} className="seq-participant">
            <div className="seq-participant__pill">{p}</div>
          </div>
        ))}
      </div>

      <div className="seq-diagram__lanes" style={{ gridTemplateColumns: `repeat(${participants.length}, ${colWidth}px)` }}>
        {participants.map(p => <div key={p} className="seq-lane" />)}
      </div>

      <div className="seq-diagram__messages">
        {messages.map((m, idx) => {
          const fromIdx = indexFor(m.from);
          const toIdx = indexFor(m.to);
          const left = Math.min(fromIdx, toIdx) * colWidth + colWidth / 2;
          const width = Math.max(Math.abs(toIdx - fromIdx) * colWidth, 4);
          const reversed = toIdx < fromIdx;
          const selfMessage = fromIdx === toIdx;

          if (selfMessage) {
            return (
              <div key={idx} className="seq-message seq-message--self" style={{ left, width: colWidth / 2 }}>
                <div className="seq-message__index">{idx + 1}</div>
                <div className="seq-message__label">{m.label}</div>
                <div className="seq-message__loop" />
              </div>
            );
          }

          return (
            <div key={idx} className={`seq-message ${reversed ? 'seq-message--reverse' : ''}`} style={{ left, width }}>
              <div className="seq-message__index">{idx + 1}</div>
              <div className="seq-message__label">{m.label}</div>
              <div className="seq-message__arrow">
                <span className="seq-message__line" />
                <span className="seq-message__head" />
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function ScenarioCard({ scenario }: { scenario: ScenarioDetail }) {
  return (
    <article className="scenario-card">
      <header className="scenario-card__header">
        <div>
          <div className="scenario-card__eyebrow">Scenario {scenario.id}</div>
          <h3 className="scenario-card__title">{scenario.title}</h3>
        </div>
        <div className="scenario-card__meta">
          <span>{scenario.participants.length} participants</span>
          <span>{scenario.messages.length} steps</span>
        </div>
      </header>

      <div className="scenario-card__diagram">
        <div className="scenario-card__scroller">
          <SequenceDiagram participants={scenario.participants} messages={scenario.messages} />
        </div>
      </div>

      <details className="scenario-card__steps">
        <summary>View step list</summary>
        <ol className="scenario-step-list">
          {scenario.messages.map((m, idx) => (
            <li key={idx}>
              <code>{m.from}</code>
              <span className="scenario-step-list__arrow">→</span>
              <code>{m.to}</code>
              <span className="scenario-step-list__label">{m.label}</span>
            </li>
          ))}
        </ol>
      </details>
    </article>
  );
}

export function ScenarioView() {
  const model = useDashboardStore(s => s.model);
  const [activeId, setActiveId] = useState<string | null>(null);

  const dossier = model?.blueprint.systemDossier;
  const index: ScenarioIndexEntry[] = dossier?.scenarioIndex ?? [];
  const details: ScenarioDetail[] = dossier?.scenarioDetails ?? [];

  const detailById = useMemo(() => {
    const map = new Map<string, ScenarioDetail>();
    for (const d of details) map.set(d.id, d);
    return map;
  }, [details]);

  if (!model) return null;

  const visibleScenarios = activeId
    ? details.filter(d => d.id === activeId)
    : details;

  if (index.length === 0 && details.length === 0) {
    return (
      <div className="scenario-view">
        <div className="scenario-empty">No scenarios declared in this blueprint.</div>
      </div>
    );
  }

  return (
    <div className="scenario-view">
      <header className="scenario-view__header">
        <div className="scenario-view__eyebrow">Behavior</div>
        <h1 className="scenario-view__title">Scenarios</h1>
        <p className="scenario-view__lead">
          End-to-end flows describing how participants collaborate. Each row in the index
          links to its sequence diagram below.
        </p>
      </header>

      {index.length > 0 && (
        <div className="scenario-index">
          <table className="scenario-index__table">
            <thead>
              <tr>
                <th>ID</th>
                <th>Title</th>
                <th>Participants</th>
                <th>Steps</th>
                <th>Kind</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {index.map(entry => {
                const isActive = activeId === entry.id;
                const exists = detailById.has(entry.id);
                return (
                  <tr key={entry.id} className={isActive ? 'is-active' : ''}>
                    <td><code>{entry.id}</code></td>
                    <td>{entry.title}</td>
                    <td>{entry.participantCount}</td>
                    <td>{entry.stepCount}</td>
                    <td><span className="scenario-kind">{entry.visualizationKind}</span></td>
                    <td>
                      <button
                        type="button"
                        className="scenario-index__btn"
                        disabled={!exists}
                        onClick={() => setActiveId(isActive ? null : entry.id)}
                      >
                        {isActive ? 'Show all' : 'Focus'}
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      <div className="scenario-list">
        {visibleScenarios.map(s => (
          <ScenarioCard key={s.id} scenario={s} />
        ))}
        {visibleScenarios.length === 0 && (
          <div className="scenario-empty">No sequence details available.</div>
        )}
      </div>
    </div>
  );
}
