import { test } from "node:test";
import assert from "node:assert/strict";
import { computeFilterVerdict } from "./filter.js";
import type { ParsedSession } from "../parser/types.js";

function fakeSession(overrides: Partial<ParsedSession> = {}): ParsedSession {
  return {
    sessionId: "s1",
    filePath: "/fake/path.jsonl",
    startedAt: null,
    endedAt: null,
    title: null,
    transcript: "",
    filesTouched: [],
    skippedLines: 0,
    bashToolCallCount: 0,
    turnCount: 0,
    ...overrides,
  };
}

test("marks wouldSkip when transcript is short, no files touched, no bash calls", () => {
  const session = fakeSession({ transcript: "a".repeat(100) });
  const verdict = computeFilterVerdict(session);
  assert.equal(verdict.wouldSkip, true);
});

test("does NOT mark wouldSkip when a file was touched, even with a short transcript", () => {
  const session = fakeSession({ transcript: "a".repeat(100), filesTouched: ["src/db.ts"] });
  const verdict = computeFilterVerdict(session);
  assert.equal(verdict.wouldSkip, false);
});

test("does NOT mark wouldSkip when a bash call happened, even with a short transcript and no files", () => {
  const session = fakeSession({ transcript: "a".repeat(100), bashToolCallCount: 1 });
  const verdict = computeFilterVerdict(session);
  assert.equal(verdict.wouldSkip, false);
});

test("does NOT mark wouldSkip when the transcript is at/above the threshold", () => {
  const session = fakeSession({ transcript: "a".repeat(500) });
  const verdict = computeFilterVerdict(session, 500);
  assert.equal(verdict.wouldSkip, false);
});

test("marks wouldSkip when the transcript is one character below the threshold", () => {
  const session = fakeSession({ transcript: "a".repeat(499) });
  const verdict = computeFilterVerdict(session, 500);
  assert.equal(verdict.wouldSkip, true);
});

test("respects a custom threshold", () => {
  const session = fakeSession({ transcript: "a".repeat(50) });
  assert.equal(computeFilterVerdict(session, 100).wouldSkip, true);
  assert.equal(computeFilterVerdict(session, 10).wouldSkip, false);
});

test("reason string is human-readable and mentions the threshold used", () => {
  const session = fakeSession({ transcript: "a".repeat(10) });
  const verdict = computeFilterVerdict(session, 500);
  assert.match(verdict.reason, /500/);
});
