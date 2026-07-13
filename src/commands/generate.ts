import { getSessionsForProject } from "../parser/sessions.js";
import { distillSession } from "../distill/engine.js";
import {
  openDatabase,
  getProcessedSessionIds,
  markSessionProcessed,
  insertDecisions,
} from "../db/database.js";

function reportParserIssues(
  sessions: { sessionId: string; title: string | null; skippedLines: number }[],
  unparseableFiles: string[],
): void {
  for (const session of sessions) {
    if (session.skippedLines > 0) {
      console.log(
        `  ⚠ ${session.skippedLines} line(s) skipped in session ${session.title ?? session.sessionId} due to invalid format`,
      );
    }
  }
  for (const file of unparseableFiles) {
    console.log(`  ⚠ 1 session could not be read: ${file}`);
  }
}

function parseSinceFlag(args: string[]): Date | undefined {
  const idx = args.indexOf("--since");
  if (idx === -1) return undefined;
  const value = args[idx + 1];
  if (!value)
    throw new Error("--since requires a date, e.g. --since 2026-07-01");
  const date = new Date(value);
  if (Number.isNaN(date.getTime()))
    throw new Error(`Invalid date for --since: ${value}`);
  return date;
}

export async function runGenerate(args: string[]): Promise<void> {
  const cwd = process.cwd();
  const since = parseSinceFlag(args);

  const db = openDatabase(cwd);
  const processedIds = getProcessedSessionIds(db);
  const { sessions, unparseableFiles } = getSessionsForProject(cwd, { since });
  const newSessions = sessions.filter((s) => !processedIds.has(s.sessionId));

  if (sessions.length === 0 && unparseableFiles.length === 0) {
    console.log("No Claude Code sessions found for this project.");
    return;
  }

  if (newSessions.length === 0) {
    console.log("0 new sessions (everything found was already processed).");
    reportParserIssues(newSessions, unparseableFiles);
    return;
  }

  let decisionsFound = 0;
  let processedCount = 0;
  let errorCount = 0;

  for (const session of newSessions) {
    const result = await distillSession(session);

    if (!result.ok) {
      errorCount++;
      console.error(
        `  ✗ ${session.title ?? session.sessionId}: ${result.error}`,
      );
      continue;
    }

    markSessionProcessed(db, session, "ok");
    if (result.decisions.length > 0) {
      insertDecisions(db, session.sessionId, result.decisions);
      decisionsFound += result.decisions.length;
    }
    processedCount++;
  }

  console.log(
    `${processedCount} sessions processed, ${decisionsFound} decisions found` +
      (errorCount > 0
        ? `, ${errorCount} sessions failed (will be retried)`
        : ""),
  );
  reportParserIssues(newSessions, unparseableFiles);
}
