import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { openDatabase, markSessionProcessed, insertDecisions, listUnresolvedConflicts, listImportedDecisions } from "../db/database.js";
import { appendToSharedFile } from "./sharedStore.js";
import { getAuthorSlug } from "./authorSlug.js";
import { runAutoImport } from "./autoImport.js";
import type { ExportableDecision } from "../db/database.js";

function withTempProject(fn: (cwd: string) => void) {
  const dir = mkdtempSync(join(tmpdir(), "waypoint-autoimport-"));
  try {
    fn(dir);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

const baseDecision: ExportableDecision = {
  sessionId: "remote-s1",
  sessionTitle: "remote session",
  sessionStartedAt: "2026-07-14T00:00:00.000Z",
  title: "Use Postgres",
  decision: "Use Postgres",
  why: "scale",
  discarded: null,
  evidence: "e",
  filesAffected: ["src/db.ts"],
  createdAt: "2026-07-14T00:00:00.000Z",
};

test("runAutoImport imports decisions from other authors' shared files, not its own", () => {
  withTempProject((cwd) => {
    // runAutoImport determines "own slug" via getAuthorSlug(cwd), which requires a real
    // git identity — init one here so the "own" shared file below is written under the
    // exact slug runAutoImport will compute for itself, not an arbitrary literal (a real
    // slug always ends in a 6-hex-char hash suffix, so a hand-picked string like
    // "own-slug" could never match what getAuthorSlug actually produces).
    execFileSync("git", ["init", "-q"], { cwd });
    execFileSync("git", ["config", "user.name", "Own Author"], { cwd });
    execFileSync("git", ["config", "user.email", "own@example.com"], { cwd });
    const ownSlug = getAuthorSlug(cwd);
    assert.ok(ownSlug, "expected getAuthorSlug to resolve inside a configured git repo");

    const db = openDatabase(cwd);
    appendToSharedFile(cwd, "andres-def456", [baseDecision]);
    appendToSharedFile(cwd, ownSlug!, [{ ...baseDecision, sessionId: "own-s1", title: "Own decision" }]);

    const summary = runAutoImport(cwd);
    assert.deepEqual(summary, [{ importedFrom: "andres-def456", count: 1 }]);
    assert.equal(listImportedDecisions(db).length, 1);
  });
});

test("runAutoImport is idempotent (dedup via contentHash on rescan)", () => {
  withTempProject((cwd) => {
    appendToSharedFile(cwd, "andres-def456", [baseDecision]);
    runAutoImport(cwd);
    const second = runAutoImport(cwd);
    assert.deepEqual(second, [{ importedFrom: "andres-def456", count: 0 }]);
  });
});

test("runAutoImport records a conflict when an imported decision's files overlap an existing local decision", () => {
  withTempProject((cwd) => {
    const db = openDatabase(cwd);
    markSessionProcessed(db, { sessionId: "local-s1", filePath: "/tmp/x", startedAt: null, endedAt: null, title: "local", transcript: "", filesTouched: [], skippedLines: 0 }, "ok");
    insertDecisions(db, "local-s1", [
      { title: "Use SQLite", decision: "d", why: "w", discarded: null, filesAffected: ["src/db.ts"], evidence: "e", supersedesCandidateId: null },
    ]);
    appendToSharedFile(cwd, "andres-def456", [baseDecision]); // also touches src/db.ts

    runAutoImport(cwd);

    const conflicts = listUnresolvedConflicts(db);
    assert.equal(conflicts.length, 1);
  });
});
