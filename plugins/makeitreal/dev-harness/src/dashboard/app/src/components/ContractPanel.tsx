import React, { useState } from 'react';
import type {
  ModuleInterface,
  PublicSurface,
  PublicSurfaceError,
  PublicSurfaceInput,
  PublicSurfaceOutput,
} from '../types/model';

interface Props {
  moduleInterfaces: ModuleInterface[];
}

function outputTypeLabel(outputs: PublicSurfaceOutput[]) {
  if (outputs.length === 0) return 'void';
  if (outputs.length === 1) return outputs[0].type;
  return outputs.map(output => output.type).join(' | ');
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

function CopyContractButton({
  contractId,
  copiedContractId,
  onCopy,
}: {
  contractId: string;
  copiedContractId: string | null;
  onCopy: (contractId: string) => void;
}) {
  const copied = copiedContractId === contractId;

  return (
    <button
      type="button"
      className="copy-contract-button"
      aria-label={`Copy contract ID ${contractId}`}
      onClick={() => onCopy(contractId)}
    >
      {copied ? 'Copied' : 'Copy contract ID'}
    </button>
  );
}

function ContractIdChip({
  contractId,
  copiedContractId,
  onCopy,
}: {
  contractId: string;
  copiedContractId: string | null;
  onCopy: (contractId: string) => void;
}) {
  return (
    <span className="contract-id-chip">
      <code>{contractId}</code>
      <CopyContractButton
        contractId={contractId}
        copiedContractId={copiedContractId}
        onCopy={onCopy}
      />
    </span>
  );
}

function SurfaceSignature({ surface }: { surface: PublicSurface }) {
  return (
    <code className="contract-signature" aria-label={`${surface.name} contract signature`}>
      <span className="sig-function">{surface.name}</span>
      <span className="sig-punctuation">(</span>
      {surface.signature.inputs.map((input, index) => (
        <React.Fragment key={input.name}>
          {index > 0 && <span className="sig-punctuation">, </span>}
          <span className="sig-param">{input.name}</span>
          {!input.required && <span className="sig-punctuation">?</span>}
          <span className="sig-punctuation">: </span>
          <span className="sig-type">{input.type}</span>
        </React.Fragment>
      ))}
      <span className="sig-punctuation">): </span>
      <span className="sig-type">{outputTypeLabel(surface.signature.outputs)}</span>
    </code>
  );
}

function InputsTable({ inputs }: { inputs: PublicSurfaceInput[] }) {
  if (inputs.length === 0) return null;

  return (
    <div className="signature-table-block">
      <div className="sig-header">Inputs</div>
      <table className="signature-table">
        <thead>
          <tr>
            <th>Name</th>
            <th>Type</th>
            <th>Required</th>
            <th>Description</th>
          </tr>
        </thead>
        <tbody>
          {inputs.map(input => (
            <tr key={input.name}>
              <td><span className="sig-param">{input.name}</span></td>
              <td><span className="sig-type">{input.type}</span></td>
              <td>{input.required ? 'Yes' : 'No'}</td>
              <td>{input.description || '-'}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function OutputsTable({ outputs }: { outputs: PublicSurfaceOutput[] }) {
  if (outputs.length === 0) return null;

  return (
    <div className="signature-table-block">
      <div className="sig-header">Outputs</div>
      <table className="signature-table">
        <thead>
          <tr>
            <th>Name</th>
            <th>Type</th>
            <th>Description</th>
          </tr>
        </thead>
        <tbody>
          {outputs.map(output => (
            <tr key={output.name}>
              <td><span className="sig-param">{output.name}</span></td>
              <td><span className="sig-type">{output.type}</span></td>
              <td>{output.description || '-'}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function ErrorsTable({ errors }: { errors: PublicSurfaceError[] }) {
  if (errors.length === 0) return null;

  return (
    <div className="signature-table-block">
      <div className="sig-header">Errors</div>
      <table className="signature-table">
        <thead>
          <tr>
            <th>Code</th>
            <th>When</th>
            <th>Handling</th>
          </tr>
        </thead>
        <tbody>
          {errors.map(error => (
            <tr key={error.code}>
              <td><span className="sig-error">{error.code}</span></td>
              <td>{error.when}</td>
              <td>{error.handling || '-'}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export function ContractPanel({ moduleInterfaces }: Props) {
  const [copiedContractId, setCopiedContractId] = useState<string | null>(null);

  const handleCopyContractId = (contractId: string) => {
    void copyText(contractId).then(() => {
      setCopiedContractId(contractId);
      window.setTimeout(() => {
        setCopiedContractId(current => (current === contractId ? null : current));
      }, 1200);
    });
  };

  if (moduleInterfaces.length === 0) {
    return (
      <div style={{ padding: 16, color: 'var(--text-tertiary)', fontSize: 13 }}>
        No module interfaces defined.
      </div>
    );
  }

  return (
    <div className="contract-panel">
      {moduleInterfaces.map((mod) => (
        <details key={mod.responsibilityUnitId} className="contract-item module-interface-details">
          <summary className="module-interface-summary">
            <span className="module-summary-main">
              <span className="contract-id">{mod.moduleName}</span>
              {mod.owner && <span className="module-owner">{mod.owner}</span>}
            </span>
            <span className="module-summary-meta">
              {mod.publicSurfaces.length} surfaces / {mod.imports.length} imports
            </span>
          </summary>

          <div className="module-interface-body">
            {mod.purpose && <p className="module-purpose">{mod.purpose}</p>}

            {mod.owns.length > 0 && (
              <div className="module-path-list" aria-label={`${mod.moduleName} owned paths`}>
                {mod.owns.map(path => (
                  <code key={path}>{path}</code>
                ))}
              </div>
            )}

            {mod.publicSurfaces.length > 0 && (
              <section className="contract-section">
                <h4>
                  Public Surfaces
                  <span>{mod.publicSurfaces.length}</span>
                </h4>
                {mod.publicSurfaces.map((surface) => (
                  <article key={surface.name} className="public-surface">
                    <div className="surface-heading">
                      <span className="surface-kind">{surface.kind}</span>
                      <span className="surface-name">{surface.name}</span>
                    </div>

                    {surface.description && (
                      <p className="surface-description">{surface.description}</p>
                    )}

                    {surface.contractIds.length > 0 && (
                      <div className="contract-id-list" aria-label={`${surface.name} contract IDs`}>
                        {surface.contractIds.map(contractId => (
                          <ContractIdChip
                            key={contractId}
                            contractId={contractId}
                            copiedContractId={copiedContractId}
                            onCopy={handleCopyContractId}
                          />
                        ))}
                      </div>
                    )}

                    <div className="interface-signature">
                      <SurfaceSignature surface={surface} />
                      <InputsTable inputs={surface.signature.inputs} />
                      <OutputsTable outputs={surface.signature.outputs} />
                      <ErrorsTable errors={surface.signature.errors} />
                    </div>
                  </article>
                ))}
              </section>
            )}

            {mod.imports.length > 0 && (
              <section className="contract-section">
                <h4>
                  Imports
                  <span>{mod.imports.length}</span>
                </h4>
                <table className="signature-table import-table">
                  <thead>
                    <tr>
                      <th>Surface</th>
                      <th>Contract ID</th>
                      <th>Provider</th>
                      <th>Allowed Use</th>
                    </tr>
                  </thead>
                  <tbody>
                    {mod.imports.map((imp) => (
                      <tr key={`${imp.contractId}-${imp.surface}`}>
                        <td><span className="sig-function">{imp.surface}</span></td>
                        <td>
                          <ContractIdChip
                            contractId={imp.contractId}
                            copiedContractId={copiedContractId}
                            onCopy={handleCopyContractId}
                          />
                        </td>
                        <td>{imp.providerResponsibilityUnitId}</td>
                        <td>{imp.allowedUse || '-'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </section>
            )}
          </div>
        </details>
      ))}
    </div>
  );
}
