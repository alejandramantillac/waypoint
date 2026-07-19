import { readFileSync } from "node:fs";
import { openDatabase, insertImportedDecisions, type ImportedDecisionInput } from "../db/database.js";
import { parseExportFile, contentHash } from "../share/format.js";

export async function runImport(args: string[]): Promise<void> {
  const [path] = args;
  if (!path) {
    throw new Error("waypoint import requires a file path, e.g. waypoint import waypoint-export-2026-07-13.json");
  }

  let raw: string;
  try {
    raw = readFileSync(path, "utf-8");
  } catch (err) {
    throw new Error(`could not read ${path}: ${err instanceof Error ? err.message : err}`, { cause: err });
  }

  const file = parseExportFile(raw);

  const cwd = process.cwd();
  const db = openDatabase(cwd);

  const inputs: ImportedDecisionInput[] = file.decisions.map((d) => ({
    importedFrom: file.exportedBy,
    sourceSessionId: d.sessionId,
    sourceSessionTitle: d.sessionTitle,
    sourceSessionStartedAt: d.sessionStartedAt,
    title: d.title,
    decision: d.decision,
    why: d.why,
    discarded: d.discarded,
    evidence: d.evidence,
    filesAffected: d.filesAffected,
    sourceCreatedAt: d.createdAt,
    contentHash: contentHash(d.sessionId, d.title, d.decision, d.why),
  }));

  const { inserted, skipped } = insertImportedDecisions(db, inputs);
  console.log(`Imported from "${file.exportedBy}": ${inserted} new, ${skipped} already existed.`);
}
