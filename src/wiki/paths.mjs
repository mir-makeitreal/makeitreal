// Canonical wiki path resolution — the single source of truth shared by the
// wiki producers (wiki sync, orchestrator complete) and the wiki viewer.
//
// Canonical layout: a run lives at <project>/.makeitreal/runs/<slug>/ and its
// live wiki lives at <project>/.makeitreal/wiki/live/. Standalone run
// directories with no .makeitreal ancestor (e.g. test fixtures) keep the wiki
// inside the run itself at <runDir>/.makeitreal/wiki/live/.

import path from "node:path";

// Resolve the canonical wiki paths for a run directory.
export function resolveWikiPaths(runDir) {
  const resolvedRunDir = path.resolve(runDir);
  const segments = resolvedRunDir.split(path.sep);
  const makeitrealIndex = segments.lastIndexOf(".makeitreal");
  const makeitrealRoot = makeitrealIndex >= 0
    ? segments.slice(0, makeitrealIndex + 1).join(path.sep)
    : path.join(resolvedRunDir, ".makeitreal");
  const wikiDir = path.join(makeitrealRoot, "wiki");
  return {
    projectRoot: path.dirname(makeitrealRoot),
    wikiDir,
    liveDir: path.join(wikiDir, "live"),
    indexPath: path.join(wikiDir, "index.html")
  };
}
