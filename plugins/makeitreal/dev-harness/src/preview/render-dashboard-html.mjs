// Architecture Dossier HTML renderer.
// Composes section templates from ./templates/ into a single-page dashboard.

import { escapeHtml, referenceTitle, requireSystemDossier } from "./templates/shared.mjs";
import { renderDossierNav, renderOverviewSection } from "./templates/overview.mjs";
import { renderScenariosSection } from "./templates/scenarios.mjs";
import { renderExecutionPlanSection } from "./templates/execution-plan.mjs";
import { renderModulesSection } from "./templates/modules.mjs";
import { renderAcceptanceEvidenceSection } from "./templates/acceptance.mjs";

export function renderDashboardHtml(model) {
  const dossier = requireSystemDossier(model);
  const blueprint = model.blueprint;
  const title = referenceTitle(model);
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Make It Real Architecture Dossier - ${escapeHtml(title)}</title>
  <link rel="stylesheet" href="./preview.css?v=${Date.now()}">
</head>
<body>
  <main class="architecture-shell">
    ${renderDossierNav(dossier)}

    <article class="architecture-main">
      ${renderOverviewSection(model, dossier, blueprint)}
      ${renderScenariosSection(dossier)}
      ${renderExecutionPlanSection(dossier)}
      ${renderModulesSection(dossier)}
      ${renderAcceptanceEvidenceSection(model, dossier, blueprint)}
    </article>
  </main>
  <script src="./preview.js?v=${Date.now()}"></script>
  <script src="https://cdn.jsdelivr.net/npm/mermaid@11.4.1/dist/mermaid.min.js" onerror="document.querySelectorAll('details.mermaid-source').forEach(function(el){el.open=true});document.querySelectorAll('pre.mermaid').forEach(function(el){el.style.display='none'})"></script>
  <script>
    if (typeof mermaid !== "undefined") {
    const mermaidFont = 'Inter, ui-sans-serif, -apple-system, BlinkMacSystemFont, "Segoe UI", system-ui, sans-serif';
    mermaid.initialize({
      startOnLoad: true,
      securityLevel: "strict",
      theme: "base",
      fontFamily: mermaidFont,
      flowchart: {
        curve: "basis",
        htmlLabels: true,
        useMaxWidth: true,
        padding: 30,
        nodeSpacing: 60,
        rankSpacing: 80
      },
      sequence: {
        useMaxWidth: true,
        diagramMarginX: 32,
        diagramMarginY: 24,
        boxMargin: 12,
        boxTextMargin: 6,
        noteMargin: 12,
        messageMargin: 38,
        mirrorActors: false,
        actorFontFamily: mermaidFont,
        noteFontFamily: mermaidFont,
        messageFontFamily: mermaidFont
      },
      themeVariables: {
        background: "transparent",
        primaryColor: "#1c2128",
        primaryTextColor: "#e6edf3",
        primaryBorderColor: "#30363d",
        secondaryColor: "#1c2128",
        secondaryBorderColor: "#30363d",
        secondaryTextColor: "#e6edf3",
        tertiaryColor: "#0d1117",
        tertiaryBorderColor: "#30363d",
        tertiaryTextColor: "#e6edf3",
        mainBkg: "#1c2128",
        secondBkg: "#1c2128",
        lineColor: "#58a6ff",
        textColor: "#e6edf3",
        labelTextColor: "#e6edf3",
        nodeTextColor: "#e6edf3",
        edgeLabelBackground: "#0d1117",
        clusterBkg: "#0d1117",
        clusterBorder: "#30363d",
        titleColor: "#e6edf3",
        fontFamily: mermaidFont,
        fontSize: "14px",
        /* sequence */
        actorBkg: "#1c2128",
        actorBorder: "#30363d",
        actorTextColor: "#e6edf3",
        actorLineColor: "#30363d",
        signalColor: "#58a6ff",
        signalTextColor: "#e6edf3",
        labelBoxBkgColor: "#1c2128",
        labelBoxBorderColor: "#30363d",
        labelTextColor: "#e6edf3",
        loopTextColor: "#e6edf3",
        noteBkgColor: "#1c2128",
        noteBorderColor: "#30363d",
        noteTextColor: "#e6edf3",
        activationBkgColor: "#1c2128",
        activationBorderColor: "#58a6ff",
        sequenceNumberColor: "#0d1117",
        /* state */
        specialStateColor: "#58a6ff",
        altBackground: "#1c2128",
        innerEndBackground: "#1c2128",
        compositeBackground: "#1c2128",
        compositeBorder: "#30363d",
        compositeTitleBackground: "#1c2128",
        stateLabelColor: "#e6edf3",
        stateBkg: "#1c2128",
        labelColor: "#e6edf3",
        errorBkgColor: "#3d1d24",
        errorTextColor: "#f87171"
      }
    });
    }
  </script>
</body>
</html>
`;
}

export function renderDashboardCss() {
  return `
:root {
  color-scheme: dark light;
  --bg: #08090a;
  --panel: #0e0f12;
  --panel-2: #16181d;
  --ink: #f5f5f7;
  --ink-2: #c9c9d1;
  --muted: #6e6e80;
  --line: rgba(255,255,255,0.06);
  --line-strong: rgba(255,255,255,0.1);
  --soft: rgba(255,255,255,0.025);
  --soft-line: rgba(255,255,255,0.05);
  --accent: #8e95f5;
  --accent-strong: #a4abff;
  --accent-soft: rgba(142,149,245,0.12);
  --accent-border: rgba(142,149,245,0.28);
  --ok: #4ade80;
  --warn: #fbbf24;
  --bad: #f87171;
  --mono: "SFMono-Regular", "JetBrains Mono", Menlo, Consolas, monospace;
  --sans: -apple-system, BlinkMacSystemFont, "Inter", "Segoe UI", system-ui, sans-serif;
  --radius: 10px;
  --radius-sm: 6px;
}

[data-theme="light"] {
  --bg: #fafafa;
  --panel: #ffffff;
  --panel-2: #f7f7f8;
  --ink: #0a0a0a;
  --ink-2: #1a1a1a;
  --muted: #767687;
  --line: rgba(0,0,0,0.07);
  --line-strong: rgba(0,0,0,0.12);
  --soft: rgba(0,0,0,0.02);
  --soft-line: rgba(0,0,0,0.05);
  --accent: #5e6ad2;
  --accent-strong: #4a55b8;
  --accent-soft: rgba(94,106,210,0.08);
  --accent-border: rgba(94,106,210,0.22);
  --ok: #047a48;
  --warn: #b45309;
  --bad: #b42318;
}

* { box-sizing: border-box; }
*::selection { background: var(--accent-soft); color: var(--ink); }

html { background: var(--bg); }

body {
  margin: 0;
  background: var(--bg);
  color: var(--ink);
  font-family: var(--sans);
  font-size: 14px;
  line-height: 1.55;
  font-feature-settings: "cv02", "cv03", "cv04", "cv11";
  -webkit-font-smoothing: antialiased;
  -moz-osx-font-smoothing: grayscale;
  text-rendering: optimizeLegibility;
}

code, pre, .file-tree-node {
  font-family: var(--mono);
  font-size: 12.5px;
  font-variant-ligatures: none;
}

a { color: var(--accent); text-decoration: none; transition: color .12s ease; }
a:hover { color: var(--accent-strong); }

p { margin: 0 0 8px; color: var(--ink-2); }
p:last-child { margin-bottom: 0; }
hr { border: 0; border-top: 1px solid var(--soft-line); margin: 16px 0; }

ul { margin: 0 0 8px; padding-left: 18px; color: var(--ink-2); }
ul:last-child { margin-bottom: 0; }
li { padding: 2px 0; }

button { font-family: inherit; }

::-webkit-scrollbar { width: 10px; height: 10px; }
::-webkit-scrollbar-track { background: transparent; }
::-webkit-scrollbar-thumb { background: var(--line-strong); border-radius: 99px; border: 2px solid var(--bg); }
::-webkit-scrollbar-thumb:hover { background: var(--muted); }

[data-theme-toggle] {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  border: 1px solid var(--line);
  border-radius: var(--radius-sm);
  background: var(--panel-2);
  color: var(--ink-2);
  cursor: pointer;
  font-size: 12px;
  font-weight: 500;
  letter-spacing: -0.005em;
  padding: 5px 10px;
  transition: background .12s ease, color .12s ease, border-color .12s ease;
}
[data-theme-toggle]:hover {
  background: var(--accent-soft);
  color: var(--ink);
  border-color: var(--accent-border);
}

.architecture-shell {
  display: grid;
  grid-template-columns: minmax(220px, 260px) minmax(0, 980px);
  gap: 48px;
  max-width: 1280px;
  margin: 0 auto;
  padding: 32px 40px 96px;
}

.architecture-nav {
  position: sticky;
  top: 24px;
  align-self: start;
  display: grid;
  gap: 1px;
  max-height: calc(100vh - 48px);
  overflow: auto;
  padding: 4px 0;
}

.architecture-nav .nav-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 10px;
  margin-bottom: 8px;
  padding: 0 10px;
}

