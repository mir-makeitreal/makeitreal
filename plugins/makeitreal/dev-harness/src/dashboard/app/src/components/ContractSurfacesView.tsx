import React, { useMemo, useState } from 'react';
import { useDashboardStore } from '../store/dashboard-store';
import type {
  ContractSurface,
  ModuleInterface,
  PublicSurfaceError,
  PublicSurfaceInput,
  PublicSurfaceOutput,
} from '../types/model';

interface ModuleGroup {
  responsibilityUnitId: string;
  moduleName: string;
  owner: string | null;
  purpose: string | null;
  surfaces: ContractSurface[];
}

function groupSurfaces(
  surfaces: ContractSurface[],
  interfaces: ModuleInterface[],
): ModuleGroup[] {
  const lookup = new Map<string, ModuleInterface>();
  for (const mi of interfaces) lookup.set(mi.responsibilityUnitId, mi);

  const byModule = new Map<string, ModuleGroup>();
  for (const s of surfaces) {
    const key = s.responsibilityUnitId || s.moduleName;
    let group = byModule.get(key);
    if (!group) {
      const iface = lookup.get(s.responsibilityUnitId);
      group = {
        responsibilityUnitId: s.responsibilityUnitId,
        moduleName: s.moduleName || iface?.moduleName || key,
        owner: s.owner ?? iface?.owner ?? null,
        purpose: iface?.purpose ?? null,
        surfaces: [],
      };
      byModule.set(key, group);
    }
    group.surfaces.push(s);
  }
  return Array.from(byModule.values()).sort((a, b) => a.moduleName.localeCompare(b.moduleName));
}

function usageExample(surface: ContractSurface): string {
  const args = surface.signature.inputs
    .map(input => `  ${input.name}: <${input.type}>${input.required ? '' : '?'}`)
    .join(',\n');
  const outputType = surface.signature.outputs.length === 0
    ? 'void'
    : surface.signature.outputs.length === 1
      ? surface.signature.outputs[0].type
      : surface.signature.outputs.map(o => o.type).join(' | ');

  const inputsBlock = args ? `{\n${args}\n}` : '';
  const consumer = surface.consumers[0] ?? surface.moduleName;
  return [
    `// consumer: ${consumer}`,
    `import { ${surface.name} } from '${surface.moduleName}';`,
    '',
    `const result: ${outputType} = await ${surface.name}(${inputsBlock});`,
  ].join('\n');
}

