import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync, mkdirSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { readFilterConfig, writeFilterMode } from "./config.js";

function withTempProject(fn: (cwd: string) => void) {
  const dir = mkdtempSync(join(tmpdir(), "waypoint-config-test-"));
  try {
    fn(dir);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

test("readFilterConfig returns shadow/500 defaults when no config file exists", () => {
  withTempProject((cwd) => {
    const config = readFilterConfig(cwd);
    assert.deepEqual(config, { mode: "shadow", transcriptThreshold: 500 });
  });
});

test("writeFilterMode then readFilterConfig round-trips the mode", () => {
  withTempProject((cwd) => {
    writeFilterMode(cwd, "active");
    const config = readFilterConfig(cwd);
    assert.equal(config.mode, "active");
  });
});

test("readFilterConfig falls back to shadow when mode is an invalid value", () => {
  withTempProject((cwd) => {
    mkdirSync(join(cwd, ".waypoint"), { recursive: true });
    writeFileSync(join(cwd, ".waypoint", "config.json"), JSON.stringify({ filter: { mode: "yolo" } }));
    const config = readFilterConfig(cwd);
    assert.equal(config.mode, "shadow");
  });
});

test("readFilterConfig falls back to defaults when the file is malformed JSON, without throwing", () => {
  withTempProject((cwd) => {
    mkdirSync(join(cwd, ".waypoint"), { recursive: true });
    writeFileSync(join(cwd, ".waypoint", "config.json"), "{ this is not json");
    const config = readFilterConfig(cwd);
    assert.deepEqual(config, { mode: "shadow", transcriptThreshold: 500 });
  });
});

test("writeFilterMode preserves transcriptThreshold set previously in the file", () => {
  withTempProject((cwd) => {
    mkdirSync(join(cwd, ".waypoint"), { recursive: true });
    writeFileSync(
      join(cwd, ".waypoint", "config.json"),
      JSON.stringify({ filter: { mode: "shadow", transcriptThreshold: 800 } }),
    );
    writeFilterMode(cwd, "active");
    const config = readFilterConfig(cwd);
    assert.equal(config.transcriptThreshold, 800);
    assert.equal(config.mode, "active");
  });
});