.architecture-nav .eyebrow { margin: 0; }

.architecture-nav strong {
  display: block;
  margin: 4px 10px 12px;
  color: var(--ink);
  font-size: 13px;
  font-weight: 600;
  letter-spacing: -0.01em;
}

.architecture-nav a {
  display: block;
  padding: 6px 10px;
  border-radius: var(--radius-sm);
  color: var(--muted);
  font-size: 12.5px;
  font-weight: 500;
  letter-spacing: -0.005em;
  transition: background .1s ease, color .1s ease;
}

.architecture-nav a[hidden] { display: none; }
.architecture-nav a.nav-empty { opacity: 0.4; }

.architecture-nav a:hover {
  background: var(--soft);
  color: var(--ink-2);
}

.architecture-nav a.active {
  background: var(--accent-soft);
  color: var(--accent-strong);
}

.nav-filter {
  display: grid;
  gap: 6px;
  margin: 4px 10px 12px;
}

.nav-filter span {
  color: var(--muted);
  font-size: 10.5px;
  font-weight: 600;
  letter-spacing: 0.06em;
  text-transform: uppercase;
}

.nav-filter input {
  width: 100%;
  border: 1px solid var(--line);
  border-radius: var(--radius-sm);
  background: var(--panel);
  color: var(--ink);
  font: inherit;
  font-size: 12.5px;
  padding: 6px 9px;
  transition: border-color .12s ease;
}

.nav-filter input:focus {
  outline: none;
  border-color: var(--accent-border);
}

.nav-group {
  display: grid;
  gap: 1px;
  margin: 12px 0 4px;
  padding-top: 12px;
  border-top: 1px solid var(--soft-line);
}

.nav-group > span {
  padding: 4px 10px;
  color: var(--muted);
  font-size: 10.5px;
  font-weight: 600;
  letter-spacing: 0.06em;
  text-transform: uppercase;
}

.architecture-nav .nav-module { color: var(--ink-2); font-weight: 500; }
.architecture-nav .nav-surface {
  padding-left: 22px;
  color: var(--muted);
  font-size: 12px;
}
.architecture-nav .nav-surface::before {
  content: "";
  display: inline-block;
  width: 6px;
  height: 1px;
  background: var(--line-strong);
  margin-right: 8px;
  vertical-align: middle;
}

.architecture-main {
  display: grid;
  gap: 56px;
  min-width: 0;
}

.architecture-hero,
.architecture-section,
.diagram-card,
.module-directory {
  min-width: 0;
}

.architecture-hero {
  display: grid;
  gap: 12px;
  padding: 8px 0 0;
}

.hero-topline {
  display: flex;
  flex-wrap: wrap;
  justify-content: space-between;
  align-items: center;
  gap: 12px;
}

.eyebrow,
.rail-label {
  margin: 0;
  color: var(--accent);
  font-size: 10.5px;
  font-weight: 600;
  letter-spacing: 0.08em;
  text-transform: uppercase;
}

.reference-label {
  margin: 0;
  color: var(--muted);
  font-size: 13px;
  font-weight: 500;
}

.status-pill {
  display: inline-flex;
  align-items: center;
  border: 1px solid var(--accent-border);
  border-radius: 99px;
  padding: 3px 10px;
  background: var(--accent-soft);
  color: var(--accent-strong);
  font-size: 11px;
  font-weight: 600;
  letter-spacing: 0.04em;
  text-transform: uppercase;
  overflow-wrap: anywhere;
}

h1 {
  margin: 0;
  max-width: 820px;
  font-size: clamp(28px, 3vw, 38px);
  font-weight: 600;
  line-height: 1.1;
  letter-spacing: -0.02em;
  color: var(--ink);
  overflow-wrap: anywhere;
}

h2 {
  margin: 0 0 4px;
  font-size: 20px;
  font-weight: 600;
  letter-spacing: -0.015em;
  color: var(--ink);
}

h3 {
  margin: 0 0 8px;
  font-size: 14px;
  font-weight: 600;
  letter-spacing: -0.01em;
  color: var(--ink);
}

h4 {
  margin: 0 0 6px;
  font-size: 12.5px;
  font-weight: 600;
  letter-spacing: -0.005em;
  color: var(--ink);
}

.summary-line {
  max-width: 760px;
  margin: 4px 0 0;
  color: var(--ink-2);
  font-size: 16px;
  line-height: 1.55;
  letter-spacing: -0.005em;
}

.request-disclosure {
  margin-top: 12px;
  color: var(--muted);
  font-size: 13px;
}

.request-disclosure summary {
  cursor: pointer;
  color: var(--muted);
  font-size: 12px;
  font-weight: 500;
  letter-spacing: -0.005em;
  list-style: none;
  display: inline-flex;
  align-items: center;
  gap: 4px;
}
.request-disclosure summary::-webkit-details-marker { display: none; }
.request-disclosure summary::before {
  content: "›";
  display: inline-block;
  color: var(--muted);
  transition: transform .12s ease;
  transform: rotate(0deg);
}
.request-disclosure[open] summary::before { transform: rotate(90deg); }
.request-disclosure summary:hover { color: var(--ink-2); }

.request-disclosure p {
  margin: 8px 0 0;
  max-width: 820px;
  color: var(--ink-2);
}

.overview-brief {
  display: grid;
  gap: 8px;
  margin-top: 20px;
  padding-top: 20px;
  border-top: 1px solid var(--soft-line);
}

