import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { appendToSharedFile, listOtherAuthorSharedFiles, readSharedFile } from "./sharedStore.js";
import type { ExportableDecision } from "../db/database.js";

function withTempProject(fn: (cwd: string) => void) {
  const dir = mkdtempSync(join(tmpdir(), "waypoint-sharedstore-"));
  try {
    fn(dir);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

const decision: ExportableDecision = {
  sessionId: "s1",
  sessionTitle: "session one",
  sessionStartedAt: "2026-07-14T00:00:00.000Z",
  title: "Use SQLite",
  decision: "d",
  why: "w",
  discarded: null,
  evidence: "e",
  filesAffected: ["src/db.ts"],
  createdAt: "2026-07-14T00:00:00.000Z",
};

test("appendToSharedFile creates the file on first write and appends on subsequent writes", () => {
  withTempProject((cwd) => {
    appendToSharedFile(cwd, "alejandra-abc123", [decision]);
    let file = readSharedFile(join(cwd, ".waypoint", "shared", "alejandra-abc123.json"));
    assert.equal(file.decisions.length, 1);

    appendToSharedFile(cwd, "alejandra-abc123", [{ ...decision, sessionId: "s2", title: "Second" }]);
    file = readSharedFile(join(cwd, ".waypoint", "shared", "alejandra-abc123.json"));
    assert.equal(file.decisions.length, 2);
    assert.equal(file.decisions[1].title, "Second");
  });
});

test("listOtherAuthorSharedFiles excludes the caller's own slug", () => {
  withTempProject((cwd) => {
    appendToSharedFile(cwd, "alejandra-abc123", [decision]);
    appendToSharedFile(cwd, "andres-def456", [decision]);

    const others = listOtherAuthorSharedFiles(cwd, "alejandra-abc123");
    assert.equal(others.length, 1);
    assert.equal(others[0].slug, "andres-def456");
  });
});

test("listOtherAuthorSharedFiles returns everyone when own slug is null", () => {
  withTempProject((cwd) => {
    appendToSharedFile(cwd, "alejandra-abc123", [decision]);
    const others = listOtherAuthorSharedFiles(cwd, null);
    assert.equal(others.length, 1);
  });
});
