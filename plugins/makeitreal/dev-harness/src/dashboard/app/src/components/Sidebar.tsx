import React from 'react';
import { useDashboardStore } from '../store/dashboard-store';

export interface SidebarSection {
  id: string;
  label: string;
}

export interface SidebarProps {
  sections: SidebarSection[];
  activeSection: string;
  onNavigate: (id: string) => void;
  connected: boolean;
}

export function Sidebar({ sections, activeSection, onNavigate, connected }: SidebarProps) {
  const model = useDashboardStore(s => s.model);
  const modules = model?.blueprint.moduleInterfaces ?? [];

  function handleClick(event: React.MouseEvent<HTMLAnchorElement>, id: string) {
    event.preventDefault();
    const target = document.getElementById(id);
    if (target) {
      target.scrollIntoView({ behavior: 'smooth', block: 'start' });
      onNavigate(id);
    }
  }

  return (
    <aside className="doc-sidebar">
      <div className="doc-sidebar__brand">
        <span className="doc-sidebar__brand-mark">MIR</span>
        <span className="doc-sidebar__brand-text">Architecture Dossier</span>
      </div>

      <nav className="doc-sidebar__nav" aria-label="Document sections">
        <ul className="doc-toc">
          {sections.map(section => (
            <li key={section.id}>
              <a
                href={`#${section.id}`}
                onClick={e => handleClick(e, section.id)}
                className={`doc-toc__link${activeSection === section.id ? ' doc-toc__link--active' : ''}`}
              >
                {section.label}
              </a>
            </li>
          ))}
        </ul>

        {modules.length > 0 && (
          <div className="doc-sidebar__group">
            <div className="doc-sidebar__group-label">Modules</div>
            <ul className="doc-toc doc-toc--nested">
              {modules.map(mod => (
                <li key={mod.responsibilityUnitId}>
                  <a
                    href={`#module-${mod.responsibilityUnitId}`}
                    onClick={e => handleClick(e, `module-${mod.responsibilityUnitId}`)}
                    className="doc-toc__link doc-toc__link--sub"
                  >
                    {mod.moduleName}
                  </a>
                </li>
              ))}
            </ul>
          </div>
        )}
      </nav>

      <div className="doc-sidebar__footer">
        <span className={`doc-sidebar__status doc-sidebar__status--${connected ? 'live' : 'offline'}`}>
          <span className="doc-sidebar__status-dot" />
          {connected ? 'Live' : 'Offline'}
        </span>
      </div>
    </aside>
  );
}