.overview-brief p {
  margin: 0;
  color: var(--ink-2);
  font-size: 14px;
}

.overview-brief strong { color: var(--ink); font-weight: 600; }

.architecture-section {
  display: grid;
  gap: 16px;
  scroll-margin-top: 32px;
}

.section-heading {
  display: flex;
  justify-content: space-between;
  align-items: flex-end;
  gap: 18px;
  padding-bottom: 12px;
  border-bottom: 1px solid var(--soft-line);
}

.section-heading > div {
  display: grid;
  gap: 4px;
}

.section-heading h2 { margin: 0; }

.section-heading > span {
  border: 1px solid var(--line);
  border-radius: 99px;
  padding: 3px 9px;
  background: transparent;
  color: var(--muted);
  font-size: 11px;
  font-weight: 600;
  white-space: nowrap;
}

.section-note {
  margin: 0;
  color: var(--muted);
  font-size: 13px;
  line-height: 1.6;
  max-width: 760px;
}

.empty, .muted { color: var(--muted); font-size: 13px; }

.clean-list { padding-left: 18px; color: var(--ink-2); }

/* === Cards: borderless, more whitespace === */
.module-node,
.module-reference-card,
.contract-matrix article,
.responsibility-unit,
.contract-surface,
.surface-trace-card,
.scenario-detail,
.worker-assignment,
.reference-card,
.boundary-card,
.callstack-card,
.sequence-card,
.diagram-card,
.schema-display,
.surface-summary,
.workflow-step,
.criterion,
.sdk-example,
.test-results article,
.scenario-index a,
.signature-row,
.rail-section,
.rail-list > div,
.artifact-grid > div {
  border: 1px solid var(--line);
  border-radius: var(--radius);
  background: var(--panel);
  padding: 18px;
  transition: border-color .12s ease;
}

/* Nested cards (inside other cards) get the elevated tone */
.responsibility-unit .file-tree,
.surface-detail-grid .signature-column,
.schema-sections li,
.signature-row {
  background: var(--panel-2);
}

/* Reference grid (key-value) */
.reference-grid {
  display: grid;
  grid-template-columns: repeat(4, minmax(0, 1fr));
  gap: 1px;
  margin-top: 12px;
  background: var(--soft-line);
  border-radius: var(--radius);
  overflow: hidden;
  border: 1px solid var(--line);
}

.reference-grid.compact {
  grid-template-columns: repeat(2, minmax(0, 1fr));
}

.reference-grid div {
  padding: 12px 14px;
  background: var(--panel);
}

.reference-grid span {
  display: block;
  color: var(--muted);
  font-size: 10.5px;
  font-weight: 600;
  letter-spacing: 0.06em;
  text-transform: uppercase;
}

.reference-grid strong {
  display: block;
  margin-top: 4px;
  color: var(--ink);
  font-size: 13.5px;
  font-weight: 500;
  overflow-wrap: anywhere;
}

/* === Doc table === */
.doc-table {
  overflow: hidden;
  max-width: 100%;
  border: 1px solid var(--line);
  border-radius: var(--radius);
  background: var(--panel);
}

.doc-row {
  display: grid;
  grid-template-columns: 180px minmax(0, 1fr);
  border-top: 1px solid var(--soft-line);
}

.doc-row:first-child { border-top: 0; }

.doc-key,
.doc-value {
  min-width: 0;
  padding: 12px 16px;
  overflow-wrap: anywhere;
  font-size: 13px;
}

.doc-key {
  background: var(--soft);
  color: var(--muted);
  font-weight: 500;
  font-size: 11.5px;
  letter-spacing: 0.02em;
  text-transform: uppercase;
}

.doc-value { color: var(--ink-2); }
.doc-value ul { margin: 0; }
.doc-value strong { color: var(--ink); font-weight: 600; }
.doc-value p { margin: 4px 0 0; color: var(--muted); font-size: 12.5px; }

.compact-doc-table .doc-row {
  grid-template-columns: 140px minmax(0, 1fr);
}

.architecture-table { margin-top: 4px; }
.architecture-table .doc-value { display: grid; gap: 4px; }
.architecture-table .doc-value span { color: var(--muted); font-size: 12px; }

.doc-value code,
.artifact-grid code,
.rail-list code,
.contract-chip-list code,
.task-dag-row code,
.worker-assignment code,
.approval-scope-table code,
.module-directory-row code,
.surface-list a,
.path-list code,
.transition-list code,
.flow-line span,
.transition-list span {
  display: inline-block;
  border: 1px solid var(--line);
  border-radius: 99px;
  padding: 2px 9px;
  background: var(--panel-2);
  color: var(--ink-2);
  font-family: var(--mono);
  font-size: 11.5px;
  font-weight: 500;
  letter-spacing: 0;
  overflow-wrap: anywhere;
  white-space: normal;
}

/* === Code blocks === */
.code-block {
  margin: 0;
  border-radius: var(--radius);
  background: #050507;
  color: #e8e8ec;
  padding: 16px 18px;
  overflow: auto;
  font-family: var(--mono);
  font-size: 12.5px;
  line-height: 1.7;
  white-space: pre-wrap;
  overflow-wrap: anywhere;
}

[data-theme="light"] .code-block {
  background: #1a1b1f;
  color: #e8e8ec;
}

.code-block code {
  color: inherit;
  font-size: inherit;
  background: transparent;
  border: 0;
  padding: 0;
  border-radius: 0;
}

/* === Mermaid + diagrams === */
.diagram-grid {
  display: grid;
  gap: 14px;
}

.diagram-card {
  overflow: hidden;
  padding: 0;
  border: 1px solid #21262d;
  border-radius: 12px;
  background: #0d1117;
}

.diagram-card header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 12px;
  padding: 14px 18px;
  border-bottom: 1px solid var(--soft-line);
}

.diagram-card header strong {
  font-size: 13px;
  font-weight: 600;
  color: var(--ink);
}

.diagram-card header span {
  color: var(--muted);
  font-size: 12px;
}

.mermaid {
  margin: 0;
  min-height: 140px;
  padding: 32px 32px;
  overflow-x: auto;
  overflow-y: hidden;
  background:
    radial-gradient(ellipse 900px 500px at 30% 20%, rgba(88,166,255,0.08), transparent 65%),
    radial-gradient(ellipse 700px 400px at 75% 80%, rgba(56,139,253,0.06), transparent 65%),
    #0d1117;
  color: #e6edf3;
  text-align: center;
  font-family: "Inter", ui-sans-serif, -apple-system, BlinkMacSystemFont, "Segoe UI", system-ui, sans-serif !important;
}

.mermaid svg {
  max-width: 100%;
  height: auto;
  background: transparent !important;
  filter: drop-shadow(0 0 40px rgba(88,166,255,0.04));
}

.mermaid svg .edgePath .path,
.mermaid svg .flowchart-link {
  stroke: #58a6ff;
  stroke-width: 2px;
}

