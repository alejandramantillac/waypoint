import { getSessionsForProject } from "../parser/sessions.js";
import {
  openDatabase,
  getProcessedSessionIds,
  listDecisions,
  listImportedDecisions,
  listParserIssues,
} from "../db/database.js";
import { runAutoImport, formatAutoImportSummary } from "../share/autoImport.js";

function formatDateRange(dates: string[]): string {
  if (dates.length === 0) return "no dated sessions";
  const sorted = [...dates].sort();
  const oldest = sorted[0].slice(0, 10);
  const newest = sorted[sorted.length - 1].slice(0, 10);
  return oldest === newest ? oldest : `${oldest} to ${newest}`;
}

export async function runStatus(): Promise<void> {
  const cwd = process.cwd();
  const summary = formatAutoImportSummary(runAutoImport(cwd));
  if (summary) console.log(summary + "\n");
  const db = openDatabase(cwd);

  const processedIds = getProcessedSessionIds(db);
  const { sessions, unparseableFiles } = getSessionsForProject(cwd);

  if (sessions.length === 0 && unparseableFiles.length === 0) {
    console.log("No Claude Code sessions found for this project.");
    return;
  }

  const newSessions = sessions.filter((s) => !processedIds.has(s.sessionId));
  const dates = sessions.map((s) => s.startedAt).filter((d): d is string => d !== null);
  const newDates = newSessions.map((s) => s.startedAt).filter((d): d is string => d !== null);

  console.log(`Project: ${cwd}`);
  console.log(`Claude Code sessions found: ${sessions.length} (${formatDateRange(dates)})`);
  console.log(`  ${sessions.length - newSessions.length} already processed`);
  console.log(`  ${newSessions.length} new (not yet distilled)${newSessions.length > 0 ? ` — ${formatDateRange(newDates)}` : ""}`);
  if (unparseableFiles.length > 0) {
    console.log(`  ${unparseableFiles.length} could not be read at all`);
  }

  const decisions = listDecisions(db);
  const imported = listImportedDecisions(db);
  const issues = listParserIssues(db);

  console.log(`Decisions stored: ${decisions.length}`);
  if (imported.length > 0) {
    const authors = new Set(imported.map((d) => d.importedFrom)).size;
    console.log(`Imported decisions: ${imported.length} (from ${authors} collaborator(s))`);
  }
  if (issues.length > 0) {
    console.log(`Parser issues logged: ${issues.length}`);
  }

  console.log("");
  if (newSessions.length > 0) {
    console.log(`Run \`waypoint generate\` to distill the ${newSessions.length} new session(s) (this calls claude -p and has a small cost).`);
  } else {
    console.log("Nothing new to distill — everything found is already processed.");
  }
}
