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

test("getAuthorSlug resolves from global config when there's no local override", () => {
  const dir = mkdtempSync(join(tmpdir(), "waypoint-authorslug-global-"));
  const globalConfigPath = join(dir, "global-gitconfig");
  const originalGitConfigGlobal = process.env.GIT_CONFIG_GLOBAL;
  try {
    execFileSync("git", ["init", "-q"], { cwd: dir });
    // Write an isolated "global" config file the child git process will use instead
    // of the real ~/.gitconfig, so this test doesn't depend on (or corrupt) the
    // actual developer's global git config.
    execFileSync("git", ["config", "--file", globalConfigPath, "user.name", "Global Only"]);
    execFileSync("git", ["config", "--file", globalConfigPath, "user.email", "global-only@example.com"]);

    // Set GIT_CONFIG_GLOBAL so the git command inside gitConfigValue picks up the isolated global config
    process.env.GIT_CONFIG_GLOBAL = globalConfigPath;
    const slug = getAuthorSlug(dir);
    assert.match(slug ?? "", /^global-only-[0-9a-f]{6}$/);
  } finally {
    // Restore the original GIT_CONFIG_GLOBAL value
    if (originalGitConfigGlobal !== undefined) {
      process.env.GIT_CONFIG_GLOBAL = originalGitConfigGlobal;
    } else {
      delete process.env.GIT_CONFIG_GLOBAL;
    }
    rmSync(dir, { recursive: true, force: true });
  }
});
