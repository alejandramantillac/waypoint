import type { Decision, SessionGroup, DayGroup, ParserIssue, ImportedDecision, ImportedGroup } from "../db/database.js";

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function buildUrl(query: URLSearchParams, overrides: Record<string, string | null>): string {
  const next = new URLSearchParams(query);
  for (const [key, value] of Object.entries(overrides)) {
    if (value === null || value === "") next.delete(key);
    else next.set(key, value);
  }
  if (!("page" in overrides)) next.delete("page");
  const qs = next.toString();
  return qs ? `/?${qs}` : "/";
}

function renderDecision(d: Decision): string {
  const files = d.filesAffected.length
    ? `<ul class="files">${d.filesAffected.map((f) => `<li><code>${escapeHtml(f)}</code></li>`).join("")}</ul>`
    : "";
  const discarded = d.discarded
    ? `<p><span class="label label-discard">Discarded</span> ${escapeHtml(d.discarded)}</p>`
    : "";
  const staleBadge = d.modifiedSinceDecision
    ? `<span class="badge-stale">⚠ modified since this decision</span>`
    : "";
  const evidence = d.evidence
    ? `<p class="evidence"><span class="label">Evidence</span> <em>"${escapeHtml(d.evidence)}"</em></p>`
    : "";

  return `
    <details class="decision">
      <summary><span class="decision-title">${escapeHtml(d.title)}</span> ${staleBadge}</summary>
      <div class="decision-body">
        <p><span class="label">Decision</span> ${escapeHtml(d.decision)}</p>
        <p><span class="label">Why</span> ${escapeHtml(d.why)}</p>
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
    ? `<p><span class="label label-discard">Discarded</span> ${escapeHtml(d.discarded)}</p>`
    : "";
  const staleBadge = d.modifiedSinceDecision
    ? `<span class="badge-stale">⚠ modified since this decision</span>`
    : "";
  const evidence = d.evidence
    ? `<p class="evidence"><span class="label">Evidence</span> <em>"${escapeHtml(d.evidence)}"</em></p>`
    : "";

  return `
    <details class="decision">
      <summary><span class="decision-title">${escapeHtml(d.title)}</span> ${staleBadge}</summary>
      <div class="decision-body">
        <p><span class="label">Decision</span> ${escapeHtml(d.decision)}</p>
        <p><span class="label">Why</span> ${escapeHtml(d.why)}</p>
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

export type SearchResultItem =
  | { origin: "local"; decision: Decision }
  | { origin: "imported"; importedFrom: string; decision: ImportedDecision };

export interface ConflictView {
  relationId: number;
  a: { ref: { source: "local" | "imported"; id: number }; decision: Decision | ImportedDecision };
  b: { ref: { source: "local" | "imported"; id: number }; decision: Decision | ImportedDecision };
}

function refParam(ref: { source: "local" | "imported"; id: number }): string {
  return `${ref.source}:${ref.id}`;
}

function renderConflict(c: ConflictView): string {
  const side = (s: ConflictView["a"]) => `
    <div class="conflict-side">
      <p><strong>${escapeHtml(s.decision.title)}</strong></p>
      <p>${escapeHtml(s.decision.decision)}</p>
      <a class="btn btn-primary" href="/?resolveConflict=${c.relationId}&winner=${refParam(s.ref)}">Keep this one</a>
    </div>`;
  return `
    <div class="conflict">
      <p class="conflict-files">Conflicting decisions over overlapping files:</p>
      ${side(c.a)}
      ${side(c.b)}
    </div>`;
}

function renderConflictsSection(conflicts: ConflictView[]): string {
  if (conflicts.length === 0) return "";
  return `
    <h2>Unresolved conflicts (${conflicts.length})</h2>
    ${conflicts.map(renderConflict).join("\n")}`;
}

export interface ResolvedConflictView {
  relationId: number;
  winner: { decision: Decision | ImportedDecision };
  loser: { decision: Decision | ImportedDecision };
}

function renderResolvedConflict(c: ResolvedConflictView): string {
  return `
    <div class="conflict resolved">
      <p class="conflict-files">Resolved: kept <strong>${escapeHtml(c.winner.decision.title)}</strong> over <strong>${escapeHtml(c.loser.decision.title)}</strong>.</p>
      <a class="btn btn-secondary" href="/?undoRelation=${c.relationId}">Undo</a>
    </div>`;
}

function renderResolvedConflictsSection(resolvedConflicts: ResolvedConflictView[]): string {
  if (resolvedConflicts.length === 0) return "";
  return `
    <h2>Recently resolved (${resolvedConflicts.length})</h2>
    ${resolvedConflicts.map(renderResolvedConflict).join("\n")}`;
}

function renderSearchResult(item: SearchResultItem): string {
  if (item.origin === "local") {
    return `<div class="search-result"><span class="origin">local</span>${renderDecision(item.decision)}</div>`;
  }
  return `<div class="search-result"><span class="origin">from ${escapeHtml(item.importedFrom)}</span>${renderImportedDecision(item.decision)}</div>`;
}

function renderFilterForm(query: URLSearchParams): string {
  const q = query.get("q") ?? "";
  const since = query.get("since") ?? "";
  const until = query.get("until") ?? "";
  const group = query.get("group") ?? "";
  const groupHidden = group ? `<input type="hidden" name="group" value="${escapeHtml(group)}">` : "";
  const staleHidden = query.get("stale") === "1" ? `<input type="hidden" name="stale" value="1">` : "";
  const hasActiveFilters = q !== "" || since !== "" || until !== "";
  const clearLink = hasActiveFilters
    ? `<a class="btn btn-ghost clear" href="${buildUrl(query, { q: null, since: null, until: null })}">Clear</a>`
    : "";

  return `
    <form method="get" class="filters">
      ${groupHidden}
      ${staleHidden}
      <input type="text" name="q" placeholder="Search decisions…" value="${escapeHtml(q)}">
      <label>Since <input type="date" name="since" value="${escapeHtml(since)}"></label>
      <label>Until <input type="date" name="until" value="${escapeHtml(until)}"></label>
      <button type="submit" class="btn btn-primary">Filter</button>
      ${clearLink}
    </form>`;
}

function renderStaleToggle(query: URLSearchParams): string {
  const active = query.get("stale") === "1";
  const href = active ? buildUrl(query, { stale: null }) : buildUrl(query, { stale: "1" });
  return `<a class="btn btn-secondary stale-toggle${active ? " active" : ""}" href="${href}">${active ? "Show all decisions" : "Show only decisions modified since they were made"}</a>`;
}

function renderPagination(query: URLSearchParams, page: number, totalPages: number): string {
  if (totalPages <= 1) return "";
  const prev =
    page > 1
      ? `<a class="btn btn-secondary" href="${buildUrl(query, { page: String(page - 1) })}">← Previous</a>`
      : `<span class="btn btn-secondary disabled">← Previous</span>`;
  const next =
    page < totalPages
      ? `<a class="btn btn-secondary" href="${buildUrl(query, { page: String(page + 1) })}">Next →</a>`
      : `<span class="btn btn-secondary disabled">Next →</span>`;
  return `<nav class="pagination">${prev} <span class="page-indicator">Page ${page} of ${totalPages}</span> ${next}</nav>`;
}

/** Inlined by hand from waypoint-web/src/components/core/WaypointMark.jsx — same
 * mark, same accent color, since this template can't import a React component. */
function renderLogo(): string {
  return `<svg width="22" height="22" viewBox="0 0 32 32" fill="none" aria-hidden="true">
    <path d="M9 23 21 9" stroke="var(--accent)" stroke-width="3" stroke-linecap="round" />
    <circle cx="21" cy="9" r="3" fill="none" stroke="var(--accent)" stroke-width="2.2" />
    <circle cx="9" cy="23" r="4.2" fill="var(--accent)" />
  </svg>`;
}

export interface RenderPageOptions {
  view: "session" | "day";
  /** Already paginated (current page slice) when in grouped mode. Empty in search mode. */
  groups: SessionGroup[] | DayGroup[];
  /** Total groups after filters, before pagination. */
  groupsTotalCount: number;
  /** Total decisions after filters, before pagination (grouped mode) or total matches (search mode). */
  decisionsTotalCount: number;
  issues: ParserIssue[];
  importedGroups: ImportedGroup[];
  /** Unresolved cross-author conflicts to surface with a resolve action. Empty in search mode. */
  conflicts: ConflictView[];
  /** Conflicts resolved via the "Keep this one" action, surfaced with an undo action. Empty in search mode. */
  resolvedConflicts: ResolvedConflictView[];
  query: URLSearchParams;
  page: number;
  totalPages: number;
  /** Present when a keyword search (`?q=`) is active — replaces the grouped view with a flat list. */
  search: { query: string; items: SearchResultItem[] } | null;
}

export function renderPage(opts: RenderPageOptions): string {
  const { view, groups, groupsTotalCount, decisionsTotalCount, issues, importedGroups, conflicts, resolvedConflicts, query, page, totalPages, search } = opts;

  const filtersActive = query.get("q") || query.get("since") || query.get("until") || query.get("stale") === "1";

  let body: string;
  let meta: string;

  if (search) {
    meta = `<p class="meta">${decisionsTotalCount} decision(s) match "${escapeHtml(search.query)}".</p>`;
    body = search.items.length
      ? search.items.map(renderSearchResult).join("\n")
      : `<p class="empty">No decisions match "${escapeHtml(search.query)}".</p>`;
  } else {
    meta = `<p class="meta">${decisionsTotalCount} decision(s) across ${groupsTotalCount} group(s).</p>`;
    body = groups.length
      ? view === "day"
        ? (groups as DayGroup[]).map(renderDayGroup).join("\n")
        : (groups as SessionGroup[]).map(renderSessionGroup).join("\n")
      : `<p class="empty">${filtersActive ? "No decisions match the current filters." : "No decisions distilled yet. Run <code>waypoint generate</code> first."}</p>`;
  }

  const importedTotal = importedGroups.reduce((sum, g) => sum + g.decisions.length, 0);
  const importedSection =
    !search && importedGroups.length
      ? `
    <h2>Imported from collaborators</h2>
    <p class="meta">${importedTotal} decision(s) across ${importedGroups.length} author(s).</p>
    ${importedGroups.map(renderImportedGroup).join("\n")}`
      : "";

  const sessionLink = view === "session" ? `<strong>By session</strong>` : `<a href="${buildUrl(query, { group: "session" })}">By session</a>`;
  const dayLink = view === "day" ? `<strong>By day</strong>` : `<a href="${buildUrl(query, { group: "day" })}">By day</a>`;

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<title>Waypoint — architecture decisions</title>
<style>
  /*
   * Design tokens copied by hand from waypoint-web/src/tokens/*.css (the marketing
   * landing's design system). Duplicated rather than shared, since this page is a
   * template string served in-memory with no build step, and the landing is a
   * separate Vite project — there is no way to share a physical CSS file between
   * the two without adding a bundler here, which plan.md Fase 1 explicitly ruled out.
   *
   * Font choice: waypoint-web pulls Space Grotesk / IBM Plex Sans / JetBrains Mono
   * from Google Fonts. This page deliberately does NOT do that — waypoint is sold
   * as running 100% locally (see README), and a CLI-served page reaching out to a
   * CDN on every load undercuts that claim more than a font substitution costs in
   * polish. Instead this uses system font stacks chosen to read the same way:
   * a geometric sans for headings, a humanist sans for body text, and the user's
   * installed coding-monospace font for code/meta — no network request either way.
   *
   * Color scheme: unlike waypoint-web (fixed dark, a brand decision), this page
   * previously followed the OS's prefers-color-scheme. That's dropped in favor of
   * always-dark, matching the landing 1:1. The rationale: this page is viewed in
   * short bursts by the person who just ran "waypoint ui", not browsed publicly —
   * brand consistency with the rest of the product outweighs the accessibility
   * value of light mode here. Nothing stops a browser reader/forced-colors mode
   * from overriding this if a user genuinely needs light contrast.
   */
  :root {
    /* Tells the browser this page is dark-themed so native controls (the
       <input type="date"> calendar icon, in particular) render in a dark
       variant instead of a default dark-on-transparent icon that's
       invisible — and unclickable in practice — against our dark background. */
    color-scheme: dark;

    --gray-0:  oklch(0.145 0.004 260);
    --gray-1:  oklch(0.185 0.005 260);
    --gray-2:  oklch(0.225 0.006 260);
    --gray-3:  oklch(0.27  0.006 260);
    --gray-4:  oklch(0.33  0.007 260);
    --gray-5:  oklch(0.42  0.008 260);
    --gray-6:  oklch(0.56  0.008 260);
    --gray-7:  oklch(0.72  0.007 260);
    --gray-8:  oklch(0.87  0.004 260);
    --gray-9:  oklch(0.97  0.002 260);

    --amber-4: oklch(0.40 0.09  68);
    --amber-5: oklch(0.55 0.14  65);
    --amber-6: oklch(0.68 0.15  64);
    --amber-7: oklch(0.80 0.13  68);

    --rust-5:  oklch(0.55 0.11  30);
    --rust-6:  oklch(0.72 0.10  30);

    --surface-page:     var(--gray-0);
    --surface-panel:    var(--gray-1);
    --surface-card:     var(--gray-2);
    --surface-elevated: var(--gray-3);
    --surface-inset:    oklch(0.115 0.004 260);

    --border-subtle:  var(--gray-4);
    --border-default: var(--gray-5);
    --border-hover:   var(--gray-6);

    --text-primary:   var(--gray-9);
    --text-secondary: var(--gray-7);
    --text-muted:     var(--gray-6);
    --text-on-accent: oklch(0.16 0.03 65);
    --text-accent:    var(--amber-7);
    --text-discard:   var(--rust-6);

    --accent:         var(--amber-5);
    --accent-hover:   var(--amber-6);
    --accent-active:  var(--amber-4);
    --accent-soft-bg: oklch(0.24 0.03 65);

    --link:       var(--amber-6);
    --link-hover: var(--amber-7);
    --focus-ring: var(--amber-5);

    --radius-sm: 6px;
    --radius-md: 10px;
    --radius-lg: 16px;
    --radius-full: 999px;

    --shadow-sm: 0 1px 2px oklch(0.05 0 0 / 0.4);
    --shadow-md: 0 4px 12px oklch(0.05 0 0 / 0.45), 0 1px 2px oklch(0.05 0 0 / 0.3);

    --font-display: -apple-system, "Segoe UI", ui-sans-serif, system-ui, sans-serif;
    --font-body: -apple-system, "Segoe UI", ui-sans-serif, system-ui, sans-serif;
    --font-mono: ui-monospace, "Cascadia Code", "SF Mono", Consolas, "Liberation Mono", monospace;
  }

  * { box-sizing: border-box; }

  body {
    font-family: var(--font-body);
    max-width: 800px;
    margin: 0 auto;
    padding: 2.5rem 1.25rem 4rem;
    line-height: 1.55;
    color: var(--text-primary);
    background: var(--surface-page);
  }

  a { color: var(--link); text-decoration: none; }
  a:hover { color: var(--link-hover); text-decoration: underline; }
  a:focus-visible, button:focus-visible, input:focus-visible {
    outline: 2px solid var(--focus-ring);
    outline-offset: 2px;
  }

  header.site-header {
    display: flex;
    align-items: center;
    gap: .6rem;
    margin-bottom: 1.75rem;
  }
  header.site-header .wordmark {
    font-family: var(--font-display);
    font-weight: 700;
    letter-spacing: -0.02em;
    font-size: 1.3rem;
    color: var(--text-primary);
  }
  header.site-header .tagline {
    font-family: var(--font-mono);
    font-size: .75rem;
    color: var(--text-muted);
    margin-left: .5rem;
    letter-spacing: 0.02em;
  }

  footer.site-footer {
    margin-top: 2.5rem;
    padding-top: 1rem;
    border-top: 1px solid var(--border-subtle);
    font-family: var(--font-mono);
    font-size: .75rem;
    color: var(--text-muted);
  }
  footer.site-footer a {
    color: var(--text-muted);
  }
  footer.site-footer a:hover {
    color: var(--text-accent);
  }

  h2 {
    font-family: var(--font-display);
    font-weight: 600;
    letter-spacing: -0.01em;
    font-size: 1.25rem;
    margin: 2.25rem 0 .5rem;
  }

  nav.view-switch { margin-bottom: 1rem; font-size: .9rem; font-family: var(--font-mono); }
  nav.view-switch a, nav.view-switch strong { margin-right: 1rem; }
  nav.view-switch strong { color: var(--text-accent); }

  form.filters {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: .6rem;
    margin-bottom: .75rem;
    font-size: .9rem;
    background: var(--surface-panel);
    border: 1px solid var(--border-subtle);
    border-radius: var(--radius-lg);
    padding: .85rem 1rem;
  }
  form.filters input[type="text"],
  form.filters input[type="date"] {
    font-family: var(--font-body);
    background: var(--surface-inset);
    border: 1px solid var(--border-default);
    border-radius: var(--radius-sm);
    color: var(--text-primary);
    padding: .4rem .6rem;
  }
  form.filters input[type="text"] { flex: 1 1 220px; }
  form.filters input::placeholder { color: var(--text-muted); }
  form.filters label { display: inline-flex; align-items: center; gap: .4rem; color: var(--text-secondary); font-size: .85rem; }

  .btn {
    display: inline-flex;
    align-items: center;
    font-family: var(--font-body);
    font-weight: 500;
    font-size: .85rem;
    padding: .45rem .9rem;
    border-radius: var(--radius-md);
    border: 1px solid transparent;
    cursor: pointer;
  }
  .btn:hover { text-decoration: none; }
  .btn-primary {
    background: var(--accent);
    color: var(--text-on-accent);
    border-color: var(--accent);
  }
  .btn-primary:hover { background: var(--accent-hover); border-color: var(--accent-hover); color: var(--text-on-accent); }
  .btn-secondary {
    background: var(--surface-elevated);
    color: var(--text-primary);
    border-color: var(--border-default);
  }
  .btn-secondary:hover { border-color: var(--border-hover); color: var(--text-primary); }
  .btn-secondary.active { border-color: var(--accent); color: var(--text-accent); }
  .btn-ghost { background: transparent; color: var(--text-secondary); border-color: transparent; }
  .btn-ghost:hover { color: var(--text-primary); background: var(--surface-card); }
  .btn.disabled { opacity: .4; cursor: default; pointer-events: none; }

  .stale-toggle { display: inline-flex; margin-bottom: .9rem; }

  nav.pagination { display: flex; gap: .75rem; align-items: center; justify-content: center; margin: 1.75rem 0 1rem; font-size: .9rem; }
  .page-indicator { font-family: var(--font-mono); color: var(--text-muted); font-size: .8rem; }

  .search-result { margin-bottom: .75rem; }
  .search-result .origin {
    display: inline-block;
    font-family: var(--font-mono);
    font-size: .7rem;
    font-weight: 600;
    letter-spacing: 0.06em;
    color: var(--text-muted);
    text-transform: uppercase;
    margin-bottom: .3rem;
  }

  details.session {
    background: var(--surface-panel);
    border: 1px solid var(--border-subtle);
    border-radius: var(--radius-lg);
    box-shadow: var(--shadow-sm);
    padding: 0;
    margin-bottom: 1.1rem;
  }
  details.session > summary {
    cursor: pointer;
    padding: 1rem 1.25rem;
    list-style: none;
    display: flex;
    justify-content: space-between;
    align-items: baseline;
    gap: 1rem;
  }
  details.session > summary::-webkit-details-marker { display: none; }
  details.session > summary::before { content: "▸ "; color: var(--text-muted); }
  details.session[open] > summary::before { content: "▾ "; color: var(--text-accent); }
  .session-title { font-family: var(--font-display); font-weight: 600; letter-spacing: -0.01em; font-size: 1.05rem; color: var(--text-primary); }
  .session-body { padding: 0 1.25rem 1.1rem; }

  details.decision {
    background: var(--surface-card);
    border: 1px solid var(--border-subtle);
    border-radius: var(--radius-md);
    padding: 0;
    margin-bottom: .6rem;
  }
  details.decision > summary {
    cursor: pointer;
    padding: .7rem 1rem;
    list-style: none;
    display: flex;
    align-items: baseline;
    gap: .6rem;
    flex-wrap: wrap;
  }
  details.decision > summary::-webkit-details-marker { display: none; }
  details.decision > summary::before { content: "▸ "; color: var(--text-muted); }
  details.decision[open] > summary::before { content: "▾ "; color: var(--text-accent); }
  .decision-title { font-weight: 600; color: var(--text-primary); }
  .decision-body { padding: 0 1rem .9rem; }
  .decision-body p { margin: .5rem 0; font-size: .92rem; color: var(--text-secondary); line-height: 1.6; }
  .evidence em { color: var(--text-muted); font-style: italic; }

  .meta { color: var(--text-muted); font-size: .8rem; font-family: var(--font-mono); }
  .label {
    font-family: var(--font-mono);
    font-size: .7rem;
    font-weight: 600;
    letter-spacing: 0.06em;
    text-transform: uppercase;
    color: var(--text-muted);
    margin-right: .3rem;
  }
  .label-discard { color: var(--text-discard); }

  .files { margin: .6rem 0 0; padding-left: 1.25rem; font-size: .85rem; color: var(--text-secondary); }

  .empty {
    color: var(--text-muted);
    background: var(--surface-panel);
    border: 1px dashed var(--border-subtle);
    border-radius: var(--radius-lg);
    padding: 1.5rem;
    text-align: center;
  }

  .badge-stale {
    display: inline-flex;
    align-items: center;
    font-family: var(--font-mono);
    font-size: .7rem;
    font-weight: 600;
    letter-spacing: 0.04em;
    text-transform: uppercase;
    color: var(--text-accent);
    background: var(--accent-soft-bg);
    padding: .15rem .5rem;
    border-radius: var(--radius-full);
  }

  details.parser-issues {
    margin-top: 2.5rem;
    border: 1px dashed var(--border-subtle);
    border-radius: var(--radius-lg);
    padding: .6rem 1.25rem;
    font-size: .85rem;
    color: var(--text-secondary);
  }
  details.parser-issues summary { font-family: var(--font-mono); cursor: pointer; }

  code {
    font-family: var(--font-mono);
    background: var(--surface-inset);
    color: var(--text-secondary);
    padding: .15rem .4rem;
    border-radius: var(--radius-sm);
    font-size: .85em;
  }
</style>
</head>
<body>
  <header class="site-header">
    ${renderLogo()}
    <span class="wordmark">waypoint</span>
    <span class="tagline">architecture decisions</span>
  </header>
  <nav class="view-switch">${sessionLink}${dayLink}</nav>
  ${renderFilterForm(query)}
  ${renderStaleToggle(query)}
  ${meta}
  ${body}
  ${renderPagination(query, page, totalPages)}
  ${renderConflictsSection(conflicts)}
  ${renderResolvedConflictsSection(resolvedConflicts)}
  ${importedSection}
  ${renderParserIssues(issues)}
  <footer class="site-footer">
    waypoint · built by <a href="https://alejamantillac.com">Alejandra Mantilla</a> · <a href="https://github.com/alejandramantillac/waypoint">GitHub</a> · <a href="https://www.linkedin.com/in/maria-alejandra-mantilla/">LinkedIn</a>
  </footer>
</body>
</html>`;
}
