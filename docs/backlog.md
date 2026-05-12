# Make It Real Backlog

## Dashboard App Shell

Status: Deferred

Problem:
The current dashboard is generated as static HTML with a small polling script. That keeps the artifact portable, but it makes smooth live updates difficult. When the preview model changes, the current page cannot reconcile state like a real app, and full-page refresh paths can visibly flicker.

Target:
Move the dashboard renderer to a small Vite/React app shell while preserving the current read-only contract. The app may hydrate from `preview-model.json`, update runtime/Kanban/evidence regions without full reload, and keep Blueprint review/launch actions inside Claude Code rather than browser controls.

Acceptance:
- Data refetch updates visible runtime state without full page reload flicker.
- Mermaid diagrams remain generated from `design-pack.json` or derived preview model data.
- The dashboard remains read-only and does not call mutating Make It Real engine commands.
- Static artifact fallback remains available for portable file review.
