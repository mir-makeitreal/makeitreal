import React, { useEffect, useMemo, useRef, useState } from 'react';
import { useDashboardStore } from '../store/dashboard-store';
import type { ScenarioDetail, ScenarioIndexEntry, SequenceMessage } from '../types/model';

type MermaidModule = typeof import('mermaid')['default'];

let mermaidInstance: MermaidModule | null = null;
let mermaidLoader: Promise<MermaidModule> | null = null;
let mermaidInitialized = false;

async function getMermaid(): Promise<MermaidModule> {
  if (mermaidInstance) return mermaidInstance;
  if (!mermaidLoader) {
    mermaidLoader = import('mermaid').then(mod => {
      mermaidInstance = mod.default;
      return mermaidInstance;
    });
  }
  return mermaidLoader;
}

async function initMermaid(theme: 'dark' | 'light') {
  const mermaid = await getMermaid();
  const isDark = theme === 'dark';
  mermaid.initialize({
    startOnLoad: false,
    securityLevel: 'strict',
    theme: 'base',
    fontFamily: "'Inter', -apple-system, BlinkMacSystemFont, sans-serif",
    themeVariables: isDark
      ? {
          background: '#0d1117',
          primaryColor: '#161b22',
          primaryTextColor: '#e6edf3',
          primaryBorderColor: '#30363d',
          lineColor: '#58a6ff',
          secondaryColor: '#21262d',
          tertiaryColor: '#1c2128',
          actorBkg: '#161b22',
          actorBorder: '#58a6ff',
          actorTextColor: '#e6edf3',
          actorLineColor: '#30363d',
          signalColor: '#58a6ff',
          signalTextColor: '#e6edf3',
          labelBoxBkgColor: '#21262d',
          labelBoxBorderColor: '#58a6ff',
          labelTextColor: '#e6edf3',
          loopTextColor: '#e6edf3',
          noteBkgColor: '#1c2128',
          noteBorderColor: '#bc8cff',
          noteTextColor: '#e6edf3',
          activationBkgColor: '#21262d',
          activationBorderColor: '#58a6ff',
          sequenceNumberColor: '#0d1117',
        }
      : {
          background: '#ffffff',
          primaryColor: '#f6f8fa',
          primaryTextColor: '#1f2328',
          primaryBorderColor: '#d0d7de',
          lineColor: '#0969da',
          secondaryColor: '#eaeef2',
          tertiaryColor: '#ffffff',
          actorBkg: '#f6f8fa',
          actorBorder: '#0969da',
          actorTextColor: '#1f2328',
          actorLineColor: '#d0d7de',
          signalColor: '#0969da',
          signalTextColor: '#1f2328',
          labelBoxBkgColor: '#eaeef2',
          labelBoxBorderColor: '#0969da',
          labelTextColor: '#1f2328',
          loopTextColor: '#1f2328',
          noteBkgColor: '#fff8c5',
          noteBorderColor: '#8250df',
          noteTextColor: '#1f2328',
          activationBkgColor: '#eaeef2',
          activationBorderColor: '#0969da',
          sequenceNumberColor: '#ffffff',
        },
    sequence: {
      diagramMarginX: 32,
      diagramMarginY: 16,
      actorMargin: 60,
      width: 180,
      height: 56,
      boxMargin: 12,
      boxTextMargin: 6,
      noteMargin: 12,
      messageMargin: 40,
      mirrorActors: true,
      showSequenceNumbers: true,
      wrap: true,
    },
  });
  mermaidInitialized = true;
}

