import React from 'react';
import type { ModuleInterface, PublicSurface } from '../types/model';
import { useDashboardStore } from '../store/dashboard-store';

interface Props {
  modules: ModuleInterface[];
}

function SurfaceLine({ surface }: { surface: PublicSurface }) {
  return (
    <li className="module-doc__surface-row">
      <span className="module-doc__surface-kind">{surface.kind}</span>
      <code className="module-doc__surface-name">{surface.name}</code>
      {surface.description && (
        <span className="module-doc__surface-desc">{surface.description}</span>
      )}
    </li>
  );
}

function ModuleEntry({ mod }: { mod: ModuleInterface }) {
  const selectNode = useDashboardStore(s => s.selectNode);
  return (
    <article
      id={`module-${mod.responsibilityUnitId}`}
      className="module-doc"
      onClick={() => selectNode(mod.responsibilityUnitId, 'module')}
    >
      <header className="module-doc__head">
        <h3 className="module-doc__name">{mod.moduleName}</h3>
        <div className="module-doc__meta">
          <span className="module-doc__id">{mod.responsibilityUnitId}</span>
          <span className="module-doc__owner">{mod.owner ?? 'unowned'}</span>
        </div>
      </header>

      {mod.purpose && <p className="module-doc__purpose">{mod.purpose}</p>}

      <div className="module-doc__columns">
        <div>
          <div className="module-doc__col-label">Owned paths</div>
          {mod.owns.length === 0 ? (
            <p className="module-doc__col-empty">None.</p>
          ) : (
            <ul className="module-doc__paths">
              {mod.owns.map(p => (
                <li key={p}><code>{p}</code></li>
              ))}
            </ul>
          )}
        </div>
        <div>
          <div className="module-doc__col-label">
            Public surfaces
            <span className="module-doc__col-count">{mod.publicSurfaces.length}</span>
          </div>
          {mod.publicSurfaces.length === 0 ? (
            <p className="module-doc__col-empty">None.</p>
          ) : (
            <ul className="module-doc__surfaces">
              {mod.publicSurfaces.map(s => (
                <SurfaceLine key={`${s.kind}:${s.name}`} surface={s} />
              ))}
            </ul>
          )}
        </div>
      </div>
    </article>
  );
}

export function ModulesSection({ modules }: Props) {
  if (modules.length === 0) {
    return <p className="doc-empty">No module interfaces declared in this blueprint.</p>;
  }
  return (
    <div className="modules-section">
      {modules.map(m => (
        <ModuleEntry key={m.responsibilityUnitId} mod={m} />
      ))}
    </div>
  );
}
