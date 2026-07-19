import { readFilterConfig, writeFilterMode, type FilterMode } from "../util/config.js";
import { openDatabase, getFilterAuditSummary } from "../db/database.js";

function printStatus(cwd: string): void {
  const config = readFilterConfig(cwd);
  const db = openDatabase(cwd);
  const summary = getFilterAuditSummary(db);

  console.log(`Filter mode: ${config.mode}`);
  console.log(`Transcript threshold: ${config.transcriptThreshold} chars`);

  if (summary.evaluated === 0) {
    console.log("No sessions evaluated by the filter yet.");
    return;
  }

  console.log(`Sessions evaluated: ${summary.evaluated}`);
  console.log(`Would have skipped: ${summary.wouldSkipCount}`);
  console.log(`False negatives detected (shadow mode): ${summary.falseNegativeCount}`);
  if (summary.unknownCount > 0) {
    console.log(
      `Skipped for real in active mode, unverified: ${summary.unknownCount} (no LLM call was made, so these can't be confirmed as true/false negatives)`,
    );
  }
}

function setMode(cwd: string, mode: FilterMode, description: string): void {
  writeFilterMode(cwd, mode);
  console.log(description);
}

export async function runFilter(args: string[]): Promise<void> {
  const cwd = process.cwd();
  const [subcommand] = args;

  switch (subcommand) {
    case "status":
      printStatus(cwd);
      break;
    case "disable":
      setMode(
        cwd,
        "disabled",
        "Filter disabled — generate will call claude -p for every new session, same as before this feature existed.",
      );
      break;
    case "enable":
      setMode(
        cwd,
        "shadow",
        "Filter enabled in shadow mode — every session is still distilled, but verdicts are now logged for review.",
      );
      break;
    case "activate":
      setMode(
        cwd,
        "active",
        "Filter activated — sessions matching the trivial-session heuristic will be skipped without calling claude -p. " +
          "Skipped sessions can no longer be verified for false negatives; run `waypoint filter deactivate` if you notice missing decisions.",
      );
      break;
    case "deactivate":
      setMode(cwd, "shadow", "Filter deactivated — back to shadow mode (observing only, no sessions skipped).");
      break;
    default:
      console.log("Usage: waypoint filter <status|enable|disable|activate|deactivate>");
      process.exitCode = 1;
  }
}
