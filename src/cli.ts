#!/usr/bin/env node
import { runGenerate } from "./commands/generate.js";
import { runUi } from "./commands/ui.js";

const HELP = `waypoint — destila decisiones de arquitectura de tu historial de Claude Code

Uso:
  waypoint generate [--since <fecha>]   Destila sesiones nuevas en decisiones
  waypoint ui                           Muestra las decisiones en localhost
  waypoint --help                       Muestra esta ayuda
`;

async function main() {
  const [, , command, ...rest] = process.argv;

  switch (command) {
    case "generate":
      await runGenerate(rest);
      break;
    case "ui":
      await runUi(rest);
      break;
    case "--help":
    case "-h":
    case undefined:
      console.log(HELP);
      break;
    default:
      console.error(`Comando desconocido: ${command}\n`);
      console.log(HELP);
      process.exitCode = 1;
  }
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exitCode = 1;
});
