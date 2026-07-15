import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { getAuthorSlug } from "./authorSlug.js";

function initRepoWithConfig(name: string, email: string): string {
  const dir = mkdtempSync(join(tmpdir(), "waypoint-authorslug-"));
  execFileSync("git", ["init", "-q"], { cwd: dir });
  execFileSync("git", ["config", "user.name", name], { cwd: dir });
  execFileSync("git", ["config", "user.email", email], { cwd: dir });
  return dir;
}

test("getAuthorSlug derives a stable slug from name and a short email hash", () => {
  const dir = initRepoWithConfig("Alejandra Mantilla", "alejamantillac@gmail.com");
  try {
    const slug = getAuthorSlug(dir);
    assert.match(slug ?? "", /^alejandra-mantilla-[0-9a-f]{6}$/);
    // deterministic: same inputs, same slug
    assert.equal(getAuthorSlug(dir), slug);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("two different authors with the same name get different slugs", () => {
  const dirA = initRepoWithConfig("Andres", "andres@a.com");
  const dirB = initRepoWithConfig("Andres", "andres@b.com");
  try {
    assert.notEqual(getAuthorSlug(dirA), getAuthorSlug(dirB));
  } finally {
    rmSync(dirA, { recursive: true, force: true });
    rmSync(dirB, { recursive: true, force: true });
  }
});

test("returns null when not a git repo", () => {
  const dir = mkdtempSync(join(tmpdir(), "waypoint-authorslug-nogit-"));
  try {
    assert.equal(getAuthorSlug(dir), null);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
