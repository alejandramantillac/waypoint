import type { Decision, SessionGroup, DayGroup, ParserIssue, ImportedDecision, ImportedGroup } from "../db/database.js";

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
  const staleBadge = d.modifiedSinceDecision
    ? `<span class="badge-stale">⚠ modified since this decision</span>`
    : "";
  const evidence = d.evidence
    ? `<p><span class="label">Evidence:</span> <em>"${escapeHtml(d.evidence)}"</em></p>`
    : "";

  return `
    <details class="decision">
      <summary>${escapeHtml(d.title)} ${staleBadge}</summary>
      <div class="decision-body">
        <p><span class="label">Decision:</span> ${escapeHtml(d.decision)}</p>
        <p><span class="label">Why:</span> ${escapeHtml(d.why)}</p>
        ${discarded}
        ${evidence}
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

function renderDayGroup(group: DayGroup): string {
  return `
    <details class="session">
      <summary>
        <span class="session-title">${escapeHtml(group.day)}</span>
        <span class="meta">${group.decisions.length} decision(s)</span>
      </summary>
      <div class="session-body">
        ${group.decisions.map(renderDecision).join("\n")}
      </div>
    </details>`;
}

function renderImportedDecision(d: ImportedDecision): string {
  const files = d.filesAffected.length
    ? `<ul class="files">${d.filesAffected.map((f) => `<li><code>${escapeHtml(f)}</code></li>`).join("")}</ul>`
    : "";
  const discarded = d.discarded
    ? `<p><span class="label">Discarded:</span> ${escapeHtml(d.discarded)}</p>`
    : "";
  const staleBadge = d.modifiedSinceDecision
    ? `<span class="badge-stale">⚠ modified since this decision</span>`
    : "";
  const evidence = d.evidence
    ? `<p><span class="label">Evidence:</span> <em>"${escapeHtml(d.evidence)}"</em></p>`
    : "";

  return `
    <details class="decision">
      <summary>${escapeHtml(d.title)} ${staleBadge}</summary>
      <div class="decision-body">
        <p><span class="label">Decision:</span> ${escapeHtml(d.decision)}</p>
        <p><span class="label">Why:</span> ${escapeHtml(d.why)}</p>
        ${discarded}
        ${evidence}
        ${files}
      </div>
    </details>`;
}

function renderImportedGroup(group: ImportedGroup): string {
  return `
    <details class="session imported">
      <summary>
        <span class="session-title">From ${escapeHtml(group.importedFrom)}</span>
        <span class="meta">${group.decisions.length} decision(s)</span>
      </summary>
      <div class="session-body">
        ${group.decisions.map(renderImportedDecision).join("\n")}
      </div>
    </details>`;
}

function renderParserIssues(issues: ParserIssue[]): string {
  if (issues.length === 0) return "";
  const items = issues
    .map(
      (i) =>
        `<li><code>${escapeHtml(i.filePath)}</code> — ${escapeHtml(i.detail)}</li>`,
    )
    .join("");
  return `
    <details class="parser-issues">
      <summary>Parser issues (${issues.length})</summary>
      <ul>${items}</ul>
    </details>`;
}

export interface RenderPageOptions {
  view: "session" | "day";
  groups: SessionGroup[] | DayGroup[];
  issues: ParserIssue[];
  importedGroups: ImportedGroup[];
}

export function renderPage(opts: RenderPageOptions): string {
  const { view, groups, issues, importedGroups } = opts;
  const totalDecisions = groups.reduce((sum, g) => sum + g.decisions.length, 0);
  const body = groups.length
    ? view === "day"
      ? (groups as DayGroup[]).map(renderDayGroup).join("\n")
      : (groups as SessionGroup[]).map(renderSessionGroup).join("\n")
    : `<p class="empty">No decisions distilled yet. Run <code>waypoint generate</code> first.</p>`;

  const importedTotal = importedGroups.reduce((sum, g) => sum + g.decisions.length, 0);
  const importedSection = importedGroups.length
    ? `
    <h2>Imported from collaborators</h2>
    <p class="meta">${importedTotal} decision(s) across ${importedGroups.length} author(s).</p>
    ${importedGroups.map(renderImportedGroup).join("\n")}`
    : "";

  const sessionLink = view === "session" ? `<strong>By session</strong>` : `<a href="/?group=session">By session</a>`;
  const dayLink = view === "day" ? `<strong>By day</strong>` : `<a href="/?group=day">By day</a>`;

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<title>Waypoint — architecture decisions</title>
<style>
  body { font-family: system-ui, sans-serif; max-width: 760px; margin: 2rem auto; padding: 0 1rem; line-height: 1.5; color: #1a1a1a; background: #fff; }
  h1 { font-size: 1.4rem; }
  nav.view-switch { margin-bottom: 1rem; font-size: .9rem; }
  nav.view-switch a, nav.view-switch strong { margin-right: .75rem; }
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
  .badge-stale { color: #a15c00; font-size: .8rem; font-weight: 600; }
  details.parser-issues { margin-top: 2rem; border: 1px dashed #ccc; border-radius: 8px; padding: .5rem 1.1rem; font-size: .85rem; color: #555; }
  code { background: #f3f3f3; padding: .1rem .3rem; border-radius: 4px; font-size: .85em; }
  @media (prefers-color-scheme: dark) {
    body { background: #111; color: #eee; }
    details.session { border-color: #333; }
    details.decision { border-color: #333; }
    details.parser-issues { border-color: #444; color: #aaa; }
    .meta { color: #999; }
    .files { color: #aaa; }
    .badge-stale { color: #e0a336; }
    code { background: #222; }
  }
</style>
</head>
<body>
  <h1>Waypoint — architecture decisions</h1>
  <nav class="view-switch">${sessionLink}${dayLink}</nav>
  <p class="meta">${totalDecisions} decision(s) across ${groups.length} group(s).</p>
  ${body}
  ${importedSection}
  ${renderParserIssues(issues)}
</body>
</html>`;
}
