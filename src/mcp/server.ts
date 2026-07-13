import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import {
  openDatabase,
  searchDecisions,
  listTimeline,
  getDecisionsByFile,
  type Decision,
} from "../db/database.js";

function toolResult(decisions: Decision[]) {
  return {
    content: [{ type: "text" as const, text: JSON.stringify(decisions, null, 2) }],
  };
}

export async function runMcp(): Promise<void> {
  const cwd = process.cwd();

  const server = new McpServer({
    name: "waypoint",
    version: "0.1.0",
  });

  server.registerTool(
    "search_decisions",
    {
      title: "Search decisions",
      description:
        "Search this project's distilled architecture decisions by keyword (matches title, decision, why, or discarded fields).",
      inputSchema: { keyword: z.string() },
    },
    async ({ keyword }) => {
      const db = openDatabase(cwd);
      return toolResult(searchDecisions(db, keyword));
    },
  );

  server.registerTool(
    "list_timeline",
    {
      title: "List timeline",
      description:
        "List this project's distilled architecture decisions in chronological order, optionally filtered by an ISO date range.",
      inputSchema: {
        since: z.string().optional().describe("ISO date; only decisions created at or after this date"),
        until: z.string().optional().describe("ISO date; only decisions created at or before this date"),
      },
    },
    async ({ since, until }) => {
      const db = openDatabase(cwd);
      return toolResult(listTimeline(db, { since, until }));
    },
  );

  server.registerTool(
    "get_decisions_by_file",
    {
      title: "Get decisions by file",
      description:
        "List this project's distilled architecture decisions whose files_affected includes the given path (substring match).",
      inputSchema: { path: z.string() },
    },
    async ({ path }) => {
      const db = openDatabase(cwd);
      return toolResult(getDecisionsByFile(db, path));
    },
  );

  const transport = new StdioServerTransport();
  await server.connect(transport);
}
