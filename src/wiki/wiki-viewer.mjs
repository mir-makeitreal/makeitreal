// Wiki viewer — generates a single dark-themed HTML page that renders the live
// wiki markdown files, styled to match the Architecture Dossier.

import { mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import { spawn } from "node:child_process";
import path from "node:path";
import os from "node:os";

function escapeHtml(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

// Derive a human-friendly title from a markdown body (first H1) or fall back to id.
function deriveTitle(content, id) {
  const match = /^\s*#\s+(.+?)\s*$/m.exec(content ?? "");
  if (match) {
    return match[1].trim();
  }
  return id;
}

/**
 * Generate the wiki HTML page.
 * @param {Array<{ id: string, path: string, content: string }>} wikiFiles
 * @returns {string} HTML document
 */
export function generateWikiHtml(wikiFiles = []) {
  const items = wikiFiles.map((file) => ({
    id: file.id,
    path: file.path,
    content: file.content ?? "",
    title: deriveTitle(file.content, file.id)
  }));

  const navItems = items
    .map(
      (item) =>
        `<li><a href="#wiki-${escapeHtml(item.id)}" data-target="wiki-${escapeHtml(item.id)}">${escapeHtml(item.title)}</a></li>`
    )
    .join("\n");

  const sections = items
    .map(
      (item) =>
        `<article class="wiki-item" id="wiki-${escapeHtml(item.id)}">
  <header class="wiki-item-head">
    <span class="wiki-item-id">${escapeHtml(item.id)}</span>
  </header>
  <div class="markdown-body" data-markdown>${escapeHtml(item.content)}</div>
</article>`
    )
    .join("\n");

  const emptyState = `<div class="empty-state">
  <h1>No wiki pages yet</h1>
  <p>Run <code>wiki sync &lt;runDir&gt;</code> to publish verified work to the live wiki.</p>
</div>`;

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>Live Wiki</title>
<link rel="preconnect" href="https://fonts.googleapis.com" />
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin />
<link href="https://fonts.googleapis.com/css2?family=JetBrains+Mono:wght@400;500;700&display=swap" rel="stylesheet" />
<style>
  :root {
    --bg: #020617;
    --panel: #0b1220;
    --panel-2: #0f1a30;
    --line: #1e293b;
    --line-strong: #334155;
    --ink: #e2e8f0;
    --muted: #94a3b8;
    --accent: #38bdf8;
    --accent-soft: rgba(56, 189, 248, 0.12);
    --mono: "JetBrains Mono", "SFMono-Regular", Menlo, Consolas, monospace;
  }
  * { box-sizing: border-box; }
  html, body { margin: 0; padding: 0; }
  body {
    background: var(--bg);
    color: var(--ink);
    font-family: var(--mono);
    font-size: 14px;
    line-height: 1.65;
    display: flex;
    min-height: 100vh;
  }
  a { color: var(--accent); text-decoration: none; }
  a:hover { text-decoration: underline; }
  code, pre { font-family: var(--mono); }

  /* Sidebar */
  .sidebar {
    width: 280px;
    flex-shrink: 0;
    background: var(--panel);
    border-right: 1px solid var(--line);
    padding: 24px 18px;
    position: sticky;
    top: 0;
    height: 100vh;
    overflow-y: auto;
  }
  .sidebar-brand {
    font-size: 12px;
    letter-spacing: 0.18em;
    text-transform: uppercase;
    color: var(--muted);
    margin: 0 0 4px;
  }
  .sidebar-title {
    font-size: 18px;
    font-weight: 700;
    margin: 0 0 20px;
    color: var(--ink);
  }
  .sidebar ul { list-style: none; margin: 0; padding: 0; }
  .sidebar li { margin: 0 0 2px; }
  .sidebar li a {
    display: block;
    padding: 7px 10px;
    border-radius: 6px;
    color: var(--muted);
    font-size: 13px;
    border-left: 2px solid transparent;
    transition: background .12s ease, color .12s ease, border-color .12s ease;
  }
  .sidebar li a:hover { background: var(--accent-soft); color: var(--ink); text-decoration: none; }
  .sidebar li a.active { background: var(--accent-soft); color: var(--accent); border-left-color: var(--accent); }

  /* Main */
  .main {
    flex: 1;
    padding: 40px 56px;
    max-width: 920px;
    overflow-x: hidden;
  }
  .wiki-item { margin: 0 0 56px; scroll-margin-top: 24px; }
  .wiki-item-head { margin: 0 0 12px; }
  .wiki-item-id {
    display: inline-block;
    font-size: 11px;
    letter-spacing: 0.08em;
    text-transform: uppercase;
    color: var(--accent);
    background: var(--accent-soft);
    border-radius: 4px;
    padding: 2px 8px;
    font-weight: 700;
  }

  /* Markdown */
  .markdown-body h1, .markdown-body h2, .markdown-body h3,
  .markdown-body h4 { color: var(--ink); line-height: 1.3; margin: 1.6em 0 0.6em; }
  .markdown-body h1 { font-size: 26px; border-bottom: 1px solid var(--line); padding-bottom: 0.3em; }
  .markdown-body h2 { font-size: 20px; border-bottom: 1px solid var(--line); padding-bottom: 0.25em; }
  .markdown-body h3 { font-size: 16px; }
  .markdown-body p { margin: 0.8em 0; }
  .markdown-body ul, .markdown-body ol { padding-left: 1.4em; }
  .markdown-body li { margin: 0.25em 0; }
  .markdown-body a { color: var(--accent); }
  .markdown-body code {
    background: var(--panel-2);
    border: 1px solid var(--line);
    border-radius: 4px;
    padding: 1px 5px;
    font-size: 12.5px;
  }
  .markdown-body pre {
    background: var(--panel-2);
    border: 1px solid var(--line);
    border-radius: 8px;
    padding: 14px 16px;
    overflow-x: auto;
  }
  .markdown-body pre code { background: transparent; border: 0; padding: 0; }
  .markdown-body blockquote {
    margin: 1em 0;
    padding: 4px 16px;
    border-left: 3px solid var(--accent);
    background: var(--accent-soft);
    color: var(--muted);
  }
  .markdown-body table { border-collapse: collapse; width: 100%; margin: 1em 0; }
  .markdown-body th, .markdown-body td { border: 1px solid var(--line); padding: 6px 10px; text-align: left; }
  .markdown-body th { background: var(--panel-2); }
  .markdown-body hr { border: 0; border-top: 1px solid var(--line); margin: 2em 0; }

  .empty-state { margin: auto; text-align: center; color: var(--muted); padding: 80px 20px; }
  .empty-state h1 { color: var(--ink); }
  .empty-state code { background: var(--panel-2); border: 1px solid var(--line); border-radius: 4px; padding: 2px 6px; }
</style>
</head>
<body>
  <aside class="sidebar">
    <p class="sidebar-brand">Make It Real</p>
    <p class="sidebar-title">Live Wiki</p>
    <nav aria-label="Work items">
      <ul>${items.length > 0 ? navItems : '<li class="muted">No pages</li>'}</ul>
    </nav>
  </aside>
  <main class="main">
    ${items.length > 0 ? sections : emptyState}
  </main>

  <script src="https://cdn.jsdelivr.net/npm/marked/marked.min.js"></script>
  <script>
    (function () {
      function render() {
        if (typeof marked === "undefined") return;
        document.querySelectorAll("[data-markdown]").forEach(function (el) {
          el.innerHTML = marked.parse(el.textContent || "");
        });
      }
      render();

      // Active-link highlighting on scroll.
      var links = Array.prototype.slice.call(document.querySelectorAll(".sidebar a"));
      var byId = {};
      links.forEach(function (a) { byId[a.dataset.target] = a; });
      if ("IntersectionObserver" in window && links.length) {
        var observer = new IntersectionObserver(function (entries) {
          entries.forEach(function (entry) {
            if (entry.isIntersecting && byId[entry.target.id]) {
              links.forEach(function (a) { a.classList.remove("active"); });
              byId[entry.target.id].classList.add("active");
            }
          });
        }, { rootMargin: "-10% 0px -80% 0px" });
        document.querySelectorAll(".wiki-item").forEach(function (item) { observer.observe(item); });
      }
    })();
  </script>
</body>
</html>`;
}

// Resolve the canonical wiki paths for a run directory.
export function resolveWikiPaths(runDir) {
  // runDir is <project>/.makeitreal/runs/<slug>/
  // wiki lives at <project>/.makeitreal/wiki/live/
  const makeiteralRoot = path.resolve(runDir, "..", "..");
  const wikiDir = path.join(makeiteralRoot, "wiki");
  return {
    wikiDir,
    liveDir: path.join(wikiDir, "live"),
    indexPath: path.join(wikiDir, "index.html")
  };
}

// Read all markdown files from the live wiki directory.
// Returns [] when the directory is absent or holds no .md files.
export async function readWikiFiles(liveDir) {
  let entries;
  try {
    entries = await readdir(liveDir, { withFileTypes: true });
  } catch (error) {
    if (error && error.code === "ENOENT") {
      return [];
    }
    throw error;
  }
  const mdNames = entries
    .filter((entry) => entry.isFile() && entry.name.endsWith(".md"))
    .map((entry) => entry.name)
    .sort();
  const files = [];
  for (const name of mdNames) {
    const filePath = path.join(liveDir, name);
    const content = await readFile(filePath, "utf8");
    files.push({ id: name.replace(/\.md$/, ""), path: filePath, content });
  }
  return files;
}

// Read the live wiki, render HTML, and write it to <runDir>/.makeitreal/wiki/index.html.
// Returns { wikiFiles, indexPath, count }.
export async function buildWikiIndex(runDir) {
  const { liveDir, indexPath, wikiDir } = resolveWikiPaths(runDir);
  await mkdir(wikiDir, { recursive: true });
  const wikiFiles = await readWikiFiles(liveDir);
  const html = generateWikiHtml(wikiFiles);
  await writeFile(indexPath, html, "utf8");
  return { wikiFiles, indexPath, liveDir, count: wikiFiles.length };
}

// Open a file in the default browser (macOS `open`, Linux `xdg-open`).
export function openInBrowser(filePath) {
  const platform = os.platform();
  const opener = platform === "darwin" ? "open" : platform === "win32" ? "cmd" : "xdg-open";
  const args = platform === "win32" ? ["/c", "start", "", filePath] : [filePath];
  const child = spawn(opener, args, { stdio: "ignore", detached: true });
  child.on("error", () => {});
  child.unref();
}
