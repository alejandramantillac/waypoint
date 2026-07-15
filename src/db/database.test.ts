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
