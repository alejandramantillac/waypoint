import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { openDatabase, markSessionProcessed, insertDecisions, listUnresolvedConflicts, listImportedDecisions } from "../db/database.js";
import { appendToSharedFile } from "./sharedStore.js";
import { getAuthorSlug } from "./authorSlug.js";
import { runAutoImport, formatAutoImportSummary } from "./autoImport.js";
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

test("runAutoImport records a conflict between two different authors' imported decisions (imported-vs-imported)", () => {
  withTempProject((cwd) => {
    const db = openDatabase(cwd);

    // Author A's decision is imported in a prior scan.
    appendToSharedFile(cwd, "author-a-111111", [baseDecision]);
    runAutoImport(cwd);
    assert.equal(listImportedDecisions(db).length, 1);

    // Author B's decision (a different session/author) touches the same file and is
    // imported in a LATER scan — this must be flagged as a conflict against author A's
    // already-imported decision, not just against local decisions.
    appendToSharedFile(cwd, "author-b-222222", [
      { ...baseDecision, sessionId: "remote-s2", title: "Use MySQL instead" },
    ]);
    runAutoImport(cwd);

    assert.equal(listImportedDecisions(db).length, 2);
    const conflicts = listUnresolvedConflicts(db);
    assert.equal(conflicts.length, 1);
    assert.equal(conflicts[0].a.source, "imported");
    assert.equal(conflicts[0].b.source, "imported");
  });
});

test("runAutoImport does not flag same-author decisions across scans as a conflict", () => {
  withTempProject((cwd) => {
    const db = openDatabase(cwd);

    // D1 from author "andres-def456" is imported in scan 1.
    appendToSharedFile(cwd, "andres-def456", [baseDecision]);
    runAutoImport(cwd);
    assert.equal(listImportedDecisions(db).length, 1);
    assert.equal(listUnresolvedConflicts(db).length, 0);

    // The SAME author later appends D2 (overlapping files) to their OWN shared file
    // (e.g. via `waypoint generate` on their machine), and a later scan (after a
    // `git pull`) picks it up. D1 is already imported (dedup skips re-insert); D2 is
    // newly imported. D1 and D2 overlap in filesAffected but come from the same author,
    // so this must never be recorded as an imported-vs-imported conflict.
    appendToSharedFile(cwd, "andres-def456", [
      { ...baseDecision, sessionId: "remote-s2", title: "Reconsider Postgres" },
    ]);
    runAutoImport(cwd);

    assert.equal(listImportedDecisions(db).length, 2);
    assert.equal(listUnresolvedConflicts(db).length, 0);
  });
});

test("runAutoImport does not flag same-author decisions within the same scan as a conflict", () => {
  withTempProject((cwd) => {
    const db = openDatabase(cwd);

    // Two decisions from the SAME author's file, imported together in one scan, that
    // share a file: this is same-author supersession territory, not a cross-author
    // conflict, so it must not add noise.
    appendToSharedFile(cwd, "andres-def456", [
      baseDecision,
      { ...baseDecision, sessionId: "remote-s2", title: "Reconsider Postgres" },
    ]);
    runAutoImport(cwd);

    assert.equal(listImportedDecisions(db).length, 2);
    assert.equal(listUnresolvedConflicts(db).length, 0);
  });
});

test("runAutoImport skips a malformed shared file without aborting the whole scan", () => {
  withTempProject((cwd) => {
    const db = openDatabase(cwd);

    // A corrupted/truncated shared file from one teammate (e.g. bad commit, unresolved
    // git merge markers) must not prevent other teammates' valid files from importing.
    const sharedDir = join(cwd, ".waypoint", "shared");
    mkdirSync(sharedDir, { recursive: true });
    writeFileSync(join(sharedDir, "broken-author-333333.json"), "{ not valid json <<<<<<< HEAD");

    appendToSharedFile(cwd, "andres-def456", [baseDecision]);

    const summary = runAutoImport(cwd);

    const ok = summary.find((s) => s.importedFrom === "andres-def456");
    assert.ok(ok, "expected the valid author's file to still be processed");
    assert.equal(ok!.count, 1);

    const broken = summary.find((s) => s.importedFrom === "broken-author-333333");
    assert.ok(broken, "expected an entry for the broken file");
    assert.equal(broken!.count, 0);
    assert.ok(broken!.error, "expected an error message on the broken file's summary");

    assert.equal(listImportedDecisions(db).length, 1);

    const formatted = formatAutoImportSummary(summary);
    assert.ok(formatted, "expected a formatted summary");
    assert.match(formatted!, /no se pudo leer broken-author-333333\.json/);
  });
});
