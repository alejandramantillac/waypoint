import { openDatabase, insertImportedDecisions, listDecisions, listImportedDecisions, addConflict, type ImportedDecisionInput } from "../db/database.js";
import { contentHash } from "./format.js";
import { getAuthorSlug } from "./authorSlug.js";
import { listOtherAuthorSharedFiles, readSharedFile } from "./sharedStore.js";

export interface AutoImportSummary {
  importedFrom: string;
  count: number;
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

    const before = new Set(listImportedDecisions(db).map((d) => d.id));
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
      }
    }
  }

  return summaries;
}

export function formatAutoImportSummary(summaries: AutoImportSummary[]): string | null {
  const withNew = summaries.filter((s) => s.count > 0);
  if (withNew.length === 0) return null;
  return `Detectadas decisiones nuevas de: ${withNew.map((s) => `${s.importedFrom} (${s.count})`).join(", ")}`;
}
