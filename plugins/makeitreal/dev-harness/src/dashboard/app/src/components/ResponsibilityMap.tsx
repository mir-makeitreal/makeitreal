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
    return <div style={emptyStateStyle}>No owned paths.</div>;
  }

  return (
    <ul style={treeRootStyle}>
      {tree.map(node => (
        <PathTreeBranch key={node.name} node={node} pathKey={node.name} />
      ))}
    </ul>
  );
}

function PathTreeBranch({ node, pathKey }: { node: PathTreeNode; pathKey: string }) {
  const isFile = looksLikeFile(node);

  return (
    <li style={treeItemStyle}>
      <div style={treeLineStyle}>
        <span aria-hidden="true" style={treeIconStyle}>
          {isFile ? <IconFile /> : <IconFolder />}
        </span>
        <code style={treeLabelStyle}>{node.name}</code>
      </div>
      {node.children.length > 0 && (
        <ul style={treeChildStyle}>
          {node.children.map(child => (
            <PathTreeBranch
              key={`${pathKey}/${child.name}`}
              node={child}
              pathKey={`${pathKey}/${child.name}`}
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
      style={{
        ...contractBadgeStyle,
        borderColor: copied ? 'rgba(63, 185, 80, 0.55)' : 'rgba(88, 166, 255, 0.32)',
        color: copied ? 'var(--accent-green)' : 'var(--accent-blue)',
      }}
    >
      <span style={contractBadgeTextStyle}>{contractId}</span>
      {copied && <span style={contractBadgeCopiedStyle}>copied</span>}
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
    <div
      className="responsibility-map"
      style={{
        padding: 16,
        display: 'grid',
        gridTemplateColumns: 'repeat(2, minmax(400px, 1fr))',
        gap: 12,
        overflowX: 'auto',
      }}
    >
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
            className={`responsibility-unit ${isSelected ? 'selected' : ''}`}
            style={{
              border: `1px solid ${isSelected ? 'var(--accent-blue)' : 'var(--border-primary)'}`,
              borderLeft: `4px solid ${color}`,
              borderRadius: 'var(--radius-md)',
              background: isSelected ? 'rgba(88, 166, 255, 0.08)' : 'var(--bg-surface)',
              boxShadow: isSelected ? '0 0 0 1px rgba(88, 166, 255, 0.22)' : 'var(--shadow-sm)',
              cursor: 'pointer',
              minWidth: 0,
              overflow: 'hidden',
            }}
            onClick={() => onSelectModule?.(mod.responsibilityUnitId)}
          >
            <div
              style={{
                padding: '12px 14px',
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'flex-start',
                gap: 12,
              }}
            >
              <div style={{ minWidth: 0 }}>
                <div style={cardTitleRowStyle}>
                  <div style={cardTitleStyle}>{mod.moduleName}</div>
                  <span style={ownerBadgeStyle}>{mod.owner ?? 'unowned'}</span>
                </div>
                {mod.purpose && (
                  <div style={purposeStyle}>
                    {mod.purpose}
                  </div>
                )}
                <div style={unitIdStyle}>{mod.responsibilityUnitId}</div>
              </div>
              <button
                type="button"
                aria-label={`${isExpanded ? 'Collapse' : 'Expand'} ${mod.moduleName} file tree`}
                aria-expanded={isExpanded}
                onClick={e => { e.stopPropagation(); toggleExpand(mod.responsibilityUnitId); }}
                style={expandButtonStyle}
              >
                {isExpanded ? <IconChevronDown /> : <IconChevronRight />}
              </button>
            </div>

            <div style={cardBodyStyle}>
              <section style={sectionStyle}>
                <div style={sectionHeaderStyle}>
                  <span>Owned Paths</span>
                  {hiddenPathCount > 0 && (
                    <span style={sectionCountStyle}>+{hiddenPathCount}</span>
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
                    style={showMoreStyle}
                  >
                    Show full tree
                  </button>
                )}
              </section>

              <section style={sectionStyle}>
                <div style={sectionHeaderStyle}>
                  <span>Contracts</span>
                  <span style={sectionCountStyle}>{contractIds.length}</span>
                </div>
                {contractIds.length > 0 ? (
                  <div style={badgeRowStyle}>
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
                  <div style={emptyStateStyle}>No contract IDs.</div>
                )}
              </section>

              {isExpanded && mod.publicSurfaces.length > 0 && (
                <section style={sectionStyle}>
                  <div style={sectionHeaderStyle}>
                    <span>Public Surfaces</span>
                    <span style={sectionCountStyle}>{mod.publicSurfaces.length}</span>
                  </div>
                  <div style={surfaceListStyle}>
                    {mod.publicSurfaces.map(surface => (
                      <div key={`${surface.kind}:${surface.name}`} style={surfaceRowStyle}>
                        <span style={surfaceKindStyle}>{surface.kind}</span>
                        <span style={surfaceNameStyle}>{surface.name}</span>
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
              style={{
                border: '1px dashed var(--border-primary)',
                borderLeft: `4px solid ${color}`,
                borderRadius: 'var(--radius-md)',
                background: 'var(--bg-secondary)',
                minWidth: 0,
                overflow: 'hidden',
              }}
              onClick={() => onSelectModule?.(boundary.responsibilityUnitId)}
            >
              <div style={{ ...cardHeaderStyle, alignItems: 'flex-start' }}>
                <div style={{ minWidth: 0 }}>
                  <div style={cardTitleRowStyle}>
                    <div style={cardTitleStyle}>{boundary.responsibilityUnitId}</div>
                    <span style={ownerBadgeStyle}>boundary-only</span>
                  </div>
                  <div style={purposeStyle}>No module interface is registered for this boundary.</div>
                </div>
                <button
                  type="button"
                  aria-label={`${isExpanded ? 'Collapse' : 'Expand'} ${boundary.responsibilityUnitId} file tree`}
                  aria-expanded={isExpanded}
                  onClick={event => {
                    event.stopPropagation();
                    toggleExpand(boundary.responsibilityUnitId);
                  }}
                  style={expandButtonStyle}
                >
                  {isExpanded ? <IconChevronDown /> : <IconChevronRight />}
                </button>
              </div>
              <div style={cardBodyStyle}>
                <section style={sectionStyle}>
                  <div style={sectionHeaderStyle}>
                    <span>Owned Paths</span>
                    {hiddenPathCount > 0 && <span style={sectionCountStyle}>+{hiddenPathCount}</span>}
                  </div>
                  <PathTree paths={visiblePaths} />
                  {hiddenPathCount > 0 && (
                    <button
                      type="button"
                      onClick={event => {
                        event.stopPropagation();
                        toggleExpand(boundary.responsibilityUnitId);
                      }}
                      style={showMoreStyle}
                    >
                      Show full tree
                    </button>
                  )}
                </section>

                <section style={sectionStyle}>
                  <div style={sectionHeaderStyle}>
                    <span>Contracts</span>
                    <span style={sectionCountStyle}>{boundary.mayUseContracts.length}</span>
                  </div>
                  {boundary.mayUseContracts.length > 0 ? (
                    <div style={badgeRowStyle}>
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
                    <div style={emptyStateStyle}>No contract IDs.</div>
                  )}
                </section>
              </div>
            </div>
          );
        })}
    </div>
  );
}

const cardHeaderStyle: React.CSSProperties = {
  padding: '12px 14px',
  display: 'flex',
  justifyContent: 'space-between',
  gap: 12,
};

const cardBodyStyle: React.CSSProperties = {
  borderTop: '1px solid var(--border-secondary)',
  display: 'grid',
  gap: 12,
  padding: '12px 14px 14px',
};

const cardTitleRowStyle: React.CSSProperties = {
  alignItems: 'center',
  display: 'flex',
  flexWrap: 'wrap',
  gap: 8,
  minWidth: 0,
};

const cardTitleStyle: React.CSSProperties = {
  color: 'var(--text-primary)',
  fontSize: 13,
  fontWeight: 700,
  lineHeight: 1.25,
  minWidth: 0,
  overflowWrap: 'anywhere',
};

const ownerBadgeStyle: React.CSSProperties = {
  background: 'var(--bg-tertiary)',
  border: '1px solid var(--border-secondary)',
  borderRadius: 'var(--radius-pill)',
  color: 'var(--text-secondary)',
  fontFamily: 'var(--font-mono)',
  fontSize: 10,
  fontWeight: 600,
  lineHeight: 1.2,
  padding: '3px 8px',
};

const purposeStyle: React.CSSProperties = {
  color: 'var(--text-secondary)',
  fontSize: 11,
  lineHeight: 1.45,
  marginTop: 6,
  overflowWrap: 'anywhere',
};

const unitIdStyle: React.CSSProperties = {
  color: 'var(--text-tertiary)',
  fontFamily: 'var(--font-mono)',
  fontSize: 10,
  marginTop: 6,
  overflowWrap: 'anywhere',
};

const expandButtonStyle: React.CSSProperties = {
  alignItems: 'center',
  background: 'var(--bg-tertiary)',
  border: '1px solid var(--border-primary)',
  borderRadius: 'var(--radius-md)',
  color: 'var(--text-secondary)',
  cursor: 'pointer',
  display: 'inline-flex',
  flex: '0 0 auto',
  fontFamily: 'var(--font-mono)',
  fontSize: 11,
  height: 28,
  justifyContent: 'center',
  lineHeight: 1,
  width: 28,
};

const sectionStyle: React.CSSProperties = {
  minWidth: 0,
};

const sectionHeaderStyle: React.CSSProperties = {
  alignItems: 'center',
  color: 'var(--text-tertiary)',
  display: 'flex',
  fontSize: 10,
  fontWeight: 700,
  justifyContent: 'space-between',
  letterSpacing: 0.4,
  marginBottom: 8,
  textTransform: 'uppercase',
};

const sectionCountStyle: React.CSSProperties = {
  background: 'var(--bg-tertiary)',
  borderRadius: 'var(--radius-pill)',
  color: 'var(--text-tertiary)',
  fontFamily: 'var(--font-mono)',
  fontSize: 10,
  fontWeight: 600,
  padding: '2px 7px',
};

const treeRootStyle: React.CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  gap: 3,
  listStyle: 'none',
  margin: 0,
  padding: 0,
};

const treeChildStyle: React.CSSProperties = {
  borderLeft: '1px solid var(--border-secondary)',
  display: 'flex',
  flexDirection: 'column',
  gap: 3,
  listStyle: 'none',
  margin: '3px 0 0 9px',
  padding: '0 0 0 12px',
};

const treeItemStyle: React.CSSProperties = {
  minWidth: 0,
};

const treeLineStyle: React.CSSProperties = {
  alignItems: 'center',
  display: 'flex',
  gap: 6,
  minWidth: 0,
};

const treeIconStyle: React.CSSProperties = {
  flex: '0 0 auto',
  fontSize: 12,
  lineHeight: 1,
};

const treeLabelStyle: React.CSSProperties = {
  color: 'var(--text-secondary)',
  fontFamily: 'var(--font-mono)',
  fontSize: 10,
  lineHeight: 1.4,
  overflowWrap: 'anywhere',
};

const badgeRowStyle: React.CSSProperties = {
  display: 'flex',
  flexWrap: 'wrap',
  gap: 6,
};

const contractBadgeStyle: React.CSSProperties = {
  alignItems: 'center',
  background: 'rgba(88, 166, 255, 0.08)',
  border: '1px solid rgba(88, 166, 255, 0.32)',
  borderRadius: 'var(--radius-pill)',
  cursor: 'pointer',
  display: 'inline-flex',
  gap: 6,
  minWidth: 0,
  padding: '4px 8px',
};

const contractBadgeTextStyle: React.CSSProperties = {
  fontFamily: 'var(--font-mono)',
  fontSize: 10,
  fontWeight: 600,
  lineHeight: 1.2,
  overflowWrap: 'anywhere',
};

const contractBadgeCopiedStyle: React.CSSProperties = {
  color: 'var(--accent-green)',
  fontSize: 9,
  fontWeight: 700,
  lineHeight: 1,
  textTransform: 'uppercase',
};

const emptyStateStyle: React.CSSProperties = {
  color: 'var(--text-tertiary)',
  fontSize: 11,
  lineHeight: 1.4,
};

const showMoreStyle: React.CSSProperties = {
  background: 'transparent',
  border: 'none',
  color: 'var(--accent-blue)',
  cursor: 'pointer',
  fontSize: 11,
  fontWeight: 600,
  marginTop: 8,
  padding: 0,
};

const surfaceListStyle: React.CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  gap: 6,
};

const surfaceRowStyle: React.CSSProperties = {
  alignItems: 'center',
  display: 'flex',
  gap: 8,
  minWidth: 0,
};

const surfaceKindStyle: React.CSSProperties = {
  background: 'rgba(188, 140, 255, 0.12)',
  borderRadius: 'var(--radius-sm)',
  color: 'var(--accent-purple)',
  flex: '0 0 auto',
  fontSize: 10,
  fontWeight: 700,
  padding: '2px 6px',
  textTransform: 'uppercase',
};

const surfaceNameStyle: React.CSSProperties = {
  color: 'var(--text-secondary)',
  fontFamily: 'var(--font-mono)',
  fontSize: 10,
  overflowWrap: 'anywhere',
};
