import { createServer } from "node:http";
import {
  openDatabase,
  listDecisionsGroupedBySession,
  listDecisionsGroupedByDay,
  listParserIssues,
  listImportedDecisionsGroupedByAuthor,
  searchDecisions,
  searchImportedDecisions,
  type SessionGroup,
  type DayGroup,
  type Decision,
  type ImportedDecision,
  type ImportedGroup,
} from "../db/database.js";
import { annotateWithGitStatus } from "../git/status.js";
import { renderPage, type SearchResultItem } from "../ui/render.js";

const DEFAULT_PORT = 4173;
const GROUP_PAGE_SIZE = 20;
const DECISION_PAGE_SIZE = 20;

function annotateGroups<D extends { filesAffected: string[]; modifiedSinceDecision?: boolean | null }, G extends { decisions: D[] }>(
  cwd: string,
  groups: G[],
  getDate?: (d: D) => string,
): G[] {
  return groups.map((g) => ({ ...g, decisions: annotateWithGitStatus(cwd, g.decisions, getDate) }));
}

/** Compares only the date portion (YYYY-MM-DD) so `since`/`until` from a plain <input type="date"> line up with full ISO timestamps. */
function withinRange(dateStr: string, since?: string, until?: string): boolean {
  const day = dateStr.slice(0, 10);
  if (since && day < since) return false;
  if (until && day > until) return false;
  return true;
}

function filterGroupDecisions<D, G extends { decisions: D[] }>(
  groups: G[],
  predicate: (d: D) => boolean,
): G[] {
  return groups
    .map((g) => ({ ...g, decisions: g.decisions.filter(predicate) }))
    .filter((g) => g.decisions.length > 0);
}

function paginate<T>(items: T[], requestedPage: number, pageSize: number): { slice: T[]; page: number; totalPages: number } {
  const totalPages = Math.max(1, Math.ceil(items.length / pageSize));
  const page = Math.min(Math.max(1, requestedPage), totalPages);
  const start = (page - 1) * pageSize;
  return { slice: items.slice(start, start + pageSize), page, totalPages };
}

export async function runUi(args: string[]): Promise<void> {
  const cwd = process.cwd();
  const db = openDatabase(cwd);

  const server = createServer((req, res) => {
    const url = new URL(req.url ?? "/", "http://localhost");
    const query = url.searchParams;
    const view = query.get("group") === "day" ? "day" : "session";
    const q = (query.get("q") ?? "").trim();
    const stale = query.get("stale") === "1";
    const since = query.get("since") || undefined;
    const until = query.get("until") || undefined;
    const requestedPage = parseInt(query.get("page") ?? "1", 10) || 1;

    const issues = listParserIssues(db);

    const dateFilter = (d: Decision) => withinRange(d.createdAt, since, until);
    const importedDateFilter = (d: ImportedDecision) => withinRange(d.sourceCreatedAt, since, until);
    const staleFilter = (d: { modifiedSinceDecision?: boolean | null }) => d.modifiedSinceDecision === true;

    let html: string;

    if (q) {
      let local = annotateWithGitStatus(cwd, searchDecisions(db, q));
      let imported = annotateWithGitStatus(cwd, searchImportedDecisions(db, q), (d) => d.sourceCreatedAt);

      if (since || until) {
        local = local.filter(dateFilter);
        imported = imported.filter(importedDateFilter);
      }
      if (stale) {
        local = local.filter(staleFilter);
        imported = imported.filter(staleFilter);
      }

      const items: SearchResultItem[] = [
        ...local.map((decision): SearchResultItem => ({ origin: "local", decision })),
        ...imported.map((decision): SearchResultItem => ({ origin: "imported", importedFrom: decision.importedFrom, decision })),
      ].sort((a, b) => {
        const dateA = a.origin === "local" ? a.decision.createdAt : a.decision.sourceCreatedAt;
        const dateB = b.origin === "local" ? b.decision.createdAt : b.decision.sourceCreatedAt;
        return dateA.localeCompare(dateB);
      });

      const { slice, page, totalPages } = paginate(items, requestedPage, DECISION_PAGE_SIZE);

      html = renderPage({
        view,
        groups: [],
        groupsTotalCount: 0,
        decisionsTotalCount: items.length,
        issues,
        importedGroups: [],
        query,
        page,
        totalPages,
        search: { query: q, items: slice },
      });
    } else {
      let groups: SessionGroup[] | DayGroup[] =
        view === "day"
          ? annotateGroups(cwd, listDecisionsGroupedByDay(db))
          : annotateGroups(cwd, listDecisionsGroupedBySession(db));
      let importedGroups = annotateGroups<ImportedDecision, ImportedGroup>(
        cwd,
        listImportedDecisionsGroupedByAuthor(db),
        (d) => d.sourceCreatedAt,
      );

      if (since || until) {
        groups = filterGroupDecisions(groups as { decisions: Decision[] }[], dateFilter) as SessionGroup[] | DayGroup[];
        importedGroups = filterGroupDecisions(importedGroups, importedDateFilter);
      }
      if (stale) {
        groups = filterGroupDecisions(groups as { decisions: Decision[] }[], staleFilter) as SessionGroup[] | DayGroup[];
        importedGroups = filterGroupDecisions(importedGroups, staleFilter);
      }

      const decisionsTotalCount = groups.reduce((sum, g) => sum + g.decisions.length, 0);
      const { slice, page, totalPages } = paginate<SessionGroup | DayGroup>(groups, requestedPage, GROUP_PAGE_SIZE);

      html = renderPage({
        view,
        groups: slice as SessionGroup[] | DayGroup[],
        groupsTotalCount: groups.length,
        decisionsTotalCount,
        issues,
        importedGroups,
        query,
        page,
        totalPages,
        search: null,
      });
    }

    res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
    res.end(html);
  });

  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(DEFAULT_PORT, () => {
      server.removeListener("error", reject);
      resolve();
    });
  });

  console.log(`waypoint ui running at http://localhost:${DEFAULT_PORT}`);
  console.log("Ctrl+C to exit.");
}