.mermaid svg .edgeLabel {
  background-color: #0d1117 !important;
  color: #e6edf3 !important;
  font-size: 12px !important;
}
.mermaid svg .edgeLabel rect { fill: #0d1117 !important; rx: 6; ry: 6; }
.mermaid svg .edgeLabel foreignObject div { background-color: #0d1117 !important; color: #e6edf3 !important; padding: 2px 8px !important; border-radius: 6px; }

.mermaid svg .node rect,
.mermaid svg .node polygon,
.mermaid svg .node circle,
.mermaid svg .node ellipse,
.mermaid svg .node path {
  rx: 12;
  ry: 12;
  filter: drop-shadow(0 2px 8px rgba(88,166,255,0.15)) drop-shadow(0 6px 16px rgba(0,0,0,0.30));
}

.mermaid svg .node .label,
.mermaid svg .node .nodeLabel,
.mermaid svg .label foreignObject div {
  color: #e6edf3 !important;
  font-family: "Inter", ui-sans-serif, system-ui, sans-serif !important;
  font-size: 14px !important;
  line-height: 1.4;
  padding: 4px 8px;
}

.mermaid svg .node foreignObject {
  overflow: visible;
}

.mermaid svg .node rect {
  min-width: 180px;
}

.mermaid svg .node .nodeLabel b { color: #e6edf3; font-weight: 600; }

.mermaid svg .marker { fill: #58a6ff !important; stroke: #58a6ff !important; }

[data-theme="light"] .mermaid {
  background: #f6f8fa;
  color: #1f2328;
}

.mermaid-source {
  border-top: 1px solid var(--soft-line);
  padding: 12px 18px;
}

.mermaid-source summary,
.workflow-fallback summary,
.rail-code summary {
  cursor: pointer;
  color: var(--muted);
  font-size: 11.5px;
  font-weight: 500;
  letter-spacing: 0.02em;
  text-transform: uppercase;
  list-style: none;
}
.mermaid-source summary::-webkit-details-marker,
.workflow-fallback summary::-webkit-details-marker,
.rail-code summary::-webkit-details-marker { display: none; }

.mermaid-source summary:hover,
.workflow-fallback summary:hover,
.rail-code summary:hover { color: var(--ink-2); }

.mermaid-source .code-block { margin-top: 10px; }

/* === System map / module nodes === */
.system-map {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(240px, 1fr));
  gap: 12px;
}

.module-node header,
.module-reference-card header,
.contract-matrix article header,
.worker-assignment header,
.responsibility-unit header,
.surface-trace-card header,
.schema-display header,
.scenario-detail header {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 12px;
  margin-bottom: 10px;
}

.module-node strong,
.module-reference-card h3,
.contract-matrix code,
.module-node h3 {
  font-size: 15px;
  font-weight: 600;
  letter-spacing: -0.01em;
  color: var(--ink);
  overflow-wrap: anywhere;
}

.module-node p,
.contract-matrix p,
.module-reference-card .section-note {
  color: var(--muted);
  font-size: 13px;
}

.chip-row {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
  margin-top: 12px;
}

.chip-row span {
  border: 1px solid var(--line);
  border-radius: 99px;
  background: var(--panel-2);
  padding: 2px 9px;
  color: var(--muted);
  font-size: 11.5px;
}

/* === Dependency matrix / Spec tables === */
.dependency-matrix {
  display: grid;
  border: 1px solid var(--line);
  border-radius: var(--radius);
  overflow: hidden;
  background: var(--panel);
}

.matrix-row,
.task-dag-row,
.spec-row,
.module-directory-row {
  display: grid;
  border-top: 1px solid var(--soft-line);
}

.matrix-row { grid-template-columns: minmax(120px, .9fr) minmax(120px, .9fr) minmax(190px, 1fr) minmax(220px, 1.4fr); }
.task-dag-row { grid-template-columns: minmax(180px, .9fr) minmax(170px, .8fr) minmax(190px, 1fr) minmax(220px, 1.2fr); gap: 8px; padding: 12px 16px; align-items: start; }
.spec-row { grid-template-columns: minmax(130px, .75fr) minmax(90px, .55fr) minmax(110px, .65fr) minmax(220px, 1.7fr); }
.module-directory-row { grid-template-columns: minmax(170px, .9fr) minmax(110px, .55fr) minmax(200px, 1.1fr) minmax(220px, 1.2fr); gap: 8px; padding: 12px 16px; align-items: start; color: var(--ink); }

.matrix-row:first-child,
.task-dag-row:first-child,
.spec-row:first-child,
.module-directory-row:first-child { border-top: 0; }

.matrix-row > div,
.spec-row > div {
  min-width: 0;
  padding: 11px 14px;
  overflow-wrap: anywhere;
  font-size: 13px;
}

.matrix-row.header,
.task-dag-row.header,
.spec-row.header,
.module-directory-row.header {
  background: var(--soft);
  color: var(--muted);
  font-size: 10.5px;
  font-weight: 600;
  letter-spacing: 0.06em;
  text-transform: uppercase;
}

.task-dag-row > div,
.worker-assignment .doc-value,
.approval-scope-table .doc-value,
.module-directory-row > div {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
  min-width: 0;
  overflow-wrap: anywhere;
}

.task-dag-row strong,
.module-directory-row strong { flex-basis: 100%; color: var(--ink); font-weight: 600; }
.task-dag-row span { color: var(--muted); font-size: 12px; }

.module-directory-row:not(.header):hover { background: var(--soft); }

.spec-block { display: grid; gap: 10px; }
.spec-block h3 { margin: 0; }
.spec-table { overflow: hidden; border: 1px solid var(--line); border-radius: var(--radius); background: var(--panel); }
.spec-stack { display: grid; gap: 14px; margin-top: 12px; }
.spec-block:nth-child(2) .spec-row { grid-template-columns: minmax(130px, .8fr) minmax(90px, .6fr) minmax(220px, 1.8fr); }
.spec-block:nth-child(3) .spec-row { grid-template-columns: minmax(180px, .8fr) minmax(240px, 1.1fr) minmax(280px, 1.4fr); }

.task-dag-table,
.worker-topology-list {
  display: grid;
  gap: 14px;
}

.task-dag-table {
  gap: 0;
  border: 1px solid var(--line);
  border-radius: var(--radius);
  overflow: hidden;
  background: var(--panel);
}

.worker-assignment {
  display: grid;
  gap: 12px;
}

.worker-assignment h3 {
  margin: 0;
  font-size: 15px;
  font-weight: 600;
  letter-spacing: -0.01em;
}

.worker-assignment p {
  margin: 0;
  color: var(--ink-2);
  font-size: 13.5px;
}

/* === Module directory === */
.module-directory {
  width: 100%;
  max-width: 100%;
  overflow: hidden;
  border: 1px solid var(--line);
  border-radius: var(--radius);
  background: var(--panel);
}

.module-directory > header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 12px;
  border-bottom: 1px solid var(--soft-line);
  padding: 14px 18px;
}

.module-directory h3 { margin: 0; }
.module-directory > header > span { color: var(--muted); font-size: 12px; font-weight: 500; }

.module-directory-table { display: grid; }

/* === Module reference === */
.module-reference {
  display: grid;
  gap: 14px;
}

.module-reference > * { min-width: 0; }
.module-reference-card { display: grid; gap: 14px; }
.module-id {
  margin: 0;
  color: var(--muted);
  font-family: var(--mono);
  font-size: 11px;
  letter-spacing: 0.04em;
  text-transform: uppercase;
}

/* === Surface reference === */
.surface-reference {
  display: grid;
  gap: 14px;
  padding-top: 14px;
  border-top: 1px solid var(--soft-line);
}

.surface-reference:first-of-type { padding-top: 0; border-top: 0; }

.surface-reference > *,
.surface-detail-grid > *,
.surface-summary > * { min-width: 0; }

.surface-summary { display: grid; gap: 12px; padding: 16px; }
.surface-summary h4 { margin: 0 0 4px; font-size: 16px; font-weight: 600; }
.surface-summary p { margin: 0; }

.surface-reference-header {
  display: flex;
  justify-content: space-between;
  gap: 14px;
  align-items: flex-start;
}

.surface-reference-header h4 {
  margin: 6px 0 4px;
  font-size: 17px;
  font-weight: 600;
  letter-spacing: -0.01em;
}

.surface-detail-grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(220px, 1fr));
  gap: 10px;
}

