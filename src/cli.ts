#!/usr/bin/env node
import { runGenerate } from "./commands/generate.js";
import { runUi } from "./commands/ui.js";
import { runMcpCommand } from "./commands/mcp.js";
import { runSetup } from "./commands/setup.js";

const HELP = `waypoint — distills architecture decisions from your Claude Code session history

Usage:
  waypoint setup                       Register waypoint as an MCP server for all projects
  waypoint generate [--since <date>]   Distill new sessions into decisions
  waypoint ui                          Show decisions on localhost
  waypoint mcp                         Run a read-only MCP server over stdio
  waypoint --help                      Show this help
`;

async function main() {
  const [, , command, ...rest] = process.argv;

  switch (command) {
    case "setup":
      await runSetup();
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
