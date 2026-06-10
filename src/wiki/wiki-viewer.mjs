// Wiki viewer — generates a single dark-themed HTML page that renders the live
// wiki markdown files, styled to match the Architecture Dossier.

import { mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import { spawn } from "node:child_process";
import path from "node:path";
import os from "node:os";
import { resolveWikiPaths } from "./paths.mjs";

// Re-export the canonical resolver so viewer consumers keep a single import site.
export { resolveWikiPaths } from "./paths.mjs";

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
 * @param {Array<{ id: string, path: string, content: string, lane?: string }>} wikiFiles
 * @returns {string} HTML document
 */
export function generateWikiHtml(wikiFiles = []) {
  const items = wikiFiles.map((file) => {
    const content = file.content ?? "";
    // Parse lane from frontmatter (lane: Done) or inline field (**Lane:** Done)
    let lane = file.lane ?? "";
    if (!lane) {
      const fmMatch = /^---[\s\S]*?^lane:\s*(.+?)\s*$/m.exec(content);
      if (fmMatch) lane = fmMatch[1].trim();
    }
    if (!lane) {
      const inlineMatch = /\*\*Lane:\*\*\s*(.+?)(?:\n|$)/i.exec(content);
      if (inlineMatch) lane = inlineMatch[1].trim();
    }
    return {
      id: file.id,
      path: file.path,
      content,
      title: deriveTitle(content, file.id),
      lane
    };
  });

  // Lane pill color helper
  function lanePillStyle(lane) {
    const l = (lane || "").toLowerCase();
    if (l === "done") return "background:#10b981;color:#fff;";
    if (l === "running") return "background:#3b82f6;color:#fff;";
    if (l === "verifying") return "background:#8b5cf6;color:#fff;";
    if (l === "ready" || l === "frozen") return "background:#f59e0b;color:#111;";
    if (l === "failed") return "background:#ef4444;color:#fff;";
    return "background:rgba(255,255,255,0.1);color:#d0d6e0;";
  }

  function lanePill(lane, extraStyle = "") {
    if (!lane) return "";
    return `<span class="lane-pill" style="${lanePillStyle(lane)}${extraStyle}">${escapeHtml(lane)}</span>`;
  }

  // Strip 'work.' prefix for display
  function displayId(id) {
    return id.replace(/^work\./, "");
  }

  const navItems = items
    .map(
      (item) =>
        `<li><a href="#work-${escapeHtml(displayId(item.id))}" data-target="work-${escapeHtml(displayId(item.id))}"><span class="nav-label">${escapeHtml(displayId(item.id))}</span>${lanePill(item.lane, "margin-left:auto;")}</a></li>`
    )
    .join("\n");

  const sections = items
    .map(
      (item) => {
        const sid = `work-${escapeHtml(displayId(item.id))}`;
        return `<section class="wiki-section" id="${sid}">
  <div class="section-header">
    <h1 class="section-title">${escapeHtml(displayId(item.id))}</h1>
    ${lanePill(item.lane)}
  </div>
  <hr class="section-divider" />
  <div class="markdown-body" data-markdown>${escapeHtml(item.content)}</div>
</section>`;
      }
    )
    .join("\n");

  const emptyState = `<div class="empty-state">
  <div class="empty-icon">📋</div>
  <h2>No wiki pages yet</h2>
  <p>Wiki pages are written automatically after each work item is verified. Run /mir:launch to start building.</p>
</div>`;

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>Live Wiki</title>
<link rel="preconnect" href="https://fonts.googleapis.com" />
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin />
<link href="https://fonts.googleapis.com/css2?family=Inter:wght@300;400;500;600&family=JetBrains+Mono:wght@400;500&display=swap" rel="stylesheet" />
<style>
  :root {
    --bg: #08090a;
    --panel: #0f1011;
    --surface: #191a1b;
    --text-primary: #f7f8f8;
    --text-secondary: #d0d6e0;
    --text-muted: #8a8f98;
    --accent: #7170ff;
    --accent-dim: #5e6ad2;
    --border: rgba(255,255,255,0.08);
    --border-subtle: rgba(255,255,255,0.05);
    --font-sans: 'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
    --font-mono: 'JetBrains Mono', 'SFMono-Regular', Menlo, Consolas, monospace;
  }
  *, *::before, *::after { box-sizing: border-box; }
  html, body { margin: 0; padding: 0; height: 100%; }
  body {
    background: var(--bg);
    color: var(--text-secondary);
    font-family: var(--font-sans);
    font-feature-settings: 'cv01', 'ss03';
    font-size: 14px;
    line-height: 1.6;
    display: flex;
    height: 100vh;
    overflow: hidden;
  }

  /* Lane pill */
  .lane-pill {
    display: inline-flex;
    align-items: center;
    font-family: var(--font-sans);
    font-feature-settings: 'cv01', 'ss03';
    font-size: 11px;
    font-weight: 600;
    line-height: 1;
    border-radius: 4px;
    padding: 4px 6px;
    white-space: nowrap;
    flex-shrink: 0;
  }

  /* Sidebar */
  .sidebar {
    width: 260px;
    flex-shrink: 0;
    background: var(--panel);
    border-right: 1px solid var(--border);
    display: flex;
    flex-direction: column;
    height: 100vh;
    overflow: hidden;
  }
  .sidebar-top {
    padding: 20px 16px 16px;
    display: flex;
    align-items: center;
    gap: 10px;
    flex-shrink: 0;
  }
  .sidebar-brand {
    font-family: var(--font-sans);
    font-feature-settings: 'cv01', 'ss03';
    font-size: 14px;
    font-weight: 600;
    color: var(--text-primary);
    margin: 0;
    white-space: nowrap;
  }
  .badge-live-wiki {
    background: var(--accent-dim);
    color: var(--text-primary);
    font-family: var(--font-sans);
    font-feature-settings: 'cv01', 'ss03';
    font-size: 11px;
    font-weight: 500;
    border-radius: 4px;
    padding: 4px 6px;
    white-space: nowrap;
    flex-shrink: 0;
  }
  .sidebar-nav {
    flex: 1;
    overflow-y: auto;
    padding: 4px 8px;
  }
  .sidebar-nav::-webkit-scrollbar { width: 4px; }
  .sidebar-nav::-webkit-scrollbar-track { background: transparent; }
  .sidebar-nav::-webkit-scrollbar-thumb { background: var(--border); border-radius: 2px; }
  .sidebar-nav ul { list-style: none; margin: 0; padding: 0; }
  .sidebar-nav li { margin: 0 0 1px; }
  .sidebar-nav li a {
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 7px 8px;
    border-radius: 6px;
    color: var(--text-muted);
    font-family: var(--font-sans);
    font-feature-settings: 'cv01', 'ss03';
    font-size: 13px;
    font-weight: 400;
    text-decoration: none;
    border-left: 2px solid transparent;
    transition: background 0.12s ease, color 0.12s ease, border-color 0.12s ease;
    min-width: 0;
  }
  .sidebar-nav li a:hover {
    background: rgba(255,255,255,0.04);
    color: var(--text-secondary);
  }
  .sidebar-nav li a.active {
    background: rgba(113,112,255,0.12);
    color: var(--text-primary);
    border-left-color: var(--accent);
  }
  .nav-label {
    flex: 1;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    min-width: 0;
  }
  .sidebar-footer {
    padding: 12px 16px;
    flex-shrink: 0;
    border-top: 1px solid var(--border-subtle);
  }
  .sidebar-footer p {
    margin: 0;
    font-family: var(--font-sans);
    font-feature-settings: 'cv01', 'ss03';
    font-size: 11px;
    color: var(--text-muted);
  }

  /* Main */
  .main {
    flex: 1;
    overflow-y: auto;
    padding: 40px;
    min-width: 0;
  }
  .main::-webkit-scrollbar { width: 6px; }
  .main::-webkit-scrollbar-track { background: transparent; }
  .main::-webkit-scrollbar-thumb { background: var(--border); border-radius: 3px; }

  /* Wiki section */
  .wiki-section {
    max-width: 760px;
    margin: 0 0 64px;
    scroll-margin-top: 24px;
  }
  .section-header {
    display: flex;
    align-items: center;
    gap: 12px;
    margin: 0 0 16px;
  }
  .section-title {
    font-family: var(--font-sans);
    font-feature-settings: 'cv01', 'ss03';
    font-size: 24px;
    font-weight: 600;
    color: var(--text-primary);
    margin: 0;
    flex: 1;
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .section-divider {
    border: 0;
    border-top: 1px solid var(--border);
    margin: 0 0 24px;
  }

  /* Markdown body */
  .markdown-body {
    font-family: var(--font-sans);
    font-feature-settings: 'cv01', 'ss03';
  }
  .markdown-body h1 {
    font-size: 22px;
    font-weight: 600;
    color: var(--text-primary);
    margin: 0 0 16px;
    line-height: 1.3;
  }
  .markdown-body h2 {
    font-size: 16px;
    font-weight: 600;
    color: var(--text-primary);
    margin: 24px 0 12px;
    padding-bottom: 8px;
    border-bottom: 1px solid rgba(255,255,255,0.06);
    line-height: 1.3;
  }
  .markdown-body h3 {
    font-size: 14px;
    font-weight: 600;
    color: var(--text-secondary);
    margin: 20px 0 8px;
    line-height: 1.3;
  }
  .markdown-body h4, .markdown-body h5, .markdown-body h6 {
    font-size: 13px;
    font-weight: 600;
    color: var(--text-secondary);
    margin: 16px 0 8px;
    line-height: 1.3;
  }
  .markdown-body p {
    font-size: 14px;
    font-weight: 400;
    color: var(--text-secondary);
    line-height: 1.7;
    margin: 0 0 12px;
  }
  .markdown-body a {
    color: var(--accent);
    text-decoration: none;
  }
  .markdown-body a:hover { text-decoration: underline; }
  .markdown-body code {
    font-family: var(--font-mono);
    font-size: 13px;
    color: #a5b4fc;
    background: rgba(99,102,241,0.15);
    border-radius: 3px;
    padding: 2px 6px;
  }
  .markdown-body pre {
    background: var(--surface);
    border: 1px solid var(--border);
    border-radius: 8px;
    padding: 16px;
    overflow-x: auto;
    margin: 0 0 16px;
  }
  .markdown-body pre code {
    font-family: var(--font-mono);
    font-size: 13px;
    color: #e2e8f0;
    background: transparent;
    border-radius: 0;
    padding: 0;
  }
  .markdown-body blockquote {
    border-left: 3px solid var(--accent-dim);
    color: var(--text-muted);
    font-style: italic;
    padding-left: 16px;
    margin: 12px 0;
  }
  .markdown-body ul, .markdown-body ol {
    color: var(--text-secondary);
    font-size: 14px;
    padding-left: 20px;
    margin: 0 0 12px;
  }
  .markdown-body li { margin: 0 0 6px; }
  .markdown-body table {
    width: 100%;
    border-collapse: collapse;
    margin: 0 0 16px;
    font-size: 13px;
  }
  .markdown-body th {
    background: var(--surface);
    color: var(--text-muted);
    font-size: 11px;
    font-weight: 600;
    text-transform: uppercase;
    letter-spacing: 0.06em;
    padding: 8px 12px;
    text-align: left;
    border-bottom: 1px solid var(--border);
  }
  .markdown-body td {
    color: var(--text-secondary);
    padding: 8px 12px;
    border-bottom: 1px solid rgba(255,255,255,0.06);
  }
  .markdown-body hr {
    border: 0;
    border-top: 1px solid var(--border);
    margin: 24px 0;
  }

  /* Empty state */
  .empty-state {
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    min-height: 60vh;
    text-align: center;
    padding: 80px 20px;
  }
  .empty-icon {
    font-size: 40px;
    margin: 0 0 20px;
    line-height: 1;
  }
  .empty-state h2 {
    font-family: var(--font-sans);
    font-feature-settings: 'cv01', 'ss03';
    font-size: 20px;
    font-weight: 600;
    color: var(--text-primary);
    margin: 0 0 12px;
  }
  .empty-state p {
    font-family: var(--font-sans);
    font-feature-settings: 'cv01', 'ss03';
    font-size: 14px;
    color: var(--text-muted);
    max-width: 420px;
    line-height: 1.6;
    margin: 0;
  }
</style>
</head>
<body>
  <aside class="sidebar">
    <div class="sidebar-top">
      <span class="sidebar-brand">Make It Real</span>
      <span class="badge-live-wiki">Live Wiki</span>
    </div>
    <nav class="sidebar-nav" aria-label="Work items">
      <ul>
        ${items.length > 0 ? navItems : '<li style="padding:8px;color:var(--text-muted);font-size:13px;">No pages</li>'}
      </ul>
    </nav>
    <div class="sidebar-footer">
      <p>Generated by /mir:wiki</p>
    </div>
  </aside>
  <main class="main">
    ${items.length > 0 ? sections : emptyState}
  </main>

  <script src="https://cdn.jsdelivr.net/npm/marked/marked.min.js"></script>
  <script>
    (function () {
      // Render markdown
      document.querySelectorAll('[data-markdown]').forEach(function (el) {
        if (typeof marked !== 'undefined') {
          el.innerHTML = marked.parse(el.textContent || '');
        }
      });

      // Smooth scroll on nav click
      document.querySelectorAll('.sidebar-nav a').forEach(function (a) {
        a.addEventListener('click', function (e) {
          var target = document.getElementById(a.getAttribute('href').replace('#', ''));
          if (target) {
            e.preventDefault();
            target.scrollIntoView({ behavior: 'smooth', block: 'start' });
          }
        });
      });

      // IntersectionObserver to highlight active nav item
      var links = Array.prototype.slice.call(document.querySelectorAll('.sidebar-nav a'));
      var byId = {};
      links.forEach(function (a) {
        var id = a.getAttribute('href').replace('#', '');
        byId[id] = a;
      });
      if ('IntersectionObserver' in window && links.length) {
        var observer = new IntersectionObserver(function (entries) {
          entries.forEach(function (entry) {
            var id = entry.target.id;
            if (entry.isIntersecting && byId[id]) {
              links.forEach(function (a) { a.classList.remove('active'); });
              byId[id].classList.add('active');
            }
          });
        }, { rootMargin: '-10% 0px -80% 0px', threshold: 0 });
        document.querySelectorAll('.wiki-section').forEach(function (section) {
          observer.observe(section);
        });
        // Activate first link by default
        if (links.length) links[0].classList.add('active');
      }
    })();
  </script>
</body>
</html>`;
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

// Read the live wiki, render HTML, and write it to <project>/.makeitreal/wiki/index.html.
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
