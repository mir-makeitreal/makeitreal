# Visual Companion Architecture Analysis

Deep analysis of Superpowers' brainstorming visual companion pattern and how
Make It Real should adapt it.

---

## 1. CSS Classes & Components in frame-template.html

The frame template is a complete design system with ~20 component classes.
The agent writes HTML FRAGMENTS that reference these classes — the server wraps
the fragment in the template automatically.

### Frame Structure (auto-provided, agent doesn't write these)

| Class              | Purpose                                    |
|--------------------|--------------------------------------------|
| `.header`          | Fixed top bar with title + status indicator |
| `.header h1`      | Small 0.85rem title text                   |
| `.header .status`  | Green dot + "Connected" text               |
| `.main`           | Flex-1 scrollable content area             |
| `#claude-content` | Container where fragment HTML is injected   |
| `.indicator-bar`  | Fixed bottom bar showing selection state    |
| `.selected-text`  | Accent-colored text in indicator bar        |

### Theme Variables (auto-applied via prefers-color-scheme)

Light + dark mode with these CSS custom properties:
- `--bg-primary`, `--bg-secondary`, `--bg-tertiary` (3-tier backgrounds)
- `--border` (border color)
- `--text-primary`, `--text-secondary`, `--text-tertiary` (3-tier text)
- `--accent`, `--accent-hover` (blue action color)
- `--success` (green), `--warning` (orange), `--error` (red)
- `--selected-bg`, `--selected-border` (selection highlight)

### Typography (agent uses these in fragments)

| Class       | Purpose                                     | Example                       |
|-------------|---------------------------------------------|-------------------------------|
| `h2`        | Page title, 1.5rem bold                     | `<h2>Pick a layout</h2>`     |
| `h3`        | Section heading, 1.1rem bold                | `<h3>Option details</h3>`    |
| `.subtitle` | Secondary text below title (muted color)    | `<p class="subtitle">...</p>`|
| `.section`  | Content block with 2rem bottom margin       | `<div class="section">...</div>` |
| `.label`    | Small uppercase label, 0.7rem               | `<div class="label">STEP 1</div>` |

### Interactive Components

#### Options (A/B/C choices) — `.options` + `.option`
```html
<div class="options">
  <div class="option" data-choice="a" onclick="toggleSelect(this)">
    <div class="letter">A</div>
    <div class="content">
      <h3>Single Column</h3>
      <p>Clean, focused reading experience</p>
    </div>
  </div>
</div>
```
- Container `.options`: vertical flex, 0.75rem gap
- Each `.option`: bg-secondary, 2px border, 12px radius, hover highlights accent
- `.option.selected`: accent border + tinted background
- `.option .letter`: small square badge (A, B, C)
- `.option .content`: flex-1 with h3 title + p description
- Multi-select: add `data-multiselect` to container

#### Cards (visual designs) — `.cards` + `.card`
```html
<div class="cards">
  <div class="card" data-choice="design1" onclick="toggleSelect(this)">
    <div class="card-image"><!-- mockup --></div>
    <div class="card-body"><h3>Name</h3><p>Desc</p></div>
  </div>
</div>
```
- Container `.cards`: CSS grid, auto-fit columns min 280px
- `.card`: bg-secondary, 1px border, 12px radius, hover lifts (-2px) + shadow
- `.card-image`: 16:10 aspect ratio placeholder area
- `.card-body`: 1rem padding with h3 + p

#### Mockup Container — `.mockup`
```html
<div class="mockup">
  <div class="mockup-header">Preview: Dashboard</div>
  <div class="mockup-body"><!-- content --></div>
</div>
```
- `.mockup`: bordered rounded container
- `.mockup-header`: gray bar with label text
- `.mockup-body`: 1.5rem padded content area

#### Split View — `.split`
```html
<div class="split">
  <div class="mockup"><!-- left --></div>
  <div class="mockup"><!-- right --></div>
</div>
```
- 2-column grid, collapses to 1-col under 700px

#### Pros/Cons — `.pros-cons`
```html
<div class="pros-cons">
  <div class="pros"><h4>Pros</h4><ul><li>Benefit</li></ul></div>
  <div class="cons"><h4>Cons</h4><ul><li>Drawback</li></ul></div>
</div>
```
- 2-column grid, green/red headers

### Wireframe Building Blocks

