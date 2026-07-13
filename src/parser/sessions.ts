import { readFileSync, readdirSync, statSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import type { ParsedSession } from "./types.js";

const FILE_TOOLS = new Set(["Edit", "Write", "NotebookEdit"]);

function claudeProjectsDir(): string {
  return join(homedir(), ".claude", "projects");
}

/**
 * Claude Code encodes the cwd by replacing ":" and "\" with "-". The casing
 * of the drive letter has varied between versions (e.g. "C--Users-..." vs
 * "c--Users-..."), so the lookup for the real directory is case-insensitive.
 */
function encodeProjectPath(cwd: string): string {
  return cwd.replace(/[\\/:]/g, "-");
}

export function findProjectDir(cwd: string): string | null {
  const base = claudeProjectsDir();
  let entries: string[];
  try {
    entries = readdirSync(base);
  } catch {
    return null;
  }
  const expected = encodeProjectPath(cwd).toLowerCase();
  const match = entries.find((entry) => entry.toLowerCase() === expected);
  return match ? join(base, match) : null;
}

export function listSessionFiles(projectDir: string): string[] {
  return readdirSync(projectDir)
    .filter((f) => f.endsWith(".jsonl"))
    .map((f) => join(projectDir, f))
    .sort((a, b) => statSync(a).mtimeMs - statSync(b).mtimeMs);
}

interface RawEvent {
  type?: string;
  sessionId?: string;
  timestamp?: string;
  aiTitle?: string;
  message?: {
    role?: string;
    content?: unknown;
  };
}

function summarizeToolUse(name: string, input: unknown): string {
  const args = (input ?? {}) as Record<string, unknown>;
  if (typeof args.file_path === "string") return `${name}: ${args.file_path}`;
  if (typeof args.command === "string") {
    const cmd = args.command.length > 120 ? args.command.slice(0, 120) + "…" : args.command;
    return `${name}: ${cmd}`;
  }
  if (typeof args.pattern === "string") return `${name}: ${args.pattern}`;
  return name;
}

function extractTurnText(content: unknown): { text: string; files: string[] } {
  const files: string[] = [];
  if (typeof content === "string") return { text: content, files };
  if (!Array.isArray(content)) return { text: "", files };

  const parts: string[] = [];
  for (const block of content) {
    if (!block || typeof block !== "object") continue;
    const b = block as Record<string, unknown>;
    if (b.type === "text" && typeof b.text === "string") {
      parts.push(b.text);
    } else if (b.type === "tool_use" && typeof b.name === "string") {
      parts.push(`→ ${summarizeToolUse(b.name, b.input)}`);
      if (FILE_TOOLS.has(b.name)) {
        const input = (b.input ?? {}) as Record<string, unknown>;
        if (typeof input.file_path === "string") files.push(input.file_path);
      }
    }
    // 'thinking' and 'tool_result' blocks are omitted: they're noise for distillation.
  }
  return { text: parts.join("\n"), files };
}

export function parseSessionFile(filePath: string): ParsedSession | null {
  let raw: string;
  try {
    raw = readFileSync(filePath, "utf-8");
  } catch {
    return null;
  }

  const lines = raw.split("\n").filter((l) => l.trim().length > 0);
  let sessionId: string | null = null;
  let startedAt: string | null = null;
  let endedAt: string | null = null;
  let title: string | null = null;
  const transcriptLines: string[] = [];
  const filesTouched = new Set<string>();

  for (const line of lines) {
    let event: RawEvent;
    try {
      event = JSON.parse(line);
    } catch {
      continue; // corrupted/truncated line: skipped, doesn't discard the whole session
    }

    if (event.sessionId && !sessionId) sessionId = event.sessionId;
    if (event.timestamp) {
      if (!startedAt) startedAt = event.timestamp;
      endedAt = event.timestamp;
    }
    if (event.type === "ai-title" && event.aiTitle && !title) {
      title = event.aiTitle;
    }

    if (event.type === "user" || event.type === "assistant") {
      const role = event.message?.role ?? event.type;
      const { text, files } = extractTurnText(event.message?.content);
      for (const f of files) filesTouched.add(f);
      if (text.trim()) transcriptLines.push(`[${role}] ${text.trim()}`);
    }
  }

  if (!sessionId) return null;

  return {
    sessionId,
    filePath,
    startedAt,
    endedAt,
    title,
    transcript: transcriptLines.join("\n\n"),
    filesTouched: [...filesTouched],
  };
}

export function getSessionsForProject(
  cwd: string,
  opts: { since?: Date } = {},
): ParsedSession[] {
  const projectDir = findProjectDir(cwd);
  if (!projectDir) return [];

  const sessions: ParsedSession[] = [];
  for (const file of listSessionFiles(projectDir)) {
    const parsed = parseSessionFile(file);
    if (!parsed) continue;
    if (opts.since && parsed.startedAt) {
      if (new Date(parsed.startedAt) < opts.since) continue;
    }
    sessions.push(parsed);
  }
  return sessions;
}