function sanitizeMermaidLabel(text: string): string {
  return text
    .replace(/[\r\n]+/g, ' ')
    .replace(/;/g, ',')
    .replace(/"/g, "'")
    .trim();
}

function sanitizeParticipantId(p: string): string {
  const cleaned = p.replace(/[^A-Za-z0-9_]/g, '_');
  return /^[A-Za-z]/.test(cleaned) ? cleaned : `p_${cleaned}`;
}

function buildSequenceDefinition(participants: string[], messages: SequenceMessage[]): string {
  const lines: string[] = ['sequenceDiagram', '  autonumber'];
  const idMap = new Map<string, string>();
  for (const p of participants) {
    const id = sanitizeParticipantId(p);
    idMap.set(p, id);
    lines.push(`  participant ${id} as ${sanitizeMermaidLabel(p)}`);
  }
  for (const m of messages) {
    const fromId = idMap.get(m.from) ?? sanitizeParticipantId(m.from);
    const toId = idMap.get(m.to) ?? sanitizeParticipantId(m.to);
    if (!idMap.has(m.from)) {
      lines.push(`  participant ${fromId} as ${sanitizeMermaidLabel(m.from)}`);
      idMap.set(m.from, fromId);
    }
    if (!idMap.has(m.to)) {
      lines.push(`  participant ${toId} as ${sanitizeMermaidLabel(m.to)}`);
      idMap.set(m.to, toId);
    }
    const arrow = fromId === toId ? '->>' : '->>';
    lines.push(`  ${fromId}${arrow}${toId}: ${sanitizeMermaidLabel(m.label)}`);
  }
  return lines.join('\n');
}

interface MermaidSequenceProps {
  diagramId: string;
  participants: string[];
  messages: SequenceMessage[];
  theme: 'dark' | 'light';
}

function MermaidSequenceDiagram({ diagramId, participants, messages, theme }: MermaidSequenceProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);

    const definition = buildSequenceDefinition(participants, messages);
    const renderId = `${diagramId}-${Date.now()}`;

    (async () => {
      try {
        await initMermaid(theme);
        const mermaid = await getMermaid();
        const { svg } = await mermaid.render(renderId, definition);
        if (cancelled) return;
        if (containerRef.current) {
          containerRef.current.innerHTML = svg;
          const svgEl = containerRef.current.querySelector('svg');
          if (svgEl) {
            svgEl.removeAttribute('height');
            svgEl.style.maxWidth = '100%';
            svgEl.style.height = 'auto';
          }
        }
        setError(null);
        setLoading(false);
      } catch (err: unknown) {
        if (cancelled) return;
        const message = err instanceof Error ? err.message : String(err);
        console.warn('Mermaid render failed', message);
        setError(message);
        setLoading(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [diagramId, participants, messages, theme]);

  if (participants.length === 0) {
    return <div className="seq-empty">No participants.</div>;
  }

  if (error) {
    return (
      <div className="seq-empty" role="alert">
        Failed to render sequence diagram. {error}
      </div>
    );
  }

  return (
    <div className="seq-mermaid-wrap">
      {loading && (
        <div className="seq-loading" aria-live="polite">
          <span className="seq-loading__spinner" aria-hidden="true" />
          <span>Loading diagram…</span>
        </div>
      )}
      <div className="seq-mermaid" ref={containerRef} aria-label="Sequence diagram" />
    </div>
  );
}

function ScenarioCard({ scenario, theme }: { scenario: ScenarioDetail; theme: 'dark' | 'light' }) {
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
          <MermaidSequenceDiagram
            diagramId={`mermaid-${scenario.id.replace(/[^A-Za-z0-9_-]/g, '_')}`}
            participants={scenario.participants}
            messages={scenario.messages}
            theme={theme}
          />
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
  const theme = useDashboardStore(s => s.theme);
  const [activeId, setActiveId] = useState<string | null>(null);

  const dossier = model?.blueprint.systemDossier;
  const index: ScenarioIndexEntry[] = dossier?.scenarioIndex ?? [];
  const details: ScenarioDetail[] = dossier?.scenarioDetails ?? [];

  const detailById = useMemo(() => {
    const map = new Map<string, ScenarioDetail>();
    for (const d of details) map.set(d.id, d);
    return map;
  }, [details]);

  // Re-initialize mermaid theme when dashboard theme changes.
  useEffect(() => {
    mermaidInitialized = false;
    void initMermaid(theme);
  }, [theme]);

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
          <ScenarioCard key={s.id} scenario={s} theme={theme} />
        ))}
        {visibleScenarios.length === 0 && (
          <div className="scenario-empty">No sequence details available.</div>
        )}
      </div>
    </div>
  );
}
