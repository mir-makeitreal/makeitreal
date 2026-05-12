# Make It Real Backlog

## Dashboard App Shell

Status: Deferred

Problem:
The current dashboard is generated as static HTML with a small polling script. Runtime data now updates without full-page reload, but a static renderer still limits richer client-side interactions such as filtering, search, route-level module pages, and structural Blueprint diffing.

Target:
Move the dashboard renderer to a small Vite/React app shell only if the static artifact becomes too constrained. The app may hydrate from `preview-model.json`, support richer module navigation/search, and keep Blueprint review/launch actions inside Claude Code rather than browser controls.

Acceptance:
- Runtime refresh continues to avoid full-page reload flicker.
- Module-level navigation remains generated from actual `moduleInterfaces`, not fixed menu labels.
- Mermaid diagrams remain generated from `design-pack.json` or derived preview model data.
- The dashboard remains read-only and does not call mutating Make It Real engine commands.
- Static artifact fallback remains available for portable file review.
