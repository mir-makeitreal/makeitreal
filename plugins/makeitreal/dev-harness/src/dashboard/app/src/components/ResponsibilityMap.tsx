import React, { useMemo, useState } from 'react';
import type { Boundary, ModuleInterface } from '../types/model';
import { EmptyState } from './EmptyState';
import { IconChevronDown, IconChevronRight, IconFile, IconFolder, IconRing } from './Icons';

export interface ResponsibilityMapProps {
  boundaries: Boundary[];
  moduleInterfaces: ModuleInterface[];
  onSelectModule?: (moduleId: string) => void;
  selectedModuleId?: string | null;
}

interface PathTreeNode {
  name: string;
  terminal: boolean;
  children: PathTreeNode[];
}

interface MutablePathTreeNode {
  name: string;
  terminal: boolean;
  children: Map<string, MutablePathTreeNode>;
}

const UNIT_COLORS = ['#58a6ff', '#3fb950', '#d29922', '#f85149', '#bc8cff', '#39c5cf'];
const COLLAPSED_PATH_LIMIT = 4;

function hashToColor(value: string) {
  let hash = 0;
  for (let i = 0; i < value.length; i += 1) {
    hash = (hash * 31 + value.charCodeAt(i)) >>> 0;
  }
  return UNIT_COLORS[hash % UNIT_COLORS.length];
}

function uniqueStrings(values: string[]) {
  return Array.from(new Set(values.filter(Boolean)));
}

function copyText(value: string) {
  if (navigator.clipboard?.writeText) {
    return navigator.clipboard.writeText(value);
  }

  const textarea = document.createElement('textarea');
  textarea.value = value;
  textarea.setAttribute('readonly', '');
  textarea.style.position = 'fixed';
  textarea.style.opacity = '0';
  document.body.appendChild(textarea);
  textarea.select();
  document.execCommand('copy');
  document.body.removeChild(textarea);
  return Promise.resolve();
}

