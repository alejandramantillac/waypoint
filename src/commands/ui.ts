import { createServer } from "node:http";
import {
  openDatabase,
  listDecisionsGroupedBySession,
  listDecisionsGroupedByDay,
  listParserIssues,
  listImportedDecisionsGroupedByAuthor,
  type SessionGroup,
  type DayGroup,
  type ImportedDecision,
  type ImportedGroup,
} from "../db/database.js";
import { annotateWithGitStatus } from "../git/status.js";
import { renderPage } from "../ui/render.js";

const DEFAULT_PORT = 4173;

function annotateGroups<D extends { filesAffected: string[]; modifiedSinceDecision?: boolean | null }, G extends { decisions: D[] }>(
  cwd: string,
  groups: G[],
  getDate?: (d: D) => string,
): G[] {
  return groups.map((g) => ({ ...g, decisions: annotateWithGitStatus(cwd, g.decisions, getDate) }));
}

export async function runUi(args: string[]): Promise<void> {
  const cwd = process.cwd();
  const db = openDatabase(cwd);

  const server = createServer((req, res) => {
    const url = new URL(req.url ?? "/", "http://localhost");
    const view = url.searchParams.get("group") === "day" ? "day" : "session";
    const issues = listParserIssues(db);
    const importedGroups = annotateGroups<ImportedDecision, ImportedGroup>(
      cwd,
      listImportedDecisionsGroupedByAuthor(db),
      (d) => d.sourceCreatedAt,
    );

    const groups: SessionGroup[] | DayGroup[] =
      view === "day"
        ? annotateGroups(cwd, listDecisionsGroupedByDay(db))
        : annotateGroups(cwd, listDecisionsGroupedBySession(db));

    const html = renderPage({ view, groups, issues, importedGroups });
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
