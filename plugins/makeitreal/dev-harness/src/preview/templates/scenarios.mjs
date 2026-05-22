// Scenarios section template for Architecture Dossier.
// Pure refactor — extracted from render-dashboard-html.mjs.

import {
  escapeHtml,
  mermaidDiagramCard,
  mermaidLabel,
  moduleSurfaces,
  surfaceDisplayName,
  signatureInputs,
  signatureOutputs,
  signatureErrors,
  findSurfaceByImport,
  anchorSlug,
  harnessSequence,
  sequenceMermaid,
  renderScenarioVisualization,
} from "./shared.mjs";

export function derivedSoftwareSequenceMermaid(dossier = {}) {
  const surfaces = moduleSurfaces(dossier);
  if (surfaces.length === 0) {
    return null;
  }

  const importMessages = surfaces.flatMap((entry) =>
    (entry.moduleInterface.imports ?? []).map((dependency) => {
      const provider = findSurfaceByImport({ dossier, dependency });
      return provider ? { entry, dependency, provider } : null;
    }).filter(Boolean)
  );
  if (importMessages.length > 0) {
    const participants = [...new Set(importMessages.flatMap(({ entry, provider }) => [
      entry.moduleInterface.moduleName,
      provider.moduleInterface.moduleName
    ]))];
    const ids = new Map(participants.map((label, index) => [label, `p${index}`]));
    return [
      "sequenceDiagram",
      ...participants.map((label) => `  participant ${ids.get(label)} as ${label}`),
      ...importMessages.flatMap(({ entry, dependency, provider }) => [
        `  ${ids.get(entry.moduleInterface.moduleName)}->>${ids.get(provider.moduleInterface.moduleName)}: ${mermaidLabel(dependency.contractId ?? dependency.surface)}`,
        `  ${ids.get(provider.moduleInterface.moduleName)}-->>${ids.get(entry.moduleInterface.moduleName)}: declared output or error`
      ])
    ].join("\n");
  }

  return [
    "sequenceDiagram",
    "  participant caller as Caller",
    ...surfaces.map((entry) => `  participant ${entry.id} as ${mermaidLabel(surfaceDisplayName(entry))}`),
    ...surfaces.flatMap((entry) => {
      const inputLabel = signatureInputs(entry.surface).map((input) => input.name).join(", ") || "input";
      const outputLabel = signatureOutputs(entry.surface).map((output) => output.name).join(", ") || "output";
      const errorLabel = signatureErrors(entry.surface).map((error) => error.code).join(" | ") || "declared error";
      return [
        `  caller->>${entry.id}: ${mermaidLabel(inputLabel)}`,
        `  ${entry.id}->>${entry.id}: validate ${mermaidLabel(entry.surface.name)} contract`,
        "  alt valid contract",
        `    ${entry.id}-->>caller: ${mermaidLabel(outputLabel)}`,
        "  else declared failure",
        `    ${entry.id}--x caller: ${mermaidLabel(errorLabel)}`,
        "  end"
      ];
    })
  ].join("\n");
}

export function softwareSequenceMermaid(dossier = {}) {
  const realSequences = (dossier.signalFlows ?? []).filter((sequence) => !harnessSequence(sequence));
  return sequenceMermaid(realSequences) ?? derivedSoftwareSequenceMermaid(dossier);
}

export function stateMermaidForSurface(entry = {}) {
  if (!entry.surface) {
    return null;
  }
  const inputLabel = signatureInputs(entry.surface).map((input) => input.name).join(", ") || "input";
  const outputLabel = signatureOutputs(entry.surface).map((output) => output.name).join(", ") || "output";
  const errorLabel = signatureErrors(entry.surface).map((error) => error.code).join(" | ");
  const lines = [
    "stateDiagram-v2",
    "  [*] --> InputReceived",
    `  InputReceived --> ContractValid: validate ${mermaidLabel(inputLabel)}`,
    `  ContractValid --> SurfaceExecuted: ${mermaidLabel(entry.surface.name)}`,
    `  SurfaceExecuted --> OutputReturned: ${mermaidLabel(outputLabel)}`,
    "  OutputReturned --> [*]"
  ];
  if (errorLabel) {
    lines.push(`  ContractValid --> DeclaredError: ${mermaidLabel(errorLabel)}`);
    lines.push("  DeclaredError --> [*]");
  }
  return lines.join("\n");
}

export function stateDiagramCards(dossier = {}) {
  const surfaces = moduleSurfaces(dossier);
  if (surfaces.length === 0) {
    return [];
  }
  return surfaces.map((entry) => mermaidDiagramCard({
    title: `${entry.surface.name} State Flow`,
    description: `Declared execution states for ${surfaceDisplayName(entry)}.`,
    diagram: stateMermaidForSurface(entry)
  })).filter(Boolean);
}

