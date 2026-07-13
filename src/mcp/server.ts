import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import {
  openDatabase,
  searchDecisions,
  listTimeline,
  getDecisionsByFile,
  searchImportedDecisions,
  listImportedTimeline,
  getImportedDecisionsByFile,
  type Decision,
  type ImportedDecision,
} from "../db/database.js";
import { annotateWithGitStatus, createGitStatusCache } from "../git/status.js";

interface AnnotatedResult {
  source: "local" | "imported";
  importedFrom?: string;
  [key: string]: unknown;
}

function combineResults(
  cwd: string,
  local: Decision[],
  imported: ImportedDecision[],
): AnnotatedResult[] {
  const cache = createGitStatusCache();
  const annotatedLocal = annotateWithGitStatus(cwd, local, undefined, cache).map((d) => ({ ...d, source: "local" as const }));
  const annotatedImported = annotateWithGitStatus(cwd, imported, (d) => d.sourceCreatedAt, cache).map((d) => ({
    ...d,
    source: "imported" as const,
    importedFrom: d.importedFrom,
  }));
  return [...annotatedLocal, ...annotatedImported];
}

function toolResult(results: AnnotatedResult[]) {
  return {
    content: [{ type: "text" as const, text: JSON.stringify(results, null, 2) }],
  };
}

export async function runMcp(): Promise<void> {
  const cwd = process.env.CLAUDE_PROJECT_DIR ?? process.cwd();

  const server = new McpServer(
    {
      name: "waypoint",
      version: "0.1.0",
    },
    {
      instructions:
        "Waypoint distills the architecture decisions (what was decided, why, what was discarded) buried in this " +
        "project's Claude Code session history. Whenever the user asks WHY something in this codebase was built a " +
        "certain way, why a technology was chosen, or what alternative was considered — use waypoint's " +
        "search_decisions or get_decisions_by_file tools BEFORE grepping the code or reading docs. Code comments " +
        "and grep rarely contain the reasoning; this server does.",
    },
  );

  server.registerTool(
    "search_decisions",
    {
      title: "Search decisions",
      description:
        "Use this WHENEVER the user asks why this project does something a certain way, why a technology/library was chosen, or what alternative was considered and discarded. " +
        "The reasoning behind a decision is rarely in code comments — it lives here, distilled from the Claude Code sessions where the decision was actually made. " +
        "Prefer this over grepping the code or reading files first when the question is about intent or justification, not implementation. " +
        "Searches this project's distilled architecture decisions by keyword (matches title, decision, why, or discarded fields).",
      inputSchema: { keyword: z.string() },
    },
    async ({ keyword }) => {
      const db = openDatabase(cwd);
      return toolResult(combineResults(cwd, searchDecisions(db, keyword), searchImportedDecisions(db, keyword)));
    },
  );

  server.registerTool(
    "list_timeline",
    {
      title: "List timeline",
      description:
        "Use this when the user wants an overview of what architecture decisions were made in this project and when, e.g. 'what has been decided here?' or 'give me a history of the design choices'. " +
        "Lists this project's distilled architecture decisions in chronological order, optionally filtered by an ISO date range.",
      inputSchema: {
        since: z.string().optional().describe("ISO date; only decisions created at or after this date"),
        until: z.string().optional().describe("ISO date; only decisions created at or before this date"),
      },
    },
    async ({ since, until }) => {
      const db = openDatabase(cwd);
      return toolResult(
        combineResults(cwd, listTimeline(db, { since, until }), listImportedTimeline(db, { since, until })),
      );
    },
  );

  server.registerTool(
    "get_decisions_by_file",
    {
      title: "Get decisions by file",
      description:
        "Use this WHENEVER the user asks why a specific file is written the way it is, or before editing a file whose design might be intentional — check here first to avoid undoing a deliberate decision. " +
        "Lists this project's distilled architecture decisions whose files_affected includes the given path (substring match).",
      inputSchema: { path: z.string() },
    },
    async ({ path }) => {
      const db = openDatabase(cwd);
      return toolResult(combineResults(cwd, getDecisionsByFile(db, path), getImportedDecisionsByFile(db, path)));
    },
  );

  const transport = new StdioServerTransport();
  await server.connect(transport);
}