.surface-signature { margin: 0; }
.surface-signature code,
.signature-chip {
  display: inline-block;
  max-width: 100%;
  border: 1px solid var(--line);
  border-radius: var(--radius-sm);
  background: var(--panel-2);
  padding: 6px 10px;
  color: var(--ink-2);
  font-family: var(--mono);
  font-size: 12px;
  overflow-wrap: anywhere;
}

.contract-chip-list {
  display: flex;
  flex-wrap: wrap;
  justify-content: flex-end;
  gap: 6px;
  max-width: 100%;
  min-width: 0;
}

.method {
  display: inline-flex;
  justify-content: center;
  border-radius: 99px;
  padding: 3px 9px;
  background: rgba(74, 222, 128, 0.1);
  color: var(--ok);
  border: 1px solid rgba(74, 222, 128, 0.2);
  font-size: 10.5px;
  font-weight: 600;
  letter-spacing: 0.06em;
  text-transform: uppercase;
}

.method.neutral {
  background: var(--accent-soft);
  color: var(--accent-strong);
  border-color: var(--accent-border);
}

/* === Signature blocks === */
.signature-column {
  display: grid;
  gap: 8px;
  padding: 14px;
  border: 1px solid var(--line);
  border-radius: var(--radius);
  background: var(--panel-2);
}

.signature-column h4,
.imports-list h4 {
  margin: 0;
  color: var(--muted);
  font-size: 10.5px;
  font-weight: 600;
  letter-spacing: 0.06em;
  text-transform: uppercase;
}

.signature-table {
  display: grid;
  gap: 6px;
}

.signature-row {
  display: grid;
  gap: 3px;
  padding: 10px 12px;
  background: var(--panel);
  border-radius: var(--radius-sm);
  border-color: var(--soft-line);
}

.signature-row strong { color: var(--ink); font-size: 13px; font-weight: 600; }
.signature-row span { color: var(--muted); font-size: 12px; }
.signature-row p { margin: 4px 0 0; color: var(--ink-2); font-size: 12.5px; }

.signature-cases {
  display: grid;
  gap: 5px;
  list-style: none;
  margin: 8px 0 0;
  padding: 0;
}

.signature-cases li {
  align-items: center;
  display: grid;
  gap: 8px;
  grid-template-columns: minmax(120px, 0.7fr) 1fr;
}

.signature-cases span { color: var(--muted); font-size: 12px; }

.signature-grid {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 10px;
}

/* === SDK example === */
.sdk-example {
  overflow: hidden;
  padding: 0;
}

.sdk-panel-title {
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 12px;
  border-bottom: 1px solid var(--soft-line);
  padding: 10px 16px;
}

.sdk-panel-title span {
  color: var(--accent);
  font-size: 10.5px;
  font-weight: 600;
  letter-spacing: 0.06em;
  text-transform: uppercase;
}

.sdk-panel-title strong {
  color: var(--muted);
  font-size: 12px;
  font-weight: 500;
}

.sdk-example .code-block {
  margin: 0;
  border: 0;
  border-radius: 0;
}

/* === Schema display === */
.schema-display {
  display: grid;
  gap: 12px;
}

.schema-display header > code {
  max-width: 320px;
  overflow-wrap: anywhere;
  white-space: normal;
}

.schema-sections { display: grid; gap: 10px; }

.schema-sections section {
  border-top: 1px solid var(--soft-line);
  padding-top: 12px;
}

.schema-sections h4 { margin: 0 0 8px; }

.schema-sections ul {
  display: grid;
  gap: 6px;
  margin: 0;
  padding: 0;
  list-style: none;
}

.schema-sections li {
  display: grid;
  gap: 3px;
  border: 1px solid var(--soft-line);
  border-radius: var(--radius-sm);
  padding: 9px 12px;
}

.schema-sections li code {
  color: var(--ink);
  font-size: 12.5px;
  font-weight: 500;
}

.schema-sections li span,
.schema-sections li p,
.scenario-detail header p {
  margin: 0;
  color: var(--muted);
  font-size: 12px;
}

/* === Contract surfaces / Trace === */
.responsibility-map,
.contract-surface-list,
.surface-trace-list,
.scenario-reference {
  display: grid;
  gap: 14px;
}

.responsibility-unit h3,
.surface-trace-card h3,
.schema-display h3,
.scenario-detail h3 {
  margin: 0;
  font-size: 16px;
  font-weight: 600;
  letter-spacing: -0.01em;
}

.responsibility-unit h4 {
  margin: 16px 0 8px;
  color: var(--muted);
  font-size: 11px;
  font-weight: 600;
  letter-spacing: 0.06em;
  text-transform: uppercase;
}

.surface-list {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
  margin: 0;
  padding: 0;
  list-style: none;
}

.surface-list a {
  font-family: var(--mono);
  font-size: 11.5px;
  font-weight: 500;
  color: var(--ink-2);
}

.surface-list a:hover { color: var(--accent); border-color: var(--accent-border); }

/* === File tree === */
.file-tree {
  overflow: auto;
  border-radius: var(--radius-sm);
  padding: 12px 14px;
  background: var(--panel-2);
}

.file-tree ul {
  display: grid;
  gap: 2px;
  margin: 0;
  padding-left: 18px;
  list-style: none;
}

.file-tree > ul { padding-left: 0; }

.file-tree-node {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  color: var(--ink-2);
  font-family: var(--mono);
  font-size: 12px;
}

.file-tree-node.dir::before {
  content: "/";
  color: var(--accent);
  font-weight: 700;
}
.file-tree-node.file::before {
  content: ".";
  color: var(--muted);
  font-weight: 700;
  width: 8px;
  display: inline-flex;
  justify-content: center;
}

/* === Scenario index === */
.scenario-index { display: grid; gap: 8px; }

.scenario-index a {
  display: grid;
  gap: 4px;
  color: var(--ink-2);
  padding: 14px 16px;
}

.scenario-index a:hover {
  border-color: var(--accent-border);
  color: var(--ink);
}

.scenario-index a strong { color: var(--ink); font-weight: 600; }
.scenario-index span { color: var(--muted); font-size: 12px; }

/* === Workflow / Flow === */
.workflow-fallback { margin-top: 12px; }

.workflow-graph {
  display: grid;
  gap: 8px;
  margin-top: 12px;
}

