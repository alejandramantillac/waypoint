import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  openDatabase,
  addSupersession,
  addConflict,
  resolveConflict,
  undoRelation,
  getSupersededKeys,
  listUnresolvedConflicts,
  insertDecisions,
  markSessionProcessed,
  listDecisions,
  getSupersessionCandidates,
} from "./database.js";

function withTempProject(fn: (cwd: string) => void) {
  const dir = mkdtempSync(join(tmpdir(), "waypoint-test-"));
  try {
    fn(dir);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

test("addSupersession marks the loser as superseded", () => {
  withTempProject((cwd) => {
    const db = openDatabase(cwd);
    addSupersession(db, { source: "local", id: 2 }, { source: "local", id: 1 });
    const superseded = getSupersededKeys(db);
    assert.equal(superseded.has("local:1"), true);
    assert.equal(superseded.has("local:2"), false);
  });
});

test("addConflict is listed as unresolved until resolveConflict is called", () => {
  withTempProject((cwd) => {
    const db = openDatabase(cwd);
    addConflict(db, { source: "local", id: 1 }, { source: "imported", id: 5 });
    let conflicts = listUnresolvedConflicts(db);
    assert.equal(conflicts.length, 1);
    assert.deepEqual(conflicts[0].a, { source: "local", id: 1 });
    assert.deepEqual(conflicts[0].b, { source: "imported", id: 5 });

    resolveConflict(db, { source: "local", id: 1 }, { source: "imported", id: 5 });
    conflicts = listUnresolvedConflicts(db);
    assert.equal(conflicts.length, 0);
    assert.equal(getSupersededKeys(db).has("imported:5"), true);
  });
});

test("undoRelation reverses a supersession", () => {
  withTempProject((cwd) => {
    const db = openDatabase(cwd);
    addSupersession(db, { source: "local", id: 2 }, { source: "local", id: 1 });
    const before = getSupersededKeys(db);
    assert.equal(before.has("local:1"), true);

    // undoRelation needs the relation's own id — fetch it back out.
    const rows = db
      .prepare(`SELECT id FROM decision_relations WHERE relation_type = 'supersedes'`)
      .all() as { id: number }[];
    undoRelation(db, rows[0].id);

    const after = getSupersededKeys(db);
    assert.equal(after.has("local:1"), false);
  });
});

test("undoRelation on a resolved conflict reverts it to unresolved, not a new state", () => {
  withTempProject((cwd) => {
    const db = openDatabase(cwd);
    addConflict(db, { source: "local", id: 1 }, { source: "imported", id: 5 });
    resolveConflict(db, { source: "local", id: 1 }, { source: "imported", id: 5 });
    assert.equal(listUnresolvedConflicts(db).length, 0);

    const supersedeRows = db
      .prepare(`SELECT id FROM decision_relations WHERE relation_type = 'supersedes'`)
      .all() as { id: number }[];
    undoRelation(db, supersedeRows[0].id);

    assert.equal(listUnresolvedConflicts(db).length, 1);
    assert.equal(getSupersededKeys(db).has("imported:5"), false);
  });
});

test("resolveConflict with reversed order matches the original conflict", () => {
  withTempProject((cwd) => {
    const db = openDatabase(cwd);
    // Add conflict with order: a=local:1, b=imported:5
    addConflict(db, { source: "local", id: 1 }, { source: "imported", id: 5 });
    let conflicts = listUnresolvedConflicts(db);
    assert.equal(conflicts.length, 1);

    // Resolve with reversed order: winner=imported:5, loser=local:1
    // This tests the second OR clause in resolveConflict's SQL
    resolveConflict(db, { source: "imported", id: 5 }, { source: "local", id: 1 });

    // Conflict should be resolved
    conflicts = listUnresolvedConflicts(db);
    assert.equal(conflicts.length, 0);

    // local:1 should be superseded (the loser)
    assert.equal(getSupersededKeys(db).has("local:1"), true);

    // Now test undoRelation to ensure the conflict can be un-resolved
    const supersedeRows = db
      .prepare(`SELECT id FROM decision_relations WHERE relation_type = 'supersedes'`)
      .all() as { id: number }[];
    assert.equal(supersedeRows.length, 1, "Should have exactly one supersedes relation");

    undoRelation(db, supersedeRows[0].id);

    // Conflict should be unresolved again
    conflicts = listUnresolvedConflicts(db);
    assert.equal(conflicts.length, 1);
    assert.equal(getSupersededKeys(db).has("local:1"), false);
  });
});

test("listDecisions excludes superseded decisions by default, includes them when asked", () => {
  withTempProject((cwd) => {
    const db = openDatabase(cwd);
    markSessionProcessed(db, { sessionId: "s1", filePath: "/tmp/s1", startedAt: null, endedAt: null, title: "s1", transcript: "", filesTouched: [], skippedLines: 0 }, "ok");
    insertDecisions(db, "s1", [
      { title: "Use SQLite", decision: "d1", why: "w1", discarded: null, filesAffected: ["src/db.ts"], evidence: "e1" },
      { title: "Use SQLite (revised)", decision: "d2", why: "w2", discarded: null, filesAffected: ["src/db.ts"], evidence: "e2" },
    ]);
    const [first, second] = listDecisions(db);
    addSupersession(db, { source: "local", id: second.id }, { source: "local", id: first.id });

    assert.deepEqual(listDecisions(db).map((d) => d.id), [second.id]);
    assert.deepEqual(
      listDecisions(db, { includeSuperseded: true }).map((d) => d.id).sort(),
      [first.id, second.id].sort(),
    );
  });
});

test("getSupersessionCandidates matches by overlapping filesAffected, excludes already-superseded", () => {
  withTempProject((cwd) => {
    const db = openDatabase(cwd);
    markSessionProcessed(db, { sessionId: "s1", filePath: "/tmp/s1", startedAt: null, endedAt: null, title: "s1", transcript: "", filesTouched: [], skippedLines: 0 }, "ok");
    insertDecisions(db, "s1", [
      { title: "A", decision: "d", why: "w", discarded: null, filesAffected: ["src/db.ts"], evidence: "e" },
      { title: "B", decision: "d", why: "w", discarded: null, filesAffected: ["src/other.ts"], evidence: "e" },
    ]);
    const candidates = getSupersessionCandidates(db, ["src/db.ts"]);
    assert.equal(candidates.length, 1);
    assert.equal(candidates[0].title, "A");
  });
});