| Class           | Purpose                                         |
|-----------------|--------------------------------------------------|
| `.mock-nav`     | Colored nav bar (accent bg, white text, flex)    |
| `.mock-sidebar` | Gray sidebar panel (tertiary bg, 180px min)      |
| `.mock-content` | Main content area (flex: 1, 1.5rem padding)      |
| `.mock-button`  | Accent-colored button (rounded, white text)      |
| `.mock-input`   | Styled input field (border, rounded)             |
| `.placeholder`  | Dashed-border placeholder area (centered text)   |

### Total Component Count: ~20 CSS classes across 8 component categories

---

## 2. File Watching Mechanism

### How the server detects changes

**Mechanism:** `fs.watch()` on `CONTENT_DIR` (Node.js native filesystem watcher)

```
server.cjs line 276:
  fs.watch(CONTENT_DIR, (eventType, filename) => { ... })
```

**Filter:** Only `.html` files trigger reload.

**Debounce:** 100ms debounce per filename via `setTimeout` map. If a file
triggers multiple events within 100ms (common with editors), only the last
fires.

**New vs Updated distinction:**
- Server tracks `knownFiles` set at startup (all existing .html files)
- If filename is NOT in knownFiles → "screen-added" event, clears events file
- If filename IS in knownFiles → "screen-updated" event
- macOS `fs.watch` reports 'rename' for both new files and overwrites, so the
  server cannot rely on eventType alone — it uses the known set instead

**After detection:** Server calls `broadcast({ type: 'reload' })` to all
connected WebSocket clients.

**Key design choice:** The server doesn't send the new content over WebSocket.
It just says "reload" and the browser does a full page refresh via
`window.location.reload()`. This is dead simple — no incremental DOM patching.

---

## 3. WebSocket Protocol — Message Flow

### Connection
- Client connects to `ws://localhost:{PORT}` (helper.js auto-connects)
- Server does RFC 6455 handshake (custom implementation, zero dependencies)
- Auto-reconnect on close with 1-second delay

### Server → Client Messages

Only ONE message type:
```json
{"type": "reload"}
```
Triggered when any .html file in content dir changes. Client responds with
`window.location.reload()`.

### Client → Server Messages

Click events with this shape:
```json
{
  "type": "click",
  "text": "Option A - Simple Layout",
  "choice": "a",
  "id": null,
  "timestamp": 1706000101
}
```

Sent when user clicks any element with `data-choice` attribute.

### Server-side handling of client messages

1. Parse JSON
2. Log to stdout: `{"source": "user-event", ...event}`
3. If event has `.choice` field → append JSON line to `STATE_DIR/events` file
4. The agent reads this file on its next turn

### Client-side event queue

If WebSocket isn't connected when user clicks, events are queued in
`eventQueue[]` and flushed on reconnect.

### Exposed client API
```javascript
window.brainstorm.send(event)           // send arbitrary event
window.brainstorm.choice(value, meta)   // send choice event
```

### Summary of data flow:
```
Agent writes .html file
  → fs.watch detects change (100ms debounce)
  → Server broadcasts {"type":"reload"} via WebSocket
  → Browser reloads page (full refresh)
  → User sees new content, clicks option
  → helper.js sends {"type":"click","choice":"a",...} via WebSocket
  → Server appends to STATE_DIR/events file
  → Agent reads events file on next turn
```

---

## 4. When Visual vs Terminal (from SKILL.md)

The decision is made PER QUESTION, not per session.

### The Test
> "Would the user understand this better by SEEING it than READING it?"

### Use Browser (visual):
- UI mockups — wireframes, layouts, navigation, component designs
- Architecture diagrams — system components, data flow, relationships
- Side-by-side visual comparisons — layouts, color schemes, designs
- Design polish — look and feel, spacing, visual hierarchy
- Spatial relationships — state machines, flowcharts, ERDs as diagrams

### Use Terminal (text):
- Requirements/scope questions
- Conceptual A/B/C choices (described in words)
- Tradeoff/comparison lists
- Technical decisions (API design, data modeling)
- Clarifying questions

### Key Insight
"A question ABOUT a UI topic is not automatically a visual question."
- "What kind of wizard do you want?" → terminal (conceptual)
- "Which wizard layout feels right?" → browser (visual)

### Consent Flow
1. Agent assesses if visual questions are likely
2. Offers companion in its OWN dedicated message (no other content)
3. User accepts or declines
4. Even after acceptance, each question individually assessed

---

## 5. Full Lifecycle

### START
1. Agent runs `scripts/start-server.sh --project-dir /path`
2. Server starts HTTP+WS on random high port (49152-65535)
3. Creates `CONTENT_DIR` and `STATE_DIR` directories
4. Writes `STATE_DIR/server-info` with JSON: port, URL, paths
5. Starts `fs.watch` on CONTENT_DIR
6. Starts 60-second lifecycle check interval (owner PID + idle timeout)
7. Agent tells user to open the URL

