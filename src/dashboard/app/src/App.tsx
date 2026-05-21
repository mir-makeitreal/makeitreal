import React, { useEffect, useMemo, useRef } from 'react';
import { useDashboardStore } from './store/dashboard-store';
import { useWebSocket } from './hooks/useWebSocket';
import { Sidebar, type SidebarSection } from './components/Sidebar';
import { TopologyGraph } from './components/TopologyGraph';
import { TaskDAG } from './components/TaskDAG';
import { ContractSurfacesView } from './components/ContractSurfacesView';
import { ScenarioView } from './components/ScenarioView';
import { ModulesSection } from './components/ModulesSection';
import { ResponsibilityMap } from './components/ResponsibilityMap';
import { DetailDrawer } from './components/DetailDrawer';
import { IconWarn } from './components/Icons';

const SECTIONS: SidebarSection[] = [
  { id: 'architecture', label: 'Architecture' },
  { id: 'execution', label: 'Execution Plan' },
  { id: 'modules', label: 'Modules' },
  { id: 'surfaces', label: 'Contract Surfaces' },
  { id: 'scenarios', label: 'Scenarios' },
];

function LoadingSkeleton() {
  return (
    <div className="doc-loading" aria-busy="true" aria-label="Loading architecture dossier">
      <div className="doc-loading__sidebar" />
      <div className="doc-loading__main">
        <div className="doc-loading__row doc-loading__row--lg" />
        <div className="doc-loading__row" />
        <div className="doc-loading__block" />
      </div>
    </div>
  );
}

function useScrollSpy(sectionIds: string[]) {
  const setActiveSection = useDashboardStore(s => s.setActiveSection);

  useEffect(() => {
    if (sectionIds.length === 0) return;
    const elements = sectionIds
      .map(id => document.getElementById(id))
      .filter((el): el is HTMLElement => el !== null);
    if (elements.length === 0) return;

    const visibility = new Map<string, number>();
    const observer = new IntersectionObserver(
      entries => {
        for (const entry of entries) {
          visibility.set(entry.target.id, entry.intersectionRatio);
        }
        let bestId = sectionIds[0];
        let bestRatio = -1;
        for (const id of sectionIds) {
          const ratio = visibility.get(id) ?? 0;
          if (ratio > bestRatio) {
            bestRatio = ratio;
            bestId = id;
          }
        }
        if (bestRatio > 0) setActiveSection(bestId);
      },
      {
        rootMargin: '-20% 0px -60% 0px',
        threshold: [0, 0.1, 0.25, 0.5, 0.75, 1],
      },
    );

    for (const el of elements) observer.observe(el);
    return () => observer.disconnect();
  }, [sectionIds, setActiveSection]);
}

export default function App() {
  const {
    loading, error, model, connected,
    activeSection, setActiveSection,
    selection, clearSelection,
    fetchModel,
  } = useDashboardStore();

  useWebSocket();

  useEffect(() => {
    fetchModel();
  }, [fetchModel]);

  useEffect(() => {
    document.documentElement.setAttribute('data-theme', 'dark');
  }, []);

  const sectionIds = useMemo(() => SECTIONS.map(s => s.id), []);
  useScrollSpy(sectionIds);

  const allWorkItems = useMemo(
    () => model?.board?.lanes?.flatMap(l => l.workItems) ?? [],
    [model],
  );

  if (loading && !model) return <LoadingSkeleton />;

  if (error && !model) {
    return (
      <div className="doc-error">
        <div>
          <div className="doc-error__title"><IconWarn /> Failed to load dossier</div>
          <div>{error}</div>
          <button type="button" className="doc-error__retry" onClick={() => fetchModel()}>
            Retry
          </button>
        </div>
      </div>
    );
  }

  if (!model) return null;

  const blueprintTitle = model.blueprint.title || 'Untitled';

  return (
    <div className="doc-layout">
      <Sidebar
        sections={SECTIONS}
        activeSection={activeSection}
        onNavigate={setActiveSection}
        connected={connected}
      />

      <main className="doc-main">
        <header className="doc-header">
          <div className="doc-header__eyebrow">Architecture Dossier</div>
          <h1 className="doc-header__title">{blueprintTitle}</h1>
          {model.blueprint.summary.length > 0 && (
            <p className="doc-header__lead">{model.blueprint.summary[0]}</p>
          )}
        </header>

        <Section id="architecture" eyebrow="Topology" title="Architecture">
          <p className="doc-section__lead">
            Module topology with contract edges. Click a node to inspect its surfaces, owned
            paths, and inbound/outbound contracts.
          </p>
          <div className="doc-diagram doc-diagram--lg">
            <TopologyGraph
              nodes={model.blueprint.architecture.nodes}
              edges={model.blueprint.architecture.edges}
              fullHeight
            />
          </div>
        </Section>

        <Section id="execution" eyebrow="Parallel agents" title="Execution Plan">
          <p className="doc-section__lead">
            Work items and their dependency order. Independent branches can be executed by
            parallel agents; downstream items wait for upstream completion.
          </p>
          {allWorkItems.length === 0 ? (
            <p className="doc-empty">No work items declared.</p>
          ) : (
            <div className="doc-diagram doc-diagram--md">
              <TaskDAG workItems={allWorkItems} fullHeight />
            </div>
          )}
        </Section>

        <Section id="modules" eyebrow="Ownership" title="Modules">
          <p className="doc-section__lead">
            One entry per module: who owns it, what files it owns, and what public surfaces
            it exposes.
          </p>
          <ModulesSection modules={model.blueprint.moduleInterfaces} />
          {model.blueprint.boundaries.length > 0 && (
            <>
              <h3 className="doc-subsection__title">Responsibility map</h3>
              <ResponsibilityMap
                boundaries={model.blueprint.boundaries}
                moduleInterfaces={model.blueprint.moduleInterfaces}
              />
            </>
          )}
        </Section>

        <Section id="surfaces" eyebrow="SDK reference" title="Contract Surfaces">
          <p className="doc-section__lead">
            Every public surface. Each entry documents parameters, returns, errors, and a
            usage example — the canonical reference for callers.
          </p>
          <ContractSurfacesView />
        </Section>

        <Section id="scenarios" eyebrow="Behavior" title="Scenarios">
          <p className="doc-section__lead">
            End-to-end sequences showing how participants collaborate to satisfy
            user-facing scenarios.
          </p>
          <ScenarioView />
        </Section>

        <footer className="doc-footer">
          <span>{model.run.runId}</span>
          <span>·</span>
          <span>Generated {new Date(model.generatedAt).toLocaleString()}</span>
        </footer>
      </main>

      <DetailDrawer
        selection={selection}
        model={model}
        onClose={clearSelection}
      />
    </div>
  );
}

interface SectionProps {
  id: string;
  eyebrow: string;
  title: string;
  children: React.ReactNode;
}

function Section({ id, eyebrow, title, children }: SectionProps) {
  const ref = useRef<HTMLElement>(null);
  return (
    <section id={id} ref={ref} className="doc-section">
      <header className="doc-section__head">
        <div className="doc-section__eyebrow">{eyebrow}</div>
        <h2 className="doc-section__title">{title}</h2>
      </header>
      <div className="doc-section__body">{children}</div>
    </section>
  );
}