export function callStackMermaid(callStacks = []) {
  const stack = callStacks[0];
  const calls = stack?.calls ?? [];
  if (calls.length === 0) {
    return null;
  }
  return [
    "flowchart TD",
    `  entry["${mermaidLabel(stack.entrypoint)}"]`,
    ...calls.map((call, index) => {
      const id = `c${index}`;
      const previous = index === 0 ? "entry" : `c${index - 1}`;
      return `  ${previous} --> ${id}["${mermaidLabel(call)}"]`;
    })
  ].join("\n");
}

function renderCallStacks(callStacks = []) {
  if (callStacks.length === 0) {
    return '<p class="empty">No call stacks declared.</p>';
  }
  return `<div class="callstack-list">${callStacks.map((stack) => `<article class="callstack-card">
    <header><code>${escapeHtml(stack.entrypoint)}</code></header>
    <ol>${(stack.calls ?? []).map((call) => `<li>${escapeHtml(call)}</li>`).join("")}</ol>
  </article>`).join("")}</div>`;
}

function renderSequences(sequences = []) {
  if (sequences.length === 0) {
    return '<p class="empty">No sequence diagrams declared.</p>';
  }
  return sequences.map((sequence) => `<article class="sequence-card">
    <strong>${escapeHtml(sequence.title)}</strong>
    <ol>${(sequence.messages ?? []).map((message) => `<li><span>${escapeHtml(message.from)}</span> → <span>${escapeHtml(message.to)}</span>: ${escapeHtml(message.label)}</li>`).join("")}</ol>
  </article>`).join("");
}

function renderScenarioIndex(scenarios = []) {
  if (scenarios.length === 0) {
    return '<p class="empty">No software scenarios declared.</p>';
  }
  return `<div class="scenario-index">
    ${scenarios.map((scenario) => `<a href="#${escapeHtml(anchorSlug(scenario.id, "scenario"))}">
      <strong>${escapeHtml(scenario.title)}</strong>
      <span>${scenario.participantCount} participants · ${scenario.stepCount} steps · ${escapeHtml(scenario.visualizationKind)}</span>
    </a>`).join("")}
  </div>`;
}

function renderScenarioDetails(scenarios = []) {
  if (scenarios.length === 0) {
    return '<p class="empty">No scenario details declared.</p>';
  }
  return `<div class="scenario-reference">
    ${scenarios.map((scenario) => `<article id="${escapeHtml(anchorSlug(scenario.id, "scenario"))}" class="scenario-detail">
      <header>
        <h3>${escapeHtml(scenario.title)}</h3>
        <p>${escapeHtml((scenario.participants ?? []).join(" → "))}</p>
      </header>
      ${renderScenarioVisualization(scenario)}
    </article>`).join("")}
  </div>`;
}

function renderFlowTimeline(dossier = {}) {
  const realSequences = (dossier.signalFlows ?? []).filter((sequence) => !harnessSequence(sequence));
  return `<div class="flow-timeline">
    <section>
      <h3>Signal Flow</h3>
      ${mermaidDiagramCard({
        title: "Runtime Sequence",
        description: "Mermaid sequence diagram generated from software module interfaces.",
        diagram: softwareSequenceMermaid(dossier)
      })}
      ${renderSequences(realSequences)}
    </section>
    <section>
      <h3>Call Stack</h3>
      ${mermaidDiagramCard({
        title: "Call Stack",
        description: "Mermaid call graph generated from declared call stack.",
        diagram: callStackMermaid(dossier.callStacks)
      })}
      ${renderCallStacks(dossier.callStacks)}
    </section>
    <section>
      <h3>Surface State Flow</h3>
      <div class="diagram-grid">
        ${stateDiagramCards(dossier).join("") || '<p class="empty">No surface state flows declared.</p>'}
      </div>
    </section>
  </div>`;
}

export function renderScenariosSection(dossier = {}) {
  const scenarios = dossier.scenarioDetails ?? [];
  const scenarioIndex = dossier.scenarioIndex ?? [];
  return `<section id="scenarios" class="architecture-section">
    <div class="section-heading">
      <div>
        <p class="eyebrow">Flows</p>
        <h2>Scenarios</h2>
      </div>
    </div>
    <p class="section-note">Software scenarios show the end-to-end flow before diving into individual modules. Each scenario links to the modules and surfaces involved.</p>
    ${renderScenarioIndex(scenarioIndex)}
    ${renderFlowTimeline(dossier)}
    ${renderScenarioDetails(scenarios)}
  </section>`;
}