### SERVE
1. HTTP GET `/` → finds newest .html by mtime in CONTENT_DIR
2. If fragment (no `<!doctype`/`<html>`) → wraps in frame-template.html
3. If full document → serves as-is
4. Either way: injects helper.js before `</body>`
5. HTTP GET `/files/{name}` → serves static assets from CONTENT_DIR

### UPDATE (the loop)
1. Agent checks `STATE_DIR/server-info` exists (server alive?)
2. Agent writes new .html file to CONTENT_DIR (semantic name, never reuse)
3. `fs.watch` fires → 100ms debounce → detect new/updated
4. If new file → clear STATE_DIR/events (fresh interaction slate)
5. `broadcast({type:'reload'})` to all WS clients
6. Browser reloads, renders new content
7. Agent tells user what's on screen + reminds them of URL
8. Agent ends turn, waits for user response

### INTERACT
1. User clicks `data-choice` element in browser
2. `toggleSelect()` handles visual selection state (single or multi)
3. `helper.js` sends click event over WebSocket
4. Server appends to `STATE_DIR/events` file
5. Indicator bar updates: "Option X selected — return to terminal"
6. User returns to terminal, types feedback
7. Agent reads `STATE_DIR/events` + terminal text on next turn
8. Merges both signals for full picture

### CLEANUP
1. Agent runs `scripts/stop-server.sh $SESSION_DIR`
2. Server writes `STATE_DIR/server-stopped` with reason + timestamp
3. Removes `STATE_DIR/server-info`
4. Closes fs.watch, stops lifecycle interval, closes HTTP server
5. Auto-cleanup triggers:
   - Owner PID dies → server exits
   - 30 minutes idle → server exits
6. With --project-dir: mockup files persist in `.superpowers/brainstorm/`
7. Without --project-dir: `/tmp` files get cleaned up

---

## 6. Pattern Comparison: Superpowers vs Make It Real

### The Core Pattern (shared)

Both follow the same fundamental architecture:

```
AGENT writes DATA to FILESYSTEM
  → SERVER detects change via fs.watch
  → SERVER notifies CLIENT via WebSocket
  → PRE-BUILT CLIENT renders data using BUILT-IN COMPONENTS
  → USER interacts
  → EVENTS flow back to AGENT via filesystem
```

The agent NEVER generates the full application. It generates DATA/CONTENT that
plugs into a pre-built rendering system.

### Detailed Comparison

| Aspect                  | Superpowers                          | Make It Real                          |
|-------------------------|--------------------------------------|---------------------------------------|
| **Data format**         | HTML fragments                       | preview-model.json                    |
| **Data language**       | HTML + CSS class references          | JSON (typed schema)                   |
| **Pre-built client**    | frame-template.html (static HTML+CSS)| React app with React Flow             |
| **Component system**    | CSS classes (.options, .cards, etc.) | React components (TopologyGraph, DAG, ContractDisplay, FileTree, SequenceDiagram) |
| **Rendering**           | Browser interprets HTML directly     | React renders from JSON model         |
| **Update mechanism**    | Full page reload                     | React state update (no reload needed) |
| **Server**              | Zero-dep Node.js HTTP+WS             | Node.js server (HTTP + WS + REST API) |
| **Interaction model**   | Click → choice event → events file   | Click → interaction event → events or direct WS |
| **Agent reads from**    | STATE_DIR/events file (JSONL)        | Similar: events file or API           |
| **Watched files**       | *.html in content dir                | preview-model.json specifically        |
| **Template wrapping**   | Server wraps fragment in frame       | Not needed — React app IS the frame   |

### What Superpowers Gets Right (and we should keep)

1. **Filesystem as IPC.** Agent writes files, server watches files. No custom
   protocols, no agent-to-server API calls. The agent already knows how to
   write files — that's its primary tool.

2. **Pre-built component vocabulary.** Agent doesn't freestyle the UI. It picks
   from a known set of components. This constrains the design space and
   produces consistent results. The agent's SKILL.md teaches it what
   components exist.

3. **Server-injected infrastructure.** Agent writes ONLY content. WebSocket
   connection, event handling, selection tracking — all injected by the
   server/template automatically.

4. **Separation: visual vs textual questions.** Not everything goes to the
   browser. The agent decides per-question.

5. **Events file as interaction record.** Clean, readable, appendable. Agent
   reads it on next turn. New screen clears it.