function InputsTable({ inputs }: { inputs: PublicSurfaceInput[] }) {
  if (inputs.length === 0) return <div className="surfaces-empty">No inputs.</div>;
  return (
    <table className="surfaces-table">
      <thead>
        <tr>
          <th>Field</th>
          <th>Type</th>
          <th>Required</th>
          <th>Description</th>
        </tr>
      </thead>
      <tbody>
        {inputs.map(input => (
          <tr key={input.name}>
            <td><code className="surfaces-table__name">{input.name}</code></td>
            <td><code className="surfaces-table__type">{input.type}</code></td>
            <td>{input.required ? <span className="surfaces-required">required</span> : <span className="surfaces-optional">optional</span>}</td>
            <td>{input.description || '—'}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function OutputsTable({ outputs }: { outputs: PublicSurfaceOutput[] }) {
  if (outputs.length === 0) return <div className="surfaces-empty">No outputs.</div>;
  return (
    <table className="surfaces-table">
      <thead>
        <tr>
          <th>Field</th>
          <th>Type</th>
          <th>Description</th>
        </tr>
      </thead>
      <tbody>
        {outputs.map(o => (
          <tr key={o.name}>
            <td><code className="surfaces-table__name">{o.name}</code></td>
            <td><code className="surfaces-table__type">{o.type}</code></td>
            <td>{o.description || '—'}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function ErrorsTable({ errors }: { errors: PublicSurfaceError[] }) {
  if (errors.length === 0) return <div className="surfaces-empty">No documented errors.</div>;
  return (
    <table className="surfaces-table">
      <thead>
        <tr>
          <th>Code</th>
          <th>When</th>
          <th>Handling</th>
        </tr>
      </thead>
      <tbody>
        {errors.map(e => (
          <tr key={e.code}>
            <td><code className="surfaces-table__error">{e.code}</code></td>
            <td>{e.when || '—'}</td>
            <td>{e.handling || '—'}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function SurfaceBlock({ surface }: { surface: ContractSurface }) {
  const [open, setOpen] = useState(false);
  return (
    <details className="surface-block" open={open} onToggle={e => setOpen((e.target as HTMLDetailsElement).open)}>
      <summary className="surface-block__summary">
        <span className="surface-block__name">
          <span className="surface-block__caret">{open ? '−' : '+'}</span>
          <code>{surface.name}</code>
        </span>
        <span className="surface-block__kind">{surface.kind}</span>
        {surface.contractIds.length > 0 && (
          <span className="surface-block__contracts">
            {surface.contractIds.length} contract{surface.contractIds.length === 1 ? '' : 's'}
          </span>
        )}
      </summary>

      <div className="surface-block__body">
        {surface.description && <p className="surface-block__desc">{surface.description}</p>}

        {surface.contractIds.length > 0 && (
          <div className="surface-block__chips">
            {surface.contractIds.map(id => (
              <code key={id} className="surface-block__chip surface-block__chip--contract">{id}</code>
            ))}
          </div>
        )}

        {surface.consumers.length > 0 && (
          <div className="surface-block__chips">
            <span className="surface-block__chip-label">Consumed by</span>
            {surface.consumers.map(c => (
              <code key={c} className="surface-block__chip">{c}</code>
            ))}
          </div>
        )}

        <div className="surface-block__section">
          <div className="surface-block__section-title">Parameters</div>
          <InputsTable inputs={surface.signature.inputs} />
        </div>

        <div className="surface-block__section">
          <div className="surface-block__section-title">Returns</div>
          <OutputsTable outputs={surface.signature.outputs} />
        </div>

        <div className="surface-block__section">
          <div className="surface-block__section-title">Errors</div>
          <ErrorsTable errors={surface.signature.errors} />
        </div>

        <div className="surface-block__section">
          <div className="surface-block__section-title">Example</div>
          <pre className="surface-code"><code>{usageExample(surface)}</code></pre>
        </div>
      </div>
    </details>
  );
}

export function ContractSurfacesView() {
  const model = useDashboardStore(s => s.model);
  if (!model) return null;

  const surfaces = model.blueprint.systemDossier.contractSurfaces ?? [];
  const interfaces = model.blueprint.moduleInterfaces ?? [];
  const groups = useMemo(() => groupSurfaces(surfaces, interfaces), [surfaces, interfaces]);

  if (groups.length === 0) {
    return (
      <div className="surfaces-view">
        <div className="surfaces-empty">No contract surfaces declared in this blueprint.</div>
      </div>
    );
  }

  return (
    <div className="surfaces-view">
      <header className="surfaces-view__header">
        <div className="surfaces-view__eyebrow">SDK Reference</div>
        <h1 className="surfaces-view__title">Contract Surfaces</h1>
        <p className="surfaces-view__lead">
          Authoritative reference for every public surface declared across modules. Inputs,
          outputs, errors, and example usage — extracted from the system dossier.
        </p>
      </header>

      <div className="surfaces-groups">
        {groups.map(group => (
          <section key={group.responsibilityUnitId || group.moduleName} className="surfaces-group">
            <header className="surfaces-group__header">
              <div>
                <h2 className="surfaces-group__name">{group.moduleName}</h2>
                <div className="surfaces-group__meta">
                  {group.owner && <span>Owner: {group.owner}</span>}
                  <span>{group.surfaces.length} surface{group.surfaces.length === 1 ? '' : 's'}</span>
                </div>
              </div>
              {group.purpose && <p className="surfaces-group__purpose">{group.purpose}</p>}
            </header>

            <div className="surfaces-group__list">
              {group.surfaces.map(s => (
                <SurfaceBlock key={`${s.responsibilityUnitId}-${s.name}`} surface={s} />
              ))}
            </div>
          </section>
        ))}
      </div>
    </div>
  );
}
