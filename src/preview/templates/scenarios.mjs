// Scenarios section template for Architecture Dossier.
// Pure refactor — extracted from render-dashboard-html.mjs.

import {
  escapeHtml,
  mermaidDiagramCard,
  mermaidLabel,
  anchorSlug,
  harnessSequence,
  sequenceMermaid,
  renderScenarioVisualization,
} from "./shared.mjs";

// Doctrine: the engine does not fabricate sequence diagrams. It renders only
// the sequences the LLM declared in the design pack (dossier.signalFlows).
// If none are declared, return null and let the section show an empty state.
export function softwareSequenceMermaid(dossier = {}) {
  const realSequences = (dossier.signalFlows ?? []).filter((sequence) => !harnessSequence(sequence));
  return sequenceMermaid(realSequences);
}

// Doctrine: the engine does not fabricate per-surface state machines. State
// flows must be declared by the LLM. Until a declared schema exists, render
// nothing and let the section show an empty state.
export function stateDiagramCards() {
  return [];
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