6. **Dead simple reload.** No incremental patching. Content changes → full
   reload. For brainstorming this is fine.

### Where Make It Real Diverges (and why)

#### 1. JSON instead of HTML fragments

**Why:** The superpowers agent writes raw HTML because the rendered output IS
HTML. Our pre-built components are React — the agent can't write JSX. Instead,
it writes a JSON model that describes WHAT to show, and React decides HOW.

```json
// preview-model.json (what the agent writes)
{
  "version": 1,
  "title": "Service Topology",
  "views": [
    {
      "type": "topology",
      "id": "main-topo",
      "nodes": [
        {"id": "api-gw", "label": "API Gateway", "type": "service", "x": 100, "y": 50},
        {"id": "auth", "label": "Auth Service", "type": "service", "x": 300, "y": 50}
      ],
      "edges": [
        {"source": "api-gw", "target": "auth", "label": "gRPC"}
      ]
    },
    {
      "type": "contract",
      "id": "auth-contract",
      "service": "auth",
      "endpoints": [
        {"method": "POST", "path": "/verify", "request": "TokenPayload", "response": "AuthResult"}
      ]
    }
  ]
}
```

**Advantage over HTML:** Structured, validatable, diffable. The React app can
animate transitions between model versions. HTML fragments can't do that.

**Disadvantage:** Less expressive. HTML fragments can contain arbitrary visual
content. JSON is limited to what the schema supports. We must ensure our
component library covers the use cases.

#### 2. React app instead of HTML template

**Why:** Our visualizations are complex — topology graphs with zoom/pan/layout,
DAGs with dependency resolution, sequence diagrams. These need React Flow,
D3, or similar. A CSS-only template can't do this.

**Implication:** The "template" is not a single HTML file — it's a built React
app served as static assets. The server serves `/` → index.html + JS bundle.

#### 3. Live state update instead of full reload

**Why:** Superpowers reloads the entire page on every change. This is fine for
static content. For interactive graphs (zoomed in, nodes selected, panel open),
a full reload would lose all interaction state.

**Mechanism:**
```
Agent writes preview-model.json
  → fs.watch detects change
  → Server reads new JSON
  → Server sends JSON over WebSocket: {"type":"model-update","data":{...}}
  → React app diffs old vs new model
  → React re-renders affected components (no page reload)
  → User's zoom level, selections, scroll position preserved
```

This is the BIGGEST architectural difference. Superpowers can afford dumb
reload because its content is stateless HTML. Our content is stateful
interactive graphs.

#### 4. Richer interaction events

Superpowers captures: click → choice string. That's enough for A/B/C selection.

Make It Real needs richer events:
```json
{"type": "node-select", "nodeId": "auth-service", "timestamp": ...}
{"type": "edge-inspect", "edgeId": "api-gw→auth", "timestamp": ...}
{"type": "zoom-to-fit", "timestamp": ...}
{"type": "annotation", "nodeId": "auth-service", "text": "This needs rate limiting", "timestamp": ...}
```

These still get written to an events file for the agent to read.

### Proposed Make It Real Architecture

```
┌──────────────────────────────────────────────────────────────┐
│  AGENT (Hermes)                                              │
│                                                              │
│  Writes: preview-model.json                                  │
│  Reads:  state/events (JSONL)                                │
│  Reads:  state/server-info                                   │
│                                                              │
│  Skills teach: what view types exist, JSON schema for each,  │
│  when to use visual vs terminal                              │
└─────────┬────────────────────────────────┬───────────────────┘
          │ writes                         │ reads
          ▼                                ▼
┌─────────────────────┐     ┌─────────────────────────────────┐
│  preview-model.json │     │  state/events (JSONL)           │
│  (in content dir)   │     │  state/server-info              │
└─────────┬───────────┘     └──────────────────┬──────────────┘
          │ fs.watch                            │ appendFile
          ▼                                     │
┌──────────────────────────────────────────────────────────────┐
│  SERVER (Node.js, zero-dep or minimal)                       │
│                                                              │
│  HTTP:  GET /           → serves React app (index.html+JS)  │
│         GET /api/model  → returns current preview-model.json │
│                                                              │
│  WS:    → client: {"type":"model-update","data":{...}}       │
│          ← client: {"type":"node-select","nodeId":"..."}     │
│                                                              │
│  fs.watch on content dir for preview-model.json changes      │
│  Writes interaction events to state/events                   │
│  Lifecycle: owner PID check + idle timeout                   │
└──────────────────────────────────────────────────────────────┘
          │ WebSocket                       ▲ WebSocket
          ▼                                 │
┌──────────────────────────────────────────────────────────────┐
│  REACT APP (pre-built, served as static bundle)              │
│                                                              │
│  Components:                                                 │
│  ┌─────────────┐ ┌──────────┐ ┌────────────────────┐        │
│  │ TopologyGraph│ │   DAG    │ │  ContractDisplay   │        │
│  │ (React Flow) │ │(RF/D3)  │ │  (structured view) │        │
│  └─────────────┘ └──────────┘ └────────────────────┘        │
│  ┌─────────────┐ ┌──────────────────────┐                    │
│  │  FileTree   │ │  SequenceDiagram     │                    │
│  │ (tree view) │ │  (mermaid/custom)    │                    │
│  └─────────────┘ └──────────────────────┘                    │
│                                                              │
│  Receives model over WS → diffs → re-renders                │
│  User interactions → sends events over WS                    │
│  Dark/light theme (same pattern as superpowers)              │
│  Header + status bar (same pattern as superpowers)           │
└──────────────────────────────────────────────────────────────┘
```

