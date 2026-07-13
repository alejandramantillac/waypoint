import type { Decision } from "../db/database.js";

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function renderDecision(d: Decision): string {
  const files = d.filesAffected.length
    ? `<ul class="files">${d.filesAffected.map((f) => `<li><code>${escapeHtml(f)}</code></li>`).join("")}</ul>`
    : "";
  const discarded = d.discarded
    ? `<p><span class="label">Discarded:</span> ${escapeHtml(d.discarded)}</p>`
    : "";

  return `
    <article class="decision">
      <h2>${escapeHtml(d.title)}</h2>
      <p class="meta">${new Date(d.createdAt).toLocaleString()}</p>
      <p><span class="label">Decision:</span> ${escapeHtml(d.decision)}</p>
      <p><span class="label">Why:</span> ${escapeHtml(d.why)}</p>
      ${discarded}
      ${files}
    </article>`;
}

export function renderPage(decisions: Decision[]): string {
  const body = decisions.length
    ? decisions.map(renderDecision).join("\n")
    : `<p class="empty">No decisions distilled yet. Run <code>waypoint generate</code> first.</p>`;

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<title>Waypoint — architecture decisions</title>
<style>
  body { font-family: system-ui, sans-serif; max-width: 760px; margin: 2rem auto; padding: 0 1rem; line-height: 1.5; color: #1a1a1a; background: #fff; }
  h1 { font-size: 1.4rem; }
  .decision { border: 1px solid #ddd; border-radius: 8px; padding: 1rem 1.25rem; margin-bottom: 1rem; }
  .decision h2 { font-size: 1.05rem; margin: 0 0 .25rem; }
  .meta { color: #888; font-size: .8rem; margin: 0 0 .75rem; }
  .label { font-weight: 600; }
  .files { margin: .5rem 0 0; padding-left: 1.25rem; font-size: .85rem; color: #555; }
  .empty { color: #888; }
  code { background: #f3f3f3; padding: .1rem .3rem; border-radius: 4px; font-size: .85em; }
  @media (prefers-color-scheme: dark) {
    body { background: #111; color: #eee; }
    .decision { border-color: #333; }
    .meta { color: #999; }
    .files { color: #aaa; }
    code { background: #222; }
  }
</style>
</head>
<body>
  <h1>Waypoint — architecture decisions</h1>
  <p class="meta">${decisions.length} decision(s) distilled for this project.</p>
  ${body}
</body>
</html>`;
}
