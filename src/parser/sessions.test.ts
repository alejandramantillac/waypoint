import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { parseSessionFile } from "./sessions.js";

function writeSessionFile(lines: object[]): string {
  const dir = mkdtempSync(join(tmpdir(), "waypoint-parser-test-"));
  const path = join(dir, "session.jsonl");
  writeFileSync(path, lines.map((l) => JSON.stringify(l)).join("\n"));
  return path;
}

test("parseSessionFile counts Bash tool_use calls without adding them to filesTouched", () => {
  const path = writeSessionFile([
    {
      type: "user",
      sessionId: "s1",
      timestamp: "2026-01-01T00:00:00Z",
      message: { role: "user", content: "run the migration" },
    },
    {
      type: "assistant",
      sessionId: "s1",
      timestamp: "2026-01-01T00:00:01Z",
      message: {
        role: "assistant",
        content: [
          { type: "text", text: "done" },
          { type: "tool_use", name: "Bash", input: { command: "psql -c 'ALTER TABLE...'" } },
          { type: "tool_use", name: "Bash", input: { command: "echo ok" } },
        ],
      },
    },
  ]);
  const session = parseSessionFile(path);
  rmSync(path, { force: true });

  assert.equal(session?.bashToolCallCount, 2);
  assert.deepEqual(session?.filesTouched, []);
});

test("parseSessionFile counts Edit tool_use calls into filesTouched without counting them as Bash", () => {
  const path = writeSessionFile([
    {
      type: "assistant",
      sessionId: "s2",
      timestamp: "2026-01-01T00:00:00Z",
      message: {
        role: "assistant",
        content: [{ type: "tool_use", name: "Edit", input: { file_path: "src/db.ts" } }],
      },
    },
  ]);
  const session = parseSessionFile(path);
  rmSync(path, { force: true });

  assert.deepEqual(session?.filesTouched, ["src/db.ts"]);
  assert.equal(session?.bashToolCallCount, 0);
});

test("parseSessionFile counts one turn per non-empty [role] transcript line", () => {
  const path = writeSessionFile([
    { type: "user", sessionId: "s3", timestamp: "2026-01-01T00:00:00Z", message: { role: "user", content: "hi" } },
    { type: "assistant", sessionId: "s3", timestamp: "2026-01-01T00:00:01Z", message: { role: "assistant", content: "hello" } },
    { type: "user", sessionId: "s3", timestamp: "2026-01-01T00:00:02Z", message: { role: "user", content: "  " } },
  ]);
  const session = parseSessionFile(path);
  rmSync(path, { force: true });

  assert.equal(session?.turnCount, 2);
});