function pathSegments(path: string) {
  const trimmed = path.trim().replace(/^\.\//, '');
  return trimmed.split('/').filter(Boolean);
}

function buildPathTree(paths: string[]): PathTreeNode[] {
  const root = new Map<string, MutablePathTreeNode>();

  paths.forEach(path => {
    const segments = pathSegments(path);
    if (segments.length === 0) return;

    let currentLevel = root;
    segments.forEach((segment, index) => {
      let node = currentLevel.get(segment);
      if (!node) {
        node = { name: segment, terminal: false, children: new Map() };
        currentLevel.set(segment, node);
      }
      if (index === segments.length - 1) {
        node.terminal = true;
      }
      currentLevel = node.children;
    });
  });

  return normalizeTree(root);
}

function normalizeTree(nodes: Map<string, MutablePathTreeNode>): PathTreeNode[] {
  return Array.from(nodes.values())
    .map(node => ({
      name: node.name,
      terminal: node.terminal,
      children: normalizeTree(node.children),
    }))
    .sort((a, b) => {
      const aIsFolder = a.children.length > 0;
      const bIsFolder = b.children.length > 0;
      if (aIsFolder !== bIsFolder) return aIsFolder ? -1 : 1;
      return a.name.localeCompare(b.name);
    });
}

function looksLikeFile(node: PathTreeNode) {
  return node.children.length === 0 && /(?:\.[a-z0-9]+|\*)/i.test(node.name);
}

function PathTree({ paths }: { paths: string[] }) {
  const tree = buildPathTree(paths);

  if (tree.length === 0) {
    return <div className="rmap-empty">No owned paths.</div>;
  }

  return (
    <ul className="rmap-tree">
      {tree.map(node => (
        <PathTreeBranch key={node.name} node={node} pathKey={node.name} depth={0} />
      ))}
    </ul>
  );
}

function PathTreeBranch({ node, pathKey, depth }: { node: PathTreeNode; pathKey: string; depth: number }) {
  const isFile = looksLikeFile(node);
  const isFolder = node.children.length > 0;

  return (
    <li className="rmap-tree__item">
      <div className={`rmap-tree__line rmap-tree__line--${isFolder ? 'folder' : isFile ? 'file' : 'leaf'}`}>
        <span aria-hidden="true" className="rmap-tree__icon">
          {isFolder ? <IconFolder /> : <IconFile />}
        </span>
        <code className="rmap-tree__label">{node.name}</code>
      </div>
      {isFolder && (
        <ul className="rmap-tree__children">
          {node.children.map(child => (
            <PathTreeBranch
              key={`${pathKey}/${child.name}`}
              node={child}
              pathKey={`${pathKey}/${child.name}`}
              depth={depth + 1}
            />
          ))}
        </ul>
      )}
    </li>
  );
}

function ContractBadge({
  contractId,
  copied,
  onCopy,
}: {
  contractId: string;
  copied: boolean;
  onCopy: (contractId: string) => void;
}) {
  return (
    <button
      type="button"
      aria-label={`Copy contract ID ${contractId}`}
      title="Copy contract ID"
      onClick={event => {
        event.stopPropagation();
        onCopy(contractId);
      }}
      className={`rmap-contract-badge${copied ? ' rmap-contract-badge--copied' : ''} transition-colors`}
    >
      <span className="rmap-contract-badge__text">{contractId}</span>
      {copied && <span className="rmap-contract-badge__copied">copied</span>}
    </button>
  );
}

export function ResponsibilityMap({
  boundaries,
  moduleInterfaces,
  onSelectModule,
  selectedModuleId,
}: ResponsibilityMapProps) {
  const [expandedModules, setExpandedModules] = useState<Set<string>>(new Set());
  const [copiedContractId, setCopiedContractId] = useState<string | null>(null);

  function toggleExpand(moduleId: string) {
    setExpandedModules(prev => {
      const next = new Set(prev);
      if (next.has(moduleId)) next.delete(moduleId);
      else next.add(moduleId);
      return next;
    });
  }

  function handleCopyContract(contractId: string) {
    copyText(contractId).then(() => {
      setCopiedContractId(contractId);
      window.setTimeout(() => setCopiedContractId(current => (
        current === contractId ? null : current
      )), 1600);
    });
  }

  const boundaryMap = useMemo(
    () => new Map(boundaries.map(b => [b.responsibilityUnitId, b])),
    [boundaries],
  );

  const moduleIds = useMemo(
    () => new Set(moduleInterfaces.map(mod => mod.responsibilityUnitId)),
    [moduleInterfaces],
  );

  if (moduleInterfaces.length === 0 && boundaries.length === 0) {
    return (
      <EmptyState
        icon={<IconRing />}
        title="No boundaries"
        message="No responsibility boundaries are defined for this blueprint."
      />
    );
  }

  return (
    <div className="responsibility-map rmap-grid">
      {moduleInterfaces.map(mod => {
        const boundary = boundaryMap.get(mod.responsibilityUnitId);
        const isSelected = selectedModuleId === mod.responsibilityUnitId;
        const isExpanded = expandedModules.has(mod.responsibilityUnitId);
        const color = hashToColor(mod.responsibilityUnitId);
        const ownedPaths = uniqueStrings([...mod.owns, ...(boundary?.owns ?? [])]);
        const visiblePaths = isExpanded ? ownedPaths : ownedPaths.slice(0, COLLAPSED_PATH_LIMIT);
        const hiddenPathCount = ownedPaths.length - visiblePaths.length;
        const contractIds = uniqueStrings([
          ...(boundary?.mayUseContracts ?? []),
          ...mod.publicSurfaces.flatMap(surface => surface.contractIds),
        ]);

        return (
          <div
            key={mod.responsibilityUnitId}
            className={`rmap-card${isSelected ? ' rmap-card--selected' : ''}`}
            ref={el => { if (el) el.style.setProperty('--rmap-accent', color); }}
            onClick={() => onSelectModule?.(mod.responsibilityUnitId)}
          >
            <div className="rmap-card__head">
              <div className="rmap-card__head-main">
                <div className="rmap-card__title-row">
                  <div className="rmap-card__title">{mod.moduleName}</div>
                  <span className="rmap-owner-badge">{mod.owner ?? 'unowned'}</span>
                </div>
                {mod.purpose && (
                  <div className="rmap-card__purpose">{mod.purpose}</div>
                )}
                <div className="rmap-card__unit-id">{mod.responsibilityUnitId}</div>
              </div>
              <button
                type="button"
                aria-label={`${isExpanded ? 'Collapse' : 'Expand'} ${mod.moduleName} file tree`}
                aria-expanded={isExpanded}
                onClick={e => { e.stopPropagation(); toggleExpand(mod.responsibilityUnitId); }}
                className="rmap-expand-btn transition-colors"
              >
                {isExpanded ? <IconChevronDown /> : <IconChevronRight />}
              </button>
            </div>

            <div className="rmap-card__body">
              <section className="rmap-section">
                <div className="rmap-section__header">
                  <span>Owned Paths</span>
                  {hiddenPathCount > 0 && (
                    <span className="rmap-section__count">+{hiddenPathCount}</span>
                  )}
                </div>
                <PathTree paths={visiblePaths} />
                {hiddenPathCount > 0 && (
                  <button
                    type="button"
                    onClick={event => {
                      event.stopPropagation();
                      toggleExpand(mod.responsibilityUnitId);
                    }}
                    className="rmap-show-more"
                  >
                    Show full tree
                  </button>
                )}
              </section>

              <section className="rmap-section">
                <div className="rmap-section__header">
                  <span>Contracts</span>
                  <span className="rmap-section__count">{contractIds.length}</span>
                </div>
                {contractIds.length > 0 ? (
                  <div className="rmap-badge-row">
                    {contractIds.map(contractId => (
                      <ContractBadge
                        key={contractId}
                        contractId={contractId}
                        copied={copiedContractId === contractId}
                        onCopy={handleCopyContract}
                      />
                    ))}
                  </div>
                ) : (
                  <div className="rmap-empty">No contract IDs.</div>
                )}
              </section>

              {isExpanded && mod.publicSurfaces.length > 0 && (
                <section className="rmap-section">
                  <div className="rmap-section__header">
                    <span>Public Surfaces</span>
                    <span className="rmap-section__count">{mod.publicSurfaces.length}</span>
                  </div>
                  <div className="rmap-surface-list">
                    {mod.publicSurfaces.map(surface => (
                      <div key={`${surface.kind}:${surface.name}`} className="rmap-surface-row">
                        <span className="rmap-surface-kind">{surface.kind}</span>
                        <span className="rmap-surface-name">{surface.name}</span>
                      </div>
                    ))}
                  </div>
                </section>
              )}
            </div>
          </div>
        );
      })}

      {boundaries
        .filter(b => !moduleIds.has(b.responsibilityUnitId))
        .map(boundary => {
          const isExpanded = expandedModules.has(boundary.responsibilityUnitId);
          const color = hashToColor(boundary.responsibilityUnitId);
          const visiblePaths = isExpanded
            ? boundary.owns
            : boundary.owns.slice(0, COLLAPSED_PATH_LIMIT);
          const hiddenPathCount = boundary.owns.length - visiblePaths.length;

          return (
            <div
              key={boundary.responsibilityUnitId}
              className="rmap-card rmap-card--boundary"
              ref={el => { if (el) el.style.setProperty('--rmap-accent', color); }}
              onClick={() => onSelectModule?.(boundary.responsibilityUnitId)}
            >
              <div className="rmap-card__head">
                <div className="rmap-card__head-main">
                  <div className="rmap-card__title-row">
                    <div className="rmap-card__title">{boundary.responsibilityUnitId}</div>
                    <span className="rmap-owner-badge">boundary-only</span>
                  </div>
                  <div className="rmap-card__purpose">
                    No module interface is registered for this boundary.
                  </div>
                </div>
                <button
                  type="button"
                  aria-label={`${isExpanded ? 'Collapse' : 'Expand'} ${boundary.responsibilityUnitId} file tree`}
                  aria-expanded={isExpanded}
                  onClick={event => {
                    event.stopPropagation();
                    toggleExpand(boundary.responsibilityUnitId);
                  }}
                  className="rmap-expand-btn transition-colors"
                >
                  {isExpanded ? <IconChevronDown /> : <IconChevronRight />}
                </button>
              </div>
              <div className="rmap-card__body">
                <section className="rmap-section">
                  <div className="rmap-section__header">
                    <span>Owned Paths</span>
                    {hiddenPathCount > 0 && <span className="rmap-section__count">+{hiddenPathCount}</span>}
                  </div>
                  <PathTree paths={visiblePaths} />
                  {hiddenPathCount > 0 && (
                    <button
                      type="button"
                      onClick={event => {
                        event.stopPropagation();
                        toggleExpand(boundary.responsibilityUnitId);
                      }}
                      className="rmap-show-more"
                    >
                      Show full tree
                    </button>
                  )}
                </section>

                <section className="rmap-section">
                  <div className="rmap-section__header">
                    <span>Contracts</span>
                    <span className="rmap-section__count">{boundary.mayUseContracts.length}</span>
                  </div>
                  {boundary.mayUseContracts.length > 0 ? (
                    <div className="rmap-badge-row">
                      {boundary.mayUseContracts.map(contractId => (
                        <ContractBadge
                          key={contractId}
                          contractId={contractId}
                          copied={copiedContractId === contractId}
                          onCopy={handleCopyContract}
                        />
                      ))}
                    </div>
                  ) : (
                    <div className="rmap-empty">No contract IDs.</div>
                  )}
                </section>
              </div>
            </div>
          );
        })}
    </div>
  );
}