### Component Mapping: Superpowers → Make It Real

| Superpowers Component | Make It Real Equivalent              |
|----------------------|---------------------------------------|
| `.options`           | SelectionPanel (A/B/C choices)        |
| `.cards`             | CardGrid (design comparisons)         |
| `.mockup`            | PreviewContainer (generic wrapper)    |
| `.split`             | SplitView (side-by-side)              |
| `.pros-cons`         | ComparisonTable (structured compare)  |
| `.placeholder`       | EmptyState (loading/waiting)          |
| `.mock-nav`          | N/A (we have real nav components)     |
| (no equivalent)      | TopologyGraph (React Flow nodes/edges)|
| (no equivalent)      | DAGView (dependency graph)            |
| (no equivalent)      | ContractDisplay (API/service specs)   |
| (no equivalent)      | FileTree (project structure)          |
| (no equivalent)      | SequenceDiagram (interaction flows)   |

### What the Agent's Skill File Would Teach

Like superpowers' visual-companion.md, we need a guide that teaches the agent:

1. **What view types exist** — topology, dag, contract, file-tree, sequence
2. **JSON schema for each** — exact fields, required vs optional
3. **When to use which** — topology for service relationships, DAG for build
   dependencies, contract for API specs, etc.
4. **When to use visual vs terminal** — same principle as superpowers
5. **The update loop** — write JSON → tell user → read events → iterate

### Key Design Decisions

1. **Single file (preview-model.json) vs multiple files**
   Superpowers uses multiple .html files (one per screen, newest wins).
   We should use a SINGLE preview-model.json that gets overwritten.
   Reason: the React app needs to diff old vs new state. Multiple files
   would require tracking which is "current."

2. **Model versioning**
   Include a `version` counter in the JSON. React app can detect version
   changes and decide whether to animate transitions or hard-reset.

3. **Multi-view support**
   The `views` array in the JSON allows showing multiple panels at once
   (e.g., topology graph + contract detail for selected service). The React
   app has a layout engine that arranges views.

4. **Interaction richness**
   Beyond simple click→choice, support: node selection, edge inspection,
   zoom/pan state, annotations. These are all written to events file.

5. **Static bundle**
   The React app is pre-built (not built on-the-fly). The server serves it
   from a `dist/` directory. This means zero build-time dependencies at
   runtime — matching superpowers' zero-dep philosophy.

### Implementation Phases

**Phase 1: Minimum Viable (mirrors superpowers exactly)**
- Server watches preview-model.json
- On change: broadcasts reload (same as superpowers)
- React app fetches /api/model on load
- Simple: topology graph only
- Events: node click → events file

**Phase 2: Live update (diverges from superpowers)**
- Server sends model diff over WebSocket (no page reload)
- React app applies diff, preserves interaction state
- Add DAG and contract display components

**Phase 3: Rich interaction**
- Annotations, filtering, layout controls
- Richer events: zoom, pan, multi-select, annotation text
- File tree and sequence diagram components

---

## Summary

The superpowers visual companion is an elegantly simple pattern:
**pre-built frame + agent-written content + filesystem IPC + WebSocket reload**.

Make It Real adapts this pattern by:
1. Replacing HTML fragments with structured JSON
2. Replacing the CSS template with a React app
3. Replacing full-page reload with WebSocket-driven state updates
4. Adding rich interactive components (graphs, DAGs, trees)
5. Keeping the core IPC mechanism: agent writes files, server watches, browser updates

The PRINCIPLE is identical. The IMPLEMENTATION differs because our content is
interactive graphs, not static mockups.
