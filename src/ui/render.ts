import type { Decision, SessionGroup } from "../db/database.js";

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
    <details class="decision">
      <summary>${escapeHtml(d.title)}</summary>
      <div class="decision-body">
        <p><span class="label">Decision:</span> ${escapeHtml(d.decision)}</p>
        <p><span class="label">Why:</span> ${escapeHtml(d.why)}</p>
        ${discarded}
        ${files}
      </div>
    </details>`;
}

function renderSessionGroup(group: SessionGroup): string {
  const title = group.sessionTitle ?? group.sessionId;
  const date = group.startedAt ? new Date(group.startedAt).toLocaleString() : "unknown date";

  return `
    <details class="session">
      <summary>
        <span class="session-title">${escapeHtml(title)}</span>
        <span class="meta">${escapeHtml(date)} · ${group.decisions.length} decision(s)</span>
      </summary>
      <div class="session-body">
        ${group.decisions.map(renderDecision).join("\n")}
      </div>
    </details>`;
}

export function renderPage(groups: SessionGroup[]): string {
  const totalDecisions = groups.reduce((sum, g) => sum + g.decisions.length, 0);
  const body = groups.length
    ? groups.map(renderSessionGroup).join("\n")
    : `<p class="empty">No decisions distilled yet. Run <code>waypoint generate</code> first.</p>`;

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<title>Waypoint — architecture decisions</title>
<style>
  body { font-family: system-ui, sans-serif; max-width: 760px; margin: 2rem auto; padding: 0 1rem; line-height: 1.5; color: #1a1a1a; background: #fff; }
  h1 { font-size: 1.4rem; }
  details.session { border: 1px solid #ccc; border-radius: 8px; padding: 0; margin-bottom: 1rem; }
  details.session > summary { cursor: pointer; padding: .85rem 1.1rem; list-style: none; display: flex; justify-content: space-between; align-items: baseline; gap: 1rem; }
  details.session > summary::-webkit-details-marker { display: none; }
  .session-title { font-weight: 600; }
  .session-body { padding: 0 1.1rem 1rem; }
  details.decision { border: 1px solid #ddd; border-radius: 6px; padding: 0; margin-bottom: .6rem; }
  details.decision > summary { cursor: pointer; padding: .6rem .9rem; font-weight: 500; list-style: none; }
  details.decision > summary::-webkit-details-marker { display: none; }
  details.decision > summary::before { content: "▸ "; }
  details.decision[open] > summary::before { content: "▾ "; }
  .decision-body { padding: 0 .9rem .8rem; }
  .meta { color: #888; font-size: .8rem; }
  .label { font-weight: 600; }
  .files { margin: .5rem 0 0; padding-left: 1.25rem; font-size: .85rem; color: #555; }
  .empty { color: #888; }
  code { background: #f3f3f3; padding: .1rem .3rem; border-radius: 4px; font-size: .85em; }
  @media (prefers-color-scheme: dark) {
    body { background: #111; color: #eee; }
    details.session { border-color: #333; }
    details.decision { border-color: #333; }
    .meta { color: #999; }
    .files { color: #aaa; }
    code { background: #222; }
  }
</style>
</head>
<body>
  <h1>Waypoint — architecture decisions</h1>
  <p class="meta">${totalDecisions} decision(s) across ${groups.length} session(s).</p>
  ${body}
</body>
</html>`;
}
