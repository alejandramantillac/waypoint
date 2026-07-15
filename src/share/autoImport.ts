import { openDatabase, insertImportedDecisions, listDecisions, listImportedDecisions, addConflict, type ImportedDecisionInput } from "../db/database.js";
import { contentHash } from "./format.js";
import { getAuthorSlug } from "./authorSlug.js";
import { listOtherAuthorSharedFiles, readSharedFile } from "./sharedStore.js";

export interface AutoImportSummary {
  importedFrom: string;
  count: number;
  error?: string;
}

function overlapsExisting(
  filesAffected: string[],
  existing: { id: number; filesAffected: string[] }[],
): number[] {
  return existing.filter((e) => e.filesAffected.some((f) => filesAffected.includes(f))).map((e) => e.id);
}

export function runAutoImport(cwd: string): AutoImportSummary[] {
  const db = openDatabase(cwd);
  const ownSlug = getAuthorSlug(cwd);
  const otherFiles = listOtherAuthorSharedFiles(cwd, ownSlug);

  const summaries: AutoImportSummary[] = [];

  for (const { slug, path } of otherFiles) {
    try {
      const file = readSharedFile(path);
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

      // Snapshot of imported decisions from OTHER authors' previously-processed files
      // (earlier in this same scan, or from prior scans) — used both to compute which
      // decisions are "new" from this file's insert, and as a comparison target so a
      // newly-imported decision conflicting with a different author's already-imported
      // decision gets flagged (spec 3.4: overlap with "own" OR "third party" decisions).
      // Decisions imported from the SAME author (`slug`) are excluded: if this author's
      // shared file was scanned in a prior run and now has new decisions appended, the
      // newly-imported decisions must never be compared against that same author's
      // already-imported decisions — that's same-author supersession territory, not a
      // cross-author conflict, and isn't handled by this codebase.
      const allBeforeExisting = listImportedDecisions(db);
      const before = new Set(allBeforeExisting.map((d) => d.id));
      const beforeExisting = allBeforeExisting
        .filter((d) => d.importedFrom !== slug)
        .map((d) => ({ id: d.id, filesAffected: d.filesAffected }));
      const { inserted } = insertImportedDecisions(db, inputs);
      summaries.push({ importedFrom: slug, count: inserted });

      if (inserted > 0) {
        const localExisting = listDecisions(db).map((d) => ({ id: d.id, filesAffected: d.filesAffected }));
        const importedExisting = listImportedDecisions(db)
          .filter((d) => !before.has(d.id))
          .map((d) => ({ id: d.id, filesAffected: d.filesAffected }));

        for (const newImported of importedExisting) {
          for (const localId of overlapsExisting(newImported.filesAffected, localExisting)) {
            addConflict(db, { source: "local", id: localId }, { source: "imported", id: newImported.id });
          }
          for (const existingImportedId of overlapsExisting(newImported.filesAffected, beforeExisting)) {
            addConflict(db, { source: "imported", id: existingImportedId }, { source: "imported", id: newImported.id });
          }
        }
      }
    } catch (err) {
      summaries.push({ importedFrom: slug, count: 0, error: err instanceof Error ? err.message : String(err) });
    }
  }

  return summaries;
}

export function formatAutoImportSummary(summaries: AutoImportSummary[]): string | null {
  const withNew = summaries.filter((s) => s.count > 0);
  const withErrors = summaries.filter((s) => s.error);

  const parts: string[] = [];
  if (withNew.length > 0) {
    parts.push(`Detectadas decisiones nuevas de: ${withNew.map((s) => `${s.importedFrom} (${s.count})`).join(", ")}`);
  }
  if (withErrors.length > 0) {
    parts.push(withErrors.map((s) => `no se pudo leer ${s.importedFrom}.json: ${s.error}`).join("; "));
  }

  return parts.length > 0 ? parts.join("\n") : null;
}
