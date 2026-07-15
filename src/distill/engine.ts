import { spawn } from "node:child_process";
import { mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { ParsedSession } from "../parser/types.js";
import type { DecisionInput } from "../db/database.js";

const JSON_SCHEMA = JSON.stringify({
  type: "object",
  properties: {
    decisions: {
      type: "array",
      items: {
        type: "object",
        properties: {
          title: { type: "string" },
          decision: { type: "string" },
          why: { type: "string" },
          discarded: { type: ["string", "null"] },
          files_affected: { type: "array", items: { type: "string" } },
          evidence: { type: "string" },
          supersedes_candidate_id: { type: ["integer", "null"] },
        },
        required: ["title", "decision", "why", "discarded", "files_affected", "evidence", "supersedes_candidate_id"],
      },
    },
  },
  required: ["decisions"],
});

const PROMPT = `You will read the transcript of a Claude Code session (piped via stdin).
Identify only ARCHITECTURE or technical DESIGN decisions made in it: technology choices,
data structures, patterns, implementation approaches, trade-offs, etc.

For each decision report: a short title, what was decided, why (the justification given
in the conversation), what alternative was discarded (if explicitly mentioned, otherwise use
null), which files were affected, and evidence: an EXACT, VERBATIM quote copied character-for-character
from the transcript that supports the decision. Do not paraphrase or summarize the quote — copy it
exactly as it appears, since it will be checked as a literal substring of the transcript. If you
cannot find a real quote to cite, do not report that decision at all.

Report ONLY decisions that were already made or implemented in this conversation. Do not include
future plans, work mentioned as pending, or how you think something not yet built will be
implemented — that's not a decision, it's an intention.

Write the title, decision, why, discarded, and evidence fields in the same language the conversation
transcript is written in.

If the session is trivial chat, minor debugging, or contains no recognizable architecture
decision backed by a real quote, respond with decisions: [] — do not invent decisions or quotes
that aren't in the text.`;

const DISALLOWED_TOOLS = "Bash,Read,Edit,Write,NotebookEdit,Glob,Grep,WebFetch,WebSearch";
const MAX_BUDGET_USD = "0.50";
const TIMEOUT_MS = 120_000;

interface ClaudeJsonResponse {
  structured_output?: { decisions?: RawDecision[] };
  total_cost_usd?: number;
}

interface RawDecision {
  title?: unknown;
  decision?: unknown;
  why?: unknown;
  discarded?: unknown;
  files_affected?: unknown;
  evidence?: unknown;
  supersedes_candidate_id?: unknown;
}

export interface SupersessionCandidate {
  id: number;
  title: string;
  decision: string;
  filesAffected: string[];
}

export function buildCandidatesBlock(candidates: SupersessionCandidate[]): string {
  if (candidates.length === 0) return "";
  const lines = candidates.map((c) => `- id: ${c.id} — "${c.title}": ${c.decision} (files: ${c.filesAffected.join(", ")})`);
  return `\n\nThese decisions were already recorded for files this session touches. If a new decision you find ` +
    `supersedes/replaces one of these (the team's thinking moved on), set supersedes_candidate_id to its id. ` +
    `Otherwise set it to null. Do not invent an id that isn't listed below.\n${lines.join("\n")}`;
}

export function normalizeDecision(raw: RawDecision, transcript: string): DecisionInput | null {
  if (
    typeof raw.title !== "string" ||
    typeof raw.decision !== "string" ||
    typeof raw.why !== "string" ||
    typeof raw.evidence !== "string" ||
    !raw.evidence.trim()
  ) {
    return null;
  }
  // Deterministic safety net: don't trust the model's claim that a quote exists — verify it's
  // a literal substring of the transcript, otherwise the "citation" is itself a hallucination.
  if (!transcript.includes(raw.evidence)) {
    return null;
  }
  return {
    title: raw.title,
    decision: raw.decision,
    why: raw.why,
    discarded: typeof raw.discarded === "string" ? raw.discarded : null,
    filesAffected: Array.isArray(raw.files_affected)
      ? raw.files_affected.filter((f): f is string => typeof f === "string")
      : [],
    evidence: raw.evidence,
    supersedesCandidateId: typeof raw.supersedes_candidate_id === "number" ? raw.supersedes_candidate_id : null,
  };
}

export interface DistillResult {
  ok: boolean;
  decisions: DecisionInput[];
  costUsd?: number;
  error?: string;
}

function isolatedRunDir(): string {
  const dir = join(tmpdir(), "waypoint-distill-runs");
  mkdirSync(dir, { recursive: true });
  return dir;
}

export interface DistillOptions {
  /** Forwarded to `claude -p --model <value>`. Omit to use claude -p's own default. */
  model?: string;
}

export function distillSession(
  session: ParsedSession,
  candidates: SupersessionCandidate[],
  options: DistillOptions = {},
): Promise<DistillResult> {
  return new Promise((resolve) => {
    if (!session.transcript.trim()) {
      resolve({ ok: true, decisions: [] });
      return;
    }

    const args = [
      "-p",
      PROMPT + buildCandidatesBlock(candidates),
      "--output-format",
      "json",
      "--json-schema",
      JSON_SCHEMA,
      "--disallowedTools",
      DISALLOWED_TOOLS,
      "--max-budget-usd",
      MAX_BUDGET_USD,
    ];
    if (options.model) args.push("--model", options.model);

    const child = spawn("claude", args, { stdio: ["pipe", "pipe", "pipe"], cwd: isolatedRunDir() });

    let stdout = "";
    let stderr = "";
    const timer = setTimeout(() => {
      child.kill();
    }, TIMEOUT_MS);

    child.stdout.on("data", (chunk) => (stdout += chunk));
    child.stderr.on("data", (chunk) => (stderr += chunk));

    child.on("error", (err) => {
      clearTimeout(timer);
      const error =
        (err as NodeJS.ErrnoException).code === "ENOENT"
          ? "couldn't find the `claude` command — is Claude Code installed and on your PATH?"
          : err.message;
      resolve({ ok: false, decisions: [], error });
    });

    child.on("close", (code) => {
      clearTimeout(timer);
      if (code !== 0) {
        resolve({ ok: false, decisions: [], error: stderr || `claude -p exited with code ${code}` });
        return;
      }
      try {
        const parsed: ClaudeJsonResponse = JSON.parse(stdout);
        const rawDecisions = parsed.structured_output?.decisions ?? [];
        const decisions = rawDecisions
          .map((d) => normalizeDecision(d, session.transcript))
          .filter((d): d is DecisionInput => d !== null);
        resolve({ ok: true, decisions, costUsd: parsed.total_cost_usd });
      } catch (err) {
        resolve({
          ok: false,
          decisions: [],
          error: `response was not valid JSON: ${err instanceof Error ? err.message : err}`,
        });
      }
    });

    child.stdin.write(session.transcript);
    child.stdin.end();
  });
}
