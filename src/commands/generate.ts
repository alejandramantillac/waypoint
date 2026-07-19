import { getSessionsForProject } from "../parser/sessions.js";
import { distillSession } from "../distill/engine.js";
import {
  openDatabase,
  getProcessedSessionIds,
  markSessionProcessed,
  insertDecisions,
  insertParserIssue,
  getSupersessionCandidates,
  addSupersession,
  listDecisionsForExport,
} from "../db/database.js";
import { getAuthorSlug } from "../share/authorSlug.js";
import { appendToSharedFile } from "../share/sharedStore.js";
import type { DatabaseSync } from "node:sqlite";

function reportParserIssues(
  db: DatabaseSync,
  sessions: { sessionId: string; filePath: string; title: string | null; skippedLines: number }[],
  unparseableFiles: string[],
): void {
  for (const session of sessions) {
    if (session.skippedLines > 0) {
      const detail = `${session.skippedLines} line(s) skipped due to invalid format`;
      console.log(
        `  ⚠ ${session.skippedLines} line(s) skipped in session ${session.title ?? session.sessionId} due to invalid format`,
      );
      insertParserIssue(db, {
        sessionId: session.sessionId,
        filePath: session.filePath,
        issueType: "skipped_lines",
        detail,
      });
    }
  }
  for (const file of unparseableFiles) {
    console.log(`  ⚠ 1 session could not be read: ${file}`);
    insertParserIssue(db, {
      sessionId: null,
      filePath: file,
      issueType: "unparseable_file",
      detail: "file could not be parsed",
    });
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

function parseModelFlag(args: string[]): string | undefined {
  const idx = args.indexOf("--model");
  if (idx === -1) return undefined;
  const value = args[idx + 1];
  if (!value)
    throw new Error("--model requires a value, e.g. --model haiku (also accepts sonnet, opus, fable, or a full model name)");
  return value;
}

export async function runGenerate(args: string[]): Promise<void> {
  const cwd = process.cwd();
  const since = parseSinceFlag(args);
  const model = parseModelFlag(args);

  const db = openDatabase(cwd);
  const processedIds = getProcessedSessionIds(db);
  const { sessions, unparseableFiles } = getSessionsForProject(cwd, { since });
  const newSessions = sessions.filter((s) => !processedIds.has(s.sessionId));

  if (sessions.length === 0 && unparseableFiles.length === 0) {
    console.log("No Claude Code sessions found for this project.");
    return;
  }

  if (newSessions.length === 0) {
    console.log(
      sessions.length === 0
        ? "No sessions could be parsed for this project."
        : "0 new sessions (everything found was already processed).",
    );
    reportParserIssues(db, newSessions, unparseableFiles);
    return;
  }

  let decisionsFound = 0;
  let processedCount = 0;
  let errorCount = 0;
  const sessionIdsWithNewDecisions: string[] = [];

  for (const session of newSessions) {
    const candidates = getSupersessionCandidates(db, session.filesTouched);
    const result = await distillSession(session, candidates, { model });

    if (!result.ok) {
      errorCount++;
      console.error(`  ✗ ${session.title ?? session.sessionId}: ${result.error}`);
      continue;
    }

    markSessionProcessed(db, session, "ok");
    if (result.decisions.length > 0) {
      const ids = insertDecisions(db, session.sessionId, result.decisions);
      result.decisions.forEach((d, i) => {
        if (d.supersedesCandidateId != null && candidates.some((c) => c.id === d.supersedesCandidateId)) {
          addSupersession(db, { source: "local", id: ids[i] }, { source: "local", id: d.supersedesCandidateId });
        }
      });
      decisionsFound += result.decisions.length;
      sessionIdsWithNewDecisions.push(session.sessionId);
    }
    processedCount++;
  }

  console.log(
    `${processedCount} sessions processed, ${decisionsFound} decisions found` +
      (errorCount > 0 ? `, ${errorCount} sessions failed (will be retried)` : ""),
  );
  reportParserIssues(db, newSessions, unparseableFiles);

  if (decisionsFound > 0) {
    const authorSlug = getAuthorSlug(cwd);
    if (authorSlug) {
      const allExportable = listDecisionsForExport(db);
      const newlyExportable = allExportable.filter((d) => sessionIdsWithNewDecisions.includes(d.sessionId));
      appendToSharedFile(cwd, authorSlug, newlyExportable);
      console.log(`Wrote ${newlyExportable.length} decision(s) to .waypoint/shared/${authorSlug}.json — commit it to share with your team.`);
    }
  }
}
