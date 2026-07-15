import { test } from "node:test";
import assert from "node:assert/strict";
import { normalizeDecision, buildCandidatesBlock } from "./engine.js";

test("normalizeDecision carries supersedesCandidateId through when present and valid", () => {
  const transcript = "we decided to use SQLite because it's simple";
  const result = normalizeDecision(
    {
      title: "Use SQLite",
      decision: "Use SQLite",
      why: "simple",
      discarded: null,
      files_affected: ["src/db.ts"],
      evidence: "we decided to use SQLite because it's simple",
      supersedes_candidate_id: 7,
    },
    transcript,
  );
  assert.equal(result?.supersedesCandidateId, 7);
});

test("normalizeDecision defaults supersedesCandidateId to null when absent or not a number", () => {
  const transcript = "quote here";
  const result = normalizeDecision(
    { title: "T", decision: "d", why: "w", discarded: null, files_affected: [], evidence: "quote here" },
    transcript,
  );
  assert.equal(result?.supersedesCandidateId, null);
});

test("buildCandidatesBlock renders an empty string for no candidates", () => {
  assert.equal(buildCandidatesBlock([]), "");
});

test("buildCandidatesBlock renders each candidate with its id", () => {
  const block = buildCandidatesBlock([{ id: 7, title: "Use MySQL", decision: "Use MySQL", filesAffected: ["src/db.ts"] }]);
  assert.match(block, /id: 7/);
  assert.match(block, /Use MySQL/);
});