.workflow-step {
  display: grid;
  grid-template-columns: 36px minmax(0, 1fr);
  gap: 4px 14px;
  padding: 12px 14px;
}

.workflow-step span {
  grid-row: span 2;
  color: var(--accent);
  font-family: var(--mono);
  font-weight: 600;
  font-size: 13px;
}

.workflow-step strong { color: var(--ink); font-weight: 600; font-size: 13.5px; }
.workflow-step p { margin: 0; color: var(--muted); font-size: 12.5px; }

.flow-timeline {
  display: grid;
  gap: 28px;
}

.flow-timeline > section { display: grid; gap: 12px; }
.flow-timeline > section > h3 {
  margin: 0;
  color: var(--muted);
  font-size: 11px;
  font-weight: 600;
  letter-spacing: 0.06em;
  text-transform: uppercase;
}

/* === Call stack === */
.callstack-list { display: grid; gap: 10px; }

.callstack-card {
  overflow: hidden;
  padding: 0;
}

.callstack-card header {
  background: var(--soft);
  padding: 10px 16px;
  border-bottom: 1px solid var(--soft-line);
}

.callstack-card header code {
  color: var(--ink);
  font-weight: 500;
  background: transparent;
  border: 0;
  padding: 0;
}

.callstack-card ol {
  display: grid;
  gap: 0;
  margin: 0;
  padding: 0;
  list-style: none;
  counter-reset: callstep;
}

.callstack-card li {
  display: grid;
  grid-template-columns: 30px minmax(0, 1fr);
  gap: 12px;
  border-top: 1px solid var(--soft-line);
  padding: 11px 16px;
  counter-increment: callstep;
  font-size: 13px;
  color: var(--ink-2);
}

.callstack-card li:first-child { border-top: 0; }

.callstack-card li::before {
  content: counter(callstep);
  display: inline-flex;
  justify-content: center;
  align-items: center;
  width: 22px;
  height: 22px;
  border-radius: 99px;
  background: var(--accent-soft);
  color: var(--accent-strong);
  font-family: var(--mono);
  font-size: 11px;
  font-weight: 600;
}

.sequence-card { padding: 14px 16px; }
.sequence-card strong { display: block; color: var(--ink); font-weight: 600; margin-bottom: 8px; }
.sequence-card ol { display: grid; gap: 6px; margin: 0; padding-left: 18px; color: var(--ink-2); font-size: 13px; }

/* === Path lists / flow lines === */
.path-list,
.transition-list,
.flow-line {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
  align-items: center;
}

.path-list { margin: 8px 0; }

.flow-line b { color: var(--muted); font-weight: 600; }

/* === Criteria === */
.criteria-list { display: grid; gap: 10px; margin-bottom: 14px; }

.criterion {
  display: grid;
  grid-template-columns: 88px minmax(0, 1fr);
  gap: 12px;
  padding: 12px 14px;
}

.criterion strong { color: var(--accent); font-family: var(--mono); font-size: 12px; font-weight: 600; }
.criterion span { color: var(--ink-2); font-size: 13.5px; }

/* === Review decisions === */
.review-decisions {
  display: grid;
  gap: 8px;
  margin: 0;
  padding-left: 22px;
  color: var(--ink-2);
}

.review-decisions li { padding-left: 4px; }

/* === Test results === */
.test-results {
  display: grid;
  gap: 8px;
}

.test-results article {
  border-left: 3px solid var(--ok);
  padding: 12px 16px;
}

.test-results article.failed { border-left-color: var(--bad); }

.test-results strong { color: var(--ink); font-weight: 600; }
.test-results p { margin: 4px 0; color: var(--ink-2); font-size: 13px; }

/* === Sources === */
.sources-list {
  display: grid;
  gap: 8px;
  margin: 0;
  padding: 0;
  list-style: none;
}

.sources-list li {
  display: grid;
  grid-template-columns: minmax(120px, .5fr) minmax(0, 1fr) minmax(90px, .35fr);
  gap: 12px;
  border: 1px solid var(--line);
  border-radius: var(--radius);
  background: var(--panel);
  padding: 12px 14px;
  align-items: center;
}

.sources-list span,
.sources-list em {
  color: var(--muted);
  font-style: normal;
  font-weight: 500;
  font-size: 12.5px;
}

.sources-list span { color: var(--ink); font-weight: 600; }

/* === Diagnostics === */
.diagnostics-panel {
  border: 1px solid var(--line);
  border-radius: var(--radius);
  background: var(--panel);
  padding: 0;
}

.diagnostics-panel summary {
  display: flex;
  justify-content: space-between;
  align-items: center;
  cursor: pointer;
  font-weight: 600;
  font-size: 14px;
  padding: 14px 18px;
  list-style: none;
}
.diagnostics-panel summary::-webkit-details-marker { display: none; }
.diagnostics-panel summary::after {
  content: "›";
  display: inline-block;
  color: var(--muted);
  transition: transform .12s ease;
}
.diagnostics-panel[open] summary::after { transform: rotate(90deg); }

.diagnostics-panel[open] {
  padding: 0 18px 18px;
}

.diagnostics-panel .doc-table { margin: 12px 0; }
.diagnostics-panel section { display: grid; gap: 10px; margin-top: 16px; }

.diagnostics-panel .diagnostics-panel {
  border: 1px solid var(--soft-line);
  margin-top: 12px;
}

.artifact-grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 10px;
}

.artifact-grid > div {
  display: grid;
  gap: 4px;
  min-width: 0;
  padding: 12px 14px;
}

.artifact-grid strong { color: var(--ink); font-weight: 600; font-size: 13px; }

/* === Rail (legacy structures used by helper functions) === */
.rail-list { display: grid; gap: 8px; }
.rail-list > div { padding: 10px 12px; }
.rail-list strong { color: var(--ink); font-weight: 600; }
.rail-list p { margin: 4px 0; color: var(--muted); font-size: 12.5px; }

.rail-section { display: grid; gap: 10px; }
.rail-section h2 { margin: 0; font-size: 16px; }

.rail-toc { display: grid; gap: 2px; }
.rail-toc a {
  border-radius: var(--radius-sm);
  color: var(--muted);
  font-size: 13px;
  padding: 6px 10px;
}
.rail-toc a:hover { background: var(--soft); color: var(--ink-2); }

.rail-code { display: grid; gap: 8px; }

.runtime-section { background: var(--panel); }
.runtime-rail h2 { margin: 0; font-size: 16px; }
.runtime-rail .status-rail { border: 0; background: transparent; padding: 0; }
.runtime-rail .status-rail > summary { cursor: pointer; padding: 0; font-weight: 600; }

/* === Status rail (kept for compatibility, used inside diagnostics) === */
.status-rail {
  border: 1px solid var(--line);
  border-radius: var(--radius);
  background: var(--panel);
  display: block;
  overflow: hidden;
}

.status-rail summary {
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 14px;
  padding: 14px 18px;
  cursor: pointer;
  font-weight: 600;
}

.status-rail summary strong { color: var(--muted); font-size: 12px; font-weight: 500; }

.status-grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  border-top: 1px solid var(--soft-line);
}

.status-grid section {
  border-top: 1px solid var(--soft-line);
  border-left: 1px solid var(--soft-line);
  padding: 16px 18px;
}

