import React, { useEffect, useRef, useState } from 'react';
import type {
  Contract,
  ContractSurface,
  EvidenceSummaryItem,
  ModuleInterface,
  PreviewModel,
  PublicSurface,
  PublicSurfaceSignature,
  SelectionState,
  WorkItem,
} from '../types/model';
import { EmptyState } from './EmptyState';
import { IconRing, IconX } from './Icons';

export interface DetailDrawerProps {
  selection: SelectionState;
  model: PreviewModel | null;
  onClose: () => void;
}

const KIND_LABEL: Record<string, string> = {
  module: 'Module',
  workItem: 'Work Item',
  contract: 'Contract',
  boundary: 'Boundary',
};

export function DetailDrawer({ selection, model, onClose }: DetailDrawerProps) {
  const open = Boolean(selection.nodeId && selection.nodeType && model);
  const [renderedSelection, setRenderedSelection] = useState(selection);
  const lastIdRef = useRef<string | null>(null);

  // Keep last rendered content visible during the slide-out animation
  useEffect(() => {
    if (open) {
      setRenderedSelection(selection);
      lastIdRef.current = selection.nodeId;
    }
  }, [open, selection]);

  // Close on Escape
  useEffect(() => {
    if (!open) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [open, onClose]);

  const active = open ? selection : renderedSelection;
  const kindLabel = active.nodeType ? KIND_LABEL[active.nodeType] ?? active.nodeType : '';

  return (
    <>
      <div
        className={`detail-drawer-backdrop${open ? ' detail-drawer-backdrop--open' : ''}`}
        aria-hidden="true"
        onClick={onClose}
      />
      <aside
        className={`detail-drawer${open ? ' detail-drawer--open' : ''}`}
        role="dialog"
        aria-hidden={!open}
        aria-label={active.nodeId ? `${kindLabel} details` : 'Detail drawer'}
      >
        <DrawerContent selection={active} model={model} onClose={onClose} kindLabel={kindLabel} />
      </aside>
    </>
  );
}

// ── Drawer content ──

interface DrawerContentProps {
  selection: SelectionState;
  model: PreviewModel | null;
  onClose: () => void;
  kindLabel: string;
}

function DrawerContent({ selection, model, onClose, kindLabel }: DrawerContentProps) {
  if (!selection.nodeId || !selection.nodeType || !model) {
    return (
      <>
        <header className="detail-drawer__header">
          <div>
            <div className="detail-drawer__title">Details</div>
          </div>
          <button
            type="button"
            className="detail-drawer__close"
            onClick={onClose}
            aria-label="Close detail drawer"
          >
            <IconX />
          </button>
        </header>
        <div className="detail-drawer__body">
          <EmptyState
            icon={<IconRing />}
            title="Nothing selected"
            message="Select a node from the graph or board to see its details."
          />
        </div>
      </>
    );
  }

  const title = resolveTitle(selection, model);

  return (
    <>
      <header className="detail-drawer__header">
        <div style={{ minWidth: 0, flex: 1 }}>
          <div className="detail-drawer__kicker">{kindLabel}</div>
          <div className="detail-drawer__title">{title}</div>
          <div className="detail-drawer__id">{selection.nodeId}</div>
        </div>
        <button
          type="button"
          className="detail-drawer__close"
          onClick={onClose}
          aria-label="Close detail drawer"
        >
          <IconX />
        </button>
      </header>
      <div className="detail-drawer__body">
        {selection.nodeType === 'module' && <ModuleDetail nodeId={selection.nodeId} model={model} />}
        {selection.nodeType === 'workItem' && <WorkItemDetail nodeId={selection.nodeId} model={model} />}
        {selection.nodeType === 'contract' && <ContractDetail nodeId={selection.nodeId} model={model} />}
        {selection.nodeType === 'boundary' && <BoundaryDetail nodeId={selection.nodeId} model={model} />}
        <RelatedSection selection={selection} />
      </div>
    </>
  );
}

function resolveTitle(selection: SelectionState, model: PreviewModel): string {
  const { nodeId, nodeType } = selection;
  if (!nodeId) return 'Unknown';
  if (nodeType === 'module') {
    const mod = model.blueprint.moduleInterfaces.find(m => m.responsibilityUnitId === nodeId);
    if (mod) return mod.moduleName;
    const node = model.blueprint.architecture.nodes.find(n => n.id === nodeId);
    return node?.label ?? nodeId;
  }
  if (nodeType === 'workItem') {
    const wi = allWorkItems(model).find(w => w.id === nodeId);
    return wi?.title ?? nodeId;
  }
  if (nodeType === 'contract') {
    const c = model.blueprint.contracts.find(c => c.contractId === nodeId);
    return c?.contractId ?? nodeId;
  }
  return nodeId;
}

function allWorkItems(model: PreviewModel): WorkItem[] {
  return model.board?.lanes?.flatMap(l => l.workItems) ?? [];
}

// ── Module detail ──

function ModuleDetail({ nodeId, model }: { nodeId: string; model: PreviewModel }) {
  const mod = model.blueprint.moduleInterfaces.find(m => m.responsibilityUnitId === nodeId);

  if (!mod) {
    const archNode = model.blueprint.architecture.nodes.find(n => n.id === nodeId);
    return (
      <Section heading="Architecture Node">
        <p className="detail-drawer__text">{archNode?.label ?? nodeId}</p>
        <p className="detail-drawer__muted" style={{ marginTop: 6 }}>
          No module interface defined for this node.
        </p>
      </Section>
    );
  }

  const contractIds = collectModuleContractIds(mod);

  return (
    <>
      <Section heading="Overview">
        <div className="detail-drawer__kv">
          <div className="detail-drawer__kv-key">Owner</div>
          <div className="detail-drawer__kv-val">
            {mod.owner ?? <span className="detail-drawer__muted">Unassigned</span>}
          </div>
          <div className="detail-drawer__kv-key">Purpose</div>
          <div className="detail-drawer__kv-val">
            {mod.purpose ?? <span className="detail-drawer__muted">Not specified</span>}
          </div>
        </div>
      </Section>

      <Section heading="Allowed Paths" count={mod.owns.length}>
        {mod.owns.length === 0 ? (
          <p className="detail-drawer__muted">No paths owned.</p>
        ) : (
          <ul className="detail-drawer__list">
            {mod.owns.map((p, i) => (
              <li key={i}>
                <code className="detail-drawer__path">{p}</code>
              </li>
            ))}
          </ul>
        )}
      </Section>

      <Section heading="Public Surfaces" count={mod.publicSurfaces.length}>
        {mod.publicSurfaces.length === 0 ? (
          <p className="detail-drawer__muted">No public surfaces exposed.</p>
        ) : (
          mod.publicSurfaces.map((s, i) => <SurfaceCard key={i} surface={s} />)
        )}
      </Section>

      <Section heading="Imports" count={mod.imports.length}>
        {mod.imports.length === 0 ? (
          <p className="detail-drawer__muted">No imports.</p>
        ) : (
          mod.imports.map((imp, i) => (
            <div key={i} className="detail-drawer__import">
              <div className="detail-drawer__import-surface">{imp.surface}</div>
              <div className="detail-drawer__import-meta">from {imp.providerResponsibilityUnitId}</div>
              <div className="detail-drawer__import-meta" style={{ gridColumn: '1 / -1' }}>
                via <span style={{ color: 'var(--accent-blue)' }}>{imp.contractId}</span>
                {imp.allowedUse ? ` · ${imp.allowedUse}` : ''}
              </div>
            </div>
          ))
        )}
      </Section>

      <Section heading="Contract IDs" count={contractIds.length}>
        {contractIds.length === 0 ? (
          <p className="detail-drawer__muted">No contracts referenced.</p>
        ) : (
          <div className="detail-drawer__chip-row">
            {contractIds.map(id => (
              <span key={id} className="detail-drawer__chip detail-drawer__chip--contract">{id}</span>
            ))}
          </div>
        )}
      </Section>
    </>
  );
}

function collectModuleContractIds(mod: ModuleInterface): string[] {
  const ids = new Set<string>();
  mod.publicSurfaces.forEach(s => s.contractIds?.forEach(id => ids.add(id)));
  mod.imports.forEach(i => i.contractId && ids.add(i.contractId));
  return [...ids];
}

// ── Work item detail ──

function WorkItemDetail({ nodeId, model }: { nodeId: string; model: PreviewModel }) {
  const wi = allWorkItems(model).find(w => w.id === nodeId);
  if (!wi) {
    return (
      <Section heading="Work Item">
        <p className="detail-drawer__muted">Work item not found in current board snapshot.</p>
      </Section>
    );
  }

  const moduleName = model.blueprint.moduleInterfaces.find(
    m => m.responsibilityUnitId === wi.responsibilityUnitId,
  )?.moduleName ?? wi.responsibilityUnitId;

  const verificationCommands = collectVerificationCommands(wi, model);
  const evidence = collectWorkItemEvidence(wi, model);
  const statusTags = [
    wi.isBlocked && 'Blocked',
    wi.isRetryReady && 'Retry Ready',
    wi.isRework && 'Rework',
    wi.attemptNumber != null && `Attempt #${wi.attemptNumber}`,
    wi.claim && 'Claimed',
  ].filter(Boolean) as string[];

  return (
    <>
      <Section heading="Overview">
        <div className="detail-drawer__kv">
          <div className="detail-drawer__kv-key">Lane</div>
          <div className="detail-drawer__kv-val">
            <span className={`detail-drawer__lane-badge lane-${wi.lane.replace(/\s+/g, '')}`}>
              {wi.lane}
            </span>
          </div>
          <div className="detail-drawer__kv-key">Module</div>
          <div className="detail-drawer__kv-val">
            {moduleName ?? <span className="detail-drawer__muted">Unassigned</span>}
          </div>
          {wi.claim && (
            <>
              <div className="detail-drawer__kv-key">Worker</div>
              <div className="detail-drawer__kv-val">{wi.claim.workerId}</div>
            </>
          )}
          {wi.nextRetryAt && (
            <>
              <div className="detail-drawer__kv-key">Next Retry</div>
              <div className="detail-drawer__kv-val">{formatTime(wi.nextRetryAt)}</div>
            </>
          )}
        </div>
        {statusTags.length > 0 && (
          <div className="detail-drawer__chip-row" style={{ marginTop: 10 }}>
            {statusTags.map(tag => (
              <span key={tag} className="detail-drawer__chip">{tag}</span>
            ))}
          </div>
        )}
      </Section>

      <Section heading="Dependencies" count={wi.dependsOn.length}>
        {wi.dependsOn.length === 0 ? (
          <p className="detail-drawer__muted">No upstream dependencies.</p>
        ) : (
          <div className="detail-drawer__chip-row">
            {wi.dependsOn.map(dep => (
              <span key={dep} className="detail-drawer__chip detail-drawer__chip--work">{dep}</span>
            ))}
          </div>
        )}
      </Section>

      <Section heading="Allowed Paths" count={wi.allowedPaths.length}>
        {wi.allowedPaths.length === 0 ? (
          <p className="detail-drawer__muted">No path restrictions declared.</p>
        ) : (
          <ul className="detail-drawer__list">
            {wi.allowedPaths.map((p, i) => (
              <li key={i}>
                <code className="detail-drawer__path">{p}</code>
              </li>
            ))}
          </ul>
        )}
      </Section>

      <Section heading="Contracts" count={wi.contractIds.length}>
        {wi.contractIds.length === 0 ? (
          <p className="detail-drawer__muted">No contracts attached.</p>
        ) : (
          <div className="detail-drawer__chip-row">
            {wi.contractIds.map(id => (
              <span key={id} className="detail-drawer__chip detail-drawer__chip--contract">{id}</span>
            ))}
          </div>
        )}
      </Section>

      <Section heading="Verification" count={verificationCommands.length}>
        {verificationCommands.length === 0 ? (
          <p className="detail-drawer__muted">No verification commands declared for this work item.</p>
        ) : (
          <ul className="detail-drawer__list">
            {verificationCommands.map((cmd, i) => (
              <li key={i}>
                <code className="detail-drawer__path">$ {cmd}</code>
              </li>
            ))}
          </ul>
        )}
      </Section>

      <Section heading="Done Evidence" count={evidence.length}>
        {evidence.length === 0 ? (
          <p className="detail-drawer__muted">No evidence recorded yet.</p>
        ) : (
          evidence.map((e, i) => (
            <div key={i} className="detail-drawer__evidence">
              <span className="detail-drawer__evidence-kind">{e.kind}</span>
              <span>{e.summary}</span>
              {e.path && <code className="detail-drawer__evidence-path">{e.path}</code>}
            </div>
          ))
        )}
      </Section>
    </>
  );
}

function collectVerificationCommands(wi: WorkItem, model: PreviewModel): string[] {
  const cmds: string[] = [];
  const next = model.status?.nextCommand;
  if (next && model.run?.workItemId === wi.id) cmds.push(next);
  return cmds;
}

function collectWorkItemEvidence(
  wi: WorkItem,
  model: PreviewModel,
): EvidenceSummaryItem[] {
  const items: EvidenceSummaryItem[] = [];
  const bookkeeping = model.board?.runtimeState?.completedBookkeeping?.[wi.id];
  if (bookkeeping) {
    if (bookkeeping.evidencePath) {
      items.push({ kind: 'evidence', summary: `Completed ${formatTime(bookkeeping.completedAt)}`, path: bookkeeping.evidencePath });
    }
    if (bookkeeping.wikiPath) {
      items.push({ kind: 'wiki', summary: 'Synced to wiki', path: bookkeeping.wikiPath });
    }
  }
  const statusItems = (model.status?.evidenceSummary ?? []).filter(e =>
    e.path?.includes(wi.id) || e.summary?.includes(wi.id),
  );
  items.push(...statusItems);
  return items;
}

// ── Contract detail ──

function ContractDetail({ nodeId, model }: { nodeId: string; model: PreviewModel }) {
  const contract = model.blueprint.contracts.find(c => c.contractId === nodeId);
  const surfaces = collectContractSurfaces(nodeId, model);
  const providers = uniqueIds(surfaces.map(s => s.responsibilityUnitId));
  const consumers = uniqueIds(surfaces.flatMap(s => s.consumers ?? []));

  return (
    <>
      <Section heading="Overview">
        <div className="detail-drawer__kv">
          <div className="detail-drawer__kv-key">Kind</div>
          <div className="detail-drawer__kv-val">{contract?.kind ?? <span className="detail-drawer__muted">Unknown</span>}</div>
          <div className="detail-drawer__kv-key">Path</div>
          <div className="detail-drawer__kv-val">
            {contract?.path ? <code className="detail-drawer__path">{contract.path}</code> : <span className="detail-drawer__muted">—</span>}
          </div>
          {contract?.reason && (
            <>
              <div className="detail-drawer__kv-key">Reason</div>
              <div className="detail-drawer__kv-val">{contract.reason}</div>
            </>
          )}
        </div>
      </Section>

      <Section heading="Providers" count={providers.length}>
        {providers.length === 0 ? (
          <p className="detail-drawer__muted">No provider modules declared.</p>
        ) : (
          <div className="detail-drawer__chip-row">
            {providers.map(id => (
              <span key={id} className="detail-drawer__chip detail-drawer__chip--module">{id}</span>
            ))}
          </div>
        )}
      </Section>

      <Section heading="Consumers" count={consumers.length}>
        {consumers.length === 0 ? (
          <p className="detail-drawer__muted">No consumers declared.</p>
        ) : (
          <div className="detail-drawer__chip-row">
            {consumers.map(id => (
              <span key={id} className="detail-drawer__chip detail-drawer__chip--module">{id}</span>
            ))}
          </div>
        )}
      </Section>

      <Section heading="Signatures" count={surfaces.length}>
        {surfaces.length === 0 ? (
          <p className="detail-drawer__muted">No public surfaces reference this contract.</p>
        ) : (
          surfaces.map((s, i) => (
            <SurfaceCard
              key={i}
              surface={{
                name: s.name,
                kind: s.kind,
                description: s.description,
                consumers: s.consumers ?? [],
                contractIds: s.contractIds ?? [],
                signature: s.signature,
              }}
              moduleName={s.moduleName}
            />
          ))
        )}
      </Section>

      <RelatedWorkItemsForContract contractId={nodeId} model={model} />
    </>
  );
}

function RelatedWorkItemsForContract({ contractId, model }: { contractId: string; model: PreviewModel }) {
  const items = allWorkItems(model).filter(wi => (wi.contractIds ?? []).includes(contractId));
  return (
    <Section heading="Work Items" count={items.length}>
      {items.length === 0 ? (
        <p className="detail-drawer__muted">No work items reference this contract.</p>
      ) : (
        <div className="detail-drawer__chip-row">
          {items.map(wi => (
            <span key={wi.id} className="detail-drawer__chip detail-drawer__chip--work">{wi.id}</span>
          ))}
        </div>
      )}
    </Section>
  );
}

function collectContractSurfaces(contractId: string, model: PreviewModel): ContractSurface[] {
  const dossier = model.blueprint.systemDossier?.contractSurfaces ?? [];
  const dossierMatches = dossier.filter(s => (s.contractIds ?? []).includes(contractId));
  if (dossierMatches.length > 0) return dossierMatches;

  const out: ContractSurface[] = [];
  model.blueprint.moduleInterfaces.forEach(mod => {
    mod.publicSurfaces.forEach(surface => {
      if ((surface.contractIds ?? []).includes(contractId)) {
        out.push({
          responsibilityUnitId: mod.responsibilityUnitId,
          moduleName: mod.moduleName,
          owner: mod.owner,
          name: surface.name,
          kind: surface.kind,
          description: surface.description,
          contractIds: surface.contractIds,
          consumers: surface.consumers ?? [],
          signature: surface.signature,
        });
      }
    });
  });
  return out;
}

// ── Boundary detail ──

function BoundaryDetail({ nodeId, model }: { nodeId: string; model: PreviewModel }) {
  const boundary = model.blueprint.boundaries.find(b => b.responsibilityUnitId === nodeId);
  if (!boundary) {
    return (
      <Section heading="Boundary">
        <p className="detail-drawer__muted">Boundary not found.</p>
      </Section>
    );
  }
  return (
    <>
      <Section heading="Owned Paths" count={boundary.owns.length}>
        {boundary.owns.length === 0 ? (
          <p className="detail-drawer__muted">No owned paths.</p>
        ) : (
          <ul className="detail-drawer__list">
            {boundary.owns.map((p, i) => (
              <li key={i}><code className="detail-drawer__path">{p}</code></li>
            ))}
          </ul>
        )}
      </Section>
      <Section heading="Allowed Contracts" count={boundary.mayUseContracts.length}>
        {boundary.mayUseContracts.length === 0 ? (
          <p className="detail-drawer__muted">No contract dependencies allowed.</p>
        ) : (
          <div className="detail-drawer__chip-row">
            {boundary.mayUseContracts.map(id => (
              <span key={id} className="detail-drawer__chip detail-drawer__chip--contract">{id}</span>
            ))}
          </div>
        )}
      </Section>
    </>
  );
}

// ── Shared atoms ──

function Section({ heading, count, children }: { heading: string; count?: number; children: React.ReactNode }) {
  return (
    <section className="detail-drawer__section">
      <div className="detail-drawer__section-heading">
        <span>{heading}</span>
        {count != null && <span className="detail-drawer__section-count">{count}</span>}
      </div>
      {children}
    </section>
  );
}

function RelatedSection({ selection }: { selection: SelectionState }) {
  const hasAny =
    selection.relatedModuleIds.length +
      selection.relatedContractIds.length +
      selection.relatedWorkItemIds.length >
    0;
  if (!hasAny) return null;

  return (
    <Section heading="Related">
      {selection.relatedModuleIds.length > 0 && (
        <div style={{ marginBottom: 8 }}>
          <div className="detail-drawer__sig-label">Modules</div>
          <div className="detail-drawer__chip-row">
            {selection.relatedModuleIds.map(id => (
              <span key={id} className="detail-drawer__chip detail-drawer__chip--module">{id}</span>
            ))}
          </div>
        </div>
      )}
      {selection.relatedContractIds.length > 0 && (
        <div style={{ marginBottom: 8 }}>
          <div className="detail-drawer__sig-label">Contracts</div>
          <div className="detail-drawer__chip-row">
            {selection.relatedContractIds.map(id => (
              <span key={id} className="detail-drawer__chip detail-drawer__chip--contract">{id}</span>
            ))}
          </div>
        </div>
      )}
      {selection.relatedWorkItemIds.length > 0 && (
        <div>
          <div className="detail-drawer__sig-label">Work Items</div>
          <div className="detail-drawer__chip-row">
            {selection.relatedWorkItemIds.map(id => (
              <span key={id} className="detail-drawer__chip detail-drawer__chip--work">{id}</span>
            ))}
          </div>
        </div>
      )}
    </Section>
  );
}

function SurfaceCard({ surface, moduleName }: { surface: PublicSurface; moduleName?: string }) {
  return (
    <div className="detail-drawer__surface">
      <div className="detail-drawer__surface-header">
        <span className="detail-drawer__surface-name">{surface.name}</span>
        <span className="detail-drawer__surface-kind">{surface.kind}</span>
        {moduleName && (
          <span className="detail-drawer__chip detail-drawer__chip--module" style={{ marginLeft: 'auto' }}>
            {moduleName}
          </span>
        )}
      </div>
      {surface.description && (
        <div className="detail-drawer__surface-desc">{surface.description}</div>
      )}
      <SignatureBlock signature={surface.signature} />
    </div>
  );
}

function SignatureBlock({ signature }: { signature: PublicSurfaceSignature | undefined }) {
  if (!signature) return null;
  const { inputs = [], outputs = [], errors = [] } = signature;
  if (inputs.length === 0 && outputs.length === 0 && errors.length === 0) return null;

  return (
    <div className="detail-drawer__signature">
      {inputs.length > 0 && (
        <div className="detail-drawer__sig-group">
          <div className="detail-drawer__sig-label">Inputs</div>
          <code className="detail-drawer__sig-block">
            {inputs.map((inp, i) => (
              <span key={i}>
                <span className="tok-key">{inp.name}</span>
                {inp.required ? (
                  <span className="tok-req">!</span>
                ) : (
                  <span className="tok-opt">?</span>
                )}
                <span>: </span>
                <span className="tok-type">{inp.type}</span>
                {inp.description && (
                  <span className="tok-comment">  // {inp.description}</span>
                )}
                {i < inputs.length - 1 && '\n'}
              </span>
            ))}
          </code>
        </div>
      )}
      {outputs.length > 0 && (
        <div className="detail-drawer__sig-group">
          <div className="detail-drawer__sig-label">Outputs</div>
          <code className="detail-drawer__sig-block">
            {outputs.map((out, i) => (
              <span key={i}>
                <span className="tok-arrow">→ </span>
                <span className="tok-key">{out.name}</span>
                <span>: </span>
                <span className="tok-type">{out.type}</span>
                {out.description && (
                  <span className="tok-comment">  // {out.description}</span>
                )}
                {i < outputs.length - 1 && '\n'}
              </span>
            ))}
          </code>
        </div>
      )}
      {errors.length > 0 && (
        <div className="detail-drawer__sig-group">
          <div className="detail-drawer__sig-label">Errors</div>
          <code className="detail-drawer__sig-block">
            {errors.map((err, i) => (
              <span key={i}>
                <span className="tok-err">{err.code}</span>
                {err.when && <span className="tok-comment">  when {err.when}</span>}
                {err.handling && <span className="tok-comment">{`\n  ↳ ${err.handling}`}</span>}
                {i < errors.length - 1 && '\n'}
              </span>
            ))}
          </code>
        </div>
      )}
    </div>
  );
}

function uniqueIds(ids: string[]): string[] {
  return [...new Set(ids.filter(Boolean))];
}

function formatTime(iso: string | null | undefined): string {
  if (!iso) return '—';
  try {
    return new Date(iso).toLocaleString();
  } catch {
    return iso;
  }
}

// Unused but exported for parity with prior implementation surface
export type { Contract };
