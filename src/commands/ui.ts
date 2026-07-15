import { createServer } from "node:http";
import {
  openDatabase,
  listDecisions,
  listDecisionsGroupedBySession,
  listDecisionsGroupedByDay,
  listImportedDecisions,
  listParserIssues,
  listImportedDecisionsGroupedByAuthor,
  listUnresolvedConflicts,
  resolveConflict,
  undoRelation,
  searchDecisions,
  searchImportedDecisions,
  type SessionGroup,
  type DayGroup,
  type Decision,
  type ImportedDecision,
  type ImportedGroup,
} from "../db/database.js";
import { annotateWithGitStatus, createGitStatusCache, type GitStatusCache } from "../git/status.js";
import { renderPage, type SearchResultItem, type ConflictView } from "../ui/render.js";
import { toLocalDay, isValidDateString } from "../util/dates.js";
import { runAutoImport, formatAutoImportSummary } from "../share/autoImport.js";

const DEFAULT_PORT = 4173;
const GROUP_PAGE_SIZE = 10;
const DECISION_PAGE_SIZE = 10;

function annotateGroups<D extends { filesAffected: string[]; modifiedSinceDecision?: boolean | null }, G extends { decisions: D[] }>(
  cwd: string,
  groups: G[],
  cache: GitStatusCache,
  getDate?: (d: D) => string,
): G[] {
  return groups.map((g) => ({ ...g, decisions: annotateWithGitStatus(cwd, g.decisions, getDate, cache) }));
}

function withinRange(dateStr: string, since?: string, until?: string): boolean {
  const day = toLocalDay(dateStr);
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
  const summary = formatAutoImportSummary(runAutoImport(cwd));
  if (summary) console.log(summary);
  const db = openDatabase(cwd);

  const server = createServer((req, res) => {
    const url = new URL(req.url ?? "/", "http://localhost");
    const query = url.searchParams;

    const resolveConflictId = query.get("resolveConflict");
    const winnerParam = query.get("winner"); // "local:3" or "imported:7"
    if (resolveConflictId && winnerParam) {
      const conflict = listUnresolvedConflicts(db).find((c) => c.id === Number(resolveConflictId));
      if (conflict) {
        const [winnerSource, winnerIdStr] = winnerParam.split(":");
        const winner = { source: winnerSource as "local" | "imported", id: Number(winnerIdStr) };
        const loser = winner.source === conflict.a.source && winner.id === conflict.a.id ? conflict.b : conflict.a;
        resolveConflict(db, winner, loser);
      }
      res.writeHead(302, { Location: "/" });
      res.end();
      return;
    }

    const undoId = query.get("undoRelation");
    if (undoId) {
      undoRelation(db, Number(undoId));
      res.writeHead(302, { Location: "/" });
      res.end();
      return;
    }

    const view = query.get("group") === "day" ? "day" : "session";
    const q = (query.get("q") ?? "").trim();
    const stale = query.get("stale") === "1";
    const rawSince = query.get("since") || undefined;
    const rawUntil = query.get("until") || undefined;
    const since = rawSince && isValidDateString(rawSince) ? rawSince : undefined;
    const until = rawUntil && isValidDateString(rawUntil) ? rawUntil : undefined;
    const requestedPage = parseInt(query.get("page") ?? "1", 10) || 1;

    const issues = listParserIssues(db);
    // One cache per request: shared across every group/decision annotated while
    // handling this request, discarded once the response is sent — so a commit
    // made between two page loads is picked up on the next load.
    const gitCache = createGitStatusCache();

    const dateFilter = (d: Decision) => withinRange(d.createdAt, since, until);
    const importedDateFilter = (d: ImportedDecision) => withinRange(d.sourceCreatedAt, since, until);
    const staleFilter = (d: { modifiedSinceDecision?: boolean | null }) => d.modifiedSinceDecision === true;

    let html: string;

    if (q) {
      let local = annotateWithGitStatus(cwd, searchDecisions(db, q), undefined, gitCache);
      let imported = annotateWithGitStatus(cwd, searchImportedDecisions(db, q), (d) => d.sourceCreatedAt, gitCache);

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
        conflicts: [],
        query,
        page,
        totalPages,
        search: { query: q, items: slice },
      });
    } else {
      let groups: SessionGroup[] | DayGroup[] =
        view === "day"
          ? annotateGroups(cwd, listDecisionsGroupedByDay(db), gitCache)
          : annotateGroups(cwd, listDecisionsGroupedBySession(db), gitCache);
      let importedGroups = annotateGroups<ImportedDecision, ImportedGroup>(
        cwd,
        listImportedDecisionsGroupedByAuthor(db),
        gitCache,
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

      const unresolvedConflicts = listUnresolvedConflicts(db);
      const allLocal = listDecisions(db, { includeSuperseded: true });
      const allImported = listImportedDecisions(db, { includeSuperseded: true });
      const conflictViews: ConflictView[] = unresolvedConflicts
        .map((c) => {
          const resolve = (ref: { source: "local" | "imported"; id: number }) =>
            ref.source === "local" ? allLocal.find((d) => d.id === ref.id) : allImported.find((d) => d.id === ref.id);
          const a = resolve(c.a);
          const b = resolve(c.b);
          if (!a || !b) return null;
          return { relationId: c.id, a: { ref: c.a, decision: a }, b: { ref: c.b, decision: b } };
        })
        .filter((c): c is ConflictView => c !== null);

      html = renderPage({
        view,
        groups: slice as SessionGroup[] | DayGroup[],
        groupsTotalCount: groups.length,
        decisionsTotalCount,
        issues,
        importedGroups,
        conflicts: conflictViews,
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
