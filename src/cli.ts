#!/usr/bin/env node
import { runGenerate } from "./commands/generate.js";
import { runUi } from "./commands/ui.js";
import { runMcpCommand } from "./commands/mcp.js";
import { runSetup } from "./commands/setup.js";
import { runExport } from "./commands/export.js";
import { runImport } from "./commands/import.js";
import { runStatus } from "./commands/status.js";

const HELP = `waypoint — distills architecture decisions from your Claude Code session history

Usage:
  waypoint setup                       Register waypoint as an MCP server for all projects
  waypoint status                      Preview sessions found, no cost (no claude -p calls)
  waypoint generate [--since <date>] [--model <model>]   Distill new sessions into decisions
  waypoint ui                          Show decisions on localhost
  waypoint mcp                         Run a read-only MCP server over stdio
  waypoint export --author "<name>" [file]   Export this project's decisions to share
  waypoint import <file>               Import a collaborator's exported decisions
  waypoint --help                      Show this help
`;

async function main() {
  const [, , command, ...rest] = process.argv;

  switch (command) {
    case "setup":
      await runSetup();
      break;
    case "status":
      await runStatus();
      break;
    case "generate":
      await runGenerate(rest);
      break;
    case "ui":
      await runUi(rest);
      break;
    case "mcp":
      await runMcpCommand();
      break;
    case "export":
      await runExport(rest);
      break;
    case "import":
      await runImport(rest);
      break;
    case "--help":
    case "-h":
    case undefined:
      console.log(HELP);
      break;
    default:
      console.error(`Unknown command: ${command}\n`);
      console.log(HELP);
      process.exitCode = 1;
  }
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exitCode = 1;
});