.status-grid section:nth-child(1),
.status-grid section:nth-child(2) { border-top: 0; }
.status-grid section:nth-child(odd) { border-left: 0; }

.status-rail h2 { font-size: 22px; }

.command-copy {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  align-items: center;
  margin-top: 10px;
}

.copy-command {
  border: 1px solid var(--line);
  border-radius: var(--radius-sm);
  background: var(--panel-2);
  color: var(--ink-2);
  cursor: pointer;
  font: inherit;
  font-size: 12px;
  padding: 5px 10px;
  transition: background .12s ease, color .12s ease;
}
.copy-command:hover { background: var(--accent-soft); color: var(--accent-strong); border-color: var(--accent-border); }

/* === Kanban === */
.compact-kanban {
  display: grid;
  gap: 8px;
}

.compact-kanban .kanban-lane {
  border: 1px solid var(--soft-line);
  border-radius: var(--radius-sm);
  background: var(--panel-2);
  padding: 10px 12px;
}

.kanban-lane header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 10px;
  margin-bottom: 8px;
  color: var(--muted);
  font-size: 11px;
  font-weight: 600;
  letter-spacing: 0.06em;
  text-transform: uppercase;
}

.kanban-lane header strong { color: var(--ink); font-family: var(--mono); }

.work-card {
  display: grid;
  gap: 3px;
  border-top: 1px solid var(--soft-line);
  padding-top: 8px;
  margin-top: 8px;
  font-size: 12.5px;
}

.work-card:first-of-type { border-top: 0; padding-top: 0; margin-top: 0; }

.work-card strong { color: var(--ink); font-size: 13px; font-weight: 600; }
.work-card code { color: var(--muted); background: transparent; border: 0; padding: 0; font-size: 11px; }
.work-card span,
.work-card em { color: var(--muted); font-style: normal; font-size: 11.5px; }

/* === Guide steps === */
.guide-steps {
  display: grid;
  gap: 8px;
  margin: 0;
  padding: 0;
  list-style: none;
}

.guide-step {
  display: grid;
  gap: 3px;
  border-top: 1px solid var(--soft-line);
  padding-top: 10px;
}

.guide-step:first-child { border-top: 0; padding-top: 0; }

.guide-step strong {
  color: var(--muted);
  font-size: 10.5px;
  font-weight: 600;
  letter-spacing: 0.06em;
  text-transform: uppercase;
}

.guide-step.complete strong { color: var(--ok); }
.guide-step.current strong,
.guide-step.blocked strong { color: var(--warn); }

/* === Theme toggle bar === */
.dashboard-topbar {
  position: sticky;
  top: 0;
  z-index: 10;
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 16px;
  padding: 14px 40px;
  border-bottom: 1px solid var(--soft-line);
  background: color-mix(in srgb, var(--bg) 88%, transparent);
  backdrop-filter: saturate(140%) blur(12px);
  -webkit-backdrop-filter: saturate(140%) blur(12px);
}

.dashboard-topbar .brand {
  display: flex;
  align-items: center;
  gap: 10px;
  color: var(--muted);
  font-size: 12.5px;
  font-weight: 500;
  letter-spacing: -0.005em;
}

.dashboard-topbar .brand strong {
  color: var(--ink);
  font-weight: 600;
}

.dashboard-topbar .brand .dot {
  width: 6px;
  height: 6px;
  border-radius: 99px;
  background: var(--accent);
  box-shadow: 0 0 12px var(--accent);
}

/* === Responsive === */
@media (max-width: 1100px) {
  .architecture-shell {
    grid-template-columns: minmax(200px, 240px) minmax(0, 1fr);
    gap: 32px;
    padding: 24px 28px 80px;
  }
  .dashboard-topbar { padding: 12px 28px; }
}

