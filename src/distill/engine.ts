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
        },
        required: ["title", "decision", "why", "discarded", "files_affected"],
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
null), and which files were affected.

Report ONLY decisions that were already made or implemented in this conversation. Do not include
future plans, work mentioned as pending, or how you think something not yet built will be
implemented — that's not a decision, it's an intention.

Write the title, decision, why, and discarded fields in the same language the conversation
transcript is written in.

If the session is trivial chat, minor debugging, or contains no recognizable architecture
decision, respond with decisions: [] — do not invent decisions that aren't in the text.`;

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
}

function normalizeDecision(raw: RawDecision): DecisionInput | null {
  if (typeof raw.title !== "string" || typeof raw.decision !== "string" || typeof raw.why !== "string") {
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

export function distillSession(session: ParsedSession): Promise<DistillResult> {
  return new Promise((resolve) => {
    if (!session.transcript.trim()) {
      resolve({ ok: true, decisions: [] });
      return;
    }

    const child = spawn(
      "claude",
      [
        "-p",
        PROMPT,
        "--output-format",
        "json",
        "--json-schema",
        JSON_SCHEMA,
        "--disallowedTools",
        DISALLOWED_TOOLS,
        "--max-budget-usd",
        MAX_BUDGET_USD,
      ],
      { stdio: ["pipe", "pipe", "pipe"], cwd: isolatedRunDir() },
    );

    let stdout = "";
    let stderr = "";
    const timer = setTimeout(() => {
      child.kill();
    }, TIMEOUT_MS);

    child.stdout.on("data", (chunk) => (stdout += chunk));
    child.stderr.on("data", (chunk) => (stderr += chunk));

    child.on("error", (err) => {
      clearTimeout(timer);
      resolve({ ok: false, decisions: [], error: err.message });
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
        const decisions = rawDecisions.map(normalizeDecision).filter((d): d is DecisionInput => d !== null);
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