@media (max-width: 820px) {
  .architecture-shell {
    grid-template-columns: 1fr;
    gap: 24px;
    padding: 16px 18px 64px;
  }

  .architecture-nav {
    position: static;
    max-height: none;
    grid-template-columns: repeat(2, minmax(0, 1fr));
    border: 1px solid var(--line);
    border-radius: var(--radius);
    padding: 12px;
  }

  .architecture-nav .nav-header,
  .architecture-nav strong,
  .nav-filter,
  .nav-group { grid-column: 1 / -1; }

  .dashboard-topbar { padding: 10px 18px; }

  .reference-grid,
  .reference-grid.compact,
  .signature-grid,
  .surface-detail-grid,
  .system-map,
  .artifact-grid,
  .status-grid {
    grid-template-columns: 1fr;
  }

  .doc-row,
  .matrix-row,
  .task-dag-row,
  .spec-row,
  .module-directory-row,
  .sources-list li,
  .spec-block:nth-child(2) .spec-row,
  .spec-block:nth-child(3) .spec-row,
  .criterion,
  .workflow-step {
    grid-template-columns: 1fr;
  }

  .section-heading,
  .surface-reference-header {
    flex-direction: column;
    align-items: flex-start;
  }

  .contract-chip-list { justify-content: flex-start; }

  .matrix-row.header,
  .task-dag-row.header,
  .spec-row.header,
  .module-directory-row.header { display: none; }

  .matrix-row > div::before,
  .task-dag-row > div::before,
  .spec-row > div::before,
  .module-directory-row > div::before {
    content: attr(data-label);
    display: block;
    margin-bottom: 4px;
    color: var(--muted);
    font-size: 10.5px;
    font-weight: 600;
    letter-spacing: 0.06em;
    text-transform: uppercase;
  }
}
`;
}

export function renderDashboardJs() {
  return `(() => {
  const pollMs = 2000;
  let lastSnapshot = null;
  let lastBlueprintSnapshot = null;
  let pollTimer = null;

  function escapeHtml(value) {
    return String(value ?? "")
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;")
      .replaceAll('"', "&quot;");
  }

  function setTextAll(selector, value) {
    for (const node of document.querySelectorAll(selector)) {
      node.textContent = String(value ?? "");
    }
  }

  function verificationLabel(status = {}) {
    if (status.phase === "done") {
      return "Verified and synced";
    }
    const verification = (status.evidenceSummary ?? []).find((item) => String(item.kind ?? "").includes("verification"));
    if (verification?.ok === true) {
      return "Verification passed";
    }
    return status.nextAction ?? "Pending review";
  }

  function verificationTileLabel(status = {}) {
    return status.phase === "done" || (status.evidenceSummary ?? []).some((item) => String(item.kind ?? "").includes("verification")) ? "Verification" : "Next Step";
  }

  function renderRailList(items, emptyText, renderer) {
    if (!items || items.length === 0) {
      return '<p class="empty">' + escapeHtml(emptyText) + '</p>';
    }
    return '<div class="rail-list">' + items.map(renderer).join("") + '</div>';
  }

  function renderBlockers(blockers = []) {
    return renderRailList(blockers, "No active blockers.", (blocker) => '<div><strong>' + escapeHtml(blocker.code) + '</strong><p>' + escapeHtml(blocker.message) + '</p>' + (blocker.nextAction ? '<code>' + escapeHtml(blocker.nextAction) + '</code>' : "") + '</div>');
  }

  function renderEvidenceLinks(links = []) {
    return renderRailList(links, "No evidence recorded yet.", (link) => {
      const label = String(link.kind ?? "") + ": " + String(link.summary || link.path || "");
      const target = link.href ? '<a href="' + escapeHtml(link.href) + '">' + escapeHtml(label) + '</a>' : '<strong>' + escapeHtml(label) + '</strong>';
      return '<div>' + target + '<code>' + escapeHtml(link.path ?? "") + '</code></div>';
    });
  }

  function operatorLaneFor(workItem) {
    if (workItem.isBlocked || workItem.isRetryReady || workItem.isRework || ["Failed Fast", "Rework"].includes(workItem.lane)) {
      return "Blocked";
    }
    if (["Intake", "Discovery", "Scoped", "Blueprint Bound", "Contract Frozen"].includes(workItem.lane)) {
      return "Planned";
    }
    if (["Ready", "Claimed"].includes(workItem.lane)) {
      return "Ready";
    }
    if (workItem.lane === "Running") {
      return "In Progress";
    }
    if (["Verifying", "Human Review"].includes(workItem.lane)) {
      return "Review";
    }
    if (workItem.lane === "Done") {
      return "Done";
    }
    return "Planned";
  }

  function renderWorkItemCard(workItem) {
    const flags = [
      workItem.isBlocked ? "blocked" : null,
      workItem.isRetryReady ? "retry ready" : null,
      workItem.isRework ? "rework" : null,
      workItem.claim ? "claimed by " + workItem.claim.workerId : null
    ].filter(Boolean);
    return '<article class="work-card" data-work-item-id="' + escapeHtml(workItem.id) + '"><strong>' + escapeHtml(workItem.title ?? workItem.id) + '</strong><code>' + escapeHtml(workItem.id) + '</code><span>' + escapeHtml(workItem.responsibilityUnitId) + '</span>' + (flags.length > 0 ? '<em>' + escapeHtml(flags.join(" | ")) + '</em>' : "") + '</article>';
  }

  function renderKanban(board) {
    if (!board) {
      return '<div class="compact-kanban" data-operator-kanban="true"><p class="empty">No launch board materialized yet.</p></div>';
    }
    const order = ["Planned", "Ready", "In Progress", "Review", "Done", "Blocked"];
    const groups = new Map(order.map((name) => [name, { name, workItems: [] }]));
    for (const lane of board.lanes ?? []) {
      for (const workItem of lane.workItems ?? []) {
        groups.get(operatorLaneFor(workItem)).workItems.push({ ...workItem, internalLane: lane.name });
      }
    }
    return '<div class="compact-kanban" data-operator-kanban="true">' + [...groups.values()].filter((group) => group.workItems.length > 0 || group.name !== "Blocked").map((group) => '<section class="kanban-lane" data-lane="' + escapeHtml(group.name) + '"><header><span>' + escapeHtml(group.name) + '</span><strong>' + group.workItems.length + '</strong></header>' + group.workItems.slice(0, 3).map(renderWorkItemCard).join("") + (group.workItems.length > 3 ? '<p class="muted">+' + (group.workItems.length - 3) + ' more</p>' : "") + '</section>').join("") + '</div>';
  }

  function updateRuntime(model) {
    const status = model.status ?? {};
    const nextCommand = status.nextCommand ?? status.nextAction ?? "";

    setTextAll("[data-live-blueprint-status]", status.blueprintStatus ?? "unknown");
    setTextAll("[data-live-phase]", status.phase ?? "unknown");
    setTextAll("[data-live-headline]", status.headline ?? "Status unavailable.");
    setTextAll("[data-live-next-command]", nextCommand || "none");

    const copyButton = document.querySelector("[data-live-copy-command]");
    if (copyButton) {
      copyButton.setAttribute("data-copy", nextCommand);
      copyButton.textContent = "Copy";
    }
    const kanban = document.querySelector("[data-live-kanban]");
    if (kanban) {
      const nextKanbanHtml = renderKanban(model.board);
      if (kanban.innerHTML !== nextKanbanHtml) {
        kanban.innerHTML = nextKanbanHtml;
      }
    }
    const blockers = document.querySelector("[data-live-blockers]");
    if (blockers) {
      const nextBlockersHtml = renderBlockers(status.blockers ?? []);
      if (blockers.innerHTML !== nextBlockersHtml) {
        blockers.innerHTML = nextBlockersHtml;
      }
    }
    const evidenceLinks = document.querySelector("[data-live-evidence-links]");
    if (evidenceLinks) {
      const nextEvidenceHtml = renderEvidenceLinks(model.operatorCockpit?.evidenceLinks ?? []);
      if (evidenceLinks.innerHTML !== nextEvidenceHtml) {
        evidenceLinks.innerHTML = nextEvidenceHtml;
      }
    }
    const blueprintSnapshot = JSON.stringify(model.blueprint ?? {});
    if (lastBlueprintSnapshot !== null && blueprintSnapshot !== lastBlueprintSnapshot) {
      document.documentElement.dataset.makeitrealBlueprintChanged = "true";
    }
    lastBlueprintSnapshot = blueprintSnapshot;
    bindCommandCopy();
  }

  function bindCommandCopy() {
    for (const button of document.querySelectorAll(".copy-command[data-copy]")) {
      if (button.dataset.copyBound === "true") {
        continue;
      }
      button.dataset.copyBound = "true";
      button.addEventListener("click", async () => {
        const text = button.getAttribute("data-copy") ?? "";
        try {
          await navigator.clipboard.writeText(text);
          button.textContent = "Copied";
        } catch {
          button.textContent = "Copy failed";
        }
      });
    }
  }

  function bindNavFilter() {
    const input = document.querySelector("[data-nav-filter]");
    if (!input || input.dataset.filterBound === "true") {
      return;
    }
    input.dataset.filterBound = "true";
    const links = [...document.querySelectorAll(".architecture-nav a")];
    input.addEventListener("input", () => {
      const needle = input.value.trim().toLowerCase();
      for (const link of links) {
        link.hidden = needle.length > 0 && !link.textContent.toLowerCase().includes(needle);
      }
    });
  }

  function markAutoRefreshUnavailable() {
    document.documentElement.dataset.makeitrealAutoRefresh = "unavailable";
    if (window.location.protocol === "file:") {
      console.info("makeitreal:auto-reload:file-url-no-refresh");
    }
  }

  async function checkForDashboardUpdate() {
    try {
      const response = await fetch("./preview-model.json", { cache: "no-store" });
      if (!response.ok) {
        markAutoRefreshUnavailable();
        return;
      }
      const model = await response.json();
      const snapshot = JSON.stringify(model);
      if (lastSnapshot === null) {
        lastSnapshot = snapshot;
        updateRuntime(model);
        return;
      }
      if (snapshot !== lastSnapshot) {
        updateRuntime(model);
        lastSnapshot = snapshot;
      }
    } catch {
      markAutoRefreshUnavailable();
    }
  }

  window.makeitrealAutoReload = { checkForDashboardUpdate };
  bindCommandCopy();
  bindNavFilter();
  if (window.location.protocol === "file:") {
    markAutoRefreshUnavailable();
    return;
  }
  checkForDashboardUpdate();
  pollTimer = window.setInterval(checkForDashboardUpdate, pollMs);
  console.info("makeitreal:auto-reload");
})();
`;
}
